/*
 * Points the #anchors in translated docs at translated headings.
 *
 * An anchor is made from its heading's text (MarkdownSlugify), so a heading
 * translated into German has a German anchor, and a link a translator copied
 * from the English page - `](#default-criteria)` - points at a heading the
 * German page does not have. The page still renders; the link goes nowhere.
 *
 * Translations keep the English page's headings in the same order (the
 * DocsTranslations tests hold them to it), so the heading an English anchor
 * names has a counterpart at the same position in the translation. This
 * rewrites every anchor in a translated page that its target page does not
 * have, in-page links and links to other pages alike, to the anchor of that
 * counterpart. A link whose target page is not translated is left alone: the
 * reader lands on the English copy, which has the English anchor.
 *
 * To run:
 *   npm run docs:localize-anchors            (report what would change)
 *   npm run docs:localize-anchors -- --apply (change it)
 *
 * --lang <code> and --page <category/page> (each repeatable) limit it to
 * some languages or pages - translators working side by side each rewrite
 * only their own files.
 */
import slugify from "../../packages/Common/Server/Types/MarkdownSlugify";
import * as fs from "fs";
import * as path from "path";

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../packages/App/FeatureSet/Docs/Content",
);
const DEFAULT_LANGUAGE: string = "en";
const APPLY: boolean = process.argv.includes("--apply");

// Every value given after a flag, e.g. --lang de --lang fr.
const valuesOf: (flag: string) => Array<string> = (
  flag: string,
): Array<string> => {
  const values: Array<string> = [];
  process.argv.forEach((argument: string, index: number): void => {
    if (argument === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!);
    }
  });
  return values;
};

const ONLY_LANGUAGES: Array<string> = valuesOf("--lang");
const ONLY_PAGES: Array<string> = valuesOf("--page").map(
  (page: string): string => {
    return page.replace(/\.md$/, "");
  },
);

const FENCE: RegExp = /^ {0,3}(`{3,}|~{3,})/;

// The anchors of a page's headings, in order, outside fenced code.
const headingAnchors: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  const anchors: Array<string> = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FENCE);
    if (fenceMatch) {
      const marker: string = fenceMatch[1]!;
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(
      /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/,
    );
    if (heading) {
      anchors.push(slugify(heading[2]!.trim()));
    }
  }

  return anchors;
};

const pageFile: (lang: string, page: string) => string = (
  lang: string,
  page: string,
): string => {
  return path.join(CONTENT_DIR, lang, `${page}.md`);
};

const readIfExists: (file: string) => string | null = (
  file: string,
): string | null => {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

const listPages: (lang: string) => Array<string> = (
  lang: string,
): Array<string> => {
  const root: string = path.join(CONTENT_DIR, lang);
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(root, full).replace(/\.md$/, ""));
      }
    }
  };
  walk(root);
  return pages.sort();
};

/*
 * English anchor -> this language's anchor, for one page; null when the page
 * has no translation or its headings do not line up with the English ones.
 */
const anchorMapCache: Map<string, Map<string, string> | null> = new Map();

const anchorMap: (lang: string, page: string) => Map<string, string> | null = (
  lang: string,
  page: string,
): Map<string, string> | null => {
  const key: string = `${lang}/${page}`;
  if (anchorMapCache.has(key)) {
    return anchorMapCache.get(key)!;
  }

  const english: string | null = readIfExists(pageFile(DEFAULT_LANGUAGE, page));
  const translated: string | null = readIfExists(pageFile(lang, page));
  let map: Map<string, string> | null = null;

  if (english !== null && translated !== null) {
    const from: Array<string> = headingAnchors(english);
    const to: Array<string> = headingAnchors(translated);
    if (from.length === to.length) {
      map = new Map();
      from.forEach((anchor: string, index: number): void => {
        if (!map!.has(anchor)) {
          map!.set(anchor, to[index]!);
        }
      });
    }
  }

  anchorMapCache.set(key, map);
  return map;
};

interface Change {
  file: string;
  line: number;
  from: string;
  to: string;
}

const changes: Array<Change> = [];
const unresolved: Array<string> = [];

for (const lang of fs.readdirSync(CONTENT_DIR)) {
  if (
    lang === DEFAULT_LANGUAGE ||
    !fs.statSync(path.join(CONTENT_DIR, lang)).isDirectory() ||
    (ONLY_LANGUAGES.length > 0 && !ONLY_LANGUAGES.includes(lang))
  ) {
    continue;
  }

  for (const page of listPages(lang)) {
    if (ONLY_PAGES.length > 0 && !ONLY_PAGES.includes(page)) {
      continue;
    }

    const file: string = pageFile(lang, page);
    const markdown: string = fs.readFileSync(file, "utf8");
    const ownAnchors: Set<string> = new Set(headingAnchors(markdown));
    let fence: string | null = null;

    const lines: Array<string> = markdown
      .split("\n")
      .map((line: string, index: number): string => {
        const fenceMatch: RegExpMatchArray | null = line.match(FENCE);
        if (fenceMatch) {
          const marker: string = fenceMatch[1]!;
          if (fence === null) {
            fence = marker;
          } else if (marker[0] === fence[0] && marker.length >= fence.length) {
            fence = null;
          }
          return line;
        }
        if (fence !== null) {
          return line;
        }

        return line.replace(
          /\]\((\/docs\/([a-z0-9-]+)\/([a-z0-9-]+))?#([^)\s]+)\)/g,
          (
            whole: string,
            target: string | undefined,
            category: string | undefined,
            pageName: string | undefined,
            rawAnchor: string,
          ): string => {
            const anchor: string = decodeURIComponent(rawAnchor);
            const targetPage: string = target
              ? `${category}/${pageName}`
              : page;

            // The copy the reader lands on: this language's, if there is one.
            const landing: string | null = readIfExists(
              pageFile(lang, targetPage),
            );
            if (landing === null) {
              return whole;
            }

            const landingAnchors: Set<string> =
              targetPage === page
                ? ownAnchors
                : new Set(headingAnchors(landing));
            if (landingAnchors.has(anchor)) {
              return whole;
            }

            const mapped: string | undefined = anchorMap(lang, targetPage)?.get(
              anchor,
            );
            if (!mapped) {
              unresolved.push(
                `${lang}/${page}.md:${index + 1} -> ${target || ""}#${anchor}`,
              );
              return whole;
            }

            changes.push({
              file: `${lang}/${page}.md`,
              line: index + 1,
              from: `${target || ""}#${anchor}`,
              to: `${target || ""}#${mapped}`,
            });
            return `](${target || ""}#${mapped})`;
          },
        );
      });

    const updated: string = lines.join("\n");
    if (APPLY && updated !== markdown) {
      fs.writeFileSync(file, updated);
    }
  }
}

for (const change of changes) {
  // eslint-disable-next-line no-console
  console.log(
    `${change.file}:${change.line}  ${change.from}  ->  ${change.to}`,
  );
}

// eslint-disable-next-line no-console
console.log(
  `\n${changes.length} anchor(s) ${APPLY ? "localized" : "to localize (run with --apply)"}.`,
);

if (unresolved.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n${unresolved.length} anchor(s) could not be matched to a heading - the translation's headings do not line up with the English page's:\n`,
  );
  for (const line of unresolved) {
    // eslint-disable-next-line no-console
    console.error(`  ${line}`);
  }
  process.exit(1);
}
