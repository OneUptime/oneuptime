import {
  MAINTENANCE_EVENT_WORDS,
  MAINTENANCE_WORDS,
  MaintenanceEventWords,
  SAYS_A_MAINTENANCE_EVENT,
  SAYS_MAINTENANCE,
  droppedMaintenanceWordIn,
} from "./MaintenanceEventWords";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE WORD FOR A MAINTENANCE EVENT, AND ONE FOR MAINTENANCE, IN EVERY
 * LANGUAGE (#7639).
 *
 * #7982 settled each language's word for the record: the Dashboard's
 * "Maintenance Event". Some strings still named it another way:
 *
 *   - Danish, Korean, Hindi and Persian had a second word for it in
 *     sentences ("vedligeholdelsesbegivenhed", "점검 이벤트", "मेंटेनेंस इवेंट",
 *     "رویداد نگهداری"), and a second word for maintenance itself (Korean
 *     점검 and 유지보수 beside 유지 관리, Hindi मेंटेनेंस beside रखरखाव, Persian
 *     نگهداری beside تعمیر و نگهداری);
 *   - Dutch had a third ("onderhoudsevenement", "onderhoudsmoment");
 *   - every language's forms and status page counts, and the status page's
 *     "Add this maintenance event to your calendar app.", said "a
 *     maintenance" ("eine Wartung", "une maintenance") where the English says
 *     a maintenance event.
 *
 * And Dutch wrote the product's name "Geplande onderhoud": onderhoud is a
 * het-word, so it is "Gepland onderhoud", and "geplande" only after a
 * definite determiner ("het geplande onderhoud", "dit geplande onderhoud").
 *
 * Every string the product writes is held here: the Dashboard, the status
 * page, the Admin Dashboard, the docs navigation and the server's (whose
 * "Maintenance Event" row title #8083 worded as each Dashboard does).
 */

const APP_DIR: string = path.resolve(__dirname, "../../FeatureSet");
const COMMON_DIR: string = path.resolve(__dirname, "../../../Common");

const LOCALE_DIRS: Record<string, string> = {
  Dashboard: path.join(APP_DIR, "Dashboard/src/Locales"),
  "Status Page": path.join(APP_DIR, "StatusPage/src/Locales"),
  "Admin Dashboard": path.join(APP_DIR, "AdminDashboard/src/Locales"),
  "Docs navigation": path.join(APP_DIR, "Docs/Locales"),
  Server: path.join(COMMON_DIR, "Server/Locales"),
};

const DOCS_CONTENT_DIR: string = path.join(APP_DIR, "Docs/Content");

type Strings = Map<string, string>;

function flatten(value: unknown, prefix: string, into: Strings): Strings {
  if (typeof value === "string") {
    into.set(prefix, value);
    return into;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      flatten(child, prefix ? `${prefix}.${key}` : key, into);
    }
  }

  return into;
}

const stringsCache: Map<string, Strings | null> = new Map();

// Every string of a locale file, by its key path; null when there is none.
function stringsOf(app: string, language: string): Strings | null {
  const file: string = path.join(LOCALE_DIRS[app]!, `${language}.json`);

  if (!stringsCache.has(file)) {
    stringsCache.set(
      file,
      fs.existsSync(file)
        ? flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map())
        : null,
    );
  }

  return stringsCache.get(file)!;
}

interface Pair {
  key: string;
  english: string;
  translation: string;
}

/*
 * Each string of a language with its English, for the strings the language
 * has translated. A string still in English is not translated yet, which is
 * a different gap (#7639's follow-up): it never names the record in another
 * word.
 */
function pairs(app: string, language: string): Array<Pair> {
  const english: Strings | null = stringsOf(app, "en");
  const translated: Strings | null = stringsOf(app, language);

  if (!english || !translated) {
    return [];
  }

  const result: Array<Pair> = [];

  for (const [key, text] of english) {
    const translation: string | undefined = translated.get(key);

    if (translation === undefined || translation === text) {
      continue;
    }

    result.push({ key, english: text, translation });
  }

  return result;
}

const TRANSLATED: Array<string> = Object.keys(MAINTENANCE_EVENT_WORDS).filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

// Every string that names a maintenance event and does not use the word.
function recordWordProblems(
  app: string,
  language: string,
): Array<{ key: string; translation: string; why: string }> {
  const words: MaintenanceEventWords = MAINTENANCE_EVENT_WORDS[language]!;
  const problems: Array<{ key: string; translation: string; why: string }> = [];

  for (const pair of pairs(app, language)) {
    if (!SAYS_A_MAINTENANCE_EVENT.test(pair.english)) {
      continue;
    }

    if (!words.record.test(pair.translation)) {
      problems.push({
        key: pair.key,
        translation: pair.translation,
        why: "does not name the record by its word",
      });
    } else if (words.otherRecord?.test(pair.translation)) {
      problems.push({
        key: pair.key,
        translation: pair.translation,
        why: "also names it by another word",
      });
    }
  }

  return problems;
}

describe("a maintenance event is called by its Dashboard word", () => {
  test.each(TRANSLATED)(
    "%s: the Dashboard's lower-case word is its title word",
    (language: string) => {
      const dashboard: Strings = stringsOf("Dashboard", language)!;

      expect({
        language,
        word: dashboard.get("maintenance event")?.toLowerCase(),
      }).toEqual({
        language,
        word: dashboard.get("Maintenance Event")?.toLowerCase(),
      });
      expect(
        MAINTENANCE_EVENT_WORDS[language]!.record.test(
          dashboard.get("Maintenance Event")!,
        ),
      ).toBe(true);
    },
  );

  for (const app of Object.keys(LOCALE_DIRS)) {
    test.each(TRANSLATED)(
      `%s: every ${app} string that names a maintenance event uses it`,
      (language: string) => {
        expect({
          app,
          language,
          problems: recordWordProblems(app, language),
        }).toEqual({ app, language, problems: [] });
      },
    );
  }

  test("the strings the issue found say the record now", () => {
    const forms: string =
      "Each submission schedules a maintenance event. Use it for change and maintenance requests.";

    expect(stringsOf("Dashboard", "de")!.get(forms)).toBe(
      "Jede Einreichung plant ein Wartungsereignis. Nutzen Sie es für Änderungs- und Wartungsanfragen.",
    );
    expect(stringsOf("Dashboard", "fr")!.get(forms)).toBe(
      "Chaque soumission planifie un événement de maintenance. Utilisez-le pour les demandes de changement et de maintenance.",
    );
    expect(
      stringsOf("Dashboard", "nl")!.get(
        "Your team's measurements, worked out for this maintenance event.",
      ),
    ).toBe(
      "De metingen van uw team, berekend voor deze onderhoudsgebeurtenis.",
    );
    expect(
      stringsOf("Dashboard", "hi")!.get(
        "You are added as an owner of a maintenance event.",
      ),
    ).toBe("आपको एक रखरखाव इवेंट के स्वामी के रूप में जोड़ा गया है।");
    expect(
      stringsOf("Status Page", "de")!.get(
        "scheduledEvents.calendar.eventDescription",
      ),
    ).toBe("Fügen Sie dieses Wartungsereignis Ihrer Kalender-App hinzu.");
  });

  test("the words tell the record from the other words (control)", () => {
    expect(
      MAINTENANCE_EVENT_WORDS["da"]!.otherRecord!.test(
        "en vedligeholdelsesbegivenhed",
      ),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["da"]!.record.test(
        "en vedligeholdelsesbegivenhed",
      ),
    ).toBe(false);
    expect(
      MAINTENANCE_EVENT_WORDS["nl"]!.otherRecord!.test(
        "dit onderhoudsevenement",
      ),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["ko"]!.otherRecord!.test("점검 이벤트"),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["ko"]!.otherRecord!.test("유지보수 이벤트"),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["fa"]!.otherRecord!.test("رویدادهای نگهداری"),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["fa"]!.otherRecord!.test(
        "رویدادهای تعمیر و نگهداری",
      ),
    ).toBe(false);
    expect(
      MAINTENANCE_EVENT_WORDS["fa"]!.record.test("رویدادهای تعمیر و نگهداری"),
    ).toBe(true);
    expect(
      MAINTENANCE_EVENT_WORDS["hi"]!.otherRecord!.test("मेंटेनेंस इवेंट"),
    ).toBe(true);
    expect(MAINTENANCE_EVENT_WORDS["de"]!.record.test("eine Wartung")).toBe(
      false,
    );
    expect(SAYS_A_MAINTENANCE_EVENT.test("Maintenance Events")).toBe(true);
    expect(SAYS_A_MAINTENANCE_EVENT.test("Scheduled Maintenance")).toBe(false);
  });
});

describe("Danish, Korean, Hindi and Persian call maintenance by one word", () => {
  for (const app of Object.keys(LOCALE_DIRS)) {
    test.each(Object.keys(MAINTENANCE_WORDS))(
      `%s: every ${app} string about maintenance uses the language's word`,
      (language: string) => {
        const problems: Array<{ key: string; translation: string }> = [];

        for (const pair of pairs(app, language)) {
          if (!SAYS_MAINTENANCE.test(pair.english)) {
            continue;
          }

          if (
            !MAINTENANCE_WORDS[language]!.word.test(pair.translation) ||
            droppedMaintenanceWordIn(
              language,
              pair.english,
              pair.translation,
            ) !== null
          ) {
            problems.push({ key: pair.key, translation: pair.translation });
          }
        }

        expect({ app, language, problems }).toEqual({
          app,
          language,
          problems: [],
        });
      },
    );
  }

  test("Maintenance Details and the product say the one word", () => {
    const expected: Record<string, [string, string]> = {
      da: ["Detaljer om vedligeholdelse", "Planlagt vedligeholdelse"],
      ko: ["유지 관리 세부 정보", "예정된 유지 관리"],
      hi: ["रखरखाव का विवरण", "अनुसूचित रखरखाव"],
      fa: ["جزئیات تعمیر و نگهداری", "تعمیر و نگهداری زمان\u200cبندی\u200cشده"],
    };

    for (const [language, [details, product]] of Object.entries(expected)) {
      const dashboard: Strings = stringsOf("Dashboard", language)!;
      const statusPage: Strings = stringsOf("Status Page", language)!;

      expect({
        language,
        details: dashboard.get("Maintenance Details"),
        product: dashboard.get("Scheduled Maintenance"),
        menu: dashboard.get("navbar.items.scheduledMaintenanceTitle"),
        // The status page names the product as the Dashboard does (#6817).
        statusPage: [
          statusPage.get("scheduledEvents.title"),
          statusPage.get("scheduledEvents.scheduledMaintenance"),
          statusPage.get("uptimeHistory.scheduledMaintenance"),
        ],
      }).toEqual({
        language,
        details,
        product,
        menu: product,
        statusPage: [product, product, product],
      });
    }
  });

  test("the dropped words are found, and the kept ones are not (control)", () => {
    expect(
      droppedMaintenanceWordIn("ko", "Maintenance Details", "점검 세부 정보"),
    ).toBe("점검");
    expect(
      droppedMaintenanceWordIn("ko", "Maintenance window", "유지보수 시간대"),
    ).toBe("유지보수");
    expect(
      droppedMaintenanceWordIn(
        "ko",
        "Maintenance Details",
        "유지 관리 세부 정보",
      ),
    ).toBeNull();
    // 점검 is a check where the English says one.
    expect(
      droppedMaintenanceWordIn(
        "ko",
        "Checks resume automatically when the maintenance event ends.",
        "유지 관리 이벤트가 끝나면 점검이 자동으로 재개됩니다.",
      ),
    ).toBeNull();
    // ...and a pre-flight is a pre-check.
    expect(
      droppedMaintenanceWordIn(
        "ko",
        "Scheduled maintenance pre-flight",
        "예정된 유지 관리 전 사전 점검",
      ),
    ).toBeNull();
    expect(
      droppedMaintenanceWordIn(
        "hi",
        "Maintenance Details",
        "मेंटेनेंस का विवरण",
      ),
    ).toBe("मेंटेनेंस");
    expect(
      droppedMaintenanceWordIn("fa", "Maintenance Details", "جزئیات نگهداری"),
    ).toBe("نگهداری");
    expect(
      droppedMaintenanceWordIn(
        "fa",
        "Maintenance Details",
        "جزئیات تعمیر و نگهداری",
      ),
    ).toBeNull();
    expect(
      droppedMaintenanceWordIn(
        "fa",
        "uptime, incidents and maintenance",
        "حوادث و تعمیرات",
      ),
    ).toBe("تعمیرات");
    expect(droppedMaintenanceWordIn("de", "Maintenance", "Wartung")).toBeNull();
    // A code name or another product's state is not a word of the sentence.
    expect(
      SAYS_MAINTENANCE.test(
        "Part of the metric name, oneuptime.scheduled-maintenance.measurement.<key>.",
      ),
    ).toBe(false);
    expect(SAYS_MAINTENANCE.test("'maintenance' is planned")).toBe(false);
    expect(SAYS_MAINTENANCE.test("{{label}}, {{maintenance}}")).toBe(false);
    expect(SAYS_MAINTENANCE.test("In maintenance")).toBe(true);
  });
});

/*
 * Dutch: "geplande onderhoud" only after a definite determiner. "deze" is
 * for de-words; onderhoud takes "dit".
 */
const DUTCH_DETERMINERS: ReadonlyArray<string> = [
  "het",
  "dit",
  "dat",
  "uw",
  "je",
  "jouw",
  "ons",
  "hun",
  "zijn",
  "haar",
];

const GEPLANDE_ONDERHOUD: RegExp = /[Gg]eplande onderhoud\b/g;

// The word a text ends with, when only spaces follow it.
const LAST_WORD: RegExp = /(\p{L}+)\s+$/u;

// Each "geplande onderhoud" without a definite determiner, with its word before.
function wrongDutchForms(text: string): Array<string> {
  const wrong: Array<string> = [];

  for (const match of text.matchAll(GEPLANDE_ONDERHOUD)) {
    const before: string | undefined = LAST_WORD.exec(
      text.slice(0, match.index),
    )?.[1];

    if (before === undefined) {
      wrong.push(match[0]);
    } else if (!DUTCH_DETERMINERS.includes(before.toLowerCase())) {
      wrong.push(`${before} ${match[0]}`);
    }
  }

  return wrong;
}

function dutchDocsPages(): Array<string> {
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(full);
      }
    }
  };

  walk(path.join(DOCS_CONTENT_DIR, "nl"));

  return pages.sort();
}

describe("Dutch writes Gepland onderhoud", () => {
  test("the product's name is Gepland onderhoud on every screen", () => {
    expect({
      dashboard: stringsOf("Dashboard", "nl")!.get("Scheduled Maintenance"),
      menu: stringsOf("Dashboard", "nl")!.get(
        "navbar.items.scheduledMaintenanceTitle",
      ),
      statusPage: stringsOf("Status Page", "nl")!.get("scheduledEvents.title"),
      adminDashboard: stringsOf("Admin Dashboard", "nl")!.get(
        "Scheduled Maintenance",
      ),
    }).toEqual({
      dashboard: "Gepland onderhoud",
      menu: "Gepland onderhoud",
      statusPage: "Gepland onderhoud",
      adminDashboard: "Gepland onderhoud",
    });

    const docsNavigation: string = fs.readFileSync(
      path.join(LOCALE_DIRS["Docs navigation"]!, "nl.json"),
      "utf8",
    );

    expect(docsNavigation).toContain(
      '"Scheduled Maintenance": "Gepland onderhoud"',
    );
  });

  for (const app of Object.keys(LOCALE_DIRS)) {
    test(`no ${app} string says geplande onderhoud without het, dit or uw`, () => {
      const strings: Strings | null = stringsOf(app, "nl");
      const wrong: Array<{ key: string; forms: Array<string> }> = [];

      for (const [key, text] of strings || new Map<string, string>()) {
        const forms: Array<string> = wrongDutchForms(text);

        if (forms.length > 0) {
          wrong.push({ key, forms });
        }
      }

      expect(wrong).toEqual([]);
    });
  }

  test("no Dutch docs page says geplande onderhoud without het, dit or uw", () => {
    const wrong: Array<{ page: string; line: number; forms: Array<string> }> =
      [];

    for (const page of dutchDocsPages()) {
      fs.readFileSync(page, "utf8")
        .split("\n")
        .forEach((line: string, index: number) => {
          const forms: Array<string> = wrongDutchForms(line);

          if (forms.length > 0) {
            wrong.push({
              page: path.relative(DOCS_CONTENT_DIR, page),
              line: index + 1,
              forms,
            });
          }
        });
    }

    expect(wrong).toEqual([]);
  });

  test("the forms are told apart (control)", () => {
    expect(wrongDutchForms("Geplande onderhoud")).toEqual([
      "Geplande onderhoud",
    ]);
    expect(
      wrongDutchForms("Open **Geplande onderhoud → Instellingen**"),
    ).toEqual(["Geplande onderhoud"]);
    expect(wrongDutchForms("voor geplande onderhoud")).toEqual([
      "voor geplande onderhoud",
    ]);
    expect(wrongDutchForms("voor deze geplande onderhoud")).toEqual([
      "deze geplande onderhoud",
    ]);
    expect(wrongDutchForms("voor dit geplande onderhoud")).toEqual([]);
    expect(wrongDutchForms("de gegevens van het geplande onderhoud")).toEqual(
      [],
    );
    expect(wrongDutchForms("uw geplande onderhoud")).toEqual([]);
    expect(wrongDutchForms("Gepland onderhoud")).toEqual([]);
    expect(wrongDutchForms("geplande onderhoudsgebeurtenissen")).toEqual([]);
  });
});
