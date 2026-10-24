import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_OFF_ASK_AI,
  AI_OFF_LINK_TEXTS,
  AI_OFF_NOTES,
  AI_OFF_REASONS,
  AI_OFF_STEP_TEXTS,
  AI_OFF_TITLES,
  AI_OFF_WHAT_YOU_CAN_DO,
  AI_OFF_WHO_CAN_CHANGE,
  AiOffSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiOffSummaryData";
import {
  AI_LANE_SWITCHES,
  AiLane,
  EnableAiCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";

/*
 * EVERY WORD OF THE AI CARD'S ONE LINE IS EVERY LANGUAGE'S OWN.
 *
 * The line ("AI investigation is off", and why), what opens under it (what
 * to turn on, where, who can, and that it does not reach back), read from
 * the Dashboard's locale files themselves: a key that lost its translation,
 * kept the English or lost a placeholder is caught - and so is a menu path
 * that names the menu other than the menu itself does.
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

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

const SUBJECT_TYPES: Array<AiOffSubjectType> = ["incident", "alert"];

// Every sentence the line adds, by the key the code looks it up with.
const SENTENCES: Array<string> = Array.from(
  new Set<string>([
    AI_OFF_TITLES.investigationOff,
    AI_OFF_TITLES.projectAiOff,
    ...SUBJECT_TYPES.flatMap((subjectType: AiOffSubjectType): Array<string> => {
      return [
        ...Object.values(AI_OFF_REASONS[subjectType]),
        AI_OFF_STEP_TEXTS.rulesMatch[subjectType],
        AI_OFF_STEP_TEXTS.rulesFix[subjectType],
        AI_OFF_WHO_CAN_CHANGE.settings[subjectType],
        AI_OFF_WHO_CAN_CHANGE.rules[subjectType],
        AI_OFF_NOTES[subjectType].askAi,
        AI_OFF_NOTES[subjectType].aiOff,
      ];
    }),
    AI_OFF_STEP_TEXTS.turnOnSwitch,
    AI_OFF_STEP_TEXTS.switchIsOnNow,
    AI_OFF_STEP_TEXTS.ruleFixNamed,
    AI_OFF_STEP_TEXTS.minimumSeverity,
  ]),
);

/*
 * What the line borrows from the rest of the Dashboard, every one already
 * a key: the links' texts and who can turn AI on are the AI card's and the
 * AI settings pages' own, the chevron's name the full card's heading, and
 * the switches' names what their settings page calls them.
 */
const BORROWED: Array<string> = [
  AI_OFF_LINK_TEXTS.settings.incident,
  AI_OFF_LINK_TEXTS.settings.alert,
  AI_OFF_LINK_TEXTS.rules.incident,
  AI_OFF_LINK_TEXTS.rules.alert,
  AI_OFF_WHO_CAN_CHANGE.aiSwitch,
  AI_OFF_WHAT_YOU_CAN_DO,
  EnableAiCopy.switchTitle,
  ...AI_LANE_SWITCHES[AiLane.Incident]
    .slice(0, 2)
    .map((definition: { title: string }): string => {
      return definition.title;
    }),
  ...AI_LANE_SWITCHES[AiLane.Alert]
    .slice(0, 2)
    .map((definition: { title: string }): string => {
      return definition.title;
    }),
];

/*
 * Two borrowed names most languages keep as written, and the docs quote
 * them as the Dashboard draws them: the conversation's title, "Ask
 * OneUptime AI" - the product's name in it - and the AI Features page's
 * name. They stay whatever the locale already says.
 */
const KEPT_AS_THE_LOCALE_HAS_THEM: Array<string> = [
  AI_OFF_ASK_AI,
  AI_OFF_LINK_TEXTS.aiFeatures,
];

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("English holds every sentence under its own words", () => {
  test("there is something to check: the 33 keys the line added", () => {
    expect(SENTENCES.length).toBe(33);
  });

  test.each([...SENTENCES, ...BORROWED, ...KEPT_AS_THE_LOCALE_HAS_THEM])(
    "%s",
    (sentence: string) => {
      expect(ENGLISH[sentence]).toBe(sentence);
    },
  );
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  test.each([...SENTENCES, ...BORROWED])(
    "words %s its own way, with the same placeholders",
    (sentence: string) => {
      const translated: string | undefined = words[sentence];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({ sentence, translated: translated !== sentence }).toEqual({
        sentence,
        translated: true,
      });
      expect(placeholders(translated!)).toEqual(placeholders(sentence));
    },
  );

  test.each(KEPT_AS_THE_LOCALE_HAS_THEM)(
    "has %s, as it already did",
    (sentence: string) => {
      expect(words[sentence]).toBeDefined();
      expect(words[sentence]!.trim().length).toBeGreaterThan(0);
    },
  );

  test("names the settings menu the way the menu itself does", () => {
    const incidents: string = words["Incidents"]!;
    const alerts: string = words["Alerts"]!;
    const settings: string = words["Settings"]!;

    for (const sentence of [
      AI_OFF_WHO_CAN_CHANGE.settings.incident,
      AI_OFF_WHO_CAN_CHANGE.rules.incident,
    ]) {
      expect({ sentence, text: words[sentence] }).toEqual({
        sentence,
        text: expect.stringContaining(incidents),
      });
      expect(words[sentence]).toContain(settings);
    }

    for (const sentence of [
      AI_OFF_WHO_CAN_CHANGE.settings.alert,
      AI_OFF_WHO_CAN_CHANGE.rules.alert,
    ]) {
      expect({ sentence, text: words[sentence] }).toEqual({
        sentence,
        text: expect.stringContaining(alerts),
      });
      expect(words[sentence]).toContain(settings);
    }
  });

  test("the note that keeps Ask OneUptime AI says so, and the one without it does not", () => {
    for (const subjectType of SUBJECT_TYPES) {
      expect(words[AI_OFF_NOTES[subjectType].askAi]).toContain("OneUptime AI");
      expect(words[AI_OFF_NOTES[subjectType].aiOff]).not.toContain(
        "OneUptime AI",
      );
    }
  });
});
