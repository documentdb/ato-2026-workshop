// Offline subprocess tests: real OS signals and child processes, fake Docker and
// model registry. These prove lifecycle handling, not live Docker/model behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { runCommand } from "../scripts/search-prepare.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = '{"schemaVersion":2,"mediaType":"application/vnd.docker.distribution.manifest.v2+json","config":{"mediaType":"application/vnd.docker.container.image.v1+json","digest":"sha256:31df23ea7daa448f9ccdbbcecce6c14689c8552222b80defd3830707c0139d4f","size":420},"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:970aa74c0a90ef7482477cf803618e776e173c007bf957f635f1015bfcfef0e6","size":274290656},{"mediaType":"application/vnd.ollama.image.license","digest":"sha256:c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4","size":11357},{"mediaType":"application/vnd.ollama.image.params","digest":"sha256:ce4a164fc04605703b485251fe9f1a181688ba0eb6badb80cc6335c0de17ca0d","size":17}]}';

async function fixture(t, mode, automatic = false) {
  const directory = await mkdtemp(join(tmpdir(), "search-interruption-"));
  const commands = join(directory, "commands.jsonl");
  const stateFile = join(directory, "running");
  const reached = join(directory, "reached");
  const cleaned = join(directory, "cleaning");
  await writeFile(stateFile, "false");
  await mkdir(join(directory, "scripts"));
  // The orchestrator really launches a subprocess; core is a local fake here,
  // never real setup/credentials/database Docker calls.
  await writeFile(join(directory, "scripts/workspace-start.mjs"), `
    import { writeFileSync } from 'node:fs';
    if(process.env.TEST_MODE==='core') { writeFileSync(process.env.TEST_REACHED,'core');setInterval(()=>{},1000); }
    else if(process.env.TEST_MODE==='core-failure') process.exitCode=7;
    else console.log('FAKE-CORE-COMPLETED');
  `);
  const bootstrap = join(directory, "registry.mjs");
  await writeFile(bootstrap, `import { writeFileSync } from 'node:fs';
const mode=process.env.TEST_MODE;
process.chdir(process.env.TEST_DIRECTORY);
globalThis.fetch=async (_url, {signal})=>{
  if(mode==='cached') throw new Error('Unexpected external registry fetch on cache hit');
  if(mode==='manifest') {
    writeFileSync(process.env.TEST_REACHED,'manifest');
    return new Promise((_,reject)=>{const timer=setInterval(()=>{},1000); signal.addEventListener('abort',()=>{clearInterval(timer);reject(signal.reason)},{once:true})});
  }
  if(mode==='manifest-body') return new Response(new ReadableStream({start(controller){
    writeFileSync(process.env.TEST_REACHED,'manifest-body');
    const timer=setInterval(()=>{},1000);
    signal.addEventListener('abort',()=>{clearInterval(timer);controller.error(signal.reason)},{once:true});
  }}));
  return new Response(${JSON.stringify(manifest)});
};
`);
  await writeFile(join(directory, "docker"), `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const mode=process.env.TEST_MODE;
fs.appendFileSync(process.env.TEST_COMMANDS,JSON.stringify(args)+'\\n');
const has=x=>args.includes(x), output=x=>console.log(x), write=x=>fs.writeFileSync(process.env.TEST_STATE,String(x));
if(args[0]==='context') output('offline-context');
else if(has('cat')&&mode==='cached') process.stdout.write(${JSON.stringify(manifest)});
else if(has('config')) output(JSON.stringify({name:'offline-project',private:'PRIVATE-CONFIG-CREDENTIAL-DO-NOT-LOG'}));
else if(has('up')&&has('search-download')) {write(true);if(mode==='startup'){fs.writeFileSync(process.env.TEST_REACHED,'startup');setInterval(()=>{},1000);}}
else if(has('list')) {if(mode==='cache-readiness'||(mode==='readiness'&&has('search-download'))){fs.writeFileSync(process.env.TEST_REACHED,'readiness');setInterval(()=>{},1000);}}
else if(has('pull')) {
 if(mode==='pull'||mode==='signal-cleanup-failure'){fs.writeFileSync(process.env.TEST_REACHED,'pull');setInterval(()=>{},1000);}
 else if(mode==='pull-failure') process.exitCode=7;
}
else if(has('stop')&&has('search-download')) {
 fs.writeFileSync(process.env.TEST_CLEANING,'yes');
 // Keep cleanup alive long enough to deliver a second signal to the parent.
 setTimeout(()=>{
  if(mode==='cleanup-failure'||mode==='signal-cleanup-failure') {console.error('PRIVATE-DAEMON-DETAIL-DO-NOT-LOG');process.exitCode=7;}
  else if(mode!=='still-running') write(false);
 },300);
}
else if(has('ps')) output('aaaaaaaaaaaa');
else if(has('inspect')) {const running=fs.readFileSync(process.env.TEST_STATE,'utf8')==='true';output(JSON.stringify({Running:running,Restarting:false,Paused:false,Status:running?'running':'exited'}));}
`, { mode: 0o700 });
  const child = spawn(process.execPath, ["--import", bootstrap, join(root, automatic ? "scripts/codespace-start.mjs" : "scripts/search-prepare.mjs"), ...(automatic ? [] : ["--local-sites"])], {
    cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DOCKER_HOST: mode === "host-override" ? "tcp://PRIVATE-DOCKER-HOST:2375" : "", DOCKER_CONTEXT: "", PATH: `${directory}:${process.env.PATH}`, TEST_MODE: mode, TEST_DIRECTORY: directory, TEST_COMMANDS: commands, TEST_STATE: stateFile, TEST_REACHED: reached, TEST_CLEANING: cleaned },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let exited = false;
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  t.after(async () => {
    clearTimeout(timeout);
    if (!exited) { child.kill("SIGKILL"); await done; }
    await rm(directory, { recursive: true, force: true });
  });
  const waitFile = async (path) => {
    for (let i = 0; i < 200; i++) {
      try { await readFile(path); return; } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (exited) assert.fail(`subprocess exited before lifecycle checkpoint: ${output}`);
      await sleep(20);
    }
    assert.fail("subprocess did not reach lifecycle checkpoint");
  };
  const commandList = async () => {
    try { return (await readFile(commands, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  const sendGroupSignal = (signal) => {
    if (process.platform === "win32") return child.kill(signal);
    process.kill(-child.pid, signal);
    return true;
  };
  return { child, done, waitFile, reached, cleaned, commandList, sendGroupSignal,
    output: () => output, running: () => readFile(stateFile, "utf8") };
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  for (const phase of ["manifest", "manifest-body", "cache-readiness", "startup", "readiness", "pull"]) {
    test(`${signal} during ${phase}: cancel, reconcile downloader, never index; repeated signal cannot interrupt cleanup`, { timeout: 20000 }, async (t) => {
      const run = await fixture(t, phase);
      await run.waitFile(run.reached);
      assert.equal(run.sendGroupSignal(signal), true);
      if (!["manifest", "manifest-body", "cache-readiness"].includes(phase)) {
        await run.waitFile(run.cleaned);
        assert.equal(run.sendGroupSignal(signal === "SIGINT" ? "SIGTERM" : "SIGINT"), true);
      }
      assert.deepEqual(await run.done, { code: signal === "SIGINT" ? 130 : 143, signal: null });
      const commands = await run.commandList();
      assert.ok(commands.every((args) => !args.includes("scripts/search-index.mjs")));
      assert.ok(commands.every((args) => !(args.includes("up") && args.includes("app"))));
      assert.equal(await run.running(), "false");
      if (["manifest", "manifest-body", "cache-readiness"].includes(phase)) assert.ok(commands.every((args) => !args.includes("search-download")));
      else {
        assert.match(run.output(), /"event":"search-download-stopped".*"verified":true/);
        assert.ok(commands.some((args) => args.includes("inspect")));
        for (const args of commands.filter((args) => (args.includes("stop") && args.includes("search-download")) || args.includes("ps") || args.includes("inspect"))) {
          assert.deepEqual(args.slice(0, 2), ["--context", "offline-context"]);
          if (args.includes("stop")) assert.ok(args.includes("offline-project") && args.at(-1) === "search-download");
          assert.ok(!args.includes("down") && !args.includes("--volumes") && !args.includes("rm"));
        }
      }
      assert.doesNotMatch(run.output(), /PRIVATE-CONFIG|PRIVATE-DAEMON|"status":"ready"/);
    });
  }
}

for (const [mode, expected] of [["success", 0], ["pull-failure", 1], ["cleanup-failure", 1], ["still-running", 1]]) {
  test(`subprocess ${mode}: explicit outcome and no indexing before verified cleanup`, { timeout: 20000 }, async (t) => {
    const run = await fixture(t, mode);
    assert.deepEqual(await run.done, { code: expected, signal: null });
    const commands = await run.commandList();
    const indexes = commands.filter((args) => args.includes("scripts/search-index.mjs"));
    if (mode === "success") {
      assert.deepEqual(indexes.map((args) => args.at(-1)), ["local", "site-b"]);
      assert.match(run.output(), /"status":"ready"/);
    } else assert.deepEqual(indexes, []);
    if (["cleanup-failure", "still-running"].includes(mode)) {
      assert.match(run.output(), /SEARCH_DOWNLOAD_CLEANUP_FAILED.*offline-project.*offline-context/);
      assert.doesNotMatch(run.output(), /"event":"search-download-stopped"/);
      assert.equal(await run.running(), "true"); // Fake resource intentionally persists to verify the honest failure path.
    } else {
      assert.match(run.output(), /"event":"search-download-stopped"/);
      assert.equal(await run.running(), "false");
    }
    assert.doesNotMatch(run.output(), /PRIVATE-CONFIG|PRIVATE-DAEMON/);
  });
}

test("signal followed by cleanup failure exits nonzero with recovery context, not a successful cleanup receipt", { timeout: 20000 }, async (t) => {
  const run = await fixture(t, "signal-cleanup-failure");
  await run.waitFile(run.reached);
  run.child.kill("SIGINT");
  await run.waitFile(run.cleaned);
  run.child.kill("SIGTERM");
  assert.deepEqual(await run.done, { code: 1, signal: null });
  assert.match(run.output(), /SEARCH_DOWNLOAD_CLEANUP_FAILED.*offline-project.*offline-context/);
  assert.doesNotMatch(run.output(), /"event":"search-download-stopped"|"status":"ready"|PRIVATE-DAEMON/);
  assert.ok((await run.commandList()).every((args) => !args.includes("scripts/search-index.mjs")));
});

test("async runner deadline cancels and waits for child closure", { timeout: 5000 }, async () => {
  const result = await runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 50, capture: true });
  assert.equal(result.cancelled, true);
  assert.notEqual(result.status, 0);
});

test("async runner escalates a timed-out child that ignores SIGTERM, then settles after closure", { timeout: 6000 }, async () => {
  const result = await runCommand(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { timeout: 150, capture: true });
  assert.equal(result.cancelled, true);
  assert.equal(result.status, null);
});

test("ambiguous DOCKER_HOST override is rejected before selecting or modifying a daemon", { timeout: 5000 }, async (t) => {
  const run = await fixture(t, "host-override");
  assert.deepEqual(await run.done, { code: 1, signal: null });
  assert.deepEqual(await run.commandList(), []);
  assert.match(run.output(), /requires an explicit Docker context/);
  assert.doesNotMatch(run.output(), /PRIVATE-DOCKER-HOST/);
});


for (const [mode, expected] of [["success", 0], ["cached", 0], ["pull-failure", 0], ["cleanup-failure", 1], ["core-failure", 1]]) {
  test(`automatic CLI ${mode}: core first, explicit search outcome, no hidden cleanup failure`, { timeout: 20000 }, async (t) => {
    const run = await fixture(t, mode, true);
    assert.deepEqual(await run.done, { code: expected, signal: null });
    const commands = await run.commandList();
    if (mode === "core-failure") {
      assert.deepEqual(commands, []);
      assert.doesNotMatch(run.output(), /CORE READY/);
    } else {
      assert.match(run.output(), /FAKE-CORE-COMPLETED[\s\S]*CORE READY/);
      assert.match(run.output(), /"core":"ready"/);
      if (["success", "cached"].includes(mode)) assert.match(run.output(), /SEARCH READY/);
      else assert.doesNotMatch(run.output(), /SEARCH READY/);
      if (mode === "cached") {
        assert.match(run.output(), /"cached":true/);
        assert.ok(commands.every((args) => !args.includes("search-download") && !args.includes("pull")));
      }
      if (mode === "cleanup-failure") assert.match(run.output(), /SEARCH_DOWNLOAD_CLEANUP_FAILED/);
      assert.ok(commands.every((args) => !args.includes("down") && !args.includes("--volumes")));
    }
  });
}
for (const phase of ["core", "pull"]) for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`automatic CLI real group ${signal} during ${phase} waits for cleanup`, { timeout: 20000 }, async (t) => {
    const run = await fixture(t, phase, true);
    await run.waitFile(run.reached);
    run.sendGroupSignal(signal);
    if (phase === "pull") {
      await run.waitFile(run.cleaned);
      run.sendGroupSignal(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
    }
    assert.deepEqual(await run.done, { code: signal === "SIGINT" ? 130 : 143, signal: null });
    assert.equal(await run.running(), "false");
    assert.doesNotMatch(run.output(), /SEARCH READY/);
    assert.ok((await run.commandList()).every((args) => !args.includes("scripts/search-index.mjs")));
    if (phase === "pull") assert.match(run.output(), /"event":"search-download-stopped".*"verified":true/);
  });
}
