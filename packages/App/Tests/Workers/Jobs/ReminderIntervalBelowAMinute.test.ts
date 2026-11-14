import Alert from "Common/Models/DatabaseModels/Alert";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";

/*
 * A REMINDER RULE WITH AN INTERVAL BELOW A MINUTE REMINDS NOBODY.
 *
 * The workers that remind an open incident's, alert's or scheduled
 * maintenance event's owners run every minute, send the reminders that are
 * due and put the next one "Reminder Interval (Minutes)" later. A rule
 * saved with -5 - which the API took until its services checked the
 * interval (Types/Reminder/ReminderInterval) - put every next reminder five
 * minutes in the past, so it was due again on the next run: the owners were
 * reminded every minute, by every channel, until the record was resolved.
 *
 * Such a rule, saved before the check, now reminds nobody, as a rule with no
 * interval always did: the record's reminders stop, and nobody is told
 * anything. A rule with a real interval reminds as it did.
 *
 * Each test drives one tick of the real worker; RunCron is mocked to capture
 * its handler, and every service it calls is mocked.
 */

type CronHandler = () => Promise<void>;

// Captured cron handlers, keyed by job name: declared before the mocks use it.
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// Nothing password-related is under test; the real module is never loaded.
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

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      isAlertResolved: jest.fn(),
      isAlertAcknowledged: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      isIncidentResolved: jest.fn(),
      isIncidentAcknowledged: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOwners: jest.fn(),
      isScheduledMaintenanceCompleted: jest.fn(),
      isScheduledMaintenanceOngoing: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertReminderRuleService", () => {
  return { __esModule: true, default: { findMatchingRule: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return { __esModule: true, default: { findMatchingRule: jest.fn() } };
});

jest.mock(
  "Common/Server/Services/ScheduledMaintenanceReminderRuleService",
  () => {
    return { __esModule: true, default: { findMatchingRule: jest.fn() } };
  },
);

jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { getOwners: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return { __esModule: true, default: { sendUserNotification: jest.fn() } };
});

jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { getUserMarkdownString: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertFeedService", () => {
  return { __esModule: true, default: { createAlertFeedItem: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return { __esModule: true, default: { createIncidentFeedItem: jest.fn() } };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return {
    __esModule: true,
    default: { createScheduledMaintenanceFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createGenericNotification: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/WhatsAppTemplateUtil", () => {
  return {
    __esModule: true,
    createWhatsAppMessageFromTemplate: jest.fn(() => {
      return { templateVariables: {} };
    }),
  };
});

import AlertService from "Common/Server/Services/AlertService";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification";

type MockedService = Record<string, jest.Mock>;

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");
const OPENED_AT: Date = new Date("2026-11-12T08:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MINUTE_IN_MS: number = 60 * 1000;

const projectService: MockedService =
  ProjectService as unknown as MockedService;
const notificationService: MockedService =
  UserNotificationSettingService as unknown as MockedService;

interface Subject {
  name: string;
  job: string;
  recordId: ObjectID;
  service: MockedService;
  ruleService: MockedService;
  feedService: MockedService;
  feedMethod: string;
  // The check the worker makes first once it has an interval to follow.
  isClosed: string;
  makeRecord: () => BaseModel;
  makeRule: (interval: unknown) => BaseModel;
}

function withInterval(rule: BaseModel, interval: unknown): BaseModel {
  (rule as unknown as Record<string, unknown>)["reminderIntervalInMinutes"] =
    interval;
  return rule;
}

const ALERT_ID: ObjectID = new ObjectID("alert-1");
const INCIDENT_ID: ObjectID = new ObjectID("incident-1");
const MAINTENANCE_ID: ObjectID = new ObjectID("maintenance-1");

const SUBJECTS: Array<Subject> = [
  {
    name: "an alert",
    job: "AlertOwner:SendUnresolvedReminderNotification",
    recordId: ALERT_ID,
    service: AlertService as unknown as MockedService,
    ruleService: AlertReminderRuleService as unknown as MockedService,
    feedService: AlertFeedService as unknown as MockedService,
    feedMethod: "createAlertFeedItem",
    isClosed: "isAlertResolved",
    makeRecord: (): BaseModel => {
      const alert: Alert = new Alert(ALERT_ID);
      alert.projectId = PROJECT_ID;
      alert.title = "Disk almost full";
      alert.labels = [];
      alert.createdAt = OPENED_AT;
      alert.enableReminders = true;
      alert.reminderNotificationSentCount = 2;
      return alert;
    },
    makeRule: (interval: unknown): BaseModel => {
      return withInterval(new AlertReminderRule(), interval);
    },
  },
  {
    name: "an incident",
    job: "IncidentOwner:SendUnresolvedReminderNotification",
    recordId: INCIDENT_ID,
    service: IncidentService as unknown as MockedService,
    ruleService: IncidentReminderRuleService as unknown as MockedService,
    feedService: IncidentFeedService as unknown as MockedService,
    feedMethod: "createIncidentFeedItem",
    isClosed: "isIncidentResolved",
    makeRecord: (): BaseModel => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.projectId = PROJECT_ID;
      incident.title = "API is down";
      incident.labels = [];
      incident.createdAt = OPENED_AT;
      incident.declaredAt = OPENED_AT;
      incident.enableReminders = true;
      incident.reminderNotificationSentCount = 2;
      return incident;
    },
    makeRule: (interval: unknown): BaseModel => {
      return withInterval(new IncidentReminderRule(), interval);
    },
  },
  {
    name: "a scheduled maintenance event",
    job: "ScheduledMaintenanceOwner:SendUnresolvedReminderNotification",
    recordId: MAINTENANCE_ID,
    service: ScheduledMaintenanceService as unknown as MockedService,
    ruleService:
      ScheduledMaintenanceReminderRuleService as unknown as MockedService,
    feedService: ScheduledMaintenanceFeedService as unknown as MockedService,
    feedMethod: "createScheduledMaintenanceFeedItem",
    isClosed: "isScheduledMaintenanceCompleted",
    makeRecord: (): BaseModel => {
      return makeMaintenance(OPENED_AT);
    },
    makeRule: (interval: unknown): BaseModel => {
      const rule: ScheduledMaintenanceReminderRule =
        new ScheduledMaintenanceReminderRule();
      rule.remindWhileScheduled = true;
      return withInterval(rule, interval);
    },
  },
];

function makeMaintenance(startsAt: Date): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance(MAINTENANCE_ID);
  event.projectId = PROJECT_ID;
  event.title = "Database upgrade";
  event.labels = [];
  event.createdAt = OPENED_AT;
  event.startsAt = startsAt;
  event.endsAt = OneUptimeDate.addRemoveHours(startsAt, 4);
  event.enableReminders = true;
  event.reminderNotificationSentCount = 2;
  return event;
}

async function runTick(subject: Subject): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[subject.job];

  if (!handler) {
    throw new Error(`${subject.job} did not register a cron handler.`);
  }

  await handler();
}

// What each updateOneById of the record wrote, in order.
function writesOf(subject: Subject): Array<Record<string, unknown>> {
  return subject.service["updateOneById"]!.mock.calls.map(
    (args: Array<unknown>): Record<string, unknown> => {
      const update: {
        id: ObjectID;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      } = args[0] as {
        id: ObjectID;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(update.id.toString()).toBe(subject.recordId.toString());
      expect(update.props).toEqual({ isRoot: true });

      return update.data;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  /*
   * The clock reads NOW everywhere: OneUptimeDate.isInTheFuture reads
   * `new Date()`, not getCurrentDate. Only Date is faked - timers run. And
   * performance and hrtime are left alone: the fake timers of App's jest
   * cannot redefine Node's performance ("Cannot redefine property").
   */
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "hrtime",
      "performance",
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "queueMicrotask",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW);
  });

  for (const subject of SUBJECTS) {
    for (const method of Object.keys(subject.service)) {
      subject.service[method]!.mockResolvedValue(undefined);
    }

    subject.service["findAllBy"]!.mockResolvedValue([]);
    subject.service["findOwners"]!.mockResolvedValue([]);
    subject.service[subject.isClosed]!.mockResolvedValue(false);
    subject.ruleService["findMatchingRule"]!.mockResolvedValue(null);
    subject.feedService[subject.feedMethod]!.mockResolvedValue(undefined);
  }

  projectService["getOwners"]!.mockResolvedValue([]);
  notificationService["sendUserNotification"]!.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each(SUBJECTS)("the reminder worker of $name", (subject: Subject) => {
  function due(interval: unknown): void {
    subject.service["findAllBy"]!.mockResolvedValue([subject.makeRecord()]);
    subject.ruleService["findMatchingRule"]!.mockResolvedValue(
      subject.makeRule(interval),
    );
  }

  test.each([
    ["-5", -5],
    ["-1", -1],
    ["0", 0],
    ["no interval", null],
  ])(
    "a rule reminding every %s minutes stops the reminders and tells nobody",
    async (_label: string, interval: number | null) => {
      due(interval);

      await runTick(subject);

      // Its next reminder is taken away: it is not due again next minute.
      expect(writesOf(subject)).toEqual([{ nextReminderNotificationAt: null }]);

      // Nothing is sent, and nothing more is looked up.
      expect(subject.service[subject.isClosed]).not.toHaveBeenCalled();
      expect(subject.service["findOwners"]).not.toHaveBeenCalled();
      expect(projectService["getOwners"]).not.toHaveBeenCalled();
      expect(
        notificationService["sendUserNotification"],
      ).not.toHaveBeenCalled();
      expect(subject.feedService[subject.feedMethod]).not.toHaveBeenCalled();
    },
  );

  test("a rule reminding every 45 minutes puts the next reminder 45 minutes on, as it did", async () => {
    due(45);

    await runTick(subject);

    expect(writesOf(subject)[0]).toEqual({
      nextReminderNotificationAt: new Date(NOW.getTime() + 45 * MINUTE_IN_MS),
      reminderNotificationSentCount: 3,
    });
    expect(subject.service["findOwners"]).toHaveBeenCalledTimes(1);
  });

  test("a rule reminding every minute is the shortest that reminds", async () => {
    due(1);

    await runTick(subject);

    expect(writesOf(subject)[0]?.["nextReminderNotificationAt"]).toEqual(
      new Date(NOW.getTime() + MINUTE_IN_MS),
    );
  });
});

describe("a scheduled maintenance event that has not started, with a rule that waits for the start", () => {
  const subject: Subject = SUBJECTS[2]!;
  const STARTS_AT: Date = new Date("2026-11-12T12:00:00.000Z");

  function due(interval: number): void {
    subject.service["findAllBy"]!.mockResolvedValue([
      makeMaintenance(STARTS_AT),
    ]);

    const rule: ScheduledMaintenanceReminderRule =
      new ScheduledMaintenanceReminderRule();
    rule.remindWhileScheduled = false;
    rule.reminderIntervalInMinutes = interval;
    subject.ruleService["findMatchingRule"]!.mockResolvedValue(rule);
  }

  test("its first reminder is an interval after the start", async () => {
    due(45);

    await runTick(subject);

    expect(writesOf(subject)).toEqual([
      {
        nextReminderNotificationAt: new Date(
          STARTS_AT.getTime() + 45 * MINUTE_IN_MS,
        ),
      },
    ]);
  });

  test("an interval of -5 does not put it five minutes before the start: it stops", async () => {
    due(-5);

    await runTick(subject);

    expect(writesOf(subject)).toEqual([{ nextReminderNotificationAt: null }]);
    expect(notificationService["sendUserNotification"]).not.toHaveBeenCalled();
  });
});
