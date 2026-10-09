import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  getToolImportSourceDefinition,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import {
  TOOL_IMPORT_MAX_ITEMS,
  TOOL_IMPORT_MAX_ITEMS_PER_KIND,
  TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
} from "Common/Types/ToolImport/ToolImportLimits";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Moving to OneUptime" pages - one per tool Project Settings > Import
 * from another tool brings a team over from - against the product they
 * describe. Markdown is not compiled, so nothing else notices a tool added
 * without its page, a page that names a host the import never calls, a
 * limit that changed in code but not in the docs, or a button the page
 * tells a reader to select under a name the page does not show in their
 * language. Each fact is read from where it lives: the hosts and the kinds
 * from ToolImportCatalog, the limits from ToolImportLimits, the names of
 * the page's controls from the Dashboard's own locale files.
 */

const DOCS_DIR: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const NAV_GROUP_TITLE: string = "Moving to OneUptime";

const FENCE_LINE: RegExp = /^\s*```/;
const LEVEL_TWO_HEADING: RegExp = /^## (.+)$/;
const BOLD_TEXT: RegExp = /\*\*([^*]+)\*\*/g;
const TABLE_ROW: RegExp = /^\|/;
const TABLE_SEPARATOR: RegExp = /^\|\s*-/;
const WHOLE_NUMBER: RegExp = /\d+/g;
const NON_ASCII_DIGIT: RegExp = /[٠-٩۰-۹]/g;
const THOUSANDS_SEPARATOR: RegExp = /(\d)[.,\s٬'](?=\d{3}(?!\d))/g;
const TOOL_PLACEHOLDER: RegExp = /\{\{tool\}\}/g;

// The sections every page has, in this order, in every language.
const SECTION_INDEX: { comesOver: number; limits: number } = {
  comesOver: 3,
  limits: 5,
};

interface PageSection {
  heading: string;
  body: string;
}

function pagePathOf(source: ToolImportSource): string {
  return getToolImportSourceDefinition(source).docsPath.replace("/docs/", "");
}

function readPage(lang: string, source: ToolImportSource): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${pagePathOf(source)}.md`),
    "utf8",
  );
}

function readDashboardLocale(lang: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  ) as Record<string, string>;
}

// The page's level-two sections, outside fenced blocks.
function sectionsOf(markdown: string): Array<PageSection> {
  const sections: Array<PageSection> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(LEVEL_TWO_HEADING);

    if (heading) {
      sections.push({ heading: heading[1]!, body: "" });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.body += `${line}\n`;
    }
  }

  return sections;
}

function introOf(markdown: string): string {
  return markdown.split("\n").slice(1).join("\n").split(":::cards")[0]!;
}

// Every whole number in the text, written in ASCII digits without grouping.
function numbersIn(text: string): Set<number> {
  const normalized: string = text
    .replace(NON_ASCII_DIGIT, (digit: string): string => {
      const code: number = digit.charCodeAt(0);

      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(THOUSANDS_SEPARATOR, "$1");

  return new Set(
    Array.from(normalized.matchAll(WHOLE_NUMBER), (match: RegExpMatchArray) => {
      return Number(match[0]);
    }),
  );
}

function boldTextIn(markdown: string): Set<string> {
  return new Set(
    Array.from(markdown.matchAll(BOLD_TEXT), (match: RegExpMatchArray) => {
      return match[1]!;
    }),
  );
}

function tableRowsIn(text: string): Array<string> {
  return text.split("\n").filter((line: string): boolean => {
    return TABLE_ROW.test(line);
  });
}

const group: NavGroup | undefined = DocsNav.find((item: NavGroup): boolean => {
  return item.title === NAV_GROUP_TITLE;
});

describe("the Moving to OneUptime docs", () => {
  test("the nav lists one page per tool the import brings a team over from, at the tool's docs path", () => {
    expect(group).toBeDefined();
    expect(
      group!.links.map((link: NavLink): { title: string; url: string } => {
        return { title: link.title, url: link.url };
      }),
    ).toEqual(
      AllToolImportSources.map((source: ToolImportSource) => {
        const definition: ToolImportSourceDefinition =
          getToolImportSourceDefinition(source);

        return {
          title: `Moving from ${definition.title}`,
          url: definition.docsPath,
        };
      }),
    );
  });

  test("every tool's page is written in every docs language, with the same sections", () => {
    for (const source of AllToolImportSources) {
      const english: Array<PageSection> = sectionsOf(readPage("en", source));

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          source,
          sections: sectionsOf(readPage(lang, source)).length,
        }).toEqual({ lang, source, sections: english.length });
      }
    }
  });
});

describe.each(AllToolImportSources)(
  "the page on moving from %s",
  (source: ToolImportSource) => {
    const definition: ToolImportSourceDefinition =
      getToolImportSourceDefinition(source);
    const otherHosts: Array<string> = AllToolImportSources.filter(
      (other: ToolImportSource): boolean => {
        return other !== source;
      },
    ).flatMap((other: ToolImportSource): Array<string> => {
      return getToolImportSourceDefinition(other).hosts;
    });

    test("names every host the import calls, and no other tool's, in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const page: string = readPage(lang, source);

        for (const host of definition.hosts) {
          expect({ lang, host, named: page.includes(`\`${host}\``) }).toEqual({
            lang,
            host,
            named: true,
          });
        }

        for (const host of otherHosts) {
          expect({ lang, host, named: page.includes(host) }).toEqual({
            lang,
            host,
            named: false,
          });
        }
      }
    });

    test("lists one row per kind the import brings over, in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const rows: Array<string> = tableRowsIn(
          sectionsOf(readPage(lang, source))[SECTION_INDEX.comesOver]!.body,
        ).filter((row: string): boolean => {
          return !TABLE_SEPARATOR.test(row);
        });

        // The header row, then one row per kind.
        expect({ lang, rows: rows.length - 1 }).toEqual({
          lang,
          rows: definition.kinds.length,
        });
      }
    });

    test("states the import's limits, in every language", () => {
      const expected: Array<number> = [
        TOOL_IMPORT_MAX_ITEMS,
        ...definition.kinds.map((kind: ToolImportResourceKind): number => {
          return TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind];
        }),
      ];

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const stated: Set<number> = numbersIn(
          sectionsOf(readPage(lang, source))[SECTION_INDEX.limits]!.body,
        );

        expect({
          lang,
          missing: expected.filter((limit: number): boolean => {
            return !stated.has(limit);
          }),
        }).toEqual({ lang, missing: [] });
      }
    });

    test("tells a reader to select the page's controls by the names the page shows in their language", () => {
      const names: Array<string> = [
        "Project Settings",
        "Import from another tool",
        "Read my {{tool}} account",
        "Tick them too",
        "Invite new people to",
        "Start import",
        "Earlier imports",
        "Try again",
        "On-Call Duty",
        "On-Call Schedules",
        "Readiness",
        `${definition.title} API key`,
      ];

      if (definition.regions.length > 0) {
        names.push(`Where is your ${definition.title} account?`);
      }

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: Record<string, string> = readDashboardLocale(lang);
        const bold: Set<string> = boldTextIn(readPage(lang, source));

        for (const name of names) {
          const shown: string | undefined = locale[name];

          expect({ lang, name, inLocale: shown !== undefined }).toEqual({
            lang,
            name,
            inLocale: true,
          });
          expect({
            lang,
            name,
            quoted: bold.has(
              shown!.replace(TOOL_PLACEHOLDER, definition.title),
            ),
          }).toEqual({ lang, name, quoted: true });
        }
      }
    });
  },
);

describe("what the pages promise in English", () => {
  test("Opsgenie's page says plainly that Atlassian is retiring it, in every language", () => {
    expect(introOf(readPage("en", ToolImportSource.OpsGenie))).toContain(
      "Atlassian is retiring Opsgenie: it stopped selling Opsgenie in June 2025 and ends support for it in April 2027.",
    );

    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const intro: string = introOf(readPage(lang, ToolImportSource.OpsGenie));
      const years: Set<number> = numbersIn(intro);

      expect({
        lang,
        atlassian: intro.includes("Atlassian"),
        years: [years.has(2025), years.has(2027)],
      }).toEqual({ lang, atlassian: true, years: [true, true] });
    }
  });

  test("a preview is kept for a day, as long as the import keeps one", () => {
    expect(TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS).toBe(24 * 60 * 60 * 1000);

    for (const source of AllToolImportSources) {
      expect(readPage("en", source)).toContain("A preview is kept for a day.");
    }
  });

  test("the limits are spelled out per kind, with the number in code", () => {
    const phrases: Record<ToolImportResourceKind, string> = {
      [ToolImportResourceKind.Person]: "people",
      [ToolImportResourceKind.Team]: "teams",
      [ToolImportResourceKind.OnCallSchedule]: "on-call schedules",
      [ToolImportResourceKind.OnCallPolicy]: "on-call policies",
      [ToolImportResourceKind.Service]: "services",
      [ToolImportResourceKind.IncidentCustomField]: "incident custom fields",
      [ToolImportResourceKind.IncidentSeverity]:
        "each of incident severities, states and roles",
      [ToolImportResourceKind.IncidentState]:
        "each of incident severities, states and roles",
      [ToolImportResourceKind.IncidentRole]:
        "each of incident severities, states and roles",
    };

    for (const source of AllToolImportSources) {
      const limits: string = sectionsOf(readPage("en", source))[
        SECTION_INDEX.limits
      ]!.body;

      expect(limits).toContain(
        `One import creates at most ${TOOL_IMPORT_MAX_ITEMS.toLocaleString("en-US")} records`,
      );

      for (const kind of getToolImportSourceDefinition(source).kinds) {
        expect(limits).toContain(
          `${TOOL_IMPORT_MAX_ITEMS_PER_KIND[kind]} ${phrases[kind]}`,
        );
      }
    }
  });

  test("the helpers read what they claim to", () => {
    expect([...numbersIn("2,000 · 2.000 · 2 000 · ۲٬۰۰۰ · 500, 200")]).toEqual([
      2000, 500, 200,
    ]);
    expect(
      sectionsOf("# T\n\n## A\nx\n```\n## not a heading\n```\n## B\ny\n").map(
        (section: PageSection): string => {
          return section.heading;
        },
      ),
    ).toEqual(["A", "B"]);
  });
});
