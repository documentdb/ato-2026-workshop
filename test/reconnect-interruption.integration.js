// Opt-in Docker-host test; NOT part of offline npm test or the app container's
// database suite. Every subprocess creates its own random project and .env.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`${signal} routes through owned cleanup; a repeated signal cannot interrupt cleanup`, { timeout: 780000 }, async () => {
    const child = spawn(process.execPath, ["scripts/test-reconnect.mjs"], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"],
    });
    const events = [];
    let ownership;
    let repeated = false;
    let timedOut = false;
    let force;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      force = setTimeout(() => child.kill("SIGKILL"), 180000);
    }, 600000);
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, exitSignal) => resolve({ code, exitSignal }));
    });
    // Only parsed harness receipts, never raw child/driver/Compose output.
    const read = async (stream) => {
      for await (const line of createInterface({ input: stream })) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        events.push(event);
        if (event.check === "owned-ephemeral-project-ready") {
          ownership = event;
          child.kill(signal);
        }
        if (event.event === "owned-cleanup-started" && ownership) {
          repeated = child.kill(signal);
        }
      }
    };
    try {
      const readers = Promise.all([read(child.stdout), read(child.stderr)]);
      const result = await closed;
      await readers;
      assert.equal(timedOut, false, "Harness did not reach its owned-project checkpoint within the startup budget");
      assert.ok(ownership, "No owned-project receipt");
      assert.match(ownership.project, /^ato-reconnect-[a-f0-9]{32}$/);
      assert.equal(repeated, true, "Did not send a second signal during cleanup");
      assert.equal(result.exitSignal, null, "Harness exited via default signal termination instead of cleanup");
      assert.equal(result.code, signal === "SIGINT" ? 130 : 143);
      assert.ok(!events.some(({ error }) => error === "OWN_PROJECT_CLEANUP_FAILED"), "Harness reported cleanup failure");
      const cleaned = events.find(({ check }) => check === "only-owned-ephemeral-project-cleaned");
      assert.equal(cleaned?.project, ownership.project);
      assert.equal(cleaned?.privateDirectoryRemoved, true);
      for (const list of [["ps", "-aq"], ["volume", "ls", "-q"], ["network", "ls", "-q"]]) {
        // Independently verify every resource family, narrowly by the generated
        // project label. This test does not adopt/delete any pre-existing stack.
        const { stdout } = await execute("docker", [...list, "--filter", `label=com.docker.compose.project=${ownership.project}`], { timeout: 15000 });
        assert.equal(stdout.trim(), "", "Owned resources remain after interruption");
      }
      await assert.rejects(access(ownership.privateDirectory), { code: "ENOENT" });
      console.log(JSON.stringify({ check: "signal-cleanup-independently-verified", signal, project: ownership.project,
        containers: 0, volumes: 0, networks: 0, privateDirectoryRemoved: true, exitCode: result.code }));
    } finally {
      clearTimeout(timer); clearTimeout(force);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  });
}
