import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";

// Shared by automatic startup and manual search preparation. Never steal an old
// lock: after SIGKILL a surviving Docker client may still be changing this project.
export async function withWorkspaceLock(operation, directory = process.cwd()) {
  const folder = resolve(directory, ".workshop-private");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = resolve(folder, "startup.lock");
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const busy = new Error("WORKSHOP_STARTUP_BUSY: another startup/search preparation owns .workshop-private/startup.lock. Wait for it; after an unhandled termination, follow docs/semantic-search.md recovery before removing only that lock.");
    busy.code = "WORKSHOP_STARTUP_BUSY";
    throw busy;
  }
  try {
    await file.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return await operation();
  } finally {
    await file.close();
    await unlink(path);
  }
}
