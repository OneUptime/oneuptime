import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
 * a change-state card offers only the states the member may read; Escalate
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
  const flags: Array<"isCreatedState" | "isAcknowledgedState" | "isResolvedState"> =
    ["isCreatedState", "isAcknowledgedState", "isResolvedState"];
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
  service: object;
  makeRecord: () => object;
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
  record["title"] = "Checkout is down";
  record[data.stateColumn] = data.currentStateId;
  return spy.mockResolvedValue(record);
}

function stubCreate(service: object): AnySpy {
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
  service: object;
  modelType: { new (): object };
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
  recordService: object;
  makeRecord: () => object;
  recordStateColumn: string;
  role: Permission;
  // Only what the dashboard asks to change the state: create the row, read the record.
  dashboardPermissions: Array<Permission>;
  // An edit grant on the record, without the state timeline's create.
  editOnlyPermissions: Array<Permission>;
  timelineService: object;
  timelineRecordColumn: string;
  timelineStateColumn: string;
  stubStates: () => ProjectStates;
  stateService: object;
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
  view: { actionType: string; notFound: string };
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
    makeRecord: (): object => {
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
      notFound: "Incident not found.",
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
    makeRecord: (): object => {
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
      notFound: "Alert not found.",
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
    makeRecord: (): object => {
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
      notFound: "Alert episode not found.",
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
    makeRecord: (): object => {
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
      notFound: "Incident episode not found.",
    },
  },
];

function repliesText(turn: FakeTurn): Array<string> {
  return turn.replies.map((reply: unknown): string => {
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  });
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
          stubRecord({
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

        test(`a ${kind.noun} outside the member's read is refused like one that is not there`, async (): Promise<void> => {
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
            `the ${kind.noun} was not found in this project, or you do not have access to it.`,
          );

          expect(createSpy).not.toHaveBeenCalled();
        });
      },
    );

    test(`a ${kind.noun} acknowledged already is not acknowledged again`, async (): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
      const states: ProjectStates = kind.stubStates();
      stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: states.acknowledged,
      });
      const createSpy: AnySpy = stubCreate(kind.timelineService);

      await expect(
        kind.handle({
          actionType: kind.ack.actionType,
          actionValue: ObjectID.generate().toString(),
          value: {},
          props: props,
          turnContext: createTurn().turnContext,
        }),
      ).rejects.toThrow(
        new BadDataException(`${kind.subject} is already acknowledged.`),
      );

      expect(createSpy).not.toHaveBeenCalled();
    });

    describe("Change State", (): void => {
      test("a member who holds the permission moves it into the state they picked, as themselves", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([
          kind.role,
        ]);
        stubRecord({
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
        expect(String(data[kind.timelineStateColumn])).toBe(
          picked.toString(),
        );
        expect(repliesText(turn)).toEqual([kind.changeState.confirmation]);
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
        const props: DatabaseCommonInteractionProps = memberProps([
          kind.role,
        ]);
        stubRecord({
          service: kind.recordService,
          makeRecord: kind.makeRecord,
          stateColumn: kind.recordStateColumn,
          currentStateId: ObjectID.generate(),
        });
        const investigating: ObjectID = ObjectID.generate();
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

    describe.each(kind.notes)(
      "Add Note ($label)",
      (note: TeamsNote): void => {
        test("the note is posted by the member, as their own", async (): Promise<void> => {
          const props: DatabaseCommonInteractionProps = memberProps([
            kind.role,
          ]);
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
          expect(createSpy.mock.calls[0]![0].data).toBeInstanceOf(
            note.modelType,
          );
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
      },
    );

    describe("Execute On-Call Policy", (): void => {
      function stubPolicy(readable: boolean): AnySpy {
        const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
        policy.id = ObjectID.generate();
        policy.projectId = projectId;
        return jest
          .spyOn(OnCallDutyPolicyService, "findOneBy")
          .mockResolvedValue(readable ? policy : null) as AnySpy;
      }

      test("the policy is executed by the member, for this record", async (): Promise<void> => {
        const props: DatabaseCommonInteractionProps = memberProps([
          kind.role,
          Permission.OnCallMember,
        ]);
        stubRecord({
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

      test("a policy outside the member's read is refused like one that is not there", async (): Promise<void> => {
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
        ).rejects.toThrow("the on-call policy was not found in this project");

        expect(createSpy).not.toHaveBeenCalled();
      });
    });

    test(`viewing a ${kind.noun} reads it as the member, in their project`, async (): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([kind.role]);
      const readSpy: AnySpy = stubRecord({
        service: kind.recordService,
        makeRecord: kind.makeRecord,
        stateColumn: kind.recordStateColumn,
        currentStateId: null,
      });
      const turn: FakeTurn = createTurn();
      const recordId: ObjectID = ObjectID.generate();

      await kind.handle({
        actionType: kind.view.actionType,
        actionValue: recordId.toString(),
        value: {},
        props: props,
        turnContext: turn.turnContext,
      });

      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy.mock.calls[0]![0].props).toBe(props);
      expect(readSpy.mock.calls[0]![0].query).toMatchObject({
        projectId: projectId,
      });
      // One outside their read is answered like one the project does not have.
      expect(turn.replies).toEqual([kind.view.notFound]);
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
    completed: ObjectID;
  }

  function stubMaintenance(readable: boolean): {
    readSpy: AnySpy;
    states: MaintenanceStates;
  } {
    const states: MaintenanceStates = {
      scheduled: ObjectID.generate(),
      ongoing: ObjectID.generate(),
      completed: ObjectID.generate(),
    };
    const ongoing: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    ongoing.id = states.ongoing;
    const completed: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    completed.id = states.completed;

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
    jest
      .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceOngoing")
      .mockResolvedValue(false);
    jest
      .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
      .mockResolvedValue(false);

    return {
      readSpy: stubRecord({
        service: ScheduledMaintenanceService,
        makeRecord: (): object => {
          return new ScheduledMaintenance();
        },
        stateColumn: "currentScheduledMaintenanceStateId",
        currentStateId: readable ? states.scheduled : null,
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

  test("an event outside the member's read is answered like one that is not there", async (): Promise<void> => {
    stubMaintenance(false);
    const createSpy: AnySpy = stubCreate(
      ScheduledMaintenanceStateTimelineService,
    );

    const turn: FakeTurn = await press({
      actionType: MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
      payload: { scheduledMaintenanceId: ObjectID.generate().toString() },
      props: memberProps([Permission.ScheduledMaintenanceMember]),
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(repliesText(turn)).toEqual(["ScheduledMaintenance not found"]);
  });

  test("a refusal from the write itself is told to the member", async (): Promise<void> => {
    stubMaintenance(true);
    jest
      .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
      .mockResolvedValue(true);
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
      "Sorry, that action failed: Scheduled maintenance event is already complete.",
    ]);
  });

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
      service: object;
      modelType: { new (): object };
    }): Promise<void> => {
      const props: DatabaseCommonInteractionProps = memberProps([
        Permission.ScheduledMaintenanceMember,
      ]);
      stubMaintenance(true);
      const createSpy: AnySpy = stubCreate(service);
      const otherService: object =
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
    expect(String(data["scheduledMaintenanceStateId"])).toBe(
      picked.toString(),
    );
    expect(repliesText(turn)).toEqual([
      "ScheduledMaintenance state changed successfully",
    ]);
  });

  test("the change-state card offers only the states the member may read", async (): Promise<void> => {
    const props: DatabaseCommonInteractionProps = memberProps([
      Permission.ScheduledMaintenanceMember,
    ]);
    stubMaintenance(true);
    const ongoing: ObjectID = ObjectID.generate();
    const statesSpy: AnySpy = jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValue([
        { id: ongoing, name: "Ongoing" } as unknown as ScheduledMaintenanceState,
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

  test("a member who may read no states is told so instead of an empty card", async (): Promise<void> => {
    stubMaintenance(true);
    jest.spyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue([]);

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
    recordService: object;
    makeRecord: () => object;
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
      makeRecord: (): object => {
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
      makeRecord: (): object => {
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
      makeRecord: (): object => {
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
      makeRecord: (): object => {
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
      stubRecord({
        service: escalation.recordService,
        makeRecord: escalation.makeRecord,
        stateColumn: "currentIncidentStateId",
        currentStateId: ObjectID.generate(),
      });
      const policyRead: AnySpy = stubPolicy();
      const createSpy: AnySpy = stubCreate(
        OnCallDutyPolicyExecutionLogService,
      );
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
      expect(String(data[escalation.triggerColumn])).toBe(
        recordId.toString(),
      );
      expect(data["userNotificationEventType"]).toBe(
        escalation.userNotificationEventType,
      );
      expect(policyRead.mock.calls[0]![0].props).toBe(props);
      expect(repliesText(turn)).toEqual([
        "On-call policy escalated successfully",
      ]);
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
      const createSpy: AnySpy = stubCreate(
        OnCallDutyPolicyExecutionLogService,
      );
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
