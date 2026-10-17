import { randomBytes } from "node:crypto";
import { open, stat, chown } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function setup(directory = process.env.SETUP_DIRECTORY || process.cwd(), env = process.env, log = console.log) {
  const filename = resolve(directory, ".env");
  const siteB = {
    SITE_B_USERNAME: "workshop_site_b",
    SITE_B_PASSWORD: randomBytes(24).toString("hex"),
    SITE_B_DATABASE_NAME: "ato_workshop",
  };
  const content = [
    "DOCUMENTDB_USERNAME=workshop",
    `DOCUMENTDB_PASSWORD=${randomBytes(24).toString("hex")}`,
    ...Object.entries(siteB).map(([key, value]) => `${key}=${value}`),
    "WORKSHOP_MODE=starter",
    `WORKSHOP_LOCATION=${env.CODESPACES === "true" ? "codespaces" : "laptop"}`,
    `WORKSHOP_PUBLIC_HOST=${env.CODESPACES === "true" && env.CODESPACE_NAME ? `${env.CODESPACE_NAME}-3000.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}` : ""}`,
    "WORKSHOP_PORT=3000",
    "ACTIVE_TARGET=local",
    "LOCAL_DATABASE_NAME=ato_workshop",
    "CLOUD_DOCUMENTDB_URI=",
    "CLOUD_DATABASE_NAME=",
    "",
  ].join("\n");
  let created = false;
  try {
    const file = await open(filename, "wx", 0o600);
    try { await file.writeFile(content); } finally { await file.close(); }
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Append only absent Site B keys; never rewrite comments, old values or secrets.
    // Empty/partial credentials may describe an existing volume: refuse to guess.
    const file = await open(filename, "r+");
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error("The existing .env must be a regular file.");
      const previous = await file.readFile("utf8");
      const keys = new Map();
      for (const line of previous.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?(SITE_B_[A-Z_]+)\s*=(.*)$/);
        if (!match) continue;
        if (keys.has(match[1])) throw new Error("Duplicate Site B settings require manual review; .env was not changed.");
        keys.set(match[1], match[2].trim());
      }
      const username = keys.has("SITE_B_USERNAME");
      const password = keys.has("SITE_B_PASSWORD");
      if (username !== password || [...keys.values()].some((value) => !value || value === '""' || value === "''")) {
        throw new Error("Partial or empty Site B settings require manual review; .env was not changed. Never regenerate credentials for an existing volume.");
      }
      const additions = Object.entries(siteB).filter(([key]) => !keys.has(key));
      if (additions.length) {
        const suffix = `${previous.endsWith("\n") ? "" : "\n"}# Independent Site B; existing configuration above is preserved.\n${additions.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
        await file.write(suffix, info.size, "utf8");
        log("Added missing Site B settings to the existing .env; all previous values and credentials were preserved.");
      } else {
        log("Kept the existing .env unchanged.");
      }
    } finally { await file.close(); }
  }
  if (created && process.getuid?.() === 0) {
    const owner = await stat(directory);
    await chown(filename, owner.uid, owner.gid);
  }
  if (created) log("Created private, independent Site A and Site B credentials. No Azure target is enabled for attendees.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setup().catch((error) => {
    console.error(`Local setup failed: ${error.code || error.message}. No credentials were printed.`);
    process.exitCode = 1;
  });
}
