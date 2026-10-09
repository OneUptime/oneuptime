import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #4111: in Microsoft Teams, "create incident" and "create maintenance"
 * answered "Sorry, I encountered an error processing your request" - and
 * every error bubble showed up twice, because a failing turn was answered
 * with HTTP 500 and Teams delivered it again. The fix made every reply that
 * is not the point of a turn best-effort, and that includes removing a form
 * the user has just submitted.
 *
 * What this file pins: once a form's action has been done and confirmed,
 * removing the submitted form ("Hide the form card") is a courtesy. Before
 * the fix every form handler awaited turnContext.deleteActivity(replyToId)
 * itself - after the success reply, or, in the two create forms, before it.
 * When Teams refused the removal - the card was already gone (404
 * ActivityNotFoundInConversation), the bot had been removed from the chat
 * (403) - the rejection escaped:
 *
 * - the incident, alert, alert episode and incident episode handlers threw
 *   into handleBotInvokeActivity, which answered "Sorry, that action failed.
 *   Please try again later." right under "✅ Note added successfully.";
 * - the scheduled maintenance handler caught it itself and answered "An
 *   error occurred while processing the action";
 * - the create forms answered "❌ Failed to create incident. Please try
 *   again." (or "... scheduled maintenance ...") instead of the confirmation,
 *   for a record that had been created.
 *
 * Every time the user was told that something which had happened had failed,
 * and pressed the button again: a second note, a second page of the on-call
 * policy, a second incident. Every removal now goes through
 * MicrosoftTeamsReplies.deleteBestEffort (logged at debug, never thrown),
 * after the confirmation. The confirmation is sent best-effort as well
 * (MicrosoftTeamsReplies.sendBestEffort): the 14 note, state and on-call
 * submits used to send it themselves, so Teams refusing the confirmation
 * threw the same way, before the form was removed.
 *
 * Every form submit that removes its form is driven here through its real
 * handler - the 14 "Hide the form card" sites and the two create forms (whose
 * create flow MicrosoftTeamsCreateSubmit.test.ts covers in depth) - with
 * Teams refusing the removal, removing it, answering it only later, and with
 * no form to remove; then once more through handleBotInvokeActivity, where
 * "Sorry, that action failed" would come from. The rest of the contract
 * around the removal is pinned as well:
 *
 * - the handler returns only once Teams has answered the removal: botbuilder
 *   revokes the TurnContext when the turn ends, so a removal still in flight
 *   would fail and leave the form on screen, ready to be submitted twice;
 * - a submit whose action failed keeps its form, so the user can submit it
 *   again, and gets exactly one reply saying it failed - for a create, with
 *   the dashboard page to create it in instead when that link can be built -
 *   while the log gets the failure and the error itself;
 * - a create refused because a value it picked is not in the project (deleted
 *   since the form was sent, or another project's in a tampered submit) says
 *   so in fixed words, which never name the other project's record, and keeps
 *   its form, so the value can be picked again;
 * - an action done whose confirmation Teams refuses still has its form
 *   removed, and gets no failure reply: the form must not invite a second
 *   submit.
 *
 * The services each action writes to are stubbed, so no database is touched.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * Same botbuilder module factory as MicrosoftTeamsTeamInstalls.test.ts: the
 * repo-wide manual mock (Tests/__mocks__/botbuilder.js) does not expose
 * TeamsInfo or MessageFactory.attachment, both of which MicrosoftTeams.ts
 * touches at import time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import type { TurnContext } from "botbuilder";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeInternalNote from "../../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import AlertEpisodeInternalNoteService from "../../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertInternalNoteService from "../../../../../Server/Services/AlertInternalNoteService";
import IncidentEpisodeInternalNoteService from "../../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceInternalNoteService from "../../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import { UnreadableReferenceException } from "../../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsReplies from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "6f1d2c3b-4a59-4e68-8d7c-1b2a3c4d5e6f",
);
const USER_ID: ObjectID = new ObjectID("2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182");

// The Teams sender (from.aadObjectId) and the tenant the bot resolves.
const TEAMS_USER_ID: string = "3f2e1d0c-9b8a-4776-8554-433221100fed";
const TENANT_ID: string = "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d";
const BOT_ID: string = "28:oneuptime-bot";

// The form card the user filled in (the submit's replyToId) and the submit.
const FORM_ACTIVITY_ID: string = "1727611200123";
const SUBMIT_ACTIVITY_ID: string = "1727611260456";

const INCIDENT_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const ALERT_ID: string = "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
const ALERT_EPISODE_ID: string = "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const INCIDENT_EPISODE_ID: string = "3d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";
const MAINTENANCE_ID: string = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
const ON_CALL_POLICY_ID: string = "5f6a7b8c-9d0e-4f1a-9b2c-3d4e5f6a7b8c";
const INCIDENT_STATE_ID: string = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const ALERT_STATE_ID: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const MAINTENANCE_STATE_ID: string = "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const SEVERITY_ID: string = "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a";
const CREATED_ID: ObjectID = new ObjectID(
  "ae1f2a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b",
);

const NOTE: string = "Rolled back the 14:02 deploy; the error rate is normal.";

// The member's own permissions, as getProjectMemberProps resolves them.
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

// What handleBotInvokeActivity hands the scheduled maintenance handler.
const MAINTENANCE_REQUEST: MicrosoftTeamsRequest = {
  isAuthorized: true,
  projectId: PROJECT_ID,
  authToken: "",
  payloadType: "invoke",
  userId: USER_ID.toString(),
};

// The dashboard, as DatabaseConfig.getDashboardUrl answers in every test.
const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

const INCIDENT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CREATED_ID.toString()}`;
const MAINTENANCE_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/scheduled-maintenance-events/${CREATED_ID.toString()}`;

// Replies that would tell the user a done action failed.
const FAILURE_TEXTS: ReadonlyArray<string> = [
  "Sorry, that action failed",
  "An error occurred while processing the action",
  "Sorry, something went wrong",
  "❌",
];

// The one reply a user gets when the action itself failed unexpectedly.
const ACTION_FAILED: string =
  "Sorry, that action failed. Please try again later.";
const MAINTENANCE_ACTION_FAILED: string =
  "An error occurred while processing the action";

/*
 * A create that failed unexpectedly links the dashboard page where the record
 * can be created instead, or ends there when no link can be built.
 */
const INCIDENT_CREATE_FAILED: string = `❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime: ${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/create`;
const INCIDENT_CREATE_FAILED_WITHOUT_LINK: string =
  "❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime.";
const MAINTENANCE_CREATE_FAILED: string = `❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime: ${DASHBOARD_URL}/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`;
const MAINTENANCE_CREATE_FAILED_WITHOUT_LINK: string =
  "❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime.";

/*
 * Why a create was refused when a value it picked is not in the project.
 * Fixed words: the project check's own message names the record, which may
 * be another project's.
 */
const UNAVAILABLE_REFERENCE: string =
  "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.";

// A monitor of another project, as a tampered submit could name it.
const FOREIGN_MONITOR_ID: string = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const FOREIGN_MONITOR_NAME: string = "Acme Corp: payments-db-primary";

// The debug line deleteBestEffort logs for a removal Teams refused.
const REMOVAL_REFUSED_LOG_PREFIX: string =
  "Could not remove a submitted Microsoft Teams card: ";

// The error line sendBestEffort logs for a reply Teams refused.
const REPLY_REFUSED_LOG_PREFIX: string =
  "Could not send a Microsoft Teams reply: ";

type TurnEvent =
  | { kind: "reply"; text: string }
  | { kind: "delete"; activityId: string };

interface FakeTurn {
  turnContext: TurnContext;
  // Every reply and every removal the code asked Teams for, in order.
  events: Array<TurnEvent>;
}

/*
 * A TurnContext for one submit. Teams takes every reply unless `replyError`
 * is given, and removes a message unless `deleteError` is given; a refused
 * reply or removal is still recorded: it was attempted. With
 * `removalAnswered`, Teams answers a removal only once that promise settles.
 */
function createFakeTurn(data: {
  activity: JSONObject;
  replyError?: unknown;
  deleteError?: unknown;
  removalAnswered?: Promise<void> | undefined;
}): FakeTurn {
  const events: Array<TurnEvent> = [];

  const turnContext: TurnContext = {
    activity: data.activity,
    sendActivity: async (reply: unknown): Promise<{ id: string }> => {
      events.push({
        kind: "reply",
        text: typeof reply === "string" ? reply : JSON.stringify(reply),
      });

      if (data.replyError !== undefined) {
        throw data.replyError;
      }

      return { id: `reply-${events.length}` };
    },
    deleteActivity: async (activityId: string): Promise<void> => {
      events.push({ kind: "delete", activityId: activityId });

      if (data.removalAnswered) {
        await data.removalAnswered;
      }

      if (data.deleteError !== undefined) {
        throw data.deleteError;
      }
    },
  } as unknown as TurnContext;

  return { turnContext: turnContext, events: events };
}

// A removal Teams answers only when the test says so.
interface DelayedRemoval {
  answered: Promise<void>;
  answer: () => void;
}

function delayedRemoval(): DelayedRemoval {
  let answer: () => void = (): void => {};
  const answered: Promise<void> = new Promise<void>(
    (resolve: (value: void) => void): void => {
      answer = (): void => {
        resolve();
      };
    },
  );

  return {
    answered: answered,
    answer: (): void => {
      answer();
    },
  };
}

/*
 * Settles after every promise callback already queued has run: a timer fires
 * only once the microtask queue is empty. No time passes for the code under
 * test - everything it awaits here is a stub that resolves in microtasks.
 */
function afterQueuedCallbacks(): Promise<void> {
  return new Promise<void>((resolve: (value: void) => void): void => {
    setTimeout(resolve, 0);
  });
}

// What botbuilder throws when the Bot Connector refuses a call.
function teamsRefusal(data: {
  statusCode: number;
  code: string;
  message: string;
}): Error {
  return Object.assign(new Error(data.message), {
    name: "RestError",
    statusCode: data.statusCode,
    code: data.code,
    details: { error: { code: data.code, message: data.message } },
    response: { status: data.statusCode },
  });
}

// The form was removed already, e.g. by a second click on its button.
function formAlreadyGone(): Error {
  return teamsRefusal({
    statusCode: 404,
    code: "ActivityNotFoundInConversation",
    message: "The activity was not found in the conversation.",
  });
}

// The write the form asked for could not reach the database.
function databaseUnreachable(): Error {
  return new Error("connect ECONNREFUSED 10.0.0.5:5432");
}

function repliesOf(turn: FakeTurn): Array<string> {
  return turn.events
    .filter((event: TurnEvent) => {
      return event.kind === "reply";
    })
    .map((event: TurnEvent) => {
      return event.kind === "reply" ? event.text : "";
    });
}

function expectNoFailureReply(turn: FakeTurn): void {
  for (const reply of repliesOf(turn)) {
    for (const failureText of FAILURE_TEXTS) {
      expect(reply).not.toContain(failureText);
    }
  }
}

/*
 * What a stubbed write answers: its result, or - when the test makes the
 * action fail - a rejection.
 */
function writeOutcome<T>(result: T, failure: Error | undefined): Promise<T> {
  if (failure) {
    return Promise.reject(failure);
  }

  return Promise.resolve(result);
}

type HandlerFamily =
  | "incident"
  | "alert"
  | "alert episode"
  | "incident episode"
  | "scheduled maintenance";

// Asserts that the write a form asked for was attempted, once, as asked.
type WriteCheck = () => void;

interface SubmittedForm {
  name: string;
  family: HandlerFamily;
  actionType: string;
  // The record the form acts on; maintenance forms carry theirs in `fields`.
  actionValue: string;
  // What the user filled in, as the submit's value carries it.
  fields: JSONObject;
  // The reply that says it worked.
  confirmation: string;
  // The one reply, through handleBotInvokeActivity, when the write fails.
  failureReply: string;
  // Stubs the write the form asks for; it rejects with `failure` if given.
  stubWrite: (failure?: Error) => WriteCheck;
}

// The two submits that create a record rather than change one.
const CREATE_SUBMITS: ReadonlyArray<string> = [
  MicrosoftTeamsIncidentActionType.SubmitNewIncident,
  MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
];

function stubExistingMaintenance(): void {
  const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
  maintenance.id = new ObjectID(MAINTENANCE_ID);
  maintenance.projectId = PROJECT_ID;
  maintenance.title = "Database upgrade";

  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockResolvedValue(maintenance);
}

/*
 * Executing an on-call policy from a form is the member's own execution of
 * it for the record (WorkspaceMemberActions), with the props
 * handleBotInvokeActivity built for them.
 */
function stubExecuteOnCallPolicy(expected: {
  type: WorkspaceEventType;
  id: string;
  failure: Error | undefined;
}): WriteCheck {
  const executeOnCallPolicy: SpyInstance<
    typeof WorkspaceMemberActions.executeOnCallPolicy
  > = jest
    .spyOn(WorkspaceMemberActions, "executeOnCallPolicy")
    .mockImplementation((): Promise<void> => {
      return writeOutcome(undefined, expected.failure);
    });

  return (): void => {
    expect(executeOnCallPolicy).toHaveBeenCalledTimes(1);
    expect(executeOnCallPolicy).toHaveBeenCalledWith({
      event: { type: expected.type, id: new ObjectID(expected.id) },
      onCallDutyPolicyId: new ObjectID(ON_CALL_POLICY_ID),
      props: MEMBER_PROPS,
    });
  };
}

// A state change from a form is the member's own (WorkspaceMemberActions).
function stubChangeState(expected: {
  type: WorkspaceEventType;
  id: string;
  stateId: string;
  failure: Error | undefined;
}): WriteCheck {
  const changeState: SpyInstance<typeof WorkspaceMemberActions.changeState> =
    jest
      .spyOn(WorkspaceMemberActions, "changeState")
      .mockImplementation((): Promise<void> => {
        return writeOutcome(undefined, expected.failure);
      });

  return (): void => {
    expect(changeState).toHaveBeenCalledTimes(1);
    expect(changeState).toHaveBeenCalledWith({
      event: { type: expected.type, id: new ObjectID(expected.id) },
      stateId: new ObjectID(expected.stateId),
      props: MEMBER_PROPS,
    });
  };
}

function firstArgument(spy: {
  mock: { calls: Array<Array<unknown>> };
}): JSONObject {
  expect(spy.mock.calls).toHaveLength(1);
  return spy.mock.calls[0]![0] as JSONObject;
}

// Every form submit in Actions/ that removes its form once it is done.
const SUBMITTED_FORMS: ReadonlyArray<SubmittedForm> = [
  {
    name: "incident: Add Note (public)",
    family: "incident",
    actionType: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
    actionValue: INCIDENT_ID,
    fields: { noteType: "public", note: NOTE },
    confirmation: "✅ Note added successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const addNote: SpyInstance<typeof IncidentPublicNoteService.addNote> =
        jest
          .spyOn(IncidentPublicNoteService, "addNote")
          .mockImplementation((): Promise<IncidentPublicNote> => {
            return writeOutcome(new IncidentPublicNote(), failure);
          });

      return (): void => {
        expect(addNote).toHaveBeenCalledTimes(1);
        expect(addNote).toHaveBeenCalledWith({
          incidentId: new ObjectID(INCIDENT_ID),
          note: NOTE,
          projectId: PROJECT_ID,
          // Posted with the member's own props: the note is theirs.
          props: MEMBER_PROPS,
        });
      };
    },
  },
  {
    name: "incident: Add Note (private)",
    family: "incident",
    actionType: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
    actionValue: INCIDENT_ID,
    fields: { noteType: "private", note: NOTE },
    confirmation: "✅ Note added successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const addNote: SpyInstance<typeof IncidentInternalNoteService.addNote> =
        jest
          .spyOn(IncidentInternalNoteService, "addNote")
          .mockImplementation((): Promise<IncidentInternalNote> => {
            return writeOutcome(new IncidentInternalNote(), failure);
          });

      return (): void => {
        expect(addNote).toHaveBeenCalledTimes(1);
        expect(addNote).toHaveBeenCalledWith({
          incidentId: new ObjectID(INCIDENT_ID),
          note: NOTE,
          projectId: PROJECT_ID,
          // Posted with the member's own props: the note is theirs.
          props: MEMBER_PROPS,
        });
      };
    },
  },
  {
    name: "incident: Execute On-Call Policy",
    family: "incident",
    actionType:
      MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
    actionValue: INCIDENT_ID,
    fields: { onCallPolicy: ON_CALL_POLICY_ID },
    confirmation: "✅ On-call policy executed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubExecuteOnCallPolicy({
        type: WorkspaceEventType.Incident,
        id: INCIDENT_ID,
        failure: failure,
      });
    },
  },
  {
    name: "incident: Change Incident State",
    family: "incident",
    actionType: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
    actionValue: INCIDENT_ID,
    fields: { incidentState: INCIDENT_STATE_ID },
    confirmation: "✅ Incident state changed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubChangeState({
        type: WorkspaceEventType.Incident,
        id: INCIDENT_ID,
        stateId: INCIDENT_STATE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "incident: Create New Incident",
    family: "incident",
    actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    actionValue: "",
    fields: {
      incidentTitle: "Checkout is failing",
      incidentDescription: "Payments time out after 30 seconds.",
      incidentSeverity: SEVERITY_ID,
    },
    confirmation: `✅ Incident created successfully!\n\nView incident: ${INCIDENT_LINK}`,
    failureReply: INCIDENT_CREATE_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const created: Incident = new Incident();
      created.id = CREATED_ID;
      created.projectId = PROJECT_ID;

      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(URL.fromString(INCIDENT_LINK));
      const create: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockImplementation((): Promise<Incident> => {
          return writeOutcome(created, failure);
        });

      return (): void => {
        expect(create).toHaveBeenCalledTimes(1);
        const incident: Incident = create.mock.calls[0]![0].data;
        expect(incident.title).toBe("Checkout is failing");
        expect(incident.projectId).toEqual(PROJECT_ID);
        // Declared by the member, with their own props: the create credits them.
        expect(create.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
        expect(incident.createdByUserId).toBeUndefined();
      };
    },
  },
  {
    name: "alert: Add Note",
    family: "alert",
    actionType: MicrosoftTeamsAlertActionType.SubmitAlertNote,
    actionValue: ALERT_ID,
    fields: { note: NOTE },
    confirmation: "✅ Note added successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const addNote: SpyInstance<typeof AlertInternalNoteService.addNote> = jest
        .spyOn(AlertInternalNoteService, "addNote")
        .mockImplementation((): Promise<AlertInternalNote> => {
          return writeOutcome(new AlertInternalNote(), failure);
        });

      return (): void => {
        expect(addNote).toHaveBeenCalledTimes(1);
        expect(addNote).toHaveBeenCalledWith({
          alertId: new ObjectID(ALERT_ID),
          note: NOTE,
          projectId: PROJECT_ID,
          // Posted with the member's own props: the note is theirs.
          props: MEMBER_PROPS,
        });
      };
    },
  },
  {
    name: "alert: Execute On-Call Policy",
    family: "alert",
    actionType: MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy,
    actionValue: ALERT_ID,
    fields: { onCallPolicy: ON_CALL_POLICY_ID },
    confirmation: "✅ On-call policy executed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubExecuteOnCallPolicy({
        type: WorkspaceEventType.Alert,
        id: ALERT_ID,
        failure: failure,
      });
    },
  },
  {
    name: "alert: Change Alert State",
    family: "alert",
    actionType: MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
    actionValue: ALERT_ID,
    fields: { alertState: ALERT_STATE_ID },
    confirmation: "✅ Alert state changed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubChangeState({
        type: WorkspaceEventType.Alert,
        id: ALERT_ID,
        stateId: ALERT_STATE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "alert episode: Add Note",
    family: "alert episode",
    actionType: MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote,
    actionValue: ALERT_EPISODE_ID,
    fields: { note: NOTE },
    confirmation: "✅ Note added successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const addNote: SpyInstance<
        typeof AlertEpisodeInternalNoteService.addNote
      > = jest
        .spyOn(AlertEpisodeInternalNoteService, "addNote")
        .mockImplementation((): Promise<AlertEpisodeInternalNote> => {
          return writeOutcome(new AlertEpisodeInternalNote(), failure);
        });

      return (): void => {
        expect(addNote).toHaveBeenCalledTimes(1);
        expect(addNote).toHaveBeenCalledWith({
          alertEpisodeId: new ObjectID(ALERT_EPISODE_ID),
          note: NOTE,
          projectId: PROJECT_ID,
          // Posted with the member's own props: the note is theirs.
          props: MEMBER_PROPS,
        });
      };
    },
  },
  {
    name: "alert episode: Execute On-Call Policy",
    family: "alert episode",
    actionType:
      MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
    actionValue: ALERT_EPISODE_ID,
    fields: { onCallPolicy: ON_CALL_POLICY_ID },
    confirmation: "✅ On-call policy executed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubExecuteOnCallPolicy({
        type: WorkspaceEventType.AlertEpisode,
        id: ALERT_EPISODE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "alert episode: Change Episode State",
    family: "alert episode",
    actionType:
      MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
    actionValue: ALERT_EPISODE_ID,
    fields: { alertState: ALERT_STATE_ID },
    confirmation: "✅ Alert episode state changed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubChangeState({
        type: WorkspaceEventType.AlertEpisode,
        id: ALERT_EPISODE_ID,
        stateId: ALERT_STATE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "incident episode: Add Note",
    family: "incident episode",
    actionType:
      MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote,
    actionValue: INCIDENT_EPISODE_ID,
    fields: { note: NOTE },
    confirmation: "Note added successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const addNote: SpyInstance<
        typeof IncidentEpisodeInternalNoteService.addNote
      > = jest
        .spyOn(IncidentEpisodeInternalNoteService, "addNote")
        .mockImplementation((): Promise<IncidentEpisodeInternalNote> => {
          return writeOutcome(new IncidentEpisodeInternalNote(), failure);
        });

      return (): void => {
        expect(addNote).toHaveBeenCalledTimes(1);
        expect(addNote).toHaveBeenCalledWith({
          incidentEpisodeId: new ObjectID(INCIDENT_EPISODE_ID),
          note: NOTE,
          projectId: PROJECT_ID,
          // Posted with the member's own props: the note is theirs.
          props: MEMBER_PROPS,
        });
      };
    },
  },
  {
    name: "incident episode: Execute On-Call Policy",
    family: "incident episode",
    actionType:
      MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
    actionValue: INCIDENT_EPISODE_ID,
    fields: { onCallPolicy: ON_CALL_POLICY_ID },
    confirmation: "On-call policy executed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubExecuteOnCallPolicy({
        type: WorkspaceEventType.IncidentEpisode,
        id: INCIDENT_EPISODE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "incident episode: Change Episode State",
    family: "incident episode",
    actionType:
      MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState,
    actionValue: INCIDENT_EPISODE_ID,
    fields: { incidentState: INCIDENT_STATE_ID },
    confirmation: "Incident episode state changed successfully.",
    failureReply: ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      return stubChangeState({
        type: WorkspaceEventType.IncidentEpisode,
        id: INCIDENT_EPISODE_ID,
        stateId: INCIDENT_STATE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "scheduled maintenance: Add Note (public)",
    family: "scheduled maintenance",
    actionType:
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
    actionValue: "",
    fields: {
      scheduledMaintenanceId: MAINTENANCE_ID,
      note: NOTE,
      noteType: "public",
    },
    confirmation: "Note added successfully",
    failureReply: MAINTENANCE_ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      stubExistingMaintenance();
      const addNote: SpyInstance<
        typeof ScheduledMaintenancePublicNoteService.addNote
      > = jest
        .spyOn(ScheduledMaintenancePublicNoteService, "addNote")
        .mockImplementation((): Promise<ScheduledMaintenancePublicNote> => {
          return writeOutcome(new ScheduledMaintenancePublicNote(), failure);
        });

      return (): void => {
        const added: JSONObject = firstArgument(addNote);
        // The id arrives as the card sent it.
        expect(String(added["scheduledMaintenanceId"])).toBe(MAINTENANCE_ID);
        expect(added["note"]).toBe(NOTE);
        expect(added["projectId"]).toEqual(PROJECT_ID);
        // Posted with the member's own props: the note is theirs.
        expect(added["props"]).toBe(MEMBER_PROPS);
      };
    },
  },
  {
    name: "scheduled maintenance: Add Note (private)",
    family: "scheduled maintenance",
    actionType:
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
    actionValue: "",
    fields: {
      scheduledMaintenanceId: MAINTENANCE_ID,
      note: NOTE,
      noteType: "private",
    },
    confirmation: "Note added successfully",
    failureReply: MAINTENANCE_ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      stubExistingMaintenance();
      const addNote: SpyInstance<
        typeof ScheduledMaintenanceInternalNoteService.addNote
      > = jest
        .spyOn(ScheduledMaintenanceInternalNoteService, "addNote")
        .mockImplementation((): Promise<ScheduledMaintenanceInternalNote> => {
          return writeOutcome(new ScheduledMaintenanceInternalNote(), failure);
        });

      return (): void => {
        const added: JSONObject = firstArgument(addNote);
        expect(String(added["scheduledMaintenanceId"])).toBe(MAINTENANCE_ID);
        expect(added["note"]).toBe(NOTE);
        expect(added["projectId"]).toEqual(PROJECT_ID);
        expect(added["props"]).toBe(MEMBER_PROPS);
      };
    },
  },
  {
    name: "scheduled maintenance: Change State",
    family: "scheduled maintenance",
    actionType:
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
    actionValue: "",
    fields: {
      scheduledMaintenanceId: MAINTENANCE_ID,
      stateId: MAINTENANCE_STATE_ID,
    },
    confirmation: "ScheduledMaintenance state changed successfully",
    failureReply: MAINTENANCE_ACTION_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      stubExistingMaintenance();

      return stubChangeState({
        type: WorkspaceEventType.ScheduledMaintenance,
        id: MAINTENANCE_ID,
        stateId: MAINTENANCE_STATE_ID,
        failure: failure,
      });
    },
  },
  {
    name: "scheduled maintenance: Create New Scheduled Maintenance",
    family: "scheduled maintenance",
    actionType:
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
    actionValue: "",
    fields: {
      scheduledMaintenanceTitle: "Database upgrade",
      scheduledMaintenanceDescription: "Upgrading the primary to 16.4.",
      startDate: "2099-06-01",
      startTime: "10:00",
      endDate: "2099-06-01",
      endTime: "11:00",
    },
    // The submit names no time zone, so the times are read and shown in UTC.
    confirmation: `✅ Scheduled maintenance created successfully!\n\n**Starts:** Jun 1, 2099, 10:00 (UTC)\n\n**Ends:** Jun 1, 2099, 11:00 (UTC)\n\nView scheduled maintenance: ${MAINTENANCE_LINK}`,
    failureReply: MAINTENANCE_CREATE_FAILED,
    stubWrite: (failure?: Error): WriteCheck => {
      const created: ScheduledMaintenance = new ScheduledMaintenance();
      created.id = CREATED_ID;
      created.projectId = PROJECT_ID;

      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(URL.fromString(MAINTENANCE_LINK));
      const create: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockImplementation((): Promise<ScheduledMaintenance> => {
            return writeOutcome(created, failure);
          });

      return (): void => {
        expect(create).toHaveBeenCalledTimes(1);
        const maintenance: ScheduledMaintenance = create.mock.calls[0]![0].data;
        expect(maintenance.title).toBe("Database upgrade");
        expect(maintenance.projectId).toEqual(PROJECT_ID);
        // Created by the member, with their own props.
        expect(create.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
        expect(maintenance.startsAt).toEqual(
          new Date("2099-06-01T10:00:00.000Z"),
        );
      };
    },
  },
];

const CREATE_FORMS: ReadonlyArray<SubmittedForm> = SUBMITTED_FORMS.filter(
  (form: SubmittedForm) => {
    return CREATE_SUBMITS.includes(form.actionType);
  },
);

// What only the two create submits have.
interface CreateSubmitDetails {
  // The failure reply when no link to the dashboard can be built.
  failureReplyWithoutLink: string;
  // What the create logs when it fails, before the reason.
  failureLogSummary: string;
  // The reply when a value the submit picked is not in the project.
  unavailableReferenceReply: string;
  // What the project check calls the record: "This <subject> references...".
  subject: string;
  // The submit field the picked monitors arrive in.
  monitorsField: string;
}

const CREATE_SUBMIT_DETAILS: Record<string, CreateSubmitDetails> = {
  [MicrosoftTeamsIncidentActionType.SubmitNewIncident]: {
    failureReplyWithoutLink: INCIDENT_CREATE_FAILED_WITHOUT_LINK,
    failureLogSummary: "Could not create an incident from Microsoft Teams",
    unavailableReferenceReply: `❌ Could not create the incident: ${UNAVAILABLE_REFERENCE}`,
    subject: "incident",
    monitorsField: "incidentMonitors",
  },
  [MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance]:
    {
      failureReplyWithoutLink: MAINTENANCE_CREATE_FAILED_WITHOUT_LINK,
      failureLogSummary:
        "Could not create a scheduled maintenance event from Microsoft Teams",
      unavailableReferenceReply: `❌ Could not create the scheduled maintenance event: ${UNAVAILABLE_REFERENCE}`,
      subject: "scheduled maintenance event",
      monitorsField: "scheduledMaintenanceMonitors",
    },
};

// The details of a form in CREATE_FORMS.
function createDetailsOf(form: SubmittedForm): CreateSubmitDetails {
  const details: CreateSubmitDetails | undefined =
    CREATE_SUBMIT_DETAILS[form.actionType];

  if (!details) {
    throw new Error(`"${form.name}" is not a create form.`);
  }

  return details;
}

/*
 * Every logger.error call for a submit whose write failed with `failure`,
 * through handleBotInvokeActivity. A create, and handleBotInvokeActivity for
 * the incident, alert and episode submits, log what failed and why, then the
 * error itself, which keeps its stack. The scheduled maintenance handler
 * catches the failure itself and logs one line.
 */
function failureLogCalls(
  form: SubmittedForm,
  failure: Error,
): Array<Array<unknown>> {
  const reason: string = `Error: ${failure.message}`;
  const createDetails: CreateSubmitDetails | undefined =
    CREATE_SUBMIT_DETAILS[form.actionType];

  if (createDetails) {
    const attributes: LogAttributes = { projectId: PROJECT_ID.toString() };

    return [
      [`${createDetails.failureLogSummary}: ${reason}`, attributes],
      [failure, attributes],
    ];
  }

  if (form.family === "scheduled maintenance") {
    return [
      [
        `Error handling scheduled maintenance action: ${reason}`,
        { actionType: form.actionType },
      ],
    ];
  }

  const attributes: LogAttributes = {
    actionType: form.actionType,
    projectId: PROJECT_ID.toString(),
  };

  return [
    [`Error handling bot invoke activity: ${reason}`, attributes],
    [failure, attributes],
  ];
}

// Which file of the Teams bot each family's handler lives in.
const FAMILY_SOURCE_FILES: Record<HandlerFamily, string> = {
  incident: "Actions/Incident.ts",
  alert: "Actions/Alert.ts",
  "alert episode": "Actions/AlertEpisode.ts",
  "incident episode": "Actions/IncidentEpisode.ts",
  "scheduled maintenance": "Actions/ScheduledMaintenance.ts",
};

// The submit's value: the card's action data plus what the user filled in.
function submitValue(form: SubmittedForm): JSONObject {
  return {
    action: form.actionType,
    actionValue: form.actionValue,
    ...form.fields,
  };
}

// The message activity Teams sends when a form's submit button is pressed.
function submitActivity(
  form: SubmittedForm,
  options?: { withoutForm?: boolean | undefined },
): JSONObject {
  const activity: JSONObject = {
    type: "message",
    id: SUBMIT_ACTIVITY_ID,
    from: { id: "29:teams-user", aadObjectId: TEAMS_USER_ID, name: "Alex" },
    recipient: { id: BOT_ID },
    conversation: { conversationType: "personal", id: "a:personal-chat" },
    channelData: { tenant: { id: TENANT_ID } },
    value: submitValue(form),
  };

  if (!options?.withoutForm) {
    activity["replyToId"] = FORM_ACTIVITY_ID;
  }

  return activity;
}

// The arguments handleBotInvokeActivity passes every bot action handler.
function botActionArguments(
  form: SubmittedForm,
  turnContext: TurnContext,
): {
  actionType: string;
  actionValue: string;
  value: JSONObject;
  projectId: ObjectID;
  oneUptimeUserId: ObjectID;
  databaseProps: DatabaseCommonInteractionProps;
  turnContext: TurnContext;
} {
  return {
    actionType: form.actionType,
    actionValue: form.actionValue,
    value: submitValue(form),
    projectId: PROJECT_ID,
    oneUptimeUserId: USER_ID,
    databaseProps: MEMBER_PROPS,
    turnContext: turnContext,
  };
}

type SubmitHandler = (
  form: SubmittedForm,
  turnContext: TurnContext,
) => Promise<void>;

// Each family's real bot handler, called as handleBotInvokeActivity calls it.
const HANDLERS: Record<HandlerFamily, SubmitHandler> = {
  incident: (form: SubmittedForm, turnContext: TurnContext): Promise<void> => {
    return MicrosoftTeamsIncidentActions.handleBotIncidentAction(
      botActionArguments(form, turnContext),
    );
  },
  alert: (form: SubmittedForm, turnContext: TurnContext): Promise<void> => {
    return MicrosoftTeamsAlertActions.handleBotAlertAction(
      botActionArguments(form, turnContext),
    );
  },
  "alert episode": (
    form: SubmittedForm,
    turnContext: TurnContext,
  ): Promise<void> => {
    return MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction(
      botActionArguments(form, turnContext),
    );
  },
  "incident episode": (
    form: SubmittedForm,
    turnContext: TurnContext,
  ): Promise<void> => {
    return MicrosoftTeamsIncidentEpisodeActions.handleBotIncidentEpisodeAction(
      botActionArguments(form, turnContext),
    );
  },
  "scheduled maintenance": (
    form: SubmittedForm,
    turnContext: TurnContext,
  ): Promise<void> => {
    return MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      form.actionType as MicrosoftTeamsScheduledMaintenanceActionType,
      turnContext,
      submitValue(form),
      MAINTENANCE_REQUEST,
      MEMBER_PROPS,
    );
  },
};

/*
 * What handleBotInvokeActivity looks up before it calls a handler: the
 * project the tenant installed the app for, the OneUptime user linked to
 * the sender, and that user's permissions as a member of the project.
 */
function stubInvokeLookups(): void {
  const projectAuth: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  projectAuth.projectId = PROJECT_ID;

  jest.spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId").mockResolvedValue({
    projectAuth: projectAuth,
    isAmbiguous: false,
    candidateProjectIds: [PROJECT_ID],
  });
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(USER_ID);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(MEMBER_PROPS);
}

let debugLog: SpyInstance<typeof logger.debug>;
let errorLog: SpyInstance<typeof logger.error>;

// Each refused removal deleteBestEffort logged, as the debug line says it.
function refusedRemovalsLogged(): Array<string> {
  return debugLog.mock.calls
    .map((call: Parameters<typeof logger.debug>) => {
      return call[0];
    })
    .filter((message: unknown): message is string => {
      return (
        typeof message === "string" &&
        message.startsWith(REMOVAL_REFUSED_LOG_PREFIX)
      );
    });
}

/*
 * Every logger.error call, with exactly the arguments it was given. Copied
 * into arrays made here: jest records calls in arrays of its own realm,
 * which toStrictEqual would tell apart from the literals they are compared
 * with.
 */
function errorLogCalls(): Array<Array<unknown>> {
  return Array.from(
    errorLog.mock.calls,
    (call: Parameters<typeof logger.error>): Array<unknown> => {
      return [...call];
    },
  );
}

beforeEach((): void => {
  debugLog = jest.spyOn(logger, "debug").mockImplementation((): void => {});
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});

  // Permissions are pinned in the action authorization tests.
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue();

  // Where a failed create sends the user instead.
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
});

afterEach((): void => {
  jest.restoreAllMocks();
});

/*
 * The basics of deleteBestEffort (no id, a synchronous throw) are pinned in
 * MicrosoftTeamsReplies.test.ts. Here: the ways Teams actually refuses to
 * remove a submitted form, each swallowed and logged at debug.
 */
describe("MicrosoftTeamsReplies.deleteBestEffort: the ways Teams refuses to remove a form", (): void => {
  interface RemovalFailure {
    name: string;
    failure: () => unknown;
    // How the debug log line names the failure.
    described: string;
  }

  const REMOVAL_FAILURES: ReadonlyArray<RemovalFailure> = [
    {
      name: "404 ActivityNotFoundInConversation (the form is gone already)",
      failure: formAlreadyGone,
      described:
        "RestError 404 ActivityNotFoundInConversation: The activity was not found in the conversation.",
    },
    {
      name: "403 BotNotInConversationRoster (the bot was removed from the chat)",
      failure: (): Error => {
        return teamsRefusal({
          statusCode: 403,
          code: "BotNotInConversationRoster",
          message: "The bot is not part of the conversation roster.",
        });
      },
      described:
        "RestError 403 BotNotInConversationRoster: The bot is not part of the conversation roster.",
    },
    {
      name: "a dropped connection",
      failure: (): Error => {
        return Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        });
      },
      described: "Error ECONNRESET: socket hang up",
    },
    {
      name: "a rejection that is not an Error",
      failure: (): string => {
        return "request timed out";
      },
      described: "request timed out",
    },
  ];

  test.each(REMOVAL_FAILURES)(
    "$name: resolves, answers nothing, and logs it at debug - not as an error",
    async (removal: RemovalFailure): Promise<void> => {
      const turn: FakeTurn = createFakeTurn({
        activity: {},
        deleteError: removal.failure(),
      });

      await expect(
        MicrosoftTeamsReplies.deleteBestEffort(
          turn.turnContext,
          FORM_ACTIVITY_ID,
        ),
      ).resolves.toBeUndefined();

      // Attempted once, not retried, and no reply about it.
      expect(turn.events).toEqual([
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expect(refusedRemovalsLogged()).toEqual([
        `${REMOVAL_REFUSED_LOG_PREFIX}${removal.described}`,
      ]);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});

describe("a submitted form that Teams refuses to remove (404 ActivityNotFoundInConversation)", (): void => {
  test.each(SUBMITTED_FORMS)(
    "$name: the confirmation stands alone, and nothing is thrown",
    async (form: SubmittedForm): Promise<void> => {
      const writeHappened: WriteCheck = form.stubWrite();
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity(form),
        deleteError: formAlreadyGone(),
      });

      // master: rejected, or (maintenance) answered "An error occurred...".
      await expect(
        HANDLERS[form.family](form, turn.turnContext),
      ).resolves.toBeUndefined();

      writeHappened();

      // Confirmed first; then the removal was attempted, once, for the form.
      expect(turn.events).toEqual([
        { kind: "reply", text: form.confirmation },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expectNoFailureReply(turn);

      // A form Teams would not remove is not a server error.
      expect(errorLog).not.toHaveBeenCalled();
      expect(refusedRemovalsLogged()).toEqual([
        `${REMOVAL_REFUSED_LOG_PREFIX}RestError 404 ActivityNotFoundInConversation: The activity was not found in the conversation.`,
      ]);
    },
  );
});

describe("a submitted form that Teams removes", (): void => {
  test.each(SUBMITTED_FORMS)(
    "$name: confirmed, then the form is removed",
    async (form: SubmittedForm): Promise<void> => {
      const writeHappened: WriteCheck = form.stubWrite();
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity(form),
      });

      await expect(
        HANDLERS[form.family](form, turn.turnContext),
      ).resolves.toBeUndefined();

      writeHappened();
      expect(turn.events).toEqual([
        { kind: "reply", text: form.confirmation },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expect(refusedRemovalsLogged()).toEqual([]);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});

describe("a handler returns only once Teams has answered the removal", (): void => {
  /*
   * botbuilder revokes the TurnContext when the turn's handler returns
   * (BotAdapter.runMiddleware, in a finally). A removal the handler did not
   * wait for would still be in flight then and fail against the revoked
   * context: the form would stay on screen, ready to be submitted twice.
   */
  test.each(SUBMITTED_FORMS)(
    "$name: still waiting while Teams has not answered; done once it has",
    async (form: SubmittedForm): Promise<void> => {
      form.stubWrite();
      const removal: DelayedRemoval = delayedRemoval();
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity(form),
        removalAnswered: removal.answered,
      });

      const handled: Promise<void> = HANDLERS[form.family](
        form,
        turn.turnContext,
      );

      const settledFirst: string = await Promise.race([
        handled.then((): string => {
          return "the handler";
        }),
        afterQueuedCallbacks().then((): string => {
          return "the wait";
        }),
      ]);

      // The removal was asked for, and the handler is waiting for the answer.
      expect(settledFirst).toBe("the wait");
      expect(turn.events).toEqual([
        { kind: "reply", text: form.confirmation },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);

      removal.answer();

      await expect(handled).resolves.toBeUndefined();
      expect(turn.events).toHaveLength(2);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});

describe("a submit that does not say which form it came from (no replyToId)", (): void => {
  test.each(SUBMITTED_FORMS)(
    "$name: confirmed, and Teams is not asked to remove anything",
    async (form: SubmittedForm): Promise<void> => {
      const writeHappened: WriteCheck = form.stubWrite();
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity(form, { withoutForm: true }),
        deleteError: formAlreadyGone(),
      });

      await expect(
        HANDLERS[form.family](form, turn.turnContext),
      ).resolves.toBeUndefined();

      writeHappened();
      expect(turn.events).toEqual([{ kind: "reply", text: form.confirmation }]);
      expect(refusedRemovalsLogged()).toEqual([]);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});

describe("a submit whose action fails keeps its form, so it can be submitted again", (): void => {
  beforeEach((): void => {
    stubInvokeLookups();
  });

  test.each(SUBMITTED_FORMS)(
    "$name: one reply that says it failed; nothing is confirmed, nothing removed",
    async (form: SubmittedForm): Promise<void> => {
      const failure: Error = databaseUnreachable();
      const writeHappened: WriteCheck = form.stubWrite(failure);
      const activity: JSONObject = submitActivity(form);
      const turn: FakeTurn = createFakeTurn({ activity: activity });

      await expect(
        MicrosoftTeamsUtil.handleBotInvokeActivity({
          activity: activity,
          turnContext: turn.turnContext,
        }),
      ).resolves.toBeUndefined();

      // The write was tried once, as asked, and the user is told it failed.
      writeHappened();
      expect(turn.events).toEqual([{ kind: "reply", text: form.failureReply }]);

      // Logged once, with the error itself: its stack says where it failed.
      expect(errorLogCalls()).toStrictEqual(failureLogCalls(form, failure));
    },
  );

  test.each(CREATE_FORMS)(
    "$name, with no dashboard URL known: the same one reply, without the link",
    async (form: SubmittedForm): Promise<void> => {
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockRejectedValue(new Error("No host is configured."));
      const writeHappened: WriteCheck = form.stubWrite(databaseUnreachable());
      const activity: JSONObject = submitActivity(form);
      const turn: FakeTurn = createFakeTurn({ activity: activity });

      await expect(
        MicrosoftTeamsUtil.handleBotInvokeActivity({
          activity: activity,
          turnContext: turn.turnContext,
        }),
      ).resolves.toBeUndefined();

      writeHappened();
      expect(turn.events).toEqual([
        { kind: "reply", text: createDetailsOf(form).failureReplyWithoutLink },
      ]);
    },
  );

  /*
   * A submit carries ids, and nothing binds them to the form that was sent:
   * a record deleted since, another project's id in a tampered submit, or a
   * record the member may not read. The create, made with the member's own
   * props, refuses it before anything is written, with a message that names
   * the record - fine for the log, not for a chat that may be another
   * project's. "Please pick it again" needs the form, so it stays.
   */
  test.each(CREATE_FORMS)(
    "$name with another project's monitor picked: the fixed reason, which names no record, and the form stays to pick again",
    async (form: SubmittedForm): Promise<void> => {
      const details: CreateSubmitDetails = createDetailsOf(form);
      // The refusal the create's own reference check gives such a monitor.
      const refusal: UnreadableReferenceException =
        new UnreadableReferenceException(
          `This ${details.subject} references records that are not in this project: Monitor "${FOREIGN_MONITOR_ID}". Please pick values from this project and try again.`,
        );
      const writeRefused: WriteCheck = form.stubWrite(refusal);
      const tampered: SubmittedForm = {
        ...form,
        fields: { ...form.fields, [details.monitorsField]: FOREIGN_MONITOR_ID },
      };
      const activity: JSONObject = submitActivity(tampered);
      const turn: FakeTurn = createFakeTurn({ activity: activity });

      await expect(
        MicrosoftTeamsUtil.handleBotInvokeActivity({
          activity: activity,
          turnContext: turn.turnContext,
        }),
      ).resolves.toBeUndefined();

      // The create, made as the member, was asked once and refused.
      writeRefused();

      // One reply, and no removal: the form is there to pick again.
      expect(turn.events).toEqual([
        { kind: "reply", text: details.unavailableReferenceReply },
      ]);
      for (const reply of repliesOf(turn)) {
        expect(reply).not.toContain(FOREIGN_MONITOR_NAME);
        expect(reply).not.toContain(FOREIGN_MONITOR_ID);
      }

      // The log has its id (never its name): an operator needs to know which record it was.
      const attributes: LogAttributes = { projectId: PROJECT_ID.toString() };
      expect(errorLogCalls()).toStrictEqual([
        [
          `${details.failureLogSummary}: UnreadableReferenceException: This ${details.subject} references records that are not in this project: Monitor "${FOREIGN_MONITOR_ID}". Please pick values from this project and try again.`,
          attributes,
        ],
        [refusal, attributes],
      ]);
    },
  );
});

describe("an action done, but Teams refuses its confirmation: no failure reply, and the form is removed all the same", (): void => {
  /*
   * The note is there, the state changed, the policy paged, the incident or
   * maintenance event exists. A failure reply, or a form left on screen with
   * no confirmation under it, invites a second submit: a second note, a
   * second page, a second record. The 14 note, state and on-call submits used
   * to send their confirmation themselves, so a refused one threw: into
   * handleBotInvokeActivity ("Sorry, that action failed"), or, for scheduled
   * maintenance, into its handler's own catch ("An error occurred while
   * processing the action"), and the form stayed.
   */
  // A turn in which Teams refuses every reply, the confirmation included.
  function refusingTurn(activity: JSONObject): FakeTurn {
    return createFakeTurn({
      activity: activity,
      replyError: teamsRefusal({
        statusCode: 502,
        code: "BadGateway",
        message: "Bad Gateway",
      }),
    });
  }

  // The one error line: the refused reply, which the action does not undo.
  const REFUSED_CONFIRMATION_LOGGED: Array<Array<unknown>> = [
    [`${REPLY_REFUSED_LOG_PREFIX}RestError 502 BadGateway: Bad Gateway`],
  ];

  test.each(SUBMITTED_FORMS)(
    "$name: the refused confirmation, then the removal - no failure reply, nothing thrown",
    async (form: SubmittedForm): Promise<void> => {
      const writeHappened: WriteCheck = form.stubWrite();
      const turn: FakeTurn = refusingTurn(submitActivity(form));

      await expect(
        HANDLERS[form.family](form, turn.turnContext),
      ).resolves.toBeUndefined();

      writeHappened();
      expect(turn.events).toEqual([
        { kind: "reply", text: form.confirmation },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expect(errorLogCalls()).toStrictEqual(REFUSED_CONFIRMATION_LOGGED);
    },
  );

  describe("delivered to handleBotInvokeActivity as Teams sends them", (): void => {
    beforeEach((): void => {
      stubInvokeLookups();
    });

    test.each(SUBMITTED_FORMS)(
      "$name: no 'Sorry, that action failed' is even attempted, and the form is removed",
      async (form: SubmittedForm): Promise<void> => {
        const writeHappened: WriteCheck = form.stubWrite();
        const activity: JSONObject = submitActivity(form);
        const turn: FakeTurn = refusingTurn(activity);

        await expect(
          MicrosoftTeamsUtil.handleBotInvokeActivity({
            activity: activity,
            turnContext: turn.turnContext,
          }),
        ).resolves.toBeUndefined();

        writeHappened();
        // Every reply is recorded, refused or not: the confirmation was the only one.
        expect(turn.events).toEqual([
          { kind: "reply", text: form.confirmation },
          { kind: "delete", activityId: FORM_ACTIVITY_ID },
        ]);
        expectNoFailureReply(turn);
        expect(errorLogCalls()).toStrictEqual(REFUSED_CONFIRMATION_LOGGED);
      },
    );
  });
});

describe("the same submits, delivered to handleBotInvokeActivity as Teams sends them", (): void => {
  beforeEach((): void => {
    stubInvokeLookups();
  });

  test.each(SUBMITTED_FORMS)(
    "$name: one bubble, the confirmation - no 'Sorry, that action failed' under it",
    async (form: SubmittedForm): Promise<void> => {
      const writeHappened: WriteCheck = form.stubWrite();
      const activity: JSONObject = submitActivity(form);
      const turn: FakeTurn = createFakeTurn({
        activity: activity,
        deleteError: formAlreadyGone(),
      });

      await expect(
        MicrosoftTeamsUtil.handleBotInvokeActivity({
          activity: activity,
          turnContext: turn.turnContext,
        }),
      ).resolves.toBeUndefined();

      writeHappened();
      // master: a failure reply under the confirmation, or instead of it.
      expect(turn.events).toEqual([
        { kind: "reply", text: form.confirmation },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expectNoFailureReply(turn);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );
});

// Every TypeScript file below a directory, as a path relative to it.
function typeScriptFilesBelow(
  directory: string,
  relativeDirectory: string = "",
): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  })) {
    const relativePath: string = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...typeScriptFilesBelow(directory, relativePath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }

  return files;
}

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

const RAW_REMOVAL: RegExp = /\.\s*deleteActivity\s*\(/g;
const BEST_EFFORT_REMOVAL: RegExp =
  /MicrosoftTeamsReplies\s*\.\s*deleteBestEffort\s*\(/g;

describe("the forms above are every form removal there is", (): void => {
  test("the Teams bot removes messages only through deleteBestEffort, and only in the submits driven above", (): void => {
    const teamsDirectory: string = path.join(
      __dirname,
      "../../../../../Server/Utils/Workspace/MicrosoftTeams",
    );
    const sourceFiles: Array<string> = typeScriptFilesBelow(teamsDirectory);

    // The directory was read, subfolders included.
    expect(sourceFiles).toEqual(
      expect.arrayContaining([
        "MicrosoftTeams.ts",
        "MicrosoftTeamsReplies.ts",
        "MicrosoftTeamsCreateCommands.ts",
        ...Object.values(FAMILY_SOURCE_FILES),
      ]),
    );

    for (const relativePath of sourceFiles) {
      const source: string = fs.readFileSync(
        path.join(teamsDirectory, relativePath),
        "utf8",
      );
      const rawRemovals: number = countMatches(source, RAW_REMOVAL);

      if (relativePath === "MicrosoftTeamsReplies.ts") {
        // The one raw call there is, inside deleteBestEffort's try.
        expect(rawRemovals).toBe(1);
        continue;
      }

      const submitsDrivenAbove: number = new Set(
        SUBMITTED_FORMS.filter((form: SubmittedForm) => {
          return FAMILY_SOURCE_FILES[form.family] === relativePath;
        }).map((form: SubmittedForm) => {
          return form.actionType;
        }),
      ).size;

      /*
       * A new handler that removes a message must do it best-effort and get
       * a row in SUBMITTED_FORMS; each submit above removes its form at
       * exactly one place.
       */
      expect({
        file: relativePath,
        rawRemovals: rawRemovals,
        bestEffortRemovals: countMatches(source, BEST_EFFORT_REMOVAL),
      }).toEqual({
        file: relativePath,
        rawRemovals: 0,
        bestEffortRemovals: submitsDrivenAbove,
      });
    }
  });
});
