import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import AlertEpisodeInternalNoteService from "../../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertInternalNoteService from "../../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import ScheduledMaintenanceInternalNoteService from "../../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAlertActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import { SlackRequest } from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../../../Types/API/URL";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * EVERY SLACK BUTTON AND FORM THAT CHANGES A RECORD, PRESSED BY THE MEMBER
 * THE SLACK ACCOUNT IS CONNECTED TO.
 *
 * Per handler - incidents, alerts, alert and incident episodes, scheduled
 * maintenance - and per action: a member without the permission is told so
 * and nothing is written; a member with it writes the same row the
 * dashboard writes for them, with their own props, so the row is theirs (a
 * note is attributed to them, a state change was made by them); a record
 * outside the member's read - another project's, or outside their labels -
 * is refused like one that is not there; the change-state form offers only
 * the states the member may read, and says so instead of opening empty.
 *
 * The handlers, WorkspaceMemberActions and the permission checks are real;
 * the database reads, the creates and the Slack API are stubbed.
 * WorkspaceMemberActionsPostgres.test.ts runs the same writes against
 * Postgres.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const SLACK_USER_ID: string = "U0MEMBER";
const PROJECT_AUTH_TOKEN: string = "xoxb-project-token";

type HandlerArgs = {
  slackRequest: SlackRequest;
  action: { actionType: SlackActionType; actionValue: string };
  req: ExpressRequest;
  res: ExpressResponse;
};

// A current member of the project holding exactly `permissions`.
function mockMember(permissions: Array<Permission>): void {
  const member: TeamMember = new TeamMember();
  member.teamId = ObjectID.generate();
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([member]);

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

  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockResolvedValue(tenantPermission);
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(null);
}

function handlerArgs(
  actionType: SlackActionType,
  actionValue: string,
  viewValues: Dictionary<string | number | Array<string | number> | Date> = {},
): HandlerArgs {
  return {
    slackRequest: {
      isAuthorized: true,
      userId: userId,
      projectId: projectId,
      projectAuthToken: PROJECT_AUTH_TOKEN,
      botUserId: "B0BOT",
      slackUserId: SLACK_USER_ID,
      slackUsername: "member",
      slackChannelId: "C0CHANNEL",
      triggerId: "trigger-1",
      viewValues: viewValues,
    },
    action: { actionType: actionType, actionValue: actionValue },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  };
}

let directMessageSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
let showModalSpy: SpyInstance<typeof SlackUtil.showModalToUser>;

function directMessageTexts(): Array<string> {
  return directMessageSpy.mock.calls.map(
    (call: Parameters<typeof SlackUtil.sendDirectMessageToUser>): string => {
      const block: WorkspaceMessageBlock | undefined = call[0].messageBlocks[0];
      return (block as WorkspacePayloadMarkdown).text;
    },
  );
}

beforeEach((): void => {
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  jest
    .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
    .mockResolvedValue(undefined as never);
  directMessageSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue();
  showModalSpy = jest.spyOn(SlackUtil, "showModalToUser").mockResolvedValue();
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
  const make: (
    name: string,
    order: number,
    flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState",
  ) => T = (
    name: string,
    order: number,
    flag: "isCreatedState" | "isAcknowledgedState" | "isResolvedState",
  ): T => {
    const state: T = makeState();
    state.id = ObjectID.generate();
    state.projectId = projectId;
    state.name = name;
    state.order = order;
    state.isCreatedState = flag === "isCreatedState";
    state.isAcknowledgedState = flag === "isAcknowledgedState";
    state.isResolvedState = flag === "isResolvedState";
    return state;
  };

  const all: Array<T> = [
    make("Created", 1, "isCreatedState"),
    make("Acknowledged", 2, "isAcknowledgedState"),
    make("Resolved", 3, "isResolvedState"),
  ];

  return {
    ids: {
      created: all[0]!.id!,
      acknowledged: all[1]!.id!,
      resolved: all[2]!.id!,
    },
    all: all,
  };
}

// The record a button acts on, as the member's read finds it - or does not.
function stubRecord(data: {
  service: unknown;
  makeRecord: () => unknown;
  stateColumn: string;
  currentStateId: ObjectID | null;
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
  record[data.stateColumn] = data.currentStateId;
  return spy.mockResolvedValue(record);
}

// A create, kept from writing: it hands back what it was given.
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

// The row a create was handed, by column, and its props.
function created(createSpy: AnySpy): {
  data: Record<string, unknown>;
  props: { userId?: ObjectID; tenantId?: ObjectID; isRoot?: boolean };
} {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return createSpy.mock.calls[0]![0];
}

function expectMemberWrite(createSpy: AnySpy): Record<string, unknown> {
  const createBy: {
    data: Record<string, unknown>;
    props: { userId?: ObjectID; tenantId?: ObjectID; isRoot?: boolean };
  } = created(createSpy);

  // Made with the member's own props: they are the row's creator.
  expect(createBy.props.userId).toBe(userId);
  expect(createBy.props.tenantId).toBe(projectId);
  expect(createBy.props.isRoot).toBeUndefined();
  expect(String(createBy.data["projectId"])).toBe(projectId.toString());

  return createBy.data;
}

interface NoteAction {
  label: string;
  actionType: SlackActionType;
  viewValues: Dictionary<string>;
  service: unknown;
  modelType: { new (): unknown };
  refusal: string;
}

interface SlackKind {
  name: string;
  noun: string;
  handle: (args: HandlerArgs) => Promise<void>;
  recordService: unknown;
  makeRecord: () => unknown;
  recordStateColumn: string;
  // The role that may do everything below; executing also needs OnCallMember.
  role: Permission;
  timelineService: unknown;
  timelineRecordColumn: string;
  timelineStateColumn: string;
  // The project's states, stubbed; Acknowledge and Resolve move along them.
  stubStates: () => ProjectStates;
  // The service the change-state form reads the states from.
  stateService: unknown;
  // "Already acknowledged?" and the like, asked before the change.
  preChecks: Array<[unknown, string]>;
  acknowledge: { actionType: SlackActionType; refusal: string } | null;
  // Resolve; for a maintenance event, Mark as Complete.
  resolve: { actionType: SlackActionType; refusal: string };
  changeState: {
    view: SlackActionType;
    submit: SlackActionType;
    viewKey: string;
    refusal: string;
    noStates: string;
  };
  notes: Array<NoteAction>;
  execute: {
    actionType: SlackActionType;
    refusal: string;
    triggerColumn: string;
    userNotificationEventType: UserNotificationEventType;
  } | null;
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

// A maintenance event's states: Scheduled, Ongoing, Completed.
function maintenanceStates(): ProjectStates {
  const scheduled: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  scheduled.id = ObjectID.generate();
  const ongoing: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  ongoing.id = ObjectID.generate();
  const completed: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  completed.id = ObjectID.generate();

  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getOngoingScheduledMaintenanceState",
    )
    .mockResolvedValue(ongoing);
  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getCompletedScheduledMaintenanceState",
    )
    .mockResolvedValue(completed);

  // "Acknowledged" stands for Ongoing here; maintenance has no acknowledge.
  return {
    created: scheduled.id,
    acknowledged: ongoing.id,
    resolved: completed.id,
  };
}

const SLACK_KINDS: Array<SlackKind> = [
  {
    name: "incident",
    noun: "incident",
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(args);
    },
    recordService: IncidentService,
    makeRecord: (): unknown => {
      return new Incident();
    },
    recordStateColumn: "currentIncidentStateId",
    role: Permission.IncidentMember,
    timelineService: IncidentStateTimelineService,
    timelineRecordColumn: "incidentId",
    timelineStateColumn: "incidentStateId",
    stubStates: incidentStates,
    stateService: IncidentStateService,
    preChecks: [
      [IncidentService, "isIncidentAcknowledged"],
      [IncidentService, "isIncidentResolved"],
    ],
    acknowledge: {
      actionType: SlackActionType.AcknowledgeIncident,
      refusal: "acknowledge this incident",
    },
    resolve: {
      actionType: SlackActionType.ResolveIncident,
      refusal: "resolve this incident",
    },
    changeState: {
      view: SlackActionType.ViewChangeIncidentState,
      submit: SlackActionType.SubmitChangeIncidentState,
      viewKey: "incidentState",
      refusal: SlackIncidentActions.CHANGE_STATE_ACTION,
      noStates: SlackIncidentActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "public",
        actionType: SlackActionType.SubmitIncidentNote,
        viewValues: { noteType: "public", note: "Payments are back." },
        service: IncidentPublicNoteService,
        modelType: IncidentPublicNote,
        refusal: "add a public note to this incident",
      },
      {
        label: "private",
        actionType: SlackActionType.SubmitIncidentNote,
        viewValues: { noteType: "private", note: "Rolled back 4.2.1." },
        service: IncidentInternalNoteService,
        modelType: IncidentInternalNote,
        refusal: "add a private note to this incident",
      },
    ],
    execute: {
      actionType: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
      refusal: "execute an on-call policy for this incident",
      triggerColumn: "triggeredByIncidentId",
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    },
  },
  {
    name: "alert",
    noun: "alert",
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackAlertActions.handleAlertAction(args);
    },
    recordService: AlertService,
    makeRecord: (): unknown => {
      return new Alert();
    },
    recordStateColumn: "currentAlertStateId",
    role: Permission.AlertMember,
    timelineService: AlertStateTimelineService,
    timelineRecordColumn: "alertId",
    timelineStateColumn: "alertStateId",
    stubStates: alertStates,
    stateService: AlertStateService,
    preChecks: [
      [AlertService, "isAlertAcknowledged"],
      [AlertService, "isAlertResolved"],
    ],
    acknowledge: {
      actionType: SlackActionType.AcknowledgeAlert,
      refusal: "acknowledge this alert",
    },
    resolve: {
      actionType: SlackActionType.ResolveAlert,
      refusal: "resolve this alert",
    },
    changeState: {
      view: SlackActionType.ViewChangeAlertState,
      submit: SlackActionType.SubmitChangeAlertState,
      viewKey: "alertState",
      refusal: SlackAlertActions.CHANGE_STATE_ACTION,
      noStates: SlackAlertActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "private",
        actionType: SlackActionType.SubmitAlertNote,
        viewValues: { note: "Disk freed." },
        service: AlertInternalNoteService,
        modelType: AlertInternalNote,
        refusal: "add a private note to this alert",
      },
    ],
    execute: {
      actionType: SlackActionType.SubmitExecuteAlertOnCallPolicy,
      refusal: "execute an on-call policy for this alert",
      triggerColumn: "triggeredByAlertId",
      userNotificationEventType: UserNotificationEventType.AlertCreated,
    },
  },
  {
    name: "alert episode",
    noun: "alert episode",
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackAlertEpisodeActions.handleAlertEpisodeAction(args);
    },
    recordService: AlertEpisodeService,
    makeRecord: (): unknown => {
      return new AlertEpisode();
    },
    recordStateColumn: "currentAlertStateId",
    role: Permission.AlertMember,
    timelineService: AlertEpisodeStateTimelineService,
    timelineRecordColumn: "alertEpisodeId",
    timelineStateColumn: "alertStateId",
    stubStates: alertStates,
    stateService: AlertStateService,
    preChecks: [
      [AlertEpisodeService, "isEpisodeAcknowledged"],
      [AlertEpisodeService, "isEpisodeResolved"],
    ],
    acknowledge: {
      actionType: SlackActionType.AcknowledgeAlertEpisode,
      refusal: "acknowledge this alert episode",
    },
    resolve: {
      actionType: SlackActionType.ResolveAlertEpisode,
      refusal: "resolve this alert episode",
    },
    changeState: {
      view: SlackActionType.ViewChangeAlertEpisodeState,
      submit: SlackActionType.SubmitChangeAlertEpisodeState,
      viewKey: "episodeState",
      refusal: SlackAlertEpisodeActions.CHANGE_STATE_ACTION,
      noStates: SlackAlertEpisodeActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "private",
        actionType: SlackActionType.SubmitAlertEpisodeNote,
        viewValues: { note: "Grouped by the deploy." },
        service: AlertEpisodeInternalNoteService,
        modelType: AlertEpisodeInternalNote,
        refusal: "add a private note to this alert episode",
      },
    ],
    execute: {
      actionType: SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
      refusal: "execute an on-call policy for this alert episode",
      triggerColumn: "triggeredByAlertEpisodeId",
      userNotificationEventType: UserNotificationEventType.AlertEpisodeCreated,
    },
  },
  {
    name: "incident episode",
    noun: "incident episode",
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackIncidentEpisodeActions.handleIncidentEpisodeAction(args);
    },
    recordService: IncidentEpisodeService,
    makeRecord: (): unknown => {
      return new IncidentEpisode();
    },
    recordStateColumn: "currentIncidentStateId",
    role: Permission.IncidentMember,
    timelineService: IncidentEpisodeStateTimelineService,
    timelineRecordColumn: "incidentEpisodeId",
    timelineStateColumn: "incidentStateId",
    stubStates: incidentStates,
    stateService: IncidentStateService,
    preChecks: [
      [IncidentEpisodeService, "isEpisodeAcknowledged"],
      [IncidentEpisodeService, "isEpisodeResolved"],
    ],
    acknowledge: {
      actionType: SlackActionType.AcknowledgeIncidentEpisode,
      refusal: "acknowledge this incident episode",
    },
    resolve: {
      actionType: SlackActionType.ResolveIncidentEpisode,
      refusal: "resolve this incident episode",
    },
    changeState: {
      view: SlackActionType.ViewChangeIncidentEpisodeState,
      submit: SlackActionType.SubmitChangeIncidentEpisodeState,
      viewKey: "episodeState",
      refusal: SlackIncidentEpisodeActions.CHANGE_STATE_ACTION,
      noStates: SlackIncidentEpisodeActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "public",
        actionType: SlackActionType.SubmitIncidentEpisodeNote,
        viewValues: { noteType: "public", note: "Checkout is back." },
        service: IncidentEpisodePublicNoteService,
        modelType: IncidentEpisodePublicNote,
        refusal: "add a public note to this incident episode",
      },
      {
        label: "private",
        actionType: SlackActionType.SubmitIncidentEpisodeNote,
        viewValues: { noteType: "private", note: "One root cause." },
        service: IncidentEpisodeInternalNoteService,
        modelType: IncidentEpisodeInternalNote,
        refusal: "add a private note to this incident episode",
      },
    ],
    execute: {
      actionType: SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
      refusal: "execute an on-call policy for this incident episode",
      triggerColumn: "triggeredByIncidentEpisodeId",
      userNotificationEventType:
        UserNotificationEventType.IncidentEpisodeCreated,
    },
  },
  {
    name: "scheduled maintenance event",
    noun: "scheduled maintenance event",
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        args,
      );
    },
    recordService: ScheduledMaintenanceService,
    makeRecord: (): unknown => {
      return new ScheduledMaintenance();
    },
    recordStateColumn: "currentScheduledMaintenanceStateId",
    role: Permission.ScheduledMaintenanceMember,
    timelineService: ScheduledMaintenanceStateTimelineService,
    timelineRecordColumn: "scheduledMaintenanceId",
    timelineStateColumn: "scheduledMaintenanceStateId",
    stubStates: maintenanceStates,
    stateService: ScheduledMaintenanceStateService,
    preChecks: [
      [ScheduledMaintenanceService, "isScheduledMaintenanceOngoing"],
      [ScheduledMaintenanceService, "isScheduledMaintenanceCompleted"],
    ],
    acknowledge: null,
    resolve: {
      actionType: SlackActionType.MarkScheduledMaintenanceAsComplete,
      refusal: "mark this scheduled maintenance event as complete",
    },
    changeState: {
      view: SlackActionType.ViewChangeScheduledMaintenanceState,
      submit: SlackActionType.SubmitChangeScheduledMaintenanceState,
      viewKey: "scheduledMaintenanceState",
      refusal: SlackScheduledMaintenanceActions.CHANGE_STATE_ACTION,
      noStates: SlackScheduledMaintenanceActions.NO_STATES_MESSAGE,
    },
    notes: [
      {
        label: "public",
        actionType: SlackActionType.SubmitScheduledMaintenanceNote,
        viewValues: { noteType: "public", note: "Starting now." },
        service: ScheduledMaintenancePublicNoteService,
        modelType: ScheduledMaintenancePublicNote,
        refusal: "add a public note to this scheduled maintenance event",
      },
      {
        label: "private",
        actionType: SlackActionType.SubmitScheduledMaintenanceNote,
        viewValues: { noteType: "private", note: "Replica first." },
        service: ScheduledMaintenanceInternalNoteService,
        modelType: ScheduledMaintenanceInternalNote,
        refusal: "add a private note to this scheduled maintenance event",
      },
    ],
    execute: null,
  },
];

// Every "is it acknowledged / resolved / ongoing already?" answered no.
function answerPreChecksNo(kind: SlackKind): void {
  for (const [service, method] of kind.preChecks) {
    jest
      .spyOn(service as Record<string, () => Promise<boolean>>, method)
      .mockResolvedValue(false);
  }
}

interface StateMove {
  label: string;
  actionType: SlackActionType;
  refusal: string;
  // The state the move lands in, from the project's states.
  target: (states: ProjectStates) => ObjectID;
}

function stateMovesOf(kind: SlackKind): Array<StateMove> {
  const moves: Array<StateMove> = [];

  if (kind.acknowledge) {
    moves.push({
      label: "Acknowledge",
      actionType: kind.acknowledge.actionType,
      refusal: kind.acknowledge.refusal,
      target: (states: ProjectStates): ObjectID => {
        return states.acknowledged;
      },
    });
  } else {
    moves.push({
      label: "Mark as Ongoing",
      actionType: SlackActionType.MarkScheduledMaintenanceAsOngoing,
      refusal: "mark this scheduled maintenance event as ongoing",
      target: (states: ProjectStates): ObjectID => {
        return states.acknowledged;
      },
    });
  }

  moves.push({
    label: kind.acknowledge ? "Resolve" : "Mark as Complete",
    actionType: kind.resolve.actionType,
    refusal: kind.resolve.refusal,
    target: (states: ProjectStates): ObjectID => {
      return states.resolved;
    },
  });

  return moves;
}

describe.each(SLACK_KINDS)("Slack $name buttons", (kind: SlackKind): void => {
  describe.each(stateMovesOf(kind))("$label", (move: StateMove): void => {
    test("a member who holds the permission changes the state as themselves", async (): Promise<void> => {
      mockMember([kind.role]);
      const states: ProjectStates = kind.stubStates();
      answerPreChecksNo(kind);
      const readSpy: AnySpy = stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.created,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);
      const recordId: ObjectID = ObjectID.generate();

      await kind.handle(handlerArgs(move.actionType, recordId.toString()));

      const data: Record<string, unknown> = expectMemberWrite(createSpy);
      expect(String(data[kind.timelineRecordColumn])).toBe(recordId.toString());
      expect(String(data[kind.timelineStateColumn])).toBe(
        move.target(states).toString(),
      );
      // The record was read as the member, in this project, every time.
      for (const call of readSpy.mock.calls) {
        expect(call[0].props.userId).toBe(userId);
        expect(call[0].props.isRoot).toBeUndefined();
        expect(call[0].query).toMatchObject({ projectId: projectId });
      }
      expect(directMessageSpy).not.toHaveBeenCalled();
    });

    test("a member who may only read is told why, and nothing is written", async (): Promise<void> => {
      mockMember([Permission.Viewer]);
      const states: ProjectStates = kind.stubStates();
      answerPreChecksNo(kind);
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.created,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);

      await kind.handle(
        handlerArgs(move.actionType, ObjectID.generate().toString()),
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        expect.stringContaining(
          `You do not have permission to ${move.refusal}.`,
        ),
      ]);
    });

    test(`a ${kind.noun} outside the member's read is refused like one that is not there`, async (): Promise<void> => {
      mockMember([kind.role]);
      kind.stubStates();
      answerPreChecksNo(kind);
      // Another project's, or outside the member's labels: not found for them.
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: null,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);

      await kind.handle(
        handlerArgs(move.actionType, ObjectID.generate().toString()),
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        expect.stringContaining(
          `the ${kind.noun} was not found in this project, or you do not have access to it.`,
        ),
      ]);
    });
  });

  describe("Change State", (): void => {
    test("a member who holds the permission moves it into the state they picked, as themselves", async (): Promise<void> => {
      mockMember([kind.role]);
      const states: ProjectStates = kind.stubStates();
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.created,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);
      const recordId: ObjectID = ObjectID.generate();
      const picked: ObjectID = ObjectID.generate();

      await kind.handle(
        handlerArgs(kind.changeState.submit, recordId.toString(), {
          [kind.changeState.viewKey]: picked.toString(),
        }),
      );

      const data: Record<string, unknown> = expectMemberWrite(createSpy);
      expect(String(data[kind.timelineRecordColumn])).toBe(recordId.toString());
      expect(String(data[kind.timelineStateColumn])).toBe(picked.toString());
      // Nothing but what the dashboard's state panel sends.
      expect(
        Object.keys(data)
          .filter((key: string): boolean => {
            return data[key] !== undefined && key !== "isPermissionIf";
          })
          .sort(),
      ).toEqual(
        [
          "projectId",
          kind.timelineRecordColumn,
          kind.timelineStateColumn,
        ].sort(),
      );
    });

    test("a member who may only read is told why, and nothing is written", async (): Promise<void> => {
      mockMember([Permission.Viewer]);
      const createSpy: AnySpy = stubCreate(kind.timelineService);

      await kind.handle(
        handlerArgs(kind.changeState.submit, ObjectID.generate().toString(), {
          [kind.changeState.viewKey]: ObjectID.generate().toString(),
        }),
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        expect.stringContaining(
          `You do not have permission to ${kind.changeState.refusal}.`,
        ),
      ]);
    });

    test("a refusal from the state change itself is told to the member", async (): Promise<void> => {
      mockMember([kind.role]);
      const states: ProjectStates = kind.stubStates();
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.created,
      });
      jest
        .spyOn(
          kind.timelineService as { create: () => Promise<unknown> },
          "create",
        )
        .mockRejectedValue(
          new NotAuthorizedException(
            "The state you are trying to reference does not exist.",
          ),
        );

      await kind.handle(
        handlerArgs(kind.changeState.submit, ObjectID.generate().toString(), {
          [kind.changeState.viewKey]: ObjectID.generate().toString(),
        }),
      );

      expect(directMessageTexts()).toEqual([
        expect.stringContaining(
          "The state you are trying to reference does not exist.",
        ),
      ]);
    });

    test("the form offers only the states the member may read, read as the member", async (): Promise<void> => {
      mockMember([kind.role]);
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: ObjectID.generate(),
      });
      const first: { id: ObjectID; name: string } = {
        id: ObjectID.generate(),
        name: "Investigating",
      };
      const second: { id: ObjectID; name: string } = {
        id: ObjectID.generate(),
        name: "Mitigated",
      };
      const statesSpy: AnySpy = (
        jest.spyOn(
          kind.stateService as { findBy: () => Promise<unknown> },
          "findBy",
        ) as AnySpy
      ).mockResolvedValue([first, second]);

      await kind.handle(
        handlerArgs(kind.changeState.view, ObjectID.generate().toString()),
      );

      expect(statesSpy).toHaveBeenCalledTimes(1);
      expect(statesSpy.mock.calls[0]![0].props.userId).toBe(userId);
      expect(statesSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
      expect(statesSpy.mock.calls[0]![0].query).toEqual({
        projectId: projectId,
      });

      expect(showModalSpy).toHaveBeenCalledTimes(1);
      const modal: WorkspaceModalBlock =
        showModalSpy.mock.calls[0]![0].modalBlock;
      const dropdown: WorkspaceDropdownBlock = modal
        .blocks[0] as WorkspaceDropdownBlock;
      expect(dropdown.options).toEqual([
        { label: "Investigating", value: first.id.toString() },
        { label: "Mitigated", value: second.id.toString() },
      ]);
      expect(directMessageSpy).not.toHaveBeenCalled();
    });

    test("a member who may read no states is told so, and no empty form opens", async (): Promise<void> => {
      mockMember([kind.role]);
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
        .mockRejectedValue(
          new NotAuthorizedException("You do not have permissions to read."),
        );

      await kind.handle(
        handlerArgs(kind.changeState.view, ObjectID.generate().toString()),
      );

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        expect.stringContaining(kind.changeState.noStates),
      ]);
    });

    test("a member who may not change its state is told so before any form opens", async (): Promise<void> => {
      mockMember([Permission.Viewer]);
      const statesSpy: AnySpy = jest.spyOn(
        kind.stateService as { findBy: () => Promise<unknown> },
        "findBy",
      ) as AnySpy;

      await kind.handle(
        handlerArgs(kind.changeState.view, ObjectID.generate().toString()),
      );

      expect(statesSpy).not.toHaveBeenCalled();
      expect(showModalSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        expect.stringContaining(
          `You do not have permission to ${kind.changeState.refusal}.`,
        ),
      ]);
    });
  });

  describe.each(kind.notes)(
    "Add Note ($label)",
    (noteAction: NoteAction): void => {
      test("the note is posted by the member, as their own", async (): Promise<void> => {
        mockMember([kind.role]);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        const createSpy: AnySpy = stubCreate(noteAction.service);
        const recordId: ObjectID = ObjectID.generate();

        await kind.handle(
          handlerArgs(
            noteAction.actionType,
            recordId.toString(),
            noteAction.viewValues,
          ),
        );

        const data: Record<string, unknown> = expectMemberWrite(createSpy);
        expect(createSpy.mock.calls[0]![0].data).toBeInstanceOf(
          noteAction.modelType,
        );
        expect(data["note"]).toBe(noteAction.viewValues["note"]);
        expect(String(data[kind.timelineRecordColumn])).toBe(
          recordId.toString(),
        );
        // Who wrote it is OneUptime's to stamp, from the props: not sent.
        expect(data["createdByUserId"]).toBeUndefined();
        expect(directMessageSpy).not.toHaveBeenCalled();
      });

      test("a member who may only read is told why, and nothing is posted", async (): Promise<void> => {
        mockMember([Permission.Viewer]);
        const createSpy: AnySpy = stubCreate(noteAction.service);

        await kind.handle(
          handlerArgs(
            noteAction.actionType,
            ObjectID.generate().toString(),
            noteAction.viewValues,
          ),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()).toEqual([
          expect.stringContaining(
            `You do not have permission to ${noteAction.refusal}.`,
          ),
        ]);
      });

      test(`a note on a ${kind.noun} outside the member's read is refused`, async (): Promise<void> => {
        mockMember([kind.role]);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: null,
        });
        const createSpy: AnySpy = stubCreate(noteAction.service);

        await kind.handle(
          handlerArgs(
            noteAction.actionType,
            ObjectID.generate().toString(),
            noteAction.viewValues,
          ),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()[0]).toContain(
          `the ${kind.noun} was not found in this project`,
        );
      });
    },
  );

  if (kind.execute) {
    const execute: NonNullable<SlackKind["execute"]> = kind.execute;

    describe("Execute On-Call Policy", (): void => {
      function stubPolicy(readable: boolean): void {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = ObjectID.generate();
        policy.projectId = projectId;
        jest
          .spyOn(OnCallDutyPolicyService, "findOneBy")
          .mockResolvedValue(readable ? policy : null);
      }

      test("the policy is executed by the member, for this record", async (): Promise<void> => {
        mockMember([kind.role, Permission.OnCallMember]);
        answerPreChecksNo(kind);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        stubPolicy(true);
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );
        const recordId: ObjectID = ObjectID.generate();
        const policyId: ObjectID = ObjectID.generate();

        await kind.handle(
          handlerArgs(execute.actionType, recordId.toString(), {
            onCallPolicy: policyId.toString(),
          }),
        );

        const data: Record<string, unknown> = expectMemberWrite(createSpy);
        expect(String(data["onCallDutyPolicyId"])).toBe(policyId.toString());
        expect(String(data[execute.triggerColumn])).toBe(recordId.toString());
        expect(data["userNotificationEventType"]).toBe(
          execute.userNotificationEventType,
        );
        expect(directMessageSpy).not.toHaveBeenCalled();
      });

      test("a member who may not execute on-call policies is told why, and no one is paged", async (): Promise<void> => {
        mockMember([kind.role]);
        answerPreChecksNo(kind);
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );

        await kind.handle(
          handlerArgs(execute.actionType, ObjectID.generate().toString(), {
            onCallPolicy: ObjectID.generate().toString(),
          }),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()).toEqual([
          expect.stringContaining(
            `You do not have permission to ${execute.refusal}.`,
          ),
        ]);
      });

      test("a policy outside the member's read is refused like one that is not there", async (): Promise<void> => {
        mockMember([kind.role, Permission.OnCallMember]);
        answerPreChecksNo(kind);
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

        await kind.handle(
          handlerArgs(execute.actionType, ObjectID.generate().toString(), {
            onCallPolicy: ObjectID.generate().toString(),
          }),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(directMessageTexts()[0]).toContain(
          "the on-call policy was not found in this project",
        );
      });
    });
  }
});

/*
 * Mark as Ongoing on an event that has started already is answered with
 * what the event is: ongoing, or over. Nothing is written either way.
 */
describe("Slack Mark as Ongoing on an event that has started already", (): void => {
  test.each([
    ["ongoing", false, "is already in ongoing state."],
    ["over", true, "is already complete."],
  ])(
    "an event that is %s is refused with what it is, and nothing is written",
    async (
      _label: string,
      isCompleted: boolean,
      ending: string,
    ): Promise<void> => {
      mockMember([Permission.ScheduledMaintenanceMember]);
      const states: ProjectStates = maintenanceStates();
      stubRecord({
        service: ScheduledMaintenanceService,
        makeRecord: (): unknown => {
          return new ScheduledMaintenance();
        },
        stateColumn: "currentScheduledMaintenanceStateId",
        currentStateId: states.acknowledged,
      });
      jest
        .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceOngoing")
        .mockResolvedValue(true);
      jest
        .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
        .mockResolvedValue(isCompleted);
      jest
        .spyOn(ScheduledMaintenanceService, "getScheduledMaintenanceNumber")
        .mockResolvedValue({ number: 7, numberWithPrefix: "SM-7" });
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(URL.fromString("https://oneuptime.test/sm/7"));
      const createSpy: AnySpy = stubCreate(
        ScheduledMaintenanceStateTimelineService,
      );

      await SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        handlerArgs(
          SlackActionType.MarkScheduledMaintenanceAsOngoing,
          ObjectID.generate().toString(),
        ),
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(directMessageTexts()).toEqual([
        `@member, unfortunately you cannot change the state to ongoing because the **[Scheduled Maintenance SM-7](https://oneuptime.test/sm/7)** ${ending}`,
      ]);
    },
  );
});
