import { describe, expect, test } from "@jest/globals";
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

function placeholdersOf(text: string): Array<string> {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
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
});
