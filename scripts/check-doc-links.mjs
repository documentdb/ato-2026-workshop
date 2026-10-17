// Repository-root documentation check, intentionally separate from runtime
// npm test: the app image doesn't contain README/docs/.azure authoring files.
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? markdownFiles(join(directory, entry.name))
    : entry.name.endsWith(".md") ? [join(directory, entry.name)] : []))).flat();
}
const files = [join(root, "README.md"), ...await markdownFiles(join(root, "docs")), ...await markdownFiles(join(root, ".azure"))];
let checked = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z]+:/i.test(match[1])) continue;
    const [path, anchor] = match[1].split("#");
    const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
    await stat(target); // Fail on missing files; never fetch external URLs.
    if (anchor && target.endsWith(".md")) {
      const content = await readFile(target, "utf8");
      const anchors = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, title]) => title
        .toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/g, "-"));
      if (!anchors.includes(decodeURIComponent(anchor))) throw new Error(`Missing heading link: ${match[1]} in ${file}`);
    }
    checked++;
  }
}
console.log(`Checked ${checked} local documentation links; no network requests.`);
