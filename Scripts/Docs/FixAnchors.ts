import slugify from "../../Common/Server/Types/MarkdownSlugify";
import * as fs from "fs";
import * as path from "path";

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Docs/Content",
);
const APPLY: boolean = process.argv.includes("--apply");

// Fences can be indented (inside a list item), so this is not anchored to the line start.
const FENCE_LINE: RegExp = /^\s*```/;

const legacySlug: (t: string) => string = (t: string): string => {
  return t
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/&[^;]+;/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
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
    const mine: Array<string> = mineH.map((h: string) => {
      return slugify(h);
    });
    const mineOld: Array<string> = mineH.map(legacySlug);

    const enFile: string = path.join(CONTENT_DIR, "en", rel);
    const enH: Array<string> = fs.existsSync(enFile) ? headingsOf(enFile) : [];
    const enNew: Array<string> = enH.map((h: string) => {
      return slugify(h);
    });
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
