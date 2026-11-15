import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE REST OF THE ON-CALL NAMES, IN EVERY DASHBOARD LANGUAGE, ONE WORD FOR
 * EACH THING (#8435).
 *
 * #8320 named the on-call policy's execution log in the eleven languages
 * that kept it in English. Twenty-four more on-call names were still
 * English there: "On-Call Shift Reminders", "On-Call Schedule Team Owners",
 * "Escalation Rule:" and the rest - a Danish reader met "On-Call Shift
 * Reminder Logs" beside "Vagtplaner". German and French kept
 * "Escalation Rule:", and French "User On-Call Log Timeline ID".
 *
 * And four languages named an on-call thing two ways:
 *
 *   - Italian: the menu's "Policy di reperibilità" beside "criterio di
 *     reperibilità" in 48 strings ("ID del criterio di reperibilità");
 *   - Norwegian: the menu's "Vaktretningslinjer" beside "Vaktpolicy" in
 *     some 180 strings of the Dashboard, the Admin Dashboard and the server.
 *     #8527 settled it on "vaktpolicy", the word for one policy, for the
 *     first one ("Standard vaktpolicy") and for every other Norwegian
 *     policy (varslingspolicy, feilbudsjettpolicy), and moved the menu;
 *   - Portuguese: "Plantão" with a capital in the middle of a name in
 *     sentence case ("ID da política de Plantão");
 *   - Arabic: "Timeline" is المخطط الزمني, but other timelines said
 *     الخط الزمني or الجدول الزمني - a schedule's word.
 *
 * Each now says the one word. OneNamePerThingGuard holds Italian,
 * Norwegian and Portuguese to their on-call word in every app; Arabic's
 * timeline is no Products-menu title, so it is held here.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const NAMES: ReadonlyArray<string> = [
  "Escalation Rule ID",
  "Escalation Rule:",
  "On-Call Calendar Feed",
  "On-Call Calendar Feeds",
  "On-Call Policy Escalation Rule",
  "On-Call Policy Escalation Rule ID",
  "On-Call Policy Execution Repeat Count",
  "On-Call Policy Feed Event",
  "On-Call Policy Label Rule",
  "On-Call Policy Owner Rule",
  "On-Call Schedule Calendar Feed",
  "On-Call Schedule Calendar Feeds",
  "On-Call Schedule Label Rule",
  "On-Call Schedule Layer ID",
  "On-Call Schedule Owner Rule",
  "On-Call Schedule Team Owner",
  "On-Call Schedule Team Owners",
  "On-Call Schedule User Owner",
  "On-Call Schedule User Owners",
  "On-Call Shift Reminder",
  "On-Call Shift Reminder Log",
  "On-Call Shift Reminder Logs",
  "On-Call Shift Reminders",
  "User On-Call Log Timeline ID",
];

// The English words of the names, none of which a translation keeps.
const ENGLISH_WORDS: RegExp =
  /\b(?:On-Call|Escalation|Calendar|Shift|Reminder|Owner|Rule|Timeline|Layer|Repeat|Event)s?\b/u;

/*
 * What each language calls an on-call policy inside a longer name, as its
 * pages say it, in lower case, one or many (OnCallPolicyExecutionLogNamesInEveryLanguage).
 */
const ON_CALL_POLICY_WORD: Readonly<Record<string, RegExp>> = {
  de: /bereitschaftsrichtlinie/u,
  es: /políticas? de guardia/u,
  fr: /politiques? d'astreinte/u,
  it: /policy di reperibilità/u,
  pt: /políticas? de plantão/u,
  nl: /bereikbaarheidsbeleid/u,
  da: /vagtpolitik/u,
  no: /vaktpolic/u,
  sv: /jourpolic/u,
  ru: /политик\S* дежурств/u,
  ja: /オンコールポリシー/u,
  ko: /온콜 정책/u,
  "zh-CN": /值班策略/u,
  "zh-TW": /待命策略/u,
  hi: /ऑन-कॉल नीति/u,
  fa: /سیاست(?:\u200cهای)? آنکال/u,
  ar: /سياس(?:ة|ات) المناوبة/u,
};

// The languages that kept these names in English until #8435.
const LEFT_IN_ENGLISH: ReadonlyArray<string> = [
  "da",
  "hi",
  "it",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

// Another app's locale file, by its folder from the App's FeatureSet.
function readAppLocale(
  folder: string,
  language: string,
): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../../..", folder, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

// Every string of a locale file, nested ones too, by its key.
function stringsOf(
  locale: Record<string, unknown>,
  prefix: string = "",
): Array<[string, string]> {
  const strings: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(locale)) {
    if (typeof value === "string") {
      strings.push([`${prefix}${key}`, value]);
    } else if (value && typeof value === "object") {
      strings.push(
        ...stringsOf(value as Record<string, unknown>, `${prefix}${key}.`),
      );
    }
  }

  return strings;
}

// The keys whose text matches `dropped`, in every listed app's file.
function sightings(
  language: string,
  dropped: (key: string, text: string) => boolean,
  folders: ReadonlyArray<string>,
): Array<string> {
  const found: Array<string> = [];

  for (const folder of folders) {
    if (
      !fs.existsSync(
        path.resolve(__dirname, "../../../..", folder, `${language}.json`),
      )
    ) {
      continue;
    }

    for (const [key, text] of stringsOf(readAppLocale(folder, language))) {
      if (dropped(key, text)) {
        found.push(`${folder}: ${key} => ${text}`);
      }
    }
  }

  return found;
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src/Locales";
const ADMIN_DASHBOARD: string = "App/FeatureSet/AdminDashboard/src/Locales";
const SERVER: string = "Common/Server/Locales";

describe("the rest of the on-call names, in every Dashboard language (#8435)", () => {
  test("the locales folder is the Dashboard's", () => {
    expect(fs.existsSync(path.join(LOCALES_DIR, "en.json"))).toBe(true);
  });

  test.each(NAMES)("English has %s, as itself", (name: string) => {
    expect(readDashboardLocale("en")[name]).toBe(name);
  });

  test("every language the Dashboard offers is read", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(Object.keys(ON_CALL_POLICY_WORD).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  describe.each([...DASHBOARD_LANGUAGES])("%s", (language: string) => {
    test.each(NAMES)("words %s", (name: string) => {
      const text: string | undefined = readDashboardLocale(language)[name];

      expect({
        language,
        name,
        worded: isWordedInDashboardLocale(name, language),
      }).toEqual({ language, name, worded: true });
      expect(text).not.toBe(name);
      expect({
        language,
        name,
        english: ENGLISH_WORDS.test(text || ""),
      }).toEqual({ language, name, english: false });
    });

    test("names an on-call policy as its pages do, in every name of one", () => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const name of NAMES.filter((candidate: string): boolean => {
        return candidate.startsWith("On-Call Policy ");
      })) {
        expect({
          language,
          name,
          hasWord: ON_CALL_POLICY_WORD[language]!.test(
            (words[name] || "").toLocaleLowerCase(language),
          ),
        }).toEqual({ language, name, hasWord: true });
      }
    });

    test("a label keeps its colon, as its language writes one", () => {
      expect(readDashboardLocale(language)["Escalation Rule:"]).toMatch(
        /[:：]$/u,
      );
    });

    test("an ID is never the record it identifies", () => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words["On-Call Policy Escalation Rule ID"]).not.toBe(
        words["On-Call Policy Escalation Rule"],
      );
      expect(words["Escalation Rule ID"]).not.toBe(words["Escalation Rule"]);
      expect(words["On-Call Shift Reminder Log"]).not.toBe(
        words["On-Call Shift Reminder"],
      );
    });
  });

  test.each(LEFT_IN_ENGLISH)(
    "%s no longer reads English",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const name of NAMES) {
        expect({ language, name, english: words[name] === name }).toEqual({
          language,
          name,
          english: false,
        });
      }
    },
  );
});

describe("one word for an on-call thing in Italian, Norwegian, Portuguese and Arabic (#8435)", () => {
  const ITALIAN_DROPPED: RegExp = /criteri[oi] di reperibilità/iu;
  /*
   * The words #8527 dropped for an on-call or incoming call policy, as
   * App/Tests/Dashboard/OneNamePerThing.ts has them.
   */
  const NORWEGIAN_DROPPED: RegExp =
    /vakt(?:tjeneste-?|ordning-)?retningslinj|retningslinj\p{L}* for (?:vakttjeneste|innkommende anrop)|anropsretningslinj/iu;
  // "Plantão" with a capital after a lower-case word: "da política de Plantão".
  const PORTUGUESE_DROPPED: RegExp = /(?:^|\s)\p{Ll}\S* d[eoa] Plantão/u;
  const ARABIC_DROPPED: RegExp = /الخط الزمني|خط زمني/u;
  // A masculine word before a policy, which is feminine: "il policy".
  const ITALIAN_MASCULINE_POLICY: RegExp =
    /(?:^|\s)(?:il|un|del|al|dal|sul|nel|questo|nessun) policy di reperibilità/iu;

  test("Italian says the menu's policy di reperibilità, never criterio di reperibilità", () => {
    expect(readDashboardLocale("it")["On-Call Policies"]).toMatch(
      /policy di reperibilità/iu,
    );
    expect(
      sightings(
        "it",
        (_key: string, text: string): boolean => {
          return ITALIAN_DROPPED.test(text);
        },
        [DASHBOARD, ADMIN_DASHBOARD, SERVER],
      ),
    ).toEqual([]);
    expect(readDashboardLocale("it")["On-Call Policy ID"]).toBe(
      "ID della policy di reperibilità",
    );
    // Its grammar follows: a policy is feminine.
    expect(readDashboardLocale("it")["No On-Call Policy"]).toBe(
      "Nessuna policy di reperibilità",
    );
    expect(
      sightings(
        "it",
        (_key: string, text: string): boolean => {
          return ITALIAN_MASCULINE_POLICY.test(text);
        },
        [DASHBOARD],
      ),
    ).toEqual([]);
  });

  test("Norwegian says vaktpolicy, never vaktretningslinje, in every app (#8527)", () => {
    expect(readDashboardLocale("no")["On-Call Policies"]).toBe("Vaktpolicyer");
    expect(
      sightings(
        "no",
        (_key: string, text: string): boolean => {
          return NORWEGIAN_DROPPED.test(text);
        },
        [DASHBOARD, ADMIN_DASHBOARD, SERVER],
      ),
    ).toEqual([]);
    expect(readDashboardLocale("no")["On-Call Policy"]).toBe("Vaktpolicy");
  });

  test("Portuguese writes plantão in lower case in the middle of a name in sentence case", () => {
    expect(
      sightings(
        "pt",
        (_key: string, text: string): boolean => {
          return PORTUGUESE_DROPPED.test(text);
        },
        [DASHBOARD, ADMIN_DASHBOARD, SERVER],
      ),
    ).toEqual([]);
    expect(readDashboardLocale("pt")["On-Call Policy ID"]).toBe(
      "ID da política de plantão",
    );
    // A menu's path keeps the menu's own name: "Plantão > Prontidão".
    expect(readDashboardLocale("pt")["On-Call"]).toBe("Plantão");
  });

  test("Arabic names a timeline المخطط الزمني, as its Timeline does, never الخط الزمني", () => {
    expect(readDashboardLocale("ar")["Timeline"]).toBe("المخطط الزمني");
    expect(
      sightings(
        "ar",
        (_key: string, text: string): boolean => {
          return ARABIC_DROPPED.test(text);
        },
        [DASHBOARD, ADMIN_DASHBOARD, SERVER],
      ),
    ).toEqual([]);
  });

  test("Arabic never names a timeline with a schedule's word, الجدول الزمني", () => {
    expect(
      sightings(
        "ar",
        (key: string, text: string): boolean => {
          const english: string = key.toLowerCase();

          return (
            english.includes("timeline") &&
            !english.includes("schedule") &&
            text.includes("الجدول الزمني")
          );
        },
        [DASHBOARD, ADMIN_DASHBOARD],
      ),
    ).toEqual([]);
    // A schedule keeps its word.
    expect(readDashboardLocale("ar")["Schedule"]).toBe("الجدول الزمني");
    expect(readDashboardLocale("ar")["Execution Timeline"]).toContain(
      "المخطط الزمني",
    );
  });

  // The checks catch each dropped word, and pass the one name.
  test("negative control: the dropped words are caught, the one names are not", () => {
    expect(ITALIAN_DROPPED.test("ID del criterio di reperibilità")).toBe(true);
    expect(ITALIAN_DROPPED.test("ID della policy di reperibilità")).toBe(false);
    expect(ITALIAN_DROPPED.test("I criteri di ripetizione")).toBe(false);
    expect(NORWEGIAN_DROPPED.test("Vaktretningslinjene")).toBe(true);
    expect(NORWEGIAN_DROPPED.test("Vaktpolicyene")).toBe(false);
    expect(PORTUGUESE_DROPPED.test("ID da política de Plantão")).toBe(true);
    expect(PORTUGUESE_DROPPED.test("Minhas Políticas de Plantão")).toBe(false);
    expect(PORTUGUESE_DROPPED.test("Abra Plantão > Prontidão")).toBe(false);
    expect(ARABIC_DROPPED.test("الخط الزمني للحالة")).toBe(true);
    expect(ARABIC_DROPPED.test("المخطط الزمني للحالة")).toBe(false);
  });
});
