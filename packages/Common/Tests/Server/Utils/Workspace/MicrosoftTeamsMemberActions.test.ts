import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubPrivateRecords } from "../../TestingUtils/PrivateRecords";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallPersonPageAnswer from "../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import UserService from "../../../../Server/Services/UserService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import Name from "../../../../Types/Name";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsOnCallDutyActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import { MicrosoftTeamsRequest } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsOnCallDutyActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import { WorkspaceEventType } from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";

/*
 * EVERY MICROSOFT TEAMS CARD ACTION THAT CHANGES A RECORD, PRESSED BY THE
 * MEMBER THE TEAMS ACCOUNT IS CONNECTED TO.
 *
 * Per handler - incidents, alerts, alert and incident episodes, scheduled
 * maintenance, on-call policies - and per action: a member without the
 * permission is refused and nothing is written; a member with it writes the
 * same row the dashboard writes for them, with their own props, and needs no
 * more than the dashboard asks (acknowledging needs the state timeline's
 * create permission and the record's read, not an edit grant on the record);
 * a record outside the member's read is refused like one that is not there;
 * a change-state card offers only the states the member may read that the
 * record may move into next; Escalate
 * pages for the card's incident, alert or episode, and a card naming none is
 * answered plainly.
 *
 * The props are what handleBotInvokeActivity hands every handler for a
 * current member (getProjectMemberProps); the handlers, WorkspaceMemberActions
 * and the permission checks are real; reads and creates are stubbed.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
  };

  return {
    userId: userId,
    tenantId: projectId,
    userTeamIds: [],
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

interface FakeTurn {
  turnContext: TurnContext;
  replies: Array<unknown>;
}

function createTurn(): FakeTurn {
  const replies: Array<unknown> = [];

  return {
    replies: replies,
    turnContext: {
      activity: {},
      deleteActivity: jest.fn(async (): Promise<void> => {}),
      sendActivity: jest.fn(async (reply: unknown): Promise<void> => {
        replies.push(reply);
      }),
    } as unknown as TurnContext,
  };
}

// The choices of the one Input.ChoiceSet of a card a reply carried.
function cardChoices(reply: unknown): Array<{ title: string; value: string }> {
  const card: JSONObject = (reply as { attachments: Array<JSONObject> })
    .attachments[0]!["content"] as JSONObject;
  const choiceSet: JSONObject | undefined = (
    card["body"] as Array<JSONObject>
  ).find((element: JSONObject): boolean => {
    return element["type"] === "Input.ChoiceSet";
  });

  return (choiceSet?.["choices"] || []) as Array<{
    title: string;
    value: string;
  }>;
}

beforeEach((): void => {
  // The project's plan, as the action's checks read it where a plan decides.
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

afterEach((): void => {
  jest.restoreAllMocks();
});

// A project's incident or alert states: Created, Acknowledged, Resolved.
interface ProjectStates {
  created: ObjectID;
  acknowledged: ObjectID;
  resolved: ObjectID;
}

function incidentLikeStates<T extends IncidentState | AlertState>(
  makeState: () => T,
): { ids: ProjectStates; all: Array<T> } {
  const flags: Array<
    "isCreatedState" | "isAcknowledgedState" | "isResolvedState"
  > = ["isCreatedState", "isAcknowledgedState", "isResolvedState"];
  const all: Array<T> = flags.map(
    (
      flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState",
      index: number,
    ): T => {
      const state: T = makeState();
      state.id = ObjectID.generate();
      state.projectId = projectId;
      state.name = flag;
      state.order = index + 1;
      state.isCreatedState = flag === "isCreatedState";
      state.isAcknowledgedState = flag === "isAcknowledgedState";
      state.isResolvedState = flag === "isResolvedState";
      return state;
    },
  );

  return {
    ids: {
      created: all[0]!.id!,
      acknowledged: all[1]!.id!,
      resolved: all[2]!.id!,
    },
    all: all,
  };
}

function incidentStates(): ProjectStates {
  const states: { ids: ProjectStates; all: Array<IncidentState> } =
    incidentLikeStates((): IncidentState => {
      return new IncidentState();
    });
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(states.all);
  return states.ids;
}

function alertStates(): ProjectStates {
  const states: { ids: ProjectStates; all: Array<AlertState> } =
    incidentLikeStates((): AlertState => {
      return new AlertState();
    });
  jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockResolvedValue(states.all);
  return states.ids;
}

function stubRecord(data: {
  service: unknown;
  makeRecord: () => unknown;
  stateColumn: string;
  currentStateId: ObjectID | null;
  /*
   * There, but outside the member's read (their labels, their owners):
   * only OneUptime's own read finds it.
   */
  isOutsideMemberRead?: boolean | undefined;
}): AnySpy {
  const spy: AnySpy = jest.spyOn(
    data.service as { findOneBy: () => Promise<unknown> },
    "findOneBy",
  ) as AnySpy;

  if (!data.currentStateId) {
    return spy.mockResolvedValue(null);
  }

  const record: Record<string, unknown> = data.makeRecord() as Record<
    string,
    unknown
  >;
  record["id"] = ObjectID.generate();
  record["projectId"] = projectId;
  record["title"] = "Checkout is down";
  record[data.stateColumn] = data.currentStateId;

  if (data.isOutsideMemberRead) {
    return spy.mockImplementation(
      async (findOneBy: unknown): Promise<unknown> => {
        return (findOneBy as { props: { isRoot?: boolean } }).props.isRoot
          ? record
          : null;
      },
    );
  }

  return spy.mockResolvedValue(record);
}

function stubCreate(service: unknown): AnySpy {
  return (
    jest.spyOn(
      service as { create: () => Promise<unknown> },
      "create",
    ) as AnySpy
  ).mockImplementation(async (createBy: unknown): Promise<unknown> => {
    return (createBy as { data: unknown }).data;
  });
}

// The row a create was handed; made with exactly these member props.
function writtenWith(
  createSpy: AnySpy,
  props: DatabaseCommonInteractionProps,
): Record<string, unknown> {
  expect(createSpy).toHaveBeenCalledTimes(1);
  const createBy: {
    data: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  } = createSpy.mock.calls[0]![0];

  expect(createBy.props).toBe(props);
  expect(createBy.props.isRoot).toBeUndefined();
  expect(String(createBy.data["projectId"])).toBe(projectId.toString());

  return createBy.data;
}

interface TeamsNote {
  label: string;
  value: JSONObject;
  service: unknown;
  modelType: { new (): unknown };
  refusal: string;
}

interface TeamsKind {
  name: string;
  noun: string;
  subject: string;
  handle: (data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    props: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }) => Promise<void>;
  recordService: unknown;
  makeRecord: () => unknown;
  recordStateColumn: string;
  role: Permission;
  // Only what the dashboard asks to change the state: create the row, read the record.
  dashboardPermissions: Array<Permission>;
  // An edit grant on the record, without the state timeline's create.
  editOnlyPermissions: Array<Permission>;
  timelineService: unknown;
  timelineRecordColumn: string;
  timelineStateColumn: string;
  stubStates: () => ProjectStates;
  stateService: unknown;
  ack: { actionType: string; refusal: string; confirmation: string };
  resolve: { actionType: string; refusal: string; confirmation: string };
  changeState: {
    view: string;
    submit: string;
    valueKey: string;
    refusal: string;
    confirmation: string;
    noStates: string;
  };
  notes: Array<TeamsNote>;
  execute: {
    actionType: string;
    refusal: string;
    triggerColumn: string;
    userNotificationEventType: UserNotificationEventType;
  };
  view: { actionType: string };
}

function bot(
  handler: (data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    projectId: ObjectID;
    oneUptimeUserId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }) => Promise<void>,
): TeamsKind["handle"] {
  return (data: {
    actionType: string;
    actionValue: string;
    value: JSONObject;
    props: DatabaseCommonInteractionProps;
    turnContext: TurnContext;
  }): Promise<void> => {
    return handler({
      actionType: data.actionType,
      actionValue: data.actionValue,
      value: data.value,
      projectId: projectId,
      oneUptimeUserId: userId,
      databaseProps: data.props,
      turnContext: data.turnContext,
    });
  };
}

const TEAMS_KINDS: Array<TeamsKind> = [
  {
    name: "incident",
    noun: "incident",
    subject: "Incident",
    handle: bot(
      MicrosoftTeamsIncidentActions.handleBotIncidentAction.bind(
        MicrosoftTeamsIncidentActions,
      ),
    ),
    recordService: IncidentService,
    makeRecord: (): unknown => {
      return new Incident();
    },
    recordStateColumn: "currentIncidentStateId",
    role: Permission.IncidentMember,
    dashboardPermissions: [
      Permission.CreateIncidentStateTimeline,
      Permission.ReadProjectIncident,
    ],
    editOnlyPermissions: [
      Permission.EditProjectIncident,
      Permission.ReadProjectIncident,
    ],
    timelineService: IncidentStateTimelineService,
    timelineRecordColumn: "incidentId",
    timelineStateColumn: "incidentStateId",
    stubStates: incidentStates,
    stateService: IncidentStateService,
    ack: {
      actionType: MicrosoftTeamsIncidentActionType.AckIncident,
      refusal: "acknowledge this incident",
      confirmation: "✅ Incident acknowledged.",
    },
    resolve: {
      actionType: MicrosoftTeamsIncidentActionType.ResolveIncident,
      refusal: "resolve this incident",
      confirmation: "✅ Incident resolved.",
    },
    changeState: {
      view: MicrosoftTeamsIncidentActionType.ViewChangeIncidentState,
      submit: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
      valueKey: "incidentState",
      refusal: "change the state of this incident",
      confirmation: "✅ Incident state changed successfully.",
      noStates: MicrosoftTeamsIncidentActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "public",
        value: { noteType: "public", note: "Payments are back." },
        service: IncidentPublicNoteService,
        modelType: IncidentPublicNote,
        refusal: "add a public note to this incident",
      },
      {
        label: "private",
        value: { noteType: "private", note: "Rolled back 4.2.1." },
        service: IncidentInternalNoteService,
        modelType: IncidentInternalNote,
        refusal: "add a private note to this incident",
      },
    ],
    execute: {
      actionType:
        MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
      refusal: "execute an on-call policy for this incident",
      triggerColumn: "triggeredByIncidentId",
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    },
    view: {
      actionType: MicrosoftTeamsIncidentActionType.ViewIncident,
    },
  },
  {
    name: "alert",
    noun: "alert",
    subject: "Alert",
    handle: bot(
      MicrosoftTeamsAlertActions.handleBotAlertAction.bind(
        MicrosoftTeamsAlertActions,
      ),
    ),
    recordService: AlertService,
    makeRecord: (): unknown => {
      return new Alert();
    },
    recordStateColumn: "currentAlertStateId",
    role: Permission.AlertMember,
    dashboardPermissions: [
      Permission.CreateAlertStateTimeline,
      Permission.ReadAlert,
    ],
    editOnlyPermissions: [Permission.EditAlert, Permission.ReadAlert],
    timelineService: AlertStateTimelineService,
    timelineRecordColumn: "alertId",
    timelineStateColumn: "alertStateId",
    stubStates: alertStates,
    stateService: AlertStateService,
    ack: {
      actionType: MicrosoftTeamsAlertActionType.AckAlert,
      refusal: "acknowledge this alert",
      confirmation: "✅ Alert acknowledged.",
    },
    resolve: {
      actionType: MicrosoftTeamsAlertActionType.ResolveAlert,
      refusal: "resolve this alert",
      confirmation: "✅ Alert resolved.",
    },
    changeState: {
      view: MicrosoftTeamsAlertActionType.ViewChangeAlertState,
      submit: MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
      valueKey: "alertState",
      refusal: "change the state of this alert",
      confirmation: "✅ Alert state changed successfully.",
      noStates: MicrosoftTeamsAlertActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "private",
        value: { note: "Disk freed." },
        service: AlertInternalNoteService,
        modelType: AlertInternalNote,
        refusal: "add a private note to this alert",
      },
    ],
    execute: {
      actionType: MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy,
      refusal: "execute an on-call policy for this alert",
      triggerColumn: "triggeredByAlertId",
      userNotificationEventType: UserNotificationEventType.AlertCreated,
    },
    view: {
      actionType: MicrosoftTeamsAlertActionType.ViewAlert,
    },
  },
  {
    name: "alert episode",
    noun: "alert episode",
    subject: "Episode",
    handle: bot(
      MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction.bind(
        MicrosoftTeamsAlertEpisodeActions,
      ),
    ),
    recordService: AlertEpisodeService,
    makeRecord: (): unknown => {
      return new AlertEpisode();
    },
    recordStateColumn: "currentAlertStateId",
    role: Permission.AlertMember,
    dashboardPermissions: [
      Permission.CreateAlertEpisodeStateTimeline,
      Permission.ReadAlertEpisode,
    ],
    editOnlyPermissions: [
      Permission.EditAlertEpisode,
      Permission.ReadAlertEpisode,
    ],
    timelineService: AlertEpisodeStateTimelineService,
    timelineRecordColumn: "alertEpisodeId",
    timelineStateColumn: "alertStateId",
    stubStates: alertStates,
    stateService: AlertStateService,
    ack: {
      actionType: MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode,
      refusal: "acknowledge this alert episode",
      confirmation: "✅ Alert episode acknowledged.",
    },
    resolve: {
      actionType: MicrosoftTeamsAlertEpisodeActionType.ResolveAlertEpisode,
      refusal: "resolve this alert episode",
      confirmation: "✅ Alert episode resolved.",
    },
    changeState: {
      view: MicrosoftTeamsAlertEpisodeActionType.ViewChangeAlertEpisodeState,
      submit:
        MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
      valueKey: "alertState",
      refusal: "change the state of this alert episode",
      confirmation: "✅ Alert episode state changed successfully.",
      noStates: MicrosoftTeamsAlertEpisodeActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "private",
        value: { note: "Grouped by the deploy." },
        service: AlertEpisodeInternalNoteService,
        modelType: AlertEpisodeInternalNote,
        refusal: "add a private note to this alert episode",
      },
    ],
    execute: {
      actionType:
        MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
      refusal: "execute an on-call policy for this alert episode",
      triggerColumn: "triggeredByAlertEpisodeId",
      userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
    },
    view: {
      actionType: MicrosoftTeamsAlertEpisodeActionType.ViewAlertEpisode,
    },
  },
  {
    name: "incident episode",
    noun: "incident episode",
    subject: "Episode",
    handle: bot(
      MicrosoftTeamsIncidentEpisodeActions.handleBotIncidentEpisodeAction.bind(
        MicrosoftTeamsIncidentEpisodeActions,
      ),
    ),
    recordService: IncidentEpisodeService,
    makeRecord: (): unknown => {
      return new IncidentEpisode();
    },
    recordStateColumn: "currentIncidentStateId",
    role: Permission.IncidentMember,
    dashboardPermissions: [
      Permission.CreateIncidentEpisodeStateTimeline,
      Permission.ReadIncidentEpisode,
    ],
    editOnlyPermissions: [
      Permission.EditIncidentEpisode,
      Permission.ReadIncidentEpisode,
    ],
    timelineService: IncidentEpisodeStateTimelineService,
    timelineRecordColumn: "incidentEpisodeId",
    timelineStateColumn: "incidentStateId",
    stubStates: incidentStates,
    stateService: IncidentStateService,
    ack: {
      actionType: MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode,
      refusal: "acknowledge this incident episode",
      confirmation: "Incident episode acknowledged.",
    },
    resolve: {
      actionType:
        MicrosoftTeamsIncidentEpisodeActionType.ResolveIncidentEpisode,
      refusal: "resolve this incident episode",
      confirmation: "Incident episode resolved.",
    },
    changeState: {
      view: MicrosoftTeamsIncidentEpisodeActionType.ViewChangeIncidentEpisodeState,
      submit:
        MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState,
      valueKey: "incidentState",
      refusal: "change the state of this incident episode",
      confirmation: "Incident episode state changed successfully.",
      noStates: MicrosoftTeamsIncidentEpisodeActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "private",
        value: { note: "One root cause." },
        service: IncidentEpisodeInternalNoteService,
        modelType: IncidentEpisodeInternalNote,
        refusal: "add a private note to this incident episode",
      },
    ],
    execute: {
      actionType:
        MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
      refusal: "execute an on-call policy for this incident episode",
      triggerColumn: "triggeredByIncidentEpisodeId",
      userNotificationEventType:
        UserNotificationEventType.IncidentEpisodeCreated,
    },
    view: {
      actionType: MicrosoftTeamsIncidentEpisodeActionType.ViewIncidentEpisode,
    },
  },
];

function repliesText(turn: FakeTurn): Array<string> {
  return turn.replies.map((reply: unknown): string => {
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  });
}

/*
 * The text of every answer card a press was answered with
 * (MicrosoftTeamsActionAnswer): one text block each.
 */
function answerTexts(turn: FakeTurn): Array<string> {
  return turn.replies.map((reply: unknown): string => {
    const card: JSONObject = (reply as { attachments: Array<JSONObject> })
      .attachments[0]!["content"] as JSONObject;
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    expect(body).toHaveLength(1);

    return body[0]!["text"] as string;
  });
}

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

// Who got there first, in a press that comes too late.
const SIMON: ObjectID = ObjectID.generate();
const ACKNOWLEDGED_AT: string = "2026-10-08T18:07:00Z";

/*
 * What an answer to a press that comes too late reads, besides the record:
 * the record's state timeline (who moved it, and when), that person's name,
 * and the dashboard address its link starts from.
 */
function stubLateAnswerReads(data: {
  timelineService: unknown;
  rows: Array<Record<string, unknown>>;
}): void {
  (
    jest.spyOn(
      data.timelineService as { findBy: () => Promise<unknown> },
      "findBy",
    ) as AnySpy
  ).mockResolvedValue(data.rows);

  const simon: User = new User();
  simon.name = new Name("Simon Lee");

  (jest.spyOn(UserService, "findOneBy") as AnySpy).mockImplementation(
    async (findBy: { query: { _id: ObjectID } }): Promise<User | null> => {
      return findBy.query._id.toString() === SIMON.toString() ? simon : null;
    },
  );

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
}

// "Incident Episode", as an answer names the record.
function titleOf(noun: string): string {
  return noun
    .split(" ")
    .map((word: string): string => {
      return word.charAt(0).toUpperCase() + word.substring(1);
    })
    .join(" ");
}

describe.each(TEAMS_KINDS)(
  "Microsoft Teams $name card actions",
  (kind: TeamsKind): void => {
    describe.each([
      { label: "Acknowledge", move: kind.ack, target: "acknowledged" },
      { label: "Resolve", move: kind.resolve, target: "resolved" },
    ] as Array<{
      label: string;
      move: TeamsKind["ack"];
      target: "acknowledged" | "resolved";
    }>)(
      "$label",
      ({
        move,
        target,
      }: {
        move: TeamsKind["ack"];
        target: "acknowledged" | "resolved";
      }): void => {
        test("a member who holds the permission changes the state as themselves, and is told it is done", async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps([
            kind.role,
          ]);
          const states: ProjectStates = kind.stubStates();
          const readSpy: AnySpy = stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: states.created,
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);
          const turn: FakeTurn = createTurn();
          const recordId: ObjectID = ObjectID.generate();

          await kind.handle({
            actionType: move.actionType,
            actionValue: recordId.toString(),
            value: {},
            props: props,
            turnContext: turn.turnContext,
          });

          const data: Record<string, unknown> = writtenWith(createSpy, props);
          expect(String(data[kind.timelineRecordColumn])).toBe(
            recordId.toString(),
          );
          expect(String(data[kind.timelineStateColumn])).toBe(
            states[target].toString(),
          );
          expect(repliesText(turn)).toEqual([move.confirmation]);

          // One read of the record, as the member: the check's, which the write acts on.
          expect(readSpy).toHaveBeenCalledTimes(1);
          expect(readSpy.mock.calls[0]![0].props).toBe(props);
        });

        test("only the dashboard's permission is needed: the state timeline's create and the record's read", async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps(
            kind.dashboardPermissions,
          );
          const states: ProjectStates = kind.stubStates();
          stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: states.created,
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);

          await kind.handle({
            actionType: move.actionType,
            actionValue: ObjectID.generate().toString(),
            value: {},
            props: props,
            turnContext: createTurn().turnContext,
          });

          writtenWith(createSpy, props);
        });

        test("an edit grant on the record without the state timeline's create is refused, as the dashboard refuses it", async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps(
            kind.editOnlyPermissions,
          );
          kind.stubStates();
          stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: ObjectID.generate(),
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);

          await expect(
            kind.handle({
              actionType: move.actionType,
              actionValue: ObjectID.generate().toString(),
              value: {},
              props: props,
              turnContext: createTurn().turnContext,
            }),
          ).rejects.toThrow(`You do not have permission to ${move.refusal}.`);

          expect(createSpy).not.toHaveBeenCalled();
        });

        test("a member who may only read is refused, and nothing is written", async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps([
            Permission.Viewer,
          ]);
          kind.stubStates();
          stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: ObjectID.generate(),
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);
          const turn: FakeTurn = createTurn();

          await expect(
            kind.handle({
              actionType: move.actionType,
              actionValue: ObjectID.generate().toString(),
              value: {},
              props: props,
              turnContext: turn.turnContext,
            }),
          ).rejects.toThrow(NotAuthorizedException);

          expect(createSpy).not.toHaveBeenCalled();
          // handleBotInvokeActivity tells them why; nothing else is said.
          expect(turn.replies).toEqual([]);
        });

        test(`a ${kind.noun} outside the member's read is refused with that, never as one that is not there`, async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps([
            kind.role,
          ]);
          kind.stubStates();
          stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: ObjectID.generate(),
            isOutsideMemberRead: true,
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);

          await expect(
            kind.handle({
              actionType: move.actionType,
              actionValue: ObjectID.generate().toString(),
              value: {},
              props: props,
              turnContext: createTurn().turnContext,
            }),
          ).rejects.toThrow(
            `your access in this project does not include this ${kind.noun}. Ask a project admin for access to it.`,
          );

          expect(createSpy).not.toHaveBeenCalled();
        });

        test(`a ${kind.noun} that is gone is not found, and nothing is written`, async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps([
            kind.role,
          ]);
          kind.stubStates();
          stubRecord({
            service: kind.recordService,
            makeRecord: kind.makeRecord,
            stateColumn: kind.recordStateColumn,
            currentStateId: null,
          });
          const createSpy: AnySpy = stubCreate(kind.timelineService);

          await expect(
            kind.handle({
              actionType: move.actionType,
              actionValue: ObjectID.generate().toString(),
              value: {},
              props: props,
              turnContext: createTurn().turnContext,
            }),
          ).rejects.toThrow(
            `the ${kind.noun} was not found. It may have been deleted.`,
          );

          expect(createSpy).not.toHaveBeenCalled();
        });
      },
    );

    /*
     * Customer feedback #1: "you cannot acknowledge the Incident INC-2. It
     * has already been acknowledged." - an error, naming nobody. A press
     * that comes too late is news: who got there first, and when.
     */
    test(`a ${kind.noun} acknowledged already is not acknowledged again: the member is told who acknowledged it, and when`, async (): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
      const states: ProjectStates = kind.stubStates();
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.acknowledged,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);
      stubLateAnswerReads({
        timelineService: kind.timelineService,
        rows: [
          {
            [kind.timelineStateColumn]: states.created,
            startsAt: new Date("2026-10-08T18:00:00Z"),
          },
          {
            [kind.timelineStateColumn]: states.acknowledged,
            startsAt: new Date(ACKNOWLEDGED_AT),
            createdByUserId: SIMON,
          },
        ],
      });
      const turn: FakeTurn = createTurn();

      await kind.handle({
        actionType: kind.ack.actionType,
        actionValue: ObjectID.generate().toString(),
        value: {},
        props: props,
        turnContext: turn.turnContext,
      });

      expect(createSpy).not.toHaveBeenCalled();

      const answers: Array<string> = answerTexts(turn);

      expect(answers).toHaveLength(1);
      // The record, linked in OneUptime ...
      expect(
        answers[0]!.startsWith(
          `✅ **[${titleOf(kind.noun)}](${DASHBOARD_URL}/${projectId.toString()}/`,
        ),
      ).toBe(true);
      // ... then who acknowledged it, and when, in each reader's own time.
      expect(
        answers[0]!.endsWith(
          `)** was already acknowledged by **Simon Lee** at {{TIME(${ACKNOWLEDGED_AT})}}.`,
        ),
      ).toBe(true);
      expect(answers[0]!.toLowerCase()).not.toContain("unfortunately");
    });

    /*
     * The press a person's page makes natural (UI review of block 31):
     * paged into a record Simon acknowledged, the member presses its
     * Acknowledge. That answers their page - it would page them again
     * otherwise - and the answer says so first. Episodes have no person's
     * pages.
     */
    if (kind.name === "incident" || kind.name === "alert") {
      test(`an ${kind.noun} acknowledged already, pressed by somebody a person's page paged into it: their page is answered, and said first`, async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
        const states: ProjectStates = kind.stubStates();
        const recordId: ObjectID = ObjectID.generate();
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: states.acknowledged,
        });
        const createSpy: AnySpy = stubCreate(kind.timelineService);
        stubLateAnswerReads({
          timelineService: kind.timelineService,
          rows: [
            {
              [kind.timelineStateColumn]: states.acknowledged,
              startsAt: new Date(ACKNOWLEDGED_AT),
              createdByUserId: SIMON,
            },
          ],
        });
        const answerSpy: AnySpy = jest
          .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
          .mockResolvedValue(1) as AnySpy;
        const turn: FakeTurn = createTurn();

        await kind.handle({
          actionType: kind.ack.actionType,
          actionValue: recordId.toString(),
          value: {},
          props: props,
          turnContext: turn.turnContext,
        });

        expect(createSpy).not.toHaveBeenCalled();
        expect(answerSpy.mock.calls[0]![0]).toEqual({
          kind: kind.name,
          recordId: recordId,
          projectId: projectId,
          pressedByUserId: userId,
          isResolved: false,
        });

        const answers: Array<string> = answerTexts(turn);

        expect(answers).toHaveLength(1);
        expect(
          answers[0]!.startsWith(
            `✅ You acknowledged the page for **[${titleOf(kind.noun)}](${DASHBOARD_URL}/${projectId.toString()}/`,
          ),
        ).toBe(true);
        expect(
          answers[0]!.endsWith(
            `)**, so paging stopped. **Simon Lee** acknowledged the ${kind.noun} at {{TIME(${ACKNOWLEDGED_AT})}}.`,
          ),
        ).toBe(true);
      });
    }

    describe("Change State", (): void => {
      test("a member who holds the permission moves it into the state they picked, as themselves", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
        const readSpy: AnySpy = stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        const createSpy: AnySpy = stubCreate(kind.timelineService);
        const turn: FakeTurn = createTurn();
        const recordId: ObjectID = ObjectID.generate();
        const picked: ObjectID = ObjectID.generate();

        await kind.handle({
          actionType: kind.changeState.submit,
          actionValue: recordId.toString(),
          value: { [kind.changeState.valueKey]: picked.toString() },
          props: props,
          turnContext: turn.turnContext,
        });

        const data: Record<string, unknown> = writtenWith(createSpy, props);
        expect(String(data[kind.timelineRecordColumn])).toBe(
          recordId.toString(),
        );
        expect(String(data[kind.timelineStateColumn])).toBe(picked.toString());
        expect(repliesText(turn)).toEqual([kind.changeState.confirmation]);
        expect(readSpy).toHaveBeenCalledTimes(1);
      });

      test("a member who may only read is refused, and nothing is written", async (): Promise<void> => {
        const createSpy: AnySpy = stubCreate(kind.timelineService);

        await expect(
          kind.handle({
            actionType: kind.changeState.submit,
            actionValue: ObjectID.generate().toString(),
            value: {
              [kind.changeState.valueKey]: ObjectID.generate().toString(),
            },
            props: memberProps([Permission.Viewer]),
            turnContext: createTurn().turnContext,
          }),
        ).rejects.toThrow(
          `You do not have permission to ${kind.changeState.refusal}.`,
        );

        expect(createSpy).not.toHaveBeenCalled();
      });

      test("the card offers only the states the member may read, read as the member", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
        const states: ProjectStates = kind.stubStates();
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: states.created,
        });
        // Of the project's states, the member may read this one.
        const investigating: ObjectID = states.acknowledged;
        const statesSpy: AnySpy = (
          jest.spyOn(
            kind.stateService as { findBy: () => Promise<unknown> },
            "findBy",
          ) as AnySpy
        ).mockResolvedValue([{ id: investigating, name: "Investigating" }]);
        const turn: FakeTurn = createTurn();

        await kind.handle({
          actionType: kind.changeState.view,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: props,
          turnContext: turn.turnContext,
        });

        expect(statesSpy).toHaveBeenCalledTimes(1);
        expect(statesSpy.mock.calls[0]![0].props).toBe(props);
        expect(turn.replies).toHaveLength(1);
        expect(cardChoices(turn.replies[0])).toEqual([
          { title: "Investigating", value: investigating.toString() },
        ]);
      });

      /*
       * Every state timeline refuses a move back up the project's list, for
       * an episode as for an incident or an alert (Common/Utils/StateMove):
       * the card offers only the states the record may move into next.
       */
      test("the card offers only the states it may move into next, none back up the list", async (): Promise<void> => {
        const states: ProjectStates = kind.stubStates();
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: states.acknowledged,
        });
        (
          jest.spyOn(
            kind.stateService as { findBy: () => Promise<unknown> },
            "findBy",
          ) as AnySpy
        ).mockResolvedValue([
          { id: states.created, name: "First" },
          { id: states.acknowledged, name: "Second" },
          { id: states.resolved, name: "Last" },
        ]);
        const turn: FakeTurn = createTurn();

        await kind.handle({
          actionType: kind.changeState.view,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: memberProps([kind.role]),
          turnContext: turn.turnContext,
        });

        expect(turn.replies).toHaveLength(1);
        expect(cardChoices(turn.replies[0])).toEqual([
          { title: "Last", value: states.resolved.toString() },
        ]);
      });

      test("in the last state it can reach, the member is told there is no later state instead of a card", async (): Promise<void> => {
        const states: ProjectStates = kind.stubStates();
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: states.resolved,
        });
        (
          jest.spyOn(
            kind.stateService as { findBy: () => Promise<unknown> },
            "findBy",
          ) as AnySpy
        ).mockResolvedValue([
          { id: states.created, name: "First" },
          { id: states.acknowledged, name: "Second" },
          { id: states.resolved, name: "Last" },
        ]);
        const turn: FakeTurn = createTurn();

        await kind.handle({
          actionType: kind.changeState.view,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: memberProps([kind.role]),
          turnContext: turn.turnContext,
        });

        expect(turn.replies).toEqual([
          `There is no later state to move this ${kind.noun} to.`,
        ]);
      });

      test("a member who may read no states is told so instead of an empty card", async (): Promise<void> => {
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        jest
          .spyOn(
            kind.stateService as { findBy: () => Promise<unknown> },
            "findBy",
          )
          .mockResolvedValue([]);
        const turn: FakeTurn = createTurn();

        await kind.handle({
          actionType: kind.changeState.view,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: memberProps([kind.role]),
          turnContext: turn.turnContext,
        });

        expect(turn.replies).toEqual([kind.changeState.noStates]);
      });

      test("a member who may not change its state is refused before any card is built", async (): Promise<void> => {
        const statesSpy: AnySpy = jest.spyOn(
          kind.stateService as { findBy: () => Promise<unknown> },
          "findBy",
        ) as AnySpy;
        const turn: FakeTurn = createTurn();

        await expect(
          kind.handle({
            actionType: kind.changeState.view,
            actionValue: ObjectID.generate().toString(),
            value: {},
            props: memberProps([Permission.Viewer]),
            turnContext: turn.turnContext,
          }),
        ).rejects.toThrow(
          `You do not have permission to ${kind.changeState.refusal}.`,
        );

        expect(statesSpy).not.toHaveBeenCalled();
        expect(turn.replies).toEqual([]);
      });
    });

    describe.each(kind.notes)("Add Note ($label)", (note: TeamsNote): void => {
      test("the note is posted by the member, as their own", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        const createSpy: AnySpy = stubCreate(note.service);
        const recordId: ObjectID = ObjectID.generate();

        await kind.handle({
          actionType: noteActionType(kind),
          actionValue: recordId.toString(),
          value: note.value,
          props: props,
          turnContext: createTurn().turnContext,
        });

        const data: Record<string, unknown> = writtenWith(createSpy, props);
        expect(createSpy.mock.calls[0]![0].data).toBeInstanceOf(note.modelType);
        expect(data["note"]).toBe(note.value["note"]);
        expect(String(data[kind.timelineRecordColumn])).toBe(
          recordId.toString(),
        );
        expect(data["createdByUserId"]).toBeUndefined();
      });

      test("a member who may only read is refused, and nothing is posted", async (): Promise<void> => {
        const createSpy: AnySpy = stubCreate(note.service);

        await expect(
          kind.handle({
            actionType: noteActionType(kind),
            actionValue: ObjectID.generate().toString(),
            value: note.value,
            props: memberProps([Permission.Viewer]),
            turnContext: createTurn().turnContext,
          }),
        ).rejects.toThrow(`You do not have permission to ${note.refusal}.`);

        expect(createSpy).not.toHaveBeenCalled();
      });
    });

    describe("Execute On-Call Policy", (): void => {
      // The policy: readable, there but outside the member's read, or gone.
      function stubPolicy(readable: boolean | "outside"): AnySpy {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = ObjectID.generate();
        policy.projectId = projectId;

        if (readable === "outside") {
          return jest
            .spyOn(OnCallDutyPolicyService, "findOneBy")
            .mockImplementation((async (findOneBy: {
              props: { isRoot?: boolean };
            }) => {
              return findOneBy.props.isRoot ? policy : null;
            }) as never) as AnySpy;
        }

        return jest
          .spyOn(OnCallDutyPolicyService, "findOneBy")
          .mockResolvedValue(readable ? policy : null) as AnySpy;
      }

      test("the policy is executed by the member, for this record", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([
          kind.role,
          Permission.OnCallMember,
        ]);
        const readSpy: AnySpy = stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        const policyRead: AnySpy = stubPolicy(true);
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );
        const recordId: ObjectID = ObjectID.generate();
        const policyId: ObjectID = ObjectID.generate();

        await kind.handle({
          actionType: kind.execute.actionType,
          actionValue: recordId.toString(),
          value: { onCallPolicy: policyId.toString() },
          props: props,
          turnContext: createTurn().turnContext,
        });

        const data: Record<string, unknown> = writtenWith(createSpy, props);
        expect(String(data["onCallDutyPolicyId"])).toBe(policyId.toString());
        expect(String(data[kind.execute.triggerColumn])).toBe(
          recordId.toString(),
        );
        expect(data["userNotificationEventType"]).toBe(
          kind.execute.userNotificationEventType,
        );
        // The policy was read as the member, in this project.
        expect(policyRead.mock.calls[0]![0].props).toBe(props);
        expect(policyRead.mock.calls[0]![0].query).toMatchObject({
          projectId: projectId,
        });
        // The record once, by the check, which the execution acts on.
        expect(readSpy).toHaveBeenCalledTimes(1);
      });

      test("a member who may not execute on-call policies is refused, and no one is paged", async (): Promise<void> => {
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );

        await expect(
          kind.handle({
            actionType: kind.execute.actionType,
            actionValue: ObjectID.generate().toString(),
            value: { onCallPolicy: ObjectID.generate().toString() },
            props: memberProps([kind.role]),
            turnContext: createTurn().turnContext,
          }),
        ).rejects.toThrow(
          `You do not have permission to ${kind.execute.refusal}.`,
        );

        expect(createSpy).not.toHaveBeenCalled();
      });

      test("a policy outside the member's read is refused with that", async (): Promise<void> => {
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        stubPolicy("outside");
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );

        await expect(
          kind.handle({
            actionType: kind.execute.actionType,
            actionValue: ObjectID.generate().toString(),
            value: { onCallPolicy: ObjectID.generate().toString() },
            props: memberProps([kind.role, Permission.OnCallMember]),
            turnContext: createTurn().turnContext,
          }),
        ).rejects.toThrow(
          "your access in this project does not include this on-call policy. Ask a project admin for access to it.",
        );

        expect(createSpy).not.toHaveBeenCalled();
      });

      test("a policy that is gone is not found, and no one is paged", async (): Promise<void> => {
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        stubPolicy(false);
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );

        await expect(
          kind.handle({
            actionType: kind.execute.actionType,
            actionValue: ObjectID.generate().toString(),
            value: { onCallPolicy: ObjectID.generate().toString() },
            props: memberProps([kind.role, Permission.OnCallMember]),
            turnContext: createTurn().turnContext,
          }),
        ).rejects.toThrow(
          "the on-call policy was not found. It may have been deleted.",
        );

        expect(createSpy).not.toHaveBeenCalled();
      });
    });

    test(`viewing a ${kind.noun} reads it as the member, in their project, and one outside their read is refused with why`, async (): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
      const readSpy: AnySpy = stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: ObjectID.generate(),
        isOutsideMemberRead: true,
      });
      const turn: FakeTurn = createTurn();
      const recordId: ObjectID = ObjectID.generate();

      // Thrown for handleBotInvokeActivity to tell them, as every refusal is.
      await expect(
        kind.handle({
          actionType: kind.view.actionType,
          actionValue: recordId.toString(),
          value: {},
          props: props,
          turnContext: turn.turnContext,
        }),
      ).rejects.toThrow(
        `You do not have permission to see this ${kind.noun}: your access in this project does not include this ${kind.noun}. Ask a project admin for access to it.`,
      );

      expect(readSpy.mock.calls[0]![0].props).toBe(props);
      expect(readSpy.mock.calls[0]![0].query).toMatchObject({
        projectId: projectId,
      });
      expect(turn.replies).toEqual([]);
    });

    test(`viewing a ${kind.noun} that is gone says it was not found`, async (): Promise<void> => {
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: null,
      });

      await expect(
        kind.handle({
          actionType: kind.view.actionType,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: memberProps([kind.role]),
          turnContext: createTurn().turnContext,
        }),
      ).rejects.toThrow(
        `Could not see this ${kind.noun}: the ${kind.noun} was not found. It may have been deleted.`,
      );
    });
  },
);

// The note submit of each kind.
function noteActionType(kind: TeamsKind): string {
  switch (kind.name) {
    case "incident":
      return MicrosoftTeamsIncidentActionType.SubmitIncidentNote;
    case "alert":
      return MicrosoftTeamsAlertActionType.SubmitAlertNote;
    case "alert episode":
      return MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote;
    default:
      return MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote;
  }
}

/*
 * A public note asked for in a chat - a 📣, an Add Note form - first asks
 * whether its incident or episode is private, which takes no public notes
 * (WorkspaceReactionNote.getNoteTypeSavedAs, WorkspaceNoteForm): none of
 * these is.
 */
beforeEach((): void => {
  stubPrivateRecords();
});

describe("Microsoft Teams scheduled maintenance card actions", (): void => {
  const request: MicrosoftTeamsRequest = {
    isAuthorized: true,
    projectId: projectId,
    authToken: "",
    payloadType: "invoke",
    userId: userId.toString(),
  };

  interface MaintenanceStates {
    scheduled: ObjectID;
    ongoing: ObjectID;
    ended: ObjectID;
    completed: ObjectID;
  }

  /*
   * The event, read as the member, in `current` - one of the project's four
   * states, in their order - and the project's states as the moves read
   * them (getAllScheduledMaintenanceStates, as OneUptime).
   */
  function stubMaintenance(
    readable: boolean,
    current: keyof MaintenanceStates = "scheduled",
    // There, but only OneUptime's own read finds it (labels, owners).
    isOutsideMemberRead: boolean = false,
  ): {
    readSpy: AnySpy;
    states: MaintenanceStates;
  } {
    const states: MaintenanceStates = {
      scheduled: ObjectID.generate(),
      ongoing: ObjectID.generate(),
      ended: ObjectID.generate(),
      completed: ObjectID.generate(),
    };

    const makeState: (
      id: ObjectID,
      order: number,
      flag:
        | "isScheduledState"
        | "isOngoingState"
        | "isEndedState"
        | "isResolvedState",
    ) => ScheduledMaintenanceState = (
      id: ObjectID,
      order: number,
      flag:
        | "isScheduledState"
        | "isOngoingState"
        | "isEndedState"
        | "isResolvedState",
    ): ScheduledMaintenanceState => {
      const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
      state.id = id;
      state.order = order;
      state[flag] = true;
      return state;
    };

    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getAllScheduledMaintenanceStates",
      )
      .mockResolvedValue([
        makeState(states.scheduled, 1, "isScheduledState"),
        makeState(states.ongoing, 2, "isOngoingState"),
        makeState(states.ended, 3, "isEndedState"),
        makeState(states.completed, 4, "isResolvedState"),
      ]);

    return {
      readSpy: stubRecord({
        service: ScheduledMaintenanceService,
        makeRecord: (): unknown => {
          return new ScheduledMaintenance();
        },
        stateColumn: "currentScheduledMaintenanceStateId",
        currentStateId:
          readable || isOutsideMemberRead ? states[current] : null,
        isOutsideMemberRead: isOutsideMemberRead,
      }),
      states: states,
    };
  }

  async function press(data: {
    actionType: MicrosoftTeamsScheduledMaintenanceActionType;
    payload: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<FakeTurn> {
    const turn: FakeTurn = createTurn();

    await MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      data.actionType,
      turn.turnContext,
      data.payload,
      request,
      data.props,
    );

    return turn;
  }

  test.each([
    {
      label: "Mark as Ongoing",
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      target: "ongoing" as const,
      confirmation: "ScheduledMaintenance marked as ongoing",
    },
    {
      label: "Mark as Complete",
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      target: "completed" as const,
      confirmation: "ScheduledMaintenance marked as complete",
    },
  ])(
    "$label is made by the member, as themselves",
    async ({
      actionType,
      target,
      confirmation,
    }: {
      actionType: MicrosoftTeamsScheduledMaintenanceActionType;
      target: "ongoing" | "completed";
      confirmation: string;
    }): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([
        Permission.ScheduledMaintenanceMember,
      ]);
      const { readSpy, states } = stubMaintenance(true);
      const createSpy: AnySpy = stubCreate(
        ScheduledMaintenanceStateTimelineService,
      );
      const maintenanceId: ObjectID = ObjectID.generate();

      const turn: FakeTurn = await press({
        actionType: actionType,
        payload: { scheduledMaintenanceId: maintenanceId.toString() },
        props: props,
      });

      const data: Record<string, unknown> = writtenWith(createSpy, props);
      expect(String(data["scheduledMaintenanceId"])).toBe(
        maintenanceId.toString(),
      );
      expect(String(data["scheduledMaintenanceStateId"])).toBe(
        states[target].toString(),
      );
      // The press reads the event once, as the member, and acts on that read.
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy.mock.calls[0]![0].props).toBe(props);
      expect(repliesText(turn)).toEqual([confirmation]);
    },
  );

  test.each([
    {
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      refusal: "mark this scheduled maintenance event as ongoing",
    },
    {
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      refusal: "mark this scheduled maintenance event as complete",
    },
  ])(
    "a member who may only read cannot $refusal, is told why, and nothing is written",
    async ({
      actionType,
      refusal,
    }: {
      actionType: MicrosoftTeamsScheduledMaintenanceActionType;
      refusal: string;
    }): Promise<void> => {
      stubMaintenance(true);
      const createSpy: AnySpy = stubCreate(
        ScheduledMaintenanceStateTimelineService,
      );

      const turn: FakeTurn = await press({
        actionType: actionType,
        payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
        props: memberProps([Permission.Viewer]),
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(repliesText(turn)).toEqual([
        expect.stringContaining(`You do not have permission to ${refusal}.`),
      ]);
    },
  );

  test("an event outside the member's read is refused with that, never as one that is not there", async (): Promise<void> => {
    stubMaintenance(false, "scheduled", true);
    const createSpy: AnySpy = stubCreate(
      ScheduledMaintenanceStateTimelineService,
    );

    const turn: FakeTurn = await press({
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(repliesText(turn)).toEqual([
      "You do not have permission to mark this scheduled maintenance event as complete: your access in this project does not include this scheduled maintenance event. Ask a project admin for access to it.",
    ]);
  });

  test("an event that is gone is not found - it may have been deleted", async (): Promise<void> => {
    stubMaintenance(false);
    const createSpy: AnySpy = stubCreate(
      ScheduledMaintenanceStateTimelineService,
    );

    const turn: FakeTurn = await press({
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(repliesText(turn)).toEqual([
      "Could not mark this scheduled maintenance event as ongoing: the scheduled maintenance event was not found. It may have been deleted.",
    ]);
  });

  test.each([
    [
      MicrosoftTeamsScheduledMaintenanceActionType.ViewScheduledMaintenance,
      "see this scheduled maintenance event",
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.ViewAddScheduledMaintenanceNote,
      "add a note to this scheduled maintenance event",
    ],
    [
      MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
      "change the state of this scheduled maintenance event",
    ],
  ])(
    "%s on an event outside the member's read is refused as what it does: %s",
    async (
      actionType: MicrosoftTeamsScheduledMaintenanceActionType,
      does: string,
    ): Promise<void> => {
      stubMaintenance(false, "scheduled", true);

      const turn: FakeTurn = await press({
        actionType: actionType,
        payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
        props: memberProps([Permission.ScheduledMaintenanceMember]),
      });

      expect(repliesText(turn)).toEqual([
        `You do not have permission to ${does}: your access in this project does not include this scheduled maintenance event. Ask a project admin for access to it.`,
      ]);
    },
  );

  test("Mark as Complete on an event that is complete: who completed it, and when, and nothing is written", async (): Promise<void> => {
    const { states } = stubMaintenance(true, "completed");
    const createSpy: AnySpy = stubCreate(
      ScheduledMaintenanceStateTimelineService,
    );
    stubLateAnswerReads({
      timelineService: ScheduledMaintenanceStateTimelineService,
      rows: [
        {
          scheduledMaintenanceStateId: states.ongoing,
          startsAt: new Date("2026-10-08T17:00:00Z"),
        },
        {
          scheduledMaintenanceStateId: states.completed,
          startsAt: new Date(ACKNOWLEDGED_AT),
          createdByUserId: SIMON,
        },
      ],
    });

    const turn: FakeTurn = await press({
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(createSpy).not.toHaveBeenCalled();

    const answers: Array<string> = answerTexts(turn);

    expect(answers).toHaveLength(1);
    expect(
      answers[0]!.startsWith(
        `✅ **[Scheduled Maintenance](${DASHBOARD_URL}/${projectId.toString()}/`,
      ),
    ).toBe(true);
    expect(
      answers[0]!.endsWith(
        `)** was already completed by **Simon Lee** at {{TIME(${ACKNOWLEDGED_AT})}}.`,
      ),
    ).toBe(true);
  });

  test("a refusal naming something with Markdown in it is told as text", async (): Promise<void> => {
    stubMaintenance(true);
    stubCreate(ScheduledMaintenanceStateTimelineService).mockRejectedValue(
      new BadDataException(
        'The label "**Prod** [docs](https://example.com)" is not in this project.',
      ),
    );

    const turn: FakeTurn = await press({
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(repliesText(turn)).toEqual([
      'Sorry, that action failed: The label "\\*\\*Prod\\*\\* \\[docs\\](https://example.com)" is not in this project.',
    ]);
  });

  test.each([
    {
      label: "ongoing",
      current: "ongoing" as const,
      answer: "was already marked as ongoing",
    },
    {
      label: "over",
      current: "completed" as const,
      answer: "was already completed",
    },
  ])(
    "Mark as Ongoing on an event that is $label: told what it is, by whom and when, and nothing is written",
    async ({
      current,
      answer,
    }: {
      current: "ongoing" | "completed";
      answer: string;
    }): Promise<void> => {
      const { states } = stubMaintenance(true, current);
      const createSpy: AnySpy = stubCreate(
        ScheduledMaintenanceStateTimelineService,
      );
      stubLateAnswerReads({
        timelineService: ScheduledMaintenanceStateTimelineService,
        rows: [
          {
            scheduledMaintenanceStateId: states[current],
            startsAt: new Date(ACKNOWLEDGED_AT),
            createdByUserId: SIMON,
          },
        ],
      });

      const turn: FakeTurn = await press({
        actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
        payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
        props: memberProps([Permission.ScheduledMaintenanceMember]),
      });

      expect(createSpy).not.toHaveBeenCalled();

      const answers: Array<string> = answerTexts(turn);

      expect(answers).toHaveLength(1);
      expect(
        answers[0]!.endsWith(
          `)** ${answer} by **Simon Lee** at {{TIME(${ACKNOWLEDGED_AT})}}.`,
        ),
      ).toBe(true);
    },
  );

  test.each([
    {
      noteType: "public",
      service: ScheduledMaintenancePublicNoteService,
      modelType: ScheduledMaintenancePublicNote,
    },
    {
      noteType: "private",
      service: ScheduledMaintenanceInternalNoteService,
      modelType: ScheduledMaintenanceInternalNote,
    },
  ])(
    "a $noteType note is posted where the card's Note Type says, by the member",
    async ({
      noteType,
      service,
      modelType,
    }: {
      noteType: string;
      service: unknown;
      modelType: { new (): unknown };
    }): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([
        Permission.ScheduledMaintenanceMember,
      ]);
      stubMaintenance(true);
      const createSpy: AnySpy = stubCreate(service);
      const otherService: unknown =
        service === ScheduledMaintenancePublicNoteService
          ? ScheduledMaintenanceInternalNoteService
          : ScheduledMaintenancePublicNoteService;
      const otherCreate: AnySpy = stubCreate(otherService);
      const maintenanceId: ObjectID = ObjectID.generate();

      const turn: FakeTurn = await press({
        actionType:
          MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
        payload: {
          scheduledMaintenanceId: maintenanceId.toString(),
          noteType: noteType,
          note: "Replica first.",
        },
        props: props,
      });

      const data: Record<string, unknown> = writtenWith(createSpy, props);
      expect(createSpy.mock.calls[0]![0].data).toBeInstanceOf(modelType);
      expect(data["note"]).toBe("Replica first.");
      expect(String(data["scheduledMaintenanceId"])).toBe(
        maintenanceId.toString(),
      );
      expect(otherCreate).not.toHaveBeenCalled();
      expect(repliesText(turn)).toEqual(["Note added successfully"]);
    },
  );

  test("a note whose type is neither public nor private is refused plainly, and nothing is posted", async (): Promise<void> => {
    stubMaintenance(true);
    const publicCreate: AnySpy = stubCreate(
      ScheduledMaintenancePublicNoteService,
    );
    const privateCreate: AnySpy = stubCreate(
      ScheduledMaintenanceInternalNoteService,
    );

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
      payload: {
        scheduledMaintenanceId: ObjectID.generate().toString(),
        noteType: "everyone",
        note: "Replica first.",
      },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(publicCreate).not.toHaveBeenCalled();
    expect(privateCreate).not.toHaveBeenCalled();
    expect(repliesText(turn)).toEqual([
      "Unable to add note: invalid note type.",
    ]);
  });

  test("a member who may only read cannot post a public note, and is told why", async (): Promise<void> => {
    stubMaintenance(true);
    const createSpy: AnySpy = stubCreate(ScheduledMaintenancePublicNoteService);

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
      payload: {
        scheduledMaintenanceId: ObjectID.generate().toString(),
        noteType: "public",
        note: "Starting.",
      },
      props: memberProps([Permission.Viewer]),
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(repliesText(turn)).toEqual([
      expect.stringContaining(
        "add a public note to this scheduled maintenance event",
      ),
    ]);
  });

  test("Change State moves the event into the picked state, as the member", async (): Promise<void> => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ScheduledMaintenanceMember,
    ]);
    stubMaintenance(true);
    const createSpy: AnySpy = stubCreate(
      ScheduledMaintenanceStateTimelineService,
    );
    const maintenanceId: ObjectID = ObjectID.generate();
    const picked: ObjectID = ObjectID.generate();

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
      payload: {
        scheduledMaintenanceId: maintenanceId.toString(),
        stateId: picked.toString(),
      },
      props: props,
    });

    const data: Record<string, unknown> = writtenWith(createSpy, props);
    expect(String(data["scheduledMaintenanceId"])).toBe(
      maintenanceId.toString(),
    );
    expect(String(data["scheduledMaintenanceStateId"])).toBe(picked.toString());
    expect(repliesText(turn)).toEqual([
      "ScheduledMaintenance state changed successfully",
    ]);
  });

  test("the change-state card offers only the states the member may read", async (): Promise<void> => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ScheduledMaintenanceMember,
    ]);
    const ongoing: ObjectID = stubMaintenance(true).states.ongoing;
    const statesSpy: AnySpy = jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValue([
        {
          id: ongoing,
          name: "Ongoing",
        } as unknown as ScheduledMaintenanceState,
      ]) as AnySpy;

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: props,
    });

    expect(statesSpy.mock.calls[0]![0].props).toBe(props);
    expect(turn.replies).toHaveLength(1);
    expect(cardChoices(turn.replies[0])).toEqual([
      { title: "Ongoing", value: ongoing.toString() },
    ]);
  });

  test("the change-state card offers only the states the event may move into next", async (): Promise<void> => {
    const states: MaintenanceStates = stubMaintenance(true, "ongoing").states;
    jest.spyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue([
      { id: states.scheduled, name: "Scheduled" },
      { id: states.ongoing, name: "Ongoing" },
      { id: states.ended, name: "Ended" },
      { id: states.completed, name: "Completed" },
    ] as unknown as Array<ScheduledMaintenanceState>);

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(turn.replies).toHaveLength(1);
    expect(cardChoices(turn.replies[0])).toEqual([
      { title: "Ended", value: states.ended.toString() },
      { title: "Completed", value: states.completed.toString() },
    ]);
  });

  test("a completed event is answered with no later state instead of a card", async (): Promise<void> => {
    const states: MaintenanceStates = stubMaintenance(true, "completed").states;
    jest.spyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue([
      { id: states.scheduled, name: "Scheduled" },
      { id: states.completed, name: "Completed" },
    ] as unknown as Array<ScheduledMaintenanceState>);

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(turn.replies).toEqual([
      "There is no later state to move this scheduled maintenance event to.",
    ]);
  });

  test("a member who may read no states is told so instead of an empty card", async (): Promise<void> => {
    stubMaintenance(true);
    jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValue([]);

    const turn: FakeTurn = await press({
      actionType:
        MicrosoftTeamsScheduledMaintenanceActionType.ViewChangeScheduledMaintenanceState,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(turn.replies).toEqual([
      MicrosoftTeamsScheduledMaintenanceActions.NO_STATES_MESSAGE,
    ]);
  });
});

describe("Microsoft Teams Escalate", (): void => {
  interface EscalationCase {
    key: string;
    type: WorkspaceEventType;
    recordService: unknown;
    makeRecord: () => unknown;
    role: Permission;
    noun: string;
    triggerColumn: string;
    userNotificationEventType: UserNotificationEventType;
  }

  const ESCALATION_CASES: Array<EscalationCase> = [
    {
      key: "incidentId",
      type: WorkspaceEventType.Incident,
      recordService: IncidentService,
      makeRecord: (): unknown => {
        return new Incident();
      },
      role: Permission.IncidentMember,
      noun: "incident",
      triggerColumn: "triggeredByIncidentId",
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    },
    {
      key: "alertId",
      type: WorkspaceEventType.Alert,
      recordService: AlertService,
      makeRecord: (): unknown => {
        return new Alert();
      },
      role: Permission.AlertMember,
      noun: "alert",
      triggerColumn: "triggeredByAlertId",
      userNotificationEventType: UserNotificationEventType.AlertCreated,
    },
    {
      key: "incidentEpisodeId",
      type: WorkspaceEventType.IncidentEpisode,
      recordService: IncidentEpisodeService,
      makeRecord: (): unknown => {
        return new IncidentEpisode();
      },
      role: Permission.IncidentMember,
      noun: "incident episode",
      triggerColumn: "triggeredByIncidentEpisodeId",
      userNotificationEventType:
        UserNotificationEventType.IncidentEpisodeCreated,
    },
    {
      key: "alertEpisodeId",
      type: WorkspaceEventType.AlertEpisode,
      recordService: AlertEpisodeService,
      makeRecord: (): unknown => {
        return new AlertEpisode();
      },
      role: Permission.AlertMember,
      noun: "alert episode",
      triggerColumn: "triggeredByAlertEpisodeId",
      userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
    },
  ];

  function stubPolicy(): AnySpy {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = ObjectID.generate();
    policy.projectId = projectId;
    policy.name = "Payments on-call";
    return jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue(policy) as AnySpy;
  }

  test.each(ESCALATION_CASES)(
    "Escalate from a card for an $noun pages the policy for it, as the member",
    async (escalation: EscalationCase): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([
        escalation.role,
        Permission.OnCallMember,
      ]);
      const recordRead: AnySpy = stubRecord({
        service: escalation.recordService,
        makeRecord: escalation.makeRecord,
        stateColumn: "currentIncidentStateId",
        currentStateId: ObjectID.generate(),
      });
      const policyRead: AnySpy = stubPolicy();
      const createSpy: AnySpy = stubCreate(OnCallDutyPolicyExecutionLogService);
      const turn: FakeTurn = createTurn();
      const recordId: ObjectID = ObjectID.generate();
      const policyId: ObjectID = ObjectID.generate();

      await MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction({
        actionType: MicrosoftTeamsOnCallDutyActionType.EscalateOnCall,
        turnContext: turn.turnContext,
        actionPayload: {
          onCallDutyPolicyId: policyId.toString(),
          [escalation.key]: recordId.toString(),
        },
        projectId: projectId,
        databaseProps: props,
      });

      const data: Record<string, unknown> = writtenWith(createSpy, props);
      expect(String(data["onCallDutyPolicyId"])).toBe(policyId.toString());
      expect(String(data[escalation.triggerColumn])).toBe(recordId.toString());
      expect(data["userNotificationEventType"]).toBe(
        escalation.userNotificationEventType,
      );
      expect(policyRead.mock.calls[0]![0].props).toBe(props);
      expect(repliesText(turn)).toEqual([
        "On-call policy escalated successfully",
      ]);

      // The card's record is read once, as the member, and paged for as read.
      expect(recordRead).toHaveBeenCalledTimes(1);
      expect(recordRead.mock.calls[0]![0].props).toBe(props);
    },
  );

  test.each([
    { name: "no record", records: {} },
    {
      name: "two records",
      records: {
        incidentId: ObjectID.generate().toString(),
        alertId: ObjectID.generate().toString(),
      },
    },
  ])(
    "Escalate from a card naming $name is answered plainly, and pages no one",
    async ({ records }: { records: JSONObject }): Promise<void> => {
      const policyRead: AnySpy = stubPolicy();
      const createSpy: AnySpy = stubCreate(OnCallDutyPolicyExecutionLogService);
      const turn: FakeTurn = createTurn();

      await MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction({
        actionType: MicrosoftTeamsOnCallDutyActionType.EscalateOnCall,
        turnContext: turn.turnContext,
        actionPayload: {
          onCallDutyPolicyId: ObjectID.generate().toString(),
          ...records,
        },
        projectId: projectId,
        databaseProps: memberProps([Permission.ProjectOwner]),
      });

      expect(policyRead).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(turn.replies).toEqual([
        MicrosoftTeamsOnCallDutyActions.ESCALATE_NEEDS_RECORD_MESSAGE,
      ]);
    },
  );

  test("a member who may not execute on-call policies cannot escalate, and is refused before the policy is read", async (): Promise<void> => {
    const policyRead: AnySpy = stubPolicy();
    const createSpy: AnySpy = stubCreate(OnCallDutyPolicyExecutionLogService);

    await expect(
      MicrosoftTeamsOnCallDutyActions.handleBotOnCallDutyAction({
        actionType: MicrosoftTeamsOnCallDutyActionType.EscalateOnCall,
        turnContext: createTurn().turnContext,
        actionPayload: {
          onCallDutyPolicyId: ObjectID.generate().toString(),
          alertId: ObjectID.generate().toString(),
        },
        projectId: projectId,
        databaseProps: memberProps([Permission.AlertMember]),
      }),
    ).rejects.toThrow(
      "You do not have permission to execute this on-call policy for this alert.",
    );

    expect(policyRead).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("getEscalationRecord reads the one record a card names", (): void => {
    const incidentId: ObjectID = ObjectID.generate();

    expect(
      MicrosoftTeamsOnCallDutyActions.getEscalationRecord({
        onCallDutyPolicyId: ObjectID.generate().toString(),
        incidentId: incidentId.toString(),
      }),
    ).toEqual({ type: WorkspaceEventType.Incident, id: incidentId });

    expect(
      MicrosoftTeamsOnCallDutyActions.getEscalationRecord({
        onCallDutyPolicyId: ObjectID.generate().toString(),
      }),
    ).toBeNull();

    expect(
      MicrosoftTeamsOnCallDutyActions.getEscalationRecord({
        incidentEpisodeId: ObjectID.generate().toString(),
        alertEpisodeId: ObjectID.generate().toString(),
      }),
    ).toBeNull();
  });
});
