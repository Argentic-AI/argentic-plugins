// lab/MANIFEST.json lists every scenario, world, prompt and scorer file copied from the lab, with the sha256 of the lab's file.
// `argentic-check verify` and the test suite check the copies still match, so a quiet edit to a scorer cannot go unnoticed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../lab/", import.meta.url));
export function verifyLab() {
  const m = JSON.parse(readFileSync(root + "MANIFEST.json", "utf8")), lines = [`Files copied from the lab (${m.copied_on}); sha256 must match the lab's:`];
  let ok = true;
  for (const f of m.files) {
    const got = createHash("sha256").update(readFileSync(root + f.path)).digest("hex"), same = got === f.sha256;
    if (!same) ok = false;
    lines.push(`  ${same ? "ok      " : "CHANGED "} ${f.path}${same ? "" : `  (got ${got.slice(0, 12)}, lab ${f.sha256.slice(0, 12)})`}`);
  }
  lines.push(ok ? "All files are byte-identical to the lab's." : "Some files differ from the lab's: scores are not comparable with our published runs.");
  return { ok, lines };
}
