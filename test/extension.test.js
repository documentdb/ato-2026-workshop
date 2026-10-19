import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, chmod, mkdir, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { parsePrivateEnv, localExtensionConnections, writeExtensionConnections } from "../scripts/extension-connections.mjs";
import { checkExtensionConnections } from "../scripts/extension-check.mjs";
import { setup } from "../scripts/setup.mjs";
import { readCatalog } from "../src/catalog.js";
import { programCountsPipeline } from "../examples/complete/program-counts.js";

const settings = "DOCUMENTDB_USERNAME=workshop\nDOCUMENTDB_PASSWORD='site A: p@ss/#$literal'\nSITE_B_USERNAME=workshop_b\nSITE_B_PASSWORD=independent-secret\nLOCAL_DATABASE_NAME=custom_a\nSITE_B_DATABASE_NAME=custom_b\nCLOUD_DOCUMENTDB_URI='mongodb://cloud-user:never-export@cloud.invalid/'\n";
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), "ato-extension-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("private env parser handles generated and legacy literal quotes/comments without executing data", () => {
  const env = parsePrivateEnv(settings + "export COMMENTED = \"a\\\"b\\\\c\" # comment\nSINGLE='it\\'s literal'\nHASH=value#hash\nSPACED=value # comment\nEMPTY=\n");
  assert.equal(env.DOCUMENTDB_PASSWORD, "site A: p@ss/#$literal");
  assert.equal(env.COMMENTED, 'a"b\\c');
  assert.equal(env.SINGLE, "it's literal");
  assert.equal(env.HASH, "value#hash");
  assert.equal(env.SPACED, "value");
  assert.equal(env.EMPTY, "");
  assert.equal(parsePrivateEnv("LITERAL='$(touch should-never-execute)'\n").LITERAL, "$(touch should-never-execute)");
  for (const source of ["A=one\nA=two", "A=one\nexport A=two", "A=${ENV}", 'A="$ENV"', "A=$(command)",
    "A='unterminated", "A='one' extra", "A=two words", "A=one; command", 'A="bad\\q"', "A='first\nsecond'", "not-a-binding"]) {
    assert.throws(() => parsePrivateEnv(source), /Unsupported or duplicate/, source);
  }
});

test("connections keep all secrets OUT of the unmasked URI and use only separate loopback endpoints", () => {
  const env = parsePrivateEnv(settings);
  const connections = localExtensionConnections(env);
  assert.deepEqual(connections.map(({ port, database }) => ({ port, database })), [{ port: 10270, database: "custom_a" }, { port: 10271, database: "custom_b" }]);
  for (const connection of connections) {
    const uri = new URL(connection.uri);
    assert.equal(uri.hostname, "127.0.0.1");
    assert.equal(uri.username, ""); assert.equal(uri.password, "");
    assert.equal(uri.searchParams.get("tls"), "true");
    assert.equal(uri.searchParams.get("authSource"), "admin");
    assert.equal(uri.searchParams.get("authMechanism"), "SCRAM-SHA-256");
    assert.equal(uri.searchParams.get("directConnection"), "true");
    assert.equal(uri.searchParams.has("tlsAllowInvalidCertificates"), false, "local exception is explicitly chosen in the wizard");
    assert.doesNotMatch(connection.uri, /p@ss|independent-secret|cloud/);
  }
  assert.deepEqual(localExtensionConnections({ ...env, SITE_A_EXTENSION_PORT: "11270", SITE_B_EXTENSION_PORT: "11271" }).map(({ port }) => port), [11270, 11271]);
  for (const change of [{ DOCUMENTDB_PASSWORD: "" }, { SITE_B_PASSWORD: "" }, { SITE_B_PASSWORD: env.DOCUMENTDB_PASSWORD },
    { DOCUMENTDB_USERNAME: "<user>" }, { SITE_A_EXTENSION_PORT: "0" }, { SITE_B_EXTENSION_PORT: "65536" },
    { SITE_A_EXTENSION_PORT: "0.0.0.0:10270" }, { SITE_A_EXTENSION_PORT: "10271" }, { LOCAL_DATABASE_NAME: "bad/name" }]) {
    assert.throws(() => localExtensionConnections({ ...env, ...change }));
  }
});

test("private handoff is owner-only, atomically repeatable, excludes cloud and preserves every .env byte", async (t) => {
  const directory = await temporary(t);
  const filename = join(directory, ".env");
  await writeFile(filename, settings, { mode: 0o600 });
  const logs = [];
  const output = await writeExtensionConnections(directory, (line) => logs.push(line));
  assert.equal((await stat(join(directory, ".workshop-private"))).mode & 0o777, 0o700);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const content = await readFile(output, "utf8");
  assert.match(content, /Password \(paste only in masked prompt\): site A: p@ss\/#\$literal/);
  assert.match(content, /LOCAL TLS PROMPT \(BOTH SITES\): choose Allow invalid certificates, not Enable TLS \(default\)/);
  assert.match(content, /Keep tls=true: encryption stays on/);
  assert.match(content, /TLS\/SSL Disabled is misleading/);
  assert.match(content, /Never apply it to Azure/);
  assert.doesNotMatch(content, /never-export|cloud\.invalid/);
  assert.doesNotMatch(logs.join("\n"), /mongodb:|p@ss|independent-secret|never-export/);
  assert.equal(await writeExtensionConnections(directory, () => {}), output);
  assert.equal(await readFile(output, "utf8"), content);
  assert.equal(await readFile(filename, "utf8"), settings);
  // Errors leave both the original .env and earlier handoff intact.
  await writeFile(filename, settings + "SITE_B_PASSWORD=duplicate\n");
  await assert.rejects(writeExtensionConnections(directory, () => {}));
  assert.equal(await readFile(output, "utf8"), content);
  assert.equal(await readFile(filename, "utf8"), settings + "SITE_B_PASSWORD=duplicate\n");
});

test("generated setup credentials work and partial credentials are never repaired by the handoff", async (t) => {
  const directory = await temporary(t);
  await setup(directory, {}, () => {});
  const before = await readFile(join(directory, ".env"), "utf8");
  await writeExtensionConnections(directory, () => {});
  assert.equal(await readFile(join(directory, ".env"), "utf8"), before);
  await writeFile(join(directory, ".env"), "DOCUMENTDB_USERNAME=user\nDOCUMENTDB_PASSWORD=one\nSITE_B_USERNAME=second\n");
  await assert.rejects(writeExtensionConnections(directory, () => {}));
});

test("handoff refuses public directories/files, unknown files, symlinks and hardlinks without overwriting", async (t) => {
  const directory = await temporary(t);
  await writeFile(join(directory, ".env"), settings);
  const privateDirectory = join(directory, ".workshop-private");
  const output = join(privateDirectory, "extension-connections.txt");
  await mkdir(privateDirectory, { mode: 0o755 });
  await chmod(privateDirectory, 0o755);
  await assert.rejects(writeExtensionConnections(directory, () => {}), /owner-only/);
  await chmod(privateDirectory, 0o700);
  await writeFile(output, "Not generated by the helper", { mode: 0o600 });
  await assert.rejects(writeExtensionConnections(directory, () => {}), /not generated/);
  assert.equal(await readFile(output, "utf8"), "Not generated by the helper");
  await chmod(output, 0o644);
  await assert.rejects(writeExtensionConnections(directory, () => {}), /owner-only/);
  await rm(output);
  const victim = join(directory, "unrelated.txt");
  await writeFile(victim, "do not change", { mode: 0o600 });
  await symlink(victim, output);
  await assert.rejects(writeExtensionConnections(directory, () => {}), /owner-only/);
  assert.equal(await readFile(victim, "utf8"), "do not change");
  await rm(output); await link(victim, output);
  await assert.rejects(writeExtensionConnections(directory, () => {}), /owner-only/);
  await rm(privateDirectory, { recursive: true });
  await symlink(directory, privateDirectory);
  await assert.rejects(writeExtensionConnections(directory, () => {}), /owner-only/);
});

test("handoff CLI suppresses secrets even for malformed input", async (t) => {
  const directory = await temporary(t);
  await writeFile(join(directory, ".env"), settings + "SENSITIVE=do-not-print-me $unsupported\n");
  try {
    execFileSync(process.execPath, [new URL("../scripts/extension-connections.mjs", import.meta.url).pathname], { cwd: directory, stdio: "pipe" });
    assert.fail("expected failure");
  } catch (error) {
    assert.equal(error.status, 1);
    const logs = `${error.stdout}${error.stderr}`;
    assert.doesNotMatch(logs, /do-not-print-me|p@ss|independent-secret|never-export|mongodb:/);
    assert.match(logs, /handoff failed/);
  }
});

test("published-port probe authenticates both sites with bounded TLS, rejects foreign credentials, prints no secrets", async (t) => {
  const directory = await temporary(t);
  await writeFile(join(directory, ".env"), settings);
  const calls = [];
  class Client {
    constructor(uri, options) { Object.assign(this, { uri, options, closed: false }); calls.push(this); }
    async connect() {
      const expected = this.uri.includes(":10270/") ? "workshop" : "workshop_b";
      if (this.options.auth.username !== expected) throw Object.assign(new Error("not logged"), { code: 18 });
    }
    db(name) { this.database = name; return { command: async () => ({ ok: 1 }), collection: (collection) => ({
      findOne: async () => collection === "workshop_meta" ? { fingerprint: "catalog" } : { _id: "one" },
    }) }; }
    async close() { this.closed = true; }
  }
  const logs = [];
  await checkExtensionConnections(directory, (line) => logs.push(JSON.parse(line)), Client);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ closed, options, uri }) => closed && options.tlsAllowInvalidCertificates && options.timeoutMS === 10000 && uri.includes("tls=true")));
  assert.ok(logs.every(({ authenticatedCatalogRead, foreignCredentialsRejected }) => authenticatedCatalogRead && foreignCredentialsRejected));
  assert.doesNotMatch(JSON.stringify(logs), /p@ss|independent-secret|never-export|mongodb:/);
});

test("both profiles ignore database ports and unknown ports, retain private 3000 and safe Compose DNS", async () => {
  for (const path of ["../.devcontainer/devcontainer.json", "../.devcontainer/organizer/devcontainer.json"]) {
    const config = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    assert.deepEqual(config.forwardPorts, [3000]);
    assert.equal(config.portsAttributes["3000"].visibility, "private");
    assert.equal(config.portsAttributes["3000"].onAutoForward, "notify");
    for (const port of [10270, 10271]) assert.equal(config.portsAttributes[port].onAutoForward, "ignore");
    assert.equal(config.otherPortsAttributes.onAutoForward, "ignore");
  }
  const compose = (await readFile(new URL("../compose.yaml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  assert.match(compose, /"127\.0\.0\.1:\$\{SITE_A_EXTENSION_PORT:-10270\}:10260"/);
  assert.match(compose, /"127\.0\.0\.1:\$\{SITE_B_EXTENSION_PORT:-10271\}:10260"/);
  assert.match(compose, /LOCAL_DOCUMENTDB_HOST: documentdb\n/);
  assert.match(compose, /SITE_B_DOCUMENTDB_HOST: documentdb-site-b\n/);
  const reconnect = await readFile(new URL("../scripts/test-reconnect.mjs", import.meta.url), "utf8");
  assert.match(reconnect, /documentdb:\\n    ports: !override \[\]\\n  documentdb-site-b:\\n    ports: !override \[\]/);
  for (const name of [".gitignore", ".dockerignore"]) {
    assert.match(await readFile(new URL(`../${name}`, import.meta.url), "utf8"), /^\.workshop-private\/\r?$/m);
  }
});

test("read-only playground templates use the selected database/catalog, bounded output and reference pipeline", async () => {
  const catalog = await readCatalog();
  const calls = [];
  const db = {
    workshop_meta: { find(filter) {
      assert.deepEqual(JSON.parse(JSON.stringify(filter)), { _id: "catalog", ready: true });
      return { limit(n) { assert.equal(n, 1); return this; }, maxTimeMS(n) { assert.equal(n, 5000); return this; }, toArray: () => [{ fingerprint: catalog.fingerprint }] };
    } },
    sessions: {
      find(filter, projection) {
        calls.push({ filter, projection });
        return { sort(order) { calls.at(-1).sort = order; return this; }, limit(n) { calls.at(-1).limit = n; return this; },
          maxTimeMS(n) { assert.equal(n, 5000); return this; }, toArray: () => [{ _id: "one" }] };
      },
      aggregate(pipeline, options) {
        const clean = JSON.parse(JSON.stringify(pipeline));
        assert.deepEqual(clean.slice(0, 3), programCountsPipeline(catalog.fingerprint));
        assert.deepEqual(clean.at(-1), { $limit: 30 });
        assert.equal(options.maxTimeMS, 5000);
        return { toArray: () => [] };
      },
    },
  };
  for (const name of ["inspect", "program-counts"]) {
    const source = await readFile(new URL(`../exercises/optional/${name}.documentdb.js`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /mongodb:\/\/|\buse\s*\(|\.(insert|update|delete|drop|create)|\$(out|merge)\b/);
    vm.runInNewContext(source, { db }); // Syntax/contract only; NOT extension execution proof.
    const empty = { ...db, workshop_meta: { find: () => ({ limit() { return this; }, maxTimeMS() { return this; }, toArray: () => [] }) } };
    assert.throws(() => vm.runInNewContext(source, { db: empty }), /seeded workshop database/);
  }
  assert.equal(calls[0].filter.catalogVersion, catalog.fingerprint);
  assert.equal(calls[0].projection.catalogVersion, 1);
  assert.equal(calls[0].limit, 5);
});


test("attendee guides call out the local TLS choice and misleading v1.0 warning", async () => {
  for (const name of ["../docs/extension.md", "../docs/lab.md"]) {
    const text = await readFile(new URL(name, import.meta.url), "utf8");
    assert.match(text, /Allow invalid certificates/);
    assert.match(text, /self-signed/);
    assert.match(text, /tls=true/);
    assert.match(text, /TLS\/SSL Disabled/);
    assert.match(text, /Azure/);
  }
});
