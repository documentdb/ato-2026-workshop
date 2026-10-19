// Host-side, opt-in live regression. NEVER points at an existing workshop stack.
// Requires Docker Compose >=2.24.4 (!override). Generates its own private .env,
// project name, random loopback port and volumes; cleanup selects that project.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setup } from "./setup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `ato-reconnect-${randomUUID().replaceAll("-", "")}`;
// Install handlers before the first asynchronous work, including private setup.
const interrupted = new AbortController();
let receivedSignal;
const children = new Set();
const onSignal = (signal) => {
  receivedSignal ||= signal;
  interrupted.abort(new Error("Harness interrupted"));
  // Cleanup commands are deliberately immune to repeated signals. Their own
  // deadlines still apply; killing cleanup would recreate the original leak.
  for (const running of children) if (!running.cleanup) running.cancel();
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
const directory = await mkdtemp(join(tmpdir(), "ato-reconnect-"));
const override = join(directory, "compose.reconnect.yaml");
// Preserve only ordinary runtime environment; explicitly override interpolation
// inputs that could otherwise choose a host port, mode or private forwarding host.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(COMPOSE_|WORKSHOP_|DOCUMENTDB_|SITE_A_|SITE_B_|LOCAL_|CLOUD_)/.test(key) || key === "ACTIVE_TARGET") delete env[key];
}
Object.assign(env, { COMPOSE_PROJECT_NAME: project, WORKSHOP_PORT: "3000",
  WORKSHOP_MODE: "complete", WORKSHOP_SCENARIO: "attendee", WORKSHOP_PUBLIC_HOST: "",
  LOCAL_DATABASE_NAME: "reconnect_a", SITE_B_DATABASE_NAME: "reconnect_b" });
const base = ["compose", "--project-name", project, "--project-directory", root,
  "--env-file", join(directory, ".env"), "-f", join(root, "compose.yaml"),
  "-f", join(root, "compose.complete.yaml"), "-f", override];
function command(args, { timeout = 300000, input = "ignore", cleanup = false } = {}) {
  if (!cleanup) interrupted.signal.throwIfAborted();
  const child = spawn("docker", args, { cwd: root, env, stdio: [input, "pipe", "pipe"] });
  let stdout = "";
  let forceTimer;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    child.kill("SIGTERM");
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  const running = { child, cleanup, cancel };
  children.add(running);
  // Capture no stderr: compose/build/driver failures can contain private values.
  child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2000000) cancel(); });
  child.stderr.resume();
  // Closing a cancelled interactive pipe can race a probe's next write.
  child.stdin?.on("error", () => cancel());
  const timer = setTimeout(cancel, timeout);
  running.result = new Promise((resolve) => {
    // A spawn error is followed by close; wait for close before cleanup so a
    // cancelled Compose process cannot still create resources after down.
    child.once("error", () => { cancelled = true; });
    child.once("close", (code) => {
      clearTimeout(timer); clearTimeout(forceTimer); children.delete(running);
      resolve({ ok: code === 0 && !cancelled, stdout });
    });
  });
  return running;
}
const request = (url, options = {}) => fetch(url, {
  ...options, signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(20000)]),
});
async function run(args, options) {
  const result = await command([...base, ...args], options).result;
  interrupted.signal.throwIfAborted();
  assert.ok(result.ok, "Scoped Compose command failed (raw output suppressed)");
  return result.stdout.trim();
}
const exec = (...args) => run(["exec", "-T", "app", ...args]);
const receipt = (check, details = {}) => console.log(JSON.stringify({ check, passed: true, ...details }));
let owned = false;
let cleanupPromise;
let probe;
let failure = false;
let phase = "ownership-and-startup";
try {
  // An existing project, however unlikely, must never be adopted or cleaned up.
  for (const list of [["ps", "-aq"], ["volume", "ls", "-q"], ["network", "ls", "-q"]]) {
    const inventory = await command([...list, "--filter", `label=com.docker.compose.project=${project}`]).result;
    assert.ok(inventory.ok && !inventory.stdout.trim(), "Project ownership preflight failed");
  }
  // setup ignores ambient credentials and generates independent private values.
  await setup(directory, {}, () => {});
  // No published database ports: parallel harnesses cannot collide with the
  // attendee extension endpoints, and only the app needs host-side access.
  await writeFile(override, `services:\n  documentdb:\n    ports: !override []\n  documentdb-site-b:\n    ports: !override []\n  app:\n    init: false\n    command: ["node", "src/server.js"]\n    ports: !override\n      - "127.0.0.1::3000"\n`, { mode: 0o600 });
  owned = true;
  await run(["up", "--build", "-d", "--wait", "--wait-timeout", "240"], { timeout: 600000 });
  receipt("owned-ephemeral-project-ready", { project, privateDirectory: directory });
  for (const target of ["local", "site-b"]) {
    await exec("npm", "run", "wait:database", "--", "--target", target);
    await exec("npm", "run", "seed", "--", "--target", target);
  }
  const address = await run(["port", "app", "3000"]);
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${address}`;
  const get = async (path) => {
    const response = await request(`${origin}${path}`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await get("/api/config");
  const appId = await run(["ps", "-q", "app"]);
  const appIdentity = async () => {
    const result = await command(["inspect", "--format", "{{.State.Pid}} {{.State.StartedAt}} {{.RestartCount}}", appId]).result;
    assert.ok(result.ok);
    return result.stdout.trim();
  };
  const identity = await appIdentity(); // init:false + direct node => actual app PID
  const post = (path, body) => request(`${origin}/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Workshop-Token": initial.csrfToken },
    body: JSON.stringify(body),
  });
  const state = await get("/api/state");
  assert.equal(state.sessions.length, 216);
  assert.equal((await post("favorites", { target: "local", sessionId: state.sessions[0].id })).status, 200);
  const snapshot = async () => JSON.parse(await exec("node", "test/reconnect.probe.mjs", "snapshot"));
  const before = await snapshot();
  assert.equal(before.local.favorites, 1);
  assert.equal(before["site-b"].favorites, 0);

  probe = command([...base, "exec", "-T", "app", "node", "test/reconnect.probe.mjs"], { input: "pipe", timeout: 360000 });
  const lines = createInterface({ input: probe.child.stdout })[Symbol.asyncIterator]();
  const nextLine = async () => {
    let timer;
    let abort;
    try {
      interrupted.signal.throwIfAborted();
      const value = await Promise.race([
        lines.next(), new Promise((_, reject) => {
          abort = () => reject(interrupted.signal.reason);
          interrupted.signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => reject(new Error("Probe timeout")), 25000);
        }),
      ]);
      assert.equal(value.done, false);
      return JSON.parse(value.value);
    } finally {
      clearTimeout(timer);
      if (abort) interrupted.signal.removeEventListener("abort", abort);
    }
  };
  const probeReady = await nextLine();
  assert.equal(probeReady.ready, true);
  const acquire = async (expected) => {
    interrupted.signal.throwIfAborted();
    probe.child.stdin.write(JSON.stringify({ expected }) + "\n");
    const result = await nextLine();
    assert.equal(result.pid, probeReady.pid);
    assert.equal(result.expected, expected);
    assert.equal(result.passed, true);
  };

  phase = "first-connection-outage";
  await run(["stop", "documentdb-site-b"]);
  // Original wait process must span the outage, including its first failure.
  const waiter = command([...base, "exec", "-T", "app", "npm", "run", "wait:database", "--", "--target", "site-b"], { timeout: 270000 });
  let waiterFinished = false;
  waiter.result.then(() => { waiterFinished = true; });
  assert.equal((await post("target", { target: "local", nextTarget: "site-b" })).status, 503);
  assert.equal((await get("/api/config")).target, "local");
  assert.equal((await get("/api/state")).favorites.length, 1);
  await acquire("unavailable"); // three first acquisitions, same persistent manager
  assert.equal(waiterFinished, false);
  await run(["start", "documentdb-site-b"]);
  // Separate fresh client proves actual readiness before retrying the old ones.
  await exec("npm", "run", "wait:database", "--", "--target", "site-b");
  const waited = await waiter.result;
  assert.ok(waited.ok && /"target":"site-b","ready":true/.test(waited.stdout));
  receipt("original-wait-process-recovers-after-first-connection-failure");
  await acquire("ready");
  assert.equal((await post("target", { target: "local", nextTarget: "site-b" })).status, 200);
  assert.equal((await get("/api/state")).sessions.length, 216);
  assert.equal((await get("/api/state")).favorites.length, 0);
  assert.equal(await appIdentity(), identity);
  assert.equal((await get("/api/config")).csrfToken, initial.csrfToken);
  receipt("first-unavailable-site-b-recovers-same-app-pid-and-concurrent-client");

  phase = "healthy-client-outage";
  // Control: an already healthy client also recovers without target fallback.
  await run(["stop", "documentdb-site-b"]);
  assert.equal((await request(`${origin}/api/health`)).status, 503);
  assert.equal((await get("/api/config")).target, "site-b");
  await acquire("unavailable");
  await run(["start", "documentdb-site-b"]);
  await exec("npm", "run", "wait:database", "--", "--target", "site-b");
  await acquire("ready");
  await get("/api/health");
  assert.equal(await appIdentity(), identity);
  assert.equal((await get("/api/config")).csrfToken, initial.csrfToken);
  assert.deepEqual(await snapshot(), before);
  receipt("healthy-client-outage-recovers-same-pid-no-fallback-notebooks-unchanged");
  probe.child.stdin.end();
  assert.ok((await probe.result).ok);
  receipt("concurrent-acquisitions-close-cleanly");
} catch {
  failure = true;
  console.error(JSON.stringify({ error: receivedSignal ? "RECONNECT_REGRESSION_INTERRUPTED" : "RECONNECT_REGRESSION_FAILED",
    signal: receivedSignal, phase, message: "A bounded regression check stopped; raw command output was suppressed to protect private settings." }));
} finally {
  await cleanupOwned();
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
}
if (failure || receivedSignal) process.exitCode = receivedSignal === "SIGINT" ? 130 : receivedSignal === "SIGTERM" ? 143 : 1;

// One path for success, failed assertions, SIGINT and SIGTERM. Keep private
// configuration for manual recovery if down OR ANY inventory verification fails.
function cleanupOwned() {
  return cleanupPromise ||= (async () => {
    try {
      console.log(JSON.stringify({ event: "owned-cleanup-started", project }));
      const pending = [...children];
      for (const running of pending) running.cancel();
      await Promise.all(pending.map(({ result }) => result));
      if (owned) {
        const cleanup = await command([...base, "down", "--volumes", "--remove-orphans"], { timeout: 120000, cleanup: true }).result;
        let empty = true;
        for (const list of [["ps", "-aq"], ["volume", "ls", "-q"], ["network", "ls", "-q"]]) {
          const remaining = await command([...list, "--filter", `label=com.docker.compose.project=${project}`], { timeout: 15000, cleanup: true }).result;
          if (!remaining.ok || remaining.stdout.trim()) empty = false;
        }
        assert.ok(cleanup.ok && empty, "Owned cleanup could not be verified");
      }
      await rm(directory, { recursive: true });
      if (owned) {
        receipt("only-owned-ephemeral-project-cleaned", { project, containers: 0, volumes: 0, networks: 0, privateDirectoryRemoved: true });
      } else {
        console.log(JSON.stringify({ event: "private-setup-removed", project, privateDirectoryRemoved: true }));
      }
    } catch {
      failure = true;
      console.error(JSON.stringify({ error: "OWN_PROJECT_CLEANUP_FAILED", project, privateDirectory: directory }));
    }
  })();
}
