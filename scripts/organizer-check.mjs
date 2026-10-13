import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function checkOrganizerTools(run = spawnSync, env = process.env) {
  if (env.WORKSHOP_ROLE !== "organizer") {
    throw new Error("Open the ATO 2026 - Organizer dev container for Azure tooling. Attendees do not need this step.");
  }
  for (const args of [["version"], ["bicep", "version"]]) {
    const result = run("az", args, { encoding: "utf8", timeout: 30000 });
    if (result.error || result.status !== 0) {
      throw new Error(`Azure tooling check failed for az ${args.join(" ")} (exit ${result.status ?? result.error?.code ?? "interrupted"}). Rebuild the organizer configuration; do not substitute shared credentials.`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkOrganizerTools();
    console.log("Azure CLI and Bicep are available. No Azure sign-in or resource operation was performed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
