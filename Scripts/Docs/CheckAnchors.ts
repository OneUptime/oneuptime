/*
 * In-page anchor validator for the docs.
 *
 * The docs renderer turns each heading into an `id` with Markdown.slugify, so an
 * in-page link `](#foo)` only resolves if some heading in the SAME file slugifies
 * to exactly `foo`. Nothing enforced that, and a broken anchor is invisible —
 * the page still renders, the link just goes nowhere. This walks every markdown
 * file under Docs/Content and fails if any anchor has no matching heading.
 *
 * It imports the real Markdown.slugify rather than reimplementing it. A second
 * copy of those rules would drift from the renderer and then cheerfully pass a
 * link the renderer serves as a 404 — which is exactly how the last round of
 * broken anchors survived.
 *
 * To run:
 *   npm run docs:check-anchors
 */
import Markdown from "Common/Server/Types/Markdown";
import * as fs from "fs";
import * as path from "path";

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Docs/Content",
);

type Broken = {
  file: string;
  line: number;
  anchor: string;
};

const markdownFilesIn: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  const found: Array<string> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...markdownFilesIn(full));
    } else if (full.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
};

/*
 * Fenced blocks are skipped for both headings and anchors: a `#` inside a shell
 * snippet is a comment, not a heading, and a URL in a code sample is not a link.
 * Fences can be indented (inside a list item), so the fence test is not anchored
 * to the start of the line.
 */
const checkFile: (file: string) => Array<Broken> = (
  file: string,
): Array<Broken> => {
  const lines: Array<string> = fs.readFileSync(file, "utf8").split("\n");
  const headingSlugs: Set<string> = new Set();
  const anchors: Array<{ anchor: string; line: number }> = [];

  let inFence: boolean = false;
  lines.forEach((line: string, index: number): void => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const heading: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.*)$/);
    if (heading && heading[1]) {
      headingSlugs.add(Markdown.slugify(heading[1].trim()));
    }

    for (const match of line.matchAll(/\]\(#([^)]*)\)/g)) {
      anchors.push({ anchor: match[1] || "", line: index + 1 });
    }
  });

  return anchors
    .filter((a: { anchor: string }): boolean => {
      return !headingSlugs.has(a.anchor);
    })
    .map((a: { anchor: string; line: number }): Broken => {
      return { file, line: a.line, anchor: a.anchor };
    });
};

const broken: Array<Broken> = markdownFilesIn(CONTENT_DIR).flatMap(checkFile);

if (broken.length === 0) {
  // eslint-disable-next-line no-console
  console.log("All docs anchor links resolve to a heading in the same file.");
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error(
  `${broken.length} broken anchor link(s) — each points at an id no heading in that file produces:\n`,
);
for (const b of broken) {
  const rel: string = path.relative(CONTENT_DIR, b.file);
  // eslint-disable-next-line no-console
  console.error(`  ${rel}:${b.line}  ->  #${b.anchor}`);
}
// eslint-disable-next-line no-console
console.error(
  "\nAnchor ids come from the heading text via Markdown.slugify (Common/Server/Types/Markdown.ts).\n" +
    "Translated headings produce translated ids, so a translated page cannot keep the English anchor.\n" +
    "Do not hand-write a slug — read the heading and let slugify compute it.",
);
process.exit(1);
