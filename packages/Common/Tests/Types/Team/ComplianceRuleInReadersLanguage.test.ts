import { describe, expect, test } from "@jest/globals";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  getValueInSentence,
  joinAsProse,
  UNKNOWN_RULE,
} from "../../../Types/Team/ComplianceRule";
import {
  composedValue,
  createTranslator,
  translatableTerm,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE COMPLIANCE RULE CATALOG SAYS A RULE IN THE READER'S LANGUAGE (#8296).
 *
 * Teams > Compliance names and describes each rule from this catalog
 * (getTitle, describe), and both built their sentences in English: "Call and
 * Push notification for incidents", "Every member has an incident on-call
 * rule that notifies them by Call for Critical Incident." - glued from the
 * rule's subject, an article picked by its first letter, and an English
 * "and". Each shape is one whole key now, so a language words the subject,
 * the article and the verb together. The server builds its own sentences
 * from the same file and never hands a translator: it gets the English it
 * always got, which the English cases here pin.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const ON_CALL_RULES: Array<ComplianceRuleDefinition> =
  COMPLIANCE_RULE_DEFINITIONS.filter(
    (definition: ComplianceRuleDefinition): boolean => {
      return definition.category === ComplianceRuleCategory.OnCallRule;
    },
  );

const METHOD_RULES: Array<ComplianceRuleDefinition> =
  COMPLIANCE_RULE_DEFINITIONS.filter(
    (definition: ComplianceRuleDefinition): boolean => {
      return definition.category === ComplianceRuleCategory.NotificationMethod;
    },
  );

// Every shape a rule's name and sentence take: no, one and three channels.
const CHANNEL_SHAPES: ReadonlyArray<Array<ComplianceNotificationChannel>> = [
  [],
  [ComplianceNotificationChannel.Call],
  [
    ComplianceNotificationChannel.Call,
    ComplianceNotificationChannel.SMS,
    ComplianceNotificationChannel.Push,
  ],
];

// Every scope: every severity, one, and several.
const SCOPES: ReadonlyArray<Array<string>> = [
  [],
  ["Sev 1"],
  ["Sev 1", "Sev 2", "Sev 3", "Sev 4"],
];

describe("without a translator, the English the server always wrote", () => {
  test.each(ON_CALL_RULES)(
    "$ruleType: an English translator writes exactly what no translator does",
    (definition: ComplianceRuleDefinition) => {
      for (const channels of CHANNEL_SHAPES) {
        expect(
          ComplianceRule.getTitle(
            { ruleType: definition.ruleType, notificationChannels: channels },
            ENGLISH,
          ),
        ).toBe(
          ComplianceRule.getTitle({
            ruleType: definition.ruleType,
            notificationChannels: channels,
          }),
        );

        for (const scope of SCOPES) {
          expect(
            ComplianceRule.describe(
              {
                ruleType: definition.ruleType,
                notificationChannels: channels,
                severityNames: scope,
              },
              ENGLISH,
            ),
          ).toBe(
            ComplianceRule.describe({
              ruleType: definition.ruleType,
              notificationChannels: channels,
              severityNames: scope,
            }),
          );
        }
      }
    },
  );

  test("the sentences read as they did before they were keys", () => {
    expect(
      ComplianceRule.describe({
        ruleType: ON_CALL_RULES[0]!.ruleType,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        severityNames: ["Critical Incident"],
      }),
    ).toBe(
      "Every member has incident on-call rules that notify them by Call and by Push notification for Critical Incident.",
    );
    expect(
      ComplianceRule.describe({
        ruleType: ON_CALL_RULES[3]!.ruleType,
        severityNames: [],
      }),
    ).toBe(
      "Every member has an alert episode on-call rule for every alert episode severity.",
    );
    expect(
      ComplianceRule.getTitle({
        ruleType: ON_CALL_RULES[1]!.ruleType,
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.Webhook,
        ],
      }),
    ).toBe("Call, SMS and Webhook for alerts");
    expect(
      ComplianceRule.describe({ ruleType: METHOD_RULES[9]!.ruleType }),
    ).toBe("Every member has a webhook notification method.");
    expect(ComplianceRule.getTitle({ ruleType: undefined })).toBe(UNKNOWN_RULE);
    expect(ComplianceRule.describe({ ruleType: "HasCarrierPigeon" })).toBe(
      'Unknown compliance rule "HasCarrierPigeon".',
    );
  });

  test("joinAsProse without a translator is the server's English list", () => {
    expect(joinAsProse([])).toBe("");
    expect(joinAsProse(["a"])).toBe("a");
    expect(joinAsProse(["a", "b"])).toBe("a and b");
    expect(joinAsProse(["a", "b", "c", "d"])).toBe("a, b, c and d");
  });
});

describe("with the reader's translator", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words every rule's name, what it checks, and its sentence in every shape",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const definition of COMPLIANCE_RULE_DEFINITIONS) {
        expect({
          ruleType: definition.ruleType,
          title: ComplianceRule.getTitle(
            { ruleType: definition.ruleType },
            translator,
          ),
        }).not.toEqual({
          ruleType: definition.ruleType,
          title: definition.title,
        });

        for (const text of [definition.title, definition.description]) {
          expect({
            text,
            worded: isWordedInDashboardLocale(text, language),
          }).toEqual({ text, worded: true });
        }
      }

      for (const definition of ON_CALL_RULES) {
        for (const channels of CHANNEL_SHAPES) {
          if (channels.length > 0) {
            expect(
              ComplianceRule.getTitle(
                {
                  ruleType: definition.ruleType,
                  notificationChannels: channels,
                },
                translator,
              ),
            ).not.toBe(
              ComplianceRule.getTitle({
                ruleType: definition.ruleType,
                notificationChannels: channels,
              }),
            );
          }

          for (const scope of SCOPES) {
            const sentence: string = ComplianceRule.describe(
              {
                ruleType: definition.ruleType,
                notificationChannels: channels,
                severityNames: scope,
              },
              translator,
            );

            expect(sentence).not.toMatch(
              /Every member|on-call rule|notif(y|ies) them|every .* severity/,
            );

            // A name someone gave a severity reads as they wrote it.
            for (const name of scope) {
              expect(sentence).toContain(name);
            }
          }
        }
      }

      for (const definition of METHOD_RULES) {
        expect(
          ComplianceRule.describe(
            { ruleType: definition.ruleType },
            translator,
          ),
        ).not.toMatch(/Every member/);
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s names every channel its own way, or keeps a brand's name",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const definition of COMPLIANCE_CHANNEL_DEFINITIONS) {
        expect({
          channel: definition.channel,
          worded: isWordedInDashboardLocale(definition.label, language),
        }).toEqual({ channel: definition.channel, worded: true });
        expect(
          ComplianceRule.getChannelLabel(definition.channel, translator),
        ).toBe(translator.translateText(definition.label) || definition.label);
      }
    },
  );

  test("German, word for word", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      ComplianceRule.getTitle(
        {
          ruleType: ON_CALL_RULES[0]!.ruleType,
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        },
        german,
      ),
    ).toBe("Anruf und Push-Benachrichtigung für Vorfälle");
    expect(
      ComplianceRule.describe(
        {
          ruleType: ON_CALL_RULES[0]!.ruleType,
          notificationChannels: [],
          severityNames: [],
        },
        german,
      ),
    ).toBe(
      "Jedes Mitglied hat eine Bereitschaftsregel für Vorfälle für jeden Vorfallsschweregrad.",
    );
    expect(
      ComplianceRule.describe({ ruleType: METHOD_RULES[0]!.ruleType }, german),
    ).toBe("Jedes Mitglied hat eine verifizierte Telefonnummer für Anrufe.");
  });

  test("a rule type this build does not know reads as stored, and its sentence in the reader's words", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      ComplianceRule.getTitle({ ruleType: "HasCarrierPigeon" }, german),
    ).toBe("HasCarrierPigeon");
    expect(ComplianceRule.getTitle({ ruleType: "" }, german)).toBe(
      "Unbekannte Regel",
    );
    expect(
      ComplianceRule.describe({ ruleType: "HasCarrierPigeon" }, german),
    ).toBe("Unbekannte Compliance-Regel „HasCarrierPigeon“.");
  });

  test("an unknown channel reads as stored", () => {
    expect(
      ComplianceRule.getChannelLabel(
        "CarrierPigeon",
        dashboardTranslator("de"),
      ),
    ).toBe("CarrierPigeon");
    expect(ComplianceRule.getChannelLabel(undefined)).toBe("");
  });
});

describe("a list in a sentence", () => {
  test("is joined the way the reader's language joins it", () => {
    const german: Translator = dashboardTranslator("de");
    const japanese: Translator = dashboardTranslator("ja");

    expect(joinAsProse(["a", "b"], german)).toBe(
      german.translateTemplate("{{first}} and {{second}}", {
        first: "a",
        second: "b",
      }),
    );
    expect(joinAsProse(["a", "b", "c"], german)).toBe(
      german.translateTemplate("{{first}}, {{second}} and {{third}}", {
        first: "a",
        second: "b",
        third: "c",
      }),
    );
    // A longer list says its first ones together, with the language's separator.
    expect(joinAsProse(["a", "b", "c", "d"], japanese)).toContain("a、b");
    expect(joinAsProse(["a", "b", "c", "d"], ENGLISH)).toBe("a, b, c and d");
    expect(joinAsProse(["only"], german)).toBe("only");
  });
});

describe("a value of a sentence", () => {
  const german: Translator = dashboardTranslator("de");

  test("a name reads as written, a number in its digits, a term and a composed value in the sentence's words", () => {
    expect(getValueInSentence("Sev 1", german)).toBe("Sev 1");
    expect(getValueInSentence(1234, german)).toBe("1.234");
    expect(
      getValueInSentence(translatableTerm("Critical Incident"), german),
    ).toBe("Kritischer Vorfall");
    expect(
      getValueInSentence(
        composedValue((sentence: Translator): string => {
          return sentence.language;
        }),
        german,
      ),
    ).toBe("de");
  });
});

describe("the catalog's own shape", () => {
  test("every channel has a label and every rule a title: the keys the page looks up", () => {
    for (const definition of COMPLIANCE_CHANNEL_DEFINITIONS as ReadonlyArray<ComplianceChannelDefinition>) {
      expect(definition.label.length).toBeGreaterThan(0);
    }

    expect(COMPLIANCE_RULE_DEFINITIONS.length).toBe(
      ON_CALL_RULES.length + METHOD_RULES.length,
    );
  });
});
