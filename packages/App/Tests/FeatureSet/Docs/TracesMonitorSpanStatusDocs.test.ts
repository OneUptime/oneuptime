import slugify from "Common/Server/Types/MarkdownSlugify";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "Common/Types/Docs/DocsLanguage";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusPresentation,
} from "../../../FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import { toSpanStatusCode } from "../../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Span Status Codes" section of monitor/traces-monitor, in every docs
 * language, and the status row of the search syntax page (issue #4118).
 *
 * UNSET is OpenTelemetry's default span status: instrumentation sets ERROR
 * when an operation fails and leaves a successful span UNSET. The page used
 * to say UNSET meant "Status was not explicitly set", next to a Traces chart
 * that painted it grey, so a healthy service read as mostly unknown. The
 * section now says UNSET means no error was recorded, quotes the label the
 * Dashboard gives it, says to filter on ERROR for failures and to select OK
 * and UNSET together for everything that did not fail, and shows the trace
 * pipeline that marks successful HTTP spans Ok. That recipe is run through
 * the real pipeline code in Tests/Telemetry/TraceStatusPipelineRecipe.test.ts;
 * this file checks that all 17 copies of the page say the same things.
 *
 * Markdown is not compiled, so nothing else notices when one copy drifts: a
 * translation that keeps the old bullet, drops a code span or a bold marker,
 * or leaves an English sentence in place. Each copy must have the English
 * section's shape (the three status bullets, then two paragraphs), the same
 * code spans, the same recipe layout, and prose of its own.
 *
 * Every heading stays exactly as it was. The renderer ids a heading with
 * slugify, so rewording one would move the section's anchor
 * (#span-status-codes in English, a translated id in each translation).
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE: string = "monitor/traces-monitor";
const PAGE_URL: string = `/docs/${PAGE}`;
const SEARCH_SYNTAX_PAGE: string = "telemetry/search-syntax";

const ENGLISH_ANCHOR: string = "span-status-codes";

/*
 * The section heading in every language, as it read before the UNSET
 * explanation was added. The Hindi page's heading is in English.
 */
const SECTION_HEADINGS: Readonly<Record<string, string>> = {
  da: "### Span-statuskoder",
  de: "### Span-Statuscodes",
  en: "### Span Status Codes",
  es: "### Códigos de estado de span",
  fa: "### کدهای وضعیت اسپن",
  fr: "### Codes de statut de span",
  hi: "### Span Status Codes",
  it: "### Codici di Stato degli Span",
  ja: "### スパンステータスコード",
  ko: "### 스팬 상태 코드",
  nl: "### Span-statuscodes",
  no: "### Span-statuskoder",
  pt: "### Códigos de Status de Span",
  ru: "### Коды статуса спанов",
  sv: "### Span-statuskoder",
  "zh-CN": "### Span 状态码",
  "zh-TW": "### Span 狀態碼",
};

// The status bullets, in the order every copy lists them.
const STATUS_NAMES: ReadonlyArray<string> = ["OK", "ERROR", "UNSET"];

// What the English bullets said before #4118.
const OLD_UNSET_WORDING: string = "Status was not explicitly set";
const OLD_OK_WORDING: string = "The operation completed successfully";

const RECIPE_ATTRIBUTE: string = "http.response.status_code";
const SEARCH_STATUS_VALUES: ReadonlyArray<string> = ["ok", "error", "unset"];

// What the chart legend and the Status facet call an Unset span.
const UNSET_DISPLAY_LABEL: string = getSpanStatusPresentation(
  SpanStatus.Unset,
).displayLabel;

const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_LINE: RegExp = /^(#{1,6})\s+\S/;
const LIST_ITEM_LINE: RegExp = /^- /;
/* "- **OK** — ...", with an en dash (da, no, sv) or a colon (es) instead. */
const STATUS_BULLET: RegExp = /^- \*\*([A-Z]+)\*\*\s*[—–:-]\s*(\S.*)$/;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const BOLD_SPAN: RegExp = /\*\*([^*\n]+)\*\*/g;
const TODO_MARKER: RegExp = /TODO\(i18n\)/;
/* A sentence end, or the dash between a status and its description. */
const PHRASE_BREAK: RegExp = /[.!?](?:\s+|$)|\s[—–]\s/;
const MIN_PHRASE_WORDS: number = 4;
const SEARCH_STATUS_ROW: RegExp = /^\|\s*`status`\s*\|(.*)\|\s*$/;
/* "(unset = no error recorded, the OpenTelemetry default)", in any language. */
const UNSET_EXPLANATION: RegExp = /\(unset\b[^)]*OpenTelemetry[^)]*\)/;

const LANGUAGES: ReadonlyArray<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

const TRANSLATED_LANGUAGES: ReadonlyArray<string> = LANGUAGES.filter(
  (lang: string): boolean => {
    return lang !== DEFAULT_DOCS_LANGUAGE;
  },
);

interface Heading {
  level: number;
  // 0-based line index in the page.
  line: number;
  // The heading line as written, e.g. "### Span Status Codes".
  source: string;
}

interface StatusSection {
  heading: Heading;
  // Everything up to the next heading of the same or a higher level.
  body: string;
}

interface StatusBullet {
  status: string;
  description: string;
}

function pagePath(lang: string, page: string): string {
  return path.join(CONTENT_DIR, lang, `${page}.md`);
}

function readPage(lang: string, page: string): string {
  return fs.readFileSync(pagePath(lang, page), "utf8");
}

function headingFor(lang: string): string {
  const heading: string | undefined = SECTION_HEADINGS[lang];

  expect({ lang, recorded: heading !== undefined }).toEqual({
    lang,
    recorded: true,
  });

  return heading as string;
}

/*
 * Headings outside fenced blocks, the way Scripts/Docs/CheckAnchors.ts reads
 * them: a `#` line inside a fence is a shell comment, not a heading.
 */
function headingsOf(lines: ReadonlyArray<string>): Array<Heading> {
  const headings: Array<Heading> = [];
  let inFence: boolean = false;

  lines.forEach((line: string, index: number): void => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }

    if (inFence) {
      return;
    }

    const match: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (match) {
      headings.push({
        level: match[1]!.length,
        line: index,
        source: line.trim(),
      });
    }
  });

  return headings;
}

/* The section under the language's recorded heading, which must appear once. */
function statusSectionOf(lang: string): StatusSection {
  const lines: Array<string> = readPage(lang, PAGE).split(/\r?\n/);
  const headings: Array<Heading> = headingsOf(lines);
  const expected: string = headingFor(lang);

  const matches: Array<Heading> = headings.filter(
    (heading: Heading): boolean => {
      return heading.source === expected;
    },
  );

  expect({ lang, headings: matches.length }).toEqual({ lang, headings: 1 });

  const heading: Heading = matches[0]!;
  const next: Heading | undefined = headings.find(
    (candidate: Heading): boolean => {
      return candidate.line > heading.line && candidate.level <= heading.level;
    },
  );

  return {
    heading,
    body: lines
      .slice(heading.line + 1, next ? next.line : lines.length)
      .join("\n"),
  };
}

/* Runs of lines separated by blank lines: a list is one block, a paragraph another. */
function blocksOf(body: string): Array<string> {
  return body
    .split(/\n\s*\n/)
    .map((block: string): string => {
      return block.trim();
    })
    .filter((block: string): boolean => {
      return block.length > 0;
    });
}

/* "list of 3" for a block of list items, "paragraph" for anything else. */
function shapeOf(body: string): Array<string> {
  return blocksOf(body).map((block: string): string => {
    const lines: Array<string> = block.split("\n");
    const isList: boolean = lines.every((line: string): boolean => {
      return LIST_ITEM_LINE.test(line);
    });

    return isList ? `list of ${lines.length}` : "paragraph";
  });
}

/*
 * The section's first block read as status bullets. A line that is not one
 * keeps its text as the status, so a failure shows what is there instead.
 */
function statusBulletsOf(section: StatusSection): Array<StatusBullet> {
  const firstBlock: string = blocksOf(section.body)[0] ?? "";

  return firstBlock.split("\n").map((line: string): StatusBullet => {
    const match: RegExpMatchArray | null = line.match(STATUS_BULLET);

    return match
      ? { status: match[1]!, description: match[2]! }
      : { status: line, description: "" };
  });
}

function descriptionOf(section: StatusSection, status: string): string {
  const bullet: StatusBullet | undefined = statusBulletsOf(section).find(
    (candidate: StatusBullet): boolean => {
      return candidate.status === status;
    },
  );

  expect({ status, found: bullet !== undefined }).toEqual({
    status,
    found: true,
  });

  return (bullet as StatusBullet).description;
}

function codeSpansOf(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function boldSpansOf(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

/* A backtick or `**` left over once every code span and bold span is taken out. */
function strayMarkupOf(text: string): Array<string> {
  const rest: string = text.replace(CODE_SPAN, " ").replace(BOLD_SPAN, " ");

  return ["`", "**"].filter((marker: string): boolean => {
    return rest.includes(marker);
  });
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/* One line as prose: code spans, bold markers and the list marker dropped. */
function proseOf(line: string): string {
  return line
    .replace(CODE_SPAN, " ")
    .replace(/\*\*/g, "")
    .replace(LIST_ITEM_LINE, "");
}

function sectionProseOf(body: string): string {
  return normalized(
    body
      .split("\n")
      .map((line: string): string => {
        return proseOf(line);
      })
      .join(" "),
  );
}

/*
 * The English section cut into sentences and bullet descriptions. Status
 * names, code spans and the quoted label are shared by every language, so
 * fragments shorter than a few words are not counted.
 */
function englishPhrasesOf(body: string): Array<string> {
  const phrases: Array<string> = [];

  for (const line of body.split("\n")) {
    for (const phrase of proseOf(line).split(PHRASE_BREAK)) {
      const text: string = normalized(phrase);

      if (text.split(" ").length >= MIN_PHRASE_WORDS) {
        phrases.push(text);
      }
    }
  }

  return phrases;
}

/* The notes cell of the Traces table's `status` row. */
function searchStatusNotesOf(lang: string): string {
  const rows: Array<RegExpMatchArray> = readPage(lang, SEARCH_SYNTAX_PAGE)
    .split(/\r?\n/)
    .map((line: string): RegExpMatchArray | null => {
      return line.match(SEARCH_STATUS_ROW);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    });

  expect({ lang, rows: rows.length }).toEqual({ lang, rows: 1 });

  return rows[0]![1]!.trim();
}

describe("Traces monitor docs: span status codes (#4118)", (): void => {
  describe("coverage", (): void => {
    test("reads the 17 supported languages from disk, each with a recorded heading", (): void => {
      expect(LANGUAGES).toHaveLength(17);
      expect(LANGUAGES).toEqual([...SUPPORTED_DOCS_LANGUAGE_CODES].sort());
      expect(Object.keys(SECTION_HEADINGS).sort()).toEqual(LANGUAGES);
      expect(TRANSLATED_LANGUAGES).toHaveLength(16);
    });

    test("is the page the docs navigation links as Traces Monitor", (): void => {
      const link: NavLink | undefined = DocsNav.flatMap(
        (group: NavGroup): Array<NavLink> => {
          return group.links;
        },
      ).find((candidate: NavLink): boolean => {
        return candidate.url === PAGE_URL;
      });

      expect(link?.title).toBe("Traces Monitor");
    });

    test("cuts the English section into the sentences the translations are checked against", (): void => {
      const phrases: Array<string> = englishPhrasesOf(
        statusSectionOf(DEFAULT_DOCS_LANGUAGE).body,
      );

      expect(phrases).toEqual(
        expect.arrayContaining([
          "the operation encountered an error",
          "no error was recorded",
          "unset does not mean data is missing",
          "to alert on failures, filter on error",
          "to count every span that did not fail, select both ok and unset",
        ]),
      );
      expect(phrases).not.toContain("ok");
    });
  });

  describe("the English section", (): void => {
    test("keeps the heading the #span-status-codes anchor is made from", (): void => {
      const heading: Heading = statusSectionOf(DEFAULT_DOCS_LANGUAGE).heading;

      expect(heading.source).toBe("### Span Status Codes");
      expect(heading.level).toBe(3);
      expect(slugify(heading.source.replace(/^#+\s+/, ""))).toBe(
        ENGLISH_ANCHOR,
      );
    });

    test("is the three status bullets, then two paragraphs", (): void => {
      expect(shapeOf(statusSectionOf(DEFAULT_DOCS_LANGUAGE).body)).toEqual([
        "list of 3",
        "paragraph",
        "paragraph",
      ]);
    });

    test("REGRESSION: UNSET means no error was recorded, the OpenTelemetry default", (): void => {
      const unset: string = descriptionOf(
        statusSectionOf(DEFAULT_DOCS_LANGUAGE),
        "UNSET",
      );

      expect(unset).toContain("No error was recorded");
      expect(unset).toContain("OpenTelemetry default");
      expect(readPage(DEFAULT_DOCS_LANGUAGE, PAGE)).not.toContain(
        OLD_UNSET_WORDING,
      );
    });

    test("REGRESSION: OK is an explicit success, not every operation that succeeded", (): void => {
      const ok: string = descriptionOf(
        statusSectionOf(DEFAULT_DOCS_LANGUAGE),
        "OK",
      );

      expect(ok).toContain("explicitly marked successful");
      expect(ok).toContain("trace pipeline");
      expect(readPage(DEFAULT_DOCS_LANGUAGE, PAGE)).not.toContain(
        OLD_OK_WORDING,
      );
    });

    test("REGRESSION: says UNSET is not missing data, and what to filter on for failures and for everything else", (): void => {
      const explanation: string =
        blocksOf(statusSectionOf(DEFAULT_DOCS_LANGUAGE).body)[1] ?? "";

      expect(explanation).toContain("UNSET does not mean data is missing.");
      expect(explanation).toContain("leaves successful spans UNSET");
      expect(explanation).toContain(`in green as "${UNSET_DISPLAY_LABEL}"`);
      expect(explanation).toContain("To alert on failures, filter on ERROR.");
      expect(explanation).toContain("select both OK and UNSET");
    });

    test("gives the trace pipeline that shows successful HTTP spans as Ok", (): void => {
      const recipe: string =
        blocksOf(statusSectionOf(DEFAULT_DOCS_LANGUAGE).body)[2] ?? "";

      expect(boldSpansOf(recipe)).toEqual([
        "Traces > Settings > Pipelines",
        "Status = Unset",
        "Status Remapper",
      ]);
      expect(recipe).toContain(
        `maps \`${RECIPE_ATTRIBUTE}\` values such as \`200\` to Ok`,
      );
    });
  });

  describe.each(LANGUAGES)("%s", (lang: string): void => {
    test("ships the page", (): void => {
      expect(fs.existsSync(pagePath(lang, PAGE))).toBe(true);
    });

    test("keeps the section heading it had before the UNSET explanation", (): void => {
      const heading: Heading = statusSectionOf(lang).heading;

      expect(heading.source).toBe(headingFor(lang));
      expect(heading.level).toBe(3);
    });

    test("opens the section with the OK, ERROR and UNSET bullets, in that order", (): void => {
      const bullets: Array<StatusBullet> = statusBulletsOf(
        statusSectionOf(lang),
      );

      expect(
        bullets.map((bullet: StatusBullet): string => {
          return bullet.status;
        }),
      ).toEqual([...STATUS_NAMES]);

      for (const bullet of bullets) {
        expect({
          status: bullet.status,
          described: bullet.description,
        }).not.toEqual({ status: bullet.status, described: "" });
      }
    });

    test("REGRESSION: calls UNSET the OpenTelemetry default", (): void => {
      expect(descriptionOf(statusSectionOf(lang), "UNSET")).toContain(
        "OpenTelemetry",
      );
    });

    test("REGRESSION: quotes the Unset (no error) label and names the attribute the recipe maps", (): void => {
      const body: string = statusSectionOf(lang).body;

      expect(body).toContain(UNSET_DISPLAY_LABEL);
      expect(body).toContain(`\`${RECIPE_ATTRIBUTE}\``);
    });

    test("has the English section's shape and code spans", (): void => {
      const english: string = statusSectionOf(DEFAULT_DOCS_LANGUAGE).body;
      const body: string = statusSectionOf(lang).body;

      expect(shapeOf(body)).toEqual(shapeOf(english));
      expect(codeSpansOf(body)).toEqual(codeSpansOf(english));
    });

    test("names the recipe's menu path, filter condition and processor in well-formed bold", (): void => {
      const body: string = statusSectionOf(lang).body;
      const bold: Array<string> = boldSpansOf(body);

      expect(strayMarkupOf(body)).toEqual([]);
      expect(bold).toHaveLength(STATUS_NAMES.length + 3);
      expect(bold.slice(0, STATUS_NAMES.length)).toEqual([...STATUS_NAMES]);

      const menuPath: string = bold[3] ?? "";
      const filter: string = bold[4] ?? "";
      const processor: string = bold[5] ?? "";

      expect(
        menuPath.split(" > ").filter((step: string): boolean => {
          return step.trim().length > 0;
        }),
      ).toHaveLength(3);
      expect(filter).toMatch(/^\S[^=]* = \S/);
      expect(processor.trim().length).toBeGreaterThan(0);
      expect(processor).not.toMatch(/ [>=] /);
    });
  });

  describe.each(TRANSLATED_LANGUAGES)(
    "%s translation",
    (lang: string): void => {
      test("leaves none of the English section's sentences untranslated", (): void => {
        const prose: string = sectionProseOf(statusSectionOf(lang).body);
        const untranslated: Array<string> = englishPhrasesOf(
          statusSectionOf(DEFAULT_DOCS_LANGUAGE).body,
        ).filter((phrase: string): boolean => {
          return prose.includes(phrase);
        });

        expect({ lang, untranslated }).toEqual({ lang, untranslated: [] });
      });

      test("carries no deferred-translation marker", (): void => {
        expect(TODO_MARKER.test(statusSectionOf(lang).body)).toBe(false);
      });
    },
  );

  describe("the Dashboard the section describes", (): void => {
    test("lists exactly the statuses the Dashboard presents", (): void => {
      const presented: Array<string> = SPAN_STATUS_PRESENTATIONS.map(
        (presentation: SpanStatusPresentation): string => {
          return presentation.label.toUpperCase();
        },
      );

      expect([...presented].sort()).toEqual([...STATUS_NAMES].sort());
    });

    test("REGRESSION: shows Unset in green, under the label every copy quotes", (): void => {
      const unset: SpanStatusPresentation = getSpanStatusPresentation(
        SpanStatus.Unset,
      );

      expect(unset.displayLabel).toBe("Unset (no error)");
      expect(unset.dotClassName).toMatch(/^bg-(emerald|green)-\d+$/);
    });
  });

  describe("search syntax: the status field", (): void => {
    test("REGRESSION: the English row says unset means no error was recorded", (): void => {
      const notes: string = searchStatusNotesOf(DEFAULT_DOCS_LANGUAGE);

      expect(notes).toContain("unset = no error recorded");
      expect(notes).toContain("the OpenTelemetry default");
    });

    test("lists the values trace search resolves to Ok, Error and Unset", (): void => {
      const values: Array<string> = codeSpansOf(
        searchStatusNotesOf(DEFAULT_DOCS_LANGUAGE),
      );

      expect(values).toEqual([...SEARCH_STATUS_VALUES]);
      expect(
        values.map((value: string): number => {
          return toSpanStatusCode(value);
        }),
      ).toEqual([SpanStatus.Ok, SpanStatus.Error, SpanStatus.Unset]);
    });

    test("explains unset in every language that ships the page", (): void => {
      const shipped: Array<string> = LANGUAGES.filter(
        (lang: string): boolean => {
          return fs.existsSync(pagePath(lang, SEARCH_SYNTAX_PAGE));
        },
      );

      expect(shipped).toContain(DEFAULT_DOCS_LANGUAGE);

      for (const lang of shipped) {
        const notes: string = searchStatusNotesOf(lang);

        expect({ lang, values: codeSpansOf(notes) }).toEqual({
          lang,
          values: [...SEARCH_STATUS_VALUES],
        });
        expect({ lang, explained: UNSET_EXPLANATION.test(notes) }).toEqual({
          lang,
          explained: true,
        });
      }
    });
  });
});
