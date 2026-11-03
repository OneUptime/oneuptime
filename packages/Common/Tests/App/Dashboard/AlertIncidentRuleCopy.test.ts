import { describe, expect, test } from "@jest/globals";
import { Translator, createTranslator } from "../../../Types/Translator";
import {
  ALERT_INCIDENT_RULE_DEFAULT_NAME,
  ALERT_INCIDENT_RULE_IF_STILL_UNRESOLVED,
  ALERT_INCIDENT_RULE_NAME_WITH_SEVERITY,
  ALERT_INCIDENT_RULE_RIGHT_AWAY,
  describeAlertIncidentRuleWhen,
  getAlertIncidentRuleName,
  getNewAlertIncidentRuleValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AlertIncidentRule/AlertIncidentRuleCopy";
import { RULE_NAME_MAX_LENGTH } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ResourceRuleForm";

/*
 * ALERTS → RULES → INCIDENT RULES IN THE READER'S WORDS.
 *
 * A new rule is named for what it declares - "Declare SEV1 incidents", or
 * "Declare incidents" while it declares at the alert's own severity - and
 * the rules table says when each one declares: "Right away", or "If still
 * unresolved after 15 minutes". Each is one sentence, looked up whole, so a
 * language that has worded it reads it in its own words - the wait too -
 * and one that has not reads it wholly in English.
 */

// A translator with the wordings given, in a language: a stand-in locale.
function translatorWith(
  language: string,
  wordings: Record<string, string>,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return wordings[key];
  }, language);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

describe("an alert incident rule's filled-in name", () => {
  test("is named for the severity it declares with", () => {
    expect(getAlertIncidentRuleName(["SEV1"], ENGLISH)).toBe(
      "Declare SEV1 incidents",
    );
  });

  test("is named for declaring at the alert's own severity while none is picked", () => {
    expect(getAlertIncidentRuleName([], ENGLISH)).toBe("Declare incidents");
    expect(getAlertIncidentRuleName(["", "  "], ENGLISH)).toBe(
      "Declare incidents",
    );
  });

  test("takes the first severity that has a name, trimmed", () => {
    expect(getAlertIncidentRuleName(["", "  Critical  "], ENGLISH)).toBe(
      "Declare Critical incidents",
    );
  });

  test("fits the rule's Name column", () => {
    const name: string = getAlertIncidentRuleName(["x".repeat(500)], ENGLISH);

    expect(name.length).toBe(RULE_NAME_MAX_LENGTH);
    expect(name.startsWith("Declare xxx")).toBe(true);
  });

  test("is written in the reader's language when it has worded the sentence", () => {
    const german: Translator = translatorWith("de", {
      [ALERT_INCIDENT_RULE_NAME_WITH_SEVERITY]: "{{severity}}-Vorfälle melden",
      [ALERT_INCIDENT_RULE_DEFAULT_NAME]: "Vorfälle melden",
    });

    expect(getAlertIncidentRuleName(["SEV1"], german)).toBe(
      "SEV1-Vorfälle melden",
    );
    expect(getAlertIncidentRuleName([], german)).toBe("Vorfälle melden");
  });

  test("is English in a language that has not worded it yet", () => {
    const untranslated: Translator = translatorWith("nl", {});

    expect(getAlertIncidentRuleName(["SEV1"], untranslated)).toBe(
      "Declare SEV1 incidents",
    );
  });

  test("a new rule starts named for the alert's own severity, declaring right away", () => {
    expect(getNewAlertIncidentRuleValues()).toEqual({
      name: "Declare incidents",
      declareAfterInMinutes: 0,
    });
  });
});

describe("when a rule declares, as the rules table says it", () => {
  test.each([
    [0, "Right away"],
    [undefined, "Right away"],
    [null, "Right away"],
    [1, "If still unresolved after 1 minute"],
    [15, "If still unresolved after 15 minutes"],
    [60, "If still unresolved after 1 hour"],
    [120, "If still unresolved after 2 hours"],
    [24 * 60, "If still unresolved after 1 day"],
    ["30", "If still unresolved after 30 minutes"],
  ] as Array<[unknown, string]>)("%p: %p", (wait: unknown, words: string) => {
    expect(describeAlertIncidentRuleWhen(wait, ENGLISH)).toBe(words);
  });

  test("is written in the reader's language, the wait included", () => {
    const german: Translator = translatorWith("de", {
      [ALERT_INCIDENT_RULE_RIGHT_AWAY]: "Sofort",
      [ALERT_INCIDENT_RULE_IF_STILL_UNRESOLVED]:
        "Wenn nach {{duration}} noch nicht behoben",
      "{{count}} minutes": "{{count}} Minuten",
    });

    expect(describeAlertIncidentRuleWhen(0, german)).toBe("Sofort");
    expect(describeAlertIncidentRuleWhen(15, german)).toBe(
      "Wenn nach 15 Minuten noch nicht behoben",
    );
  });

  test("a language that has not worded the sentence reads it wholly in English, never a German wait in it", () => {
    const halfway: Translator = translatorWith("de", {
      "{{count}} minutes": "{{count}} Minuten",
    });

    expect(describeAlertIncidentRuleWhen(15, halfway)).toBe(
      "If still unresolved after 15 minutes",
    );
  });
});
