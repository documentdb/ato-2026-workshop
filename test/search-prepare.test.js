// Offline orchestration tests. Docker and registry responses below are mocks,
// not evidence that a model was downloaded or that vectors were executed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { checkManifest, preparationTargets, prepareSearchUnlocked as prepareSearch } from "../scripts/search-prepare.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWorkspaceLock } from "../scripts/workspace-lock.mjs";
import { prepareSearch as lockedPrepareSearch } from "../scripts/search-prepare.mjs";
import { SEARCH_MODEL } from "../src/search-model.js";

// Public registry manifest, no model weights or private source material.
const manifest = '{"schemaVersion":2,"mediaType":"application/vnd.docker.distribution.manifest.v2+json","config":{"mediaType":"application/vnd.docker.container.image.v1+json","digest":"sha256:31df23ea7daa448f9ccdbbcecce6c14689c8552222b80defd3830707c0139d4f","size":420},"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:970aa74c0a90ef7482477cf803618e776e173c007bf957f635f1015bfcfef0e6","size":274290656},{"mediaType":"application/vnd.ollama.image.license","digest":"sha256:c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4","size":11357},{"mediaType":"application/vnd.ollama.image.params","digest":"sha256:ce4a164fc04605703b485251fe9f1a181688ba0eb6badb80cc6335c0de17ca0d","size":17}]}';

function mockRun(commands, failPull = false) {
  return async (command, args, options) => {
    assert.equal(command, "docker");
    assert.ok(options.timeout <= 900000);
    commands.push(args);
    return { status: failPull && args.includes("pull") ? 1 : 0,
      stdout: args[0] === "context" ? "test-context\n" : args.includes("config") ? '{"name":"test-project"}' : "" };
  };
}

test("preparation requires explicit local targets; missing, cloud and extra arguments do nothing", async () => {
  assert.deepEqual(preparationTargets(["--local-sites"]), ["local", "site-b"]);
  assert.deepEqual(preparationTargets(["--target", "local"]), ["local"]);
  assert.deepEqual(preparationTargets(["--target", "site-b"]), ["site-b"]);
  for (const args of [[], ["--target", "cloud"], ["--target", "https://evil.invalid"], ["--local-sites", "--force"], ["--target"]]) {
    let calls = 0;
    await assert.rejects(prepareSearch(args, { run() { calls++; }, fetchImpl() { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("the public manifest must match the exact pin and the bounded asset size", () => {
  assert.equal(checkManifest(manifest), 274302450);
  for (const invalid of [manifest + "\n", manifest.replace("274290656", "274290657"), "{}", "x".repeat(64001)]) {
    assert.throws(() => checkManifest(invalid), /pinned digest/);
  }
});

test("explicit helper downloads only the embedding pin, stops downloader, then indexes exactly requested targets", async () => {
  const commands = [];
  const requests = [];
  await prepareSearch(["--local-sites"], {
    run: mockRun(commands),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return new Response(manifest); },
    log() {},
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://registry.ollama.ai/v2/library/nomic-embed-text/manifests/v1.5");
  assert.equal(requests[0].options.redirect, "error");
  const text = commands.map((args) => args.join(" ")).join("\n");
  assert.match(text, new RegExp(`ollama pull ${SEARCH_MODEL.name}`));
  assert.doesNotMatch(text, /qwen|generate|chat|cloud|prune|\bdown\b|--volumes|seed|migrate/);
  const stop = commands.findIndex((args) => args.includes("stop") && args.includes("search-download"));
  const upApp = commands.findIndex((args) => args.includes("app") && args.includes("up"));
  assert.ok(stop >= 0 && stop < upApp);
  assert.deepEqual(commands.filter((args) => args.includes("scripts/search-index.mjs")).map((args) => args.at(-1)), ["local", "site-b"]);
});

test("a failed download still stops its service and never enables/indexes the app", async () => {
  const commands = [];
  await assert.rejects(prepareSearch(["--target", "local"], {
    run: mockRun(commands, true),
    fetchImpl: async () => new Response(manifest), log() {},
  }), /bounded Docker operation failed/);
  assert.ok(commands.some((args) => args.includes("stop")));
  assert.ok(commands.at(-1).includes("ps"));
  assert.ok(commands.every((args) => !args.includes("scripts/search-index.mjs")));
});

test("failed, changed or oversized registry responses never start downloader, app or index", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), new Response("{}"), new Response("x".repeat(64001))]) {
    const commands = [];
    await assert.rejects(prepareSearch(["--local-sites"], { run: mockRun(commands), fetchImpl: async () => response, log() {} }));
    assert.ok(commands.every((args) => !args.includes("search-download") && !args.includes("app") && !args.includes("scripts/search-index.mjs")));
  }
});

test("model is optional, private, bounded and absent from core startup; optional CI is manual", async () => {
  const compose = await readFile(new URL("../compose.search.yaml", import.meta.url), "utf8");
  assert.match(compose, /profiles: \[search\]/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /mem_limit: 1g/);
  assert.match(compose, /cpus: 2/);
  assert.doesNotMatch(compose, /OLLAMA_LLM_LIBRARY:/, "do not force generic CPU over detected AVX2/AVX");
  const adapter = await readFile(new URL("../src/search-model.js", import.meta.url), "utf8");
  assert.match(adapter, /num_gpu: 0/, "CPU backend autodetection must not enable GPU inference");
  assert.match(compose, /search-model-data:\/models:ro/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  for (const path of ["../compose.yaml", "../scripts/workspace-start.mjs", "../Dockerfile"]) {
    const core = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(core, /ollama|search:prepare|search-index|SEARCH_ENABLED/);
  }
  const workflow = await readFile(new URL("../.github/workflows/semantic-search.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
});

for (const cache of ["valid", "wrong-digest", "oversize", "missing", "missing-blob", "cold-runners"]) {
  test(`cache-first preparation: ${cache}`, async () => {
    const commands = [];
    const messages = [];
    let fetches = 0;
    let downloaded = false;
    let coldProbes = 0;
    const run = async (command, args, options) => {
      const result = await mockRun(commands)(command, args, options);
      if (args.includes("pull")) downloaded = true;
      if (args.includes("search-model") && args.includes("list") && cache === "cold-runners" && !downloaded) {
        coldProbes++;
        return { status: 1 };
      }
      if (args.includes("cat")) return { status: cache === "missing" ? 1 : 0, stdout:
        cache === "wrong-digest" ? manifest + "\n" : cache === "oversize" ? manifest.replace("274290656", "474290656") : manifest };
      if (args.includes("ollama") && args.includes("show") && cache === "missing-blob") return { status: 1 };
      return result;
    };
    await prepareSearch(["--local-sites"], {
      run, pause: async () => {}, log: (message) => messages.push(message),
      fetchImpl: async () => {
        fetches++;
        assert.notEqual(cache, "valid", "valid cache must work with no external fetch/DNS");
        return new Response(manifest);
      },
    });
    const hit = cache === "valid";
    assert.equal(fetches, hit ? 0 : 1);
    assert.equal(downloaded, !hit);
    if (hit) {
      assert.ok(commands.every((args) => !args.includes("search-download") && !args.includes("pull")));
      assert.ok(commands.some((args) => args.includes("cat")));
      assert.ok(commands.some((args) => args.includes("show")));
    } else {
      const stop = commands.findIndex((args) => args.includes("stop") && args.includes("search-download"));
      const index = commands.findIndex((args) => args.includes("scripts/search-index.mjs"));
      assert.ok(stop >= 0 && index > stop);
    }
    if (cache === "cold-runners") assert.equal(coldProbes, 20);
    assert.ok(messages.some((message) => message.includes(`"cached":${hit}`)));
    assert.deepEqual(commands.filter((args) => args.includes("scripts/search-index.mjs")).map((args) => args.at(-1)), ["local", "site-b"]);
    assert.doesNotMatch(commands.map((args) => args.join(" ")).join("\n"), /embeddings|generate|chat|\bgit\b|\baz\b|--target cloud/);
  });
}

test("cache service readiness retries, then verifies full manifest rather than trusting an image/name", async () => {
  const commands = [];
  let probes = 0;
  let pauses = 0;
  await prepareSearch(["--target", "local"], {
    run: async (command, args, options) => {
      const result = await mockRun(commands)(command, args, options);
      if (args.includes("list") && ++probes < 3) return { status: 1 };
      if (args.includes("cat")) return { status: 0, stdout: manifest };
      return result;
    },
    pause: async () => { pauses++; },
    fetchImpl: () => assert.fail("no registry on verified cache"), log() {},
  });
  assert.equal(pauses, 2);
  assert.ok(commands.every((args) => !args.includes("search-download")));
});


const stoppedState = { Running: false, Restarting: false, Paused: false, Status: "exited" };
for (const [name, state] of [
  ["running", { ...stoppedState, Running: true, Status: "running" }],
  ["restarting", { ...stoppedState, Restarting: true }],
  ["paused", { ...stoppedState, Paused: true }],
  ["unknown status", { ...stoppedState, Status: "unknown" }],
  ["missing state", {}], ["null state", null],
  ["missing flags", { Running: false, Status: "exited" }],
  ["inspection error", "error"], ["malformed state", "malformed"],
  ["inventory error", "inventory-error"], ["invalid inventory", "invalid-inventory"],
  ["changing inventory", "changing-inventory"],
]) {
  test(`preflight rejects ${name} before any model/app/DB operation or registry fetch`, async () => {
    const commands = [];
    let inventories = 0;
    await assert.rejects(prepareSearch(["--local-sites"], {
      run: async (command, args, options) => {
        const result = await mockRun(commands)(command, args, options);
        if (args.includes("ps")) {
          inventories++;
          assert.ok(args.includes("label=com.docker.compose.project=test-project"));
          assert.ok(args.includes("label=com.docker.compose.service=search-download"));
          assert.deepEqual(args.slice(0, 2), ["--context", "test-context"]);
          return { status: state === "inventory-error" ? 1 : 0, stdout: state === "invalid-inventory" ? "invalid!" : state === "changing-inventory" && inventories > 1 ? "" : "aaaaaaaaaaaa" };
        }
        if (args.includes("inspect")) return { status: state === "error" ? 1 : 0, stdout: state === "malformed" ? "{" : JSON.stringify(state === "changing-inventory" ? stoppedState : state) };
        return result;
      },
      fetchImpl: () => assert.fail("no registry access before safe inventory"), log() {},
    }), { code: "SEARCH_DOWNLOAD_CLEANUP_FAILED" });
    assert.ok(commands.every((args) => !args.includes("up") && !args.includes("exec") && !args.includes("stop")));
  });
}

test("two real-lock invocations: successful pull with failed cleanup cannot become a cached ready run; scoped recovery permits cache", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "search-leftover-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const commands = [], messages = [];
  let exists = false, running = false, cached = false, fetches = 0;
  const options = {
    withLock: (operation) => withWorkspaceLock(operation, directory),
    run: async (command, args, opts) => {
      const result = await mockRun(commands)(command, args, opts);
      if (args.includes("ps")) return { status: 0, stdout: exists ? "aaaaaaaaaaaa" : "" };
      if (args.includes("inspect")) return { status: 0, stdout: JSON.stringify({ ...stoppedState, Running: running, Status: running ? "running" : "exited" }) };
      if (args.includes("up") && args.includes("search-download")) { exists = true; running = true; }
      if (args.includes("pull")) cached = true; // pull succeeds, then stop fails
      if (args.includes("stop") && args.includes("search-download")) return { status: 1 };
      if (args.includes("cat")) return { status: cached ? 0 : 1, stdout: cached ? manifest : "" };
      return result;
    },
    fetchImpl: async () => { fetches++; return new Response(manifest); },
    log: (message) => messages.push(message),
  };
  await assert.rejects(lockedPrepareSearch(["--local-sites"], options), { code: "SEARCH_DOWNLOAD_CLEANUP_FAILED" });
  assert.equal(cached, true); assert.equal(running, true); assert.equal(fetches, 1);
  await assert.rejects(stat(join(directory, ".workshop-private/startup.lock")), { code: "ENOENT" });
  commands.length = 0; messages.length = 0;
  await assert.rejects(lockedPrepareSearch(["--local-sites"], options), { code: "SEARCH_DOWNLOAD_CLEANUP_FAILED" });
  assert.equal(fetches, 1);
  assert.ok(commands.every((args) => !args.includes("up") && !args.includes("exec") && !args.includes("stop")));
  assert.ok(!messages.some((message) => message.includes('"status":"ready"')));
  // Simulated explicit scoped operator recovery, not an automatic global stop.
  running = false; commands.length = 0; messages.length = 0;
  await lockedPrepareSearch(["--local-sites"], options);
  assert.equal(fetches, 1);
  assert.ok(commands.some((args) => args.includes("inspect")));
  assert.ok(commands.every((args) => !args.includes("search-download") && !args.includes("pull")));
  assert.ok(messages.some((message) => message.includes('"cached":true')));
  await assert.rejects(stat(join(directory, ".workshop-private/startup.lock")), { code: "ENOENT" });
});
