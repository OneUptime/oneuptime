import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  GROUPING_RULE_TEMPLATES,
  GroupingRuleKind,
  getGroupingRuleUiStrings,
} from "../../FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";

/*
 * The Incident and Alert Grouping Rules pages render every word of their new
 * copy - the card text, the templates, the Group-by cards, the minutes
 * settings, the list's Grouping column and the validation message - through
 * the Dashboard's locale files, keyed by the English text. A string with no
 * entry silently stays English, so this pins:
 *
 *   - en.json maps each string to itself;
 *   - all sixteen other locales carry a real translation of each new string
 *     (different from the English) that keeps its {{placeholders}};
 *   - the pages and components draw the copy from the shared constants and
 *     put it through translation, so rewording one cannot leave a page
 *     showing an untranslated copy.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

/*
 * Strings these pages share with the rest of the Dashboard. They were in
 * every locale already, and some are rightly the same word in a few
 * languages ("Monitor" in Spanish, Italian, Dutch and Portuguese).
 */
const SHARED_STRINGS: Array<string> = [
  "Create from Template",
  "Add Rule",
  "Monitor",
  "Severity",
  "Title",
  "Custom",
  "Incident Labels",
  "Alert Labels",
  "Monitor Labels",
  "1 minute",
  "{{count}} minutes",
  "1 hour",
  "{{count}} hours",
  "1 day",
  "{{count}} days",
];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const STRINGS: Array<string> = getGroupingRuleUiStrings();

const NEW_STRINGS: Array<string> = STRINGS.filter((text: string) => {
  return !SHARED_STRINGS.includes(text);
});

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the grouping rule pages' strings", () => {
  test("there are strings to check, and every shared one really is in use", () => {
    expect(NEW_STRINGS.length).toBeGreaterThan(70);

    for (const text of SHARED_STRINGS) {
      expect(STRINGS).toContain(text);
    }
  });

  const en: Record<string, unknown> = readLocale("en");

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(en[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("has %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));
    });

    test("translates every new string rather than repeating the English", () => {
      const untranslated: Array<string> = NEW_STRINGS.filter(
        (text: string): boolean => {
          return translations[text] === text;
        },
      );

      expect(untranslated).toEqual([]);
    });

    test("gives incidents and alerts their own sentences", () => {
      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(translations[template.name[GroupingRuleKind.Incident]]).not.toBe(
          translations[template.name[GroupingRuleKind.Alert]],
        );
      }
    });
  });
});

describe("the grouping rule pages draw their copy from the shared constants", () => {
  test.each([
    ["Incidents", "IncidentGroupingRules.tsx", "GroupingRuleKind.Incident"],
    ["Alerts", "AlertGroupingRules.tsx", "GroupingRuleKind.Alert"],
  ])("%s/Settings/%s", (folder: string, file: string, kind: string) => {
    const source: string = readSource("Pages", folder, "Settings", file);

    expect(source).toContain(`const KIND: GroupingRuleKind = ${kind};`);
    expect(source).toContain(
      "description: GROUPING_RULE_COPY.cardDescription[KIND],",
    );
    expect(source).toContain("title: GROUPING_RULE_COPY.groupingStepTitle,");
    expect(source).toContain("title: GROUPING_RULE_COPY.whichStepTitle[KIND],");
    expect(source).toContain("title: GROUPING_RULE_COPY.summaryColumnTitle,");
    expect(source).toContain(
      "placeholder: GROUPING_RULE_TEMPLATES[0]!.name[KIND],",
    );
  });

  test("the Group-by cards are translated before CardSelect draws them", () => {
    const source: string = readSource(
      "Components",
      "GroupingRule",
      "GroupingModeField.tsx",
    );

    expect(source).toContain("title: translate(option.title),");
    expect(source).toContain(
      "description: translate(option.description[props.kind]),",
    );
  });

  test("the templates translate their names, descriptions and intro", () => {
    const source: string = readSource(
      "Components",
      "GroupingRule",
      "GroupingRuleTemplates.tsx",
    );

    expect(source).toContain(
      "const name: string = translate(template.name[props.kind]);",
    );
    expect(source).toContain("translate(template.description[props.kind])");
    expect(source).toContain("translate(GROUPING_RULE_COPY.emptyStateTitle)");
    expect(source).toContain(
      "translate(GROUPING_RULE_COPY.emptyStateExample[props.kind])",
    );
  });

  test("a minutes setting translates its sentence whole, around the number box", () => {
    const source: string = readSource(
      "Components",
      "GroupingRule",
      "MinutesSettingField.tsx",
    );

    expect(source).toContain(
      'translateTemplateAround( props.sentence, "minutes", )',
    );
    expect(source).toContain("title={translate(props.title)}");
    expect(source).toContain("description={translate(props.description)}");
    expect(source).toContain("ariaLabel={translate(props.minutesLabel)}");
  });

  test("the list's summary is built with the reader's language", () => {
    const source: string = readSource(
      "Components",
      "GroupingRule",
      "GroupingRuleSummary.tsx",
    );

    expect(source).toContain(
      "const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();",
    );
    expect(source).toContain("getGroupingRuleSummary({");
  });
});

/*
 * The tables' own chrome - the card title, the create button, the create and
 * edit dialog titles - is built from the model's names. Those titles had
 * been translated word by word ("Vorfall Grouping Regeln"), and the create
 * and edit phrases had no entry, so the button read "Erstellen Vorfall
 * Grouping Regel". Each is now a whole phrase in every language.
 */
describe("the grouping rule tables' titles and create and edit phrases", () => {
  const PHRASES: Array<string> = [
    "Incident Grouping Rules",
    "Incident Grouping Rule",
    "Create Incident Grouping Rule",
    "Create New Incident Grouping Rule",
    "Edit Incident Grouping Rule",
    "Alert Grouping Rules",
    "Alert Grouping Rule",
    "Create Alert Grouping Rule",
    "Create New Alert Grouping Rule",
    "Edit Alert Grouping Rule",
  ];

  const en: Record<string, unknown> = readLocale("en");

  test.each(PHRASES)("en.json maps %j to itself", (text: string) => {
    expect(en[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(PHRASES)("translates %j whole", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect(value).not.toBe(text);
      // No English word left behind in the middle of the phrase.
      expect(value as string).not.toMatch(/Grouping|Rule/);
    });
  });
});
