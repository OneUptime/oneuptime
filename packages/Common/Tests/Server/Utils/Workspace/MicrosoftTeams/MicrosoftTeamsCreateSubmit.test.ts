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
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import IncidentService from "../../../../../Server/Services/IncidentService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import { ProjectScopedReferenceException } from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions, {
  MicrosoftTeamsNewScheduledMaintenanceFormChoices,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectReferenceValidator from "../../../../../Server/Utils/Workspace/WorkspaceProjectReferenceValidator";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";

/*
 * Issue #4111: in Microsoft Teams, "create incident" and "create maintenance"
 * answered "Sorry, I encountered an error processing your request", and every
 * error bubble showed up twice. The forms were too big for Teams (HTTP 413),
 * and a failed turn was rethrown, so Teams got an HTTP 500 and delivered the
 * same message again. The fix also reworked what happens when a form is
 * submitted. These tests pin that half, through the handlers the bot calls
 * for a card submit: handleBotIncidentAction (SubmitNewIncident) and
 * handleBotScheduledMaintenanceAction (SubmitNewScheduledMaintenance).
 *
 * - One answer per submit, and nothing escapes the handler to become a 500
 *   and a second bubble. A refused create gets one reply saying why: the
 *   BadDataException / NotAuthorizedException message; for a reference the
 *   project does not have (another project's id, or a record deleted since
 *   the form was sent) a fixed line, because the validator's message names
 *   the other project's record; for anything else a generic line with a link
 *   to create it in OneUptime instead. The details go to the log: a line
 *   that says what failed and why, then the error itself for its stack,
 *   which an HTTP error leaves out (its status and code say it all).
 * - A created record is never reported as failed: the confirmation goes
 *   first, and removing the submitted form after it is best-effort. A user
 *   told "failed" submits again and gets a duplicate (for an incident, its
 *   on-call policies are paged twice). A failed create keeps the form.
 * - The chosen monitor status travels on the record (changeMonitorStatusToId),
 *   and only with chosen monitors. Nothing writes to a monitor directly.
 * - Maintenance start and end are a bare date and time, read in the zone the
 *   form named (what whoever fills it in was told to type in; in a channel
 *   that can be someone else's zone), then the submitter's own zone, then the
 *   submit's UTC offset, then UTC, never in the server's. They are echoed
 *   with the zone used, and a reading at a bare offset says so, since the
 *   offset is today's. The end must be after the start, and the start in the
 *   future, give or take five minutes: Input.Time has minute precision, so a
 *   start picked for "now" that has only just gone by starts now.
 *   MicrosoftTeamsCreateSubmitServerTimezone.test.ts repeats the reads on a
 *   server that is not on UTC.
 * - Who may create what: a scheduled maintenance event takes the permission
 *   the dashboard asks for; an incident takes a linked account that is a
 *   member of the project, and no permission beyond that, by design (see the
 *   incident's "who may submit it"). Those tests run the real checks on the
 *   permissions and memberships a member really holds.
 *
 * "Now" is pinned (only Date is faked). The reference check, the services'
 * create, the dashboard URL and, outside "who may submit it", the permission
 * check are stubbed, so no database is touched.
 */

// The clock every test runs at: noon UTC, 08:00 in New York, 17:30 in Kolkata.
const NOW: Date = new Date("2026-09-29T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "5d0c1f4e-7a3b-4c8e-9f21-6b7a8c9d0e1f",
);
const USER_ID: ObjectID = new ObjectID("8e2a4c6b-1d3f-4a5b-8c7d-9e0f1a2b3c4d");
const CREATED_ID: ObjectID = new ObjectID(
  "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f",
);
const SEVERITY_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c01";
const SECOND_MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c02";
const MONITOR_STATUS_ID: string = "1a1cf3f2-0e35-4a1e-98a1-3f0f8b5f7f9e";
const LABEL_ID: string = "5f1e2d3c-4b5a-4968-8776-655443322110";
const ON_CALL_POLICY_ID: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

// The Microsoft Entra tenant and user a card submit comes from.
const TEAMS_TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const TEAMS_USER_AAD_OBJECT_ID: string = "3f2b7c1e-5d4a-4e8b-9c0d-1a2b3c4d5e6f";

// The form card the user filled in: the submit activity's replyToId.
const FORM_ACTIVITY_ID: string = "1727611200123";

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

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

const INCIDENT_LINK: URL = URL.fromString(
  `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CREATED_ID.toString()}`,
);
const MAINTENANCE_LINK: URL = URL.fromString(
  `${DASHBOARD_URL}/${PROJECT_ID.toString()}/scheduled-maintenance-events/${CREATED_ID.toString()}`,
);

// Every failed create is logged with the project it was for.
const PROJECT_LOG_ATTRIBUTES: LogAttributes = {
  projectId: PROJECT_ID.toString(),
};

/*
 * The fixed text a reference the project does not have is answered with. It
 * names no record: the validator's message names the other project's.
 */
const UNAVAILABLE_REFERENCE_REASON: string =
  "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.";

const INCIDENT_CREATED: string = "✅ Incident created successfully!";
const INCIDENT_CREATED_WITH_LINK: string = `${INCIDENT_CREATED}\n\nView incident: ${INCIDENT_LINK.toString()}`;
const INCIDENT_MISSING_FIELDS: string =
  "Unable to create incident: missing required fields (title, description, or severity).";
const INCIDENT_REFERENCE_UNAVAILABLE: string = `❌ Could not create the incident: ${UNAVAILABLE_REFERENCE_REASON}`;
const INCIDENT_UNEXPECTED_FAILURE: string = `❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime: ${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/create`;
const INCIDENT_UNEXPECTED_FAILURE_WITHOUT_LINK: string =
  "❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime.";

const MAINTENANCE_CREATED: string =
  "✅ Scheduled maintenance created successfully!";
const MAINTENANCE_MISSING_FIELDS: string =
  "Unable to create scheduled maintenance: missing required fields (title, description, start date/time, or end date/time).";
const MAINTENANCE_UNREADABLE_TIME: string =
  "Unable to create scheduled maintenance: the start or end date and time could not be read. Please pick them again.";
const MAINTENANCE_REFERENCE_UNAVAILABLE: string = `❌ Could not create the scheduled maintenance event: ${UNAVAILABLE_REFERENCE_REASON}`;
const MAINTENANCE_UNEXPECTED_FAILURE: string = `❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime: ${DASHBOARD_URL}/${PROJECT_ID.toString()}/scheduled-maintenance-events/create`;
const MAINTENANCE_UNEXPECTED_FAILURE_WITHOUT_LINK: string =
  "❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime.";

type ReplyEvent = { kind: "reply"; text: string };
type DeleteEvent = { kind: "delete"; activityId: string };
type TurnEvent = ReplyEvent | DeleteEvent;

interface FakeTurn {
  turnContext: TurnContext;
  // Every reply and every delete the handler asked Teams for, in order.
  events: Array<TurnEvent>;
}

/*
 * A TurnContext for one card submit. Teams can be told to refuse every reply
 * (replyError) or the removal of the submitted form (deleteError); a refused
 * call is still recorded, since it was attempted.
 */
function createFakeTurn(options?: {
  activity?: JSONObject | undefined;
  replyError?: Error | undefined;
  deleteError?: Error | undefined;
}): FakeTurn {
  const events: Array<TurnEvent> = [];

  const turnContext: TurnContext = {
    activity: options?.activity || submitActivity(),
    sendActivity: async (reply: unknown): Promise<{ id: string }> => {
      events.push({
        kind: "reply",
        text: typeof reply === "string" ? reply : JSON.stringify(reply),
      });

      if (options?.replyError) {
        throw options.replyError;
      }

      return { id: `reply-${events.length}` };
    },
    deleteActivity: async (activityId: string): Promise<void> => {
      events.push({ kind: "delete", activityId: activityId });

      if (options?.deleteError) {
        throw options.deleteError;
      }
    },
  } as unknown as TurnContext;

  return { turnContext: turnContext, events: events };
}

// The message activity Teams sends when the form's submit button is pressed.
function submitActivity(fields?: JSONObject): JSONObject {
  return {
    type: "message",
    id: "1727611260456",
    replyToId: FORM_ACTIVITY_ID,
    ...fields,
  };
}

function repliesOf(turn: FakeTurn): Array<string> {
  return turn.events
    .filter((event: TurnEvent): event is ReplyEvent => {
      return event.kind === "reply";
    })
    .map((event: ReplyEvent) => {
      return event.text;
    });
}

// What botbuilder throws when the Bot Connector refuses a call.
function teamsRefusal(statusCode: number, code: string): Error {
  return Object.assign(new Error(`Teams answered ${statusCode} ${code}.`), {
    name: "RestError",
    statusCode: statusCode,
    code: code,
  });
}

function relationIds(
  models: Array<DatabaseBaseModel> | undefined,
): Array<string> | undefined {
  return models?.map((model: DatabaseBaseModel) => {
    return model.id!.toString();
  });
}

/*
 * The props getProjectMemberProps builds for a member of the project who
 * holds exactly these permissions: what the real permission check reads.
 */
function memberWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
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
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

let validateReferencesSpy: SpyInstance<
  typeof WorkspaceProjectReferenceValidator.validateReferencesBelongToProject
>;
let assertCanCreateSpy: SpyInstance<
  typeof WorkspaceActionAuthorization.assertCanCreate
>;
let monitorUpdateOneBySpy: SpyInstance<typeof MonitorService.updateOneBy>;
let monitorUpdateOneByIdSpy: SpyInstance<typeof MonitorService.updateOneById>;
let dashboardUrlSpy: SpyInstance<typeof DatabaseConfig.getDashboardUrl>;
let errorLogSpy: SpyInstance<typeof logger.error>;

beforeEach((): void => {
  // Only Date is faked: "now" is pinned, every real timer keeps running.
  jest.useFakeTimers({
    now: NOW.getTime(),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });

  // The references themselves are pinned in WorkspaceCreateProjectReferences.test.ts.
  validateReferencesSpy = jest
    .spyOn(
      WorkspaceProjectReferenceValidator,
      "validateReferencesBelongToProject",
    )
    .mockResolvedValue();

  /*
   * The permission rules are pinned in the workspace authorization tests;
   * "who may submit it" below restores the real check.
   */
  assertCanCreateSpy = jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue();

  // Stubbed so a regression that writes monitors directly fails, not hangs.
  monitorUpdateOneBySpy = jest
    .spyOn(MonitorService, "updateOneBy")
    .mockResolvedValue(1);
  monitorUpdateOneByIdSpy = jest
    .spyOn(MonitorService, "updateOneById")
    .mockResolvedValue(1);

  // Where a failed create points the user to instead.
  dashboardUrlSpy = jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));

  errorLogSpy = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach((): void => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function expectNoDirectMonitorWrites(): void {
  expect(monitorUpdateOneBySpy).not.toHaveBeenCalled();
  expect(monitorUpdateOneByIdSpy).not.toHaveBeenCalled();
}

/*
 * The error log a failed create leaves, and nothing else: a line that says
 * what failed and why, then (errorObjectLogged) the error itself, for its
 * stack and class.
 */
function expectOnlyCreateFailureLogged(data: {
  summary: string;
  error: unknown;
  errorObjectLogged: boolean;
}): void {
  expect(errorLogSpy).toHaveBeenCalledTimes(data.errorObjectLogged ? 2 : 1);
  expect(errorLogSpy).toHaveBeenNthCalledWith(
    1,
    data.summary,
    PROJECT_LOG_ATTRIBUTES,
  );

  if (data.errorObjectLogged) {
    expect(errorLogSpy.mock.calls[1]![0]).toBe(data.error);
    expect(errorLogSpy.mock.calls[1]![1]).toEqual(PROJECT_LOG_ATTRIBUTES);
  }
}

interface NonMemberSubmit {
  turn: FakeTurn;
  // TeamMember, as the real membership check reads it.
  membershipLookup: SpyInstance<typeof TeamMemberService.findBy>;
}

/*
 * A card submit handed to handleBotInvokeActivity, as the bot hands it every
 * card submit, from a linked Teams account whose OneUptime user holds no
 * accepted membership in the project (removed from it, say). The tenant and
 * account lookups are stubbed; the membership check is the real one, reading
 * TeamMember, which answers with no rows.
 */
async function submitAsLinkedNonMember(
  value: JSONObject,
): Promise<NonMemberSubmit> {
  const tenantResolution: MicrosoftTeamsTenantResolution = {
    projectAuth: {
      projectId: PROJECT_ID,
    } as unknown as WorkspaceProjectAuthToken,
    isAmbiguous: false,
    candidateProjectIds: [PROJECT_ID],
  };

  jest
    .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
    .mockResolvedValue(tenantResolution);
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(USER_ID);
  const membershipLookup: SpyInstance<typeof TeamMemberService.findBy> = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([]);

  const activity: JSONObject = submitActivity({
    from: { id: "29:1Hk8-teams-user", aadObjectId: TEAMS_USER_AAD_OBJECT_ID },
    conversation: { conversationType: "personal", id: "a:1personal-chat" },
    channelData: { tenant: { id: TEAMS_TENANT_ID } },
    value: value,
  });
  const turn: FakeTurn = createFakeTurn({ activity: activity });

  await expect(
    MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: activity,
      turnContext: turn.turnContext,
    }),
  ).resolves.toBeUndefined();

  return { turn: turn, membershipLookup: membershipLookup };
}

/*
 * The refusal a non-member gets: told why, once, after the real membership
 * lookup for this user in this project.
 */
function expectRefusedAsNonMember(submitted: NonMemberSubmit): void {
  expect(submitted.membershipLookup).toHaveBeenCalledTimes(1);
  expect(submitted.membershipLookup.mock.calls[0]![0].query).toEqual({
    userId: USER_ID,
    projectId: PROJECT_ID,
    hasAcceptedInvitation: true,
  });
  expect(submitted.turn.events).toEqual([
    {
      kind: "reply",
      text: "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    },
  ]);
}

describe("Microsoft Teams: submitting the Create New Incident form", (): void => {
  let createSpy: SpyInstance<typeof IncidentService.create>;
  let linkSpy: SpyInstance<typeof IncidentService.getIncidentLinkInDashboard>;

  function createdIncident(): Incident {
    const incident: Incident = new Incident();
    incident.id = CREATED_ID;
    incident.projectId = PROJECT_ID;
    return incident;
  }

  function incidentForm(fields?: JSONObject): JSONObject {
    return {
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      incidentTitle: "Checkout API returns 502",
      incidentDescription: "Every POST /checkout has failed since 09:12.",
      incidentSeverity: SEVERITY_ID,
      ...fields,
    };
  }

  function submitIncident(
    turn: FakeTurn,
    value: JSONObject,
    databaseProps?: DatabaseCommonInteractionProps,
  ): Promise<void> {
    return MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      actionValue: "",
      value: value,
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: databaseProps || MEMBER_PROPS,
      turnContext: turn.turnContext,
    });
  }

  // The one incident handed to IncidentService.create.
  function incidentPassedToCreate(): Incident {
    expect(createSpy).toHaveBeenCalledTimes(1);
    return createSpy.mock.calls[0]![0].data;
  }

  beforeEach((): void => {
    createSpy = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());
    linkSpy = jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(INCIDENT_LINK);
  });

  test("creates the incident as root from the trimmed form, in the project, as the Teams user", async (): Promise<void> => {
    await submitIncident(
      createFakeTurn(),
      incidentForm({
        incidentTitle: "  Checkout API returns 502 \n",
        incidentDescription:
          "\n\t Every POST /checkout has failed since 09:12.  ",
      }),
    );

    expect(createSpy.mock.calls[0]![0].props).toEqual({ isRoot: true });

    const incident: Incident = incidentPassedToCreate();
    expect(incident.title).toBe("Checkout API returns 502");
    expect(incident.description).toBe(
      "Every POST /checkout has failed since 09:12.",
    );
    expect(incident.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incident.createdByUserId?.toString()).toBe(USER_ID.toString());
    expect(incident.incidentSeverityId?.toString()).toBe(SEVERITY_ID);
    expect(incident.rootCause).toBe("Incident created via Microsoft Teams");
  });

  test.each([
    { name: "no title", fields: { incidentTitle: undefined } },
    { name: "a title of only spaces", fields: { incidentTitle: "   " } },
    { name: "no description", fields: { incidentDescription: "" } },
    {
      name: "a description of only line breaks",
      fields: { incidentDescription: "\n \n\t" },
    },
    { name: "no severity", fields: { incidentSeverity: "" } },
  ])(
    "refuses $name with the missing-fields message, creates nothing and keeps the form",
    async (row: { name: string; fields: JSONObject }): Promise<void> => {
      const turn: FakeTurn = createFakeTurn();

      await submitIncident(turn, incidentForm(row.fields));

      expect(turn.events).toEqual([
        { kind: "reply", text: INCIDENT_MISSING_FIELDS },
      ]);
      expect(validateReferencesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  test("hands the chosen monitor status to IncidentService with the chosen monitors, and writes no monitor itself", async (): Promise<void> => {
    await submitIncident(
      createFakeTurn(),
      incidentForm({
        incidentMonitors: `${MONITOR_ID}, ${SECOND_MONITOR_ID}`,
        monitorStatus: MONITOR_STATUS_ID,
        labels: LABEL_ID,
        onCallDutyPolicies: ON_CALL_POLICY_ID,
      }),
    );

    const incident: Incident = incidentPassedToCreate();
    expect(incident.changeMonitorStatusToId?.toString()).toBe(
      MONITOR_STATUS_ID,
    );
    expect(relationIds(incident.monitors)).toEqual([
      MONITOR_ID,
      SECOND_MONITOR_ID,
    ]);
    expect(relationIds(incident.labels)).toEqual([LABEL_ID]);
    expect(relationIds(incident.onCallDutyPolicies)).toEqual([
      ON_CALL_POLICY_ID,
    ]);

    // Every submitted id is checked against the project before the create.
    expect(validateReferencesSpy).toHaveBeenCalledTimes(1);
    expect(validateReferencesSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      createSpy.mock.invocationCallOrder[0]!,
    );
    expect(validateReferencesSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      subject: "incident",
      monitorIds: [new ObjectID(MONITOR_ID), new ObjectID(SECOND_MONITOR_ID)],
      labelIds: [new ObjectID(LABEL_ID)],
      onCallDutyPolicyIds: [new ObjectID(ON_CALL_POLICY_ID)],
      monitorStatusId: new ObjectID(MONITOR_STATUS_ID),
    });

    expectNoDirectMonitorWrites();
  });

  test("drops a monitor status submitted without monitors: there is nothing for it to change", async (): Promise<void> => {
    await submitIncident(
      createFakeTurn(),
      incidentForm({ incidentMonitors: "", monitorStatus: MONITOR_STATUS_ID }),
    );

    const incident: Incident = incidentPassedToCreate();
    expect(incident.changeMonitorStatusToId).toBeUndefined();
    expect(incident.monitors).toBeUndefined();
    expect(
      validateReferencesSpy.mock.calls[0]![0].monitorStatusId,
    ).toBeUndefined();
    expectNoDirectMonitorWrites();
  });

  test("asks for no status change when monitors are chosen without a status", async (): Promise<void> => {
    await submitIncident(
      createFakeTurn(),
      incidentForm({ incidentMonitors: MONITOR_ID }),
    );

    const incident: Incident = incidentPassedToCreate();
    expect(relationIds(incident.monitors)).toEqual([MONITOR_ID]);
    expect(incident.changeMonitorStatusToId).toBeUndefined();
    expectNoDirectMonitorWrites();
  });

  test.each([
    {
      name: "IncidentService.create refusing with a BadDataException",
      where: "create",
      error: new BadDataException("Incident severity not found in project."),
      reply:
        "❌ Could not create the incident: Incident severity not found in project.",
      logged: "BadDataException: Incident severity not found in project.",
    },
    {
      name: "IncidentService.create refusing with a NotAuthorizedException",
      where: "create",
      error: new NotAuthorizedException(
        "You do not have permission to create an incident.",
      ),
      reply:
        "❌ Could not create the incident: You do not have permission to create an incident.",
      logged:
        "NotAuthorizedException: You do not have permission to create an incident.",
    },
    {
      name: "the reference check refusing another project's monitor",
      where: "validator",
      error: new ProjectScopedReferenceException(
        `This incident references records that are not in this project: Monitor "${MONITOR_ID}". Please pick values from this project and try again.`,
      ),
      reply: INCIDENT_REFERENCE_UNAVAILABLE,
      logged: `ProjectScopedReferenceException: This incident references records that are not in this project: Monitor "${MONITOR_ID}". Please pick values from this project and try again.`,
    },
    {
      // Deleted after the form was sent; IncidentService.create checks it.
      name: "IncidentService.create refusing a severity the project no longer has",
      where: "create",
      error: new ProjectScopedReferenceException(
        `This incident references records that are not in this project: Incident Severity "${SEVERITY_ID}". Please pick values from this project and try again.`,
      ),
      reply: INCIDENT_REFERENCE_UNAVAILABLE,
      logged: `ProjectScopedReferenceException: This incident references records that are not in this project: Incident Severity "${SEVERITY_ID}". Please pick values from this project and try again.`,
    },
    {
      // Never "❌ Could not create the incident: " with nothing after it.
      name: "a BadDataException without a message",
      where: "create",
      error: new BadDataException(""),
      reply: INCIDENT_UNEXPECTED_FAILURE,
      logged: "BadDataException: ",
    },
  ])(
    "answers $name once, logs it, and leaves the form for a corrected submit",
    async (row: {
      name: string;
      where: string;
      error: Error;
      reply: string;
      logged: string;
    }): Promise<void> => {
      if (row.where === "validator") {
        validateReferencesSpy.mockRejectedValue(row.error);
      } else {
        createSpy.mockRejectedValue(row.error);
      }
      const turn: FakeTurn = createFakeTurn();

      await expect(
        submitIncident(turn, incidentForm({ incidentMonitors: MONITOR_ID })),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([{ kind: "reply", text: row.reply }]);
      // A refused reference check stops the create; nothing to link to.
      expect(createSpy).toHaveBeenCalledTimes(row.where === "create" ? 1 : 0);
      expect(linkSpy).not.toHaveBeenCalled();
      // Named by class: OneUptime's exceptions all carry Error's own name.
      expectOnlyCreateFailureLogged({
        summary: `Could not create an incident from Microsoft Teams: ${row.logged}`,
        error: row.error,
        errorObjectLogged: true,
      });
    },
  );

  test("a reference the project does not have is answered without naming the record; the log keeps which one it was", async (): Promise<void> => {
    const validatorMessage: string = `This incident references records that are not in this project: Monitor "${MONITOR_ID}", On-Call Policy "${ON_CALL_POLICY_ID}". Please pick values from this project and try again.`;
    validateReferencesSpy.mockRejectedValue(
      new ProjectScopedReferenceException(validatorMessage),
    );
    const turn: FakeTurn = createFakeTurn();

    await submitIncident(
      turn,
      incidentForm({
        incidentMonitors: MONITOR_ID,
        onCallDutyPolicies: ON_CALL_POLICY_ID,
      }),
    );

    expect(repliesOf(turn)).toEqual([INCIDENT_REFERENCE_UNAVAILABLE]);
    for (const named of ["Acme", "payroll", "executives", MONITOR_ID]) {
      expect(repliesOf(turn)[0]).not.toContain(named);
    }
    expect(createSpy).not.toHaveBeenCalled();
    expect(errorLogSpy.mock.calls[0]![0]).toBe(
      `Could not create an incident from Microsoft Teams: ProjectScopedReferenceException: ${validatorMessage}`,
    );
  });

  test("answers an unexpected create failure once, with the generic line and where to create it instead; the details go to the log only", async (): Promise<void> => {
    const failure: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    createSpy.mockRejectedValue(failure);
    const turn: FakeTurn = createFakeTurn();

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_UNEXPECTED_FAILURE },
    ]);
    expectOnlyCreateFailureLogged({
      summary:
        "Could not create an incident from Microsoft Teams: Error: connect ECONNREFUSED 10.0.0.5:5432",
      error: failure,
      errorObjectLogged: true,
    });
  });

  test("the generic line ends with a full stop when no dashboard link can be built", async (): Promise<void> => {
    dashboardUrlSpy.mockRejectedValue(new Error("GlobalConfig is not ready"));
    createSpy.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
    );
    const turn: FakeTurn = createFakeTurn();

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_UNEXPECTED_FAILURE_WITHOUT_LINK },
    ]);
  });

  test("a failure that carries an HTTP status is logged in one line: its status and code say it all", async (): Promise<void> => {
    // A call to another service that failed while the incident was created.
    const failure: Error = teamsRefusal(503, "ServiceUnavailable");
    createSpy.mockRejectedValue(failure);
    const turn: FakeTurn = createFakeTurn();

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_UNEXPECTED_FAILURE },
    ]);
    expectOnlyCreateFailureLogged({
      summary:
        "Could not create an incident from Microsoft Teams: RestError 503 ServiceUnavailable: Teams answered 503 ServiceUnavailable.",
      error: failure,
      errorObjectLogged: false,
    });
  });

  test("a failure reply Teams refuses does not escape: no HTTP 500, so no redelivered second attempt", async (): Promise<void> => {
    createSpy.mockRejectedValue(new BadDataException("Title is too long."));
    const turn: FakeTurn = createFakeTurn({
      replyError: teamsRefusal(502, "BadGateway"),
    });

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    // One attempt, and no second, different answer in its place.
    expect(turn.events).toEqual([
      {
        kind: "reply",
        text: "❌ Could not create the incident: Title is too long.",
      },
    ]);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("confirms first, with a link to the incident, and only then removes the submitted form", async (): Promise<void> => {
    const turn: FakeTurn = createFakeTurn();

    await submitIncident(turn, incidentForm());

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
      { kind: "delete", activityId: FORM_ACTIVITY_ID },
    ]);
    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy.mock.calls[0]![0].toString()).toBe(PROJECT_ID.toString());
    expect(linkSpy.mock.calls[0]![1].toString()).toBe(CREATED_ID.toString());
  });

  test("a form Teams will not remove leaves just the confirmation: no failure text, nothing thrown", async (): Promise<void> => {
    const turn: FakeTurn = createFakeTurn({
      deleteError: teamsRefusal(403, "Forbidden"),
    });

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
      { kind: "delete", activityId: FORM_ACTIVITY_ID },
    ]);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("a link that cannot be built still confirms, without the link", async (): Promise<void> => {
    linkSpy.mockRejectedValue(new Error("DashboardUrl is not configured"));
    const turn: FakeTurn = createFakeTurn();

    await submitIncident(turn, incidentForm());

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED },
      { kind: "delete", activityId: FORM_ACTIVITY_ID },
    ]);
  });

  test("a created incident without an id is confirmed without a link", async (): Promise<void> => {
    createSpy.mockResolvedValue(new Incident());
    const turn: FakeTurn = createFakeTurn();

    await submitIncident(turn, incidentForm());

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED },
      { kind: "delete", activityId: FORM_ACTIVITY_ID },
    ]);
    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("a submit without a replyToId is confirmed, and nothing is removed", async (): Promise<void> => {
    const turn: FakeTurn = createFakeTurn({
      activity: submitActivity({ replyToId: undefined }),
    });

    await submitIncident(turn, incidentForm());

    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
    ]);
  });

  test("a confirmation Teams refuses is not followed by a failure reply, and the form still goes", async (): Promise<void> => {
    const turn: FakeTurn = createFakeTurn({
      replyError: teamsRefusal(429, "TooManyRequests"),
    });

    await expect(submitIncident(turn, incidentForm())).resolves.toBeUndefined();

    /*
     * The incident exists. A form left in place with no confirmation under it
     * invites a second press: a second incident, a second page.
     */
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(turn.events).toEqual([
      { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
      { kind: "delete", activityId: FORM_ACTIVITY_ID },
    ]);
  });

  describe("who may submit it", (): void => {
    /*
     * Deliberate, not a gap: creating an incident from Teams takes a linked
     * account that is a current member of the project, and no permission
     * beyond that. It is the product decision Slack documents ("anyone in the
     * company can create incident", on SubmitNewIncident in
     * Server/Utils/Workspace/Slack/Actions/Auth.ts), and the scope of commit
     * 7ac7a3a03f, which put every other chat write (acknowledge, resolve,
     * notes, on-call pages, scheduled maintenance) behind the member's own
     * permissions and left this one open. A read-only member can therefore
     * declare an incident, and page the on-call policies it names, from
     * Teams. Changing that is a product decision for both chat integrations,
     * not a fix to make in this handler alone.
     *
     * Membership is checked by handleBotInvokeActivity, through
     * WorkspaceActionAuthorization.getProjectMemberProps, before this handler
     * runs; the last test here goes through it. The real permission check is
     * restored, so a change of policy fails these tests instead of slipping
     * in unnoticed.
     */
    let assertCanCreateCalls: SpyInstance<
      typeof WorkspaceActionAuthorization.assertCanCreate
    >;

    beforeEach((): void => {
      assertCanCreateSpy.mockRestore();
      // The real check, watched.
      assertCanCreateCalls = jest.spyOn(
        WorkspaceActionAuthorization,
        "assertCanCreate",
      );
    });

    test.each([
      {
        name: "with an on-call policy chosen",
        fields: { onCallDutyPolicies: ON_CALL_POLICY_ID },
        onCallPolicyIds: [ON_CALL_POLICY_ID],
      },
      { name: "with nothing optional chosen", fields: {}, onCallPolicyIds: [] },
    ])(
      "a linked member without Create Incident permission (a read-only Viewer) still creates one $name: by design",
      async (row: {
        name: string;
        fields: JSONObject;
        onCallPolicyIds: Array<string>;
      }): Promise<void> => {
        const turn: FakeTurn = createFakeTurn();

        await expect(
          submitIncident(
            turn,
            incidentForm(row.fields),
            memberWith([Permission.Viewer]),
          ),
        ).resolves.toBeUndefined();

        // IncidentService.create is what pages the chosen policies.
        const incident: Incident = incidentPassedToCreate();
        expect(relationIds(incident.onCallDutyPolicies) || []).toEqual(
          row.onCallPolicyIds,
        );
        expect(assertCanCreateCalls).not.toHaveBeenCalled();
        expect(turn.events).toEqual([
          { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
          { kind: "delete", activityId: FORM_ACTIVITY_ID },
        ]);
      },
    );

    test("a member whose only permission is Create Incident creates one", async (): Promise<void> => {
      const turn: FakeTurn = createFakeTurn();

      await submitIncident(
        turn,
        incidentForm(),
        memberWith([Permission.CreateProjectIncident]),
      );

      expect(incidentPassedToCreate().title).toBe("Checkout API returns 502");
      expect(turn.events).toEqual([
        { kind: "reply", text: INCIDENT_CREATED_WITH_LINK },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
    });

    test("a linked account that is not a member of the project is refused before the form is read: told why, once, and nothing is created or paged", async (): Promise<void> => {
      const handlerSpy: SpyInstance<
        typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
      > = jest.spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction");

      const submitted: NonMemberSubmit = await submitAsLinkedNonMember(
        incidentForm({ onCallDutyPolicies: ON_CALL_POLICY_ID }),
      );

      expectRefusedAsNonMember(submitted);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(validateReferencesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      // A refusal written for the user, not a fault for an operator.
      expect(errorLogSpy).not.toHaveBeenCalled();
    });
  });
});

describe("Microsoft Teams: submitting the Create New Scheduled Maintenance form", (): void => {
  let createSpy: SpyInstance<typeof ScheduledMaintenanceService.create>;
  let linkSpy: SpyInstance<
    typeof ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard
  >;

  function createdScheduledMaintenance(): ScheduledMaintenance {
    const scheduledMaintenance: ScheduledMaintenance =
      new ScheduledMaintenance();
    scheduledMaintenance.id = CREATED_ID;
    scheduledMaintenance.projectId = PROJECT_ID;
    return scheduledMaintenance;
  }

  // What Teams submits: the card's inputs merged with its Action.Submit data.
  function maintenanceForm(fields?: JSONObject): JSONObject {
    return {
      action:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      scheduledMaintenanceTitle: "Primary database upgrade",
      scheduledMaintenanceDescription:
        "Postgres 16 to 17. Writes pause for a few minutes.",
      startDate: "2030-10-01",
      startTime: "14:00",
      endDate: "2030-10-01",
      endTime: "15:00",
      ...fields,
    };
  }

  function submitMaintenance(
    turn: FakeTurn,
    value: JSONObject,
    options?: {
      request?: MicrosoftTeamsRequest | undefined;
      databaseProps?: DatabaseCommonInteractionProps | undefined;
    },
  ): Promise<void> {
    return MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      turn.turnContext,
      value,
      options?.request || MAINTENANCE_REQUEST,
      options?.databaseProps || MEMBER_PROPS,
    );
  }

  // The one event handed to ScheduledMaintenanceService.create.
  function eventPassedToCreate(): ScheduledMaintenance {
    expect(createSpy).toHaveBeenCalledTimes(1);
    return createSpy.mock.calls[0]![0].data;
  }

  /*
   * The confirmation. offsetLabel: the times were read at a bare UTC offset,
   * which the confirmation owns up to.
   */
  function confirmation(data: {
    starts: string;
    ends: string;
    offsetLabel?: string | undefined;
    link?: URL | undefined;
  }): string {
    const offsetNote: string = data.offsetLabel
      ? `\n\nMicrosoft Teams did not say which time zone you are in, so these times were read at your current offset, ${data.offsetLabel}. If daylight saving time changes before then, check them in OneUptime.`
      : "";
    const link: string = data.link
      ? `\n\nView scheduled maintenance: ${data.link.toString()}`
      : "";

    return `${MAINTENANCE_CREATED}\n\n**Starts:** ${data.starts}\n\n**Ends:** ${data.ends}${offsetNote}${link}`;
  }

  // The confirmation for the default form, submitted from New York.
  const NEW_YORK_CONFIRMATION: string = confirmation({
    starts: "Oct 1, 2030, 14:00 (America/New_York)",
    ends: "Oct 1, 2030, 15:00 (America/New_York)",
    link: MAINTENANCE_LINK,
  });

  // The confirmation for the default form, read in Asia/Kolkata.
  const KOLKATA_CONFIRMATION: string = confirmation({
    starts: "Oct 1, 2030, 14:00 (Asia/Kolkata)",
    ends: "Oct 1, 2030, 15:00 (Asia/Kolkata)",
    link: MAINTENANCE_LINK,
  });

  function inNewYork(fields?: JSONObject): FakeTurn {
    return createFakeTurn({
      activity: submitActivity({
        localTimezone: "America/New_York",
        ...fields,
      }),
    });
  }

  beforeEach((): void => {
    createSpy = jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockResolvedValue(createdScheduledMaintenance());
    linkSpy = jest
      .spyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      )
      .mockResolvedValue(MAINTENANCE_LINK);
  });

  describe("the time zone the start and end are read in", (): void => {
    test("reads 14:00-15:00 on Oct 1, 2030 in the submitter's America/New_York, and says so", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm());

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
        "2030-10-01T18:00:00.000Z",
      );
      expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
        "2030-10-01T19:00:00.000Z",
      );
      expect(repliesOf(turn)).toEqual([NEW_YORK_CONFIRMATION]);
    });

    type ZoneCase = {
      source: string;
      activity: JSONObject;
      cardTimezone?: string | undefined;
      startsAt: string;
      endsAt: string;
      label: string;
      // Only a UTC offset was known, and the confirmation says so.
      isOffsetOnly?: boolean | undefined;
    };

    const ZONE_CASES: Array<ZoneCase> = [
      {
        source: "the clientInfo entity's zone when localTimezone is absent",
        activity: {
          entities: [
            { type: "mention", text: "<at>OneUptime</at>" },
            { type: "clientInfo", locale: "de-DE", timezone: "Europe/Berlin" },
          ],
        },
        startsAt: "2030-10-01T12:00:00.000Z",
        endsAt: "2030-10-01T13:00:00.000Z",
        label: "Europe/Berlin",
      },
      {
        source:
          "the zone the form was sent for (value.timezone) when the submit has none",
        activity: {},
        cardTimezone: "Asia/Kolkata",
        startsAt: "2030-10-01T08:30:00.000Z",
        endsAt: "2030-10-01T09:30:00.000Z",
        label: "Asia/Kolkata",
      },
      {
        // botbuilder turns localTimestamp into a Date and keeps the string.
        source: "the UTC offset of rawLocalTimestamp when no zone is known",
        activity: {
          localTimestamp: new Date("2026-09-29T12:00:00.000Z"),
          rawLocalTimestamp: "2026-09-29T17:30:00.000+05:30",
        },
        startsAt: "2030-10-01T08:30:00.000Z",
        endsAt: "2030-10-01T09:30:00.000Z",
        label: "UTC+05:30",
        isOffsetOnly: true,
      },
      {
        source: "the UTC offset of a string localTimestamp",
        activity: { localTimestamp: "2026-09-29T08:00:00.000-04:00" },
        startsAt: "2030-10-01T18:00:00.000Z",
        endsAt: "2030-10-01T19:00:00.000Z",
        label: "UTC-04:00",
        isOffsetOnly: true,
      },
      {
        // Reykjavik, say: an offset of zero is still only an offset.
        source: "a +00:00 UTC offset, named UTC but still only an offset",
        activity: { localTimestamp: "2026-09-29T12:00:00.000+00:00" },
        startsAt: "2030-10-01T14:00:00.000Z",
        endsAt: "2030-10-01T15:00:00.000Z",
        label: "UTC",
        isOffsetOnly: true,
      },
      {
        source: "UTC when Teams says nothing about the zone",
        activity: {},
        startsAt: "2030-10-01T14:00:00.000Z",
        endsAt: "2030-10-01T15:00:00.000Z",
        label: "UTC",
      },
    ];

    test.each(ZONE_CASES)(
      "reads the times in $source",
      async (zoneCase: ZoneCase): Promise<void> => {
        const turn: FakeTurn = createFakeTurn({
          activity: submitActivity(zoneCase.activity),
        });

        await submitMaintenance(
          turn,
          maintenanceForm(
            zoneCase.cardTimezone ? { timezone: zoneCase.cardTimezone } : {},
          ),
        );

        const scheduledMaintenance: ScheduledMaintenance =
          eventPassedToCreate();
        expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
          zoneCase.startsAt,
        );
        expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
          zoneCase.endsAt,
        );
        expect(repliesOf(turn)).toEqual([
          confirmation({
            starts: `Oct 1, 2030, 14:00 (${zoneCase.label})`,
            ends: `Oct 1, 2030, 15:00 (${zoneCase.label})`,
            offsetLabel: zoneCase.isOffsetOnly ? zoneCase.label : undefined,
            link: MAINTENANCE_LINK,
          }),
        ]);
      },
    );

    test.each([
      {
        name: "localTimezone",
        activity: { localTimezone: "America/New_York" },
      },
      {
        name: "clientInfo entity's zone",
        activity: {
          entities: [{ type: "clientInfo", timezone: "Europe/Berlin" }],
        },
      },
      {
        name: "UTC offset",
        activity: { rawLocalTimestamp: "2026-09-29T08:00:00.000-04:00" },
      },
    ])(
      "the zone the form names wins over the submitter's own $name: it is the zone the form told them to type in",
      async (row: { name: string; activity: JSONObject }): Promise<void> => {
        const turn: FakeTurn = createFakeTurn({
          activity: submitActivity(row.activity),
        });

        await submitMaintenance(
          turn,
          maintenanceForm({ timezone: "Asia/Kolkata" }),
        );

        expect(eventPassedToCreate().startsAt?.toISOString()).toBe(
          "2030-10-01T08:30:00.000Z",
        );
        expect(repliesOf(turn)).toEqual([KOLKATA_CONFIRMATION]);
      },
    );

    test.each([
      {
        where: "on the submit",
        activity: {
          localTimezone: "Mars/Olympus_Mons",
          entities: [{ type: "clientInfo", timezone: "Europe/Berlin" }],
        },
        cardTimezone: undefined,
        startsAt: "2030-10-01T12:00:00.000Z",
        label: "Europe/Berlin",
      },
      {
        where: "in the form's data",
        activity: { localTimezone: "America/New_York" },
        cardTimezone: "Mars/Olympus_Mons",
        startsAt: "2030-10-01T18:00:00.000Z",
        label: "America/New_York",
      },
    ])(
      "a zone name moment-timezone does not know is skipped, not trusted, $where",
      async (row: {
        where: string;
        activity: JSONObject;
        cardTimezone: string | undefined;
        startsAt: string;
        label: string;
      }): Promise<void> => {
        const turn: FakeTurn = createFakeTurn({
          activity: submitActivity(row.activity),
        });

        await submitMaintenance(
          turn,
          maintenanceForm(
            row.cardTimezone ? { timezone: row.cardTimezone } : {},
          ),
        );

        expect(eventPassedToCreate().startsAt?.toISOString()).toBe(
          row.startsAt,
        );
        expect(repliesOf(turn)).toEqual([
          confirmation({
            starts: `Oct 1, 2030, 14:00 (${row.label})`,
            ends: `Oct 1, 2030, 15:00 (${row.label})`,
            link: MAINTENANCE_LINK,
          }),
        ]);
      },
    );

    test("a winter date is read, and echoed, with the zone's winter offset, not today's", async (): Promise<void> => {
      // New York is on EDT (UTC-4) on the pinned day and on EST (UTC-5) in December.
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(
        turn,
        maintenanceForm({ startDate: "2030-12-02", endDate: "2030-12-02" }),
      );

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
        "2030-12-02T19:00:00.000Z",
      );
      expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
        "2030-12-02T20:00:00.000Z",
      );
      expect(repliesOf(turn)).toEqual([
        confirmation({
          starts: "Dec 2, 2030, 14:00 (America/New_York)",
          ends: "Dec 2, 2030, 15:00 (America/New_York)",
          link: MAINTENANCE_LINK,
        }),
      ]);
    });

    describe("round trip: the form as sent, then its submit", (): void => {
      const noChoices: MicrosoftTeamsNewScheduledMaintenanceFormChoices = {
        monitors: { choices: [], totalCount: 0 },
        monitorStatuses: { choices: [], totalCount: 0 },
        labels: { choices: [], totalCount: 0 },
      };

      type SentForm = {
        // The card's body, serialized, for the note that names the zone.
        body: string;
        // The Action.Submit data, which Teams merges into the submit.
        submitData: JSONObject;
      };

      // The form, built as "create maintenance" builds it for this zone.
      function sentForm(timezone: string | undefined): SentForm {
        const card: JSONObject =
          MicrosoftTeamsScheduledMaintenanceActions.buildNewScheduledMaintenanceCardForBudget(
            {
              choices: noChoices,
              budgetInBytes: MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES[0]!,
              timezone: timezone,
            },
          );
        const submitAction: JSONObject | undefined = (
          card["actions"] as Array<JSONObject>
        ).find((action: JSONObject) => {
          return action["type"] === "Action.Submit";
        });

        return {
          body: JSON.stringify(card["body"]),
          submitData: submitAction!["data"] as JSONObject,
        };
      }

      function filledIn(submitData: JSONObject): JSONObject {
        return {
          ...submitData,
          scheduledMaintenanceTitle: "Primary database upgrade",
          scheduledMaintenanceDescription: "Postgres 16 to 17.",
          startDate: "2030-10-01",
          startTime: "14:00",
          endDate: "2030-10-01",
          endTime: "15:00",
        };
      }

      test.each([
        {
          submitter: "a client that reports no zone (Teams on iOS)",
          activity: {},
        },
        {
          submitter: "someone else in the channel, who is in New York",
          activity: { localTimezone: "America/New_York" },
        },
      ])(
        "the zone the form names is the zone its submit is read in, submitted by $submitter",
        async (row: {
          submitter: string;
          activity: JSONObject;
        }): Promise<void> => {
          // The form, as sent to a user whose "create maintenance" said Asia/Kolkata.
          const form: SentForm = sentForm("Asia/Kolkata");

          expect(form.body).toContain(
            '"text":"Start and end times are in Asia/Kolkata."',
          );
          // It names the zone, not whose zone it is: not every reader's.
          expect(form.body).not.toContain("your time zone");
          expect(form.submitData).toEqual({
            action:
              MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
            timezone: "Asia/Kolkata",
          });

          const turn: FakeTurn = createFakeTurn({
            activity: submitActivity(row.activity),
          });
          await submitMaintenance(turn, filledIn(form.submitData));

          expect(eventPassedToCreate().startsAt?.toISOString()).toBe(
            "2030-10-01T08:30:00.000Z",
          );
          expect(repliesOf(turn)[0]).toContain(
            "**Starts:** Oct 1, 2030, 14:00 (Asia/Kolkata)",
          );
        },
      );

      test("a form that names no zone is read in the submitter's own zone", async (): Promise<void> => {
        const form: SentForm = sentForm(undefined);

        expect(form.body).toContain(
          '"text":"Start and end times are in the time zone Microsoft Teams reports for you, or in UTC if it does not report one."',
        );
        expect(form.submitData).toEqual({
          action:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
        });

        const turn: FakeTurn = inNewYork();
        await submitMaintenance(turn, filledIn(form.submitData));

        expect(eventPassedToCreate().startsAt?.toISOString()).toBe(
          "2030-10-01T18:00:00.000Z",
        );
        expect(repliesOf(turn)[0]).toContain(
          "**Starts:** Oct 1, 2030, 14:00 (America/New_York)",
        );
      });
    });
  });

  describe("checks before anything is created", (): void => {
    test.each([
      { name: "no title", fields: { scheduledMaintenanceTitle: undefined } },
      {
        name: "a title of only spaces",
        fields: { scheduledMaintenanceTitle: "   " },
      },
      {
        name: "no description",
        fields: { scheduledMaintenanceDescription: "" },
      },
      {
        name: "a description of only line breaks",
        fields: { scheduledMaintenanceDescription: "\n \n" },
      },
      { name: "no start date", fields: { startDate: "" } },
      { name: "no start time", fields: { startTime: "" } },
      { name: "no end date", fields: { endDate: undefined } },
      { name: "no end time", fields: { endTime: "" } },
    ])(
      "refuses $name with the missing-fields message",
      async (row: { name: string; fields: JSONObject }): Promise<void> => {
        const turn: FakeTurn = inNewYork();

        await submitMaintenance(turn, maintenanceForm(row.fields));

        expect(turn.events).toEqual([
          { kind: "reply", text: MAINTENANCE_MISSING_FIELDS },
        ]);
        expect(createSpy).not.toHaveBeenCalled();
      },
    );

    test("refuses a submit that carries no user", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm(), {
        request: {
          isAuthorized: true,
          projectId: PROJECT_ID,
          authToken: "",
          payloadType: "invoke",
        },
      });

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "Unable to create scheduled maintenance: missing user or project information.",
        },
      ]);
      expect(createSpy).not.toHaveBeenCalled();
    });

    test.each([
      {
        name: "a month that does not exist",
        fields: { startDate: "2030-13-01" },
      },
      { name: "February 30th", fields: { endDate: "2030-02-30" } },
      { name: "an hour past 23", fields: { startTime: "25:00" } },
      { name: "a US-style date", fields: { endDate: "10/01/2030" } },
      { name: "a 12-hour time", fields: { endTime: "3:00 PM" } },
      {
        name: "a date-time where a date belongs",
        fields: { startDate: "2030-10-01T14:00:00.000Z" },
      },
    ])(
      "refuses $name as unreadable and creates nothing",
      async (row: { name: string; fields: JSONObject }): Promise<void> => {
        const turn: FakeTurn = inNewYork();

        await submitMaintenance(turn, maintenanceForm(row.fields));

        expect(turn.events).toEqual([
          { kind: "reply", text: MAINTENANCE_UNREADABLE_TIME },
        ]);
        expect(createSpy).not.toHaveBeenCalled();
      },
    );

    test("accepts a time with seconds", async (): Promise<void> => {
      await submitMaintenance(
        inNewYork(),
        maintenanceForm({ startTime: "14:00:00", endTime: "15:30:00" }),
      );

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.startsAt?.toISOString()).toBe(
        "2030-10-01T18:00:00.000Z",
      );
      expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
        "2030-10-01T19:30:00.000Z",
      );
    });

    test("refuses a start in the past, naming it in the user's zone", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(
        turn,
        maintenanceForm({
          startDate: "2020-01-01",
          startTime: "10:00",
          endDate: "2020-01-01",
          endTime: "11:00",
        }),
      );

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "Unable to create scheduled maintenance: the start time (Jan 1, 2020, 10:00 (America/New_York)) is in the past.",
        },
      ]);
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("compares with now in the user's zone: 16:00 today in Kolkata is already past at 17:30 there", async (): Promise<void> => {
      // Read as UTC, 16:00 would still be four hours ahead of the pinned noon UTC.
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity({ localTimezone: "Asia/Kolkata" }),
      });

      await submitMaintenance(
        turn,
        maintenanceForm({
          startDate: "2026-09-29",
          startTime: "16:00",
          endDate: "2026-09-29",
          endTime: "17:00",
        }),
      );

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "Unable to create scheduled maintenance: the start time (Sep 29, 2026, 16:00 (Asia/Kolkata)) is in the past.",
        },
      ]);
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("compares with now in the user's zone: 10:00 today in New York is still ahead at 08:00 there", async (): Promise<void> => {
      // Read as UTC, 10:00 would already be two hours behind the pinned noon UTC.
      await submitMaintenance(
        inNewYork(),
        maintenanceForm({
          startDate: "2026-09-29",
          startTime: "10:00",
          endDate: "2026-09-29",
          endTime: "11:00",
        }),
      );

      expect(eventPassedToCreate().startsAt?.toISOString()).toBe(
        "2026-09-29T14:00:00.000Z",
      );
    });

    describe("a start that has only just gone by", (): void => {
      /*
       * Input.Time has minute precision, so a start picked for "now" is a
       * minute or two in the past by the time the form is sent. Up to five
       * minutes late the event starts now; any later is refused. Each test
       * moves the pinned clock and submits 08:00 in New York (12:00 UTC).
       */
      const STARTS_AT_EIGHT_IN_NEW_YORK: JSONObject = {
        startDate: "2026-09-29",
        startTime: "08:00",
        endDate: "2026-09-29",
        endTime: "09:00",
      };

      test.each([
        {
          when: "that is now",
          now: "2026-09-29T12:00:00.000Z",
          startsShown: "Sep 29, 2026, 08:00",
        },
        {
          when: "4:59 minutes in the past",
          now: "2026-09-29T12:04:59.000Z",
          startsShown: "Sep 29, 2026, 08:04",
        },
        {
          when: "exactly 5 minutes in the past",
          now: "2026-09-29T12:05:00.000Z",
          startsShown: "Sep 29, 2026, 08:05",
        },
      ])(
        "a start $when is accepted, and the event starts now",
        async (row: {
          when: string;
          now: string;
          startsShown: string;
        }): Promise<void> => {
          jest.setSystemTime(new Date(row.now));
          const turn: FakeTurn = inNewYork();

          await submitMaintenance(
            turn,
            maintenanceForm(STARTS_AT_EIGHT_IN_NEW_YORK),
          );

          const scheduledMaintenance: ScheduledMaintenance =
            eventPassedToCreate();
          expect(scheduledMaintenance.startsAt?.toISOString()).toBe(row.now);
          expect(scheduledMaintenance.endsAt?.toISOString()).toBe(
            "2026-09-29T13:00:00.000Z",
          );
          // The confirmation shows when it really starts.
          expect(turn.events).toEqual([
            {
              kind: "reply",
              text: confirmation({
                starts: `${row.startsShown} (America/New_York)`,
                ends: "Sep 29, 2026, 09:00 (America/New_York)",
                link: MAINTENANCE_LINK,
              }),
            },
            { kind: "delete", activityId: FORM_ACTIVITY_ID },
          ]);
        },
      );

      test("a start 5:01 minutes in the past is refused, named as it was typed", async (): Promise<void> => {
        jest.setSystemTime(new Date("2026-09-29T12:05:01.000Z"));
        const turn: FakeTurn = inNewYork();

        await submitMaintenance(
          turn,
          maintenanceForm(STARTS_AT_EIGHT_IN_NEW_YORK),
        );

        expect(turn.events).toEqual([
          {
            kind: "reply",
            text: "Unable to create scheduled maintenance: the start time (Sep 29, 2026, 08:00 (America/New_York)) is in the past.",
          },
        ]);
        expect(createSpy).not.toHaveBeenCalled();
      });

      test("the end must be after the start it was moved to, not only after the one typed", async (): Promise<void> => {
        // 08:01 is after the 08:00 typed, but not after 08:03, when it starts.
        jest.setSystemTime(new Date("2026-09-29T12:03:00.000Z"));
        const turn: FakeTurn = inNewYork();

        await submitMaintenance(
          turn,
          maintenanceForm({ ...STARTS_AT_EIGHT_IN_NEW_YORK, endTime: "08:01" }),
        );

        expect(turn.events).toEqual([
          {
            kind: "reply",
            text: "Unable to create scheduled maintenance: the end time (Sep 29, 2026, 08:01 (America/New_York)) must be after the start time (Sep 29, 2026, 08:03 (America/New_York)).",
          },
        ]);
        expect(createSpy).not.toHaveBeenCalled();
      });
    });

    test.each([
      {
        name: "an end an hour before the start",
        endDate: "2030-10-01",
        endTime: "13:00",
        endsAt: "Oct 1, 2030, 13:00",
      },
      {
        name: "an end equal to the start",
        endDate: "2030-10-01",
        endTime: "14:00",
        endsAt: "Oct 1, 2030, 14:00",
      },
      {
        name: "an end the day before, at a later hour",
        endDate: "2030-09-30",
        endTime: "16:00",
        endsAt: "Sep 30, 2030, 16:00",
      },
    ])(
      "refuses $name, naming both times",
      async (row: {
        name: string;
        endDate: string;
        endTime: string;
        endsAt: string;
      }): Promise<void> => {
        const turn: FakeTurn = inNewYork();

        await submitMaintenance(
          turn,
          maintenanceForm({ endDate: row.endDate, endTime: row.endTime }),
        );

        expect(turn.events).toEqual([
          {
            kind: "reply",
            text: `Unable to create scheduled maintenance: the end time (${row.endsAt} (America/New_York)) must be after the start time (Oct 1, 2030, 14:00 (America/New_York)).`,
          },
        ]);
        expect(createSpy).not.toHaveBeenCalled();
      },
    );

    test("refuses a title of 101 characters", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(
        turn,
        maintenanceForm({ scheduledMaintenanceTitle: "M".repeat(101) }),
      );

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "Unable to create scheduled maintenance: the title can be at most 100 characters.",
        },
      ]);
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("accepts a title of exactly 100 characters, counted after trimming", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(
        turn,
        maintenanceForm({
          scheduledMaintenanceTitle: `  ${"M".repeat(100)} `,
        }),
      );

      expect(eventPassedToCreate().title).toBe("M".repeat(100));
      expect(repliesOf(turn)).toEqual([NEW_YORK_CONFIRMATION]);
    });

    test("asks whether the member may create a scheduled maintenance event, with the member's own props", async (): Promise<void> => {
      await submitMaintenance(inNewYork(), maintenanceForm());

      expect(assertCanCreateSpy).toHaveBeenCalledTimes(1);
      const permissionCheck: Parameters<
        typeof WorkspaceActionAuthorization.assertCanCreate
      >[0] = assertCanCreateSpy.mock.calls[0]![0];

      /*
       * The model is compared by name: a model class inside a failed toEqual
       * breaks jest's worker (its results go to the parent as JSON, and
       * JSON.stringify calls DatabaseBaseModel's static toJSON), so the file
       * would report "modelType is not a constructor" and no test results.
       */
      expect({
        props: permissionCheck.props,
        modelType: permissionCheck.modelType.name,
        action: permissionCheck.action,
        resources: permissionCheck.resources,
      }).toEqual({
        props: MEMBER_PROPS,
        modelType: "ScheduledMaintenance",
        action: "create a scheduled maintenance event",
        resources: undefined,
      });
      expect(permissionCheck.modelType === ScheduledMaintenance).toBe(true);
      expect(assertCanCreateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        createSpy.mock.invocationCallOrder[0]!,
      );
    });

    test("a member without permission is told so, once, and nothing is created", async (): Promise<void> => {
      const refusal: string =
        "You do not have permission to create a scheduled maintenance event. You need the Create Scheduled Maintenance permission.";
      assertCanCreateSpy.mockRejectedValue(new NotAuthorizedException(refusal));
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([{ kind: "reply", text: refusal }]);
      expect(validateReferencesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("a permission check that fails unexpectedly gets one generic reply, and nothing is created", async (): Promise<void> => {
      assertCanCreateSpy.mockRejectedValue(
        new Error("Connection terminated unexpectedly"),
      );
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "An error occurred while processing the action",
        },
      ]);
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe("who may submit it", (): void => {
    // The real permission check, on the permissions the member really holds.
    beforeEach((): void => {
      assertCanCreateSpy.mockRestore();
    });

    test("a read-only member (Viewer) is told why, once, and nothing is created", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm(), {
          databaseProps: memberWith([Permission.Viewer]),
        }),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: expect.stringMatching(
            /^You do not have permission to create a scheduled maintenance event\./,
          ),
        },
      ]);
      expect(validateReferencesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test("a member whose only permission is Create Scheduled Maintenance creates one", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm(), {
        databaseProps: memberWith([
          Permission.CreateProjectScheduledMaintenance,
        ]),
      });

      expect(eventPassedToCreate().title).toBe("Primary database upgrade");
      expect(repliesOf(turn)).toEqual([NEW_YORK_CONFIRMATION]);
    });

    test("a linked account that is not a member of the project is refused before the form is read: told why, once, and nothing is created", async (): Promise<void> => {
      const handlerSpy: SpyInstance<
        typeof MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction
      > = jest.spyOn(
        MicrosoftTeamsScheduledMaintenanceActions,
        "handleBotScheduledMaintenanceAction",
      );

      const submitted: NonMemberSubmit =
        await submitAsLinkedNonMember(maintenanceForm());

      expectRefusedAsNonMember(submitted);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(validateReferencesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(errorLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("creating the event", (): void => {
    test("creates the event as root in the project, as the user, from the trimmed form, and hands the monitor status to the service", async (): Promise<void> => {
      await submitMaintenance(
        inNewYork(),
        maintenanceForm({
          scheduledMaintenanceTitle: "  Primary database upgrade ",
          scheduledMaintenanceDescription: "\nPostgres 16 to 17.\n",
          scheduledMaintenanceMonitors: `${MONITOR_ID},${SECOND_MONITOR_ID}`,
          monitorStatus: MONITOR_STATUS_ID,
          labels: LABEL_ID,
        }),
      );

      expect(createSpy.mock.calls[0]![0].props).toEqual({ isRoot: true });

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.title).toBe("Primary database upgrade");
      expect(scheduledMaintenance.description).toBe("Postgres 16 to 17.");
      expect(scheduledMaintenance.projectId?.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(scheduledMaintenance.createdByUserId?.toString()).toBe(
        USER_ID.toString(),
      );
      expect(relationIds(scheduledMaintenance.monitors)).toEqual([
        MONITOR_ID,
        SECOND_MONITOR_ID,
      ]);
      expect(relationIds(scheduledMaintenance.labels)).toEqual([LABEL_ID]);
      expect(scheduledMaintenance.changeMonitorStatusToId?.toString()).toBe(
        MONITOR_STATUS_ID,
      );

      // Every submitted id is checked against the project before the create.
      expect(validateReferencesSpy).toHaveBeenCalledTimes(1);
      expect(validateReferencesSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        createSpy.mock.invocationCallOrder[0]!,
      );
      expect(validateReferencesSpy.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        subject: "scheduled maintenance event",
        monitorIds: [new ObjectID(MONITOR_ID), new ObjectID(SECOND_MONITOR_ID)],
        labelIds: [new ObjectID(LABEL_ID)],
        monitorStatusId: new ObjectID(MONITOR_STATUS_ID),
      });
      expectNoDirectMonitorWrites();
    });

    test("drops a monitor status submitted without monitors", async (): Promise<void> => {
      await submitMaintenance(
        inNewYork(),
        maintenanceForm({ monitorStatus: MONITOR_STATUS_ID }),
      );

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(scheduledMaintenance.changeMonitorStatusToId).toBeUndefined();
      expect(scheduledMaintenance.monitors).toBeUndefined();
      expect(
        validateReferencesSpy.mock.calls[0]![0].monitorStatusId,
      ).toBeUndefined();
      expectNoDirectMonitorWrites();
    });

    test("asks for no status change when monitors are chosen without a status", async (): Promise<void> => {
      await submitMaintenance(
        inNewYork(),
        maintenanceForm({ scheduledMaintenanceMonitors: MONITOR_ID }),
      );

      const scheduledMaintenance: ScheduledMaintenance = eventPassedToCreate();
      expect(relationIds(scheduledMaintenance.monitors)).toEqual([MONITOR_ID]);
      expect(scheduledMaintenance.changeMonitorStatusToId).toBeUndefined();
      expectNoDirectMonitorWrites();
    });

    test.each([
      {
        name: "ScheduledMaintenanceService.create refusing with a BadDataException, with OneUptime's reason",
        where: "create",
        error: new BadDataException(
          "Scheduled maintenance state not found in project.",
        ),
        reply:
          "❌ Could not create the scheduled maintenance event: Scheduled maintenance state not found in project.",
        logged:
          "BadDataException: Scheduled maintenance state not found in project.",
      },
      {
        name: "ScheduledMaintenanceService.create refusing with a NotAuthorizedException, with its message",
        where: "create",
        error: new NotAuthorizedException(
          "You do not have permission to create a scheduled maintenance event.",
        ),
        reply:
          "❌ Could not create the scheduled maintenance event: You do not have permission to create a scheduled maintenance event.",
        logged:
          "NotAuthorizedException: You do not have permission to create a scheduled maintenance event.",
      },
      {
        name: "the reference check refusing another project's label, with the fixed line",
        where: "validator",
        error: new ProjectScopedReferenceException(
          `This scheduled maintenance event references records that are not in this project: Label "${LABEL_ID}". Please pick values from this project and try again.`,
        ),
        reply: MAINTENANCE_REFERENCE_UNAVAILABLE,
        logged: `ProjectScopedReferenceException: This scheduled maintenance event references records that are not in this project: Label "${LABEL_ID}". Please pick values from this project and try again.`,
      },
      {
        // Deleted after the form was sent; the service checks it on create.
        name: "ScheduledMaintenanceService.create refusing a monitor status the project no longer has, with the fixed line",
        where: "create",
        error: new ProjectScopedReferenceException(
          `This scheduled maintenance event references records that are not in this project: Monitor Status "${MONITOR_STATUS_ID}". Please pick values from this project and try again.`,
        ),
        reply: MAINTENANCE_REFERENCE_UNAVAILABLE,
        logged: `ProjectScopedReferenceException: This scheduled maintenance event references records that are not in this project: Monitor Status "${MONITOR_STATUS_ID}". Please pick values from this project and try again.`,
      },
      {
        name: "a BadDataException without a message, with the generic line",
        where: "create",
        error: new BadDataException(""),
        reply: MAINTENANCE_UNEXPECTED_FAILURE,
        logged: "BadDataException: ",
      },
    ])(
      "answers $name, once, logs it, and leaves the form",
      async (row: {
        name: string;
        where: string;
        error: Error;
        reply: string;
        logged: string;
      }): Promise<void> => {
        if (row.where === "validator") {
          validateReferencesSpy.mockRejectedValue(row.error);
        } else {
          createSpy.mockRejectedValue(row.error);
        }
        const turn: FakeTurn = inNewYork();

        await expect(
          submitMaintenance(turn, maintenanceForm({ labels: LABEL_ID })),
        ).resolves.toBeUndefined();

        expect(turn.events).toEqual([{ kind: "reply", text: row.reply }]);
        // A refused reference check stops the create; nothing to link to.
        expect(createSpy).toHaveBeenCalledTimes(row.where === "create" ? 1 : 0);
        expect(linkSpy).not.toHaveBeenCalled();
        expectOnlyCreateFailureLogged({
          summary: `Could not create a scheduled maintenance event from Microsoft Teams: ${row.logged}`,
          error: row.error,
          errorObjectLogged: true,
        });
      },
    );

    test("a reference the project does not have is answered without naming the record; the log keeps which one it was", async (): Promise<void> => {
      const validatorMessage: string = `This scheduled maintenance event references records that are not in this project: Monitor "${MONITOR_ID}". Please pick values from this project and try again.`;
      validateReferencesSpy.mockRejectedValue(
        new ProjectScopedReferenceException(validatorMessage),
      );
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(
        turn,
        maintenanceForm({ scheduledMaintenanceMonitors: MONITOR_ID }),
      );

      expect(repliesOf(turn)).toEqual([MAINTENANCE_REFERENCE_UNAVAILABLE]);
      for (const named of ["Acme", "payroll", MONITOR_ID]) {
        expect(repliesOf(turn)[0]).not.toContain(named);
      }
      expect(createSpy).not.toHaveBeenCalled();
      expect(errorLogSpy.mock.calls[0]![0]).toBe(
        `Could not create a scheduled maintenance event from Microsoft Teams: ProjectScopedReferenceException: ${validatorMessage}`,
      );
    });

    test("answers an unexpected create failure once, with the generic line and where to create it instead; the details go to the log only", async (): Promise<void> => {
      const failure: Error = new Error("Connection terminated unexpectedly");
      createSpy.mockRejectedValue(failure);
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        { kind: "reply", text: MAINTENANCE_UNEXPECTED_FAILURE },
      ]);
      expectOnlyCreateFailureLogged({
        summary:
          "Could not create a scheduled maintenance event from Microsoft Teams: Error: Connection terminated unexpectedly",
        error: failure,
        errorObjectLogged: true,
      });
    });

    test("the generic line ends with a full stop when no dashboard link can be built", async (): Promise<void> => {
      dashboardUrlSpy.mockRejectedValue(new Error("GlobalConfig is not ready"));
      createSpy.mockRejectedValue(
        new Error("Connection terminated unexpectedly"),
      );
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        { kind: "reply", text: MAINTENANCE_UNEXPECTED_FAILURE_WITHOUT_LINK },
      ]);
    });

    test("a failure that carries an HTTP status is logged in one line: its status and code say it all", async (): Promise<void> => {
      const failure: Error = teamsRefusal(503, "ServiceUnavailable");
      createSpy.mockRejectedValue(failure);
      const turn: FakeTurn = inNewYork();

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        { kind: "reply", text: MAINTENANCE_UNEXPECTED_FAILURE },
      ]);
      expectOnlyCreateFailureLogged({
        summary:
          "Could not create a scheduled maintenance event from Microsoft Teams: RestError 503 ServiceUnavailable: Teams answered 503 ServiceUnavailable.",
        error: failure,
        errorObjectLogged: false,
      });
    });

    test("a failure reply Teams refuses does not escape, nor turn into a second, different answer", async (): Promise<void> => {
      createSpy.mockRejectedValue(
        new BadDataException("Scheduled maintenance state not found."),
      );
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity({ localTimezone: "America/New_York" }),
        replyError: teamsRefusal(502, "BadGateway"),
      });

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: "❌ Could not create the scheduled maintenance event: Scheduled maintenance state not found.",
        },
      ]);
    });

    test("confirms first (Starts and Ends in the user's zone, then the link), and only then removes the form", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm());

      expect(turn.events).toEqual([
        { kind: "reply", text: NEW_YORK_CONFIRMATION },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expect(linkSpy).toHaveBeenCalledTimes(1);
      expect(linkSpy.mock.calls[0]![0].toString()).toBe(PROJECT_ID.toString());
      expect(linkSpy.mock.calls[0]![1].toString()).toBe(CREATED_ID.toString());
    });

    test("a form Teams will not remove leaves just the confirmation: no failure text, nothing thrown", async (): Promise<void> => {
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity({ localTimezone: "America/New_York" }),
        deleteError: teamsRefusal(404, "MessageNotFound"),
      });

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      expect(turn.events).toEqual([
        { kind: "reply", text: NEW_YORK_CONFIRMATION },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
    });

    test("a link that cannot be built still confirms, with the times", async (): Promise<void> => {
      linkSpy.mockRejectedValue(new Error("DashboardUrl is not configured"));
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm());

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: confirmation({
            starts: "Oct 1, 2030, 14:00 (America/New_York)",
            ends: "Oct 1, 2030, 15:00 (America/New_York)",
          }),
        },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
    });

    test("an event read at a bare offset, whose link cannot be built, still says so", async (): Promise<void> => {
      linkSpy.mockRejectedValue(new Error("DashboardUrl is not configured"));
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity({
          rawLocalTimestamp: "2026-09-29T17:30:00.000+05:30",
        }),
      });

      await submitMaintenance(turn, maintenanceForm());

      expect(repliesOf(turn)).toEqual([
        confirmation({
          starts: "Oct 1, 2030, 14:00 (UTC+05:30)",
          ends: "Oct 1, 2030, 15:00 (UTC+05:30)",
          offsetLabel: "UTC+05:30",
        }),
      ]);
    });

    test("an event created without an id is confirmed with its times, without a link", async (): Promise<void> => {
      createSpy.mockResolvedValue(new ScheduledMaintenance());
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm());

      expect(turn.events).toEqual([
        {
          kind: "reply",
          text: confirmation({
            starts: "Oct 1, 2030, 14:00 (America/New_York)",
            ends: "Oct 1, 2030, 15:00 (America/New_York)",
          }),
        },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
      expect(linkSpy).not.toHaveBeenCalled();
    });

    test("an event handed back without its project is linked in the linked project", async (): Promise<void> => {
      const created: ScheduledMaintenance = new ScheduledMaintenance();
      created.id = CREATED_ID;
      createSpy.mockResolvedValue(created);
      const turn: FakeTurn = inNewYork();

      await submitMaintenance(turn, maintenanceForm());

      expect(repliesOf(turn)).toEqual([NEW_YORK_CONFIRMATION]);
      expect(linkSpy).toHaveBeenCalledTimes(1);
      expect(linkSpy.mock.calls[0]![0].toString()).toBe(PROJECT_ID.toString());
      expect(linkSpy.mock.calls[0]![1].toString()).toBe(CREATED_ID.toString());
    });

    test("a submit without a replyToId is confirmed, and nothing is removed", async (): Promise<void> => {
      const turn: FakeTurn = inNewYork({ replyToId: undefined });

      await submitMaintenance(turn, maintenanceForm());

      expect(turn.events).toEqual([
        { kind: "reply", text: NEW_YORK_CONFIRMATION },
      ]);
    });

    test("a confirmation Teams refuses is not followed by a failure reply, and the form still goes", async (): Promise<void> => {
      const turn: FakeTurn = createFakeTurn({
        activity: submitActivity({ localTimezone: "America/New_York" }),
        replyError: teamsRefusal(502, "BadGateway"),
      });

      await expect(
        submitMaintenance(turn, maintenanceForm()),
      ).resolves.toBeUndefined();

      // The event exists; a form left in place invites a duplicate.
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(turn.events).toEqual([
        { kind: "reply", text: NEW_YORK_CONFIRMATION },
        { kind: "delete", activityId: FORM_ACTIVITY_ID },
      ]);
    });
  });
});
