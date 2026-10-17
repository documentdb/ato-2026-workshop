import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, stat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startWorkspace, workspaceSteps } from "../scripts/workspace-start.mjs";
import { checkOrganizerTools } from "../scripts/organizer-check.mjs";
import { parseOrganizerOptions, buildOrganizerInputs, writePrivateOrganizerInputs, isPublicIPv4 } from "../scripts/organizer-prepare.mjs";

const input = {
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  location: "eastus",
  expiresAt: "2030-01-01T12:00:00Z",
  clientIps: ["1.1.1.1", "8.8.8.8"],
};
const options = {
  runId: "22222222-2222-4222-8222-222222222222",
  now: new Date("2030-01-01T09:00:00Z"),
  password: () => "synthetic-test-password",
};

test("attendee and organizer configurations share startup, not Azure authentication", async () => {
  const attendee = JSON.parse(await readFile(new URL("../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
  const organizer = JSON.parse(await readFile(new URL("../.devcontainer/organizer/devcontainer.json", import.meta.url), "utf8"));
  assert.equal(attendee.containerEnv.WORKSHOP_ROLE, "attendee");
  assert.equal(organizer.containerEnv.WORKSHOP_ROLE, "organizer");
  assert.equal(attendee.image, organizer.image);
  assert.equal(attendee.postStartCommand, "npm run workspace:start");
  assert.equal(attendee.postStartCommand, organizer.postStartCommand);
  assert.ok(Object.keys(attendee.features).every((name) => !name.includes("azure-cli")));
  const azure = Object.entries(organizer.features).find(([name]) => name.includes("/azure-cli:"));
  assert.equal(azure[1].installBicep, true);
  for (const configuration of [attendee, organizer]) {
    assert.equal(configuration.portsAttributes["3000"].visibility, "private");
    assert.ok(configuration.features["ghcr.io/devcontainers/features/docker-in-docker:2"]);
    for (const hook of ["onCreateCommand", "postCreateCommand", "postStartCommand"]) {
      assert.doesNotMatch(configuration[hook], /\baz\s+(login|deployment|group)|organizer:prepare|azd\s+up/);
    }
  }
});

test("workspace startup waits for both independent sites and never seeds Azure", () => {
  const calls = [];
  const messages = [];
  startWorkspace((program, args, options) => {
    calls.push({ program, args, timeout: options.timeout });
    return { status: 0 };
  }, (message) => messages.push(message));
  assert.deepEqual(calls.map((call) => call.args), workspaceSteps);
  assert.ok(calls.every((call) => call.program === "docker" && call.timeout === 600000));
  assert.deepEqual(calls[1].args.slice(-2), ["--target", "local"]);
  assert.deepEqual(calls[2].args.slice(-2), ["--target", "site-b"]);
  assert.deepEqual(calls.slice(3).map((call) => call.args.slice(-2)), [["--target", "local"], ["--target", "site-b"]]);
  assert.ok(calls.every((call) => !call.args.includes("cloud") && call.args.includes("compose.yaml")));
  assert.match(messages[0], /ready.*seeded/);
});

test("failed startup never seeds or reports readiness", () => {
  let calls = 0;
  const messages = [];
  assert.throws(() => startWorkspace(() => { calls++; return { status: 1 }; }, (value) => messages.push(value)), /startup stopped/);
  assert.equal(calls, 1);
  assert.deepEqual(messages, []);
});

test("organizer tooling checks do not authenticate or deploy", () => {
  const calls = [];
  checkOrganizerTools((program, args) => { calls.push([program, ...args]); return { status: 0 }; }, { WORKSHOP_ROLE: "organizer" });
  assert.deepEqual(calls, [["az", "version"], ["az", "bicep", "version"]]);
  assert.throws(() => checkOrganizerTools(() => { throw new Error("Must not run"); }, { WORKSHOP_ROLE: "attendee" }), /Organizer/);
  assert.throws(() => checkOrganizerTools(() => ({ status: 1 }), { WORKSHOP_ROLE: "organizer" }), /tooling check failed/);
});

test("organizer inputs are explicit, closed-network, and do not claim cloud execution", () => {
  const parsed = parseOrganizerOptions(["--subscription", input.subscriptionId, "--location", "eastus", "--expires-at", input.expiresAt, "--client-ip", "1.1.1.1", "--client-ip", "8.8.8.8"]);
  assert.deepEqual(parsed, input);
  const { manifest, parameters } = buildOrganizerInputs(parsed, options);
  assert.equal(manifest.actionsExecuted, false);
  assert.equal(manifest.approvalStatus, "requires-operator-review");
  assert.equal(manifest.clusterIds.length, 2);
  assert.equal(parameters.parameters.enablePublicAccess.value, false);
  assert.ok(manifest.clusterIds.every((id) => id.startsWith(`${manifest.resourceGroupId}/providers/Microsoft.DocumentDB/mongoClusters/`)));
  assert.doesNotMatch(JSON.stringify(manifest), /synthetic-test-password/);
  assert.deepEqual(Object.keys(parameters.parameters.administratorPasswords.value), manifest.clusterNames);
});

test("organizer preparation rejects defaults, broad addresses, expiry mistakes, and malformed paths", () => {
  for (const change of [
    { subscriptionId: "<subscription>" },
    { location: "unselected-region" },
    { expiresAt: "2029-12-31T00:00:00Z" },
    { expiresAt: "2030-02-30T12:00:00Z" },
    { clientIps: ["0.0.0.0"] },
    { clientIps: ["10.0.0.1"] },
    { clientIps: ["1.1.1.0/24"] },
    { clientIps: ["1.1.1.1", "1.1.1.1"] },
  ]) assert.throws(() => buildOrganizerInputs({ ...input, ...change }, options));
  assert.throws(() => buildOrganizerInputs(input, { ...options, runId: "../escape" }), /UUID/);
  assert.throws(() => parseOrganizerOptions(["--location", "eastus", "--location", "eastus"]), /repeated/);
  assert.throws(() => parseOrganizerOptions(["--subscription"]), /value is required/);
  assert.throws(() => parseOrganizerOptions(["toString", "value"]), /Unknown/);
  for (const address of ["127.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1", "100.64.0.1", "203.0.113.1", "198.51.100.1", "255.255.255.255", "::1"]) {
    assert.equal(isPublicIPv4(address), false);
  }
});

test("private organizer files are owner-only, outside the repository, and never overwrite a prior run", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ato-private-input-test-"));
  try {
    const inputs = buildOrganizerInputs(input, options);
    const files = await writePrivateOrganizerInputs(inputs, { home: directory });
    assert.equal((await stat(files.stateDirectory)).mode & 0o077, 0);
    assert.equal((await stat(files.parameterFile)).mode & 0o077, 0);
    assert.equal((await stat(files.manifestFile)).mode & 0o077, 0);
    assert.equal(JSON.parse(await readFile(files.manifestFile, "utf8")).actionsExecuted, false);
    await assert.rejects(writePrivateOrganizerInputs(inputs, { home: directory }), { code: "EEXIST" });
    await assert.rejects(writePrivateOrganizerInputs(inputs, { home: directory, repositoryRoot: directory }), /outside the repository/);
    await chmod(dirname(files.stateDirectory), 0o755);
    await assert.rejects(writePrivateOrganizerInputs(inputs, { home: directory }), /owner-only permissions/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
