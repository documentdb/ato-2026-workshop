import { randomBytes } from "node:crypto";
import { open, stat, chown } from "node:fs/promises";
import { resolve } from "node:path";

const directory = process.env.SETUP_DIRECTORY || process.cwd();
const filename = resolve(directory, ".env");
const content = [
  "DOCUMENTDB_USERNAME=workshop",
  `DOCUMENTDB_PASSWORD=${randomBytes(24).toString("hex")}`,
  "WORKSHOP_MODE=starter",
  `WORKSHOP_LOCATION=${process.env.CODESPACES === "true" ? "codespaces" : "laptop"}`,
  `WORKSHOP_PUBLIC_HOST=${process.env.CODESPACES === "true" && process.env.CODESPACE_NAME ? `${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}` : ""}`,
  "WORKSHOP_PORT=3000",
  "ACTIVE_TARGET=local",
  "LOCAL_DATABASE_NAME=ato_workshop",
  "CLOUD_DOCUMENTDB_URI=",
  "CLOUD_DATABASE_NAME=",
  "",
].join("\n");

try {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
  if (process.getuid?.() === 0) {
    const owner = await stat(directory);
    await chown(filename, owner.uid, owner.gid);
  }
  console.log("Created private development-database configuration. No managed Azure target is configured.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log("Kept the existing .env unchanged. To change environments, edit it deliberately.");
  } else {
    console.error(`Local setup failed (${error.code || error.name}). Check directory access; no credentials were printed.`);
    process.exitCode = 1;
  }
}
