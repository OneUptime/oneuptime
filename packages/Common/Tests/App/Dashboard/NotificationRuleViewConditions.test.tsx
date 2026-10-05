import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import NotificationRuleViewConditions, {
  getRuleConditionsSentence,
  RULE_CONDITIONS_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewConditions";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";

/*
 * The sentence above a workspace notification rule's conditions, in the
 * rules list. It said "This rule will be executed if any of the following
 * conditions are met:" over a single condition. All or Any is now said only
 * when there are two conditions to combine - as the rule's form asks it.
 */

function titleContains(value: string): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: ConditionType.Contains,
    value: value,
  };
}

function renderConditions(
  conditions: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition | undefined,
): void {
  render(
    <NotificationRuleViewConditions
      criteriaFilters={conditions}
      filterCondition={filterCondition as FilterCondition}
      eventType={NotificationRuleEventType.Incident}
      monitors={[]}
      labels={[]}
      alertStates={[]}
      alertSeverities={[]}
      incidentSeverities={[]}
      incidentStates={[]}
      scheduledMaintenanceStates={[]}
      monitorStatus={[]}
    />,
  );
}

function sentence(): string {
  return screen.getByTestId("notification-rule-conditions-sentence")
    .textContent as string;
}

afterEach(() => {
  cleanup();
});

describe("the sentence over a rule's conditions", () => {
  test("is a whole sentence for each case, never glued from pieces", () => {
    expect(RULE_CONDITIONS_SENTENCES).toEqual({
      one: "This rule runs when this condition is met:",
      all: "This rule runs when all of these conditions are met:",
      any: "This rule runs when any one of these conditions is met:",
    });
  });

  test.each([FilterCondition.All, FilterCondition.Any, undefined])(
    "over one condition says nothing of All or Any (%s)",
    (filterCondition: FilterCondition | undefined) => {
      renderConditions([titleContains("database")], filterCondition);

      expect(sentence()).toBe("This rule runs when this condition is met:");
    },
  );

  test("over two conditions says all, for All", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.All,
    );

    expect(sentence()).toBe(
      "This rule runs when all of these conditions are met:",
    );
  });

  test("over two conditions says any one, for Any", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.Any,
    );

    expect(sentence()).toBe(
      "This rule runs when any one of these conditions is met:",
    );
  });

  test.each([FilterCondition.All, FilterCondition.Any, undefined])(
    "over no conditions says no sentence, as the rule runs on every event (%s)",
    (filterCondition: FilterCondition | undefined) => {
      renderConditions([], filterCondition);

      expect(
        screen.queryByTestId("notification-rule-conditions-sentence"),
      ).not.toBeInTheDocument();
      expect(
        getRuleConditionsSentence({
          filters: [],
          filterCondition: filterCondition,
        }),
      ).toBeUndefined();
    },
  );

  test("over conditions it does not hold at all says no sentence either", () => {
    expect(
      getRuleConditionsSentence({
        filters: undefined,
        filterCondition: FilterCondition.All,
      }),
    ).toBeUndefined();
  });

  test("reads a rule saved without a match condition as any, as it always did", () => {
    expect(
      getRuleConditionsSentence({
        filters: [titleContains("a"), titleContains("b"), titleContains("c")],
        filterCondition: undefined,
      }),
    ).toBe(RULE_CONDITIONS_SENTENCES.any);
  });

  test("still lists every condition under it", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.All,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
