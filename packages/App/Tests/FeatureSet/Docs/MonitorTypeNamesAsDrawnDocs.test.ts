import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE MONITOR TYPES, AS EACH LANGUAGE'S PICKER DRAWS THEM (#8682).
 *
 * 2351d870f14 worded every monitor type's title in the Dashboard's locales,
 * so the type picker, the monitors table and a monitor's pages draw
 * "Benutzerdefinierter JavaScript-Code", "Requête SQL" or "외부 상태 페이지",
 * while the translated docs went on naming the types by their English
 * titles. A reader met one name on the screen and another in the docs.
 *
 * Every translated page names a type, whose title has two words or more and
 * which its language's locale words, as that locale draws it - in prose, in
 * a table and in a heading. Left as written:
 *
 * - code, inline or fenced: it quotes what it quotes;
 * - a bold span: it quotes a label, which the label suites hold to the
 *   Dashboard;
 * - a link's text: it follows the page or heading it opens;
 * - a title that is part of a longer English name, one the English docs or
 *   the Dashboard write with the word beside it (Edit Network Device, a
 *   permission; Storage Array Dashboard; External Status Page Is Online, a
 *   criteria check).
 */

const FEATURE_SET: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
);
const DOCS: string = path.join(FEATURE_SET, "Docs", "Content");

// The types whose title is a name of two words or more: one word is too often another word.
function titleOf(type: MonitorType): string | null {
  try {
    return MonitorTypeHelper.getTitle(type);
  } catch {
    // A type the picker does not offer has no title.
    return null;
  }
}

const TITLES: Array<string> = Array.from(
  new Set(
    Object.values(MonitorType)
      .map(titleOf)
      .filter((title: string | null): title is string => {
        return title !== null;
      }),
  ),
)
  .filter((title: string): boolean => {
    return title.includes(" ");
  })
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  });

function readLocale(language: string): Record<string, unknown> | null {
  const file: string = path.join(
    FEATURE_SET,
    "Dashboard",
    "src",
    "Locales",
    `${language}.json`,
  );

  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
    : null;
}

function pagesOf(language: string): Array<string> {
  const root: string = path.join(DOCS, language);
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(root, full));
      }
    }
  };

  walk(root);

  return pages.sort();
}

// What the product and its English docs write, to tell a longer English name.
const ENGLISH: string = [
  ...pagesOf("en").map((page: string): string => {
    return fs.readFileSync(path.join(DOCS, "en", page), "utf8");
  }),
  ...Object.keys(readLocale("en")!),
].join("\n");

/*
 * The sections the product's own help links open by their English anchor in
 * every language, such as the builder's /docs/workflows/triggers#incoming-email
 * (WorkflowDocsPaths): their headings keep the English title, so the anchor
 * stays.
 */
const ANCHORS_THE_PRODUCT_OPENS: Set<string> = new Set<string>(
  Object.values(WorkflowDocsPaths)
    .filter((target: string): boolean => {
      return target.includes("#");
    })
    .map((target: string): string => {
      return target.replace(/^\//, "");
    }),
);
const HEADING: RegExp = /^#{1,6}\s+(.*)$/;

// A code fence's line, and a title glued to a letter: inside a longer word.
const FENCE: RegExp = /^\s*```/;
const ENDS_IN_A_LETTER: RegExp = /[A-Za-z]$/;
const STARTS_WITH_A_LETTER: RegExp = /^[A-Za-z]/;

// The pieces of a line a type's name is left alone in: code, bold, a link.
const LEFT_AS_WRITTEN: RegExp =
  /(`[^`]*`|\*\*[^*\n]+\*\*|!?\[[^\]]*\]\([^)]*\))/;

/*
 * "<page>:<line> <title>" for each English title a page's text writes where
 * its language draws the type another way. `drawn` is the language's title
 * for each English one, `english` the corpus that tells a longer name.
 */
function englishTitles(
  pages: Array<{ page: string; text: string }>,
  drawn: Record<string, string>,
  english: string,
): Array<string> {
  const found: Array<string> = [];

  for (const { page, text } of pages) {
    let fenced: boolean = false;

    text.split("\n").forEach((line: string, index: number) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return;
      }

      if (fenced) {
        return;
      }

      // A heading the product links to by its English anchor keeps it.
      const heading: RegExpMatchArray | null = line.match(HEADING);

      if (
        heading &&
        ANCHORS_THE_PRODUCT_OPENS.has(
          `${page.replace(/\.md$/, "")}#${slugifyMarkdownHeading(heading[1] as string)}`,
        )
      ) {
        return;
      }

      line.split(LEFT_AS_WRITTEN).forEach((piece: string, n: number) => {
        if (n % 2 === 1) {
          return;
        }

        for (const title of TITLES) {
          if (!drawn[title] || drawn[title] === title) {
            continue;
          }

          let at: number = piece.indexOf(title);

          while (at >= 0) {
            const before: string = piece.slice(0, at);
            const after: string = piece.slice(at + title.length);
            const previous: string | undefined = (before.match(
              /([A-Za-z][A-Za-z-]*) $/,
            ) || [])[1];
            const next: string | undefined = (after.match(
              /^ ([A-Za-z][A-Za-z-]*)/,
            ) || [])[1];
            const longer: boolean =
              ENDS_IN_A_LETTER.test(before) ||
              STARTS_WITH_A_LETTER.test(after) ||
              Boolean(previous && english.includes(`${previous} ${title}`)) ||
              Boolean(next && english.includes(`${title} ${next}`));

            if (!longer) {
              found.push(`${page}:${index + 1} ${title}`);
            }

            at = piece.indexOf(title, at + title.length);
          }
        }
      });
    });
  }

  return found;
}

function drawnTitles(language: string): Record<string, string> {
  const locale: Record<string, unknown> = readLocale(language) || {};
  const drawn: Record<string, string> = {};

  for (const title of TITLES) {
    if (typeof locale[title] === "string") {
      drawn[title] = locale[title] as string;
    }
  }

  return drawn;
}

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en" && readLocale(language) !== null;
  },
);

describe("the monitor types in the translated docs", () => {
  test("are the multi-word titles of the type picker", () => {
    expect(TITLES).toEqual(
      expect.arrayContaining([
        "Custom JavaScript Code",
        "External Status Page",
        "SQL Query",
        "Synthetic Monitor",
        "Incoming Email",
        "Network Device",
      ]),
    );
    expect(TITLES).not.toContain("Website");
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(15);
  });

  test.each(LANGUAGES)(
    "%s: names every type as its picker draws it, wherever a page writes it",
    (language: string) => {
      expect({
        language,
        english: englishTitles(
          pagesOf(language).map((page: string) => {
            return {
              page,
              text: fs.readFileSync(path.join(DOCS, language, page), "utf8"),
            };
          }),
          drawnTitles(language),
          ENGLISH,
        ),
      }).toEqual({ language, english: [] });
    },
  );

  test("the rule reads real pages: German names the HTTP transports as its picker does", () => {
    const page: string = fs.readFileSync(
      path.join(DOCS, "de", "self-hosted", "private-network-access.md"),
      "utf8",
    );

    expect(page).toContain(drawnTitles("de")["External Status Page"]!);
    expect(page).toContain(drawnTitles("de")["Custom JavaScript Code"]!);
  });

  test("a heading the builder's step help opens keeps its English anchor in every language", () => {
    expect(ANCHORS_THE_PRODUCT_OPENS).toContain(
      "workflows/triggers#incoming-email",
    );

    for (const language of LANGUAGES) {
      expect({
        language,
        kept: fs
          .readFileSync(
            path.join(DOCS, language, "workflows", "triggers.md"),
            "utf8",
          )
          .split("\n")
          .includes("## Incoming Email"),
      }).toEqual({ language, kept: true });
    }
  });

  // What the check would see if a page went back to an English title.
  test("an English title in prose, a table or a heading is found, and code, bold, a link and a longer name are not (negative control)", () => {
    const drawn: Record<string, string> = {
      "SQL Query": "SQL-Abfrage",
      "External Status Page": "Externe Statusseite",
      "Network Device": "Netzwerkgerät",
    };
    const text: string = [
      "Ein SQL Query-Monitor fragt die Datenbank ab.",
      "| External Status Page | Die URL der Statusseite |",
      "## Einen SQL Query-Monitor erstellen",
      "Setzen Sie `SQL Query` als Typ, siehe **SQL Query**.",
      "Siehe [SQL Query](/docs/monitor/sql-monitor).",
      "Die Prüfung `External Status Page Is Online` und External Status Page Is Online.",
      "Die Berechtigung Edit Network Device.",
      "```",
      "type: SQL Query",
      "```",
    ].join("\n");

    expect(
      englishTitles(
        [{ page: "planted.md", text }],
        drawn,
        "External Status Page Is Online\nEdit Network Device",
      ),
    ).toEqual([
      "planted.md:1 SQL Query",
      "planted.md:2 External Status Page",
      "planted.md:3 SQL Query",
    ]);
  });
});
