import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ALERT_NEXT_NUMBERS,
  HIGHEST_SO_FAR_LABEL,
  INCIDENT_NEXT_NUMBERS,
  NEXT_NUMBER_CARD_TITLE,
  NEXT_NUMBER_EDIT_BUTTON_TITLE,
  NEXT_NUMBER_EDIT_MODAL_TITLE,
  NONE_USED_YET,
  NextNumberRow,
  SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
} from "../../../FeatureSet/Dashboard/src/Components/NextNumber/NextNumberSettings";
import {
  MORE_SETTINGS_PATH,
  NUMBER_PREFIX_PAGE_TITLE,
  NUMBER_PREFIX_PATH,
} from "../../../FeatureSet/Dashboard/src/Components/NumberPrefix/NumberPrefixSettings";
import { DocsHeading, DocsLink, scanMarkdown } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { toLatinDigits } from "./DocsTranslationChecks";
import {
  ToolImportCategory,
  getToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import NextNumberUtil, {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
} from "Common/Utils/Project/NextNumber";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Incidents, Alerts and Scheduled Maintenance each have a Numbering page:
 * the Number Prefix card (the text in front of a number) and, under it, the
 * Next Number card (the number the next record gets, so a team moving from
 * another tool carries on from that tool's numbers). The page was called
 * Number Prefix, and More Settings before that; both old addresses forward
 * to it. The incident docs describe the page in 17 languages: English and
 * Persian in full, the other 15 in an older translation of the settings
 * page. Markdown is not compiled, so nothing else notices a doc that still
 * sends readers to a page that is gone, or that names a card, a field or a
 * rule the product does not have.
 *
 * Every language must send readers to Numbering - named the way that
 * language's dashboard names it (Persian keeps the English names, as its
 * incident pages do) - at its new address, never to More Settings or to a
 * Number Prefix page, whose old addresses are mentioned only as ones that
 * forward. The next numbers have a section of their own on the settings
 * page, which the declaring page, the alert settings page and the pages on
 * moving from another on-call tool point to, each in the reader's words.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "fa",
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

// The languages whose incident docs name the UI in English.
const ENGLISH_UI_NAMES: ReadonlyArray<string> = ["en", "fa"];

// What each language called More Settings, from the locale files before it went.
const MORE_SETTINGS: Record<string, string> = {
  en: "More Settings",
  fa: "More Settings",
  da: "Flere indstillinger",
  de: "Weitere Einstellungen",
  es: "Más Ajustes",
  fr: "Plus de paramètres",
  hi: "अधिक सेटिंग्स",
  it: "Altre impostazioni",
  ja: "その他の設定",
  ko: "기타 설정",
  nl: "Meer instellingen",
  no: "Flere innstillinger",
  pt: "Mais configurações",
  ru: "Дополнительные настройки",
  sv: "Fler inställningar",
  "zh-CN": "更多设置",
  "zh-TW": "更多設定",
};

const SETTINGS_PAGE: string = "incidents/settings";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const OVERVIEW_PAGE: string = "incidents/index";
const ALERT_SETTINGS_PAGE: string = "alerts/settings";
const PAGES: ReadonlyArray<string> = [
  SETTINGS_PAGE,
  DECLARING_PAGE,
  OVERVIEW_PAGE,
];

const PAGE_NAME: string = "Numbering";
const ADDRESS_PREFIX: string = "/dashboard/{projectId}/incidents/";
const OLD_ADDRESS: string = `${ADDRESS_PREFIX}${MORE_SETTINGS_PATH}`;
const OLD_PREFIX_ADDRESS: string = `${ADDRESS_PREFIX}${NUMBER_PREFIX_PATH}`;
// How the docs mention the old addresses: as ones that forward.
const OLD_ADDRESS_MENTION: string = `\`…/${MORE_SETTINGS_PATH}\``;
const OLD_PREFIX_ADDRESS_MENTION: string = `\`…/${NUMBER_PREFIX_PATH}\``;

// The heading of the next numbers section, on the English settings page.
const NEXT_NUMBERS_HEADING: string = "Next numbers";

// The headings around it: it follows the prefixes and precedes the switches.
const PREFIXES_HEADING: string = "Number prefixes";
const SWITCHES_HEADING: string = "Linked alert switches";

// The bold label in front of a highest number, and the dialog's save button.
const PREVIEW_LABEL: string = "Preview:";
const SAVE_BUTTON: string = "Save Changes";

const MOVING_DOCS_PREFIX: string = "/docs/";

function readPage(page: string, language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The name the reader of an incident page sees for a piece of UI.
function uiName(language: string, english: string): string {
  if (ENGLISH_UI_NAMES.includes(language)) {
    return english;
  }

  const name: string | undefined = locale(language)[english];

  expect({ language, english, translated: Boolean(name) }).toEqual({
    language,
    english,
    translated: true,
  });

  return name as string;
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

// The page's level-two headings, in order.
function sectionHeadings(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.level === 2;
    },
  );
}

// Where the English settings page has a level-two heading.
function englishSectionIndex(text: string): number {
  const index: number = sectionHeadings(
    readPage(SETTINGS_PAGE, "en"),
  ).findIndex((heading: DocsHeading): boolean => {
    return heading.text === text;
  });

  expect({ text, found: index >= 0 }).toEqual({ text, found: true });

  return index;
}

// The next numbers heading of the settings page, in a language.
function nextNumbersHeading(language: string): DocsHeading {
  return sectionHeadings(readPage(SETTINGS_PAGE, language))[
    englishSectionIndex(NEXT_NUMBERS_HEADING)
  ] as DocsHeading;
}

// The settings page's next numbers section, heading to the next heading.
function nextNumbersSection(language: string): string {
  const markdown: string = readPage(SETTINGS_PAGE, language);
  const lines: Array<string> = markdown.split("\n");
  const heading: DocsHeading = nextNumbersHeading(language);
  const next: DocsHeading | undefined =
    sectionHeadings(markdown)[englishSectionIndex(NEXT_NUMBERS_HEADING) + 1];

  return lines
    .slice(heading.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The links of a page, decoded.
function linkTargets(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return decodeURIComponent(link.target);
  });
}

/*
 * A text with its numbers in ASCII digits and without digit grouping:
 * "1.000.000.000", "1 000 000 000" and "۱٬۰۰۰٬۰۰۰٬۰۰۰" all read 1000000000.
 */
function plainNumbers(text: string): string {
  const grouped: RegExp = /(\d)[\s.,'٬](?=\d{3}(?!\d))/g;

  return toLatinDigits(text).replace(grouped, "$1");
}

// How a Project column is named in the Terraform provider: snake case.
function terraformName(column: string): string {
  return column.replace(/[A-Z]/g, (letter: string): string => {
    return `_${letter.toLowerCase()}`;
  });
}

function kindInfo(kind: NumberedRecordKind): NumberedRecordKindInfo {
  return NextNumberUtil.getKindInfo(kind);
}

// The kinds an incident's next numbers are about.
const INCIDENT_KINDS: Array<NumberedRecordKindInfo> = [
  kindInfo(NumberedRecordKind.Incident),
  kindInfo(NumberedRecordKind.IncidentEpisode),
];

function formTitles(rows: Array<NextNumberRow>): Array<string> {
  return rows.map((row: NextNumberRow): string => {
    return row.formTitle;
  });
}

// The pages on moving from another on-call tool, which end on its checklist.
const ON_CALL_MOVING_PAGES: Array<{ source: ToolImportSource; page: string }> =
  AllToolImportSources.filter((source: ToolImportSource): boolean => {
    return (
      getToolImportSourceDefinition(source).category ===
      ToolImportCategory.OnCall
    );
  }).map((source: ToolImportSource) => {
    return {
      source,
      page: getToolImportSourceDefinition(source).docsPath.replace(
        MOVING_DOCS_PREFIX,
        "",
      ),
    };
  });

describe("the docs send readers to Numbering, never to More Settings or a Number Prefix page", () => {
  it("covers all 17 docs languages", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return (
          entry.isDirectory() &&
          fs.existsSync(
            path.join(CONTENT_DIR, entry.name, `${SETTINGS_PAGE}.md`),
          )
        );
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      })
      .sort();

    expect(languages).toEqual([...LANGUAGES].sort());
    expect([...LANGUAGES].sort()).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );
  });

  it.each(LANGUAGES)(
    "%s: no page gives an old address, or a path to More Settings or to a Number Prefix page",
    (language: string) => {
      const prefixName: string = uiName(language, NUMBER_PREFIX_PAGE_TITLE);

      for (const page of PAGES) {
        const markdown: string = readPage(page, language);

        expect({
          language,
          page,
          oldAddress: markdown.includes(OLD_ADDRESS),
          oldPrefixAddress: markdown.includes(OLD_PREFIX_ADDRESS),
          pathToMoreSettings: markdown.includes(
            `→ ${MORE_SETTINGS[language]}**`,
          ),
          pathToNumberPrefix: markdown.includes(`→ ${prefixName}**`),
        }).toEqual({
          language,
          page,
          oldAddress: false,
          oldPrefixAddress: false,
          pathToMoreSettings: false,
          pathToNumberPrefix: false,
        });
      }
    },
  );

  /*
   * The AI settings page has a folded "More settings" section, which holds
   * the AI rules, and most languages name it as they named the old page.
   * The lines that describe the AI settings page - the one that gives its
   * address, and the ones that name its rules - may name that section; it
   * is not the page that moved.
   */
  function withoutAiSettingsFold(language: string, markdown: string): string {
    const aiRules: string = `**${uiName(language, "AI rules")}**`;

    return markdown
      .split("\n")
      .filter((line: string): boolean => {
        return !line.includes("/incidents/ai/") && !line.includes(aiRules);
      })
      .join("\n");
  }

  it.each(LANGUAGES)(
    "%s: More Settings and the old addresses are named only where they are said to forward to Numbering",
    (language: string) => {
      const oldName: string = `**${MORE_SETTINGS[language]}**`;
      const settings: string = withoutAiSettingsFold(
        language,
        readPage(SETTINGS_PAGE, language),
      );

      expect(count(settings, oldName)).toBe(1);
      expect(count(settings, OLD_ADDRESS_MENTION)).toBe(1);
      expect(count(settings, OLD_PREFIX_ADDRESS_MENTION)).toBe(1);

      const sentence: string =
        settings.split("\n").find((line: string): boolean => {
          return line.includes(oldName);
        }) || "";

      expect(sentence).toContain(OLD_ADDRESS_MENTION);
      expect(sentence).toContain(OLD_PREFIX_ADDRESS_MENTION);
      expect(sentence).toContain(`**${uiName(language, PAGE_NAME)}**`);
      expect(sentence).toContain(
        `**${uiName(language, NUMBER_PREFIX_PAGE_TITLE)}**`,
      );

      for (const page of [DECLARING_PAGE, OVERVIEW_PAGE]) {
        const markdown: string = readPage(page, language);

        expect({
          language,
          page,
          mentions: count(markdown, oldName),
          oldPrefixAddress: markdown.includes(OLD_PREFIX_ADDRESS_MENTION),
        }).toEqual({ language, page, mentions: 0, oldPrefixAddress: false });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings and declaring pages give the path to Numbering, in the reader's words",
    (language: string) => {
      const pageName: string = uiName(language, PAGE_NAME);
      const route: string | undefined = fs
        .readFileSync(path.join(DASHBOARD_SRC, "Utils/RouteMap.ts"), "utf8")
        .match(/\[PageMap\.INCIDENTS_SETTINGS_NUMBERING\]:\s*"([^"]+)"/)?.[1];

      expect(route).toBe("settings/numbering");

      for (const page of [SETTINGS_PAGE, DECLARING_PAGE]) {
        expect({
          language,
          page,
          path: readPage(page, language).includes(`→ ${pageName}**`),
        }).toEqual({ language, page, path: true });
      }

      expect(readPage(SETTINGS_PAGE, language)).toContain(
        `\`${ADDRESS_PREFIX}${route}\``,
      );
    },
  );

  it.each(LANGUAGES)(
    "%s: the settings table and the overview's Settings row list Numbering",
    (language: string) => {
      const pageName: string = uiName(language, PAGE_NAME);

      expect(
        readPage(SETTINGS_PAGE, language)
          .split("\n")
          .some((line: string): boolean => {
            return line.startsWith(`| **${pageName}**`);
          }),
      ).toBe(true);
      expect(readPage(OVERVIEW_PAGE, language)).toContain(`**${pageName}**`);
    },
  );

  it.each(LANGUAGES)(
    "%s: names the prefix dialog and its fields as the dashboard does",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);
      const declaring: string = readPage(DECLARING_PAGE, language);

      for (const english of [
        "Update",
        "Edit Number Prefix",
        "Incident Number Prefix",
        "Incident Episode Number Prefix",
      ]) {
        expect({
          language,
          english,
          inSettings: settings.includes(`**${uiName(language, english)}**`),
        }).toEqual({ language, english, inSettings: true });
      }

      // The declaring page's steps open the prefix card of the page.
      for (const english of [
        "Incident Number Prefix",
        "Update",
        NUMBER_PREFIX_PAGE_TITLE,
      ]) {
        expect({
          language,
          english,
          inDeclaring: declaring.includes(`**${uiName(language, english)}**`),
        }).toEqual({ language, english, inDeclaring: true });
      }
    },
  );

  /*
   * What the old page's docs never said, and the page now does: what a
   * prefix may hold, and that existing numbers stay as they are.
   */
  it.each(LANGUAGES)(
    "%s: the settings page states the prefix rules and the example the dialog uses",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);

      for (const part of [
        "20",
        "`-` `_` `.` `/` `:` `#`",
        "`SEV1`",
        "`SEV142`",
        "`INC-42`",
        "`#42`",
        "`incidentNumberWithPrefix`",
      ]) {
        expect({ language, part, stated: settings.includes(part) }).toEqual({
          language,
          part,
          stated: true,
        });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: says alerts and scheduled maintenance have the same page",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);
      const pageName: string = uiName(language, PAGE_NAME);

      // Every path that ends at a Numbering page.
      const paths: Array<string> = Array.from(
        settings.matchAll(/\*\*([^*\n]+?) → ([^*\n]+?) → ([^*\n]+?)\*\*/g),
      )
        .filter((match: RegExpMatchArray): boolean => {
          return match[3] === pageName;
        })
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });

      expect({ language, products: paths.length }).toEqual({
        language,
        products: 3,
      });
      expect(paths).toContain(uiName(language, "Incidents"));
      expect(paths).toContain(uiName(language, "Alerts"));
      expect(paths).toContain(uiName(language, "Scheduled Maintenance"));
    },
  );
});

describe("the settings page's section on next numbers", () => {
  it("sits after the number prefixes and before the linked alert switches, in English", () => {
    const next: number = englishSectionIndex(NEXT_NUMBERS_HEADING);

    expect(englishSectionIndex(PREFIXES_HEADING)).toBe(next - 1);
    expect(englishSectionIndex(SWITCHES_HEADING)).toBe(next + 1);
  });

  it.each(LANGUAGES)(
    "%s: has the section in the English one's place, holding what it says",
    (language: string) => {
      const section: string = nextNumbersSection(language);

      expect(nextNumbersHeading(language).level).toBe(2);

      // The API's and Terraform's names for where the numbers start.
      for (const info of INCIDENT_KINDS) {
        for (const name of [
          info.startsAtColumn,
          terraformName(info.startsAtColumn),
        ]) {
          expect({
            language,
            name,
            stated: section.includes(`\`${name}\``),
          }).toEqual({ language, name, stated: true });
        }
      }

      // The example: a team whose old tool stopped at INC-2345.
      for (const code of [
        "`INC-2345`",
        "`2346`",
        "`10000`",
        "`INC-10000`",
        "`INC-10001`",
        "`100000`",
      ]) {
        expect({ language, code, stated: section.includes(code) }).toEqual({
          language,
          code,
          stated: true,
        });
      }

      // The highest number a project may choose, in the reader's digits.
      expect({
        language,
        highest: plainNumbers(section).includes(String(NextNumberUtil.MAX)),
      }).toEqual({ language, highest: true });
    },
  );

  it.each(LANGUAGES)(
    "%s: names the card, its dialog and its fields as the dashboard does",
    (language: string) => {
      const section: string = nextNumbersSection(language);

      for (const english of [
        NEXT_NUMBER_CARD_TITLE,
        NUMBER_PREFIX_PAGE_TITLE,
        HIGHEST_SO_FAR_LABEL,
        NONE_USED_YET,
        NEXT_NUMBER_EDIT_BUTTON_TITLE,
        NEXT_NUMBER_EDIT_MODAL_TITLE,
        PREVIEW_LABEL,
        SAVE_BUTTON,
        PAGE_NAME,
        ...INCIDENT_NEXT_NUMBERS.rows.map((row: NextNumberRow): string => {
          return row.label;
        }),
        ...formTitles(INCIDENT_NEXT_NUMBERS.rows),
        ...formTitles(ALERT_NEXT_NUMBERS.rows),
        ...formTitles(SCHEDULED_MAINTENANCE_NEXT_NUMBERS.rows),
      ]) {
        expect({
          language,
          english,
          named: section.includes(`**${uiName(language, english)}**`),
        }).toEqual({ language, english, named: true });
      }

      // A permission's name, which the product shows in English.
      expect(section).toContain("**Edit Project**");
    },
  );

  it.each(LANGUAGES)(
    "%s: the declaring page and the alert settings page link to it, by its heading in the reader's language",
    (language: string) => {
      const target: string = `/docs/${SETTINGS_PAGE}#${nextNumbersHeading(language).slug}`;

      for (const page of [DECLARING_PAGE, ALERT_SETTINGS_PAGE]) {
        expect({
          language,
          page,
          linked: linkTargets(readPage(page, language)).includes(target),
        }).toEqual({ language, page, linked: true });
      }

      expect(
        readPage(DECLARING_PAGE, language).includes(
          `**${uiName(language, "Next Incident Number")}**`,
        ),
      ).toBe(true);
    },
  );
});

/*
 * A team moving from another on-call tool reads its "Moving from" page and
 * finishes the switch from that page's checklist, which has a step for the
 * numbers. Those pages name the Dashboard as each language's Dashboard draws
 * it - Persian included - with " > " between a path's bold segments.
 */
describe("the pages on moving from another on-call tool", () => {
  it("are the on-call tools' pages", () => {
    expect(
      ON_CALL_MOVING_PAGES.map((entry: { page: string }): string => {
        return entry.page;
      }),
    ).toEqual([
      "moving-to-oneuptime/opsgenie",
      "moving-to-oneuptime/pagerduty",
      "moving-to-oneuptime/incident-io",
      "moving-to-oneuptime/splunk-on-call",
      "moving-to-oneuptime/grafana-oncall",
    ]);
  });

  it.each(LANGUAGES)(
    "%s: say where to set the next incident number, in the checklist that finishes the switch",
    (language: string) => {
      const drawn: (english: string) => string = (english: string): string => {
        return `**${drawnDashboardLabel(language, english)}**`;
      };
      const numberingPath: string = [
        drawn("Incidents"),
        drawn("Settings"),
        drawn(PAGE_NAME),
      ].join(" > ");

      for (const entry of ON_CALL_MOVING_PAGES) {
        const lines: Array<string> = readPage(entry.page, language).split("\n");
        const step: number = lines.findIndex((line: string): boolean => {
          return line.includes(numberingPath);
        });
        const before: Array<string> = lines.slice(0, Math.max(step, 0));
        // The checklist the step is in: the last steps block opened above it.
        const opened: number = before.reduce(
          (found: number, line: string, index: number): number => {
            return line.startsWith(":::steps") ? index : found;
          },
          -1,
        );
        const closed: number = lines.findIndex(
          (line: string, index: number): boolean => {
            return index > step && line.trim() === ":::";
          },
        );
        // The step before it: making sure everyone can be paged.
        const readiness: number = before.reduce(
          (found: number, line: string, index: number): number => {
            return line.includes(drawn("Readiness")) ? index : found;
          },
          -1,
        );

        expect({
          page: entry.page,
          language,
          step: step >= 0,
          inChecklist:
            opened >= 0 &&
            closed > step &&
            !lines.slice(opened + 1, step).some((line: string): boolean => {
              return line.trim().startsWith(":::");
            }),
          afterReadiness: readiness > opened,
          heading: (lines[step - 1] || "").startsWith("### "),
          field: (lines[step] || "").includes(drawn("Next Incident Number")),
          card: (lines[step] || "").includes(drawn(NEXT_NUMBER_CARD_TITLE)),
        }).toEqual({
          page: entry.page,
          language,
          step: true,
          inChecklist: true,
          afterReadiness: true,
          heading: true,
          field: true,
          card: true,
        });
      }
    },
  );
});

describe("English and Persian describe the page in full", () => {
  it.each(ENGLISH_UI_NAMES)(
    "%s: the Number prefixes section covers the card, the preview, the rules and who can change it",
    (language: string) => {
      const settings: string = readPage(SETTINGS_PAGE, language);

      for (const part of [
        "**Incidents**",
        "**Incident Episodes**",
        "**Example:**",
        "**No prefix**",
        "**Preview:**",
        "**Edit Project**",
        "`INC-`",
        "`IE-`",
        "`ALT-`",
        "`AE-`",
        "`SM-`",
        "`OPS-42`",
        "`INC-41`",
      ]) {
        expect({ language, part, stated: settings.includes(part) }).toEqual({
          language,
          part,
          stated: true,
        });
      }
    },
  );

  it("en: links from the declaring page to the rules and to the next numbers", () => {
    expect(readPage(DECLARING_PAGE, "en")).toContain(
      "[Number prefixes](/docs/incidents/settings#number-prefixes)",
    );
    expect(readPage(DECLARING_PAGE, "en")).toContain(
      "[Next numbers](/docs/incidents/settings#next-numbers)",
    );
    expect(readPage(SETTINGS_PAGE, "en")).toContain("\n## Number prefixes\n");
    expect(readPage(SETTINGS_PAGE, "en")).toContain("\n## Next numbers\n");
  });

  it("fa: links from the declaring page to the rules and to the next numbers, by the sections' own headings", () => {
    expect(readPage(DECLARING_PAGE, "fa")).toContain(
      "(/docs/incidents/settings#پیشوندهای-شماره)",
    );
    expect(readPage(SETTINGS_PAGE, "fa")).toContain("\n## پیشوندهای شماره\n");
    expect(readPage(SETTINGS_PAGE, "fa")).toContain("\n## شماره‌های بعدی\n");
  });
});

/*
 * What the English page says the product does, held to the product: the
 * range a next number may take, the names the API and Terraform know the
 * starts by, the card and dialog as the dashboard draws them, and what an
 * import from another tool leaves alone.
 */
describe("the English section holds to the product", () => {
  function englishSection(): string {
    return nextNumbersSection("en");
  }

  it("states the range NextNumberUtil accepts", () => {
    expect(NextNumberUtil.MIN).toBe(1);
    expect(englishSection()).toContain(
      `is a whole number from ${NextNumberUtil.MIN} to ${NextNumberUtil.MAX.toLocaleString("en-US")};`,
    );
  });

  it("names each start as the Project column and the Terraform attribute it is", () => {
    const columns: Array<string> = NUMBERED_RECORD_KINDS.map(
      (info: NumberedRecordKindInfo): string => {
        return info.startsAtColumn;
      },
    );

    expect(columns).toContain("incidentNumbersStartAt");
    expect(columns).toContain("incidentEpisodeNumbersStartAt");
    expect(englishSection()).toContain(
      "the project's `incidentNumbersStartAt` and `incidentEpisodeNumbersStartAt` (`incident_numbers_start_at` and `incident_episode_numbers_start_at` in Terraform)",
    );
  });

  it("walks through the card and its dialog as the dashboard draws them", () => {
    const [incidents, episodes] = INCIDENT_NEXT_NUMBERS.rows as [
      NextNumberRow,
      NextNumberRow,
    ];

    expect(englishSection()).toContain(
      `The **${NEXT_NUMBER_CARD_TITLE}** card, under **${NUMBER_PREFIX_PAGE_TITLE}** on the same page, has a row for **${incidents.label}** and one for **${episodes.label}**.`,
    );
    expect(englishSection()).toContain(
      `then **${HIGHEST_SO_FAR_LABEL}** and the highest number used, or **${NONE_USED_YET}**.`,
    );
    expect(englishSection()).toContain(
      `1. Click **${NEXT_NUMBER_EDIT_BUTTON_TITLE}** on the **${NEXT_NUMBER_CARD_TITLE}** card. The **${NEXT_NUMBER_EDIT_MODAL_TITLE}** dialog opens, with **${incidents.formTitle}** and **${episodes.formTitle}**`,
    );
    expect(englishSection()).toContain(
      `the same card on their **${PAGE_NAME}** pages: **${formTitles(ALERT_NEXT_NUMBERS.rows).join("** and **")}**, and **${formTitles(SCHEDULED_MAINTENANCE_NEXT_NUMBERS.rows).join("** and **")}**.`,
    );
  });

  it("says an import from another tool leaves the numbers alone, as no import brings numbered records", () => {
    const imported: Array<string> = Object.values(ToolImportResourceKind);

    for (const info of NUMBERED_RECORD_KINDS) {
      expect({
        kind: info.kind,
        imported: imported.includes(info.kind),
      }).toEqual({ kind: info.kind, imported: false });
    }

    expect(englishSection()).toContain(
      "brings your setup over, not your past incidents, so it leaves the numbers as they are",
    );
  });
});
