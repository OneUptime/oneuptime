import { describe, expect, test } from "@jest/globals";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * THE TRANSLATION BACKLOG, NEXT (#5268-#5294 FOLLOW-UPS): WHAT WAS STILL ENGLISH.
 *
 * The maintainer's follow-ups named the words still English after the last
 * translation pass: Dismiss still read Close in nine languages, the
 * Products menu kept six titles English in twelve, Notification Settings'
 * section descriptions were no keys at all, Ceph's OSD placement borrowed
 * the network legend's In and Out, and a list of single words - Remove
 * attribute filter, Disk path, the readiness page's labels, the external
 * status pages' overall statuses, Device Type, Edit Favicon, Campaigns, the
 * trace strings - read English everywhere. The orchestrator's notes added
 * the AI card's conversation, the services cards, Metrics Insights, the
 * EntityDropdown, the Markdown editor, the error card, the FilePicker and
 * the events explorer's toolbar. This holds what was fixed:
 *
 *   - a sample of every line's words is translated in every language, with
 *     the English's placeholders;
 *   - Dismiss reads each language's word for putting something away, never
 *     its Close;
 *   - Ceph's In cluster and Out of cluster are words of their own, never the
 *     network legend's In and Out;
 *   - the Products menu's titles are each language's own.
 *
 * The column descriptions a form draws are held by
 * FormColumnDescriptionsInLocales; Korean's whole words by
 * KoreanKeepsWordsWhole (Common) and ReadingDirection (E2E); Norwegian
 * Bokmål and Nynorsk by ReaderLanguage (Common).
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

function valueOf(code: string, key: string): string | undefined {
  const value: unknown = readLocale(code)[key];

  return typeof value === "string" ? value : undefined;
}

function navbarTitle(code: string, item: string): string | undefined {
  const navbar: unknown = readLocale(code)["navbar"];
  const items: unknown =
    navbar && typeof navbar === "object"
      ? (navbar as Record<string, unknown>)["items"]
      : undefined;
  const value: unknown =
    items && typeof items === "object"
      ? (items as Record<string, unknown>)[item]
      : undefined;

  return typeof value === "string" ? value : undefined;
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

// The {{names}} a text holds: one class that stops at a brace, linear in the text.
function placeholdersOf(text: string): Array<string> {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\{\{([^{}]+)\}\}/g)).map(
        (match: RegExpMatchArray): string => {
          return (match[1] as string).trim();
        },
      ),
    ),
  ).sort();
}

/*
 * A sample of each line's words, by the follow-up they come from, as the
 * pages draw them.
 */
const BACKLOG_WORDS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "Notification Settings (#5294)": [
    "Notify me about incidents on resources I own.",
    "Notify me about activity on alert episodes I own.",
    "Notify me about my on-call schedule and policy membership.",
    "Notify me about calls to incoming call policies I own.",
    "Incident reminder",
  ],
  "Still English (#5272, #5281)": [
    "Remove attribute filter {{number}}",
    "Disk {{path}}",
  ],
  "Ceph's placement (#5287)": ["In cluster", "Out of cluster", "In / Out"],
  "The named leftovers (#5287 and the orchestrator's notes)": [
    "Campaigns",
    "Device Type",
    "Edit Favicon",
    "Under Maintenance",
    "Degraded Performance",
    "Partial Outage",
    "Major Outage",
    "Reached via",
    "Direct",
    "Coverage",
    "On-call readiness",
    "Is Entry Span",
    "Show all spans",
    "Show {{value}}",
    "Traces over time",
    "Spans over time",
  ],
  "The AI card's conversation": [
    "Ask OneUptime AI",
    "Loading the conversation…",
    "Could not load the conversation: {{error}}",
    "Show {{count}} earlier messages",
    "Conversation with OneUptime AI",
    "OneUptime AI is working on your question…",
  ],
  "Services cards, Metrics Insights and the owners card": [
    "Producers",
    "Consumers",
    "Unknown Service",
    "Quiet services",
    "Metric categories",
    "Services reporting metrics",
    "People and teams responsible for this {{resourceName}}. They are notified about changes.",
    "Are you sure you want to remove {{name}} as an owner of this {{resourceName}}?",
  ],
  "EntityDropdown, the Markdown editor and the error card": [
    "Pick individually",
    "Loading labels...",
    "No labels match “{{search}}”.",
    "Formatting help",
    "Type your markdown here...",
    "Copy code",
    "Something went wrong",
    "Download support bundle",
  ],
  "The Campaigns page": [
    "Attackers",
    "Attack requests",
    "Got through",
    "View requests",
    "No attack campaigns in this window",
    "Showing the {{count}} most serious campaigns in this window.",
    "Every request was turned away",
    "Not followed: these requests carry no trace",
    "Reached App",
    "Reached Database",
  ],
  "The events explorer's toolbar and panel": [
    "{{count}}+ results",
    "Page {{current}} of {{total}}",
    "Page {{current}}",
    "Docs",
    "Open {{name}} view",
    "Press {{key}} to toggle this panel",
    "View trace {{id}}",
    "Filter by {{key}}: {{value}}",
    "Search logs... (e.g. {{example}})",
    "free text",
  ],
};

const ALL_WORDS: Array<string> = Array.from(
  new Set(Object.values(BACKLOG_WORDS).flat()),
);

describe("the backlog's words", () => {
  test("are every one a key the Dashboard's English has", () => {
    expect(
      ALL_WORDS.filter((key: string): boolean => {
        return valueOf("en", key) !== key;
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)("are all translated in %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);

    expect(
      ALL_WORDS.filter((key: string): boolean => {
        const value: string | undefined = valueOf(code, key);

        return value === undefined || (value === key && !same.includes(key));
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)("keep their placeholders in %s", (code: string) => {
    expect(
      ALL_WORDS.filter((key: string): boolean => {
        return (
          placeholdersOf(valueOf(code, key) || "").join() !==
          placeholdersOf(key).join()
        );
      }),
    ).toEqual([]);
  });
});

describe("Dismiss", () => {
  test.each(LANGUAGES)(
    "reads %s's word for putting something away, never its Close",
    (code: string) => {
      const dismiss: string | undefined = valueOf(code, "Dismiss");

      expect(dismiss).toBeDefined();
      expect(dismiss).not.toBe("Dismiss");
      expect(dismiss).not.toBe(valueOf(code, "Close"));
    },
  );

  test("reads Hide in the nine that said Close, and in Persian", () => {
    expect(
      ["it", "nl", "da", "no", "sv", "ko", "zh-CN", "zh-TW", "hi", "fa"].map(
        (code: string): string => {
          return `${code}: ${valueOf(code, "Dismiss")}`;
        },
      ),
    ).toEqual([
      "it: Nascondi",
      "nl: Verbergen",
      "da: Skjul",
      "no: Skjul",
      "sv: Dölj",
      "ko: 숨기기",
      "zh-CN: 隐藏",
      "zh-TW: 隱藏",
      "hi: छिपाएं",
      "fa: پنهان کردن",
    ]);
  });
});

describe("Ceph's OSD placement", () => {
  test.each(LANGUAGES)(
    "has words of its own in %s, never the network legend's In and Out",
    (code: string) => {
      expect(valueOf(code, "In cluster")).not.toBe(valueOf(code, "In"));
      expect(valueOf(code, "Out of cluster")).not.toBe(valueOf(code, "Out"));
    },
  );
});

describe("the Products menu's titles", () => {
  const TITLES: ReadonlyArray<string> = [
    "storageArraysTitle",
    "securityEventsTitle",
    "sentinelInsightsTitle",
    "llmObservabilityTitle",
    "networkTitle",
  ];

  // "AI / LLM" reads as written in most languages, recorded as such.
  test.each(LANGUAGES)("are words of %s", (code: string) => {
    const same: Array<string> = sameAsEnglishIn(code);

    expect(
      TITLES.filter((item: string): boolean => {
        const value: string | undefined = navbarTitle(code, item);
        const english: string | undefined = navbarTitle("en", item);

        return (
          !value || (value === english && !same.includes(english as string))
        );
      }),
    ).toEqual([]);
  });

  test("Storage Arrays reads as the product's own pages call it", () => {
    for (const code of LANGUAGES) {
      expect({
        code,
        menu: navbarTitle(code, "storageArraysTitle"),
      }).toEqual({ code, menu: valueOf(code, "Storage Arrays") });
    }
  });

  /*
   * The menu's AI section and its AI / LLM product say AI the same way: the
   * section read "AI" in German, French, Italian, Portuguese and Russian
   * over a product named KI / IA / ИИ (UI review of #5512).
   */
  test.each(LANGUAGES)(
    "the AI section says AI as the AI / LLM product beside it does in %s",
    (code: string) => {
      const navbar: Record<string, Record<string, string>> = readLocale(code)[
        "navbar"
      ] as Record<string, Record<string, string>>;
      const product: string = navbar["items"]!["llmObservabilityTitle"]!;

      expect(navbar["categories"]!["ai"]).toBe(product.split(" / ")[0]);
    },
  );
});

// A translator that reads one language's locale file, as the Dashboard does.
function translatorFor(code: string): Translator {
  const locale: Locale = readLocale(code);

  return createTranslator((key: string): string | undefined => {
    const value: unknown = locale[key];

    return typeof value === "string" ? value : undefined;
  }, code);
}

/*
 * The Campaigns page's count lines - "412 requests", "32 requests got
 * through", "14 different requests" - stayed English in every language:
 * their templates were marked as keys, so the extractor gave them no "_one"
 * sentence, and a translated "other" sentence alone would read "1 Anfragen".
 * The extractor reads marked templates now (I18nExtractStrings), and each
 * "one" form carries the count, since Russian reads 21 with it and French 0.
 */
describe("the Campaigns page's counts", () => {
  const TEMPLATES: ReadonlyArray<PluralTemplate> = [
    { one: "{{count}} request", other: "{{count}} requests" },
    {
      one: "{{count}} different request",
      other: "{{count}} different requests",
    },
    {
      one: "{{count}} request got through",
      other: "{{count}} requests got through",
    },
  ];

  test("each has a one form of its own in English, written with the count", () => {
    for (const template of TEMPLATES) {
      expect(valueOf("en", template.other)).toBe(template.other);
      expect(valueOf("en", `${template.other}_one`)).toBe(template.one);
    }
  });

  test.each(LANGUAGES)(
    "are words of %s in both forms, each keeping the count",
    (code: string) => {
      for (const template of TEMPLATES) {
        for (const key of [template.other, `${template.other}_one`]) {
          const value: string = valueOf(code, key) || "";

          expect({ key, translated: value !== "" && value !== key }).toEqual({
            key,
            translated: true,
          });
          expect({ key, count: value.includes("{{count}}") }).toEqual({
            key,
            count: true,
          });
        }
      }
    },
  );

  test("read each language's own form for the count", () => {
    const [requests, , gotThrough] = TEMPLATES as Array<PluralTemplate>;

    expect(translatorFor("de").translatePlural(requests!, 1)).toBe("1 Anfrage");
    expect(translatorFor("de").translatePlural(requests!, 412)).toBe(
      "412 Anfragen",
    );
    expect(translatorFor("ru").translatePlural(gotThrough!, 21)).toBe(
      "21 запрос прошёл",
    );
    expect(translatorFor("ru").translatePlural(gotThrough!, 32)).toBe(
      "Прошло запросов: 32",
    );
    // French counts 0 as one.
    expect(translatorFor("fr").translatePlural(requests!, 0)).toBe("0 requête");
    expect(translatorFor("ja").translatePlural(requests!, 1)).toBe(
      "1 件のリクエスト",
    );
    // English, as the page drew it.
    expect(translatorFor("en").translatePlural(gotThrough!, 1)).toBe(
      "1 request got through",
    );
  });

  // DataTypes' "Found 1 value." had the same gap: it read "1 Werte gefunden."
  test.each(LANGUAGES)(
    "a count of one found reads its own sentence in %s",
    (code: string) => {
      expect(valueOf(code, "Found {{count}} values._one")).toBe(
        valueOf(code, "Found {{count}} value."),
      );
    },
  );
});

/*
 * An OSD's page explains In and Out - in the list's and the OSD page's
 * Placement tooltips - in the words its badge draws. The cells said "Dans le
 * cluster" while the list's description explained "In" (French, Spanish,
 * Japanese), and the tooltips were English in fifteen languages. The list's
 * description now says what the list shows by the cluster's rules, and the
 * Placement tooltips are where In and Out are explained.
 */
describe("Ceph's OSD placement, explained", () => {
  const TOOLTIPS: ReadonlyArray<string> = [
    "In means Ceph places data on this OSD. Out means it was taken out of data placement, by an admin or automatically after being down for a while, and its data lives on other OSDs.",
    "In means Ceph is placing data on this OSD. Out means it has been removed from data placement, by an admin or automatically after being down, and its data is served from other OSDs.",
  ];

  test.each(LANGUAGES)(
    "names the cells' In and Out words in %s",
    (code: string) => {
      const inCluster: string = valueOf(code, "In cluster") || "";
      const outOfCluster: string = valueOf(code, "Out of cluster") || "";

      for (const tooltip of TOOLTIPS) {
        const value: string = valueOf(code, tooltip) || "";

        expect(value).not.toBe(tooltip);
        expect(value).toContain(inCluster);
        expect(value).toContain(outOfCluster);
      }
    },
  );
});

describe("German's own voice and articles", () => {
  // Every Notification Settings card speaks as the reader, the same way.
  test("each Notify me card description reads Benachrichtige mich", () => {
    const german: Locale = readLocale("de");
    const cards: Array<string> = Object.keys(readLocale("en")).filter(
      (key: string): boolean => {
        return (
          (key.startsWith("Notify me about ") ||
            key.startsWith("Notify me when ")) &&
          key.endsWith(".")
        );
      },
    );

    expect(cards.length).toBeGreaterThan(10);
    expect(
      cards.filter((key: string): boolean => {
        return !String(german[key]).startsWith("Benachrichtige mich");
      }),
    ).toEqual([]);
  });

  /*
   * "this {{resourceName}}" as German writes it everywhere else: a noun
   * with no article ("für Vorfall") read wrong, so the owners card says
   * diesen Eintrag (Vorfall), as "Möchten Sie diesen Eintrag ({{itemName}})
   * wirklich löschen?" does.
   */
  test("the owners card names its record as diesen Eintrag ({{resourceName}})", () => {
    for (const key of [
      "People and teams responsible for this {{resourceName}}. They are notified about changes.",
      "Add a teammate or a team so they get notified about changes to this {{resourceName}}.",
      "Are you sure you want to remove {{name}} as an owner of this {{resourceName}}?",
      "Are you sure you want to remove {{name}} (Team) as an owner of this {{resourceName}}?",
    ]) {
      expect(valueOf("de", key)).toMatch(
        /(diese[ns]|diesem) Eintrag[s]? \(\{\{resourceName\}\}\)/,
      );
    }
  });
});
