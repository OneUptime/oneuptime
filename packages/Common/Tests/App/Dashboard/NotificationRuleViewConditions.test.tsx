import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import NotificationRuleViewConditions, {
  getRuleConditionsSentence,
  RULE_CONDITIONS_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewConditions";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";

/*
 * A workspace notification rule's conditions, on its card, under "Which
 * incidents". All or Any is said only when there are two conditions to
 * combine - as the rule's form asks it - and one condition is simply the
 * condition, on a line of its own.
 *
 * The card said "This rule runs when this condition is met:" over a single
 * condition, in a framed box with a timeline's dots, under a label that
 * already asked which incidents the rule is for.
 */

const ACKNOWLEDGED_ID: string = "6a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";

function titleContains(value: string): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: ConditionType.Contains,
    value: value,
  };
}

function acknowledgedState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = ACKNOWLEDGED_ID;
  state.name = "Acknowledged";

  return state;
}

function renderConditions(
  conditions: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition | undefined,
  incidentStates: Array<IncidentState> = [],
): void {
  render(
    <NotificationRuleViewConditions
      criteriaFilters={conditions}
      filterCondition={filterCondition as FilterCondition}
      monitors={[]}
      labels={[]}
      alertStates={[]}
      alertSeverities={[]}
      incidentSeverities={[]}
      incidentStates={incidentStates}
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
      all: "Those that match all of these:",
      any: "Those that match any one of these:",
    });
  });

  test.each([FilterCondition.All, FilterCondition.Any, undefined])(
    "over one condition says nothing: the condition is the line (%s)",
    (filterCondition: FilterCondition | undefined) => {
      renderConditions([titleContains("database")], filterCondition);

      expect(
        screen.queryByTestId("notification-rule-conditions-sentence"),
      ).not.toBeInTheDocument();
      expect(
        getRuleConditionsSentence({
          filters: [titleContains("database")],
          filterCondition: filterCondition,
        }),
      ).toBeUndefined();

      // The condition alone, as one line: what is checked, how, and what.
      const items: Array<HTMLElement> = screen.getAllByRole("listitem");

      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent(
        /^Incident Title\s*Contains\s*database$/,
      );
    },
  );

  test("over two conditions says all, for All", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.All,
    );

    expect(sentence()).toBe("Those that match all of these:");
  });

  test("over two conditions says any one, for Any", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.Any,
    );

    expect(sentence()).toBe("Those that match any one of these:");
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

  test("lists every condition under it, one a line", () => {
    renderConditions(
      [titleContains("database"), titleContains("postgres")],
      FilterCondition.All,
    );

    const items: Array<HTMLElement> = screen.getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/database$/);
    expect(items[1]).toHaveTextContent(/postgres$/);
    // Under the sentence that says how they combine.
    expect(
      screen
        .getByTestId("notification-rule-conditions-sentence")
        .compareDocumentPosition(items[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /*
   * A state, severity, label or monitor condition shows the picked values
   * by name, as chips in the line, not by the ids the rule stores.
   */
  test("a state condition names its states, in the same line", () => {
    renderConditions(
      [
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentState,
          conditionType: ConditionType.ContainsAny,
          value: [ACKNOWLEDGED_ID],
        },
      ],
      FilterCondition.All,
      [acknowledgedState()],
    );

    const line: HTMLElement = screen.getByRole("listitem");

    expect(line).toHaveTextContent(
      /^Incident State\s*Contains Any\s*Acknowledged$/,
    );
    expect(within(line).queryByText(ACKNOWLEDGED_ID)).not.toBeInTheDocument();
    // No framed box or timeline dots around a single condition any more.
    expect(document.querySelector(".rounded-xl")).toBeNull();
  });
});
