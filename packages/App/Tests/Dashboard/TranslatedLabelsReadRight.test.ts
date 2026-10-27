import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE TRANSLATION BACKLOG'S UI REVIEW (#5287) FOUND ON SCREEN.
 *
 * TranslationBacklogLocales holds that the backlog's words are translated.
 * This holds that they read right where the Dashboard draws them:
 *
 *   - a sentence that names a state, a field or a time range is worded
 *     differently from the English in every language: one that reads the
 *     same is filled with ENGLISH names at run time (TranslateTemplate cannot
 *     tell it from an untranslated one), so Italian's stat tiles read
 *     "ACKNOWLEDGED IN";
 *   - a security case's page never gives two of its labels the same words
 *     (Italian "Aperto da" was Opened By and Open For, Russian "Открыт" was
 *     Opened and Open For);
 *   - a network chart's In and Out read as traffic directions, never as On
 *     and Off (German "Ein"/"Aus", Dutch "Uit") or Sign in and Sign out
 *     (Russian "Вход"/"Выход");
 *   - the seeded alert and incident states read as one family (Italian
 *     "Identificate, Riconosciuto, Risolto" mixed a plural in);
 *   - the gauge's setup prompt names it as the Add Widget picker does;
 *   - the Add Trigger panel says one word for a trigger, its trigger and
 *     action counts included;
 *   - the SLO rule tables' Create buttons read in the reader's language;
 *   - a status pill says what a resource is doing (Swedish "Rapporterar").
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const LOCALES: string = path.join(DASHBOARD, "src", "Locales");
const I18N: string = path.join(DASHBOARD, "i18n");

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

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

function valueOf(code: string, key: string): string {
  const value: unknown = readLocale(code)[key];

  if (typeof value !== "string") {
    throw new Error(`${code} has no "${key}"`);
  }

  return value;
}

// The words a language writes as the English does: every language's, and its own.
function sameAsEnglishIn(code: string): Array<string> {
  const everyLanguage: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;
  const own: Array<string> =
    (
      JSON.parse(
        fs.readFileSync(path.join(I18N, "Progress", `${code}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || [];

  return [...everyLanguage, ...own];
}

/*
 * A translator for a language as the Dashboard ships it: a string that
 * reads the same as the English is left out of the shipped locale
 * (Common/UI/esbuild-locales.js), so the lookup finds nothing for it.
 */
function shippedTranslatorFor(code: string): Translator {
  return createTranslator((text: string): string | undefined => {
    const value: unknown = readLocale(code)[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

// Lower case, accents and other marks left out: "Måler" and "maler" match.
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLocaleLowerCase();
}

describe("a sentence that names a state, a field or a time range", () => {
  /*
   * Each is filled with a translatable term: OneUptime's own state names,
   * a facet's title, a preset's name.
   */
  const TEMPLATES: ReadonlyArray<string> = [
    "{{stateName}} in",
    "Not yet {{stateName}}",
    "{{field}} is not",
    "Show {{range}}",
  ];

  test.each(LANGUAGES)(
    "is worded apart from the English in %s, so its names are translated",
    (code: string) => {
      for (const template of TEMPLATES) {
        expect({
          code,
          template,
          sameAsEnglish: valueOf(code, template),
        }).not.toEqual({ code, template, sameAsEnglish: template });
        expect(sameAsEnglishIn(code)).not.toContain(template);
      }
    },
  );

  test("one that reads as the English is filled with English names", () => {
    /*
     * Why the rule above: a sentence worded the same as the English never
     * ships, and the lookup cannot tell it from an untranslated one.
     */
    const italianBefore: Translator = createTranslator(
      (text: string): string | undefined => {
        if (text === "Acknowledged") {
          return "Riconosciuto";
        }

        return undefined;
      },
      "it",
    );

    expect(
      italianBefore.translateTemplate("{{stateName}} in", {
        stateName: translatableTerm("Acknowledged"),
      }),
    ).toBe("Acknowledged in");
  });

  test.each(LANGUAGES)(
    "the incident tiles name OneUptime's states in %s",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);

      for (const state of ["Acknowledged", "Resolved"]) {
        const label: string = translator.translateTemplate("{{stateName}} in", {
          stateName: translatableTerm(state),
        });

        expect({ code, label, english: label.includes(state) }).toEqual({
          code,
          label,
          english: false,
        });
      }
    },
  );

  test("Italian's tiles read Riconosciuto dopo and Risolto dopo", () => {
    const italian: Translator = shippedTranslatorFor("it");

    expect(
      italian.translateTemplate("{{stateName}} in", {
        stateName: translatableTerm("Acknowledged"),
      }),
    ).toBe("Riconosciuto dopo");
    expect(
      italian.translateTemplate("{{stateName}} in", {
        stateName: translatableTerm("Resolved"),
      }),
    ).toBe("Risolto dopo");
  });
});

describe("a security case's page", () => {
  /*
   * The header's facts (Pages/SecurityEvents/CaseView: Assignee, Team,
   * Opened By, Opened, Last Detection) and the figures under it
   * (Detections, Open For or Took, Time to Acknowledge, Time to Contain).
   */
  const LABELS: ReadonlyArray<string> = [
    "Assignee",
    "Team",
    "Opened By",
    "Opened",
    "Last Detection",
    "Detections",
    "Open For",
    "Took",
    "Time to Acknowledge",
    "Time to Contain",
  ];

  test.each(LANGUAGES)(
    "never gives two labels the same words in %s",
    (code: string) => {
      const seen: Map<string, string> = new Map<string, string>();

      for (const label of LABELS) {
        const words: string = folded(valueOf(code, label));

        expect({ code, label, sameAs: seen.get(words) }).toEqual({
          code,
          label,
          sameAs: undefined,
        });
        seen.set(words, label);
      }
    },
  );

  test("Italian and Russian say how long a case is open in words of their own", () => {
    expect(valueOf("it", "Open For")).toBe("Da quanto è aperto");
    expect(valueOf("it", "Opened By")).toBe("Aperto da");
    expect(valueOf("ru", "Open For")).toBe("Открыт уже");
    expect(valueOf("ru", "Opened")).toBe("Открыт");
  });
});

describe("a network chart's In and Out", () => {
  /*
   * The legends of the Host, Docker, Podman, Kubernetes and Proxmox
   * overview charts (withTranslatedSeriesNames), the network traffic chart
   * and the SNMP interfaces table's columns.
   */
  test.each(LANGUAGES)(
    "read as traffic directions in %s, never as On and Off",
    (code: string) => {
      const inbound: string = valueOf(code, "In");
      const outbound: string = valueOf(code, "Out");

      expect(inbound).not.toBe(outbound);
      expect({ code, inbound, isOn: inbound === valueOf(code, "On") }).toEqual({
        code,
        inbound,
        isOn: false,
      });
      expect({
        code,
        outbound,
        isOff: outbound === valueOf(code, "Off"),
      }).toEqual({ code, outbound, isOff: false });
    },
  );

  test("German, Dutch, Russian and Hindi say incoming and outgoing", () => {
    expect([valueOf("de", "In"), valueOf("de", "Out")]).toEqual([
      "Eingehend",
      "Ausgehend",
    ]);
    expect([valueOf("nl", "In"), valueOf("nl", "Out")]).toEqual([
      "Inkomend",
      "Uitgaand",
    ]);
    // Never "Вход"/"Выход", which read as Sign in and Sign out.
    expect([valueOf("ru", "In"), valueOf("ru", "Out")]).toEqual([
      "Входящий",
      "Исходящий",
    ]);
    expect([valueOf("hi", "In"), valueOf("hi", "Out")]).toEqual([
      "इनकमिंग",
      "आउटगोइंग",
    ]);
  });
});

describe("the seeded alert and incident states", () => {
  /*
   * A new project's states (Identified, Acknowledged, Resolved), drawn in
   * the reader's words on every state pill: one family, a single state's
   * name each - not the plural a session list's "Identified" filter takes.
   */
  const FAMILIES: Record<string, ReadonlyArray<string>> = {
    it: ["Identificato", "Riconosciuto", "Risolto"],
    pt: ["Identificado", "Confirmado", "Resolvido"],
    sv: ["Identifierad", "Bekräftad", "Löst"],
    ru: ["Выявлен", "Подтверждён", "Устранён"],
    hi: ["पहचाना गया", "स्वीकार किया गया", "सुलझाया गया"],
  };

  test.each(Object.keys(FAMILIES))(
    "read as one family in %s",
    (code: string) => {
      expect([
        valueOf(code, "Identified"),
        valueOf(code, "Acknowledged"),
        valueOf(code, "Resolved"),
      ]).toEqual(FAMILIES[code]);
    },
  );
});

describe("the older seeded state Created, whose word date columns share", () => {
  /*
   * A project made before its first state was named Identified still has
   * Created, drawn by its English key - the key every "Created" column of
   * dates, tile and import result reads too. Japanese wrote it 作成日時,
   * "the date and time of creation", so every Created incident and alert
   * read as a date in its state pill and its header's track (#5251). It is
   * 作成 now: a state as much as a column of dates, as 開始 (Started) and
   * 終了 (Ended) are. Created At, the date's own key, keeps 作成日時.
   */
  test("Japanese reads it as a state, and as a column of dates", () => {
    expect(valueOf("ja", "Created")).toBe("作成");
    expect(valueOf("ja", "Created At")).toBe("作成日時");
    expect([valueOf("ja", "Started"), valueOf("ja", "Ended")]).toEqual([
      "開始",
      "終了",
    ]);
  });

  test("its family reads one after another in the header's track", () => {
    expect([
      valueOf("ja", "Created"),
      valueOf("ja", "Acknowledged"),
      valueOf("ja", "Resolved"),
    ]).toEqual(["作成", "確認済み", "解決済み"]);
  });
});

describe("the gauge widget's setup prompt", () => {
  test.each(LANGUAGES)(
    "names the gauge as the Add Widget picker does in %s",
    (code: string) => {
      // The picker's word, its last letters left out for a compound's join.
      const picker: string = folded(valueOf(code, "Gauge"));
      const stem: string = Array.from(picker)
        .slice(0, Math.max(2, Array.from(picker).length - 2))
        .join("");

      for (const title of ["Gauge Widget", "Data Source Gauge"]) {
        const words: string = valueOf(code, title);

        expect({
          code,
          title,
          words,
          named: folded(words).includes(stem),
        }).toEqual({ code, title, words, named: true });
      }
    },
  );

  test("Simplified Chinese says widget as the other widgets do", () => {
    expect(valueOf("zh-CN", "Gauge Widget")).toBe("仪表小部件");
    expect(valueOf("zh-CN", "Value Widget")).toContain("小部件");
  });
});

describe("the Add Trigger panel", () => {
  // Each language's word for a trigger, as its panel says it.
  const TRIGGER: Record<string, string> = {
    de: "Auslöser",
    fr: "déclencheur",
    es: "desencadenante",
    it: "trigger",
    pt: "gatilho",
    nl: "trigger",
    da: "udløser",
    no: "utløser",
    sv: "utlösare",
    ru: "триггер",
    ja: "トリガー",
    ko: "트리거",
    "zh-CN": "触发器",
    "zh-TW": "觸發器",
    hi: "ट्रिगर",
    fa: "تریگر",
  };

  // Its title, search box, description, section and a resource's count.
  const PANEL: ReadonlyArray<string> = [
    "Add Trigger",
    "Search triggers, e.g. incident created",
    "Click a trigger to add it to your workflow.",
    "More triggers",
    "{{count}} triggers",
  ];

  test("covers every language", () => {
    expect(Object.keys(TRIGGER).sort()).toEqual([...LANGUAGES].sort());
  });

  test.each(LANGUAGES)("says one word for a trigger in %s", (code: string) => {
    const word: string = folded(TRIGGER[code] as string);

    for (const key of PANEL) {
      const words: string = valueOf(code, key);

      expect({ code, key, words, says: folded(words).includes(word) }).toEqual({
        code,
        key,
        words,
        says: true,
      });
    }
  });

  test.each(LANGUAGES)("counts triggers and actions in %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);

    for (const key of ["{{count}} triggers", "{{count}} actions"]) {
      const words: string = valueOf(code, key);

      expect(words).toContain("{{count}}");

      if (words === key) {
        expect(same).toContain(key);
      }
    }
  });
});

describe("the SLO rule tables' Create buttons", () => {
  /*
   * "Create {{itemName}}" with the table's row name: the Burn Rate Rules and
   * Monitor Rules pages' main action.
   */
  const NAMES: ReadonlyArray<string> = [
    "SLO Burn Rate Rule",
    "SLO Burn Rate Rules",
    "SLO Monitor Rule",
    "SLO Monitor Rules",
  ];

  test.each(LANGUAGES)("read in %s", (code: string) => {
    const translator: Translator = shippedTranslatorFor(code);

    for (const name of NAMES) {
      expect({ code, name, english: valueOf(code, name) === name }).toEqual({
        code,
        name,
        english: false,
      });
    }

    const button: string = translator.translateTemplate("Create {{itemName}}", {
      itemName: translatableTerm("SLO Burn Rate Rule"),
    });

    expect(button).not.toContain("Burn Rate Rule");
  });
});

describe("a status pill", () => {
  test("says what a resource is doing: Swedish Rapporterar, not the noun", () => {
    expect(valueOf("sv", "Reporting")).toBe("Rapporterar");
  });
});

describe("Japanese Dismiss", () => {
  test("reads 非表示 (Hide): it closes error banners and sets suggestions aside", () => {
    expect(valueOf("ja", "Dismiss")).toBe("非表示");
    // Never Close, nor Reject, which an error banner's Dismiss is not.
    expect(valueOf("ja", "Dismiss")).not.toBe(valueOf("ja", "Close"));
    expect(valueOf("ja", "Dismiss")).not.toBe("却下");
  });
});
