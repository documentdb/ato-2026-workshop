import { spawnSync } from "node:child_process";
import { setup } from "./setup.mjs";
import { pathToFileURL } from "node:url";

export const workspaceSteps = [
  ["compose", "-f", "compose.yaml", "up", "--build", "-d", "--wait", "--wait-timeout", "240"],
  ["compose", "-f", "compose.yaml", "exec", "-T", "app", "npm", "run", "wait:database", "--", "--target", "local"],
  ["compose", "-f", "compose.yaml", "exec", "-T", "app", "npm", "run", "wait:database", "--", "--target", "site-b"],
  ["compose", "-f", "compose.yaml", "exec", "-T", "app", "npm", "run", "seed", "--", "--target", "local"],
  ["compose", "-f", "compose.yaml", "exec", "-T", "app", "npm", "run", "seed", "--", "--target", "site-b"],
];

export function startWorkspace(run = spawnSync, log = console.log) {
  for (const args of workspaceSteps) {
    const result = run("docker", args, { stdio: "inherit", timeout: 600000 });
    if (result.error) throw new Error(`Workspace startup could not run Docker (${result.error.code || result.error.name}).`);
    if (result.status !== 0) throw new Error(`Workspace startup stopped at docker ${args.join(" ")} (exit ${result.status ?? "interrupted"}).`);
  }
  log("Site A and Site B are ready and both catalogs are seeded. Open private port 3000 from the Ports tab.");
  log("The starter's TODO prompt is intentional. Both sites are local simulations; no Azure connection, sign-in or provisioning was performed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await setup();
    startWorkspace();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
