import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A notification rule of a project whose Slack connection is OneUptime
 * installed for a whole Slack Enterprise organization (SlackOrganization),
 * added to two or more of its workspaces: the rule says which workspace
 * its channels are in - the channel it creates, and the channels it posts
 * in - or leaves it empty for the organization's default workspace. The
 * pickers are Microsoft Teams' team pickers, under Slack's own words, and
 * optional: a rule written before, or by somebody who does not care, keeps
 * working in the default workspace.
 *
 * A project connected to one Slack workspace - or to an organization with
 * only one workspace OneUptime was added to - has nothing to pick, and sees
 * no picker. Microsoft Teams' rules still pick their team, as before.
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
import {
  getNotificationRuleSummary,
  getRuleWorkspacesNotAdded,
  NotificationRuleSummaryInput,
  SlackRuleWorkspaces,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import { NotificationRuleThen } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewElement";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  MicrosoftTeamsTeam,
  SlackOrganizationWorkspace,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };

const OPS_TEAM: MicrosoftTeamsTeam = {
  id: "team-ops",
  name: "Ops",
} as MicrosoftTeamsTeam;

// A rule that creates a channel for each incident, and posts nowhere else.
const CREATES_CHANNEL: IncidentNotificationRule = {
  _type: "IncidentNotificationRule",
  filterCondition: FilterCondition.All,
  filters: [],
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

// A rule that posts in two channels it names, and creates none.
const POSTS_IN_CHANNELS: IncidentNotificationRule = {
  ...CREATES_CHANNEL,
  shouldCreateNewChannel: false,
  shouldPostToExistingChannel: true,
  existingChannelNames: "incidents,ops",
} as IncidentNotificationRule;

// Optional: a rule may leave it to the default workspace.
const SLACK_WORKSPACE_LABEL: string = "Slack workspace (Optional)";
const DEFAULT_WORKSPACE_PLACEHOLDER: string = "Default workspace";

/*
 * The rule wizard holds the rule and hands each change back as the form's
 * value - the summary under the step reads it from there - so the test
 * does too.
 */
function ControlledDestination(props: {
  value: IncidentNotificationRule;
  workspaceType: WorkspaceType;
  slackWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
  slackOrganization?: SlackRuleWorkspaces | undefined;
  onChange: MockFunction;
}): React.ReactElement {
  const [value, setValue] = React.useState<IncidentNotificationRule>(
    props.value,
  );

  return (
    <NotificationRuleForm
      part={NotificationRuleFormPart.Destination}
      value={value}
      onChange={(changed: IncidentNotificationRule) => {
        props.onChange(changed);
        setValue(changed);
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
      workspaceType={props.workspaceType}
      teams={[]}
      users={[]}
      microsoftTeamsTeams={[OPS_TEAM]}
      microsoftTeamsChats={[]}
      slackWorkspaces={props.slackWorkspaces}
      slackOrganization={props.slackOrganization}
      numberPrefixes={{
        [NotificationRuleEventType.Incident]: "INC-",
        [NotificationRuleEventType.Alert]: "ALT-",
        [NotificationRuleEventType.IncidentEpisode]: "IE-",
        [NotificationRuleEventType.AlertEpisode]: "AE-",
        [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
      }}
    />
  );
}

async function renderDestination(data: {
  value: IncidentNotificationRule;
  workspaceType?: WorkspaceType | undefined;
  slackWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
  slackOrganization?: SlackRuleWorkspaces | undefined;
  onChange?: MockFunction | undefined;
}): Promise<MockFunction> {
  const onChange: MockFunction = data.onChange || getJestMockFunction();

  await act(async (): Promise<void> => {
    render(
      <ControlledDestination
        value={data.value}
        workspaceType={data.workspaceType || WorkspaceType.Slack}
        slackWorkspaces={data.slackWorkspaces}
        slackOrganization={data.slackOrganization}
        onChange={onChange}
      />,
    );
  });

  await settle();

  return onChange;
}

/*
 * BasicForm hands a change up only once its initial values have settled,
 * in an effect that runs after its fields are drawn (NotificationRuleFormParts).
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

// Every field label the step draws.
function fieldLabels(): Array<string> {
  return Array.from(document.querySelectorAll("label")).map(
    (label: HTMLLabelElement): string => {
      return (label.textContent || "").trim();
    },
  );
}

/*
 * The field a placeholder sits in: its combobox, opened, and its options -
 * the dropdowns of a step are told apart by what they say while empty.
 */
function openDropdownShowing(placeholder: string, index: number = 0): void {
  const placeholderElement: HTMLElement =
    screen.getAllByText(placeholder)[index]!;

  const control: HTMLElement | null = placeholderElement.closest(
    ".ou-select__control",
  ) as HTMLElement | null;

  expect(control).not.toBeNull();

  fireEvent.keyDown(within(control!.parentElement!).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

function optionNames(): Array<string> {
  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

afterEach(() => {
  cleanup();
});

describe("a Slack organization's rule picks the workspace of its channels", () => {
  test("creating a channel: an optional Slack workspace, empty for the default one, with the organization's workspaces", async () => {
    await renderDestination({
      value: CREATES_CHANNEL,
      slackWorkspaces: [EAST, WEST],
    });

    expect(fieldLabels()).toContain(SLACK_WORKSPACE_LABEL);
    // Not Microsoft Teams' words.
    expect(fieldLabels()).not.toContain("Team");
    expect(screen.queryByText("Select a team")).not.toBeInTheDocument();

    expect(
      screen.getByText(
        "The workspace the channel is created in. Leave it empty to use the default workspace.",
      ),
    ).toBeVisible();
    expect(screen.getAllByText(DEFAULT_WORKSPACE_PLACEHOLDER)).toHaveLength(1);

    openDropdownShowing(DEFAULT_WORKSPACE_PLACEHOLDER);

    expect(optionNames()).toEqual(["Acme East", "Acme West"]);

    // Left empty, the summary names no workspace: the default is used.
    expect(summary().join(" ")).not.toContain("workspace.");
  });

  test("picking a workspace keeps it on the rule, and the summary names it", async () => {
    const onChange: MockFunction = await renderDestination({
      value: CREATES_CHANNEL,
      slackWorkspaces: [EAST, WEST],
    });

    openDropdownShowing(DEFAULT_WORKSPACE_PLACEHOLDER);

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("option").find((option: HTMLElement) => {
          return option.textContent === "Acme West";
        })!,
      );
    });

    await settle();

    expect(lastChange(onChange).teamToCreateChannelIn).toBe(WEST.id);
    // The rest of the rule is untouched.
    expect(lastChange(onChange).shouldCreateNewChannel).toBe(true);
    expect(lastChange(onChange).newChannelTemplateName).toBe(
      "oneuptime-incident-",
    );
    expect(summary()).toContain(
      "The channel is created in the Acme West workspace.",
    );
  });

  test("a saved rule opens on its workspace, by name", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: EAST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
    });

    expect(
      document.querySelector(".ou-select__single-value")?.textContent,
    ).toBe("Acme East");
    expect(summary()).toContain(
      "The channel is created in the Acme East workspace.",
    );
  });

  test("posting in channels it names: the workspace they are in, looked in first when empty", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        existingTeam: WEST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
    });

    expect(fieldLabels()).toContain(SLACK_WORKSPACE_LABEL);
    expect(
      screen.getByText(
        "The workspace these channels are in. Leave it empty to look in the default workspace first, then in the others.",
      ),
    ).toBeVisible();
    expect(
      document.querySelector(".ou-select__single-value")?.textContent,
    ).toBe("Acme West");

    const sentences: Array<string> = summary();
    const postsIndex: number = sentences.findIndex((sentence: string) => {
      return sentence.startsWith("Posts updates in");
    });

    expect(postsIndex).toBeGreaterThanOrEqual(0);
    // Right after the sentence naming the channels.
    expect(sentences[postsIndex + 1]).toBe(
      "Those channels are in the Acme West workspace.",
    );
  });

  test("both: a picker for each, told apart by what each is for", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
    });

    expect(
      fieldLabels().filter((label: string) => {
        return label === SLACK_WORKSPACE_LABEL;
      }),
    ).toHaveLength(2);
    expect(screen.getAllByText(DEFAULT_WORKSPACE_PLACEHOLDER)).toHaveLength(2);
  });

  test("a workspace no longer listed is not named: the summary says nothing rather than an id", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: "T0GONE",
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
    });

    expect(summary().join(" ")).not.toContain("T0GONE");
    expect(summary().join(" ")).not.toContain("is created in the");
  });
});

describe("nothing to pick: no picker", () => {
  test("a project connected to one Slack workspace", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
    });

    expect(fieldLabels()).not.toContain(SLACK_WORKSPACE_LABEL);
    expect(
      fieldLabels().some((label: string) => {
        return label.startsWith("Team") || label.startsWith("Slack workspace");
      }),
    ).toBe(false);
    expect(
      screen.queryByText(DEFAULT_WORKSPACE_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("an organization OneUptime was added to only one workspace of", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
      slackWorkspaces: [EAST],
    });

    expect(fieldLabels()).not.toContain(SLACK_WORKSPACE_LABEL);
    expect(
      screen.queryByText(DEFAULT_WORKSPACE_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("Microsoft Teams still picks its team, whatever Slack's workspaces", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
      workspaceType: WorkspaceType.MicrosoftTeams,
      slackWorkspaces: [EAST, WEST],
    });

    expect(screen.getAllByText("Select a team")).toHaveLength(2);
    // Required, as before: a Teams channel is always in a team.
    expect(
      fieldLabels().filter((label: string) => {
        return label === "Team";
      }),
    ).toHaveLength(2);
    expect(fieldLabels()).not.toContain(SLACK_WORKSPACE_LABEL);
    expect(
      screen.queryByText(DEFAULT_WORKSPACE_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });
});

describe("the sentences that name a Slack workspace", () => {
  // English, as written: no locale file read.
  const ENGLISH: Translator = createTranslator((): string | undefined => {
    return undefined;
  }, "en");

  function sentences(
    input: Partial<NotificationRuleSummaryInput>,
  ): Array<string> {
    return getNotificationRuleSummary({
      rule: {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
      } as IncidentNotificationRule,
      eventType: NotificationRuleEventType.Incident,
      workspaceType: WorkspaceType.Slack,
      translator: ENGLISH,
      exampleChannelName: "#inc-42",
      userNames: [],
      teamNames: [],
      chatNames: [],
      ...input,
    });
  }

  test("the channel it creates, and the channels it posts in", () => {
    const said: Array<string> = sentences({
      channelWorkspaceName: "Acme East",
      existingChannelsWorkspaceName: "Acme West",
    });

    expect(said).toContain(
      "The channel is created in the Acme East workspace.",
    );
    expect(said).toContain("Those channels are in the Acme West workspace.");

    /*
     * Each where it belongs: the channel's after its own sentence, the
     * posted-in channels' right after theirs.
     */
    const created: number = said.indexOf(
      "The channel is created in the Acme East workspace.",
    );
    const postsIn: number = said.findIndex((sentence: string) => {
      return sentence.startsWith("Posts updates in");
    });

    expect(created).toBeGreaterThan(0);
    expect(created).toBeLessThan(postsIn);
    expect(said[postsIn + 1]).toBe(
      "Those channels are in the Acme West workspace.",
    );
  });

  test("no workspace named, no sentence about one", () => {
    expect(sentences({}).join(" ")).not.toContain("workspace.");
  });

  test("a rule that posts nowhere says nothing of the workspace of channels it does not post in", () => {
    const said: Array<string> = sentences({
      rule: CREATES_CHANNEL,
      existingChannelsWorkspaceName: "Acme West",
    });

    expect(said.join(" ")).not.toContain("Acme West");
  });

  test("Microsoft Teams' channels are never said to be in a Slack workspace", () => {
    const said: Array<string> = sentences({
      workspaceType: WorkspaceType.MicrosoftTeams,
      rule: POSTS_IN_CHANNELS,
      existingChannelsWorkspaceName: "Acme West",
    });

    expect(said.join(" ")).not.toContain("Acme West workspace");
  });
});

/*
 * #6749: A WORKSPACE OF THE ORGANIZATION ONEUPTIME WAS REMOVED FROM.
 *
 * A rule that picks it does not post in another workspace instead: the
 * workspace decides who reads its messages. Its card says OneUptime is no
 * longer added to it - as the rule's Notification Logs and Test Rule say -
 * and its form still shows the pick, said to be so, so it can be changed:
 * even with one workspace left, when there is otherwise nothing to pick.
 */

const LAB: SlackOrganizationWorkspace = { id: "T0LAB", name: "Acme Lab" };

// Added to Acme East only now; removed from Acme West and Acme Lab.
const EAST_LEFT: SlackRuleWorkspaces = {
  workspaces: [EAST],
  removedWorkspaces: [WEST, LAB],
  organizationName: "Acme Corp",
};

const WEST_NOT_ADDED: string = "Acme West (OneUptime no longer added)";

function notAddedNote(workspace: string, organization: string): string {
  return `OneUptime is no longer added to the ${workspace} workspace of ${organization}. Add it again in Slack's organization settings, or pick another workspace on the rule.`;
}

// The value each dropdown of the step shows, top to bottom.
function shownValues(): Array<string> {
  return Array.from(document.querySelectorAll(".ou-select__single-value")).map(
    (value: Element): string => {
      return (value.textContent || "").trim();
    },
  );
}

// Opens the dropdown showing `text` as its value.
function openDropdownWithValue(text: string): void {
  const control: HTMLElement | null = screen
    .getByText(text)
    .closest(".ou-select__control") as HTMLElement | null;

  expect(control).not.toBeNull();

  fireEvent.keyDown(within(control!.parentElement!).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

describe("a rule that picks a workspace OneUptime is no longer added to: its form", () => {
  test("still shows the pick, said to be so - with one workspace left - and offers the ones it is added to", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: WEST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST],
      slackOrganization: EAST_LEFT,
    });

    expect(fieldLabels()).toContain(SLACK_WORKSPACE_LABEL);
    expect(shownValues()).toEqual([WEST_NOT_ADDED]);

    openDropdownWithValue(WEST_NOT_ADDED);

    // Acme Lab, removed too, is not the rule's pick: not offered.
    expect(optionNames()).toEqual(["Acme East", WEST_NOT_ADDED]);
  });

  test("changed to a workspace OneUptime is added to: kept on the rule, the picker still there to change it again", async () => {
    const onChange: MockFunction = await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: WEST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST],
      slackOrganization: EAST_LEFT,
    });

    openDropdownWithValue(WEST_NOT_ADDED);

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("option").find((option: HTMLElement) => {
          return option.textContent === "Acme East";
        })!,
      );
    });

    await settle();

    expect(lastChange(onChange).teamToCreateChannelIn).toBe(EAST.id);
    expect(lastChange(onChange).shouldCreateNewChannel).toBe(true);
    expect(fieldLabels()).toContain(SLACK_WORKSPACE_LABEL);
    expect(shownValues()).toEqual(["Acme East"]);
    expect(summary()).toContain(
      "The channel is created in the Acme East workspace.",
    );
  });

  test("posting in channels of such a workspace: that picker shows it too", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        existingTeam: LAB.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST],
      slackOrganization: EAST_LEFT,
    });

    expect(shownValues()).toEqual(["Acme Lab (OneUptime no longer added)"]);
  });

  test("a workspace whose name was never kept: its id, said to be no longer added", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: "T0GONE",
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
      slackOrganization: {
        workspaces: [EAST, WEST],
        removedWorkspaces: [],
        organizationName: "Acme Corp",
      },
    });

    expect(shownValues()).toEqual(["T0GONE (OneUptime no longer added)"]);
  });

  test("a rule whose workspaces OneUptime is added to: no such option", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: EAST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST, WEST],
      slackOrganization: {
        workspaces: [EAST, WEST],
        removedWorkspaces: [LAB],
        organizationName: "Acme Corp",
      },
    });

    openDropdownWithValue("Acme East");

    expect(optionNames()).toEqual(["Acme East", "Acme West"]);
  });

  test("one workspace left, and the rule picks it or none: no picker, as before", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: EAST.id,
      } as IncidentNotificationRule,
      slackWorkspaces: [EAST],
      slackOrganization: EAST_LEFT,
    });

    expect(fieldLabels()).not.toContain(SLACK_WORKSPACE_LABEL);
  });
});

describe("a rule that picks a workspace OneUptime is no longer added to: its card", () => {
  function renderThen(
    rule: IncidentNotificationRule,
    organization: SlackRuleWorkspaces | undefined,
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): void {
    render(
      <NotificationRuleThen
        rule={rule}
        eventType={NotificationRuleEventType.Incident}
        workspaceType={workspaceType}
        teams={[]}
        users={[]}
        slackWorkspaces={organization?.workspaces}
        slackOrganization={organization}
      />,
    );
  }

  function notes(): Array<string> {
    return screen
      .queryAllByTestId("notification-rule-slack-workspace-not-added")
      .map((note: HTMLElement): string => {
        return note.textContent || "";
      });
  }

  test("says so, by the workspace's name and the organization's, under what the rule does", () => {
    renderThen(
      { ...CREATES_CHANNEL, teamToCreateChannelIn: WEST.id },
      EAST_LEFT,
    );

    expect(notes()).toEqual([notAddedNote("Acme West", "Acme Corp")]);
    expect(screen.getByTestId("notification-rule-summary")).toBeVisible();
  });

  test("both of its picks in such a workspace: said once; in two of them: once for each", () => {
    renderThen(
      {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: WEST.id,
        existingTeam: WEST.id,
      } as IncidentNotificationRule,
      EAST_LEFT,
    );

    expect(notes()).toEqual([notAddedNote("Acme West", "Acme Corp")]);

    cleanup();

    renderThen(
      {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: WEST.id,
        existingTeam: LAB.id,
      } as IncidentNotificationRule,
      EAST_LEFT,
    );

    expect(notes()).toEqual([
      notAddedNote("Acme Lab", "Acme Corp"),
      notAddedNote("Acme West", "Acme Corp"),
    ]);
  });

  test("a workspace OneUptime is added to, none picked, or a pick the rule does not use: nothing said", () => {
    for (const rule of [
      { ...CREATES_CHANNEL, teamToCreateChannelIn: EAST.id },
      CREATES_CHANNEL,
      // Switched off: the channel it would create in Acme West is not created.
      {
        ...POSTS_IN_CHANNELS,
        existingTeam: EAST.id,
        teamToCreateChannelIn: WEST.id,
      },
    ] as Array<IncidentNotificationRule>) {
      renderThen(rule, EAST_LEFT);

      expect(notes()).toEqual([]);

      cleanup();
    }
  });

  test("a project connected to one workspace, or to Microsoft Teams: nothing said", () => {
    renderThen(
      { ...CREATES_CHANNEL, teamToCreateChannelIn: WEST.id },
      undefined,
    );

    expect(notes()).toEqual([]);

    cleanup();

    renderThen(
      { ...CREATES_CHANNEL, teamToCreateChannelIn: WEST.id },
      EAST_LEFT,
      WorkspaceType.MicrosoftTeams,
    );

    expect(notes()).toEqual([]);
  });
});

describe("getRuleWorkspacesNotAdded", () => {
  test("the rule's picks OneUptime is no longer added to, each once, by name - the id when no name was kept", () => {
    expect(
      getRuleWorkspacesNotAdded({
        rule: {
          ...POSTS_IN_CHANNELS,
          shouldCreateNewChannel: true,
          teamToCreateChannelIn: "T0GONE",
          existingTeam: WEST.id,
        } as IncidentNotificationRule,
        workspaceType: WorkspaceType.Slack,
        organization: EAST_LEFT,
      }),
    ).toEqual([WEST, { id: "T0GONE", name: "T0GONE" }]);
  });

  test("before Slack has listed the organization's workspaces: none - what OneUptime is added to is not known", () => {
    expect(
      getRuleWorkspacesNotAdded({
        rule: {
          ...CREATES_CHANNEL,
          teamToCreateChannelIn: WEST.id,
        } as IncidentNotificationRule,
        workspaceType: WorkspaceType.Slack,
        organization: {
          workspaces: [],
          removedWorkspaces: [],
          organizationName: "Acme Corp",
        },
      }),
    ).toEqual([]);
  });

  test("removed from every workspace: the picks are still said", () => {
    expect(
      getRuleWorkspacesNotAdded({
        rule: {
          ...CREATES_CHANNEL,
          teamToCreateChannelIn: WEST.id,
        } as IncidentNotificationRule,
        workspaceType: WorkspaceType.Slack,
        organization: {
          workspaces: [],
          removedWorkspaces: [WEST],
          organizationName: "Acme Corp",
        },
      }),
    ).toEqual([WEST]);
  });

  test("no rule, no organization, or not Slack: none", () => {
    const rule: IncidentNotificationRule = {
      ...CREATES_CHANNEL,
      teamToCreateChannelIn: WEST.id,
    } as IncidentNotificationRule;

    expect(
      getRuleWorkspacesNotAdded({
        rule: undefined,
        workspaceType: WorkspaceType.Slack,
        organization: EAST_LEFT,
      }),
    ).toEqual([]);
    expect(
      getRuleWorkspacesNotAdded({
        rule: rule,
        workspaceType: WorkspaceType.Slack,
        organization: undefined,
      }),
    ).toEqual([]);
    expect(
      getRuleWorkspacesNotAdded({
        rule: rule,
        workspaceType: WorkspaceType.MicrosoftTeams,
        organization: EAST_LEFT,
      }),
    ).toEqual([]);
  });
});
