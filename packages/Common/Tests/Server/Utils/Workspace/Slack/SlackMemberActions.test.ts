import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubPrivateRecords } from "../../../TestingUtils/PrivateRecords";
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
import UserService from "../../../../../Server/Services/UserService";
import User from "../../../../../Models/DatabaseModels/User";
import Name from "../../../../../Types/Name";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import OnCallPersonPageAnswer from "../../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
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
import { DropdownOption } from "../../../../../UI/Components/Dropdown/Dropdown";

/*
 * EVERY SLACK BUTTON AND FORM THAT CHANGES A RECORD, PRESSED BY THE MEMBER
 * THE SLACK ACCOUNT IS CONNECTED TO.
 *
 * Per handler - incidents, alerts, alert and incident episodes, scheduled
 * maintenance - and per action: a member without the permission is told so
 * and nothing is written; a member with it writes the same row the
 * dashboard writes for them, with their own props, so the row is theirs (a
 * note is attributed to them, a state change was made by them); a record
 * outside the member's read - outside their labels or owners - is refused
 * with that, and one that is gone as not found; the change-state form offers only
 * the states the member may read that the record may move into next, and
 * says why instead of opening empty.
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
let ephemeralSpy: SpyInstance<typeof SlackUtil.sendEphemeralMessageToChannel>;
let showModalSpy: SpyInstance<typeof SlackUtil.showModalToUser>;

/*
 * What the member was told, in order: a message only they see, in the
 * channel they pressed in (SlackActionAnswer) - never a direct message,
 * where the customer who reported it never looked.
 */
function answerTexts(): Array<string> {
  expect(directMessageSpy).not.toHaveBeenCalled();

  return ephemeralSpy.mock.calls.map(
    (
      call: Parameters<typeof SlackUtil.sendEphemeralMessageToChannel>,
    ): string => {
      expect(call[0]).toMatchObject({
        channelId: "C0CHANNEL",
        userId: SLACK_USER_ID,
      });
      const block: WorkspaceMessageBlock | undefined = call[0].messageBlocks[0];
      return (block as WorkspacePayloadMarkdown).text;
    },
  );
}

// The press was done and needed no answer: nothing in the channel, no DM.
function expectNoAnswer(): void {
  expect(directMessageSpy).not.toHaveBeenCalled();
  expect(ephemeralSpy).not.toHaveBeenCalled();
}

beforeEach((): void => {
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  // The project is not blocked (WorkspaceActionAuthorization asks).
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  // Nor a blocked person (WorkspaceActionAuthorization asks that too).
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  jest
    .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
    .mockResolvedValue(undefined as never);
  directMessageSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue();
  ephemeralSpy = jest
    .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
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
  // Other columns the read finds: the record's number, say.
  columns?: Record<string, unknown> | undefined;
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
  record[data.stateColumn] = data.currentStateId;
  Object.assign(record, data.columns || {});

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

// A maintenance event's states, in their order: Scheduled, Ongoing, Completed.
function maintenanceStates(): ProjectStates {
  const make: (
    order: number,
    flag: "isScheduledState" | "isOngoingState" | "isResolvedState",
  ) => ScheduledMaintenanceState = (
    order: number,
    flag: "isScheduledState" | "isOngoingState" | "isResolvedState",
  ): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.id = ObjectID.generate();
    state.projectId = projectId;
    state.order = order;
    state[flag] = true;
    return state;
  };

  const scheduled: ScheduledMaintenanceState = make(1, "isScheduledState");
  const ongoing: ScheduledMaintenanceState = make(2, "isOngoingState");
  const completed: ScheduledMaintenanceState = make(3, "isResolvedState");

  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue([scheduled, ongoing, completed]);

  // "Acknowledged" stands for Ongoing here; maintenance has no acknowledge.
  return {
    created: scheduled.id!,
    acknowledged: ongoing.id!,
    resolved: completed.id!,
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
      // The record was read once, as the member, in this project.
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy.mock.calls[0]![0].props.userId).toBe(userId);
      expect(readSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
      expect(readSpy.mock.calls[0]![0].query).toMatchObject({
        projectId: projectId,
      });
      expectNoAnswer();
    });

    test("a member who may only read is told why, and nothing is written", async (): Promise<void> => {
      mockMember([Permission.Viewer]);
      const states: ProjectStates = kind.stubStates();
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
      expect(answerTexts()).toEqual([
        expect.stringContaining(
          `You do not have permission to ${move.refusal}.`,
        ),
      ]);
    });

    test(`a ${kind.noun} outside the member's read is refused with that, never as one that is not there`, async (): Promise<void> => {
      mockMember([kind.role]);
      kind.stubStates();
      // Outside the member's labels or owners: there, but not for them.
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: ObjectID.generate(),
        isOutsideMemberRead: true,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);

      await kind.handle(
        handlerArgs(move.actionType, ObjectID.generate().toString()),
      );

      expect(createSpy).not.toHaveBeenCalled();
      expect(answerTexts()).toEqual([
        `You do not have permission to ${move.refusal}: your access in this project does not include this ${kind.noun}. Ask a project admin for access to it.`,
      ]);
    });

    test(`a ${kind.noun} that is gone is not found, and nothing is written`, async (): Promise<void> => {
      mockMember([kind.role]);
      kind.stubStates();
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
      expect(answerTexts()).toEqual([
        `Could not ${move.refusal}: the ${kind.noun} was not found. It may have been deleted.`,
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
      expect(answerTexts()).toEqual([
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

      expect(answerTexts()).toEqual([
        expect.stringContaining(
          "The state you are trying to reference does not exist.",
        ),
      ]);
    });

    test("the form offers only the states the member may read, read as the member", async (): Promise<void> => {
      mockMember([kind.role]);
      const states: ProjectStates = kind.stubStates();
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.created,
      });
      // Of the project's states, the member may read these two.
      const first: { id: ObjectID; name: string } = {
        id: states.acknowledged,
        name: "Investigating",
      };
      const second: { id: ObjectID; name: string } = {
        id: states.resolved,
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
      // Never an archived state: nobody may move a record into one.
      expect(statesSpy.mock.calls[0]![0].query).toEqual({
        projectId: projectId,
        isArchived: false,
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
      expectNoAnswer();
    });

    /*
     * Every state timeline refuses a move back up the project's list, for
     * an episode as for an incident or an alert (Common/Utils/StateMove):
     * the form offers only the states the record may move into next.
     */
    test("the form offers only the states it may move into next, none back up the list", async (): Promise<void> => {
      mockMember([kind.role]);
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

      await kind.handle(
        handlerArgs(kind.changeState.view, ObjectID.generate().toString()),
      );

      expect(showModalSpy).toHaveBeenCalledTimes(1);
      const modal: WorkspaceModalBlock =
        showModalSpy.mock.calls[0]![0].modalBlock;
      const dropdown: WorkspaceDropdownBlock = modal
        .blocks[0] as WorkspaceDropdownBlock;
      expect(dropdown.options).toEqual([
        { label: "Last", value: states.resolved.toString() },
      ]);
      expectNoAnswer();
    });

    test("in the last state it can reach, the member is told there is no later state, and no form opens", async (): Promise<void> => {
      mockMember([kind.role]);
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

      await kind.handle(
        handlerArgs(kind.changeState.view, ObjectID.generate().toString()),
      );

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(answerTexts()).toEqual([
        expect.stringContaining(
          `There is no later state to move this ${kind.noun} to.`,
        ),
      ]);
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
      expect(answerTexts()).toEqual([
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
      expect(answerTexts()).toEqual([
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
        expectNoAnswer();
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
        expect(answerTexts()).toEqual([
          expect.stringContaining(
            `You do not have permission to ${noteAction.refusal}.`,
          ),
        ]);
      });

      test(`a note on a ${kind.noun} outside the member's read is refused with that`, async (): Promise<void> => {
        mockMember([kind.role]);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
          isOutsideMemberRead: true,
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
        expect(answerTexts()[0]).toContain(
          `your access in this project does not include this ${kind.noun}. Ask a project admin for access to it.`,
        );
      });
    },
  );

  if (kind.execute) {
    const execute: NonNullable<SlackKind["execute"]> = kind.execute;

    describe("Execute On-Call Policy", (): void => {
      /*
       * The policy the form names: readable, there but outside the member's
       * read ("outside"), or gone.
       */
      function stubPolicy(readable: boolean | "outside"): void {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = ObjectID.generate();
        policy.projectId = projectId;

        if (readable === "outside") {
          jest
            .spyOn(OnCallDutyPolicyService, "findOneBy")
            .mockImplementation((async (findOneBy: {
              props: { isRoot?: boolean };
            }) => {
              return findOneBy.props.isRoot ? policy : null;
            }) as never);
          return;
        }

        jest
          .spyOn(OnCallDutyPolicyService, "findOneBy")
          .mockResolvedValue(readable ? policy : null);
      }

      test("the policy is executed by the member, for this record", async (): Promise<void> => {
        mockMember([kind.role, Permission.OnCallMember]);
        kind.stubStates();
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
        expectNoAnswer();
      });

      test("a member who may not execute on-call policies is told why, and no one is paged", async (): Promise<void> => {
        mockMember([kind.role]);
        kind.stubStates();
        const createSpy: AnySpy = stubCreate(
          OnCallDutyPolicyExecutionLogService,
        );

        await kind.handle(
          handlerArgs(execute.actionType, ObjectID.generate().toString(), {
            onCallPolicy: ObjectID.generate().toString(),
          }),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(answerTexts()).toEqual([
          expect.stringContaining(
            `You do not have permission to ${execute.refusal}.`,
          ),
        ]);
      });

      test("a policy outside the member's read is refused with that", async (): Promise<void> => {
        mockMember([kind.role, Permission.OnCallMember]);
        kind.stubStates();
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

        await kind.handle(
          handlerArgs(execute.actionType, ObjectID.generate().toString(), {
            onCallPolicy: ObjectID.generate().toString(),
          }),
        );

        expect(createSpy).not.toHaveBeenCalled();
        expect(answerTexts()[0]).toContain(
          "your access in this project does not include this on-call policy. Ask a project admin for access to it.",
        );
      });

      test("a policy that is gone is not found, and no one is paged", async (): Promise<void> => {
        mockMember([kind.role, Permission.OnCallMember]);
        kind.stubStates();
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
        expect(answerTexts()[0]).toContain(
          "the on-call policy was not found. It may have been deleted.",
        );
      });
    });
  }
});

// Who got there first, in a press that comes too late.
const SIMON: ObjectID = ObjectID.generate();
const FIRST_AT: string = "2026-10-08T18:07:00Z";

/*
 * What an answer to a press that comes too late reads, besides the record:
 * the record's state timeline (who moved it, and when) and that person's
 * name.
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
}

/*
 * Mark as Ongoing on an event that has started already is answered with
 * what the event is - ongoing, or over - who took it there, and when, as
 * news rather than as an error. Nothing is written either way.
 */
/*
 * A public note asked for in a chat - a 📣, an Add Note form - first asks
 * whether its incident or episode is private, which takes no public notes
 * (WorkspaceReactionNote.getNoteTypeSavedAs, WorkspaceNoteForm): none of
 * these is.
 */
beforeEach((): void => {
  stubPrivateRecords();
});

describe("Slack Mark as Ongoing on an event that has started already", (): void => {
  test.each([
    ["ongoing", false, "was already marked as ongoing"],
    ["over", true, "was already completed"],
  ])(
    "an event that is %s: told what it is, by whom and when, and nothing is written",
    async (
      _label: string,
      isCompleted: boolean,
      ending: string,
    ): Promise<void> => {
      mockMember([Permission.ScheduledMaintenanceMember]);
      const states: ProjectStates = maintenanceStates();
      // Where the event is, and its number, come from the member's one read of it.
      const readSpy: AnySpy = stubRecord({
        service: ScheduledMaintenanceService,
        makeRecord: (): unknown => {
          return new ScheduledMaintenance();
        },
        stateColumn: "currentScheduledMaintenanceStateId",
        currentStateId: isCompleted ? states.resolved : states.acknowledged,
        columns: {
          scheduledMaintenanceNumber: 7,
          scheduledMaintenanceNumberWithPrefix: "SM-7",
        },
      });
      const otherReads: Array<AnySpy> = [
        jest.spyOn(
          ScheduledMaintenanceService,
          "isScheduledMaintenanceOngoing",
        ) as AnySpy,
        jest.spyOn(
          ScheduledMaintenanceService,
          "isScheduledMaintenanceCompleted",
        ) as AnySpy,
        jest.spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceNumber",
        ) as AnySpy,
      ];
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(URL.fromString("https://oneuptime.test/sm/7"));
      const createSpy: AnySpy = stubCreate(
        ScheduledMaintenanceStateTimelineService,
      );
      stubLateAnswerReads({
        timelineService: ScheduledMaintenanceStateTimelineService,
        rows: [
          {
            scheduledMaintenanceStateId: isCompleted
              ? states.resolved
              : states.acknowledged,
            startsAt: new Date(FIRST_AT),
            createdByUserId: SIMON,
          },
        ],
      });

      await SlackScheduledMaintenanceActions.handleScheduledMaintenanceAction(
        handlerArgs(
          SlackActionType.MarkScheduledMaintenanceAsOngoing,
          ObjectID.generate().toString(),
        ),
      );

      expect(createSpy).not.toHaveBeenCalled();
      // master: "@member, unfortunately you cannot change the state to ongoing because ..."
      expect(answerTexts()).toEqual([
        `✅ **[Scheduled Maintenance SM-7](https://oneuptime.test/sm/7)** ${ending} by **Simon Lee** at {{TIME(${FIRST_AT})}}.`,
      ]);
      expect(readSpy).toHaveBeenCalledTimes(1);
      for (const otherRead of otherReads) {
        expect(otherRead).not.toHaveBeenCalled();
      }
    },
  );
});

/*
 * A button pressed too late is answered from the press's one read of the
 * record - where it is and its number - with no read of its own, and the
 * person it answers is named as text.
 */
describe("Slack buttons answered from the one read", (): void => {
  test("Acknowledge on an incident acknowledged already says who acknowledged it and when, with its number, and writes nothing", async (): Promise<void> => {
    mockMember([Permission.IncidentMember]);
    const states: ProjectStates = incidentStates();
    const readSpy: AnySpy = stubRecord({
      service: IncidentService,
      makeRecord: (): unknown => {
        return new Incident();
      },
      stateColumn: "currentIncidentStateId",
      currentStateId: states.acknowledged,
      columns: { incidentNumber: 42, incidentNumberWithPrefix: "INC-42" },
    });
    const otherReads: Array<AnySpy> = [
      jest.spyOn(IncidentService, "isIncidentAcknowledged") as AnySpy,
      jest.spyOn(IncidentService, "getIncidentNumber") as AnySpy,
    ];
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/incident/42"));
    const createSpy: AnySpy = stubCreate(IncidentStateTimelineService);
    stubLateAnswerReads({
      timelineService: IncidentStateTimelineService,
      rows: [
        {
          incidentStateId: states.created,
          startsAt: new Date("2026-10-08T18:00:00Z"),
        },
        {
          incidentStateId: states.acknowledged,
          startsAt: new Date(FIRST_AT),
          createdByUserId: SIMON,
        },
      ],
    });

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(
        SlackActionType.AcknowledgeIncident,
        ObjectID.generate().toString(),
      ),
    );

    expect(createSpy).not.toHaveBeenCalled();
    /*
     * master: "@member, unfortunately you cannot acknowledge the **[Incident
     * INC-42](...)**. It has already been acknowledged." - by direct message.
     */
    expect(answerTexts()).toEqual([
      `✅ **[Incident INC-42](https://oneuptime.test/incident/42)** was already acknowledged by **Simon Lee** at {{TIME(${FIRST_AT})}}.`,
    ]);
    expect(readSpy).toHaveBeenCalledTimes(1);
    for (const otherRead of otherReads) {
      expect(otherRead).not.toHaveBeenCalled();
    }
  });

  /*
   * The press a person's page makes natural (UI review of block 31): Jane
   * paged Platform into INC-42, which Simon had acknowledged; the member,
   * one of Platform, presses Acknowledge Incident in its channel. That
   * answers their page - it would page them again otherwise - and the
   * answer says so first.
   */
  test("Acknowledge on an incident acknowledged already answers the presser's own page about it, and says so first", async (): Promise<void> => {
    mockMember([Permission.IncidentMember]);
    const states: ProjectStates = incidentStates();
    const incidentId: ObjectID = ObjectID.generate();
    stubRecord({
      service: IncidentService,
      makeRecord: (): unknown => {
        return new Incident();
      },
      stateColumn: "currentIncidentStateId",
      currentStateId: states.acknowledged,
      columns: { incidentNumber: 42, incidentNumberWithPrefix: "INC-42" },
    });
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/incident/42"));
    const createSpy: AnySpy = stubCreate(IncidentStateTimelineService);
    stubLateAnswerReads({
      timelineService: IncidentStateTimelineService,
      rows: [
        {
          incidentStateId: states.acknowledged,
          startsAt: new Date(FIRST_AT),
          createdByUserId: SIMON,
        },
      ],
    });
    const answerSpy: AnySpy = jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(1) as AnySpy;

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(SlackActionType.AcknowledgeIncident, incidentId.toString()),
    );

    // The incident's state is not written: Simon acknowledged it.
    expect(createSpy).not.toHaveBeenCalled();
    expect(answerSpy).toHaveBeenCalledTimes(1);
    expect(answerSpy.mock.calls[0]![0]).toEqual({
      kind: "incident",
      recordId: incidentId,
      projectId: projectId,
      pressedByUserId: userId,
      isResolved: false,
    });
    expect(answerTexts()).toEqual([
      `✅ You acknowledged the page for **[Incident INC-42](https://oneuptime.test/incident/42)**, so paging stopped. **Simon Lee** acknowledged the incident at {{TIME(${FIRST_AT})}}.`,
    ]);
  });

  test("Acknowledge on an alert acknowledged already answers the presser's page too; one with no page of theirs says who got there first", async (): Promise<void> => {
    mockMember([Permission.AlertMember]);
    const states: ProjectStates = alertStates();
    const alertId: ObjectID = ObjectID.generate();
    stubRecord({
      service: AlertService,
      makeRecord: (): unknown => {
        return new Alert();
      },
      stateColumn: "currentAlertStateId",
      currentStateId: states.acknowledged,
      columns: { alertNumber: 9 },
    });
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/alert/9"));
    stubCreate(AlertStateTimelineService);
    stubLateAnswerReads({
      timelineService: AlertStateTimelineService,
      rows: [
        {
          alertStateId: states.acknowledged,
          startsAt: new Date(FIRST_AT),
          createdByUserId: SIMON,
        },
      ],
    });
    const answerSpy: AnySpy = jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0) as AnySpy;

    await SlackAlertActions.handleAlertAction(
      handlerArgs(SlackActionType.AcknowledgeAlert, alertId.toString()),
    );
    await SlackAlertActions.handleAlertAction(
      handlerArgs(SlackActionType.AcknowledgeAlert, alertId.toString()),
    );

    expect(answerSpy.mock.calls[0]![0]).toMatchObject({
      kind: "alert",
      recordId: alertId,
      pressedByUserId: userId,
      isResolved: false,
    });
    expect(answerTexts()).toEqual([
      `✅ You acknowledged the page for **[Alert #9](https://oneuptime.test/alert/9)**, so paging stopped. **Simon Lee** acknowledged the alert at {{TIME(${FIRST_AT})}}.`,
      `✅ **[Alert #9](https://oneuptime.test/alert/9)** was already acknowledged by **Simon Lee** at {{TIME(${FIRST_AT})}}.`,
    ]);
  });

  test("Acknowledge on a resolved incident asks for no page to be answered: resolving it ended them", async (): Promise<void> => {
    mockMember([Permission.IncidentMember]);
    const states: ProjectStates = incidentStates();
    stubRecord({
      service: IncidentService,
      makeRecord: (): unknown => {
        return new Incident();
      },
      stateColumn: "currentIncidentStateId",
      currentStateId: states.resolved,
      columns: { incidentNumber: 42, incidentNumberWithPrefix: "INC-42" },
    });
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/incident/42"));
    stubCreate(IncidentStateTimelineService);
    stubLateAnswerReads({
      timelineService: IncidentStateTimelineService,
      rows: [],
    });
    const answerSpy: AnySpy = jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(0) as AnySpy;

    await SlackIncidentActions.handleIncidentAction(
      handlerArgs(
        SlackActionType.AcknowledgeIncident,
        ObjectID.generate().toString(),
      ),
    );

    // Asked as resolved: it answers nothing (OnCallPersonPageAnswer).
    expect(answerSpy.mock.calls[0]![0]).toMatchObject({ isResolved: true });
    expect(answerTexts()).toEqual([
      "✅ **[Incident INC-42](https://oneuptime.test/incident/42)** is already resolved.",
    ]);
  });

  test("Resolve on an alert resolved already says so with the number the read found", async (): Promise<void> => {
    mockMember([Permission.AlertMember]);
    const states: ProjectStates = alertStates();
    const readSpy: AnySpy = stubRecord({
      service: AlertService,
      makeRecord: (): unknown => {
        return new Alert();
      },
      stateColumn: "currentAlertStateId",
      currentStateId: states.resolved,
      columns: { alertNumber: 9 },
    });
    const numberRead: AnySpy = jest.spyOn(
      AlertService,
      "getAlertNumber",
    ) as AnySpy;
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/alert/9"));
    const createSpy: AnySpy = stubCreate(AlertStateTimelineService);
    // Resolved by a monitor: no one's name to give, nor a moment.
    stubLateAnswerReads({
      timelineService: AlertStateTimelineService,
      rows: [],
    });

    await SlackAlertActions.handleAlertAction(
      handlerArgs(SlackActionType.ResolveAlert, ObjectID.generate().toString()),
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(answerTexts()).toEqual([
      "✅ **[Alert #9](https://oneuptime.test/alert/9)** is already resolved.",
    ]);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(numberRead).not.toHaveBeenCalled();
  });

  test("a Slack name with Markdown in it is not repeated in the answer, which only they see", async (): Promise<void> => {
    mockMember([Permission.Viewer]);
    const states: ProjectStates = incidentStates();
    stubRecord({
      service: IncidentService,
      makeRecord: (): unknown => {
        return new Incident();
      },
      stateColumn: "currentIncidentStateId",
      currentStateId: states.created,
    });
    stubCreate(IncidentStateTimelineService);
    const args: HandlerArgs = handlerArgs(
      SlackActionType.AcknowledgeIncident,
      ObjectID.generate().toString(),
    );
    args.slackRequest.slackUsername =
      "**boss** <!channel> [docs](https://example.com)";

    await SlackIncidentActions.handleIncidentAction(args);

    const text: string = answerTexts()[0]!;
    // master: "@\*\*boss\*\* ..., you do not have permission ..."
    expect(text.startsWith("You do not have permission to acknowledge")).toBe(
      true,
    );
    expect(text).not.toContain("boss");
    expect(text).not.toContain("docs");
    expect(text).not.toContain("<!channel>");
  });
});

/*
 * A PRIVATE INCIDENT OR EPISODE: ADD NOTE ADDS PRIVATE NOTES ONLY.
 *
 * A private incident or episode takes no public notes (Types/StatusPage/
 * PrivateRecordPublicNotes): it is on no status page and told to no
 * subscriber. Its Add Note form asks for no kind - "Add Private Note", one
 * line that says why, and the note - and what it sends is a private note,
 * checked and written as the member. A form opened before the record was
 * made private can still send Public Note: a private note is written, and
 * the member is told what it became and why, where they pressed.
 */
interface PrivateRecordNoteKind {
  name: string;
  noun: string;
  view: SlackActionType;
  submit: SlackActionType;
  handle: (args: HandlerArgs) => Promise<void>;
  recordService: unknown;
  makeRecord: () => unknown;
  recordColumn: string;
  numberColumns: Record<string, unknown>;
  label: string;
  privateService: unknown;
  publicService: unknown;
  privateModel: { new (): unknown };
}

const PRIVATE_RECORD_NOTE_KINDS: Array<PrivateRecordNoteKind> = [
  {
    name: "incident",
    noun: "incident",
    view: SlackActionType.ViewAddIncidentNote,
    submit: SlackActionType.SubmitIncidentNote,
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackIncidentActions.handleIncidentAction(args);
    },
    recordService: IncidentService,
    makeRecord: (): unknown => {
      return new Incident();
    },
    recordColumn: "incidentId",
    numberColumns: { incidentNumber: 7, incidentNumberWithPrefix: "INC-7" },
    label: "Incident INC-7",
    privateService: IncidentInternalNoteService,
    publicService: IncidentPublicNoteService,
    privateModel: IncidentInternalNote,
  },
  {
    name: "incident episode",
    noun: "incident episode",
    view: SlackActionType.ViewAddIncidentEpisodeNote,
    submit: SlackActionType.SubmitIncidentEpisodeNote,
    handle: (args: HandlerArgs): Promise<void> => {
      return SlackIncidentEpisodeActions.handleIncidentEpisodeAction(args);
    },
    recordService: IncidentEpisodeService,
    makeRecord: (): unknown => {
      return new IncidentEpisode();
    },
    recordColumn: "incidentEpisodeId",
    numberColumns: { episodeNumber: 3, episodeNumberWithPrefix: "EP-3" },
    label: "Incident Episode EP-3",
    privateService: IncidentEpisodeInternalNoteService,
    publicService: IncidentEpisodePublicNoteService,
    privateModel: IncidentEpisodeInternalNote,
  },
];

describe.each(PRIVATE_RECORD_NOTE_KINDS)(
  "Add Note on a private $name",
  (kind: PrivateRecordNoteKind): void => {
    const NOTE: string = "Paused the payroll export.";

    function stubTheRecord(): void {
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: "currentIncidentStateId",
        currentStateId: ObjectID.generate(),
        columns: kind.numberColumns,
      });
    }

    test("the form is 'Add Private Note': one line that says why, then the note - no Note Type", async (): Promise<void> => {
      mockMember([Permission.IncidentMember]);
      const recordId: ObjectID = ObjectID.generate();
      stubPrivateRecords([recordId]);

      await kind.handle(handlerArgs(kind.view, recordId.toString()));

      expect(showModalSpy).toHaveBeenCalledTimes(1);
      const modal: WorkspaceModalBlock =
        showModalSpy.mock.calls[0]![0].modalBlock;

      expect(modal.title).toBe("Add Private Note");
      expect(modal.actionId).toBe(kind.submit);
      // The form carries the record, as every form does.
      expect(JSON.parse(String(modal.actionValue))).toMatchObject({
        value: recordId.toString(),
      });
      expect(modal.blocks).toEqual([
        {
          _type: "WorkspacePayloadMarkdown",
          text: `🔒 This ${kind.noun} is private, so this note is private too: only the people who can see the ${kind.noun} can read it.`,
        },
        {
          _type: "WorkspaceTextAreaBlock",
          label: "Note",
          blockId: "note",
          placeholder: "Note",
          description: "Please type in plain text or markdown.",
        },
      ]);
    });

    test("one that is not private gets the form as always: Public Note or Private Note", async (): Promise<void> => {
      mockMember([Permission.IncidentMember]);
      stubPrivateRecords();

      await kind.handle(handlerArgs(kind.view, ObjectID.generate().toString()));

      const modal: WorkspaceModalBlock =
        showModalSpy.mock.calls[0]![0].modalBlock;

      expect(
        modal.blocks.map((block: WorkspaceMessageBlock) => {
          return block._type;
        }),
      ).toEqual(["WorkspaceDropdownBlock", "WorkspaceTextAreaBlock"]);
      expect(
        (modal.blocks[0] as WorkspaceDropdownBlock).options.map(
          (option: DropdownOption): string => {
            return String(option.value);
          },
        ),
      ).toEqual(["public", "private"]);
    });

    test("its form, sent without a Note Type, adds a private note, as the member, and says nothing more", async (): Promise<void> => {
      mockMember([Permission.IncidentMember]);
      const recordId: ObjectID = ObjectID.generate();
      stubPrivateRecords([recordId]);
      stubTheRecord();
      const privateCreate: AnySpy = stubCreate(kind.privateService);
      const publicCreate: AnySpy = stubCreate(kind.publicService);

      await kind.handle(
        handlerArgs(kind.submit, recordId.toString(), { note: NOTE }),
      );

      const data: Record<string, unknown> = expectMemberWrite(privateCreate);
      expect(privateCreate.mock.calls[0]![0].data).toBeInstanceOf(
        kind.privateModel,
      );
      expect(data["note"]).toBe(NOTE);
      expect(String(data[kind.recordColumn])).toBe(recordId.toString());
      expect(publicCreate).not.toHaveBeenCalled();
      expectNoAnswer();
    });

    test("a form opened before it was made private, sent with Public Note: a private note, and the member is told what it became and why", async (): Promise<void> => {
      mockMember([Permission.IncidentMember]);
      const recordId: ObjectID = ObjectID.generate();
      stubPrivateRecords([recordId]);
      stubTheRecord();
      const privateCreate: AnySpy = stubCreate(kind.privateService);
      const publicCreate: AnySpy = stubCreate(kind.publicService);

      await kind.handle(
        handlerArgs(kind.submit, recordId.toString(), {
          noteType: "public",
          note: NOTE,
        }),
      );

      expect(expectMemberWrite(privateCreate)["note"]).toBe(NOTE);
      expect(publicCreate).not.toHaveBeenCalled();

      const answers: Array<string> = answerTexts();

      expect(answers).toHaveLength(1);
      expect(
        answers[0]!.startsWith(
          `📄 You added a private note to **[${kind.label}](`,
        ),
      ).toBe(true);
      expect(
        answers[0]!.endsWith(
          ` The ${kind.noun} is private, so public notes cannot be added to it.`,
        ),
      ).toBe(true);
    });

    test("a member who may only read is told why, and nothing is written", async (): Promise<void> => {
      mockMember([Permission.Viewer]);
      const recordId: ObjectID = ObjectID.generate();
      stubPrivateRecords([recordId]);
      const privateCreate: AnySpy = stubCreate(kind.privateService);
      const publicCreate: AnySpy = stubCreate(kind.publicService);

      await kind.handle(
        handlerArgs(kind.submit, recordId.toString(), {
          noteType: "public",
          note: NOTE,
        }),
      );

      expect(privateCreate).not.toHaveBeenCalled();
      expect(publicCreate).not.toHaveBeenCalled();
      // Refused as the private note it would have been.
      expect(answerTexts()).toEqual([
        expect.stringContaining(`add a private note to this ${kind.noun}`),
      ]);
    });
  },
);
