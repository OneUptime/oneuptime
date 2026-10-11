/*
 * Repoints in-page #anchors in the docs that still name a heading by the
 * anchor it had under the old ASCII-only rule, or by the English page's
 * anchor in a translated copy, at the anchor the page renders now.
 *
 * Headings are read the way the renderer reads them, through
 * slugifyMarkdownHeading - as CheckAnchors and LocalizeAnchors do. Reading
 * the heading as written with slugify treated a `<word>` in inline code as a
 * tag ("`oneuptime <resource> list`" became #oneuptime-list where the page
 * says #oneuptime-resource-list), so --apply would have moved a working link
 * onto an anchor no page has.
 *
 * To run (from Scripts/):
 *   npx ts-node --transpile-only ./Docs/FixAnchors.ts            (report)
 *   npx ts-node --transpile-only ./Docs/FixAnchors.ts --apply    (change)
 *
 * DOCS_CONTENT_DIR points it at another content directory (the tests use
 * one of their own).
 */
import { slugifyMarkdownHeading } from "../../packages/Common/Server/Types/MarkdownSlugify";
import * as fs from "fs";
import * as path from "path";

const CONTENT_DIR: string = process.env["DOCS_CONTENT_DIR"]
  ? path.resolve(process.env["DOCS_CONTENT_DIR"])
  : path.resolve(__dirname, "../../packages/App/FeatureSet/Docs/Content");
const APPLY: boolean = process.argv.includes("--apply");

// Fences can be indented (inside a list item), so this is not anchored to the line start.
const FENCE_LINE: RegExp = /^\s*```/;

/*
 * The anchor a heading had under the rule anchors were made with before
 * slugify kept letters and numbers in every script: `\w` alone, so every
 * other letter, number and mark was dropped. That is today's anchor with
 * each of those taken out, so it is read from slugifyMarkdownHeading - the
 * one slugify, which takes markup and entities out of the heading - rather
 * than from a copy of its rules. The copy took tags out with one pass of a
 * tag pattern, which code scanning reports as incomplete, and read the
 * heading as written, so a `<word>` in inline code lost its word.
 */
const legacySlug: (heading: string) => string = (heading: string): string => {
  return slugifyMarkdownHeading(heading)
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

const headingsOf: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const out: Array<string> = [];
  let inFence: boolean = false;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const m: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.*)$/);
    if (m && m[1]) {
      out.push(m[1].trim());
    }
  }
  return out;
};

/*
 * Anchors keyed by "<line>:<nth anchor on that line>". Translated files are
 * line-for-line copies of en, so the anchor sitting at the same coordinates in
 * en tells us what a translated anchor was meant to point at — even when the
 * translated anchor is a translation of a target that never existed.
 */
const anchorsByPosition: (file: string) => Map<string, string> = (
  file: string,
): Map<string, string> => {
  const map: Map<string, string> = new Map();
  let inFence: boolean = false;
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line: string, i: number): void => {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) {
        return;
      }
      let n: number = 0;
      for (const m of line.matchAll(/\]\(#([^)]*)\)/g)) {
        map.set(`${i}:${n++}`, m[1] || "");
      }
    });
  return map;
};

const walk: (dir: string) => Array<string> = (dir: string): Array<string> => {
  const out: Array<string> = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p: string = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(p));
    } else if (p.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
};

const counts: { already: number; repointed: number } = {
  already: 0,
  repointed: 0,
};
const unresolved: Array<string> = [];
const touched: Set<string> = new Set();

for (const loc of fs.readdirSync(CONTENT_DIR).filter((d: string) => {
  return fs.statSync(path.join(CONTENT_DIR, d)).isDirectory();
})) {
  for (const file of walk(path.join(CONTENT_DIR, loc))) {
    const rel: string = path.relative(path.join(CONTENT_DIR, loc), file);
    const mineH: Array<string> = headingsOf(file);
    const mine: Array<string> = mineH.map(slugifyMarkdownHeading);
    const mineOld: Array<string> = mineH.map(legacySlug);

    const enFile: string = path.join(CONTENT_DIR, "en", rel);
    const enH: Array<string> = fs.existsSync(enFile) ? headingsOf(enFile) : [];
    const enNew: Array<string> = enH.map(slugifyMarkdownHeading);
    const enOld: Array<string> = enH.map(legacySlug);
    const src: string = fs.readFileSync(file, "utf8");
    const lineParity: boolean =
      loc !== "en" &&
      enH.length === mineH.length &&
      fs.existsSync(enFile) &&
      fs.readFileSync(enFile, "utf8").split("\n").length ===
        src.split("\n").length;
    const enPos: Map<string, string> = lineParity
      ? anchorsByPosition(enFile)
      : new Map();

    let inFence: boolean = false;
    const out: string = src
      .split("\n")
      .map((line: string, lineNo: number): string => {
        if (FENCE_LINE.test(line)) {
          inFence = !inFence;
          return line;
        }
        if (inFence) {
          return line;
        }
        let nth: number = -1;
        return line.replace(
          /\]\(#([^)]*)\)/g,
          (whole: string, a: string): string => {
            nth++;
            if (mine.includes(a)) {
              counts.already++;
              return whole;
            }

            // 1. the anchor is this file's own heading under the legacy ASCII slugify
            let idx: number = mineOld.indexOf(a);

            // 2. the anchor is the en slug (either era) - the English-anchor convention
            if (idx === -1 && lineParity) {
              idx = enNew.indexOf(a);
              if (idx === -1) {
                idx = enOld.indexOf(a);
              }
            }

            /*
             * 3. Fall back to whatever en links to from these exact coordinates. This
             * is what rescues an anchor that was translated from an en target that
             * never existed, so its text matches nothing on either side.
             */
            if (idx === -1 && lineParity) {
              const enAnchor: string | undefined = enPos.get(
                `${lineNo}:${nth}`,
              );
              if (enAnchor) {
                idx = enNew.indexOf(enAnchor);
                if (idx === -1) {
                  idx = enOld.indexOf(enAnchor);
                }
              }
            }

            if (idx === -1 || !mine[idx]) {
              unresolved.push(`${loc}/${rel}:${lineNo + 1} -> #${a}`);
              return whole;
            }
            counts.repointed++;
            touched.add(file);
            return `](#${mine[idx]})`;
          },
        );
      })
      .join("\n");

    if (out !== src && APPLY) {
      fs.writeFileSync(file, out);
    }
  }
}

/* eslint-disable no-console */
console.log(APPLY ? "APPLIED" : "DRY RUN");
console.log(`  already correct : ${counts.already}`);
console.log(
  `  repointed       : ${counts.repointed} across ${touched.size} files`,
);
console.log(`  unresolved      : ${unresolved.length}`);
for (const u of unresolved) {
  console.log(`      ${u}`);
}
/* eslint-enable no-console */
