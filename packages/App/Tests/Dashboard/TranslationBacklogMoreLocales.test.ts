import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import { setDateDisplayLanguage } from "Common/Types/DateLanguage";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * THE TRANSLATION BACKLOG, MORE (#6028): WHAT WAS STILL ENGLISH, OR READ
 * WORD FOR WORD.
 *
 * The maintainer's follow-ups named what the last passes left: the
 * Security Events in-signal titles had keys and no words, model names in
 * seven languages read word for word ("Avviso Personalizzato Campo" for
 * Alert Custom Field) and in Chinese with spaces between the words, Episode
 * Rules and Alert Rules read English in twelve languages, German drew
 * "Berichtsdienste" and an English "Task", four Persian uptime colours put
 * the percent sign first, and one key was left over from a removed line.
 * The areas people meet first - incidents and their notes, alerts,
 * scheduled maintenance, on-call, status pages, monitors, home and sign-up -
 * were worded in every language. This holds them:
 *
 *   - every line named below reads in each language's own words, with the
 *     English's placeholders and, where a language counts, both forms;
 *   - model names read in each language's own order, never word for word,
 *     and the Chinese ones as one word;
 *   - Persian writes a percentage with the sign after the number (٪);
 *   - the orphan key is gone from every locale.
 *
 * The telemetry hints, the companion tabs and the replay rail are held by
 * TelemetryHintsInEveryLanguage (Common); the help lines' direction by
 * HelpLinesReadAsWritten (Common).
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const LOCALES: string = path.join(DASHBOARD, "src", "Locales");
const PROGRESS: string = path.join(DASHBOARD, "i18n", "Progress");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

// The languages whose plural rules have a "one" form the locale stores.
const ONE_FORM_LANGUAGES: ReadonlyArray<string> = LANGUAGES.filter(
  (code: string): boolean => {
    return !["ja", "ko", "zh-CN", "zh-TW"].includes(code);
  },
);

type Locale = Record<string, unknown>;

const localeCache: Map<string, Locale> = new Map<string, Locale>();

function readLocale(code: string): Locale {
  const cached: Locale | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const locale: Locale = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Locale;
  localeCache.set(code, locale);

  return locale;
}

function valueOf(code: string, key: string): string | undefined {
  const value: unknown = readLocale(code)[key];

  return typeof value === "string" ? value : undefined;
}

function sameAsEnglish(code: string): Array<string> {
  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(path.join(PROGRESS, `${code}.json`), "utf8"),
  ) as { sameAsEnglish?: Array<string> };

  return progress.sameAsEnglish || [];
}

function placeholders(text: string): Array<string> {
  return (text.match(/\{\{\w+\}\}/g) || []).sort();
}

function translatorFor(code: string): Translator {
  return createTranslator((key: string): string | undefined => {
    return valueOf(code, key);
  }, code);
}

// Each line worded in a language: present, not the English, its placeholders kept.
function unworded(code: string, keys: ReadonlyArray<string>): Array<string> {
  const problems: Array<string> = [];

  for (const key of keys) {
    const value: string | undefined = valueOf(code, key);

    if (value === undefined) {
      problems.push(`${code}: no key ${key}`);
      continue;
    }

    if (value === key) {
      problems.push(`${code}: English ${key}`);
      continue;
    }

    if (placeholders(value).join() !== placeholders(key).join()) {
      problems.push(`${code}: placeholders of ${key}`);
    }
  }

  return problems;
}

const IN_SIGNAL_TITLES: ReadonlyArray<PluralTemplate> = [
  {
    one: "{{count}} security event happened in this request",
    other: "{{count}} security events happened in this request",
  },
  {
    one: "This line raised {{count}} security event",
    other: "This line raised {{count}} security events",
  },
  {
    one: "{{count}} security event happened in this session",
    other: "{{count}} security events happened in this session",
  },
  {
    one: "{{count}} security event happened in a request that threw this exception",
    other:
      "{{count}} security events happened in requests that threw this exception",
  },
];

describe("the Security Events in-signal titles", () => {
  test.each(LANGUAGES)(
    "in %s, each title and its singular sentence are worded",
    (code: string) => {
      const keys: Array<string> = [
        "{{count}}+ security events are part of this",
      ];

      for (const title of IN_SIGNAL_TITLES) {
        keys.push(title.other, title.one);
      }

      expect(unworded(code, keys)).toEqual([]);
    },
  );

  test.each(ONE_FORM_LANGUAGES)(
    "in %s, one event reads in the language's one form, many in its other",
    (code: string) => {
      const translator: Translator = translatorFor(code);

      for (const title of IN_SIGNAL_TITLES) {
        const one: string = translator.translatePlural(title, 1);
        const many: string = translator.translatePlural(title, 7);

        expect(one).not.toBe(title.one.replace("{{count}}", "1"));
        expect(many).not.toBe(title.other.replace("{{count}}", "7"));
        expect(one).toContain(translator.formatNumber(1));
        expect(many).toContain(translator.formatNumber(7));
        expect(valueOf(code, `${title.other}_one`)).toBeDefined();
      }
    },
  );

  test("German counts one event and many, each in its own words", () => {
    const german: Translator = translatorFor("de");

    expect(german.translatePlural(IN_SIGNAL_TITLES[0]!, 1)).toBe(
      "1 Sicherheitsereignis in dieser Anfrage",
    );
    expect(german.translatePlural(IN_SIGNAL_TITLES[0]!, 3)).toBe(
      "3 Sicherheitsereignisse in dieser Anfrage",
    );
  });
});

describe("the named leftovers", () => {
  test.each(LANGUAGES)(
    "in %s, Episode Rules, Alert Rules and Reporting services read in the language",
    (code: string) => {
      expect(
        unworded(code, ["Episode Rules", "Alert Rules", "Reporting services"]),
      ).toEqual([]);
    },
  );

  test("German's reporting services are the services that report, not a reporting service", () => {
    expect(valueOf("de", "Reporting services")).toBe("Meldende Dienste");
    expect(valueOf("fr", "Reporting services")).toBe("Services émetteurs");
  });

  test("German's Swarm task card says Aufgabe, and German no longer keeps Task English", () => {
    expect(valueOf("de", "Task")).toBe("Aufgabe");
    expect(sameAsEnglish("de")).not.toContain("Task");
  });

  test.each(["de", "es", "it", "pt", "sv", "hi", "fa", "fr"])(
    "in %s, a duration of days and hours uses the language's own units",
    (code: string) => {
      expect(unworded(code, ["{{days}}d {{hours}}h"])).toEqual([]);
    },
  );

  test("the orphan key of a removed line is gone from every locale", () => {
    const orphan: string =
      "What this host is and runs, as its collector reports it.";

    for (const code of ["en", ...LANGUAGES]) {
      expect({ code, has: orphan in readLocale(code) }).toEqual({
        code,
        has: false,
      });
    }
  });
});

describe("Persian percentages", () => {
  const PERCENT_LINES: ReadonlyArray<string> = [
    "A day under {{percent}}% uptime matches no rule, so it takes the default bar color.",
    "The {{percent}}% rule never colors a day: a rule above it already matches every day it would. Drag it higher.",
    "Under {{percent}}%",
    "{{percent}}% or more",
  ];

  test.each(PERCENT_LINES)(
    "%s writes the Persian percent sign after the number",
    (key: string) => {
      const value: string = valueOf("fa", key) || "";

      expect(value).toContain("{{percent}}٪");
      expect(value).not.toContain("٪{{percent}}");
      expect(value).not.toContain("%");
    },
  );

  test("filled in, the number comes first, then the sign", () => {
    const persian: Translator = translatorFor("fa");

    expect(
      persian.translateTemplate("Under {{percent}}%", { percent: "۹۹٫۹" }),
    ).toBe("کمتر از ۹۹٫۹٪");
  });
});

/*
 * Model names that read word for word before: the English words' own
 * translations in the English order. Each now reads in the language's own
 * order and joins.
 */
const MODEL_NAMES: Record<
  string,
  Record<string, { was: string; is: string }>
> = {
  it: {
    "Alert Custom Field": {
      was: "Avviso Personalizzato Campo",
      is: "Campo personalizzato dell'avviso",
    },
    "Workflow Variable": {
      was: "Flusso di lavoro Variabile",
      is: "Variabile del flusso di lavoro",
    },
    "SMTP Config": { was: "SMTP Configurazione", is: "Configurazione SMTP" },
  },
  pt: {
    "Incident Template": { was: "Incidente Modelo", is: "Modelo de incidente" },
    "Monitor Group": { was: "Monitor Grupo", is: "Grupo de monitores" },
  },
  nl: {
    "Workflow Variable": {
      was: "Workflow Variabele",
      is: "Workflowvariabele",
    },
    "Monitor Status Event": {
      was: "Monitor Status Gebeurtenis",
      is: "Monitorstatusgebeurtenis",
    },
  },
  da: {
    "Incident Template": { was: "Hændelse Skabelon", is: "Hændelsesskabelon" },
    "SMTP Config": { was: "SMTP Konfiguration", is: "SMTP-konfiguration" },
  },
  no: {
    "Incident Template": { was: "Hendelse Mal", is: "Hendelsesmal" },
    "Incident Note Template": {
      was: "Hendelse Notat Mal",
      is: "Notatmal for hendelser",
    },
  },
  sv: {
    "Alert Custom Field": {
      was: "Larm Anpassad Fält",
      is: "Anpassat fält för larm",
    },
    "Workflow Variable": {
      was: "Arbetsflöde Variabel",
      is: "Arbetsflödesvariabel",
    },
  },
  ru: {
    "Incident Template": { was: "Инцидент Шаблон", is: "Шаблон инцидента" },
    "Monitor Status Event": {
      was: "Монитор Статус Событие",
      is: "Событие статуса монитора",
    },
  },
  "zh-CN": {
    "Alert Custom Field": { was: "警报 自定义 字段", is: "警报自定义字段" },
    "Status Page Group": { was: "状态页面 组", is: "状态页面组" },
  },
  "zh-TW": {
    "Alert Custom Field": { was: "警示 自訂 欄位", is: "警示自訂欄位" },
    "Monitor Group": { was: "監測器 群組", is: "監測器群組" },
  },
};

describe("model names", () => {
  for (const [code, names] of Object.entries(MODEL_NAMES)) {
    test(`in ${code}, model names read in the language's own order, not word for word`, () => {
      for (const [english, words] of Object.entries(names)) {
        expect({ english, value: valueOf(code, english) }).toEqual({
          english,
          value: words.is,
        });
        expect(valueOf(code, english)).not.toBe(words.was);
      }
    });
  }

  test("the create buttons drawn from a name read whole", () => {
    const italian: Translator = translatorFor("it");

    expect(
      italian.translateTemplate("Create {{itemName}}", {
        itemName: valueOf("it", "Workflow Variable") || "",
      }),
    ).toBe("Crea: Variabile del flusso di lavoro");
  });

  test.each(["zh-CN", "zh-TW"])(
    "in %s, no worded model name keeps a space between its Chinese words",
    (code: string) => {
      const spaced: RegExp = /[一-鿿] [一-鿿]/;

      for (const english of Object.keys(MODEL_NAMES[code] || {})) {
        expect(valueOf(code, english)).not.toMatch(spaced);
      }

      for (const english of [
        "Incident Template",
        "Workflow Variable",
        "Monitor Status Event",
        "Incident Note Template",
        "Monitor Group",
        "Status Page Group",
        "Alert Custom Field",
      ]) {
        expect({ english, value: valueOf(code, english) }).not.toEqual({
          english,
          value: expect.stringMatching(spaced),
        });
      }
    },
  );
});

/*
 * A sample of each area this pass worded in every language: the pages
 * people meet first.
 */
const AREAS: Record<string, ReadonlyArray<string>> = {
  "incident notes": [
    "Private notes",
    "Only your team can see this",
    "Add note",
    "Search notes",
  ],
  "monitor pages": [
    "Edit Criteria",
    "Monitor Dependencies",
    "Suppress When Parent Status Is",
    "Network Device Monitoring Guide",
    "Sync Custom Fields",
    "Unnamed criteria",
  ],
  "home and sign-up": [
    "Back to sign in",
    "No credit card required.",
    "Or start a project of your own.",
  ],
  "the replay rail": [
    "Recording rows come from {{loaded}} of {{count}} segments loaded so far; they fill in as footage loads",
    "Server times unanchored; clock skew up to {{skew}}",
  ],
  "the pivot hints": [
    "Not carried over: {{fields}}",
    "Not carried over: {{fields}}.",
    "attribute {{name}}",
    "excluded {{field}}",
    "service filter",
    "severity",
  ],
};

describe("the areas people meet first", () => {
  for (const [area, keys] of Object.entries(AREAS)) {
    test.each(LANGUAGES)(
      `${area}: in %s, every line is worded`,
      (code: string) => {
        expect(unworded(code, keys)).toEqual([]);
      },
    );
  }
});

describe("the words a language already settled", () => {
  test("Korean criteria are 기준, as the monitor's Criteria tab says", () => {
    expect(valueOf("ko", "Criteria")).toBe("기준");
    expect(valueOf("ko", "Edit Criteria")).toBe("기준 편집");
  });

  /*
   * The criteria card's button was "Edit Monitoring Criteria" until #6817
   * named the card Criteria, its button "Edit Criteria": the word for
   * monitoring is pinned by the words that still say it.
   */
  test("Traditional Chinese monitoring is 監測, Hindi निगरानी, Dutch bewaking", () => {
    expect(valueOf("zh-TW", "Network Device Monitoring Guide")).toBe(
      "網路裝置監測指南",
    );
    expect(valueOf("hi", "Network Device Monitoring Guide")).toBe(
      "नेटवर्क डिवाइस निगरानी गाइड",
    );
    expect(valueOf("nl", "Monitoring")).toBe("Bewaking");
  });
});

/*
 * The AI card's message times ("3 minutes ago" beside each question) read
 * English on the German page the follow-up was taken from: a fixture that
 * never set the page's date language. The card draws the shared relative
 * time, which follows the reader's language as every feed's does.
 */
describe("the AI card's message times", () => {
  afterEach(() => {
    setDateDisplayLanguage(null);
  });

  test("are the shared relative time, never moment's English", () => {
    const source: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "src/Components/AI/InvestigationConversation/InvestigationConversation.tsx",
      ),
      "utf8",
    );
    const messageTime: string = source.slice(
      source.indexOf("const MessageTime"),
      source.indexOf("const MESSAGE_CLASS_NAME"),
    );

    expect(messageTime).toContain("OneUptimeDate.fromNow(props.date)");
    expect(messageTime).toContain(
      "OneUptimeDate.getDateAsLocalFormattedString(props.date)",
    );
    expect(messageTime).not.toMatch(/moment\(/);
  });

  test.each([
    ["de", "vor 3 Minuten"],
    ["fr", "il y a 3 minutes"],
    ["es", "hace 3 minutos"],
  ])("in %s, three minutes ago reads %s", (code: string, words: string) => {
    setDateDisplayLanguage(code);

    const now: Date = new Date("2026-11-06T12:00:00.000Z");
    const text: string = OneUptimeDate.fromNow(
      new Date(now.getTime() - 3 * 60 * 1000),
      now,
    );

    expect(text.replace(/\s/g, " ")).toBe(words);
  });
});

/*
 * THE UI REVIEW'S WORDS (#6215).
 *
 * The replay rail now draws its words in the reader's language, which put
 * old translations made without the rail beside them on screen: the chip
 * that says the list follows the playhead read "Next" in Russian (Далее),
 * Korean (다음) and Dutch (Volgend), "the following" in Swedish, Danish and
 * Traditional Chinese, and "subscribe" in Simplified Chinese (关注); the
 * tab of clicks and other interactions read as a verb in German, French
 * and Spanish ("Interagieren"), where every other language names the
 * interactions. And the title over every User Settings page, the page
 * whose matrix this pull request laid out for phones, was English in 14
 * languages.
 */
describe("the replay rail's own words", () => {
  const FOLLOWING_MISREAD: Record<string, string> = {
    ru: "Далее",
    ko: "다음",
    nl: "Volgend",
    sv: "Följande",
    da: "Følgende",
    "zh-TW": "以下",
    "zh-CN": "关注",
  };

  test.each(LANGUAGES)(
    "in %s, the chip that says the list follows the playhead is worded",
    (code: string) => {
      expect(unworded(code, ["Following"])).toEqual([]);
    },
  );

  test.each(Object.entries(FOLLOWING_MISREAD))(
    "in %s, it says the list follows, not %s",
    (code: string, misread: string) => {
      expect(valueOf(code, "Following")).not.toBe(misread);
    },
  );

  test("it reads as the chip that resumes it does, in the languages that misread it", () => {
    expect(valueOf("nl", "Following")).toBe("Volgt");
    expect(valueOf("sv", "Following")).toBe("Följer");
    expect(valueOf("da", "Following")).toBe("Følger");
    expect(valueOf("ru", "Following")).toBe("Слежение");
    expect(valueOf("ko", "Following")).toBe("따라가는 중");
    expect(valueOf("ko", "Resume following")).toBe("다시 따라가기");
    expect(valueOf("zh-CN", "Following")).toBe("跟随中");
    expect(valueOf("zh-CN", "Resume following")).toBe("继续跟随");
    expect(valueOf("zh-TW", "Following")).toBe("跟隨中");
    expect(valueOf("zh-TW", "Resume following")).toBe("繼續跟隨");
  });

  test("the Interact tab names the interactions, as the other tabs name what they hold", () => {
    expect(valueOf("de", "Interact")).toBe("Interaktionen");
    expect(valueOf("fr", "Interact")).toBe("Interactions");
    expect(valueOf("es", "Interact")).toBe("Interacciones");

    for (const code of LANGUAGES) {
      expect(["Interagieren", "Interagir", "Interactuar"]).not.toContain(
        valueOf(code, "Interact"),
      );
    }
  });
});

describe("the User Settings page's title", () => {
  test.each(LANGUAGES)(
    "in %s, it is worded, with the project's name in it",
    (code: string) => {
      expect(unworded(code, ["User Settings for Project {{project}}"])).toEqual(
        [],
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s, it names User Settings as the side menu and the breadcrumbs do",
    (code: string) => {
      const userSettings: string | undefined = valueOf(code, "User Settings");

      expect(userSettings).toBeDefined();
      expect(valueOf(code, "User Settings for Project {{project}}")).toContain(
        userSettings,
      );
    },
  );

  test("filled in, it reads whole: Benutzereinstellungen für das Projekt Acme", () => {
    expect(
      translatorFor("de").translateTemplate(
        "User Settings for Project {{project}}",
        { project: "Acme" },
      ),
    ).toBe("Benutzereinstellungen für das Projekt Acme");
  });
});

/*
 * The model names of the areas people meet first - incidents, alerts,
 * monitors, status pages, on-call and scheduled maintenance - where a pass
 * worded the singular and left its plural, or a family, word for word: the
 * English words' own translations in the English order and each with its
 * capital ("Incidente Gravità" for Incident Severities, "Statusside
 * Meddelelse" for Status Page Announcement, "Monitor Gruppe" for Monitor
 * Group). They are table titles, rule conditions, delete dialogs and the
 * create buttons drawn from a name. Read from the models themselves, so a
 * new model of these families is held to it too.
 */
describe("the first-met areas' model names", () => {
  const MODELS_DIR: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "Common",
    "Models",
    "DatabaseModels",
  );
  const NAME_IN_MODEL: RegExp = /(?:singularName|pluralName): "([^"]+)"/g;
  const FIRST_MET_FAMILY: RegExp =
    /^(Incident|Alert|Monitor|Status Page|On-Call|On Call|OnCall|Scheduled|Team On-Call|User +On-Call|Subscriber)/;
  const WORD: RegExp = /[\p{L}\p{N}'’-]+/gu;
  // Words these languages keep from English, and names that keep their case.
  const KEPT_WORDS: ReadonlySet<string> = new Set<string>([
    "Feed",
    "Feeds",
    "Log",
    "Logs",
    "Policy",
    "Postmortem",
    "Webhook",
    "OneUptime",
  ]);
  const LANGUAGES_WITH_CASE: ReadonlyArray<string> = [
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
  ];

  const firstMetNames: Array<string> = Array.from(
    new Set<string>(
      fs
        .readdirSync(MODELS_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".ts");
        })
        .flatMap((file: string): Array<string> => {
          const model: string = fs.readFileSync(
            path.join(MODELS_DIR, file),
            "utf8",
          );

          return Array.from(model.matchAll(NAME_IN_MODEL)).map(
            (match: RegExpMatchArray): string => {
              return match[1] || "";
            },
          );
        })
        .filter((name: string): boolean => {
          return FIRST_MET_FAMILY.test(name);
        }),
    ),
  ).sort();

  // Every word with a capital, as English writes a name: word for word.
  const readsWordForWord: (value: string) => boolean = (
    value: string,
  ): boolean => {
    const words: Array<string> = value.match(WORD) || [];
    const ownWords: Array<string> = words.filter((word: string): boolean => {
      return !KEPT_WORDS.has(word) && word !== word.toUpperCase();
    });

    return (
      words.length >= 2 &&
      ownWords.length >= 2 &&
      ownWords.every((word: string): boolean => {
        const first: string = word.charAt(0);

        return first !== first.toLowerCase();
      })
    );
  };

  test("the models of these areas are read", () => {
    expect(firstMetNames.length).toBeGreaterThan(150);
    expect(firstMetNames).toEqual(
      expect.arrayContaining([
        "Incident Severities",
        "Status Page Announcement",
        "Monitor Group",
        "On-Call Schedule",
      ]),
    );
  });

  test.each(LANGUAGES_WITH_CASE)(
    "in %s, none reads word for word, a capital on every word",
    (code: string) => {
      const wordForWord: Array<string> = firstMetNames
        .filter((name: string): boolean => {
          const value: string | undefined = valueOf(code, name);

          return (
            value !== undefined && value !== name && readsWordForWord(value)
          );
        })
        .map((name: string): string => {
          return `${name} = ${valueOf(code, name)}`;
        });

      expect(wordForWord).toEqual([]);
    },
  );

  test.each(["it", "pt", "ru"])(
    "in %s, a status page's parts are named before the page they belong to",
    (code: string) => {
      const statusPage: string = valueOf(code, "Status Page") || "";
      const pageFirst: Array<string> = firstMetNames
        .filter((name: string): boolean => {
          const value: string = valueOf(code, name) || "";

          return (
            name.startsWith("Status Page ") &&
            value.startsWith(`${statusPage} `) &&
            value.charAt(statusPage.length + 1) !==
              value.charAt(statusPage.length + 1).toLowerCase()
          );
        })
        .map((name: string): string => {
          return `${name} = ${valueOf(code, name)}`;
        });

      expect(statusPage.length).toBeGreaterThan(0);
      expect(pageFirst).toEqual([]);
    },
  );

  test("the names rule conditions and settings pages show read whole", () => {
    expect(valueOf("it", "Incident Severities")).toBe(
      "Gravità degli incidenti",
    );
    expect(valueOf("da", "Alert Severities")).toBe(
      "Alvorlighedsgrader for advarsler",
    );
    expect(valueOf("nl", "Alert Episodes")).toBe("Waarschuwingsepisodes");
    expect(valueOf("da", "Monitor Group")).toBe("Monitorgruppe");
    expect(valueOf("sv", "Status Page Announcement")).toBe(
      "Statussidemeddelande",
    );
    expect(valueOf("ru", "Status Page Domain")).toBe("Домен страницы статуса");
    expect(valueOf("pt", "Status Page Subscribers")).toBe(
      "Assinantes da página de status",
    );
    expect(valueOf("no", "On-Call Schedule")).toBe("Vakttidsplan");
  });

  test("a create button drawn from one reads whole: Opret Monitorgruppe", () => {
    expect(
      translatorFor("da").translateTemplate("Create {{itemName}}", {
        itemName: valueOf("da", "Monitor Group") || "",
      }),
    ).toBe("Opret Monitorgruppe");
    expect(
      translatorFor("nl").translateTemplate("Create {{itemName}}", {
        itemName: valueOf("nl", "Status Page Announcement") || "",
      }),
    ).toBe("Aankondiging op statuspagina aanmaken");
  });
});
