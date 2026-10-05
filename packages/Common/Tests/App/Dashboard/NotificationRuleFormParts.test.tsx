import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NotificationRuleForm draws one half of a workspace notification rule: the
 * Conditions (when it fires) or the Destination (where it posts), each on
 * its own step of the rule wizard.
 *
 * It also has to start from the rule it is handed. It used to be handed the
 * rule only as `values`, and BasicForm starts from its initialValues - so it
 * opened empty, drawing a saved rule's switches off, and the first change
 * sent back only the switches, dropping everything else in the rule. With
 * the rule split over two steps, that would lose the conditions the moment a
 * destination was picked.
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
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

const SAVED_RULE: IncidentNotificationRule = {
  _type: "IncidentNotificationRule",
  filterCondition: FilterCondition.All,
  filters: [
    {
      checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
      conditionType: ConditionType.Contains,
      value: "database",
    },
    {
      checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
      conditionType: ConditionType.Contains,
      value: "postgres",
    },
  ],
  shouldCreateNewChannel: true,
  newChannelTemplateName: "oneuptime-incident-",
  shouldPostToExistingChannel: false,
  existingChannelNames: "",
  inviteTeamsToNewChannel: [],
  inviteUsersToNewChannel: [],
  shouldInviteOwnersToNewChannel: false,
  archiveChannelAutomatically: false,
  shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
} as IncidentNotificationRule;

async function renderPart(data: {
  part: NotificationRuleFormPart;
  value?: IncidentNotificationRule | undefined;
  workspaceType?: WorkspaceType | undefined;
  onChange?: MockFunction | undefined;
}): Promise<MockFunction> {
  const onChange: MockFunction = data.onChange || getJestMockFunction();

  await act(async (): Promise<void> => {
    render(
      <NotificationRuleForm
        part={data.part}
        value={data.value}
        onChange={(value: IncidentNotificationRule) => {
          onChange(value);
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
        workspaceType={data.workspaceType || WorkspaceType.Slack}
        teams={[]}
        users={[]}
      />,
    );
  });

  await settle();

  return onChange;
}

/*
 * Each half of the rule is a BasicForm of its own, and BasicForm hands a
 * change up only once its initial values have settled - in an effect that
 * runs after its fields are drawn. A click that lands between the two is
 * kept by the half and never reaches the rule. A person cannot click that
 * fast; a test on a loaded CI runner can, so it lets the effects run first.
 */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

afterEach(() => {
  cleanup();
});

describe("the Conditions half", () => {
  test("asks for the conditions, and nothing about where to post", async () => {
    await renderPart({ part: NotificationRuleFormPart.Conditions });

    expect(
      await screen.findByRole("button", { name: "Add Condition" }),
    ).toBeVisible();
    // No conditions yet: nothing to combine, so no All / Any.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  test("asks All or Any, under the conditions, once there are two", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Conditions,
      value: SAVED_RULE,
    });

    const all: HTMLElement = await screen.findByRole("radio", { name: "All" });
    const any: HTMLElement = screen.getByRole("radio", { name: "Any" });

    expect(all).toBeVisible();
    expect(any).toBeVisible();
    // All first, as everywhere else the choice is offered.
    expect(
      all.compareDocumentPosition(any) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Below the conditions and their Add Condition button.
    expect(
      screen
        .getByRole("button", { name: "Add Condition" })
        .compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: /^Match Condition/ }),
    ).toBeVisible();
  });

  test("opens on a saved rule's match", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Conditions,
      value: SAVED_RULE,
    });

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    });
  });

  test("keeps the destination when the match changes", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Conditions,
      value: SAVED_RULE,
    });

    await userEvent
      .setup({ delay: null })
      .click(await screen.findByRole("radio", { name: "Any" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const changed: IncidentNotificationRule = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as IncidentNotificationRule;

    expect(changed.filterCondition).toBe(FilterCondition.Any);
    expect(changed.filters).toEqual(SAVED_RULE.filters);
    expect(changed.shouldCreateNewChannel).toBe(true);
    expect(changed.newChannelTemplateName).toBe("oneuptime-incident-");
  });
});

describe("the Destination half", () => {
  test("asks where to post, and nothing about the conditions", async () => {
    await renderPart({ part: NotificationRuleFormPart.Destination });

    expect(
      await screen.findByRole("switch", {
        name: /^Post to Existing Slack Channel/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("switch", { name: /^Create Slack Channel/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add Condition" }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  test("offers a Microsoft Teams chat too", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(
      await screen.findByRole("switch", {
        name: /^Post to Existing Microsoft Teams Chat/,
      }),
    ).toBeVisible();
  });

  // The bug the seeding fixes: a saved rule's switches drawn off.
  test("opens on a saved rule's destination", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /^Create Slack Channel/ }),
      ).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByPlaceholderText("oneuptime-incident-")).toHaveValue(
      "oneuptime-incident-",
    );
  });

  test("keeps the conditions when a destination is picked", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    await userEvent.setup({ delay: null }).click(
      await screen.findByRole("switch", {
        name: /^Post to Existing Slack Channel/,
      }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const changed: IncidentNotificationRule = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as IncidentNotificationRule;

    expect(changed.shouldPostToExistingChannel).toBe(true);
    expect(changed.filters).toEqual(SAVED_RULE.filters);
    expect(changed.filterCondition).toBe(FilterCondition.All);
    expect(changed.shouldCreateNewChannel).toBe(true);
  });
});
