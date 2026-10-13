import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, open, unlink, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isIP } from "node:net";

export function parseOrganizerOptions(args) {
  const options = { clientIps: [] };
  const keys = { "--subscription": "subscriptionId", "--location": "location", "--expires-at": "expiresAt" };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`A value is required for ${flag}.`);
    if (flag === "--client-ip") options.clientIps.push(value);
    else if (Object.hasOwn(keys, flag) && !Object.hasOwn(options, keys[flag])) options[keys[flag]] = value;
    else throw new Error(`Unknown or repeated option: ${flag}.`);
  }
  return options;
}

export function isPublicIPv4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127));
}

export function buildOrganizerInputs(options, {
  runId = randomUUID(),
  now = new Date(),
  password = () => `${randomBytes(32).toString("base64url")}Aa1!`,
} = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("The generated run identity must be a UUID.");
  }
  runId = runId.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.subscriptionId ?? "")) {
    throw new Error("Supply the explicit approved subscription GUID; no default subscription is selected.");
  }
  if (options.location !== "eastus") throw new Error("The current rehearsal template is approved for eastus only; review the plan before changing regions.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.expiresAt ?? "") ||
      !Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= now.getTime()) {
    throw new Error("Supply the approved future expiry as a UTC timestamp. An expiry tag does not perform cleanup.");
  }
  if (new Date(options.expiresAt).toISOString() !== (options.expiresAt.includes(".") ? options.expiresAt : options.expiresAt.replace("Z", ".000Z"))) {
    throw new Error("The expiry must be a real calendar date, not a normalized invalid date.");
  }
  if (!Array.isArray(options.clientIps) || options.clientIps.length < 1 || options.clientIps.length > 2 ||
      !options.clientIps.every(isPublicIPv4) || new Set(options.clientIps).size !== options.clientIps.length) {
    throw new Error("Supply one or two distinct observed public IPv4 addresses, not private addresses or CIDR ranges.");
  }
  const subscriptionId = options.subscriptionId.toLowerCase();
  const suffix = runId.replaceAll("-", "").slice(0, 8);
  const resourceGroupName = `rg-ato-workshop-${suffix}`;
  const clusterNames = [`ato-workshop-${suffix}-a`, `ato-workshop-${suffix}-b`];
  const groupId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;
  const manifest = {
    schemaVersion: 1,
    actionsExecuted: false,
    approvalStatus: "requires-operator-review",
    runId,
    subscriptionId,
    location: options.location,
    expiresAt: new Date(options.expiresAt).toISOString(),
    resourceGroupName,
    resourceGroupId: groupId,
    deploymentName: `ato-workshop-${suffix}`,
    clusterNames,
    clusterIds: clusterNames.map((name) => `${groupId}/providers/Microsoft.DocumentDB/mongoClusters/${name}`),
    clientIps: options.clientIps,
  };
  const parameters = {
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      resourceGroupName: { value: resourceGroupName },
      location: { value: options.location },
      runId: { value: runId },
      expiresAt: { value: manifest.expiresAt },
      clusterNames: { value: clusterNames },
      administratorPasswords: { value: Object.fromEntries(clusterNames.map((name) => [name, password()])) },
      clientIps: { value: options.clientIps },
      enablePublicAccess: { value: false },
    },
  };
  return { manifest, parameters };
}

export async function writePrivateOrganizerInputs(inputs, {
  home = homedir(),
  repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url))),
} = {}) {
  if (process.platform !== "linux") throw new Error("Prepare organizer inputs inside the Linux organizer Codespace; do not write sensitive parameters with unsupported file permissions.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inputs.manifest.runId)) {
    throw new Error("The private run directory needs a valid run UUID.");
  }
  const root = join(home, ".local", "state", "ato-2026-workshop");
  const requested = relative(resolve(repositoryRoot), resolve(root));
  if (!requested || (!requested.startsWith(`..${sep}`) && requested !== ".." && !isAbsolute(requested))) {
    throw new Error("Organizer state must be outside the repository.");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Private organizer storage must be a real directory.");
  if (rootInfo.uid !== process.getuid() || (rootInfo.mode & 0o077) !== 0) {
    throw new Error("Organizer storage must be owned by this user with owner-only permissions.");
  }
  const within = relative(await realpath(repositoryRoot), await realpath(root));
  if (!within || (!within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within))) {
    throw new Error("Organizer state must be outside the repository.");
  }
  const directory = join(root, inputs.manifest.runId);
  await mkdir(directory, { mode: 0o700 });
  const created = [];
  try {
    if (((await lstat(directory)).mode & 0o077) !== 0) throw new Error("Owner-only directory permissions were not applied.");
    for (const [name, data] of [["manifest.json", inputs.manifest], ["parameters.json", inputs.parameters]]) {
      const filename = join(directory, name);
      const handle = await open(filename, "wx", 0o600);
      created.push(filename);
      try {
        await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
        if (((await handle.stat()).mode & 0o077) !== 0) throw new Error("Owner-only file permissions were not applied.");
      } finally {
        await handle.close();
      }
    }
    return {
      stateDirectory: directory,
      manifestFile: join(directory, "manifest.json"),
      parameterFile: join(directory, "parameters.json"),
      actionsExecuted: false,
    };
  } catch (error) {
    for (const filename of created) await unlink(filename);
    await rmdir(directory);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.WORKSHOP_ROLE !== "organizer") throw new Error("Use the organizer configuration. The role label does not grant Azure permissions.");
    const inputs = buildOrganizerInputs(parseOrganizerOptions(process.argv.slice(2)));
    const files = await writePrivateOrganizerInputs(inputs);
    console.log(JSON.stringify({ ...files, runId: inputs.manifest.runId, resourceGroup: inputs.manifest.resourceGroupName }, null, 2));
  } catch (error) {
    console.error(`Organizer input preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
