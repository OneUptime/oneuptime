import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  EVERY_NEW_ALERT_RULE_DESCRIPTION,
  EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
  RULE_NAME_MAX_LENGTH,
  getEveryNewAlertRuleName,
  getEveryNewIncidentRuleName,
  readPageForEveryNewIncidentAndAlert,
  shouldOfferEveryNewEventRules,
} from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import ColumnLength from "../../../Types/Database/ColumnLength";

/*
 * The shared rule of "Page this policy for every new incident and alert":
 * the misc data key and how the server reads it, what the two rules are
 * called, and when Create On-Call Policy offers it.
 */

function ask(value: unknown): JSONObject {
  return { [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: value } as JSONObject;
}

describe("readPageForEveryNewIncidentAndAlert", () => {
  test("the key is the one the dashboard's switch writes", () => {
    expect(PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY).toBe(
      "pageForEveryNewIncidentAndAlert",
    );
  });

  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["empty misc data", {}],
    ["misc data that is a list", [] as unknown as JSONObject],
    ["false", ask(false)],
    ["null", ask(null)],
    ["the text false", ask("false")],
    ["the text False, padded", ask("  False ")],
    ["empty text", ask("")],
  ] as Array<[string, JSONObject | null | undefined]>)(
    "%s asks for nothing",
    (_label: string, miscDataProps: JSONObject | null | undefined) => {
      expect(readPageForEveryNewIncidentAndAlert(miscDataProps)).toBe(false);
    },
  );

  test.each([
    ["true", ask(true)],
    ["the text true", ask("true")],
    ["the text TRUE, padded", ask(" TRUE ")],
  ] as Array<[string, JSONObject]>)(
    "%s asks for the two rules",
    (_label: string, miscDataProps: JSONObject) => {
      expect(readPageForEveryNewIncidentAndAlert(miscDataProps)).toBe(true);
    },
  );

  test.each([
    ["a number", ask(1)],
    ["other text", ask("yes please")],
    ["a list", ask([true])],
    ["an object", ask({ incidents: true })],
  ] as Array<[string, JSONObject]>)(
    "%s is refused, not read as no",
    (_label: string, miscDataProps: JSONObject) => {
      expect(() => {
        return readPageForEveryNewIncidentAndAlert(miscDataProps);
      }).toThrow(BadDataException);
      expect(() => {
        return readPageForEveryNewIncidentAndAlert(miscDataProps);
      }).toThrow("pageForEveryNewIncidentAndAlert must be true or false.");
    },
  );
});

describe("the two rules' names", () => {
  test("say what they page, and for what", () => {
    expect(getEveryNewIncidentRuleName("Payments on-call")).toBe(
      "Page Payments on-call for every incident",
    );
    expect(getEveryNewAlertRuleName("Payments on-call")).toBe(
      "Page Payments on-call for every alert",
    );
  });

  test("tidy the policy name's spaces", () => {
    expect(getEveryNewIncidentRuleName("  Payments \n  on-call ")).toBe(
      "Page Payments on-call for every incident",
    );
  });

  test("a policy with no name is the new on-call policy", () => {
    for (const name of [undefined, null, "", "   "]) {
      expect(getEveryNewIncidentRuleName(name)).toBe(
        "Page the new on-call policy for every incident",
      );
      expect(getEveryNewAlertRuleName(name)).toBe(
        "Page the new on-call policy for every alert",
      );
    }
  });

  test("fit a rule's name column, cutting the policy's name and keeping the words around it", () => {
    expect(RULE_NAME_MAX_LENGTH).toBe(ColumnLength.ShortText);

    const longName: string = "Payments platform primary on-call "
      .repeat(5)
      .trim();

    for (const name of [
      getEveryNewIncidentRuleName(longName),
      getEveryNewAlertRuleName(longName),
    ]) {
      expect(Array.from(name).length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
      expect(name.startsWith("Page Payments platform primary on-call")).toBe(
        true,
      );
      expect(name).toContain("…");
    }

    expect(
      getEveryNewIncidentRuleName(longName).endsWith("… for every incident"),
    ).toBe(true);
    expect(
      getEveryNewAlertRuleName(longName).endsWith("… for every alert"),
    ).toBe(true);
  });

  test("a name that just fits is not cut", () => {
    // "Page " + name + " for every incident" is exactly the column's length.
    const room: number =
      RULE_NAME_MAX_LENGTH - "Page ".length - " for every incident".length;
    const name: string = "x".repeat(room);

    expect(getEveryNewIncidentRuleName(name)).toBe(
      `Page ${name} for every incident`,
    );
    expect(Array.from(getEveryNewIncidentRuleName(name)).length).toBe(
      RULE_NAME_MAX_LENGTH,
    );
    expect(getEveryNewIncidentRuleName(`${name}y`)).toContain("…");
  });

  test("count a character outside the basic plane as one, and never split it", () => {
    const name: string = "🚨".repeat(120);
    const ruleName: string = getEveryNewIncidentRuleName(name);

    expect(Array.from(ruleName).length).toBeLessThanOrEqual(
      RULE_NAME_MAX_LENGTH,
    );
    // No lone surrogate half left behind by the cut.
    expect(ruleName.includes("�")).toBe(false);
    for (const character of Array.from(ruleName)) {
      expect(character.length === 1 || character === "🚨").toBe(true);
    }
  });

  test("each rule's description says what it does, and that it came with the policy", () => {
    expect(EVERY_NEW_INCIDENT_RULE_DESCRIPTION).toBe(
      "Pages this on-call policy for every new incident. Added when the policy was created.",
    );
    expect(EVERY_NEW_ALERT_RULE_DESCRIPTION).toBe(
      "Pages this on-call policy for every new alert. Added when the policy was created.",
    );
  });
});

describe("shouldOfferEveryNewEventRules", () => {
  const NEW_PROJECT: {
    policyCount: number | null;
    incidentRuleCount: number | null;
    alertRuleCount: number | null;
    mayAddRules: boolean;
  } = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayAddRules: true,
  };

  test("offers it for a new project's first policy, to someone who may add rules", () => {
    expect(shouldOfferEveryNewEventRules(NEW_PROJECT)).toBe(true);
  });

  test.each([
    ["a policy already", { policyCount: 1 }],
    ["an incident on-call rule", { incidentRuleCount: 1 }],
    ["an alert on-call rule", { alertRuleCount: 3 }],
    ["no right to add rules", { mayAddRules: false }],
    ["an unknown policy count", { policyCount: null }],
    ["an unknown incident rule count", { incidentRuleCount: null }],
    ["an unknown alert rule count", { alertRuleCount: null }],
  ] as Array<[string, Partial<typeof NEW_PROJECT>]>)(
    "offers nothing with %s",
    (_label: string, change: Partial<typeof NEW_PROJECT>) => {
      expect(shouldOfferEveryNewEventRules({ ...NEW_PROJECT, ...change })).toBe(
        false,
      );
    },
  );
});
