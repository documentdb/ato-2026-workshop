import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// These are packaging/scope guards, not substitutes for the live outage test.
test("live reconnect harness owns a fresh project and never targets an attendee stack", async () => {
  const source = await readFile(new URL("../scripts/test-reconnect.mjs", import.meta.url), "utf8");
  assert.match(source, /const project = `ato-reconnect-\$\{randomUUID\(\)/);
  assert.match(source, /"--project-name", project/);
  assert.match(source, /"--env-file", join\(directory, "\.env"\)/);
  assert.match(source, /await setup\(directory, \{\},/);
  assert.match(source, /delete env\[key\]/);
  assert.match(source, /127\.0\.0\.1::3000/);
  assert.match(source, /if \(owned\)/);
  assert.match(source, /\[\.\.\.base, "down", "--volumes"/);
  assert.doesNotMatch(source, /system.*prune|volume.*prune|docker.*kill.*\$\(/);
  assert.match(source, /await appIdentity\(\), identity/);
  assert.match(source, /waiter\.result/);
  assert.match(source, /assert\.deepEqual\(await snapshot\(\), before\)/);
});

test("interruptions share cancellable work and verified, signal-resistant owned cleanup", async () => {
  const source = await readFile(new URL("../scripts/test-reconnect.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.on\("SIGINT", onSignal\)/);
  assert.match(source, /process\.on\("SIGTERM", onSignal\)/);
  assert.match(source, /AbortSignal\.any\(\[interrupted\.signal, AbortSignal\.timeout\(20000\)\]\)/);
  assert.match(source, /return cleanupPromise \|\|=/);
  assert.match(source, /if \(!running\.cleanup\) running\.cancel\(\)/);
  assert.match(source, /child\.kill\("SIGKILL"\), 5000/);
  assert.match(source, /await Promise\.all\(pending\.map/);
  assert.match(source, /assert\.ok\(cleanup\.ok && empty/);
  const cleanup = source.slice(source.indexOf("function cleanupOwned()"));
  for (const command of ['["ps", "-aq"]', '["volume", "ls", "-q"]', '["network", "ls", "-q"]']) {
    assert.ok(cleanup.includes(command));
  }
  assert.ok(cleanup.indexOf("cleanup.ok && empty") < cleanup.indexOf("await rm(directory"));
  assert.match(cleanup, /OWN_PROJECT_CLEANUP_FAILED/);
});

test("runtime image includes all live harness fixtures and optional exercises", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  for (const directory of ["src", "scripts", "test", "examples", "exercises", "data"]) {
    assert.ok(dockerfile.includes(`COPY --chown=node:node ${directory} ./${directory}`));
  }
  // Root-only docs checks must stay separate: Docker intentionally omits docs.
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.test, "node --test test/*.test.js");
  assert.equal(pkg.scripts["test:docs"], "node scripts/check-doc-links.mjs");
});

test("persistent guide and calendar links keep accessible labels and safe new-tab navigation", async () => {
  const html = await readFile(new URL("../src/public/index.html", import.meta.url), "utf8");
  assert.match(html, /Attendee guide \(opens new tab\)/);
  assert.match(html, /Google Calendar \/ Apple Calendar import steps/);
  assert.match(html, /id="exercise" role="status" aria-labelledby="exercise-title"/);
  assert.match(html, /id="error" role="alert"/);
  assert.match(html, /id="status" role="status"/);
  for (const [, anchor] of html.matchAll(/(<a\s[^>]+)>/g)) {
    if (anchor.includes('target="_blank"')) assert.ok(anchor.includes('rel="noopener noreferrer"'));
  }
});
