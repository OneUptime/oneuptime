import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NotificationRuleForm draws one half of a workspace notification rule: the
 * Conditions (which records it is for) or the Destination (where it posts,
 * and who joins the channel it creates), each on its own step of the rule
 * wizard.
 *
 * It also has to start from the rule it is handed. It used to be handed the
 * rule only as `values`, and BasicForm starts from its initialValues - so it
 * opened empty, drawing a saved rule's switches off, and the first change
 * sent back only the switches, dropping everything else in the rule. With
 * the rule split over two steps, that would lose the conditions the moment a
 * destination was picked.
 *
 * Who joins the channel is the people the record has, each kind as its own
 * box - on-call responders as they are paged, the Incident Commander and the
 * other incident roles as they are assigned, owners as they are added - and
 * anybody the rule names. A rule saved before incident roles had a box of
 * their own shows the box as the rule acts: ticked when it adds the owners
 * or the people paged, which is how the customer's rule now gets its
 * commander into the channel.
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
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";

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

const ON_CALL_BOX: RegExp = /^On-call responders, as they are paged/;
const ROLES_BOX: RegExp =
  /^Incident Commander and other incident roles, as they are assigned/;
const OWNERS_BOX: RegExp = /^Owners, as they are added/;

const OPS_TEAM: MicrosoftTeamsTeam = {
  id: "team-ops",
  name: "Ops",
} as MicrosoftTeamsTeam;

const LEADS_CHAT: MicrosoftTeamsChat = {
  id: "chat-leads",
  name: "On-call leads",
  chatType: "groupChat",
} as MicrosoftTeamsChat;

const ALICE_CHAT: MicrosoftTeamsChat = {
  id: "chat-alice",
  name: "Alice Smith",
  chatType: "personal",
} as MicrosoftTeamsChat;

// a comes before b in the page, as a reader meets them.
function isBefore(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

async function renderPart(data: {
  part: NotificationRuleFormPart;
  value?: IncidentNotificationRule | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
  onChange?: MockFunction | undefined;
  microsoftTeamsChats?: Array<MicrosoftTeamsChat> | undefined;
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
        eventType={data.eventType || NotificationRuleEventType.Incident}
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
        microsoftTeamsTeams={[OPS_TEAM]}
        microsoftTeamsChats={data.microsoftTeamsChats || []}
        numberPrefixes={{
          [NotificationRuleEventType.Incident]: "INC-",
          [NotificationRuleEventType.Alert]: "ALT-",
          [NotificationRuleEventType.IncidentEpisode]: "IE-",
          [NotificationRuleEventType.AlertEpisode]: "AE-",
          [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
        }}
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

function lastChange(onChange: MockFunction): IncidentNotificationRule {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as IncidentNotificationRule;
}

// What the box under the step says the rule does, one sentence a line.
function summary(): Array<string> {
  return within(screen.getByTestId("notification-rule-summary"))
    .queryAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("the Conditions half", () => {
  test("asks which incidents - all of them, or only those that match conditions - and nothing about where to post", async () => {
    await renderPart({ part: NotificationRuleFormPart.Conditions });

    // A new rule is for every incident, and its answer says so.
    expect(
      await screen.findByRole("radio", { name: "All incidents" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", {
        name: "Only incidents that match conditions",
      }),
    ).not.toBeChecked();
    // No condition waits to be filled in, and the old line is gone.
    expect(
      screen.queryByRole("button", { name: "Add Condition" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-rule-no-conditions-yet"),
    ).not.toBeInTheDocument();
    // The two answers only: nothing to combine, so no All / Any.
    expect(screen.queryAllByRole("radio")).toHaveLength(2);
    expect(
      screen.queryByRole("radiogroup", { name: /^Match Condition/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  test("'Only incidents that match conditions' opens one condition, keeping the rule's destination", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Conditions,
    });

    await userEvent.setup({ delay: null }).click(
      await screen.findByRole("radio", {
        name: "Only incidents that match conditions",
      }),
    );

    await waitFor(() => {
      expect(lastChange(onChange).filters).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: "Add Condition" })).toBeVisible();
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
    // With conditions, the line that says there are none is gone.
    expect(
      screen.queryByTestId("notification-rule-no-conditions-yet"),
    ).not.toBeInTheDocument();
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

    const changed: IncidentNotificationRule = lastChange(onChange);

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
        name: /^Post to existing channels/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("switch", {
        name: /^Create a channel for each incident/,
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add Condition" }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    // Nothing picked yet: the box under the step says what is to pick.
    expect(screen.getByTestId("notification-rule-summary")).toHaveTextContent(
      "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
    );
  });

  test("offers a Microsoft Teams chat too", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(
      await screen.findByRole("switch", { name: /^Post to chats/ }),
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
        screen.getByRole("switch", {
          name: /^Create a channel for each incident/,
        }),
      ).toHaveAttribute("aria-checked", "true");
    });

    // The prefix is rarely needed: folded under More fields, value kept.
    expect(screen.getByTestId("channel-name-prefix")).not.toBeVisible();
    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole("button", { name: "More fields" }));
    expect(
      screen.getByRole("textbox", { name: /^Channel Name Prefix/ }),
    ).toHaveValue("oneuptime-incident-");
  });

  test("keeps the conditions when a destination is picked", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    await userEvent.setup({ delay: null }).click(
      await screen.findByRole("switch", {
        name: /^Post to existing channels/,
      }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const changed: IncidentNotificationRule = lastChange(onChange);

    expect(changed.shouldPostToExistingChannel).toBe(true);
    expect(changed.filters).toEqual(SAVED_RULE.filters);
    expect(changed.filterCondition).toBe(FilterCondition.All);
    expect(changed.shouldCreateNewChannel).toBe(true);
    // The people picker's own key is the form's, never the rule's.
    expect(Object.keys(changed)).not.toContain("alsoInviteToNewChannel");
    expect(Object.keys(changed)).not.toContain("teamsWhoJoinsNote");
  });

  test("says what the rule does, as sentences, under the step", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: {
        ...SAVED_RULE,
        newChannelTemplateName: "",
        shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        shouldInviteIncidentRolesToNewChannel: true,
        shouldInviteOwnersToNewChannel: true,
        archiveChannelAutomatically: true,
        shouldPostToExistingChannel: true,
        existingChannelNames: "#ops, #incidents",
      } as IncidentNotificationRule,
    });

    expect(
      screen.getByRole("heading", { name: "What this rule does" }),
    ).toBeVisible();
    expect(summary()).toEqual([
      "Creates a channel like #inc-42 for each incident.",
      "Invites on-call responders as they are paged, the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Archives the channel when the incident is resolved.",
      "Posts updates in #ops and #incidents.",
    ]);
  });
});

describe("who joins the channel a rule creates", () => {
  test("is asked only once the rule creates a channel", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: { ...SAVED_RULE, shouldCreateNewChannel: false },
    });

    await screen.findByRole("switch", { name: /^Post to existing channels/ });

    expect(
      screen.queryByRole("heading", { name: "Who joins the channel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: OWNERS_BOX }),
    ).not.toBeInTheDocument();
  });

  test("an incident's people: on-call responders, incident roles and owners, then anybody else", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    const heading: HTMLElement = await screen.findByRole("heading", {
      name: "Who joins the channel",
    });

    expect(heading).toBeVisible();
    expect(
      screen.getByText(
        "People are added as they join, not only when the channel is created. Someone without a connected Slack account is named in the channel instead.",
      ),
    ).toBeVisible();

    const boxes: Array<HTMLElement> = [
      screen.getByRole("checkbox", { name: ON_CALL_BOX }),
      screen.getByRole("checkbox", { name: ROLES_BOX }),
      screen.getByRole("checkbox", { name: OWNERS_BOX }),
    ];

    // In that order, after the heading.
    expect(
      heading.compareDocumentPosition(boxes[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      boxes[0]!.compareDocumentPosition(boxes[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      boxes[1]!.compareDocumentPosition(boxes[2]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("Everyone paged by an on-call policy."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The commander is usually assigned when someone first acknowledges the incident or changes its state.",
      ),
    ).toBeVisible();
    // Anybody else the rule names, people or teams, in one picker.
    expect(
      screen.getByRole("button", { name: /Add people or teams/ }),
    ).toBeVisible();
  });

  test("an alert has no incident roles; a monitor's channel gets its owners", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      eventType: NotificationRuleEventType.Alert,
      value: SAVED_RULE,
    });

    expect(
      await screen.findByRole("checkbox", { name: ON_CALL_BOX }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: OWNERS_BOX })).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: ROLES_BOX }),
    ).not.toBeInTheDocument();

    cleanup();

    await renderPart({
      part: NotificationRuleFormPart.Destination,
      eventType: NotificationRuleEventType.Monitor,
      value: SAVED_RULE,
    });

    expect(
      await screen.findByRole("checkbox", { name: OWNERS_BOX }),
    ).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: ON_CALL_BOX }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: ROLES_BOX }),
    ).not.toBeInTheDocument();
  });

  /*
   * The customer's rule: "Automatically Invite On Call Users to New Slack
   * Channel" on, saved before incident roles had a box. It adds the people
   * given a role too now, so the commander assigned at acknowledgement
   * joins - and the box says so.
   */
  test("the customer's on-call rule shows the incident roles box ticked, as it now acts", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: {
        ...SAVED_RULE,
        shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
      } as IncidentNotificationRule,
    });

    expect(
      await screen.findByRole("checkbox", { name: ON_CALL_BOX }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: ROLES_BOX })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: OWNERS_BOX }),
    ).not.toBeChecked();
    expect(summary()).toContain(
      "Invites on-call responders as they are paged and the Incident Commander and other incident roles as they are assigned.",
    );
  });

  test("a saved rule that invites nobody shows every box empty, and says so", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    for (const box of [ON_CALL_BOX, ROLES_BOX, OWNERS_BOX]) {
      expect(
        await screen.findByRole("checkbox", { name: box }),
      ).not.toBeChecked();
    }

    expect(summary()).toContain(
      "Invites nobody to the channel: add people to it yourself.",
    );
  });

  // Once the rule is saved again, it says out loud what it did quietly.
  test("a change saves the incident roles box as the rule acted on it", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: {
        ...SAVED_RULE,
        shouldInviteOwnersToNewChannel: true,
      } as IncidentNotificationRule,
    });

    await userEvent.setup({ delay: null }).click(
      await screen.findByRole("switch", {
        name: /^Archive the channel when the incident is resolved/,
      }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const changed: IncidentNotificationRule = lastChange(onChange);

    expect(changed.archiveChannelAutomatically).toBe(true);
    expect(changed.shouldInviteIncidentRolesToNewChannel).toBe(true);
    expect(changed.shouldInviteOwnersToNewChannel).toBe(true);
  });

  test("unticking incident roles keeps the commander out, and is saved", async () => {
    const onChange: MockFunction = await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: {
        ...SAVED_RULE,
        shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        shouldInviteIncidentRolesToNewChannel: true,
      } as IncidentNotificationRule,
    });

    await userEvent
      .setup({ delay: null })
      .click(await screen.findByRole("checkbox", { name: ROLES_BOX }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const changed: IncidentNotificationRule = lastChange(onChange);

    expect(changed.shouldInviteIncidentRolesToNewChannel).toBe(false);
    expect(changed.shouldAutomaticallyInviteOnCallUsersToNewChannel).toBe(true);
  });

  /*
   * Microsoft Teams shows a team's channels to everybody in the team:
   * OneUptime adds nobody one by one there, so the step says who sees the
   * channel instead of asking who joins it. Nor can OneUptime archive a
   * Teams channel, so there is no switch for it.
   */
  test("Microsoft Teams: a note in place of the boxes, and no archive switch", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
      value: {
        ...SAVED_RULE,
        teamToCreateChannelIn: "team-ops",
        archiveChannelAutomatically: true,
      } as IncidentNotificationRule,
    });

    expect(await screen.findByTestId("who-joins-teams-note")).toHaveTextContent(
      "Everyone in the team can open the channel: Microsoft Teams shows a team's channels to all of its members.",
    );
    /*
     * Under the same heading as Slack's section, drawn the same way: it was
     * a field label there, smaller than Slack's heading over the same thing.
     */
    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Who joins the channel",
    });

    expect(heading.tagName).toBe("H3");
    expect(isBefore(heading, screen.getByTestId("who-joins-teams-note"))).toBe(
      true,
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("switch", { name: /^Archive the channel/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add people or teams/ }),
    ).not.toBeInTheDocument();
    // The channel's name as Teams shows it: no #.
    expect(summary()).toEqual([
      "Creates a channel like oneuptime-incident-inc-42 for each incident.",
      "Everyone in Ops can open the channel.",
    ]);
  });
});

describe("the Destination step, as a reader meets it", () => {
  /*
   * The prefix of the channel's name is the channel's: its More fields fold
   * sits with the channel's switches, above the Who joins the channel
   * heading - not at the end of the step, where it read as one more thing
   * about who joins.
   */
  test("the channel's More fields fold comes before who joins it", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      value: SAVED_RULE,
    });

    const archive: HTMLElement = await screen.findByRole("switch", {
      name: /^Archive the channel when the incident is resolved/,
    });
    const moreFields: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });
    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Who joins the channel",
    });

    expect(
      isBefore(
        screen.getByRole("switch", {
          name: /^Create a channel for each incident/,
        }),
        archive,
      ),
    ).toBe(true);
    expect(isBefore(archive, moreFields)).toBe(true);
    expect(isBefore(moreFields, heading)).toBe(true);
    expect(
      isBefore(heading, screen.getByRole("checkbox", { name: ON_CALL_BOX })),
    ).toBe(true);
    // Nothing of the channel's name after who joins.
    expect(
      isBefore(
        screen.getByRole("button", { name: /Add people or teams/ }),
        moreFields,
      ),
    ).toBe(false);
  });

  test("Microsoft Teams: each team and chat list says what to pick", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
      microsoftTeamsChats: [LEADS_CHAT, ALICE_CHAT],
      value: {
        ...SAVED_RULE,
        shouldPostToExistingChannel: true,
        shouldPostToExistingChat: true,
      } as IncidentNotificationRule,
    });

    // The posting team and the channel's team, each empty until picked.
    expect(await screen.findAllByText("Select a team")).toHaveLength(2);
    expect(screen.getByText("Select chats")).toBeVisible();
    // Which chats are listed, and what to do about a missing or old one.
    expect(
      screen.getByText(
        "Chats the OneUptime app was added to in Microsoft Teams. Wrong names? Click Refresh Chats in Project Settings > Workspace > Microsoft Teams.",
      ),
    ).toBeVisible();
  });

  test("Microsoft Teams without a chat says how to connect one", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
      value: {
        ...SAVED_RULE,
        shouldPostToExistingChat: true,
      } as IncidentNotificationRule,
    });

    expect(
      await screen.findByText(
        "No chats are connected yet. In Microsoft Teams, add the OneUptime app to the chat you want to post to, and it appears here.",
      ),
    ).toBeVisible();
  });

  // One chat is one chat: "in the chats On-call leads" read as several.
  test("the summary names one chat as one, and several as several", async () => {
    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
      microsoftTeamsChats: [LEADS_CHAT, ALICE_CHAT],
      value: {
        ...SAVED_RULE,
        shouldCreateNewChannel: false,
        shouldPostToExistingChat: true,
        existingChatIds: [LEADS_CHAT.id],
      } as IncidentNotificationRule,
    });

    expect(summary()).toEqual(["Posts updates in the chat On-call leads."]);

    cleanup();

    await renderPart({
      part: NotificationRuleFormPart.Destination,
      workspaceType: WorkspaceType.MicrosoftTeams,
      microsoftTeamsChats: [LEADS_CHAT, ALICE_CHAT],
      value: {
        ...SAVED_RULE,
        shouldCreateNewChannel: false,
        shouldPostToExistingChat: true,
        existingChatIds: [LEADS_CHAT.id, ALICE_CHAT.id],
      } as IncidentNotificationRule,
    });

    expect(summary()).toEqual([
      "Posts updates in the chats On-call leads and Alice Smith.",
    ]);
  });
});
