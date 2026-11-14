import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor, within } from "@testing-library/react";
import React from "react";

/*
 * A WORKSPACE NOTIFICATION RULE'S CARD, AS THE RULES LIST DRAWS IT.
 *
 *   Rule Name        Acknowledged incidents
 *   Rule Description (only when the rule has one)
 *   Which incidents  Incident State  is any of  (Acknowledged)
 *   Then             - Creates a channel like #ack-inc-42 for each incident.
 *                    - Invites on-call responders as they are paged, ...
 *   Updates          (only when the rule leaves some updates out)
 *   Video Call       (only when the rule starts one)
 *
 * The rules list is a ModelTable shown as a list of cards, each card a row
 * per column (getNotificationRuleCardColumns). Drawn here through the real
 * BaseModelTable and its list, with the project's rules handed in.
 *
 * What it replaced: the rule's When and Then were a card of their own inside
 * a row with no name - Customize Columns listed a box with no name for it,
 * and its rows did not line up with the card's - and the channel's name was
 * said twice, in Then and in a Channel Name Prefix row. A rule without a
 * description showed "Rule Description" over nothing. Its conditions sat in
 * a framed box with a timeline's dots under "This rule runs when this
 * condition is met:", and its first row was labelled When, whose
 * translations are the "when?" of a time ("Wann", "タイミング").
 */

let isMasterAdminForTest: boolean = true;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

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

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  ShowAs,
} from "../../../UI/Components/ModelTable/BaseModelTable";
import Columns from "../../../UI/Components/ModelTable/Columns";
import { getColumnIds } from "../../../UI/Components/ModelTable/ColumnPreference";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  getNotificationRuleCardColumns,
  NOTIFICATION_RULE_CARD_COLUMN_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewElement";
import {
  MattermostRuleTeams,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
  SlackRuleWorkspaces,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import {
  MicrosoftTeamsTeam,
  SlackOrganizationWorkspace,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelNumberPrefixes } from "../../../Utils/Workspace/WorkspaceChannelName";

const TABLE_ID: string = "workspace-rule-cards";

// The list's cards are the children of its body (List: `${id}-body`).
const LIST_BODY_ID: string = "workspace-rule-cards-body";

const PREFIXES: WorkspaceChannelNumberPrefixes = {
  [NotificationRuleEventType.Incident]: "INC-",
  [NotificationRuleEventType.Alert]: "ALT-",
  [NotificationRuleEventType.IncidentEpisode]: "IE-",
  [NotificationRuleEventType.AlertEpisode]: "AE-",
  [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
};

const ACKNOWLEDGED_ID: string = "6a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const ZOOM_ID: string = "7b8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";

// A saved rule's switches, any of them changed.
function ruleJson(fields: Record<string, unknown>): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    inviteTeamsToNewChannel: [],
    inviteUsersToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    archiveChannelAutomatically: false,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
    ...fields,
  } as IncidentNotificationRule;
}

interface SavedRule {
  id: string;
  name: string;
  description?: string | undefined;
  rule: IncidentNotificationRule;
}

function acknowledged(): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = ACKNOWLEDGED_ID;
  state.name = "Acknowledged";

  return state;
}

function zoom(): VideoCallConnection {
  const connection: VideoCallConnection = new VideoCallConnection();
  connection._id = ZOOM_ID;
  connection.name = "Ops bridge";
  connection.provider = VideoCallProvider.Zoom;

  return connection;
}

function columnsFor(data: {
  eventType?: NotificationRuleEventType | undefined;
  workspaceType?: WorkspaceType | undefined;
  users?: Array<User> | undefined;
  teams?: Array<Team> | undefined;
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
  microsoftTeamsTeams?: Array<MicrosoftTeamsTeam> | undefined;
  canStartVideoCall?: boolean | undefined;
  slackWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
  slackOrganization?: SlackRuleWorkspaces | undefined;
  mattermostConnection?: MattermostRuleTeams | undefined;
}): Columns<WorkspaceNotificationRule> {
  return getNotificationRuleCardColumns({
    eventType: data.eventType || NotificationRuleEventType.Incident,
    workspaceType: data.workspaceType || WorkspaceType.Slack,
    canStartVideoCall: data.canStartVideoCall ?? true,
    monitors: [],
    labels: [],
    alertStates: [],
    alertSeverities: [],
    incidentSeverities: [],
    incidentStates: [acknowledged()],
    scheduledMaintenanceStates: [],
    monitorStatus: [],
    teams: data.teams || [],
    users: data.users || [],
    onCallSchedules: data.onCallSchedules || [],
    microsoftTeamsTeams: data.microsoftTeamsTeams || [],
    microsoftTeamsChats: [],
    slackWorkspaces: data.slackWorkspaces,
    slackOrganization: data.slackOrganization,
    mattermostTeams: data.mattermostConnection?.teams,
    mattermostConnection: data.mattermostConnection,
    videoCallConnections: [zoom()],
    numberPrefixes: PREFIXES,
    exampleRecordName: undefined,
  });
}

// The rules list, as the Slack or Microsoft Teams page draws it.
async function renderCards(
  rules: Array<SavedRule>,
  options: Parameters<typeof columnsFor>[0] = {},
): Promise<Array<HTMLElement>> {
  const rows: Array<JSONObject> = rules.map((saved: SavedRule): JSONObject => {
    return {
      _id: saved.id,
      name: saved.name,
      ...(saved.description !== undefined
        ? { description: saved.description }
        : {}),
      notificationRule: saved.rule as unknown as JSONObject,
    };
  });

  const callbacks: BaseTableCallbacks<WorkspaceNotificationRule> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): WorkspaceNotificationRule => {
      return item as unknown as WorkspaceNotificationRule;
    },
    getJSONFromModel: (item: WorkspaceNotificationRule): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<WorkspaceNotificationRule>> => {
      return {
        data: rows as unknown as Array<WorkspaceNotificationRule>,
        count: rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div />;
    },
  } as unknown as BaseTableCallbacks<WorkspaceNotificationRule>;

  const props: BaseModelTableProps<WorkspaceNotificationRule> = {
    modelType: WorkspaceNotificationRule,
    id: TABLE_ID,
    name: "Workspace Notification Rules",
    singularName: "Incident Notification Rule",
    pluralName: "Incident Notification Rules",
    userPreferencesKey: TABLE_ID,
    urlStateKey: TABLE_ID,
    columns: columnsFor(options),
    filters: [],
    isCreateable: false,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    showAs: ShowAs.List,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<WorkspaceNotificationRule>;

  render(<BaseModelTable<WorkspaceNotificationRule> {...props} />);

  await waitFor(() => {
    expect(
      document.getElementById(LIST_BODY_ID)?.children.length || 0,
    ).toBeGreaterThanOrEqual(rules.length);
  });

  return Array.from(document.getElementById(LIST_BODY_ID)!.children).filter(
    (child: Element): boolean => {
      return child.querySelectorAll("label").length > 0;
    },
  ) as Array<HTMLElement>;
}

// A card's rows, by the names over them, top to bottom.
function rowNames(card: HTMLElement): Array<string> {
  return Array.from(card.querySelectorAll("label")).map(
    (label: HTMLLabelElement): string => {
      return (label.textContent || "").trim();
    },
  );
}

// What a card's Then says, one sentence a line.
function thenSentences(card: HTMLElement): Array<string> {
  return within(within(card).getByTestId("notification-rule-summary"))
    .queryAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

beforeEach(() => {
  isMasterAdminForTest = true;
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/rules");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("a rule's card, row by row", () => {
  test("its name, which incidents it is for, then what it does - each row named", async () => {
    const [card] = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Acknowledged incidents",
        description: "A channel with the commander once someone acknowledges.",
        rule: ruleJson({
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentState,
              conditionType: ConditionType.ContainsAny,
              value: [ACKNOWLEDGED_ID],
            },
          ],
          newChannelTemplateName: "ack-",
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
          shouldInviteIncidentRolesToNewChannel: true,
          shouldInviteOwnersToNewChannel: true,
          archiveChannelAutomatically: true,
        }),
      },
    ]);

    expect(rowNames(card!)).toEqual([
      "Rule Name",
      "Rule Description",
      "Which incidents",
      "Then",
    ]);
    // The one condition is one line: what is checked, how, and the state.
    expect(
      within(card!).queryByTestId("notification-rule-conditions-sentence"),
    ).not.toBeInTheDocument();
    expect(within(card!).getByText("Incident State")).toBeVisible();
    expect(within(card!).getByText("is any of")).toBeVisible();
    expect(within(card!).getByText("Acknowledged")).toBeVisible();
    expect(thenSentences(card!)).toEqual([
      "Creates a channel like #ack-inc-42 for each incident.",
      "Invites on-call responders as they are paged, the Incident Commander and other incident roles as they are assigned and owners as they are added.",
      "Archives the channel when the incident is resolved.",
    ]);
  });

  test("a rule without a description leaves that row off its card", async () => {
    const cards: Array<HTMLElement> = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Every incident",
        rule: ruleJson({}),
      },
      {
        id: "2a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Blank description",
        description: "   ",
        rule: ruleJson({}),
      },
      {
        id: "3a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Described",
        description: "Posts the database team's incidents.",
        rule: ruleJson({}),
      },
    ]);

    expect(cards.map(rowNames)).toEqual([
      ["Rule Name", "Which incidents", "Then"],
      ["Rule Name", "Which incidents", "Then"],
      ["Rule Name", "Rule Description", "Which incidents", "Then"],
    ]);
  });

  test("a rule without conditions is for every incident", async () => {
    const [card] = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Every incident",
        rule: ruleJson({}),
      },
    ]);

    expect(
      within(card!).getByTestId("notification-rule-no-conditions"),
    ).toHaveTextContent(/^Every incident\.$/);
  });

  test("several conditions say how they combine, then one a line", async () => {
    const [card] = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Database or acknowledged",
        rule: ruleJson({
          filterCondition: FilterCondition.Any,
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.Contains,
              value: "database",
            },
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentState,
              conditionType: ConditionType.ContainsAny,
              value: [ACKNOWLEDGED_ID],
            },
          ],
        }),
      },
    ]);

    expect(
      within(card!).getByTestId("notification-rule-conditions-sentence"),
    ).toHaveTextContent("Those that match any one of these:");
  });

  // The channel's name is said once: in Then, with the rule's prefix in it.
  test("names the channel once, in Then, with its prefix", async () => {
    const [card] = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Ops channel",
        rule: ruleJson({ newChannelTemplateName: "ops-" }),
      },
    ]);

    expect(within(card!).queryByText("Channel Name Prefix")).toBeNull();
    expect(thenSentences(card!)[0]).toBe(
      "Creates a channel like #ops-inc-42 for each incident.",
    );
    expect(card!.textContent?.split("#ops-inc-42").length).toBe(2);
  });

  test("names the people and teams the rule invites", async () => {
    const alice: User = new User();
    alice._id = "aaaaaaaa-0000-4000-8000-000000000001";
    alice.name = new Name("Alice Moreau");

    const database: Team = new Team();
    database._id = "bbbbbbbb-0000-4000-8000-000000000002";
    database.name = "Database";

    const [card] = await renderCards(
      [
        {
          id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Database incidents",
          rule: ruleJson({
            inviteUsersToNewChannel: [alice._id],
            inviteTeamsToNewChannel: [database._id],
          }),
        },
      ],
      { users: [alice], teams: [database] },
    );

    expect(thenSentences(card!)[1]).toBe(
      "Invites Alice Moreau and Database when the channel is created.",
    );
  });

  /*
   * Whoever is on call in the schedules a rule names joins its channel,
   * unpaged: the card names the schedules, as the Dashboard loaded them.
   */
  test("names the on-call schedules whose on-call person the rule invites", async () => {
    const primary: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    primary._id = "cccccccc-0000-4000-8000-000000000003";
    primary.name = "Payments Primary";

    const secondary: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    secondary._id = "dddddddd-0000-4000-8000-000000000004";
    secondary.name = "Payments Secondary";

    const [card] = await renderCards(
      [
        {
          id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Payments incidents",
          rule: ruleJson({
            inviteOnCallSchedulesToNewChannel: [primary._id, secondary._id],
          }),
        },
      ],
      { onCallSchedules: [secondary, primary] },
    );

    expect(thenSentences(card!)[1]).toBe(
      "Invites whoever is on call in Payments Primary and Payments Secondary when the channel is created.",
    );
  });

  test("Microsoft Teams: the card says whoever is on call is mentioned in the channel", async () => {
    const primary: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    primary._id = "cccccccc-0000-4000-8000-000000000003";
    primary.name = "Payments Primary";

    const [card] = await renderCards(
      [
        {
          id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Payments incidents",
          rule: ruleJson({
            teamToCreateChannelIn: "team-ops",
            inviteOnCallSchedulesToNewChannel: [primary._id],
          }),
        },
      ],
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        microsoftTeamsTeams: [
          { id: "team-ops", name: "Ops" } as MicrosoftTeamsTeam,
        ],
        onCallSchedules: [primary],
      },
    );

    expect(thenSentences(card!).slice(1)).toEqual([
      "Everyone in Ops can open the channel.",
      "Mentions whoever is on call in Payments Primary when the channel is created.",
    ]);
  });

  test("a rule that posts nowhere says what is to pick", async () => {
    const [card] = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Nothing yet",
        rule: ruleJson({ shouldCreateNewChannel: false }),
      },
    ]);

    expect(
      within(card!).getByTestId("notification-rule-summary"),
    ).toHaveTextContent(
      "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
    );
  });

  /*
   * In Microsoft Teams the channel's name has no #, and everyone in the
   * team sees the channel: the card says what the rule does the way Teams
   * does it, and never names the workspace by its enum value.
   */
  test("Microsoft Teams: says what the rule does, the way Teams does it", async () => {
    const [card] = await renderCards(
      [
        {
          id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Every incident",
          rule: ruleJson({ teamToCreateChannelIn: "team-ops" }),
        },
      ],
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        microsoftTeamsTeams: [
          { id: "team-ops", name: "Ops" } as MicrosoftTeamsTeam,
        ],
      },
    );

    expect(thenSentences(card!)).toEqual([
      "Creates a channel like inc-42 for each incident.",
      "Everyone in Ops can open the channel.",
    ]);
    expect(card!.textContent).not.toContain("MicrosoftTeams");
  });

  /*
   * #6749: Slack installed for a whole Enterprise organization, and the
   * workspace a rule picks no longer has OneUptime. The rule posts nowhere
   * else instead; its card says so, under what it does - the rules beside
   * it, in a workspace OneUptime is added to, say nothing.
   */
  test("a Slack organization's rule that picks a workspace OneUptime was removed from: its Then says so, by name", async () => {
    const cards: Array<HTMLElement> = await renderCards(
      [
        {
          id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "West incidents",
          rule: ruleJson({ teamToCreateChannelIn: "T0WEST" }),
        },
        {
          id: "2a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "East incidents",
          rule: ruleJson({ teamToCreateChannelIn: "T0EAST" }),
        },
      ],
      {
        slackWorkspaces: [{ id: "T0EAST", name: "Acme East" }],
        slackOrganization: {
          workspaces: [{ id: "T0EAST", name: "Acme East" }],
          removedWorkspaces: [{ id: "T0WEST", name: "Acme West" }],
          organizationName: "Acme Corp",
        },
      },
    );

    const notesOf: (card: HTMLElement) => Array<string> = (
      card: HTMLElement,
    ): Array<string> => {
      return within(card)
        .queryAllByTestId("notification-rule-slack-workspace-not-added")
        .map((note: HTMLElement): string => {
          return note.textContent || "";
        });
    };

    expect(cards.map(notesOf)).toEqual([
      [
        "OneUptime is no longer added to the Acme West workspace of Acme Corp. Add it again in Slack's organization settings, or pick another workspace on the rule.",
      ],
      [],
    ]);
    // Under what the rule does, which is as before.
    expect(thenSentences(cards[0]!)[0]).toBe(
      "Creates a channel like #inc-42 for each incident.",
    );
  });
});

describe("a Mattermost rule's card (#6775)", () => {
  /*
   * The team a rule names, the project's bot was taken out of. The rule
   * posts in no other team instead; its card says so, under what it does -
   * the rule beside it, in a team the bot is in, says nothing.
   */
  test("a rule naming a team the bot was taken out of: its Then says so, by the team's name", async () => {
    const ENGINEERING_ID: string = "e".repeat(26);
    const SUPPORT_ID: string = "s".repeat(26);

    const cards: Array<HTMLElement> = await renderCards(
      [
        {
          id: "3a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Support incidents",
          rule: ruleJson({ teamToCreateChannelIn: SUPPORT_ID }),
        },
        {
          id: "4a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Engineering incidents",
          rule: ruleJson({ teamToCreateChannelIn: ENGINEERING_ID }),
        },
      ],
      {
        workspaceType: WorkspaceType.Mattermost,
        mattermostConnection: {
          teams: [
            {
              id: ENGINEERING_ID,
              name: "engineering",
              displayName: "Engineering",
            },
          ],
          removedTeams: [
            { id: SUPPORT_ID, name: "support", displayName: "Support" },
          ],
          defaultTeamId: ENGINEERING_ID,
          isBotInDefaultTeam: true,
          areTeamsListed: true,
        },
      },
    );

    const notesOf: (card: HTMLElement) => Array<string> = (
      card: HTMLElement,
    ): Array<string> => {
      return within(card)
        .queryAllByTestId("notification-rule-mattermost-team-not-joined")
        .map((note: HTMLElement): string => {
          return note.textContent || "";
        });
    };

    expect(cards.map(notesOf)).toEqual([
      [
        "OneUptime's bot is no longer a member of the Support team. Add the bot back to the team in Mattermost, or pick another team on the rule.",
      ],
      [],
    ]);
    // Under what the rule does, which is as before.
    expect(thenSentences(cards[0]!)[0]).toBe(
      "Creates a channel like inc-42 for each incident.",
    );
  });
});

describe("a rule's video call", () => {
  test("has a row only on the card of a rule that starts one", async () => {
    const cards: Array<HTMLElement> = await renderCards([
      {
        id: "1a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "With a call",
        rule: ruleJson({
          shouldStartVideoCall: true,
          videoCallSource: ZOOM_ID,
        }),
      },
      {
        id: "2a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Without a call",
        rule: ruleJson({}),
      },
    ]);

    expect(rowNames(cards[0]!)).toEqual([
      "Rule Name",
      "Which incidents",
      "Then",
      "Video Call",
    ]);
    expect(cards[0]!.textContent).toContain("Ops bridge");
    expect(rowNames(cards[1]!)).toEqual([
      "Rule Name",
      "Which incidents",
      "Then",
    ]);
  });

  test("is not a row at all where rules cannot start one", () => {
    const columns: Columns<WorkspaceNotificationRule> = columnsFor({
      eventType: NotificationRuleEventType.Monitor,
      canStartVideoCall: false,
    });

    expect(
      columns.map((column: Columns<WorkspaceNotificationRule>[number]) => {
        return column.title;
      }),
    ).toEqual(["Rule Name", "Rule Description", "Which monitors", "Then"]);
  });
});

/*
 * Which updates the rule posts (#7581): a row only on the card of a rule
 * that leaves some out, saying the answer it picked and what it posts - or,
 * for a rule that ticked its own boxes, what it posts alone. Every rule
 * saved before the Updates step, and every new rule left on Every update,
 * posts every update as before, and its card is as it was.
 */
describe("a rule's updates", () => {
  const KEY_ONLY: string = "4a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";

  // The Updates row of a card: its answer, then the updates it posts.
  function updatesRow(card: HTMLElement): {
    title: string | null;
    updates: string | null;
  } {
    const summary: HTMLElement = within(card).getByTestId(
      "notification-rule-updates-summary",
    );

    return {
      title:
        within(summary).queryByTestId("notification-rule-updates-summary-title")
          ?.textContent || null,
      updates:
        within(summary).queryByTestId("notification-rule-updates-summary-list")
          ?.textContent || null,
    };
  }

  test("has a row only on the card of a rule that leaves some updates out", async () => {
    const cards: Array<HTMLElement> = await renderCards([
      {
        id: KEY_ONLY,
        name: "Executive alerts",
        rule: ruleJson({
          updatesToPost: [
            "ResolvedAndReopened",
            "SeverityChanges",
            "PublicNotes",
            "Postmortem",
          ],
        }),
      },
      {
        id: "5a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Saved before the Updates step",
        rule: ruleJson({}),
      },
      {
        id: "6a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
        name: "Saved with no list",
        rule: ruleJson({ updatesToPost: null }),
      },
    ]);

    expect(rowNames(cards[0]!)).toEqual([
      "Rule Name",
      "Which incidents",
      "Then",
      "Updates",
    ]);
    expect(updatesRow(cards[0]!)).toEqual({
      title: "Key updates only",
      updates:
        "Resolved and reopened · Severity changes · Public notes · Postmortem",
    });

    for (const card of cards.slice(1)) {
      expect(rowNames(card)).toEqual(["Rule Name", "Which incidents", "Then"]);
      expect(
        within(card).queryByTestId("notification-rule-updates-summary"),
      ).not.toBeInTheDocument();
    }
  });

  test("the key updates in any order are still Key updates only", async () => {
    const [card] = await renderCards([
      {
        id: KEY_ONLY,
        name: "Executive alerts",
        rule: ruleJson({
          updatesToPost: [
            "Postmortem",
            "PublicNotes",
            "SeverityChanges",
            "ResolvedAndReopened",
          ],
        }),
      },
    ]);

    // In the order of the step's boxes, not the order saved.
    expect(updatesRow(card!)).toEqual({
      title: "Key updates only",
      updates:
        "Resolved and reopened · Severity changes · Public notes · Postmortem",
    });
  });

  test("a rule that ticked its own boxes is said by the updates it posts, with no answer over them", async () => {
    const [card] = await renderCards([
      {
        id: KEY_ONLY,
        name: "Paging only",
        rule: ruleJson({ updatesToPost: ["Paging", "PrivateNotes"] }),
      },
    ]);

    // "Updates: Private notes · Paging", not "Updates: Chosen updates".
    expect(updatesRow(card!)).toEqual({
      title: null,
      updates: "Private notes · Paging",
    });
  });

  test("a rule with every box cleared says when it still posts", async () => {
    const [card] = await renderCards([
      {
        id: KEY_ONLY,
        name: "Declared only",
        rule: ruleJson({ updatesToPost: [] }),
      },
    ]);

    expect(rowNames(card!)).toContain("Updates");
    expect(updatesRow(card!)).toEqual({
      title: "Only when an incident is declared or a video call starts",
      updates: null,
    });
  });

  /*
   * A narrow card breaks the list between two updates, never inside one
   * ("Changes to the / severity") or before a mark: each update is an item
   * of its own, kept whole on a line, with the mark after it. The marks are
   * drawn, not read out: a screen reader hears a list of three.
   */
  test("each update is an item kept whole on a line, with the mark after it", async () => {
    const [card] = await renderCards([
      {
        id: KEY_ONLY,
        name: "Three updates",
        rule: ruleJson({
          updatesToPost: ["SeverityChanges", "Paging", "ResolvedAndReopened"],
        }),
      },
    ]);

    const list: HTMLElement = within(card!).getByTestId(
      "notification-rule-updates-summary-list",
    );

    expect(list).toHaveAttribute("role", "list");

    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");

    expect(
      items.map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(["Resolved and reopened ·", "Severity changes ·", "Paging"]);

    for (const item of items) {
      expect(item).toHaveClass("inline-block");
    }

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.querySelector('[aria-hidden="true"]')?.textContent || null;
      }),
    ).toEqual([" ·", " ·", null]);
  });

  test("sits between Then and Video Call", async () => {
    const [card] = await renderCards([
      {
        id: KEY_ONLY,
        name: "Quiet, with a call",
        rule: ruleJson({
          updatesToPost: ["ResolvedAndReopened"],
          shouldStartVideoCall: true,
          videoCallSource: ZOOM_ID,
        }),
      },
    ]);

    expect(rowNames(card!)).toEqual([
      "Rule Name",
      "Which incidents",
      "Then",
      "Updates",
      "Video Call",
    ]);
    expect(updatesRow(card!)).toEqual({
      title: null,
      updates: "Resolved and reopened",
    });
  });

  test.each([
    [
      NotificationRuleEventType.Alert,
      ["ResolvedAndReopened", "SeverityChanges"],
      "Key updates only",
    ],
    [
      NotificationRuleEventType.IncidentEpisode,
      ["ResolvedAndReopened", "PublicNotes"],
      "Key updates only",
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      ["ResolvedAndReopened"],
      "Key updates only",
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      ["StateChanges", "PublicNotes"],
      "Key updates only",
    ],
    [NotificationRuleEventType.ScheduledMaintenance, ["PrivateNotes"], null],
    [
      NotificationRuleEventType.Incident,
      [],
      "Only when an incident is declared or a video call starts",
    ],
    [
      NotificationRuleEventType.Alert,
      [],
      "Only when an alert is created or a video call starts",
    ],
    [
      NotificationRuleEventType.IncidentEpisode,
      [],
      "Only when an incident episode is created",
    ],
    [
      NotificationRuleEventType.AlertEpisode,
      [],
      "Only when an alert episode is created",
    ],
    [
      NotificationRuleEventType.ScheduledMaintenance,
      [],
      "Only when a scheduled maintenance event is created",
    ],
    // An on-call policy rule's updates are who is on call (#7549).
    [
      NotificationRuleEventType.OnCallDutyPolicy,
      ["OnCallNow", "NobodyOnCall"],
      "Key updates only",
    ],
    [NotificationRuleEventType.OnCallDutyPolicy, ["OnCallNext"], null],
    [
      NotificationRuleEventType.OnCallDutyPolicy,
      [],
      "Only when an on-call policy is created",
    ],
  ])(
    "a %s rule's card says what it picked, %j",
    async (
      eventType: NotificationRuleEventType,
      updatesToPost: Array<string>,
      title: string | null,
    ) => {
      const [card] = await renderCards(
        [
          {
            id: KEY_ONLY,
            name: "Quiet",
            rule: ruleJson({ updatesToPost: updatesToPost }),
          },
        ],
        { eventType: eventType, canStartVideoCall: false },
      );

      expect(rowNames(card!)).toContain("Updates");
      expect(updatesRow(card!).title).toBe(title);
    },
  );

  test("an on-call policy rule's card names who is on call, in the order of its boxes (#7549)", async () => {
    const [card] = await renderCards(
      [
        {
          id: KEY_ONLY,
          name: "Payments on-call",
          rule: ruleJson({
            updatesToPost: ["NobodyOnCall", "OnCallNow"],
          }),
        },
      ],
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        canStartVideoCall: false,
      },
    );

    expect(updatesRow(card!)).toEqual({
      title: "Key updates only",
      updates: "Who is on call now · Nobody on call",
    });
  });

  /*
   * A new on-call policy rule starts on Key updates only, so its card says
   * so - and a rule saved before on-call rules chose, which still posts
   * every update, says that beside it: the channel the customer found too
   * noisy is the one with that rule, and its card is where they look.
   */
  test("every on-call policy rule's card says which updates it posts: one saved before on-call rules chose says Every update (#7549)", async () => {
    const cards: Array<HTMLElement> = await renderCards(
      [
        {
          id: KEY_ONLY,
          name: "Saved before on-call rules chose",
          rule: ruleJson({}),
        },
        {
          id: "7a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Saved with no list",
          rule: ruleJson({ updatesToPost: null }),
        },
        {
          id: "8a8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          name: "Created with the Updates step",
          rule: ruleJson({ updatesToPost: ["OnCallNow", "NobodyOnCall"] }),
        },
      ],
      {
        eventType: NotificationRuleEventType.OnCallDutyPolicy,
        canStartVideoCall: false,
      },
    );

    for (const card of cards) {
      const names: Array<string> = rowNames(card);

      expect(names[names.length - 1]).toBe("Updates");
    }

    expect(updatesRow(cards[0]!)).toEqual({
      title: "Every update",
      updates: null,
    });
    expect(updatesRow(cards[1]!)).toEqual({
      title: "Every update",
      updates: null,
    });
    expect(updatesRow(cards[2]!)).toEqual({
      title: "Key updates only",
      updates: "Who is on call now · Nobody on call",
    });
  });

  test.each([
    NotificationRuleEventType.Monitor,
    NotificationRuleEventType.SecurityCase,
    NotificationRuleEventType.SecurityHunt,
    NotificationRuleEventType.ServiceLevelObjective,
  ])(
    "is not a row at all on a %s rule's card: those post every update",
    (eventType: NotificationRuleEventType) => {
      const ids: Array<string> = getColumnIds<WorkspaceNotificationRule>(
        columnsFor({ eventType: eventType, canStartVideoCall: false }),
      );

      expect(ids).not.toContain(NOTIFICATION_RULE_CARD_COLUMN_IDS.updates);
    },
  );
});

describe("the card's rows in Customize Columns", () => {
  test("every row has a name, and the four that read the rule have ids of their own", () => {
    const columns: Columns<WorkspaceNotificationRule> = columnsFor({});

    for (const column of columns) {
      expect(column.title.trim().length).toBeGreaterThan(0);
    }

    const ids: Array<string> = getColumnIds<WorkspaceNotificationRule>(columns);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "name",
      "description",
      NOTIFICATION_RULE_CARD_COLUMN_IDS.when,
      NOTIFICATION_RULE_CARD_COLUMN_IDS.then,
      NOTIFICATION_RULE_CARD_COLUMN_IDS.updates,
      NOTIFICATION_RULE_CARD_COLUMN_IDS.videoCall,
    ]);
  });

  test.each(Object.values(NotificationRuleEventType))(
    "the records row of a rule for %s is titled as its Conditions step asks",
    (eventType: NotificationRuleEventType) => {
      const columns: Columns<WorkspaceNotificationRule> = columnsFor({
        eventType: eventType,
      });

      expect(
        columns.find((column: Columns<WorkspaceNotificationRule>[number]) => {
          return column.id === NOTIFICATION_RULE_CARD_COLUMN_IDS.when;
        })?.title,
      ).toBe(NOTIFICATION_RULE_CONDITIONS_TITLES[eventType]);
    },
  );
});
