import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readConfig, targetLabel } from "./config.js";
import { createConnections } from "./connections.js";
import { WorkshopError, reportError } from "./errors.js";
import { readPlanner, requireSession } from "./planner.js";
import { copyFavorites } from "./transfer.js";
import { createCalendar } from "./calendar.js";
import { createSearch } from "./search.js";

async function readJson(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new WorkshopError(415, "JSON_REQUIRED", "Send an application/json request.");
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16384) {
      throw new WorkshopError(413, "REQUEST_TOO_LARGE", "This request exceeds the workshop input limit.");
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new SyntaxError();
    return data;
  } catch {
    throw new WorkshopError(400, "INVALID_JSON", "The request must contain a JSON object.");
  }
}

export async function createApp({ config, connections, repository, logger = console, search = createSearch({ config, connections }) }) {
  const html = await readFile(new URL("./public/index.html", import.meta.url), "utf8");
  const csrfToken = randomBytes(32).toString("hex");
  let activeTarget = config.activeTarget;
  let targetEpoch = 0;
  const details = () => ({
    target: activeTarget,
    initialTarget: config.activeTarget,
    mode: config.mode,
    scenario: config.scenario || "attendee",
    location: config.location,
    targets: Object.keys(config.targets).map((id) => ({ id, label: targetLabel(id, config.location, config.scenario) })),
    csrfToken,
  });
  function assertTarget(target) {
    if (target !== activeTarget) {
      throw new WorkshopError(409, "TARGET_CHANGED", "The active database changed. Refresh before making changes.");
    }
  }
  function assertToken(request) {
    const supplied = Buffer.from(request.headers["x-workshop-token"] || "");
    const expected = Buffer.from(csrfToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new WorkshopError(403, "REQUEST_TOKEN_REQUIRED", "Reload the workshop page before making changes.");
    }
  }
  const server = http.createServer(async (request, response) => {
    const nonce = randomBytes(18).toString("base64");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const json = (status, data) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data));
    };
    try {
      const authority = request.headers.host || "";
      if (!/^([a-zA-Z0-9.-]+|\[::1\])(?::[0-9]+)?$/.test(authority) ||
          !["localhost", "127.0.0.1", "[::1]", config.publicHost].includes(new URL(`http://${authority}`).hostname)) {
        throw new WorkshopError(403, "HOST_NOT_ALLOWED", "Open the planner through loopback or its explicitly configured private forwarding hostname.");
      }
      const url = new URL(request.url, "http://workshop.invalid");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html.replaceAll("__CSP_NONCE__", nonce));
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/config") {
        json(200, details());
        return;
      }
      const target = activeTarget;
      const epoch = targetEpoch;
      if (request.method === "GET" && url.pathname === "/api/search/status") {
        const status = await search.status(target);
        if (epoch !== targetEpoch) throw new WorkshopError(409, "TARGET_CHANGED", "The active database changed. Refresh search readiness.");
        json(200, status);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        await (await connections.db(target)).command({ ping: 1 });
        json(200, { ready: true, target, mode: config.mode, location: config.location });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        const state = await readPlanner(await connections.db(target), repository);
        json(200, { target, ...state });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/calendar") {
        assertTarget(url.searchParams.get("target"));
        const state = await readPlanner(await connections.db(target), repository);
        if (state.orphanedFavorites.length) {
          throw new WorkshopError(409, "CATALOG_DRIFT", "Some favorites have no matching session. Resolve the catalog drift before exporting.");
        }
        const favorites = new Set(state.favorites);
        const calendar = createCalendar(state.sessions.filter((session) => favorites.has(session.id)), state.catalog);
        response.writeHead(200, {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="${state.catalog.kind === "practice" ? "practice-" : ""}conference-favorites.ics"`,
        });
        response.end(calendar);
        return;
      }
      if (["POST", "DELETE"].includes(request.method)) {
        assertToken(request);
        const data = await readJson(request);
        assertTarget(data.target);
        if (epoch !== targetEpoch) throw new WorkshopError(409, "TARGET_CHANGED", "The active database changed while receiving this request. Refresh before retrying.");
        if (request.method === "POST" && url.pathname === "/api/search") {
          const controller = new AbortController();
          const disconnected = () => { if (!response.writableEnded) controller.abort(); };
          response.once("close", disconnected);
          try {
            const result = await search.query(target, data, controller.signal);
            if (epoch !== targetEpoch) throw new WorkshopError(409, "TARGET_CHANGED", "The active database changed during search. No stale results were returned.");
            assertTarget(data.target);
            json(200, result);
          } finally { response.off("close", disconnected); }
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/target") {
          if (!["local", "site-b", "cloud"].includes(data.nextTarget)) {
            throw new WorkshopError(400, "INVALID_TARGET", "Choose one of the configured database targets.");
          }
          await (await connections.db(data.nextTarget)).command({ ping: 1 });
          assertTarget(data.target);
          activeTarget = data.nextTarget;
          targetEpoch += 1;
          json(200, details());
          return;
        }
        if (url.pathname === "/api/favorites") {
          const db = await connections.db(target);
          await requireSession(db, data.sessionId);
          if (request.method === "POST") {
            const result = await repository.saveFavorite(db, data.sessionId);
            json(200, { target, status: result.upsertedCount === 1 ? "saved" : "already_saved" });
          } else {
            const result = await db.collection("favorites").deleteOne({ _id: data.sessionId });
            json(200, { target, removed: result.deletedCount === 1 });
          }
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/transfer") {
          if (data.source !== target || !["local", "site-b", "cloud"].includes(data.destination) || data.source === data.destination) {
            throw new WorkshopError(400, "INVALID_TRANSFER", "Copy from the active target to the other configured target.");
          }
          const result = await copyFavorites(await connections.db(data.source), await connections.db(data.destination), data.sessionIds);
          if (!result.complete) {
            logger.error(JSON.stringify({ event: "copy_incomplete", statuses: result.results.map((item) => item.status) }));
          }
          json(result.complete ? 200 : 207, { source: data.source, destination: data.destination, ...result });
          return;
        }
      }
      throw new WorkshopError(404, "NOT_FOUND", "This workshop route does not exist.");
    } catch (error) {
      const safe = reportError(error, logger);
      if (!response.headersSent && !response.destroyed) {
        json(safe.status, { error: { code: safe.code, message: safe.message } });
      }
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.timeout = 65000;
  return {
    server,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await connections.close();
    },
  };
}

async function main() {
  const config = readConfig();
  const repository = config.mode === "starter"
    ? await import("../exercises/starter/repository.js")
    : await import("../examples/complete/repository.js");
  const connections = createConnections(config);
  const app = await createApp({ config, connections, repository });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(config.port, config.host, resolve);
  });
  console.log(`Workshop listening on port ${config.port}; ${config.mode} implementation; ${config.activeTarget} target.`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await app.close();
    } catch (error) {
      reportError(error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    reportError(error);
    process.exitCode = 1;
  });
}
