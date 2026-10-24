import { beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import fs from "fs";
import path from "path";
import {
  INVESTIGATION_RULE_RIGHT_AWAY,
  INVESTIGATION_RULE_TIMING_COPY,
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_TIMINGS,
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  INVESTIGATION_RULE_WAIT_NOT_WHOLE,
  InvestigationRuleTiming,
  describeInvestigationRuleTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import { AI_RULE_COLUMN_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import {
  INVESTIGATE_NOW,
  INVESTIGATE_NOW_FAILED,
  INVESTIGATION_WAITING_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import {
  AI_LANE_RULES_COPY,
  AiLane,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { NOT_INVESTIGATED_REASONS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";

/*
 * EVERY WORD THE INVESTIGATION RULE'S WAIT ADDS IS EVERY LANGUAGE'S OWN
 * (issue #5074): the rule form's choice and minutes, the rules table's
 * column, the AI card while it waits, Investigate now, the source line of a
 * decision taken when a wait ended, the AI Insights page's reason - read from
 * the Dashboard's locale files themselves, so a key that lost its
 * translation, or kept the English, is caught.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

// Japanese, Korean and Chinese read no "one" form: theirs may stay as is.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

// Every sentence this change adds, by the key the code looks it up with.
const SENTENCES: Array<string> = [
  // The rule form's second step, after Match.
  "Investigate",
  INVESTIGATION_RULE_TIMING_FIELD_TITLE,
  INVESTIGATION_RULE_WAIT_FIELD_TITLE,
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[AiLane.Incident],
  INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION[AiLane.Alert],
  INVESTIGATION_RULE_WAIT_NOT_WHOLE,
  // The rules table's column, which says the wait (AiRulesTable).
  AI_RULE_COLUMN_TITLE,
  INVESTIGATION_RULE_RIGHT_AWAY,
  ...[AiLane.Incident, AiLane.Alert].flatMap((lane: AiLane) => {
    return INVESTIGATION_RULE_TIMINGS.flatMap(
      (timing: InvestigationRuleTiming) => {
        return [
          INVESTIGATION_RULE_TIMING_COPY[lane][timing].title,
          INVESTIGATION_RULE_TIMING_COPY[lane][timing].description,
        ];
      },
    );
  }),
  INVESTIGATION_WAITING_COPY.incident.title,
  INVESTIGATION_WAITING_COPY.incident.titleTomorrow,
  INVESTIGATION_WAITING_COPY.incident.titleSoon,
  INVESTIGATION_WAITING_COPY.incident.whoCanStart,
  INVESTIGATION_WAITING_COPY.alert.title,
  INVESTIGATION_WAITING_COPY.alert.titleTomorrow,
  INVESTIGATION_WAITING_COPY.alert.titleSoon,
  INVESTIGATION_WAITING_COPY.alert.whoCanStart,
  INVESTIGATE_NOW,
  INVESTIGATE_NOW_FAILED,
  AI_LANE_RULES_COPY[AiLane.Incident].aiRulesDescription,
  AI_LANE_RULES_COPY[AiLane.Alert].aiRulesDescription,
  NOT_INVESTIGATED_REASONS.incident.resolved_before_investigation,
  "Decision recorded when the wait ended",
  // The model columns the API docs and the Dashboard name.
  "Only If Open After (Minutes)",
  "Rule Wait (Minutes)",
  "AI Investigation Waits Until",
];

// The plural sentences: their "other" key, and the "one" form under _one.
const PLURALS: Array<{ one: string; other: string }> = [
  INVESTIGATION_WAITING_COPY.incident.description,
  INVESTIGATION_WAITING_COPY.alert.description,
  {
    one: "If still open after {{count}} minute",
    other: "If still open after {{count}} minutes",
  },
];

function placeholders(text: string): Array<string> {
  return (text.match(/\{\{[a-zA-Z]+\}\}/g) || []).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.init({
    lng: "de",
    fallbackLng: false,
    resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

describe("English holds every sentence under its own words", () => {
  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)(
    "the plural %j",
    (plural: { one: string; other: string }) => {
      expect(ENGLISH[plural.other]).toBe(plural.other);
      expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
    },
  );

  test("the card descriptions this change rewrote left no old sentence behind", () => {
    expect(
      ENGLISH[
        "With no rule, OneUptime AI investigates every new incident. Add rules to investigate only the incidents that match one of them."
      ],
    ).toBeUndefined();
    expect(
      ENGLISH[
        "With no rule, OneUptime AI investigates every new alert. Add rules to investigate only the alerts that match one of them."
      ],
    ).toBeUndefined();
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  test("every sentence is the language's own, with the English placeholders", () => {
    for (const sentence of SENTENCES) {
      const translated: string | undefined = words[sentence];

      expect({
        sentence,
        isTranslated: Boolean(translated) && translated !== sentence,
      }).toEqual({
        sentence,
        isTranslated: true,
      });
      expect(placeholders(translated!)).toEqual(placeholders(sentence));
    }
  });

  test("every plural is the language's own, with its count", () => {
    for (const plural of PLURALS) {
      expect(words[plural.other]).toBeDefined();
      expect(words[plural.other]).not.toBe(plural.other);
      expect(words[plural.other]).toContain("{{count}}");

      if (!WITHOUT_ONE_FORM.includes(language)) {
        expect(words[`${plural.other}_one`]).toBeDefined();
        expect(words[`${plural.other}_one`]).not.toBe(plural.one);
        expect(words[`${plural.other}_one`]).toContain("{{count}}");
      }
    }
  });

  test("the rules table says when a rule investigates in the language", async () => {
    await i18next.changeLanguage(language);

    expect(describeInvestigationRuleTiming(0)).toBe(
      words[INVESTIGATION_RULE_RIGHT_AWAY],
    );
    expect(describeInvestigationRuleTiming(30)).not.toContain("If still open");
    // The count in the language's own digits (Persian writes ۳۰).
    expect(describeInvestigationRuleTiming(30)).toContain(
      new Intl.NumberFormat(language).format(30),
    );
  });
});
