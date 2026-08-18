import Incident from "Common/Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { Blue500, Red500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";

/*
 * Regression tests for the IncidentOwner:SendStateChangeEmail cron's per-row
 * query and CPU fan-out (keep in sync with the AlertOwners twin suite). The
 * job used to fetch each timeline row's incident TWICE - once for the display
 * fields and a second IncidentService.findOneById just to read
 * incidentSeverity.name - and re-ran Markdown.convertToHTML on the same
 * incident description once PER OWNER. The perf fix merges the severity
 * relation into the single incident fetch and hoists the markdown conversion
 * to once per timeline row. These tests pin:
 *   1. the query shape: exactly ONE findOneById per timeline row, whose
 *      select carries both the display fields and the severity relation,
 *   2. exactly ONE Markdown.convertToHTML per row regardless of owner count,
 *   3. the notification payloads (vars, subject, SMS, call, push, feed) are
 *      byte-identical to the old two-query flow, including the severity name
 *      and the converted description,
 *   4. the skip/throw semantics are unchanged: a deleted incident is skipped,
 *      a missing severity relation still throws (no silent ?. downgrade), and
 *      rows without owners never reach the markdown conversion.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under test
 * here, so the module is replaced WITH A FACTORY - an automock would still
 * require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

/*
 * Markdown is mocked so the suite can count convertToHTML calls - THE
 * regression being removed is one conversion per owner instead of per row.
 * The enum values mirror Common/Server/Types/Markdown's MarkdownContentType.
 */
jest.mock("Common/Server/Types/Markdown", () => {
  return {
    __esModule: true,
    MarkdownContentType: {
      Docs: 0,
      Blog: 1,
      Email: 2,
      BlogValidation: 3,
    },
    default: {
      convertToHTML: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getOwners: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return {
    __esModule: true,
    default: {
      createIncidentFeedItem: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      getUserMarkdownString: jest.fn(),
    },
  };
});

import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncidentOwners/SendStateChangeNotification";

interface IncidentServiceMock {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getIncidentLinkInDashboard: jest.Mock;
}

interface TimelineServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOneBy: jest.Mock;
}

interface StateServiceMock {
  findOneById: jest.Mock;
}

interface ProjectServiceMock {
  getOwners: jest.Mock;
}

interface NotificationServiceMock {
  sendUserNotification: jest.Mock;
}

interface FeedServiceMock {
  createIncidentFeedItem: jest.Mock;
}

interface UserServiceMock {
  getUserMarkdownString: jest.Mock;
}

interface MarkdownMock {
  convertToHTML: jest.Mock;
}

const incidentService: IncidentServiceMock =
  IncidentService as unknown as IncidentServiceMock;
const timelineService: TimelineServiceMock =
  IncidentStateTimelineService as unknown as TimelineServiceMock;
const stateService: StateServiceMock =
  IncidentStateService as unknown as StateServiceMock;
const projectService: ProjectServiceMock =
  ProjectService as unknown as ProjectServiceMock;
const notificationService: NotificationServiceMock =
  UserNotificationSettingService as unknown as NotificationServiceMock;
const feedService: FeedServiceMock =
  IncidentFeedService as unknown as FeedServiceMock;
const userService: UserServiceMock = UserService as unknown as UserServiceMock;
const markdownMock: MarkdownMock = Markdown as unknown as MarkdownMock;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const INCIDENT_1_ID: ObjectID = new ObjectID("incident-1");
const INCIDENT_2_ID: ObjectID = new ObjectID("incident-2");
const TIMELINE_1_ID: ObjectID = new ObjectID("timeline-1");
const TIMELINE_2_ID: ObjectID = new ObjectID("timeline-2");
const USER_1_ID: ObjectID = new ObjectID("user-1");
const USER_2_ID: ObjectID = new ObjectID("user-2");
const USER_3_ID: ObjectID = new ObjectID("user-3");

const STATE_CHANGED_AT: Date = new Date("2026-08-18T10:00:00.000Z");
const INCIDENT_LINK: string =
  "https://oneuptime.example.com/dashboard/incident-1";

function makeTimeline(data: {
  id: ObjectID;
  incidentId: ObjectID;
  startsAt?: Date | undefined;
}): IncidentStateTimeline {
  const timeline: IncidentStateTimeline = new IncidentStateTimeline();
  timeline.id = data.id;
  timeline.incidentId = data.incidentId;
  timeline.projectId = PROJECT_ID;
  timeline.createdAt = STATE_CHANGED_AT;

  if (data.startsAt) {
    timeline.startsAt = data.startsAt;
  }

  const project: Project = new Project();
  project.name = "Prod Project";
  timeline.project = project;

  const state: IncidentState = new IncidentState();
  state.name = "Acknowledged";
  state.color = Blue500;
  state.isResolvedState = false;
  timeline.incidentState = state;

  return timeline;
}

function makeIncident(data: {
  id: ObjectID;
  description: string;
  severityName?: string | undefined;
  monitorNames?: Array<string> | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident.id = data.id;
  incident.title = "Database is down";
  incident.projectId = PROJECT_ID;
  incident.description = data.description;
  incident.incidentNumber = 7;
  incident.incidentNumberWithPrefix = "INC-7";

  incident.monitors = (
    data.monitorNames || ["web-server-1", "api-server-1"]
  ).map((name: string) => {
    const monitor: Monitor = new Monitor();
    monitor.name = name;
    return monitor;
  });

  if (data.severityName) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = data.severityName;
    incident.incidentSeverity = severity;
  }

  return incident;
}

function makeUser(id: ObjectID, timezone?: Timezone | undefined): User {
  const user: User = new User();
  user.id = id;

  if (timezone) {
    user.timezone = timezone;
  }

  return user;
}

function stubIncidents(incidents: Array<Incident>): void {
  const incidentsById: Record<string, Incident> = {};

  for (const incident of incidents) {
    incidentsById[incident.id!.toString()] = incident;
  }

  incidentService.findOneById.mockImplementation((args: { id: ObjectID }) => {
    return Promise.resolve(incidentsById[args.id.toString()] || null);
  });
}

interface FindOneByIdArgs {
  id: ObjectID;
  props: { isRoot: boolean };
  select: Record<string, unknown>;
}

function incidentFetchCalls(): Array<FindOneByIdArgs> {
  return incidentService.findOneById.mock.calls.map((args: Array<unknown>) => {
    return args[0] as FindOneByIdArgs;
  });
}

interface SendNotificationArgs {
  userId: ObjectID;
  projectId: ObjectID;
  emailEnvelope: {
    templateType: EmailTemplateType;
    vars: Dictionary<string>;
    subject: string;
  };
  smsMessage: { message: string };
  callRequestMessage: { data: Array<{ sayMessage: string }> };
  pushNotificationMessage: Record<string, unknown>;
  whatsAppMessage: Record<string, unknown>;
  incidentId: ObjectID;
  eventType: NotificationSettingEventType;
}

function sendCalls(): Array<SendNotificationArgs> {
  return notificationService.sendUserNotification.mock.calls.map(
    (args: Array<unknown>) => {
      return args[0] as SendNotificationArgs;
    },
  );
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

function timelineUpdateCalls(): Array<UpdateCallArgs> {
  return timelineService.updateOneById.mock.calls.map(
    (args: Array<unknown>) => {
      return args[0] as UpdateCallArgs;
    },
  );
}

// The deterministic transform the Markdown mock applies to every conversion.
function convertedHtmlOf(markdown: string): string {
  return `<p data-md>${markdown}</p>`;
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["IncidentOwner:SendStateChangeEmail"];

  if (!handler) {
    throw new Error(
      "IncidentOwner:SendStateChangeEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncidentOwner:SendStateChangeEmail worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(OneUptimeDate, "getDateAsFormattedHTMLInMultipleTimezones")
      .mockImplementation(
        (data: {
          date: string | Date;
          timezones?: Array<Timezone> | undefined;
        }): string => {
          return `formatted:${new Date(data.date).toISOString()}:${(
            data.timezones || []
          ).join(",")}`;
        },
      );

    markdownMock.convertToHTML.mockImplementation((markdown: string) => {
      return Promise.resolve(convertedHtmlOf(markdown));
    });

    timelineService.findAllBy.mockResolvedValue([]);
    timelineService.updateOneById.mockResolvedValue(undefined);
    timelineService.findOneBy.mockResolvedValue(null);
    stateService.findOneById.mockResolvedValue(null);
    incidentService.findOneById.mockResolvedValue(null);
    incidentService.findOwners.mockResolvedValue([]);
    incidentService.getIncidentLinkInDashboard.mockResolvedValue(INCIDENT_LINK);
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    feedService.createIncidentFeedItem.mockResolvedValue(undefined);
    userService.getUserMarkdownString.mockImplementation(
      (data: { userId: ObjectID }) => {
        return Promise.resolve(`@${data.userId.toString()}`);
      },
    );
  });

  test("fetches the incident EXACTLY ONCE per timeline row, selecting the severity relation alongside the display fields", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
    ]);
    stubIncidents([
      makeIncident({
        id: INCIDENT_1_ID,
        description: "**Database** is unreachable",
        severityName: "Critical",
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await runWorkerTick();

    // THE removed regression: a second findOneById just for the severity name.
    expect(incidentService.findOneById).toHaveBeenCalledTimes(1);

    const fetch: FindOneByIdArgs = incidentFetchCalls()[0]!;

    expect(fetch.id.toString()).toBe(INCIDENT_1_ID.toString());
    expect(fetch.props).toEqual({ isRoot: true });

    // The single select now carries the severity relation...
    expect(fetch.select["incidentSeverity"]).toEqual({ name: true });

    // ...alongside every field the old first query selected.
    expect(fetch.select).toMatchObject({
      _id: true,
      title: true,
      description: true,
      projectId: true,
      monitors: { name: true },
      incidentNumber: true,
      incidentNumberWithPrefix: true,
    });

    // The row still completes end to end off the merged fetch.
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(sendCalls()[0]!.emailEnvelope.vars["incidentSeverity"]).toBe(
      "Critical",
    );
    expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
  });

  test("converts the description markdown ONCE PER ROW, not once per owner, across 3 owners and 2 rows", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
      makeTimeline({ id: TIMELINE_2_ID, incidentId: INCIDENT_2_ID }),
    ]);
    stubIncidents([
      makeIncident({
        id: INCIDENT_1_ID,
        description: "row one description",
        severityName: "Critical",
      }),
      makeIncident({
        id: INCIDENT_2_ID,
        description: "row two description",
        severityName: "Critical",
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([
      makeUser(USER_1_ID),
      makeUser(USER_2_ID),
      makeUser(USER_3_ID),
    ]);

    await runWorkerTick();

    // 3 owners per row still notify individually...
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(6);

    // ...but the markdown converts once per ROW (the old code did 6 here).
    expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(2);
    expect(markdownMock.convertToHTML).toHaveBeenNthCalledWith(
      1,
      "row one description",
      MarkdownContentType.Email,
    );
    expect(markdownMock.convertToHTML).toHaveBeenNthCalledWith(
      2,
      "row two description",
      MarkdownContentType.Email,
    );

    // Every owner of a row still receives that row's converted description.
    const descriptions: Array<string> = sendCalls().map(
      (call: SendNotificationArgs) => {
        return call.emailEnvelope.vars["incidentDescription"]!;
      },
    );

    expect(descriptions).toEqual([
      convertedHtmlOf("row one description"),
      convertedHtmlOf("row one description"),
      convertedHtmlOf("row one description"),
      convertedHtmlOf("row two description"),
      convertedHtmlOf("row two description"),
      convertedHtmlOf("row two description"),
    ]);

    // One merged incident fetch per row - never a severity re-fetch.
    expect(incidentService.findOneById).toHaveBeenCalledTimes(2);
  });

  test("sends byte-identical notification payloads to the old two-query flow, previous state included", async () => {
    const startsAt: Date = STATE_CHANGED_AT;
    const previousStartsAt: Date = new Date("2026-08-18T08:00:00.000Z");

    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID, startsAt }),
    ]);
    stubIncidents([
      makeIncident({
        id: INCIDENT_1_ID,
        description: "**Database** is unreachable",
        severityName: "Critical",
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([
      makeUser(USER_1_ID, Timezone.AmericaNew_York),
      makeUser(USER_2_ID),
      makeUser(USER_3_ID),
    ]);

    const previousTimeline: IncidentStateTimeline = new IncidentStateTimeline();
    previousTimeline.incidentStateId = new ObjectID("state-identified");
    previousTimeline.startsAt = previousStartsAt;
    previousTimeline.createdAt = previousStartsAt;
    timelineService.findOneBy.mockResolvedValue(previousTimeline);

    const previousState: IncidentState = new IncidentState();
    previousState.name = "Identified";
    previousState.color = Red500;
    stateService.findOneById.mockResolvedValue(previousState);

    await runWorkerTick();

    const expectedDuration: string =
      OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
        OneUptimeDate.getDifferenceInSeconds(startsAt, previousStartsAt),
      );

    const expectedVarsFor: (timezones: string) => Dictionary<string> = (
      timezones: string,
    ) => {
      return {
        incidentTitle: "Database is down",
        incidentNumber: "INC-7",
        projectName: "Prod Project",
        currentState: "Acknowledged",
        currentStateColor: Blue500.toString(),
        previousState: "Identified",
        previousStateColor: Red500.toString(),
        previousStateDurationText: `Was Identified for ${expectedDuration}`,
        incidentDescription: convertedHtmlOf("**Database** is unreachable"),
        resourcesAffected: "web-server-1, api-server-1",
        stateChangedAt: `formatted:${STATE_CHANGED_AT.toISOString()}:${timezones}`,
        incidentSeverity: "Critical",
        incidentViewLink: INCIDENT_LINK,
        isOwner: "true",
      };
    };

    const calls: Array<SendNotificationArgs> = sendCalls();

    expect(calls).toHaveLength(3);

    // Per-owner vars: identical except for the owner's timezone rendering.
    expect(calls[0]!.emailEnvelope.vars).toEqual(
      expectedVarsFor(Timezone.AmericaNew_York),
    );
    expect(calls[1]!.emailEnvelope.vars).toEqual(expectedVarsFor(""));
    expect(calls[2]!.emailEnvelope.vars).toEqual(expectedVarsFor(""));

    for (const [index, call] of calls.entries()) {
      expect(call.userId.toString()).toBe(
        [USER_1_ID, USER_2_ID, USER_3_ID][index]!.toString(),
      );
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call.incidentId.toString()).toBe(INCIDENT_1_ID.toString());
      expect(call.eventType).toBe(
        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
      );
      expect(call.emailEnvelope.templateType).toBe(
        EmailTemplateType.IncidentOwnerStateChanged,
      );
      expect(call.emailEnvelope.subject).toBe(
        "[Acknowledged Incident INC-7] - Database is down",
      );
      expect(call.smsMessage.message).toBe(
        "This is a message from OneUptime. Incident INC-7 (Database is down) - state changed from Identified to Acknowledged. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.",
      );
      expect(call.callRequestMessage.data[0]!.sayMessage).toBe(
        "This is a message from OneUptime. Incident INC-7 (Database is down) state changed from Identified to Acknowledged. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.",
      );
      expect(call.pushNotificationMessage).toMatchObject({
        title: "Incident #7 Updated: Database is down",
        body: "Incident #7 (Database is down) state changed from Identified to Acknowledged in Prod Project. Click to view details.",
        clickAction: INCIDENT_LINK,
        tag: "incident-state-changed",
        requireInteraction: true,
      });
    }

    // The row is marked notified exactly once, before the fan-out.
    const updates: Array<UpdateCallArgs> = timelineUpdateCalls();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id.toString()).toBe(TIMELINE_1_ID.toString());
    expect(updates[0]!.data).toEqual({ isOwnerNotified: true });

    // The feed item is unchanged, one entry per notified owner.
    expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
    expect(feedService.createIncidentFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Incident INC-7](${INCIDENT_LINK}).**: Owners have been notified about the state change of the incident because the incident state changed to **Acknowledged**.`,
        moreInformationInMarkdown: `**Notified:** @${USER_1_ID.toString()})\n**Notified:** @${USER_2_ID.toString()})\n**Notified:** @${USER_3_ID.toString()})\n`,
      }),
    );
  });

  test("a row whose incident no longer exists is skipped exactly as before, without blocking later rows", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
      makeTimeline({ id: TIMELINE_2_ID, incidentId: INCIDENT_2_ID }),
    ]);
    // INCIDENT_1 was deleted - only INCIDENT_2 still resolves.
    stubIncidents([
      makeIncident({
        id: INCIDENT_2_ID,
        description: "surviving row",
        severityName: "Critical",
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await expect(runWorkerTick()).resolves.toBeUndefined();

    // Still exactly one fetch per row - the null result costs no extra query.
    expect(incidentService.findOneById).toHaveBeenCalledTimes(2);

    // The deleted row is skipped BEFORE the mark-notified write and the send.
    const updates: Array<UpdateCallArgs> = timelineUpdateCalls();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id.toString()).toBe(TIMELINE_2_ID.toString());

    expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(1);
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(sendCalls()[0]!.incidentId.toString()).toBe(
      INCIDENT_2_ID.toString(),
    );
    expect(feedService.createIncidentFeedItem).toHaveBeenCalledTimes(1);
  });

  test("a missing severity relation still throws after the mark-notified write - never silently downgraded", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
    ]);
    stubIncidents([
      makeIncident({ id: INCIDENT_1_ID, description: "no severity row" }),
    ]);
    incidentService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await expect(runWorkerTick()).rejects.toThrow(TypeError);

    // Same as the old flow: the row was already marked notified...
    expect(timelineService.updateOneById).toHaveBeenCalledTimes(1);

    // ...and no notification went out.
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });

  test("a row with no owners at all is marked notified and skipped without converting markdown", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
    ]);
    stubIncidents([
      makeIncident({
        id: INCIDENT_1_ID,
        description: "unowned row",
        severityName: "Critical",
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    await runWorkerTick();

    expect(projectService.getOwners).toHaveBeenCalledTimes(1);
    expect(timelineService.updateOneById).toHaveBeenCalledTimes(1);

    // The hoisted conversion still sits behind the owners gate.
    expect(markdownMock.convertToHTML).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    expect(feedService.createIncidentFeedItem).not.toHaveBeenCalled();
  });

  test("project-owner fallback still notifies without the isOwner flag and maps zero monitors to None", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, incidentId: INCIDENT_1_ID }),
    ]);
    stubIncidents([
      makeIncident({
        id: INCIDENT_1_ID,
        description: "fallback row",
        severityName: "Low",
        monitorNames: [],
      }),
    ]);
    incidentService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([makeUser(USER_2_ID)]);

    await runWorkerTick();

    const calls: Array<SendNotificationArgs> = sendCalls();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.userId.toString()).toBe(USER_2_ID.toString());
    expect(calls[0]!.emailEnvelope.vars["isOwner"]).toBeUndefined();
    expect(calls[0]!.emailEnvelope.vars["incidentSeverity"]).toBe("Low");
    expect(calls[0]!.emailEnvelope.vars["resourcesAffected"]).toBe("None");
    expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(1);
  });
});
