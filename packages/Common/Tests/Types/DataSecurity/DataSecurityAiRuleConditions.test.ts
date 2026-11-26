import {
  DATA_SECURITY_AI_RULE_CONDITION_LIST_FIELDS,
  MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH,
  MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUES,
  getDataSecurityAiRuleConditionListProblem,
  getDataSecurityAiRuleConditionsProblem,
} from "../../../Types/DataSecurity/DataSecurityAiRuleConditions";
import { DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS } from "../../../Types/DataSecurity/DataSecurityAi";
import { describe, expect, test } from "@jest/globals";

/*
 * A Data Security AI rule's condition lists hold only values that exist
 * (#10364): a check, a severity or a kind nobody can have would make a rule
 * that silently never matches - and, since rules narrow what OneUptime AI
 * works on, quietly stop it.
 */

describe("a Data Security AI rule's condition lists", () => {
  test("are every Data Security condition but the store's labels, which name records", () => {
    expect([...DATA_SECURITY_AI_RULE_CONDITION_LIST_FIELDS].sort()).toEqual(
      DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS.filter(
        (field: string): boolean => {
          return field !== "dataStoreLabels";
        },
      ).sort(),
    );
  });

  test("hold the catalogs' own values", () => {
    expect(
      getDataSecurityAiRuleConditionsProblem({
        dataSecurityChecks: ["public-read", "secrets-in-telemetry"],
        dataSecurityCheckGroups: ["Exposure", "Telemetry", "Data hygiene"],
        dataSecuritySeverities: ["Critical", "High"],
        dataStoreSensitivities: ["Restricted"],
        dataStoreKinds: ["AWS S3 Bucket"],
        dataStoreProviders: ["aws", "self-managed"],
        dataStoreEnvironments: ["Production", "Unknown"],
        dataCategories: ["Secrets and credentials", "Financial"],
      }),
    ).toBeNull();
  });

  test("say nothing when they are empty, or not written", () => {
    expect(getDataSecurityAiRuleConditionsProblem({})).toBeNull();
    expect(
      getDataSecurityAiRuleConditionsProblem({
        dataSecuritySeverities: [],
        dataStoreKinds: null,
      }),
    ).toBeNull();
  });

  test.each([
    [
      "dataSecuritySeverities",
      ["Severe"],
      'Data Security Severities can only hold Critical, High, Medium or Low; "Severe" is not one of them.',
    ],
    [
      "dataSecurityChecks",
      ["no-such-check"],
      `Data Security Checks can only hold the ids of Data Security's checks; "no-such-check" is not one of them.`,
    ],
    [
      "dataStoreKinds",
      ["Floppy Disk"],
      'Data Store Kinds can only hold the kinds of store Data Security finds; "Floppy Disk" is not one of them.',
    ],
    [
      "dataCategories",
      ["secrets"],
      'Data Categories can only hold Secrets and credentials, Financial, Health, Government ID, Special category, Contact and identity or Business confidential; "secrets" is not one of them.',
    ],
  ])(
    "refuse a value of %s that does not exist",
    (field: string, value: Array<string>, message: string) => {
      expect(getDataSecurityAiRuleConditionListProblem(field, value)).toBe(
        message,
      );
      expect(getDataSecurityAiRuleConditionsProblem({ [field]: value })).toBe(
        message,
      );
    },
  );

  test("refuse anything but a list of names", () => {
    expect(
      getDataSecurityAiRuleConditionListProblem(
        "dataSecuritySeverities",
        "Critical",
      ),
    ).toBe("Data Security Severities must be a list.");
    expect(
      getDataSecurityAiRuleConditionListProblem("dataSecuritySeverities", [
        "Critical",
        7,
      ]),
    ).toBe("Data Security Severities must be a list of names.");
    expect(
      getDataSecurityAiRuleConditionListProblem("dataStoreProviders", ["  "]),
    ).toBe("Data Store Providers must be a list of names.");
  });

  test("hold at most a hundred values", () => {
    expect(
      getDataSecurityAiRuleConditionListProblem(
        "dataStoreProviders",
        Array.from(
          { length: MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUES + 1 },
          (_value: unknown, index: number): string => {
            return `provider-${index}`;
          },
        ),
      ),
    ).toBe("Data Store Providers can hold at most 100 values.");
  });

  test("take a provider as the store's own word, held only to a length", () => {
    expect(
      getDataSecurityAiRuleConditionListProblem("dataStoreProviders", [
        "my-own-cloud",
      ]),
    ).toBeNull();
    expect(
      getDataSecurityAiRuleConditionListProblem("dataStoreProviders", [
        "x".repeat(MAX_DATA_SECURITY_AI_RULE_CONDITION_VALUE_LENGTH + 1),
      ]),
    ).toBe("Each of Data Store Providers can be at most 100 characters.");
  });

  test("leave alone a field that is not a condition list", () => {
    expect(
      getDataSecurityAiRuleConditionListProblem("dataStoreLabels", "anything"),
    ).toBeNull();
  });
});
