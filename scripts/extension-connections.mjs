// Host-side private handoff for the extension. Never source/execute .env, read
// ambient credentials, change .env, or export the optional Azure connection.
import { constants } from "node:fs";
import { readFile, mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const marker = "Workshop local extension connections — generated private file v1";
const invalid = () => new Error("Unsupported or duplicate .env binding. Review quoting privately; no configuration was changed. Shell/Compose interpolation is not supported by this helper.");

// Deliberately bounded Compose-compatible subset: one binding per line, optional
// export, literal single quotes, double-quote escapes, comments. Reject rather
// than silently alter interpolation, multiline values, or ambiguous escapes.
export function parsePrivateEnv(source) {
  const values = Object.create(null);
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const binding = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!binding || Object.hasOwn(values, binding[1])) throw invalid();
    const [, key, raw] = binding;
    let value = "";
    if (/^["']/.test(raw)) {
      const quote = raw[0];
      let i = 1;
      let closed = false;
      for (; i < raw.length; i++) {
        const char = raw[i];
        if (char === quote) { closed = true; i++; break; }
        if (char === "\\") {
          const next = raw[i + 1];
          if (quote === "'" && next !== "'") { value += char; continue; }
          const escapes = quote === "'" ? { "'": "'" } : { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' };
          if (!Object.hasOwn(escapes, next)) throw invalid();
          value += escapes[next]; i++;
        } else {
          if (quote === '"' && char === "$") throw invalid();
          value += char;
        }
      }
      if (!closed || !/^\s*(?:#.*)?$/.test(raw.slice(i))) throw invalid();
    } else {
      value = raw.replace(/\s+#.*$/, "").trimEnd();
      if (/[\s$"'\\`]/.test(value)) throw invalid();
    }
    values[key] = value;
  }
  return values;
}

function port(value, fallback) {
  const text = value ?? fallback;
  if (!/^[1-9][0-9]{0,4}$/.test(text) || Number(text) > 65535) {
    throw new Error("Extension ports must be integers from 1 through 65535 in .env.");
  }
  return Number(text);
}

export function localExtensionConnections(values) {
  const connections = [
    { label: "Workshop — Site A", prefix: "DOCUMENTDB", databaseKey: "LOCAL_DATABASE_NAME", port: port(values.SITE_A_EXTENSION_PORT, "10270") },
    { label: "Workshop — Site B", prefix: "SITE_B", databaseKey: "SITE_B_DATABASE_NAME", port: port(values.SITE_B_EXTENSION_PORT, "10271") },
  ].map(({ label, prefix, databaseKey, port }) => {
    const username = values[`${prefix}_USERNAME`];
    const password = values[`${prefix}_PASSWORD`];
    if (!username || !password || /[\x00-\x1f\x7f]/.test(username + password) || /[<>]/.test(username + password)) {
      throw new Error("Both sites need complete, non-placeholder credentials in the existing .env. Run setup or review partial settings; never regenerate an existing volume's credentials.");
    }
    const database = values[databaseKey] ?? "ato_workshop";
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(database)) throw new Error("Review the local database names in .env; use letters, digits, underscores or hyphens.");
    return { label, port, database, username, password,
      // The extension's URI box is NOT masked. Keep credentials separate for
      // its native-auth prompts, and explicitly select the local TLS exception.
      // Azure settings are intentionally never handed to the extension.
      uri: `mongodb://127.0.0.1:${port}/${database}?tls=true&authMechanism=SCRAM-SHA-256&authSource=admin&directConnection=true&retryWrites=false`,
    };
  });
  if (connections[0].port === connections[1].port) throw new Error("Site A and Site B extension ports must be distinct.");
  if (values.DOCUMENTDB_PASSWORD === values.SITE_B_PASSWORD) throw new Error("Site A and Site B must keep independent credentials; review .env without rotating existing users.");
  return connections;
}

export async function readLocalExtensionConnections(directory = process.cwd()) {
  return localExtensionConnections(parsePrivateEnv(await readFile(resolve(directory, ".env"), "utf8")));
}

function ownedPrivate(info, directory = false) {
  return (directory ? info.isDirectory() : info.isFile() && info.nlink === 1) &&
    (info.mode & 0o077) === 0 && (process.getuid?.() === undefined || info.uid === process.getuid());
}

export async function writeExtensionConnections(directory = process.cwd(), log = console.log) {
  const connections = await readLocalExtensionConnections(directory);
  const privateDirectory = resolve(directory, ".workshop-private");
  await mkdir(privateDirectory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  if (!ownedPrivate(await lstat(privateDirectory), true)) throw new Error(".workshop-private must be a real, owner-only directory owned by this user; no files were changed.");
  const filename = join(privateDirectory, "extension-connections.txt");
  try {
    if (!ownedPrivate(await lstat(filename))) throw new Error("The existing handoff must be a real owner-only file owned by this user.");
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.readFile("utf8")).startsWith(marker + "\n")) throw new Error("Refusing to replace a file not generated by this helper.");
    } finally { await file.close(); }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const content = [marker, "SECRET: open privately; never share, commit, screenshot, or paste into a terminal.",
    "Use DocumentDB: New Connection... > Connection String. No Azure sign-in or local setup wizard.",
    "Paste only the credential-free URI into the unmasked URI box; username/password go in separate native-auth prompts.",
    "LOCAL TLS PROMPT (BOTH SITES): choose Allow invalid certificates, not Enable TLS (default). The default rejects the local self-signed certificate.",
    "Keep tls=true: encryption stays on. In extension 1.0.0, the warning TLS/SSL Disabled is misleading for this configuration; only certificate validation is relaxed.",
    "This exception is only for these 127.0.0.1 development connections. Never apply it to Azure, set tls=false, change global TLS settings, or rotate passwords to fix a certificate error.", "",
    ...connections.flatMap(({ label, port, database, uri, username, password }) => [label, `Loopback port: ${port}; database: ${database}`, `Connection string (no credentials): ${uri}`, `Username: ${username}`, `Password (paste only in masked prompt): ${password}`, ""]),
  ].join("\n");
  const temporary = join(privateDirectory, `.connections-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(content); } finally { await file.close(); }
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  log(`Private connection instructions: ${filename}`);
  for (const { label, port, database } of connections) log(`${label}: loopback port ${port}, database ${database}`);
  log("Open the file privately in the editor; no URI or credential was printed. Close it before screen sharing.");
  return filename;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeExtensionConnections().catch(() => {
    console.error("Extension handoff failed. Check that .env has complete distinct local credentials, supported literal quoting and distinct valid ports; private output must be owner-only. Existing .env was not changed; no credentials were printed.");
    process.exitCode = 1;
  });
}
