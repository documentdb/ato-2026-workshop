import { readFile } from "node:fs/promises";
import { validateCatalog } from "../../src/catalog.js";

export async function readPracticeCatalog() {
  return validateCatalog(JSON.parse(await readFile(new URL("./practice-catalog.json", import.meta.url), "utf8")));
}
