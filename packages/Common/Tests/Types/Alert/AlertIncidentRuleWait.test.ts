import {
  ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES,
  ALERT_INCIDENT_RULE_WAIT_COLUMN,
  describeAlertIncidentRuleWait,
  doesAlertIncidentRuleDeclareRightAway,
  formatAlertIncidentRuleWait,
  getAlertIncidentRuleDeclareAt,
  getAlertIncidentRuleWaitInMinutes,
  getAlertIncidentRuleWaitProblem,
} from "../../../Types/Alert/AlertIncidentRuleWait";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW LONG AN ALERT INCIDENT RULE WAITS: one set of numbers and words for
 * the rule's service, its engine, the worker and the Dashboard.
 */

describe("an alert incident rule's wait", () => {
  test("is stored in the model's Declare After (Minutes) column", () => {
    const rule: AlertIncidentRule = new AlertIncidentRule();

    expect(rule.hasColumn(ALERT_INCIDENT_RULE_WAIT_COLUMN)).toBe(true);
    expect(
      rule.getTableColumnMetadata(ALERT_INCIDENT_RULE_WAIT_COLUMN).title,
    ).toBe("Declare After (Minutes)");
  });

  test("is at most a week", () => {
    expect(ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES).toBe(7 * 24 * 60);
  });

  describe("what may be saved", () => {
    test.each([
      ["0, declare right away", 0],
      ["15 minutes", 15],
      ["a week to the minute", 7 * 24 * 60],
      ["a number sent as text", "30"],
      ["text with spaces around it", " 45 "],
      ["nothing: the column's default", undefined],
      ["null: the column's default", null],
      ["an emptied number box", ""],
      ["a box of spaces", "   "],
    ] as Array<[string, unknown]>)("%s", (_name: string, value: unknown) => {
      expect(getAlertIncidentRuleWaitProblem(value)).toBeNull();
    });
  });

  describe("what is refused", () => {
    test.each([
      ["a negative number", -1],
      ["a fraction of a minute", 1.5],
      ["text that is not a number", "soon"],
      ["text with a unit", "15m"],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["NaN", Number.NaN],
      ["a boolean", true],
      ["an object", { minutes: 15 }],
      ["an array", [15]],
    ] as Array<[string, unknown]>)("%s", (_name: string, value: unknown) => {
      expect(getAlertIncidentRuleWaitProblem(value)).toBe(
        "Declare After (Minutes) must be a whole number of minutes: 0 to declare the incident as soon as the alert is created, or how long the alert must stay unresolved first.",
      );
    });

    test("more than a week, saying how much is allowed", () => {
      expect(getAlertIncidentRuleWaitProblem(7 * 24 * 60 + 1)).toBe(
        "Declare After (Minutes) can be at most 10080 minutes (a week).",
      );
      expect(getAlertIncidentRuleWaitProblem("999999")).toBe(
        "Declare After (Minutes) can be at most 10080 minutes (a week).",
      );
    });
  });

  describe("the wait a stored value means", () => {
    test.each([
      [0, 0],
      [15, 15],
      ["20", 20],
      [undefined, 0],
      [null, 0],
      ["", 0],
      // Never saved by the service; a row written around it declares right away.
      [-5, 0],
      [2.5, 0],
      ["soon", 0],
      // Capped at a week.
      [100000, 7 * 24 * 60],
    ] as Array<[unknown, number]>)("%p is %p minutes", (value: unknown, minutes: number) => {
      expect(getAlertIncidentRuleWaitInMinutes(value)).toBe(minutes);
    });

    test("0 and nothing declare right away; any wait does not", () => {
      expect(doesAlertIncidentRuleDeclareRightAway(0)).toBe(true);
      expect(doesAlertIncidentRuleDeclareRightAway(undefined)).toBe(true);
      expect(doesAlertIncidentRuleDeclareRightAway(null)).toBe(true);
      expect(doesAlertIncidentRuleDeclareRightAway(1)).toBe(false);
      expect(doesAlertIncidentRuleDeclareRightAway("15")).toBe(false);
    });
  });

  test("declares the wait after the alert was created", () => {
    const createdAt: Date = new Date("2026-11-03T10:00:00.000Z");

    expect(
      getAlertIncidentRuleDeclareAt({
        alertCreatedAt: createdAt,
        waitInMinutes: 15,
      }).toISOString(),
    ).toBe("2026-11-03T10:15:00.000Z");
    expect(
      getAlertIncidentRuleDeclareAt({
        alertCreatedAt: createdAt,
        waitInMinutes: 0,
      }).toISOString(),
    ).toBe("2026-11-03T10:00:00.000Z");
    expect(
      getAlertIncidentRuleDeclareAt({
        alertCreatedAt: createdAt,
        waitInMinutes: 24 * 60,
      }).toISOString(),
    ).toBe("2026-11-04T10:00:00.000Z");
  });

  describe("in words", () => {
    test.each([
      [0, "Right away"],
      [1, "If still unresolved after 1 minute"],
      [15, "If still unresolved after 15 minutes"],
      [60, "If still unresolved after 1 hour"],
      [90, "If still unresolved after 1 hour 30 minutes"],
      [24 * 60, "If still unresolved after 1 day"],
      [2 * 24 * 60 + 61, "If still unresolved after 2 days 1 hour 1 minute"],
    ] as Array<[number, string]>)("%p minutes: %p", (minutes: number, words: string) => {
      expect(describeAlertIncidentRuleWait(minutes)).toBe(words);
    });

    test("a wait on its own, largest unit first", () => {
      expect(formatAlertIncidentRuleWait(0)).toBe("0 minutes");
      expect(formatAlertIncidentRuleWait(125)).toBe("2 hours 5 minutes");
      expect(formatAlertIncidentRuleWait(3 * 24 * 60)).toBe("3 days");
    });
  });
});
