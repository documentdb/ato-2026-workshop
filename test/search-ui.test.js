import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
const catalog = { kind: "official", title: "All Things Open 2026", snapshotDate: "2026-10-12", timeZone: "America/New_York", source: "216 published schedule entries" };
const config = { target: "local", mode: "starter", csrfToken: "test-token", targets: [{ id: "local", label: "Site A" }, { id: "cloud", label: "Site B" }] };
const status = { target: "local", enabled: true, ready: true, model: { name: "local-embed", digest: "sha256:test", dimensions: 768 }, catalog, filters: { days: ["2026-10-20"], tracks: ["AI", "Security"] } };
const session = { id: "session-1", title: "Running models locally", track: "AI", room: "Room 1", startsAt: "2026-10-20T14:00:00.000Z", endsAt: "2026-10-20T15:00:00.000Z", url: "https://example.org/session" };
const planner = { target: "local", catalog, sessions: [session], favorites: [], conflicts: [], orphanedFavorites: [] };
const response = {
  target: "local", results: [{ session, similarity: 0.7234, evidence: { title: session.title, track: session.track }, rank: 1 }],
  inspector: { status: "ok", target: "local", model: status.model, database: "workshop", collection: "session_vectors", index: "semantic_cosine", filterStrategy: "prefilter", pipeline: [{ $search: { vector: "[0.12, ... 768 dimensions]" } }], filters: {}, embeddingMs: 30000, databaseMs: 6, totalMs: 30006, rankingPolicy: "pure semantic", cutoff: 0.45, candidates: 5, metadataOnly: true },
};
const json = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Runs the actual page script with a minimal DOM, not a rendered-browser proof.
// innerHTML throws so metadata/inspector XSS regressions cannot silently pass.
function browser(fetcher = async (path) => {
  if (path === "/api/search/status") return json(status);
  if (path === "/api/search") return json(response);
  throw new Error(`Unexpected request: ${path}`);
}) {
  const elements = new Map();
  class Element {
    constructor(tag = "div") {
      Object.assign(this, { tagName: tag, hidden: false, disabled: false, textContent: "", value: "", children: [], attributes: {}, listeners: {}, className: "" });
    }
    set innerHTML(_) { throw new Error("Do not interpret server-provided HTML"); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    async emit(name) { await this.listeners[name]?.({ preventDefault() {} }); }
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const descendants = (element) => [element, ...element.children.flatMap(descendants)];
  const calls = [];
  const context = vm.createContext({
    Intl, Date, URL, URLSearchParams, AbortController, Set, Map, Error, console,
    window: { confirm: () => true },
    fetch: async (path, options) => { calls.push({ path, options }); return fetcher(path, options); },
    document: {
      getElementById: get, createElement: (tag) => new Element(tag),
      querySelectorAll: () => [...elements.values()].flatMap(descendants).filter((element) => element.className.includes("save-favorite")),
    },
  });
  const run = (source) => vm.runInContext(source, context);
  run(script.replace(/    perform\(refresh\);\s*$/, ""));
  run(`config = ${JSON.stringify(config)}`);
  for (const [id, text] of [["local", "running AI locally"], ["security", "securing software supply chains"], ["accessibility", "building accessible interfaces"]]) get(`semantic-chip-${id}`).textContent = text;
  return { get, run, calls, descendants, text: (id) => descendants(get(id)).map((element) => element.textContent).join(" ") };
}

test("optional panel is always present, accurately labeled and accessible without TODO 1", () => {
  assert.match(html, /<section class="panel stack semantic" aria-labelledby="semantic-title">/);
  assert.match(html, /Optional built-in showcase \/ Outside the 105-minute lab/);
  assert.match(html, /Keyword search\s*<input id="search"/);
  assert.match(html, /maxlength="500" required autocomplete="off"/);
  assert.match(html, /npm run search:prepare -- --local-sites/);
  assert.match(html, /Codespaces prepares search automatically on startup/);
  assert.match(html, /core workshop stays usable while it loads/);
  assert.match(html, /Retry or laptop-local setup:/);
  assert.doesNotMatch(html, /Optional setup:/);
  assert.match(html, /id="semantic-status" role="status" aria-live="polite"/);
  assert.match(html, /id="semantic-message" role="status" aria-live="polite"/);
  assert.match(html, /raw cosine similarity, not confidence or probability/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB|innerHTML/);
});

test("search status loads even when starter state fails with TODO 1", async () => {
  const ui = browser(async (path) => {
    if (path === "/api/config") return json(config);
    if (path === "/api/health") return json({ ready: true });
    if (path === "/api/state") return json({ error: { code: "TODO_LIST_SESSIONS", message: "Implement listSessions" } }, false);
    if (path === "/api/search/status") return json(status);
    throw new Error(path);
  });
  await ui.run("perform(refresh)");
  assert.match(ui.get("exercise-title").textContent, /Exercise 1/);
  assert.match(ui.get("semantic-status").textContent, /Built-in meaning search ready on Site A/);
  assert.match(ui.get("semantic-model").textContent, /local-embed.*sha256:test.*768/);
  assert.match(ui.get("semantic-catalog").textContent, /216 published schedule entries/);
  ui.get("semantic-query").value = "running AI locally";
  await ui.get("semantic-query").emit("input");
  assert.equal(ui.get("semantic-submit").disabled, false);
  assert.equal(ui.get("semantic-day").children[1].value, "2026-10-20");
});

test("core health failure does not prevent built-in readiness; failed readiness is scoped to search", async () => {
  const ui = browser(async (path) => {
    if (path === "/api/config") return json(config);
    if (path === "/api/health") return json({ error: { code: "DATABASE_UNAVAILABLE", message: "Database down" } }, false);
    if (path === "/api/search/status") return json(status);
    throw new Error(path);
  });
  await ui.run("perform(refresh)");
  assert.match(ui.get("error").textContent, /DATABASE_UNAVAILABLE/);
  assert.match(ui.get("semantic-status").textContent, /ready on Site A/);
});

test("a slow optional readiness probe does not hold core refresh or favorite controls busy", async () => {
  const pending = deferred();
  const ui = browser(async (path) => {
    if (path === "/api/config") return json(config);
    if (path === "/api/health") return json({ ready: true });
    if (path === "/api/state") return json(planner);
    if (path === "/api/search/status") return pending.promise;
    throw new Error(path);
  });
  await ui.run("perform(refresh)");
  assert.equal(ui.run("busy"), false);
  assert.equal(ui.get("refresh").disabled, false);
  assert.equal(ui.get("sessions").children.length, 1);
  assert.equal(ui.descendants(ui.get("sessions")).find((element) => element.tagName === "button").disabled, false);
  assert.equal(ui.run("semantic.checking"), true);
  pending.resolve(json(status));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.get("semantic-status").textContent, /ready on Site A/);
});

test("disabled, unseeded and missing-model statuses stay visible and can retry safely", async () => {
  for (const unavailable of [
    { enabled: false, code: "SEARCH_DISABLED", message: "Optional showcase disabled." },
    { enabled: true, code: "SEARCH_NOT_PREPARED", message: "No seeded vectors for this target." },
    { enabled: true, code: "MODEL_UNAVAILABLE", message: "Embedding model not installed." },
  ]) {
    let attempt = 0;
    const ui = browser(async () => json(attempt++ ? status : { ...status, ...unavailable, ready: false }));
    await ui.run("loadSemanticStatus()");
    assert.equal(ui.get("semantic-submit").disabled, true);
    assert.match(ui.get("semantic-status").textContent, new RegExp(unavailable.code));
    assert.equal(ui.get("semantic-retry").disabled, false);
    ui.get("semantic-query").value = "local AI";
    await ui.get("semantic-retry").emit("click");
    assert.equal(ui.get("semantic-submit").disabled, false);
  }
  const ui = browser(async () => json({ error: { code: "EMBEDDING_UNAVAILABLE", message: "Service down" } }, false));
  await ui.run("loadSemanticStatus()");
  assert.match(ui.get("semantic-status").textContent, /EMBEDDING_UNAVAILABLE.*No keyword fallback/);
  assert.equal(ui.get("semantic-retry").disabled, false);
});

test("semantic query is a token-protected POST with bounded limit and independent validated filters", async () => {
  const ui = browser();
  await ui.run("loadSemanticStatus()");
  ui.get("search").value = "keyword stays here";
  ui.get("day").value = "2026-10-19";
  ui.get("semantic-query").value = "  running AI locally  ";
  ui.get("semantic-day").value = "2026-10-20";
  ui.get("semantic-track").value = "AI";
  await ui.get("semantic-form").emit("submit");
  const request = ui.calls.find(({ path }) => path === "/api/search");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["X-Workshop-Token"], "test-token");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { target: "local", query: "running AI locally", limit: 5, day: "2026-10-20", track: "AI" });
  assert.equal(ui.get("search").value, "keyword stays here");
  assert.equal(ui.get("day").value, "2026-10-19");
  assert.match(ui.text("semantic-results"), /Rank 1 \/ Cosine similarity: 0.723/);
  assert.doesNotMatch(ui.text("semantic-results"), /72.3%|confidence/);
  assert.match(ui.text("semantic-results"), /Room 1/);
  assert.deepEqual(JSON.parse(ui.get("semantic-inspector-json").textContent), response.inspector);
  assert.equal(ui.get("semantic-inspector").hidden, false);
  assert.equal(ui.get("semantic-results").attributes["aria-busy"], "false");
});

test("blank, overlong and forged filters never dispatch a search; prompt chips only fill the query", async () => {
  const ui = browser();
  await ui.run("loadSemanticStatus()");
  for (const query of ["  ", "x".repeat(501)]) {
    ui.get("semantic-query").value = query;
    await ui.run("searchByMeaning()");
    assert.match(ui.get("semantic-message").textContent, /1 to 500/);
  }
  await ui.get("semantic-chip-security").emit("click");
  assert.equal(ui.get("semantic-query").value, "securing software supply chains");
  assert.equal(ui.get("semantic-query").focused, true);
  ui.get("semantic-track").value = "not a catalog track";
  await ui.run("searchByMeaning()");
  assert.match(ui.get("semantic-message").textContent, /available search filters/);
  assert.equal(ui.calls.filter(({ path }) => path === "/api/search").length, 0);
});

test("cancel aborts cold searches and ignores late replies even when fetch ignores abort", async () => {
  const pending = deferred();
  const ui = browser(async (path) => path === "/api/search/status" ? json(status) : pending.promise);
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "local AI";
  const search = ui.run("searchByMeaning()");
  assert.match(ui.get("semantic-message").textContent, /30 seconds/);
  assert.equal(ui.get("semantic-cancel").disabled, false);
  assert.equal(ui.get("semantic-submit").disabled, true);
  assert.equal(ui.run("busy"), false, "semantic latency must not hold the core action lock");
  const request = ui.calls.at(-1);
  await ui.get("semantic-cancel").emit("click");
  assert.equal(request.options.signal.aborted, true);
  pending.resolve(json(response));
  await search;
  assert.equal(ui.get("semantic-results").children.length, 0);
  assert.equal(ui.get("semantic-inspector-json").textContent, "");
  assert.match(ui.get("semantic-message").textContent, /canceled/);
});

test("editing query or filters clears old results and ignores old errors after a newer search", async () => {
  const old = deferred();
  let searches = 0;
  const ui = browser(async (path) => path === "/api/search/status" ? json(status) : (++searches === 1 ? old.promise : json(response)));
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "old query";
  const first = ui.run("searchByMeaning()");
  ui.get("semantic-query").value = "new query";
  await ui.get("semantic-query").emit("input");
  await ui.run("searchByMeaning()");
  old.resolve(json({ error: { code: "OLD_FAILURE", message: "Ignore me" } }, false));
  await first;
  assert.match(ui.get("semantic-message").textContent, /1 ranked match/);
  assert.equal(ui.get("semantic-results").children.length, 1);
  await ui.get("semantic-day").emit("change");
  assert.equal(ui.get("semantic-results").children.length, 0);
  assert.equal(ui.get("semantic-inspector").hidden, true);
});

test("switching targets aborts search and pending status and clears old results immediately", async () => {
  const pendingSearch = deferred();
  const ui = browser(async (path) => {
    if (path === "/api/search/status") return json(status);
    if (path === "/api/search") return pendingSearch.promise;
    if (path === "/api/target") return json({ error: { code: "TARGET_UNAVAILABLE", message: "Cannot switch" } }, false);
    throw new Error(path);
  });
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "local AI";
  const running = ui.run("searchByMeaning()");
  const signal = ui.calls.at(-1).options.signal;
  ui.get("target-select").value = "cloud";
  await ui.get("switch-target").emit("click");
  assert.equal(signal.aborted, true);
  pendingSearch.resolve(json(response));
  await running;
  assert.equal(ui.get("semantic-results").children.length, 0);
  assert.equal(ui.get("semantic-submit").disabled, true);
  assert.equal(ui.get("semantic-retry").disabled, false);
  assert.equal(ui.get("semantic-query").value, "");

  const pendingStatus = deferred();
  const statusUi = browser(async () => pendingStatus.promise);
  const checking = statusUi.run("loadSemanticStatus()");
  const statusSignal = statusUi.calls.at(-1).options.signal;
  statusUi.run('resetSemanticTarget(); config.target = "cloud"');
  pendingStatus.resolve(json(status));
  await checking;
  assert.equal(statusSignal.aborted, true);
  assert.equal(statusUi.run("semantic.status"), undefined);
  assert.doesNotMatch(statusUi.get("semantic-status").textContent, /ready on Site A/);
});

test("cross-tab target mismatch never renders results, and unavailable searches never fall back", async () => {
  for (const reply of [
    json({ ...response, target: "cloud" }),
    json({ error: { code: "EMBEDDING_UNAVAILABLE", message: "No model connection" } }, false),
  ]) {
    const ui = browser(async (path) => path === "/api/search/status" ? json(status) : reply);
    await ui.run("loadSemanticStatus()");
    ui.get("semantic-query").value = "local AI";
    await ui.run("searchByMeaning()");
    assert.match(ui.get("semantic-message").textContent, /No keyword fallback was used/);
    assert.equal(ui.get("semantic-results").children.length, 0);
    assert.equal(ui.get("semantic-inspector").hidden, true);
    assert.deepEqual(ui.calls.map(({ path }) => path), ["/api/search/status", "/api/search"]);
  }
});

test("empty semantic results explain the cutoff rather than inventing a recommendation", async () => {
  const ui = browser(async (path) => json(path === "/api/search/status" ? status : { ...response, results: [] }));
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "something unrelated";
  await ui.run("searchByMeaning()");
  assert.match(ui.get("semantic-message").textContent, /No sessions met the semantic cutoff/);
  assert.equal(ui.get("semantic-results").children.length, 0);
  assert.equal(ui.get("semantic-inspector").hidden, false);
});

test("untrusted metadata and inspector JSON are text-only and unsafe source URLs are omitted", async () => {
  const attack = '<img src=x onerror="alert(1)">';
  const unsafe = structuredClone(response);
  unsafe.results[0].session.title = attack;
  unsafe.results[0].session.url = "javascript:alert(1)";
  unsafe.results[0].evidence.title = attack;
  unsafe.inspector.pipeline = [{ $match: { title: attack } }];
  const ui = browser(async (path) => json(path === "/api/search/status" ? status : unsafe));
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "metadata";
  await ui.run("searchByMeaning()");
  assert.ok(ui.text("semantic-results").includes(attack));
  assert.equal(JSON.parse(ui.get("semantic-inspector-json").textContent).pipeline[0].$match.title, attack);
  assert.equal(ui.descendants(ui.get("semantic-results")).some((element) => element.tagName === "a"), false);
});

test("semantic favorite action uses core TODO 2 endpoint; never writes a database directly", async () => {
  const ui = browser(async (path) => {
    if (path === "/api/search/status") return json(status);
    if (path === "/api/search") return json(response);
    if (path === "/api/favorites") return json({ error: { code: "TODO_SAVE_FAVORITE", message: "Implement saveFavorite" } }, false);
    throw new Error(path);
  });
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "local AI";
  await ui.run("searchByMeaning()");
  const button = ui.descendants(ui.get("semantic-results")).find((element) => element.tagName === "button");
  await button.emit("click");
  const favorite = ui.calls.at(-1);
  assert.equal(favorite.path, "/api/favorites");
  assert.equal(favorite.options.method, "POST");
  assert.deepEqual(JSON.parse(favorite.options.body), { target: "local", sessionId: "session-1" });
  assert.match(ui.get("exercise-title").textContent, /Exercise 2/);
  assert.match(ui.get("exercise-help").textContent, /saveFavorite/);
  assert.equal(ui.get("semantic-results").children.length, 1);
  ui.run('config.target = "cloud"');
  const count = ui.calls.length;
  await button.emit("click");
  assert.equal(ui.calls.length, count, "a detached stale-target card cannot save");
});

test("confirmed saves remain usable in built-in cards when TODO 1 still blocks core state", async () => {
  const ui = browser(async (path) => {
    if (path === "/api/search/status") return json(status);
    if (path === "/api/search") return json(response);
    if (path === "/api/favorites") return json({ ok: true });
    if (path === "/api/state") return json({ error: { code: "TODO_LIST_SESSIONS", message: "Implement listSessions" } }, false);
    throw new Error(path);
  });
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "local AI";
  await ui.run("searchByMeaning()");
  const button = () => ui.descendants(ui.get("semantic-results")).find((element) => element.tagName === "button");
  await button().emit("click");
  assert.match(ui.get("message").textContent, /Favorite saved/);
  assert.equal(button().textContent, "Remove favorite");
  assert.match(ui.get("exercise-title").textContent, /Exercise 1/);
  await button().emit("click");
  assert.equal(button().textContent, "Save favorite");
  assert.match(ui.get("message").textContent, /Removed from the active database only/);
  ui.run("resetSemanticTarget()");
  assert.equal(ui.run("semantic.confirmedFavorites.size"), 0);
});

test("successful core favorites rerender both surfaces, preserving remove, keyword and copy selection behavior", async () => {
  let saved = false;
  const ui = browser(async (path, options) => {
    if (path === "/api/search/status") return json(status);
    if (path === "/api/search") return json(response);
    if (path === "/api/favorites") { saved = options.method === "POST"; return json({ ok: true }); }
    if (path === "/api/state") return json({ ...planner, favorites: saved ? [session.id] : [] });
    throw new Error(path);
  });
  ui.run(`state = ${JSON.stringify(planner)}; render()`);
  await ui.run("loadSemanticStatus()");
  ui.get("semantic-query").value = "local AI";
  await ui.run("searchByMeaning()");
  const favoriteButton = (id) => ui.descendants(ui.get(id)).find((element) => element.tagName === "button");
  await favoriteButton("semantic-results").emit("click");
  assert.equal(favoriteButton("semantic-results").textContent, "Remove favorite");
  assert.equal(favoriteButton("sessions").textContent, "Remove favorite");
  assert.equal(ui.get("favorites").children.length, 1);
  assert.equal(ui.get("export").disabled, false);
  ui.run('selected.add("session-1"); controls()');
  assert.equal(ui.get("copy").disabled, false);
  ui.get("search").value = "not in title, track, or room";
  await ui.get("search").emit("input");
  assert.equal(ui.get("sessions").children.length, 0);
  assert.equal(ui.get("semantic-results").children.length, 1);
  await favoriteButton("semantic-results").emit("click");
  assert.equal(favoriteButton("semantic-results").textContent, "Save favorite");
  assert.equal(ui.get("favorites").children.length, 0);
  assert.equal(ui.get("copy").disabled, true);
  assert.equal(ui.get("export").disabled, true);
});
