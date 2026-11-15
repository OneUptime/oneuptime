import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DEFAULT_ALERT_SEVERITY_NAMES,
  DEFAULT_ALERT_STATE_NAMES,
  DEFAULT_INCIDENT_SEVERITY_NAMES,
  DEFAULT_INCIDENT_STATE_NAMES,
  DEFAULT_MONITOR_STATUS_NAMES,
  DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
} from "Common/Types/StatusPage/DefaultStatusNames";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONEUPTIME'S DEFAULT STATE NAMES, IN THE DOCS AS ON THE DASHBOARD (#8055).
 *
 * A new project's states, severities and monitor statuses have names
 * OneUptime gives them (Common/Types/StatusPage/DefaultStatusNames), read in
 * the reader's language. Since #7895 the Dashboard, a status page and the
 * server's messages word each of them alike. The docs name them too, and
 * drifted twice: the Japanese and Korean notification guides gave the
 * status page's old word for Identified, and the Danish widgets page and
 * the Persian incident page named Operational and Degraded by words the
 * Dashboard does not use (Driftsklar, تنزل‌یافته).
 *
 * So each language's docs name a default by the Dashboard's word:
 *
 *   - the tables of the names a new project starts with, one row each,
 *     its first cell the Dashboard's word in bold;
 *   - the notification guide's example of those names;
 *   - and the words a status page and the server once used for them, which
 *     the Dashboard never did, are gone - but where a page names another
 *     system's own state by them (Ceph's degraded placement groups, a
 *     vendor status page's components).
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const read: (language: string, page: string) => string = (
  language: string,
  page: string,
): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
};

// Every Markdown page of a language's docs, by its path under the language.
const pagesOf: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const root: string = path.join(CONTENT_DIR, language);
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };

  walk(root);

  return pages.sort();
};

/*
 * Whether a page has a table row whose first cell is `word` in bold:
 * `| **Identified** | 1 | ...`.
 */
const hasRowNamed: (page: string, word: string) => boolean = (
  page: string,
  word: string,
): boolean => {
  return new RegExp(
    `^\\|\\s*\\*\\*${escapeRegExp(word)}\\*\\*\\s*\\|`,
    "m",
  ).test(page);
};

interface SeededNamesPage {
  page: string;
  names: ReadonlyArray<string>;
}

// The pages that list, one row each, the names a new project starts with.
const SEEDED_NAMES_PAGES: ReadonlyArray<SeededNamesPage> = [
  {
    page: "incidents/states-and-severities.md",
    names: [
      ...DEFAULT_INCIDENT_STATE_NAMES,
      ...DEFAULT_INCIDENT_SEVERITY_NAMES,
    ],
  },
  {
    page: "alerts/states-and-severities.md",
    names: [...DEFAULT_ALERT_STATE_NAMES, ...DEFAULT_ALERT_SEVERITY_NAMES],
  },
  {
    page: "monitor/criteria-and-statuses.md",
    names: DEFAULT_MONITOR_STATUS_NAMES,
  },
  {
    page: "scheduled-maintenance/states.md",
    names: DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
  },
];

/*
 * The notification guide's example of the names every new project starts
 * with ("... such as Identified and Critical Incident").
 */
const NOTIFICATION_GUIDE: string = "notifications/index.md";
const NOTIFICATION_GUIDE_EXAMPLES: ReadonlyArray<string> = [
  "Identified",
  "Critical Incident",
];

interface RetiredWord {
  language: string;
  name: string;
  // The word, matched as a whole word.
  word: string;
  // The pages it may stay on, each naming another system's own state by it.
  keptOn: ReadonlyArray<string>;
}

/*
 * The words a status page and the server's messages used for a default
 * name before #7895, which the Dashboard never used. Only those that name
 * nothing but a state are held here: a word that is also an everyday noun
 * or phrase (Swedish Drift, "operations"; Russian В процессе, "in
 * progress") is free to mean that.
 */
const RETIRED_WORDS: ReadonlyArray<RetiredWord> = [
  { language: "da", name: "Operational", word: "Driftsklar", keptOn: [] },
  { language: "no", name: "Operational", word: "Operativ", keptOn: [] },
  {
    language: "fa",
    name: "Degraded",
    word: "تنزل‌یافته",
    keptOn: [
      // Ceph's degraded placement groups and pools.
      "telemetry/ceph.md",
      // An OpenStack cloud's degraded Ceph pool.
      "telemetry/openstack.md",
      // A component a storage array itself reports degraded.
      "telemetry/storage-arrays.md",
    ],
  },
  {
    language: "ru",
    name: "Degraded",
    word: "Снижение производительности",
    // A vendor status page's own component status, Degraded Performance.
    keptOn: ["monitor/external-status-page-monitor.md"],
  },
];

/*
 * A word on its own, written as a state's name is: with its capital, so the
 * Norwegian adjective "ikke-operative" is free, and not part of a longer
 * one (Norwegian Operativsystem, "operating system"). The word with a
 * suffix Persian joins on by a zero-width non-joiner (تنزل‌یافته‌ای, "a
 * degraded one"), or with its ezafe (تنزل‌یافتهٔ), is still the word.
 */
const wholeWord: (word: string) => RegExp = (word: string): RegExp => {
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\u200C])${escapeRegExp(word)}(?!\\p{L})`,
    "u",
  );
};

describe("OneUptime's default state names in the docs", () => {
  test("every docs language is checked, English first", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES[0]).toBe("en");
    expect(SUPPORTED_DOCS_LANGUAGE_CODES.length).toBeGreaterThan(10);
  });

  test("every default name is listed on a page of the names a new project starts with", () => {
    const listed: Set<string> = new Set(
      SEEDED_NAMES_PAGES.flatMap((page: SeededNamesPage): Array<string> => {
        return [...page.names];
      }),
    );

    for (const name of [
      ...DEFAULT_INCIDENT_STATE_NAMES,
      ...DEFAULT_INCIDENT_SEVERITY_NAMES,
      ...DEFAULT_ALERT_STATE_NAMES,
      ...DEFAULT_ALERT_SEVERITY_NAMES,
      ...DEFAULT_MONITOR_STATUS_NAMES,
      ...DEFAULT_SCHEDULED_MAINTENANCE_STATE_NAMES,
    ]) {
      expect({ name, listed: listed.has(name) }).toEqual({
        name,
        listed: true,
      });
    }
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s lists the names a new project starts with by the Dashboard's words",
    (language: string) => {
      const unnamed: Array<string> = [];

      for (const seeded of SEEDED_NAMES_PAGES) {
        const page: string = read(language, seeded.page);

        for (const name of seeded.names) {
          const word: string = drawnDashboardLabel(language, name);

          if (!hasRowNamed(page, word)) {
            unnamed.push(
              `${seeded.page}: ${name} is not a row named **${word}**`,
            );
          }
        }
      }

      expect({ language, unnamed }).toEqual({ language, unnamed: [] });
    },
  );

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s gives the notification guide's examples of default names in the Dashboard's words",
    (language: string) => {
      const page: string = read(language, NOTIFICATION_GUIDE);

      for (const name of NOTIFICATION_GUIDE_EXAMPLES) {
        const word: string = drawnDashboardLabel(language, name);

        expect({ language, name, says: page.includes(word) }).toEqual({
          language,
          name,
          says: true,
        });
      }
    },
  );

  test("no retired word is the Dashboard's, and each page keeping one still says it", () => {
    for (const retired of RETIRED_WORDS) {
      expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(retired.language);
      expect({
        ...retired,
        dashboard: drawnDashboardLabel(retired.language, retired.name),
      }).not.toEqual(expect.objectContaining({ dashboard: retired.word }));

      for (const page of retired.keptOn) {
        // Still on it: a page that dropped the word drops off the list.
        expect({
          page,
          says: wholeWord(retired.word).test(read(retired.language, page)),
        }).toEqual({
          page,
          says: true,
        });
      }
    }
  });

  test.each(RETIRED_WORDS)(
    "$language docs no longer name $name $word",
    (retired: RetiredWord) => {
      const pages: Array<string> = pagesOf(retired.language).filter(
        (page: string): boolean => {
          return (
            !retired.keptOn.includes(page) &&
            wholeWord(retired.word).test(read(retired.language, page))
          );
        },
      );

      expect({ word: retired.word, pages }).toEqual({
        word: retired.word,
        pages: [],
      });
    },
  );

  test("a whole word is told from a longer one", () => {
    expect(wholeWord("Operativ").test("Operativsystem")).toBe(false);
    // An adjective in its own sense, lowercase, is not the state's name.
    expect(wholeWord("Operativ").test("ikke-operative statuser")).toBe(false);
    expect(wholeWord("Operativ").test("Status: Operativ.")).toBe(true);
    expect(wholeWord("Driftsklar").test("Driftsklarhed")).toBe(false);
    expect(wholeWord("Driftsklar").test("Driftsklar eller ej")).toBe(true);
    expect(wholeWord("تنزل‌یافته").test("وضعیت تنزل‌یافته است")).toBe(true);
    expect(wholeWord("تنزل‌یافته").test("استخر تنزل‌یافته‌ای")).toBe(true);
    expect(wholeWord("تنزل‌یافته").test("گروه تنزل‌یافتهٔ")).toBe(true);
    expect(wholeWord("تنزل‌یافته").test("ناتنزل‌یافته")).toBe(false);
  });
});

describe("the two lines #8055 found", () => {
  test("the Danish Monitor List widget filters by I drift or not", () => {
    const row: string | undefined = read("da", "dashboards/widgets.md")
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(
          `| **${drawnDashboardLabel("da", "Monitor List")}** |`,
        );
      });

    expect(row).toBeDefined();
    expect(row!.split("|")[3]!.trim()).toMatch(
      new RegExp(
        `^${escapeRegExp(drawnDashboardLabel("da", "Operational"))} eller ej,`,
      ),
    );
  });

  test("the Persian Change Monitor Status to field marks monitors Degraded in the Dashboard's word", () => {
    const field: string | undefined = read(
      "fa",
      "incidents/declaring-incidents.md",
    )
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(
          `- **${drawnDashboardLabel("fa", "Change Monitor Status to")}**`,
        );
      });

    expect(field).toBeDefined();
    expect(field).toContain(drawnDashboardLabel("fa", "Degraded"));
  });
});
