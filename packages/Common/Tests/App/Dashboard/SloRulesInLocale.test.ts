import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  APPLIES_TO_ALL_ANSWERS,
  APPLIES_TO_MATCHING_ANSWERS,
  CONDITION_FIELD_WORDS,
  ERROR_BUDGET_POLICY_CHANGE_WORDS,
  NOTIFICATION_RULES_CARD_DESCRIPTIONS,
  NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
  NO_CONDITIONS_SENTENCES,
  RULE_PLURAL_NAMES,
  RULE_SINGULAR_NAMES,
  getNotificationRulesCardTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import { SLO_ERROR_BUDGET_POLICY_CHANGES } from "../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";

/*
 * EVERY WORD OF AN SLO RULE IS EVERY LANGUAGE'S OWN: the rule's name on
 * the SLOs' Slack, Microsoft Teams and Mattermost pages, its Conditions
 * step and the card that says what it is for, the conditions it offers and
 * the changes of an error budget policy it can pick - read from the
 * Dashboard's locale files themselves, so a key that lost its translation,
 * kept the English or dropped a placeholder is caught. A word a language
 * keeps as written ("SLOs") is one its progress file records so.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
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
  // Arabic, whose locale is still being filled: an SLO rule's words are in it.
  "ar",
];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(DASHBOARD, file), "utf8"));
}

function readLocale(language: string): Record<string, string> {
  return readJson(`src/Locales/${language}.json`) as Record<string, string>;
}

// What reads the same as English in every language, and in this one.
function keptAsWritten(language: string): Set<string> {
  const global: Array<string> = readJson(
    "i18n/SameAsEnglish.json",
  ) as Array<string>;
  const own: Array<string> =
    ((readJson(`i18n/Progress/${language}.json`) as Record<string, unknown>)[
      "sameAsEnglish"
    ] as Array<string> | undefined) || [];

  return new Set([...global, ...own]);
}

const SLO: NotificationRuleEventType =
  NotificationRuleEventType.ServiceLevelObjective;

const SLO_RULE_WORDS: Array<string> = Array.from(
  new Set(
    [
      NOTIFICATION_RULE_CONDITIONS_TITLES[SLO],
      NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS[SLO],
      APPLIES_TO_ALL_ANSWERS[SLO],
      APPLIES_TO_MATCHING_ANSWERS[SLO],
      RULE_SINGULAR_NAMES[SLO],
      RULE_PLURAL_NAMES[SLO],
      getNotificationRulesCardTitle(SLO),
      NOTIFICATION_RULES_CARD_DESCRIPTIONS[SLO],
      NO_CONDITIONS_SENTENCES[SLO],
      ...NotificationRuleConditionUtil.getCheckOnByEventType(SLO),
      ...ERROR_BUDGET_POLICY_CHANGE_WORDS,
    ].filter((text: string | undefined): text is string => {
      return Boolean(text);
    }),
  ),
);

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

describe("an SLO rule's words, in every language", () => {
  test("are listed, as the rule form, its card and its conditions draw them", () => {
    expect(SLO_RULE_WORDS).toEqual([
      "Which SLOs",
      "Conditions are checked each time an SLO's error budget policy changes: when the SLO enters a tier, recovers to a less severe one or leaves every tier, and when its deployments are frozen or allowed again.",
      "All SLOs",
      "Only SLOs that match conditions",
      "SLO Notification Rule",
      "SLO Notification Rules",
      "Notification Rules",
      "Each rule picks the SLOs it is for, then posts to channels you have when an SLO enters a tier of its error budget policy, recovers or leaves every tier, and when its deployments are frozen or allowed again.",
      "Every SLO.",
      "SLOs",
      "SLO Labels",
      "SLO Name",
      "Error Budget Policy Change",
      // Who owns the SLO (#7583): the people and teams on its list of owners.
      "SLO Owner",
      "Entered a more severe tier",
      "Recovered to a less severe tier",
      "Left every tier",
      "Deployments frozen",
      "Deployments allowed again",
    ]);
  });

  test("the changes a rule can pick are the words listed to translate, and the conditions are among the condition words", () => {
    expect([...ERROR_BUDGET_POLICY_CHANGE_WORDS]).toEqual([
      ...SLO_ERROR_BUDGET_POLICY_CHANGES,
    ]);

    for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
      SLO,
    )) {
      expect(CONDITION_FIELD_WORDS).toContain(checkOn);
    }
  });

  test("each is a key of the English locale, mapped to itself", () => {
    const english: Record<string, string> = readLocale("en");

    for (const text of SLO_RULE_WORDS) {
      expect({ text, english: english[text] }).toEqual({
        text,
        english: text,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s words each in its own language, with the English placeholders",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const kept: Set<string> = keptAsWritten(language);

      const problems: Array<string> = SLO_RULE_WORDS.filter(
        (text: string): boolean => {
          const value: string | undefined = locale[text];

          if (!value || !value.trim()) {
            return true;
          }

          if (
            JSON.stringify(placeholders(value)) !==
            JSON.stringify(placeholders(text))
          ) {
            return true;
          }

          return value === text && !kept.has(text);
        },
      );

      expect(problems).toEqual([]);
    },
  );

  test("as a German reader reads the condition and the changes", () => {
    const german: Record<string, string> = readLocale("de");

    expect(
      german[NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange],
    ).toBe("Änderung der Fehlerbudget-Richtlinie");
    expect(german["Entered a more severe tier"]).toBe(
      "In eine strengere Stufe eingetreten",
    );
    expect(german["Deployments allowed again"]).toBe(
      "Deployments wieder erlaubt",
    );
    expect(german["SLO Notification Rule"]).toBe(
      "Benachrichtigungsregel für SLOs",
    );
  });

  test("as an Arabic reader reads the rule, the condition and the changes", () => {
    const arabic: Record<string, string> = readLocale("ar");

    expect(arabic["SLO Notification Rule"]).toBe("قاعدة إشعارات SLO");
    expect(
      arabic[NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange],
    ).toBe("تغيير سياسة ميزانية الأخطاء");
    expect(arabic["Entered a more severe tier"]).toBe("دخل مستوى أشد");
    expect(arabic["Deployments allowed again"]).toBe(
      "سُمح بعمليات النشر مجددًا",
    );
    // The SLOs menu's own word, which the rule's words build on.
    expect(arabic["Which SLOs"]).toContain(arabic["SLOs"] as string);
  });
});
