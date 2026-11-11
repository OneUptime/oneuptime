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
 * A notification rule of a project whose Mattermost bot is a member of two
 * or more teams of its server (MattermostTeams, GitHub issue #6747): the
 * rule says which team its channels are in - the channel it creates, and
 * the channels it posts in - or leaves it empty for the project's default
 * team. The pickers are optional: a rule written before, or by somebody
 * who does not care, keeps working in the default team.
 *
 * A bot in one team has nothing to pick, and the form shows no picker.
 * Slack's workspaces and Microsoft Teams' teams are their own rules'.
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
  NotificationRuleSummaryInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  MattermostConnectionTeam,
  SlackOrganizationWorkspace,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

// The default team first, as GET /mattermost/connected-teams lists them.
const ENGINEERING: MattermostConnectionTeam = {
  id: "e".repeat(26),
  name: "engineering",
  displayName: "Engineering",
};
const SUPPORT: MattermostConnectionTeam = {
  id: "s".repeat(26),
  name: "support",
  displayName: "Support",
};

const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };
const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };

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
  existingChannelNames: "incidents,town-square",
} as IncidentNotificationRule;

// Optional: a rule may leave it to the default team.
const MATTERMOST_TEAM_LABEL: string = "Mattermost team (Optional)";
const DEFAULT_TEAM_PLACEHOLDER: string = "Default team";

// The rule wizard holds the rule and hands each change back as the form's value.
function ControlledDestination(props: {
  value: IncidentNotificationRule;
  workspaceType: WorkspaceType;
  mattermostTeams?: Array<MattermostConnectionTeam> | undefined;
  slackWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
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
      microsoftTeamsTeams={[]}
      microsoftTeamsChats={[]}
      slackWorkspaces={props.slackWorkspaces}
      mattermostTeams={props.mattermostTeams}
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
  mattermostTeams?: Array<MattermostConnectionTeam> | undefined;
  slackWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
}): Promise<MockFunction> {
  const onChange: MockFunction = getJestMockFunction();

  await act(async (): Promise<void> => {
    render(
      <ControlledDestination
        value={data.value}
        workspaceType={data.workspaceType || WorkspaceType.Mattermost}
        mattermostTeams={data.mattermostTeams}
        slackWorkspaces={data.slackWorkspaces}
        onChange={onChange}
      />,
    );
  });

  await settle();

  return onChange;
}

// BasicForm hands a change up once its initial values have settled.
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

function fieldLabels(): Array<string> {
  return Array.from(document.querySelectorAll("label")).map(
    (label: HTMLLabelElement): string => {
      return (label.textContent || "").trim();
    },
  );
}

// The dropdown showing this placeholder, opened.
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

describe("a Mattermost rule picks the team of its channels", () => {
  test("creating a channel: an optional Mattermost team, empty for the default one, with the bot's teams", async () => {
    await renderDestination({
      value: CREATES_CHANNEL,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(fieldLabels()).toContain(MATTERMOST_TEAM_LABEL);
    // Neither Microsoft Teams' words nor Slack's.
    expect(fieldLabels()).not.toContain("Team");
    expect(screen.queryByText("Select a team")).not.toBeInTheDocument();
    expect(fieldLabels()).not.toContain("Slack workspace (Optional)");

    expect(
      screen.getByText(
        "The team the channel is created in. Leave it empty to use the default team.",
      ),
    ).toBeVisible();
    expect(screen.getAllByText(DEFAULT_TEAM_PLACEHOLDER)).toHaveLength(1);

    openDropdownShowing(DEFAULT_TEAM_PLACEHOLDER);

    expect(optionNames()).toEqual(["Engineering", "Support"]);

    // Left empty, the summary names no team: the default is used.
    expect(summary().join(" ")).not.toContain(" team.");
  });

  test("picking a team keeps its id on the rule, and the summary names it", async () => {
    const onChange: MockFunction = await renderDestination({
      value: CREATES_CHANNEL,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    openDropdownShowing(DEFAULT_TEAM_PLACEHOLDER);

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("option").find((option: HTMLElement) => {
          return option.textContent === "Support";
        })!,
      );
    });

    await settle();

    expect(lastChange(onChange).teamToCreateChannelIn).toBe(SUPPORT.id);
    expect(lastChange(onChange).shouldCreateNewChannel).toBe(true);
    expect(lastChange(onChange).newChannelTemplateName).toBe(
      "oneuptime-incident-",
    );
    expect(summary()).toContain("The channel is created in the Support team.");
  });

  test("a saved rule opens on its team, by name", async () => {
    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: ENGINEERING.id,
      } as IncidentNotificationRule,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(
      document.querySelector(".ou-select__single-value")?.textContent,
    ).toBe("Engineering");
    expect(summary()).toContain(
      "The channel is created in the Engineering team.",
    );
  });

  test("posting in channels it names: the team they are in, the default looked in first when empty", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        existingTeam: SUPPORT.id,
      } as IncidentNotificationRule,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(fieldLabels()).toContain(MATTERMOST_TEAM_LABEL);
    expect(
      screen.getByText(
        "The team these channels are in. Leave it empty to look in the default team first, then in the others.",
      ),
    ).toBeVisible();
    expect(
      document.querySelector(".ou-select__single-value")?.textContent,
    ).toBe("Support");

    const sentences: Array<string> = summary();
    const postsIndex: number = sentences.findIndex((sentence: string) => {
      return sentence.startsWith("Posts updates in");
    });

    expect(postsIndex).toBeGreaterThanOrEqual(0);
    // Right after the sentence naming the channels.
    expect(sentences[postsIndex + 1]).toBe(
      "Those channels are in the Support team.",
    );
  });

  test("both: a picker for each", async () => {
    await renderDestination({
      value: {
        ...POSTS_IN_CHANNELS,
        shouldCreateNewChannel: true,
      } as IncidentNotificationRule,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(
      fieldLabels().filter((label: string) => {
        return label === MATTERMOST_TEAM_LABEL;
      }),
    ).toHaveLength(2);
    expect(screen.getAllByText(DEFAULT_TEAM_PLACEHOLDER)).toHaveLength(2);
  });

  test("a team the bot is no longer in is not named: the summary says nothing rather than an id", async () => {
    const gone: string = "g".repeat(26);

    await renderDestination({
      value: {
        ...CREATES_CHANNEL,
        teamToCreateChannelIn: gone,
      } as IncidentNotificationRule,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(summary().join(" ")).not.toContain(gone);
    expect(summary().join(" ")).not.toContain("is created in the");
  });
});

describe("nothing to pick: no picker", () => {
  test("a bot in one team", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
      mattermostTeams: [ENGINEERING],
    });

    expect(fieldLabels()).not.toContain(MATTERMOST_TEAM_LABEL);
    expect(
      screen.queryByText(DEFAULT_TEAM_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  test("teams not read: as before, no picker", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
    });

    expect(fieldLabels()).not.toContain(MATTERMOST_TEAM_LABEL);
  });

  test("a Slack rule never shows Mattermost's teams, nor a Mattermost rule Slack's workspaces", async () => {
    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
      workspaceType: WorkspaceType.Slack,
      mattermostTeams: [ENGINEERING, SUPPORT],
    });

    expect(fieldLabels()).not.toContain(MATTERMOST_TEAM_LABEL);
    expect(
      screen.queryByText(DEFAULT_TEAM_PLACEHOLDER),
    ).not.toBeInTheDocument();

    cleanup();

    await renderDestination({
      value: { ...POSTS_IN_CHANNELS, shouldCreateNewChannel: true },
      mattermostTeams: [ENGINEERING],
      slackWorkspaces: [EAST, WEST],
    });

    expect(fieldLabels()).not.toContain("Slack workspace (Optional)");
    expect(screen.queryByText("Default workspace")).not.toBeInTheDocument();
  });
});

describe("the sentences that name a Mattermost team", () => {
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
      workspaceType: WorkspaceType.Mattermost,
      translator: ENGLISH,
      exampleChannelName: "~inc-42",
      userNames: [],
      teamNames: [],
      chatNames: [],
      ...input,
    });
  }

  test("the channel it creates, and the channels it posts in, each where it belongs", () => {
    const said: Array<string> = sentences({
      channelMattermostTeamName: "Engineering",
      existingChannelsMattermostTeamName: "Support",
    });

    const created: number = said.indexOf(
      "The channel is created in the Engineering team.",
    );
    const postsIn: number = said.findIndex((sentence: string) => {
      return sentence.startsWith("Posts updates in");
    });

    expect(created).toBeGreaterThan(0);
    expect(created).toBeLessThan(postsIn);
    expect(said[postsIn + 1]).toBe("Those channels are in the Support team.");
  });

  test("no team named, no sentence about one", () => {
    expect(sentences({}).join(" ")).not.toContain(" team.");
  });

  test("a rule that posts nowhere says nothing of the team of channels it does not post in", () => {
    expect(
      sentences({
        rule: CREATES_CHANNEL,
        existingChannelsMattermostTeamName: "Support",
      }).join(" "),
    ).not.toContain("Support");
  });

  test("Mattermost's channels are never said to be in a Slack workspace, nor Slack's in a Mattermost team", () => {
    expect(
      sentences({
        channelWorkspaceName: "Acme East",
        existingChannelsWorkspaceName: "Acme West",
      }).join(" "),
    ).not.toContain("workspace.");

    expect(
      sentences({
        workspaceType: WorkspaceType.Slack,
        channelMattermostTeamName: "Engineering",
        existingChannelsMattermostTeamName: "Support",
      }).join(" "),
    ).not.toContain(" team.");
  });
});
