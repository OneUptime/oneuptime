import Alert from "Common/Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
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
 * Regression tests for the AlertOwner:SendStateChangeEmail cron's per-row
 * query and CPU fan-out (keep in sync with the IncidentOwners twin suite).
 * The job used to fetch each timeline row's alert TWICE - once for the
 * display fields and a second AlertService.findOneById just to read
 * alertSeverity.name - and re-ran Markdown.convertToHTML on the same alert
 * description once PER OWNER. The perf fix merges the severity relation into
 * the single alert fetch and hoists the markdown conversion to once per
 * timeline row. These tests pin:
 *   1. the query shape: exactly ONE findOneById per timeline row, whose
 *      select carries both the display fields and the severity relation,
 *   2. exactly ONE Markdown.convertToHTML per row regardless of owner count,
 *   3. the notification payloads (vars, subject, SMS, call, push, feed) are
 *      byte-identical to the old two-query flow, including the severity name
 *      and the converted description,
 *   4. the skip/throw semantics are unchanged: a deleted alert is skipped, a
 *      missing severity relation still throws (no silent ?. downgrade), and
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

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
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

jest.mock("Common/Server/Services/AlertFeedService", () => {
  return {
    __esModule: true,
    default: {
      createAlertFeedItem: jest.fn(),
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

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification";

interface AlertServiceMock {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getAlertLinkInDashboard: jest.Mock;
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
  createAlertFeedItem: jest.Mock;
}

interface UserServiceMock {
  getUserMarkdownString: jest.Mock;
}

interface MarkdownMock {
  convertToHTML: jest.Mock;
}

const alertService: AlertServiceMock =
  AlertService as unknown as AlertServiceMock;
const timelineService: TimelineServiceMock =
  AlertStateTimelineService as unknown as TimelineServiceMock;
const stateService: StateServiceMock =
  AlertStateService as unknown as StateServiceMock;
const projectService: ProjectServiceMock =
  ProjectService as unknown as ProjectServiceMock;
const notificationService: NotificationServiceMock =
  UserNotificationSettingService as unknown as NotificationServiceMock;
const feedService: FeedServiceMock =
  AlertFeedService as unknown as FeedServiceMock;
const userService: UserServiceMock = UserService as unknown as UserServiceMock;
const markdownMock: MarkdownMock = Markdown as unknown as MarkdownMock;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const ALERT_1_ID: ObjectID = new ObjectID("alert-1");
const ALERT_2_ID: ObjectID = new ObjectID("alert-2");
const TIMELINE_1_ID: ObjectID = new ObjectID("timeline-1");
const TIMELINE_2_ID: ObjectID = new ObjectID("timeline-2");
const USER_1_ID: ObjectID = new ObjectID("user-1");
const USER_2_ID: ObjectID = new ObjectID("user-2");
const USER_3_ID: ObjectID = new ObjectID("user-3");

const STATE_CHANGED_AT: Date = new Date("2026-08-18T10:00:00.000Z");
const ALERT_LINK: string = "https://oneuptime.example.com/dashboard/alert-1";

function makeTimeline(data: {
  id: ObjectID;
  alertId: ObjectID;
  startsAt?: Date | undefined;
}): AlertStateTimeline {
  const timeline: AlertStateTimeline = new AlertStateTimeline();
  timeline.id = data.id;
  timeline.alertId = data.alertId;
  timeline.projectId = PROJECT_ID;
  timeline.createdAt = STATE_CHANGED_AT;

  if (data.startsAt) {
    timeline.startsAt = data.startsAt;
  }

  const project: Project = new Project();
  project.name = "Prod Project";
  timeline.project = project;

  const state: AlertState = new AlertState();
  state.name = "Acknowledged";
  state.color = Blue500;
  timeline.alertState = state;

  return timeline;
}

function makeAlert(data: {
  id: ObjectID;
  description: string;
  severityName?: string | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert.id = data.id;
  alert.title = "CPU is high";
  alert.projectId = PROJECT_ID;
  alert.description = data.description;
  alert.alertNumber = 42;
  alert.alertNumberWithPrefix = "AL-42";

  const monitor: Monitor = new Monitor();
  monitor.name = "web-server-1";
  alert.monitor = monitor;

  if (data.severityName) {
    const severity: AlertSeverity = new AlertSeverity();
    severity.name = data.severityName;
    alert.alertSeverity = severity;
  }

  return alert;
}

function makeUser(id: ObjectID, timezone?: Timezone | undefined): User {
  const user: User = new User();
  user.id = id;

  if (timezone) {
    user.timezone = timezone;
  }

  return user;
}

function stubAlerts(alerts: Array<Alert>): void {
  const alertsById: Record<string, Alert> = {};

  for (const alert of alerts) {
    alertsById[alert.id!.toString()] = alert;
  }

  alertService.findOneById.mockImplementation((args: { id: ObjectID }) => {
    return Promise.resolve(alertsById[args.id.toString()] || null);
  });
}

interface FindOneByIdArgs {
  id: ObjectID;
  props: { isRoot: boolean };
  select: Record<string, unknown>;
}

function alertFetchCalls(): Array<FindOneByIdArgs> {
  return alertService.findOneById.mock.calls.map((args: Array<unknown>) => {
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
  alertId: ObjectID;
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
    mockCapturedJobs["AlertOwner:SendStateChangeEmail"];

  if (!handler) {
    throw new Error(
      "AlertOwner:SendStateChangeEmail did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("AlertOwner:SendStateChangeEmail worker", () => {
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
    alertService.findOneById.mockResolvedValue(null);
    alertService.findOwners.mockResolvedValue([]);
    alertService.getAlertLinkInDashboard.mockResolvedValue(ALERT_LINK);
    projectService.getOwners.mockResolvedValue([]);
    notificationService.sendUserNotification.mockResolvedValue(undefined);
    feedService.createAlertFeedItem.mockResolvedValue(undefined);
    userService.getUserMarkdownString.mockImplementation(
      (data: { userId: ObjectID }) => {
        return Promise.resolve(`@${data.userId.toString()}`);
      },
    );
  });

  test("fetches the alert EXACTLY ONCE per timeline row, selecting the severity relation alongside the display fields", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
    ]);
    stubAlerts([
      makeAlert({
        id: ALERT_1_ID,
        description: "**CPU** load is high",
        severityName: "Critical",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await runWorkerTick();

    // THE removed regression: a second findOneById just for the severity name.
    expect(alertService.findOneById).toHaveBeenCalledTimes(1);

    const fetch: FindOneByIdArgs = alertFetchCalls()[0]!;

    expect(fetch.id.toString()).toBe(ALERT_1_ID.toString());
    expect(fetch.props).toEqual({ isRoot: true });

    // The single select now carries the severity relation...
    expect(fetch.select["alertSeverity"]).toEqual({ name: true });

    // ...alongside every field the old first query selected.
    expect(fetch.select).toMatchObject({
      _id: true,
      title: true,
      projectId: true,
      description: true,
      monitor: { name: true },
      alertNumber: true,
      alertNumberWithPrefix: true,
    });

    // The row still completes end to end off the merged fetch.
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(sendCalls()[0]!.emailEnvelope.vars["alertSeverity"]).toBe(
      "Critical",
    );
    expect(feedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
  });

  test("converts the description markdown ONCE PER ROW, not once per owner, across 3 owners and 2 rows", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
      makeTimeline({ id: TIMELINE_2_ID, alertId: ALERT_2_ID }),
    ]);
    stubAlerts([
      makeAlert({
        id: ALERT_1_ID,
        description: "row one description",
        severityName: "Critical",
      }),
      makeAlert({
        id: ALERT_2_ID,
        description: "row two description",
        severityName: "Critical",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([
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
        return call.emailEnvelope.vars["alertDescription"]!;
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

    // One merged alert fetch per row - never a severity re-fetch.
    expect(alertService.findOneById).toHaveBeenCalledTimes(2);
  });

  test("sends byte-identical notification payloads to the old two-query flow, previous state included", async () => {
    const startsAt: Date = STATE_CHANGED_AT;
    const previousStartsAt: Date = new Date("2026-08-18T08:00:00.000Z");

    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID, startsAt }),
    ]);
    stubAlerts([
      makeAlert({
        id: ALERT_1_ID,
        description: "**CPU** load is high",
        severityName: "Critical",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([
      makeUser(USER_1_ID, Timezone.AmericaNew_York),
      makeUser(USER_2_ID),
      makeUser(USER_3_ID),
    ]);

    const previousTimeline: AlertStateTimeline = new AlertStateTimeline();
    previousTimeline.alertStateId = new ObjectID("state-identified");
    previousTimeline.startsAt = previousStartsAt;
    previousTimeline.createdAt = previousStartsAt;
    timelineService.findOneBy.mockResolvedValue(previousTimeline);

    const previousState: AlertState = new AlertState();
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
        alertTitle: "CPU is high",
        alertNumber: "AL-42",
        projectName: "Prod Project",
        currentState: "Acknowledged",
        currentStateColor: Blue500.toString(),
        previousState: "Identified",
        previousStateColor: Red500.toString(),
        previousStateDurationText: `Was Identified for ${expectedDuration}`,
        alertDescription: convertedHtmlOf("**CPU** load is high"),
        resourcesAffected: "web-server-1",
        /*
         * Added when the resolution email learned to say WHY the state
         * changed and to preview itself in the inbox. "" rather than absent
         * for stateChangeRootCause: the template's guard is a presence check
         * and the worker assigns it unconditionally.
         */
        stateChangeRootCause: "",
        preheader:
          "Acknowledged \u00b7 web-server-1 \u00b7 Was Identified for 2 hours",
        stateChangedAt: `formatted:${STATE_CHANGED_AT.toISOString()}:${timezones}`,
        alertSeverity: "Critical",
        alertViewLink: ALERT_LINK,
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
      expect(call.alertId.toString()).toBe(ALERT_1_ID.toString());
      expect(call.eventType).toBe(
        NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION,
      );
      expect(call.emailEnvelope.templateType).toBe(
        EmailTemplateType.AlertOwnerStateChanged,
      );
      expect(call.emailEnvelope.subject).toBe(
        "[Acknowledged Alert AL-42] - CPU is high",
      );
      expect(call.smsMessage.message).toBe(
        "This is a message from OneUptime. Alert AL-42 (CPU is high) - state changed from Identified to Acknowledged. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.",
      );
      expect(call.callRequestMessage.data[0]!.sayMessage).toBe(
        "This is a message from OneUptime. Alert AL-42 (CPU is high) state changed from Identified to Acknowledged. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.",
      );
      expect(call.pushNotificationMessage).toMatchObject({
        title: "Alert AL-42 State Changed: CPU is high",
        body: "Alert AL-42 state changed from Identified to Acknowledged in Prod Project. Click to view details.",
        clickAction: ALERT_LINK,
        tag: "alert-state-changed",
        requireInteraction: true,
      });
    }

    // The row is marked notified exactly once, before the fan-out.
    const updates: Array<UpdateCallArgs> = timelineUpdateCalls();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id.toString()).toBe(TIMELINE_1_ID.toString());
    expect(updates[0]!.data).toEqual({ isOwnerNotified: true });

    // The feed item is unchanged, one entry per notified owner.
    expect(feedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
    expect(feedService.createAlertFeedItem).toHaveBeenCalledWith(
      expect.objectContaining({
        alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Alert AL-42](${ALERT_LINK}).**: Owners have been notified about the state change of the alert because the alert state changed to **Acknowledged**.`,
        moreInformationInMarkdown: `**Notified:** @${USER_1_ID.toString()})\n**Notified:** @${USER_2_ID.toString()})\n**Notified:** @${USER_3_ID.toString()})\n`,
      }),
    );
  });

  test("a row whose alert no longer exists is skipped exactly as before, without blocking later rows", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
      makeTimeline({ id: TIMELINE_2_ID, alertId: ALERT_2_ID }),
    ]);
    // ALERT_1 was deleted - only ALERT_2 still resolves.
    stubAlerts([
      makeAlert({
        id: ALERT_2_ID,
        description: "surviving row",
        severityName: "Critical",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await expect(runWorkerTick()).resolves.toBeUndefined();

    // Still exactly one fetch per row - the null result costs no extra query.
    expect(alertService.findOneById).toHaveBeenCalledTimes(2);

    // The deleted row is skipped BEFORE the mark-notified write and the send.
    const updates: Array<UpdateCallArgs> = timelineUpdateCalls();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.id.toString()).toBe(TIMELINE_2_ID.toString());

    expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(1);
    expect(notificationService.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(sendCalls()[0]!.alertId.toString()).toBe(ALERT_2_ID.toString());
    expect(feedService.createAlertFeedItem).toHaveBeenCalledTimes(1);
  });

  test("a missing severity relation still throws after the mark-notified write - never silently downgraded", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
    ]);
    stubAlerts([makeAlert({ id: ALERT_1_ID, description: "no severity row" })]);
    alertService.findOwners.mockResolvedValue([makeUser(USER_1_ID)]);

    await expect(runWorkerTick()).rejects.toThrow(TypeError);

    // Same as the old flow: the row was already marked notified...
    expect(timelineService.updateOneById).toHaveBeenCalledTimes(1);

    // ...and no notification went out.
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
  });

  test("a row with no owners at all is marked notified and skipped without converting markdown", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
    ]);
    stubAlerts([
      makeAlert({
        id: ALERT_1_ID,
        description: "unowned row",
        severityName: "Critical",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([]);

    await runWorkerTick();

    expect(projectService.getOwners).toHaveBeenCalledTimes(1);
    expect(timelineService.updateOneById).toHaveBeenCalledTimes(1);

    // The hoisted conversion still sits behind the owners gate.
    expect(markdownMock.convertToHTML).not.toHaveBeenCalled();
    expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
    expect(feedService.createAlertFeedItem).not.toHaveBeenCalled();
  });

  test("project-owner fallback still notifies without the isOwner flag", async () => {
    timelineService.findAllBy.mockResolvedValue([
      makeTimeline({ id: TIMELINE_1_ID, alertId: ALERT_1_ID }),
    ]);
    stubAlerts([
      makeAlert({
        id: ALERT_1_ID,
        description: "fallback row",
        severityName: "Low",
      }),
    ]);
    alertService.findOwners.mockResolvedValue([]);
    projectService.getOwners.mockResolvedValue([makeUser(USER_2_ID)]);

    await runWorkerTick();

    const calls: Array<SendNotificationArgs> = sendCalls();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.userId.toString()).toBe(USER_2_ID.toString());
    expect(calls[0]!.emailEnvelope.vars["isOwner"]).toBeUndefined();
    expect(calls[0]!.emailEnvelope.vars["alertSeverity"]).toBe("Low");
    expect(markdownMock.convertToHTML).toHaveBeenCalledTimes(1);
  });
});
