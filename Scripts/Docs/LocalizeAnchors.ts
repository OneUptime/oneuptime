/*
 * Points the #anchors in translated docs at translated headings.
 *
 * An anchor is made from its heading's text (MarkdownSlugify), so a heading
 * translated into German has a German anchor, and a link a translator copied
 * from the English page - `](#default-criteria)` - points at a heading the
 * German page does not have. The page still renders; the link goes nowhere.
 *
 * A translation keeps the English page's shape - the same headings at the
 * same levels, with the same code samples under them, in the same order (the
 * docs translation tests hold it to that) - so the heading an English anchor
 * names has a counterpart at the same position in the translation. This
 * rewrites every anchor in a translated page that its target page does not
 * have, in-page links and links to other pages alike, to the anchor of that
 * counterpart. A link whose target page is not translated is left alone: the
 * reader lands on the English copy, which has the English anchor.
 *
 * Counting headings is not enough to know they line up: a stale translation
 * can have as many headings as the English page in another order, and
 * mapping by position would send a link to the wrong section. So a target
 * whose translation does not have the English page's shape is not mapped:
 * the link is reported, and left as it is, until that page is translated
 * again.
 *
 * To run:
 *   npm run docs:localize-anchors            (report what would change)
 *   npm run docs:localize-anchors -- --apply (change it)
 *
 * --lang <code> and --page <category/page> (each repeatable) limit it to
 * some languages or pages - translators working side by side each rewrite
 * only their own files. DOCS_CONTENT_DIR points it at another content
 * directory (the tests use one of their own).
 */
import { slugifyMarkdownHeading } from "../../packages/Common/Server/Types/MarkdownSlugify";
import * as fs from "fs";
import * as path from "path";

const CONTENT_DIR: string = process.env["DOCS_CONTENT_DIR"]
  ? path.resolve(process.env["DOCS_CONTENT_DIR"])
  : path.resolve(__dirname, "../../packages/App/FeatureSet/Docs/Content");
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
    return page.replace(/^\/?(?:docs\/)?/, "").replace(/\.md$/, "");
  },
);

const FENCE: RegExp = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING: RegExp = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const ANCHOR_LINK: RegExp =
  /\]\((\/docs\/([a-z0-9-]+)\/([a-z0-9-]+))?#([^)\s]+)\)/g;

interface Heading {
  anchor: string;
  level: number;
  // The languages of the code samples between this heading and the next.
  code: Array<string>;
}

// A page's headings, in order, outside fenced code.
const readHeadings: (markdown: string) => Array<Heading> = (
  markdown: string,
): Array<Heading> => {
  const headings: Array<Heading> = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FENCE);
    if (fenceMatch) {
      const marker: string = fenceMatch[1]!;
      if (fence === null) {
        fence = marker;
        const language: string =
          (fenceMatch[2] || "").trim().split(/\s+/)[0] || "";
        if (headings.length > 0) {
          headings[headings.length - 1]!.code.push(language.toLowerCase());
        }
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(HEADING);
    if (heading) {
      headings.push({
        anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        level: heading[1]!.length,
        code: [],
      });
    }
  }

  return headings;
};

// What two copies of a page must share for their headings to line up.
const shapeOf: (headings: Array<Heading>) => string = (
  headings: Array<Heading>,
): string => {
  return headings
    .map((heading: Heading): string => {
      return `${heading.level}[${heading.code.join(",")}]`;
    })
    .join(" ");
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
        pages.push(
          path.relative(root, full).split(path.sep).join("/").slice(0, -3),
        );
      }
    }
  };
  walk(root);
  return pages.sort();
};

// An anchor as the heading slug it names; as written when it is not valid percent-encoding.
const decodeAnchor: (raw: string) => string = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/*
 * English anchor -> this language's anchor, for one page. "untranslated"
 * when the page has no copy in this language (or no English copy), "stale"
 * when the copy does not have the English page's shape.
 */
type AnchorMap = Map<string, string> | "untranslated" | "stale";

const anchorMapCache: Map<string, AnchorMap> = new Map();

const anchorMap: (lang: string, page: string) => AnchorMap = (
  lang: string,
  page: string,
): AnchorMap => {
  const key: string = `${lang}/${page}`;
  const cached: AnchorMap | undefined = anchorMapCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const english: string | null = readIfExists(pageFile(DEFAULT_LANGUAGE, page));
  const translated: string | null = readIfExists(pageFile(lang, page));
  let map: AnchorMap = "untranslated";

  if (english !== null && translated !== null) {
    const from: Array<Heading> = readHeadings(english);
    const to: Array<Heading> = readHeadings(translated);
    if (shapeOf(from) === shapeOf(to)) {
      const pairs: Map<string, string> = new Map();
      from.forEach((heading: Heading, index: number): void => {
        if (!pairs.has(heading.anchor)) {
          pairs.set(heading.anchor, to[index]!.anchor);
        }
      });
      map = pairs;
    } else {
      map = "stale";
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

const languages: Array<string> = fs
  .readdirSync(CONTENT_DIR)
  .filter((lang: string): boolean => {
    return (
      lang !== DEFAULT_LANGUAGE &&
      fs.statSync(path.join(CONTENT_DIR, lang)).isDirectory() &&
      (ONLY_LANGUAGES.length === 0 || ONLY_LANGUAGES.includes(lang))
    );
  })
  .sort();

for (const lang of languages) {
  for (const page of listPages(lang)) {
    if (ONLY_PAGES.length > 0 && !ONLY_PAGES.includes(page)) {
      continue;
    }

    const file: string = pageFile(lang, page);
    const markdown: string = fs.readFileSync(file, "utf8");
    const ownAnchors: Set<string> = new Set(
      readHeadings(markdown).map((heading: Heading): string => {
        return heading.anchor;
      }),
    );
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
          ANCHOR_LINK,
          (
            whole: string,
            target: string | undefined,
            category: string | undefined,
            pageName: string | undefined,
            rawAnchor: string,
          ): string => {
            const anchor: string = decodeAnchor(rawAnchor);
            const targetPage: string = target
              ? `${category}/${pageName}`
              : page;
            const where: string = `${lang}/${page}.md:${index + 1} -> ${target || ""}#${anchor}`;

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
                : new Set(
                    readHeadings(landing).map((heading: Heading): string => {
                      return heading.anchor;
                    }),
                  );
            if (landingAnchors.has(anchor)) {
              return whole;
            }

            const map: AnchorMap = anchorMap(lang, targetPage);
            if (map === "stale") {
              unresolved.push(
                `${where} (the ${lang} copy of ${targetPage} does not have the English page's headings and code samples: translate it again first)`,
              );
              return whole;
            }
            const mapped: string | undefined =
              map === "untranslated" ? undefined : map.get(anchor);
            if (!mapped) {
              unresolved.push(
                `${where} (no heading of the English ${targetPage} has this anchor)`,
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
    `\n${unresolved.length} anchor(s) could not be matched to a heading, and were left as they are:\n`,
  );
  for (const line of unresolved) {
    // eslint-disable-next-line no-console
    console.error(`  ${line}`);
  }
  process.exit(1);
}
