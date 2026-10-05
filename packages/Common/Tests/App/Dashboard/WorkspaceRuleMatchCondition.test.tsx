import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A workspace notification rule's Conditions step asks All or Any only once
 * there are two conditions to combine.
 *
 * It asked before there was a single condition - the radio drew first, with
 * nothing under it to combine - and with one condition the two answers fire
 * on the same events (NotificationRuleOneConditionAllAny proves it). Now the
 * radio, titled Match Condition, appears under the conditions when the
 * second one is added, starts on what the rule holds (All for a new rule),
 * and goes when a rule is back to one - which keeps what was chosen, so the
 * rule fires exactly as before.
 *
 * The real NotificationRuleForm and NotificationRuleConditions, in a parent
 * that holds the rule as the rule wizard does.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import NotificationRuleForm, {
  NotificationRuleFormPart,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleForm";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

function titleContains(value: string): NotificationRuleCondition {
  return {
    checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
    conditionType: ConditionType.Contains,
    value: value,
  };
}

function ruleWith(
  filters: Array<NotificationRuleCondition>,
  filterCondition: FilterCondition,
): IncidentNotificationRule {
  return {
    filterCondition: filterCondition,
    filters: filters,
  } as unknown as IncidentNotificationRule;
}

// The rule wizard's part: it holds the rule, the Conditions half edits it.
function Harness(props: {
  initial: IncidentNotificationRule;
  onChange: MockFunction;
}): ReactElement {
  const [rule, setRule] = useState<IncidentNotificationRule>(props.initial);

  return (
    <NotificationRuleForm
      part={NotificationRuleFormPart.Conditions}
      value={rule}
      onChange={(value: IncidentNotificationRule) => {
        setRule(value);
        props.onChange(value);
      }}
      eventType={NotificationRuleEventType.Incident}
      monitors={[]}
      labels={[]}
      alertStates={[]}
      alertSeverities={[]}
      incidentSeverities={[]}
      incidentStates={[]}
      scheduledMaintenanceStates={[]}
      monitorStatus={[]}
      workspaceType={WorkspaceType.Slack}
      teams={[]}
      users={[]}
    />
  );
}

/*
 * The half is a BasicForm of its own, which hands a change up only once its
 * initial values have settled, in an effect after its fields are drawn.
 */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

async function renderConditions(
  initial: IncidentNotificationRule,
): Promise<{ onChange: MockFunction; user: UserEvent }> {
  const onChange: MockFunction = getJestMockFunction();

  await act(async (): Promise<void> => {
    render(<Harness initial={initial} onChange={onChange} />);
  });

  await settle();

  return { onChange: onChange, user: userEvent.setup({ delay: null }) };
}

function lastRule(onChange: MockFunction): IncidentNotificationRule {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as IncidentNotificationRule;
}

function valueInputs(): Array<HTMLInputElement> {
  return screen.getAllByRole("textbox") as Array<HTMLInputElement>;
}

async function addCondition(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Add Condition" }));
  await settle();
}

afterEach(() => {
  cleanup();
});

describe("a new rule's Conditions step", () => {
  test("asks no All or Any while there is no condition", async () => {
    await renderConditions(ruleWith([], FilterCondition.All));

    expect(screen.getByRole("button", { name: "Add Condition" })).toBeVisible();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText("Match Condition")).not.toBeInTheDocument();
  });

  test("still asks none with one condition", async () => {
    const { user } = await renderConditions(ruleWith([], FilterCondition.All));

    await addCondition(user);

    expect(valueInputs()).toHaveLength(1);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  test("asks Match Condition under the conditions once the second is added, starting on All", async () => {
    const { user } = await renderConditions(ruleWith([], FilterCondition.All));

    await addCondition(user);
    await addCondition(user);

    const group: HTMLElement = await screen.findByRole("radiogroup", {
      name: /^Match Condition/,
    });

    expect(within(group).getByRole("radio", { name: "All" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Any" })).not.toBeChecked();
    expect(
      screen.getByText("Should all conditions match, or just any one of them?"),
    ).toBeVisible();

    // Below the conditions and their Add Condition button, not above them.
    expect(
      screen
        .getByRole("button", { name: "Add Condition" })
        .compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("hands Any up with the conditions when it is picked", async () => {
    const { onChange, user } = await renderConditions(
      ruleWith(
        [titleContains("database"), titleContains("postgres")],
        FilterCondition.All,
      ),
    );

    await user.click(await screen.findByRole("radio", { name: "Any" }));

    await waitFor(() => {
      expect(lastRule(onChange).filterCondition).toBe(FilterCondition.Any);
    });
    expect(lastRule(onChange).filters).toEqual([
      titleContains("database"),
      titleContains("postgres"),
    ]);
  });
});

describe("a rule going back to one condition", () => {
  test("stops asking, and keeps the Any it was given", async () => {
    const { onChange, user } = await renderConditions(
      ruleWith(
        [titleContains("database"), titleContains("postgres")],
        FilterCondition.All,
      ),
    );

    await user.click(await screen.findByRole("radio", { name: "Any" }));
    await waitFor(() => {
      expect(lastRule(onChange).filterCondition).toBe(FilterCondition.Any);
    });

    /*
     * Straight after picking Any: the conditions list used to hand its
     * change up onto the rule as it was before Any, putting All back.
     */
    await user.click(
      screen.getAllByRole("button", { name: "Delete Filter" })[1]!,
    );
    await settle();

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(lastRule(onChange).filters).toEqual([titleContains("database")]);
    expect(lastRule(onChange).filterCondition).toBe(FilterCondition.Any);
  });

  test("by deleting the first condition shows - and keeps - the second", async () => {
    const { onChange, user } = await renderConditions(
      ruleWith(
        [titleContains("first"), titleContains("second")],
        FilterCondition.Any,
      ),
    );

    expect(
      valueInputs().map((input: HTMLInputElement): string => {
        return input.value;
      }),
    ).toEqual(["first", "second"]);

    await user.click(
      screen.getAllByRole("button", { name: "Delete Filter" })[0]!,
    );
    await settle();

    /*
     * Rows keyed by position used to draw "first" here, the deleted one,
     * while the rule held "second".
     */
    expect(
      valueInputs().map((input: HTMLInputElement): string => {
        return input.value;
      }),
    ).toEqual(["second"]);
    expect(lastRule(onChange).filters).toEqual([titleContains("second")]);
    expect(lastRule(onChange).filterCondition).toBe(FilterCondition.Any);
  });

  test("edits the condition that is left, not the deleted one", async () => {
    const { onChange, user } = await renderConditions(
      ruleWith(
        [titleContains("first"), titleContains("second")],
        FilterCondition.All,
      ),
    );

    await user.click(
      screen.getAllByRole("button", { name: "Delete Filter" })[0]!,
    );
    await settle();

    fireEvent.change(valueInputs()[0]!, { target: { value: "second-edited" } });
    await settle();

    expect(lastRule(onChange).filters).toEqual([
      titleContains("second-edited"),
    ]);
  });
});

describe("a saved rule", () => {
  test("with one condition and Any keeps Any while nothing asks for it", async () => {
    const { onChange } = await renderConditions(
      ruleWith([titleContains("database")], FilterCondition.Any),
    );

    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    fireEvent.change(valueInputs()[0]!, { target: { value: "postgres" } });
    await settle();

    expect(lastRule(onChange).filters).toEqual([titleContains("postgres")]);
    expect(lastRule(onChange).filterCondition).toBe(FilterCondition.Any);
  });

  test("with one condition and Any opens on Any once a second is added", async () => {
    const { user } = await renderConditions(
      ruleWith([titleContains("database")], FilterCondition.Any),
    );

    await addCondition(user);

    expect(await screen.findByRole("radio", { name: "Any" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked();
  });

  test("with three conditions asks, on what it holds", async () => {
    await renderConditions(
      ruleWith(
        [titleContains("a"), titleContains("b"), titleContains("c")],
        FilterCondition.Any,
      ),
    );

    expect(await screen.findByRole("radio", { name: "Any" })).toBeChecked();
  });
});
