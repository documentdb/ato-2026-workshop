import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const workspaceSteps = [
  ["compose", "up", "--build", "-d", "--wait", "--wait-timeout", "240"],
  ["compose", "exec", "-T", "app", "npm", "run", "seed", "--", "--target", "local"],
];

export function startWorkspace(run = spawnSync, log = console.log) {
  for (const args of workspaceSteps) {
    const result = run("docker", args, { stdio: "inherit", timeout: 600000 });
    if (result.error) throw new Error(`Workspace startup could not run Docker (${result.error.code || result.error.name}).`);
    if (result.status !== 0) throw new Error(`Workspace startup stopped at docker ${args.join(" ")} (exit ${result.status ?? "interrupted"}).`);
  }
  log("Development database is ready and the catalog is seeded. Open private port 3000 from the Ports tab.");
  log("The starter's TODO prompt is intentional. No Azure sign-in or cloud provisioning was performed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    startWorkspace();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
