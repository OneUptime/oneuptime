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
 *   Which incidents  Incident State  Contains Any  (Acknowledged)
 *   Then             - Creates a channel like #ack-inc-42 for each incident.
 *                    - Invites on-call responders as they are paged, ...
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
import { NOTIFICATION_RULE_CONDITIONS_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleCopy";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import { MicrosoftTeamsTeam } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
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
    expect(within(card!).getByText("Contains Any")).toBeVisible();
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

describe("the card's rows in Customize Columns", () => {
  test("every row has a name, and the three that read the rule have ids of their own", () => {
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
