import { describe, expect, test } from "@jest/globals";
import {
  getAllNotStartedSentences,
  NotStartedSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStartedWords";
import { PluralTemplate } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHY OneUptime AI DID NOT INVESTIGATE READS IN EVERY DASHBOARD LANGUAGE
 * (#6656): every sentence the AI card may draw for a reason - its title,
 * why, what to do, the names of the settings it quotes - and the card's own
 * lines around it, read from the locale files themselves, so a key that
 * lost its translation or kept the English is caught.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const SENTENCES: Array<NotStartedSentence> = getAllNotStartedSentences();

const PLAIN: Array<string> = SENTENCES.filter(
  (sentence: NotStartedSentence): sentence is string => {
    return typeof sentence === "string";
  },
);

const PLURALS: Array<PluralTemplate> = SENTENCES.filter(
  (sentence: NotStartedSentence): sentence is PluralTemplate => {
    return typeof sentence !== "string";
  },
);

// The card's own lines around a reason (InvestigationNotStarted).
const CARD_LINES: Array<string> = [
  "A project administrator can review these settings.",
  "Based on current settings",
  "Checking investigation status…",
  "Checking whether OneUptime AI has investigated this alert.",
  "Checking whether OneUptime AI has investigated this incident.",
  "Could not refresh this status. Showing the last successful check.",
  "Decision recorded at creation",
  "Investigation status is unavailable",
  "No investigation has been recorded",
  "No recorded decision",
  "Not investigated",
  "Retry investigation status",
  "Review alert AI settings",
  "Review incident AI settings",
  "Review the investigation settings and AI logs. Enabling automatic investigation applies to new events; it does not automatically investigate older ones.",
  "Settings may have changed since this alert was created; this is not a recorded decision from that time.",
  "Settings may have changed since this incident was created; this is not a recorded decision from that time.",
  "There is no AI investigation linked to this alert, and no recorded explanation is available. It may have been created before automatic investigation was enabled, or before reasons were recorded.",
  "There is no AI investigation linked to this incident, and no recorded explanation is available. It may have been created before automatic investigation was enabled, or before reasons were recorded.",
  "Try again to check this investigation.",
  "Unable to check",
  "We could not load the investigation status. This does not mean AI is disabled or that the investigation was skipped.",
  // The provider link, the same a security case's AI triage offers.
  "Set up an LLM provider",
];

describe("English holds every sentence under its own words", () => {
  test("there are sentences to check", () => {
    expect(PLAIN.length).toBeGreaterThan(60);
    expect(PLURALS.length).toBe(6);
  });

  test.each([...PLAIN, ...CARD_LINES])("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    expect(ENGLISH[plural.other]).toBe(plural.other);
    expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    expect(plural.one).toContain("{{count}}");
    expect(plural.other).toContain("{{count}}");
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  test("every sentence is the language's own, with the English placeholders", () => {
    for (const sentence of [...PLAIN, ...CARD_LINES]) {
      expect({
        sentence,
        worded: isWordedInDashboardLocale(sentence, language),
      }).toEqual({ sentence, worded: true });
      expect(placeholdersOf(words[sentence]!)).toEqual(
        placeholdersOf(sentence),
      );
    }
  });

  test("every plural is the language's own in each form, with its count", () => {
    for (const plural of PLURALS) {
      for (const key of [plural.other, `${plural.other}_one`]) {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(words[key]).toContain("{{count}}");
      }
    }
  });
});

/*
 * Arabic reads a plural's general form for 0, 2, 3-10, 11-99 and 100 and
 * up (ARABIC.md): a minute count is the short unit, the same for each.
 */
describe("Arabic's plurals read right for every count", () => {
  const ARABIC: Record<string, string> = readDashboardLocale("ar");

  test.each(PLURALS)("%j", (plural: PluralTemplate) => {
    expect(ARABIC[plural.other]).toContain("{{count}} د");
    expect(ARABIC[plural.other]).not.toMatch(/\{\{count\}\} (دقيقة|دقائق)/);
    expect(ARABIC[`${plural.other}_one`]).toContain("{{count}} دقيقة");
  });
});

// A sentence that states the number 0.
const ZERO: RegExp = /\b0\b/;

describe("each language's own conventions", () => {
  const OWN: Array<string> = [
    ...PLAIN,
    ...PLURALS.flatMap((plural: PluralTemplate) => {
      return [plural.other, `${plural.other}_one`];
    }),
  ];

  // The Dashboard's Spanish speaks to the reader as tú.
  test("Spanish never says usted", () => {
    const SPANISH: Record<string, string> = readDashboardLocale("es");

    for (const key of OWN) {
      expect(SPANISH[key]).not.toMatch(/\busted\b/i);
    }
  });

  test("Persian writes 0 in its own digits", () => {
    const PERSIAN: Record<string, string> = readDashboardLocale("fa");

    for (const key of OWN) {
      if (ZERO.test(key)) {
        expect(PERSIAN[key]).toContain("۰");
        expect(PERSIAN[key]).not.toMatch(/(^|[^{])0/);
      }
    }
  });

  test("Arabic writes 0 in Latin digits and quotes a label in «»", () => {
    const ARABIC: Record<string, string> = readDashboardLocale("ar");

    for (const key of OWN) {
      if (ZERO.test(key)) {
        expect(ARABIC[key]).toMatch(/\b0\b/);
      }

      if (key.includes("“{{settingName}}”")) {
        expect(ARABIC[key]).toContain("«{{settingName}}»");
      }
    }
  });
});
