import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { describe, expect, test } from "@jest/globals";

/*
 * Which condition rows a workspace notification rule or summary is saved
 * without: the empty ones only.
 *
 * The notification rule table kept only conditions holding a list (a state,
 * a severity, labels, monitors), so a text condition - "Incident Title
 * contains database", "Monitor Name equal to api" - was dropped on save,
 * and the rule fired for every event. Rules and summaries now share one
 * definition of an empty row.
 */

function condition(
  value: string | Array<string> | undefined,
  checkOn: NotificationRuleConditionCheckOn = NotificationRuleConditionCheckOn.IncidentTitle,
): NotificationRuleCondition {
  return {
    checkOn: checkOn,
    conditionType: ConditionType.Contains,
    value: value,
  };
}

describe("an empty condition", () => {
  test.each([
    ["no value", undefined],
    ["the empty text Add Condition starts with", ""],
    ["blank text", "   "],
    ["an empty list", []],
  ])("is %s", (_label: string, value: string | Array<string> | undefined) => {
    expect(
      NotificationRuleConditionUtil.isEmptyCondition(condition(value)),
    ).toBe(true);
  });

  test.each([
    ["text", "database"],
    ["text with spaces around it", "  database  "],
    ["a number written as text", "0"],
    ["a list of one", ["severity-1"]],
    ["a list of several", ["label-1", "label-2"]],
  ])(
    "is not one holding %s",
    (_label: string, value: string | Array<string>) => {
      expect(
        NotificationRuleConditionUtil.isEmptyCondition(condition(value)),
      ).toBe(false);
    },
  );
});

describe("the conditions a rule or summary is saved with", () => {
  test("keep every text condition and every list, in their order", () => {
    const conditions: Array<NotificationRuleCondition> = [
      condition("database"),
      condition(
        ["severity-critical"],
        NotificationRuleConditionCheckOn.IncidentSeverity,
      ),
      condition("api", NotificationRuleConditionCheckOn.MonitorName),
    ];

    expect(
      NotificationRuleConditionUtil.withoutEmptyConditions(conditions),
    ).toEqual(conditions);
  });

  test("lose only the rows left empty", () => {
    expect(
      NotificationRuleConditionUtil.withoutEmptyConditions([
        condition(""),
        condition("database"),
        condition([], NotificationRuleConditionCheckOn.IncidentLabels),
        condition(undefined),
        condition(["label-1"], NotificationRuleConditionCheckOn.IncidentLabels),
      ]),
    ).toEqual([
      condition("database"),
      condition(["label-1"], NotificationRuleConditionCheckOn.IncidentLabels),
    ]);
  });

  test("of no conditions are none", () => {
    expect(NotificationRuleConditionUtil.withoutEmptyConditions([])).toEqual(
      [],
    );
  });

  test("never change the list they were handed", () => {
    const conditions: Array<NotificationRuleCondition> = [
      condition(""),
      condition("database"),
    ];

    NotificationRuleConditionUtil.withoutEmptyConditions(conditions);

    expect(conditions).toHaveLength(2);
  });
});
