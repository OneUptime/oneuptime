import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import MailService from "Common/Server/Services/MailService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import Markdown from "Common/Server/Types/Markdown";
import PickedStatusPagesReachBuilder from "Common/Server/Utils/StatusPage/PickedStatusPagesReachBuilder";
import { SCHEDULED_MAINTENANCE_RECORD } from "Common/Server/Utils/StatusPage/ScheduledMaintenanceReachBuilder";
import Hostname from "Common/Types/API/Hostname";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ScheduledMaintenanceSubscriberReach, {
  MaintenanceReminderReach,
  MaintenanceStatusPagesReason,
  MaintenanceSubscriberMoment,
  ScheduledMaintenanceSubscriberSettings,
} from "Common/Types/ScheduledMaintenance/ScheduledMaintenanceSubscriberReach";
import { PickedStatusPagesReachResult } from "Common/Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "Common/Types/StatusPage/PublicNoteReach";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import {
  SUBSCRIBER_NOTIFICATION_SUMMARIES,
  SUBSCRIBER_REMINDERS_SUMMARY,
} from "../../../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceForm";
import {
  MaintenanceReachRecord,
  getEventSubscriberNotificationsSummary,
  getMaintenanceReachQuestion,
  getMomentsSummary,
  readMaintenanceSubscriberSettings,
} from "../../../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceReach";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SCHEDULE MAINTENANCE EVENT SAYS WHAT THE JOBS DO (#9920).
 *
 * The form's Subscriber Notifications line, its review step and the notes
 * under its boxes say what the status pages picked and the event's own
 * settings will do: the pages' answer from the server
 * (PickedStatusPagesReachBuilder, as POST /scheduled-maintenance/reach
 * builds it), and each moment and reminder by the rule the form reads
 * (ScheduledMaintenanceSubscriberReach, through the form's own reading of
 * its values). This runs that answer beside the real jobs, for every mix of
 * settings: an event is created as the form would save it, and the clock
 * walks on through every moment, running every maintenance job at each
 * minute that matters - as the cron runs them every minute:
 *
 *   - ScheduledMaintenance:SendNotificationToSubscribers (told it is
 *     scheduled, when it is published);
 *   - ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled (each
 *     reminder before it starts);
 *   - ScheduledMaintenance:ChangeStateToOngoing and :ChangeStateToEnded,
 *     with the real state change they make
 *     (ScheduledMaintenanceService.changeScheduledMaintenanceState);
 *   - ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers (told
 *     it started, and ended);
 *
 * with the real notification service under them
 * (notififySubscribersOnEventScheduled), down to the mail it sends. Every
 * status page has one subscriber who takes email: a moment told someone
 * exactly when an email went out at its minute.
 *
 * For every mix, each moment and each reminder tells someone exactly when
 * the form's answer gives it no reason - and the line names exactly the
 * moments that told someone, and says they get reminders exactly when one
 * went out.
 *
 * The data layer is held in memory; nothing else is stood in for that
 * decides whether anyone is told.
 */

type CronHandler = () => Promise<void>;

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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/SendNotificationToSubscribers";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/SendSubscriberRemindersOnEventScheduled";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToOngoing";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToEnded";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers";

const JOBS: Array<string> = [
  "ScheduledMaintenance:SendNotificationToSubscribers",
  "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled",
  "ScheduledMaintenance:ChangeStateToOngoing",
  "ScheduledMaintenance:ChangeStateToEnded",
  "ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const EVENT_ID: string = "e0000000-0000-4000-8000-000000000001";

const PAGE_IDS: Array<string> = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000002",
];

// The project's states, in their order.
const SCHEDULED_STATE_ID: string = "a0000000-0000-4000-8000-000000000001";
const ONGOING_STATE_ID: string = "a0000000-0000-4000-8000-000000000002";
const ENDED_STATE_ID: string = "a0000000-0000-4000-8000-000000000003";
const COMPLETED_STATE_ID: string = "a0000000-0000-4000-8000-000000000004";

/*
 * The times, every one on its own minute, so whatever goes out at a minute
 * belongs to the one moment due then.
 */
const CREATED_AT: Date = new Date("2026-11-01T00:00:00.000Z");
const STARTS_AT: Date = new Date("2026-11-11T00:00:00.000Z");
const ENDS_AT: Date = new Date("2026-11-11T02:00:00.000Z");

const MINUTE: number = 60 * 1000;

enum Publish {
  RightAway = "right away",
  BeforeTheStart = "two days before it starts",
  AfterTheStart = "an hour after it starts (the form refuses it)",
  AlreadyPassed = "at a time already passed",
}

const PUBLISH_AT: Record<Publish, Date | null> = {
  [Publish.RightAway]: null,
  [Publish.BeforeTheStart]: new Date("2026-11-09T00:00:00.000Z"),
  [Publish.AfterTheStart]: new Date("2026-11-11T01:00:00.000Z"),
  [Publish.AlreadyPassed]: new Date("2026-10-25T00:00:00.000Z"),
};

function reminder(intervalType: EventInterval, count: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(count);
  return recurring;
}

/*
 * An hour before it starts (after a publish time two days before), three
 * days before (before it), and thirty days before (gone by when it is
 * saved).
 */
const REMINDERS: Array<Recurring> = [
  reminder(EventInterval.Hour, 1),
  reminder(EventInterval.Day, 3),
  reminder(EventInterval.Day, 30),
];

interface PageSettings {
  shows: boolean;
  sends: boolean;
}

interface PageMix {
  name: string;
  // The pages picked; empty: none.
  pages: Array<PageSettings>;
  // Left out of every send: archived, or a blocked project's.
  isLeftOut?: "archived" | "blocked";
}

const PAGE_MIXES: Array<PageMix> = [
  {
    name: "a page that shows maintenance events and notifies",
    pages: [{ shows: true, sends: true }],
  },
  {
    name: "a page that never notifies",
    pages: [{ shows: true, sends: false }],
  },
  {
    name: "a page that hides maintenance events",
    pages: [{ shows: false, sends: true }],
  },
  {
    name: "a page that hides them and never notifies",
    pages: [{ shows: false, sends: false }],
  },
  {
    name: "a page that hides them beside one that never notifies",
    pages: [
      { shows: false, sends: true },
      { shows: true, sends: false },
    ],
  },
  {
    name: "a page that hides them beside one that shows them and notifies",
    pages: [
      { shows: false, sends: true },
      { shows: true, sends: true },
    ],
  },
  {
    name: "an archived page",
    pages: [{ shows: true, sends: true }],
    isLeftOut: "archived",
  },
  {
    name: "a blocked project's page",
    pages: [{ shows: true, sends: true }],
    isLeftOut: "blocked",
  },
  { name: "no page picked", pages: [] },
];

interface Switches {
  name: string;
  scheduled: boolean;
  started: boolean;
  ended: boolean;
}

const SWITCHES: Array<Switches> = [
  { name: "every moment on", scheduled: true, started: true, ended: true },
  { name: "every moment off", scheduled: false, started: false, ended: false },
  {
    name: "only when it is scheduled",
    scheduled: true,
    started: false,
    ended: false,
  },
  {
    name: "when it starts and ends",
    scheduled: false,
    started: true,
    ended: true,
  },
];

interface Mix {
  name: string;
  pages: PageMix;
  isVisible: boolean;
  publish: Publish;
  switches: Switches;
  reminders: Array<Recurring>;
}

function mixes(): Array<Mix> {
  const all: Array<Mix> = [];

  for (const pages of PAGE_MIXES) {
    for (const publish of Object.values(Publish)) {
      for (const switches of SWITCHES) {
        all.push({
          name: `${pages.name}, published ${publish}, ${switches.name}`,
          pages: pages,
          isVisible: true,
          publish: publish,
          switches: switches,
          reminders: REMINDERS,
        });
      }
    }
  }

  // Hidden from its status pages: nobody is told, whatever else.
  for (const publish of Object.values(Publish)) {
    for (const switches of SWITCHES) {
      all.push({
        name: `hidden from its status pages, published ${publish}, ${switches.name}`,
        pages: PAGE_MIXES[0]!,
        isVisible: false,
        publish: publish,
        switches: switches,
        reminders: REMINDERS,
      });
    }
  }

  // No reminder at all: the line says nothing of reminders.
  all.push({
    name: "a page that notifies, no reminders",
    pages: PAGE_MIXES[0]!,
    isVisible: true,
    publish: Publish.RightAway,
    switches: SWITCHES[0]!,
    reminders: [],
  });

  return all;
}

// The in-memory data the jobs read and write.
let event: ScheduledMaintenance;
let pageRows: Array<StatusPage> = [];
let isProjectBlocked: boolean = false;
let timelines: Array<ScheduledMaintenanceStateTimeline> = [];
// Every email the jobs sent, with the minute it went out at.
let emailsSent: Array<number> = [];
// What the mixes told, moment by moment: "Started true", "reminder false".
const outcomesSeen: Set<string> = new Set<string>();

function state(
  id: string,
  name: string,
  order: number,
  flags: Partial<
    Pick<
      ScheduledMaintenanceState,
      "isScheduledState" | "isOngoingState" | "isEndedState" | "isResolvedState"
    >
  >,
): ScheduledMaintenanceState {
  const row: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  row._id = id;
  row.projectId = PROJECT_ID;
  row.name = name;
  row.order = order;
  row.isScheduledState = Boolean(flags.isScheduledState);
  row.isOngoingState = Boolean(flags.isOngoingState);
  row.isEndedState = Boolean(flags.isEndedState);
  row.isResolvedState = Boolean(flags.isResolvedState);
  return row;
}

const STATES: Array<ScheduledMaintenanceState> = [
  state(SCHEDULED_STATE_ID, "Scheduled", 1, { isScheduledState: true }),
  state(ONGOING_STATE_ID, "Ongoing", 2, { isOngoingState: true }),
  state(ENDED_STATE_ID, "Ended", 3, { isEndedState: true }),
  state(COMPLETED_STATE_ID, "Completed", 4, { isResolvedState: true }),
];

function stateById(id: unknown): ScheduledMaintenanceState | undefined {
  return STATES.find((each: ScheduledMaintenanceState): boolean => {
    return sameId(each._id, id);
  });
}

function sameId(a: unknown, b: unknown): boolean {
  return (
    String(a?.toString() || "").toLowerCase() ===
    String(b?.toString() || "").toLowerCase()
  );
}

// A time condition, as QueryHelper builds one (typeorm's Raw operator).
interface TimeCondition {
  getSql: (alias: string) => string;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

/*
 * Whether a row's time passes a condition, as Postgres would decide it:
 * "(x < :t)", or "(x <= :t or x IS NULL)".
 */
function passes(value: unknown, condition: unknown): boolean {
  const timeCondition: TimeCondition = condition as TimeCondition;
  const sql: string = timeCondition.getSql("x");
  const bound: Date = Object.values(
    timeCondition.objectLiteralParameters || {},
  )[0] as Date;
  const time: Date | null =
    value === null || value === undefined ? null : new Date(value as Date);

  if (/^\(x < :\w+\)$/.test(sql)) {
    return Boolean(time) && time!.getTime() < bound.getTime();
  }

  if (/^\(x <= :\w+ or x IS NULL\)$/.test(sql)) {
    return !time || time.getTime() <= bound.getTime();
  }

  throw new Error(`No stand-in for the time condition ${sql}`);
}

// Whether the event matches one of the jobs' queries.
function matches(query: JSONObject): boolean {
  for (const [column, condition] of Object.entries(query)) {
    const value: unknown = (event as unknown as Record<string, unknown>)[
      column
    ];

    if (condition && typeof condition === "object" && "getSql" in condition) {
      if (!passes(value, condition)) {
        return false;
      }

      continue;
    }

    if (column === "projectId" || column.endsWith("Id")) {
      if (!sameId(value, condition)) {
        return false;
      }

      continue;
    }

    if (value !== condition) {
      return false;
    }
  }

  return true;
}

function applyWrite(data: JSONObject): void {
  for (const [column, value] of Object.entries(data)) {
    (event as unknown as Record<string, unknown>)[column] = value;
  }
}

function pageRow(settings: PageSettings, index: number): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = PAGE_IDS[index]!;
  page.projectId = PROJECT_ID;
  page.name = `Site ${index + 1}`;
  page.showScheduledMaintenanceEventsOnStatusPage = settings.shows;
  page.sendSubscriberNotifications = settings.sends;
  return page;
}

function subscriberOf(statusPageId: ObjectID): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = new ObjectID(
    `c0000000-0000-4000-8000-${statusPageId.toString().slice(-12)}`,
  ).toString();
  subscriber.statusPageId = statusPageId;
  subscriber.subscriberEmail = new Email(
    `subscriber-${statusPageId.toString().slice(-2)}@example.com`,
  );
  subscriber.isSubscribedToAllResources = true;
  subscriber.isSubscribedToAllEventTypes = true;
  return subscriber;
}

let clock: Date = CREATED_AT;

function setClock(time: Date): void {
  clock = time;
  jest.setSystemTime(time);
}

function standIn(mix: Mix): void {
  // The pages picked, as every subscriber notification loads them.
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation((async (
      ids: Array<ObjectID>,
    ): Promise<Array<StatusPage>> => {
      if (mix.pages.isLeftOut) {
        return [];
      }

      return pageRows.filter((page: StatusPage): boolean => {
        return ids.some((id: ObjectID): boolean => {
          return sameId(id, page._id);
        });
      });
    }) as never);

  // The project's pages, for the form's answer.
  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (data: {
    query: JSONObject;
  }): Promise<Array<StatusPage>> => {
    void data;
    return pageRows;
  }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
    .mockImplementation((async (
      statusPageId: ObjectID,
    ): Promise<Array<StatusPageSubscriber>> => {
      return [subscriberOf(statusPageId)];
    }) as never);
  jest
    .spyOn(StatusPageSubscriberService, "shouldSendNotification")
    .mockReturnValue(true);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue("https://status.example.com");
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(null);
  jest.spyOn(StatusPageResourceService, "findByMonitors").mockResolvedValue([]);

  jest.spyOn(MailService, "sendMail").mockImplementation((async () => {
    emailsSent.push(clock.getTime());
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);

  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation((async (): Promise<boolean> => {
      return isProjectBlocked;
    }) as never);

  // The event, as each job reads and writes it.
  jest
    .spyOn(ScheduledMaintenanceService, "findAllBy")
    .mockImplementation((async (data: {
      query: JSONObject;
    }): Promise<Array<ScheduledMaintenance>> => {
      return matches(data.query) ? [event] : [];
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "findOneById")
    .mockImplementation((async (): Promise<ScheduledMaintenance> => {
      return event;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      applyWrite(data.data);
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateBy")
    .mockImplementation((async (data: { data: JSONObject }) => {
      applyWrite(data.data);
      return 1;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "getScheduledMaintenanceLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.com/maintenance"));
  jest
    .spyOn(ScheduledMaintenanceFeedService, "createScheduledMaintenanceFeedItem")
    .mockResolvedValue(undefined as never);

  // The project's states, and the events waiting for each move.
  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue(STATES);
  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getWaitingToStartEventQueriesOfEveryProject",
    )
    .mockResolvedValue([
      {
        projectId: PROJECT_ID,
        currentScheduledMaintenanceStateId: new ObjectID(SCHEDULED_STATE_ID),
      },
    ] as never);
  jest
    .spyOn(
      ScheduledMaintenanceStateService,
      "getInProgressEventQueriesOfEveryProject",
    )
    .mockResolvedValue([
      {
        projectId: PROJECT_ID,
        currentScheduledMaintenanceStateId: new ObjectID(ONGOING_STATE_ID),
      },
    ] as never);

  // The state timeline the moves write, and its notification job reads.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findOneBy")
    .mockImplementation((async (): Promise<ScheduledMaintenanceStateTimeline | null> => {
      return timelines[timelines.length - 1] || null;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "create")
    .mockImplementation((async (data: {
      data: ScheduledMaintenanceStateTimeline;
    }): Promise<ScheduledMaintenanceStateTimeline> => {
      const timeline: ScheduledMaintenanceStateTimeline = data.data;
      timeline._id = new ObjectID(
        `d0000000-0000-4000-8000-00000000000${timelines.length + 1}`,
      ).toString();
      timeline.scheduledMaintenanceState = stateById(
        timeline.scheduledMaintenanceStateId,
      )!;
      timelines.push(timeline);
      return timeline;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findAllBy")
    .mockImplementation((async (data: {
      query: JSONObject;
    }): Promise<Array<ScheduledMaintenanceStateTimeline>> => {
      return timelines.filter(
        (timeline: ScheduledMaintenanceStateTimeline): boolean => {
          return (
            timeline.subscriberNotificationStatus ===
              data.query["subscriberNotificationStatus"] &&
            timeline.shouldStatusPageSubscribersBeNotified ===
              data.query["shouldStatusPageSubscribersBeNotified"]
          );
        },
      );
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const timeline: ScheduledMaintenanceStateTimeline | undefined =
        timelines.find((each: ScheduledMaintenanceStateTimeline): boolean => {
          return sameId(each._id, data.id);
        });

      for (const [column, value] of Object.entries(data.data)) {
        (timeline as unknown as Record<string, unknown>)[column] = value;
      }
    }) as never);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(ProjectSmtpConfigService, "toEmailServer").mockReturnValue(undefined);
  jest
    .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
    .mockReturnValue(undefined);
  jest
    .spyOn(Markdown, "convertToHTML")
    .mockImplementation(async (markdown: string): Promise<string> => {
      return markdown;
    });
}

/*
 * The event the form saves, as the create stores it: the 'scheduled'
 * notification queued (or skipped) by its switch, and the first reminder
 * still to come (ScheduledMaintenanceService.getNextTimeToNotify, read at
 * the moment it is saved).
 */
function createEvent(mix: Mix): void {
  event = new ScheduledMaintenance();
  event._id = EVENT_ID;
  event.projectId = PROJECT_ID;
  event.title = "Database failover";
  event.description = "Failing over the primary.";
  event.scheduledMaintenanceNumber = 7;
  event.startsAt = STARTS_AT;
  event.endsAt = ENDS_AT;
  event.isVisibleOnStatusPage = mix.isVisible;
  event.publishOnStatusPageAt = PUBLISH_AT[mix.publish] || undefined;
  event.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
    mix.switches.scheduled;
  event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
    mix.switches.started;
  event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
    mix.switches.ended;
  event.sendSubscriberNotificationsOnBeforeTheEvent = mix.reminders;
  event.monitors = [];
  event.statusPages = pageRows.map((page: StatusPage): StatusPage => {
    const picked: StatusPage = new StatusPage();
    picked._id = page._id!;
    return picked;
  });
  event.currentScheduledMaintenanceStateId = new ObjectID(SCHEDULED_STATE_ID);
  event.subscriberNotificationStatusOnEventScheduled = mix.switches.scheduled
    ? StatusPageSubscriberNotificationStatus.Pending
    : StatusPageSubscriberNotificationStatus.Skipped;

  const nextReminderAt: Date | null =
    ScheduledMaintenanceService.getNextTimeToNotify({
      eventScheduledDate: STARTS_AT,
      sendSubscriberNotifiationsOn: mix.reminders,
    });

  event.nextSubscriberNotificationBeforeTheEventAt =
    nextReminderAt || undefined;
}

// What the form holds for the event it saves.
function formValues(mix: Mix): JSONObject {
  return {
    statusPages: pageRows.map((page: StatusPage): string => {
      return page._id!;
    }),
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    ...(PUBLISH_AT[mix.publish]
      ? { publishOnStatusPageAt: PUBLISH_AT[mix.publish] }
      : {}),
    // Create asks no Visible on Status Page: only a hidden mix holds it.
    ...(mix.isVisible ? {} : { isVisibleOnStatusPage: false }),
    shouldStatusPageSubscribersBeNotifiedOnEventCreated: mix.switches.scheduled,
    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
      mix.switches.started,
    shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
      mix.switches.ended,
    sendSubscriberNotificationsOnBeforeTheEvent: mix.reminders.map(
      (each: Recurring): JSONObject => {
        return each.toJSON();
      },
    ),
  } as JSONObject;
}

// The minute each moment's notification goes out at, if it does.
function scheduledMinute(mix: Mix): number {
  const publishAt: Date | null = PUBLISH_AT[mix.publish];

  return (
    (publishAt && publishAt.getTime() > CREATED_AT.getTime()
      ? publishAt.getTime()
      : CREATED_AT.getTime()) + MINUTE
  );
}

async function runEveryJob(): Promise<void> {
  for (const job of JOBS) {
    await mockCapturedJobs[job]!();
  }
}

beforeAll(() => {
  // Only the clock: everything that waits runs as it would.
  jest.useFakeTimers({
    doNotFake: [
      "performance",
      "hrtime",
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "queueMicrotask",
    ],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  timelines = [];
  emailsSent = [];
  isProjectBlocked = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("every job is registered", () => {
  for (const job of JOBS) {
    expect(`${job}: ${typeof mockCapturedJobs[job]}`).toBe(
      `${job}: function`,
    );
  }
});

describe("Schedule Maintenance Event's answer is what the maintenance jobs do", () => {
  test.each(mixes())("$name", async (mix: Mix) => {
    setClock(CREATED_AT);

    pageRows = mix.pages.pages.map(pageRow);
    isProjectBlocked = mix.pages.isLeftOut === "blocked";

    standIn(mix);
    createEvent(mix);

    // The form's answer, as it is drawn when the event is saved.
    const values: JSONObject = formValues(mix);
    const question: ReturnType<typeof getMaintenanceReachQuestion> =
      getMaintenanceReachQuestion({
        values: values,
        record: MaintenanceReachRecord.Event,
      });

    const reach: PickedStatusPagesReachResult | null = question
      ? await PickedStatusPagesReachBuilder.build({
          projectId: PROJECT_ID,
          props: { isRoot: true },
          request: {
            statusPageIds: question.statusPageIds.map(
              (id: string): ObjectID => {
                return new ObjectID(id);
              },
            ),
            recordId: null,
          },
          kind: SCHEDULED_MAINTENANCE_RECORD,
        })
      : null;

    const statusPagesReason: MaintenanceStatusPagesReason = question
      ? reach!.nothingSentReason
      : PublicNoteNothingSentReason.NoStatusPages;

    const settings: ScheduledMaintenanceSubscriberSettings =
      readMaintenanceSubscriberSettings(values, MaintenanceReachRecord.Event);

    const momentTold: (moment: MaintenanceSubscriberMoment) => boolean = (
      moment: MaintenanceSubscriberMoment,
    ): boolean => {
      return (
        ScheduledMaintenanceSubscriberReach.getMomentReason({
          moment: moment,
          settings: settings,
          statusPagesReason: statusPagesReason,
        }) === null
      );
    };

    const reminders: Array<MaintenanceReminderReach> =
      ScheduledMaintenanceSubscriberReach.getReminders({
        settings: settings,
        statusPagesReason: statusPagesReason,
        now: CREATED_AT,
      });

    const line: Array<string> = getEventSubscriberNotificationsSummary(
      values,
      reach,
      CREATED_AT,
    );

    // The minute each thing the form speaks of is due at, and whether it says someone is told.
    const expected: Map<number, boolean> = new Map<number, boolean>();

    const expectAt: (minute: number, isTold: boolean) => void = (
      minute: number,
      isTold: boolean,
    ): void => {
      expected.set(minute, Boolean(expected.get(minute)) || isTold);
    };

    expectAt(
      scheduledMinute(mix),
      momentTold(MaintenanceSubscriberMoment.Scheduled),
    );
    expectAt(
      STARTS_AT.getTime() + MINUTE,
      momentTold(MaintenanceSubscriberMoment.Started),
    );
    expectAt(
      ENDS_AT.getTime() + MINUTE,
      momentTold(MaintenanceSubscriberMoment.Ended),
    );

    for (const each of reminders) {
      if (each.remindAt && each.remindAt.getTime() > CREATED_AT.getTime()) {
        expectAt(each.remindAt.getTime() + MINUTE, each.nothingSentReason === null);
      } else {
        // Gone by when it is saved: never sent.
        expect(each.nothingSentReason).not.toBeNull();
      }
    }

    // Every minute that matters, in order, every job at each.
    const minutes: Array<number> = Array.from(
      new Set<number>([
        ...expected.keys(),
        ...Object.values(PUBLISH_AT)
          .filter((time: Date | null): time is Date => {
            return Boolean(time) && time!.getTime() > CREATED_AT.getTime();
          })
          .map((time: Date): number => {
            return time.getTime() + MINUTE;
          }),
      ]),
    ).sort((a: number, b: number): number => {
      return a - b;
    });

    const told: Map<number, number> = new Map<number, number>();

    for (const minute of minutes) {
      setClock(new Date(minute));

      const before: number = emailsSent.length;
      await runEveryJob();
      told.set(minute, emailsSent.length - before);
    }

    for (const minute of minutes) {
      const isTold: boolean = (told.get(minute) || 0) > 0;
      const shouldBe: boolean = Boolean(expected.get(minute));

      expect(`${new Date(minute).toISOString()}: told ${isTold}`).toBe(
        `${new Date(minute).toISOString()}: told ${shouldBe}`,
      );
    }

    // The line names exactly the moments that told someone.
    const momentsTold: Array<MaintenanceSubscriberMoment> = [
      MaintenanceSubscriberMoment.Scheduled,
      MaintenanceSubscriberMoment.Started,
      MaintenanceSubscriberMoment.Ended,
    ].filter((moment: MaintenanceSubscriberMoment): boolean => {
      const minute: number =
        moment === MaintenanceSubscriberMoment.Scheduled
          ? scheduledMinute(mix)
          : moment === MaintenanceSubscriberMoment.Started
            ? STARTS_AT.getTime() + MINUTE
            : ENDS_AT.getTime() + MINUTE;

      return (told.get(minute) || 0) > 0;
    });

    const remindersTold: boolean = reminders.some(
      (each: MaintenanceReminderReach): boolean => {
        return Boolean(
          each.remindAt && (told.get(each.remindAt.getTime() + MINUTE) || 0) > 0,
        );
      },
    );

    const positiveMoments: Array<string> = Object.entries(
      SUBSCRIBER_NOTIFICATION_SUMMARIES,
    )
      .filter((entry: [string, string]): boolean => {
        return entry[0] !== "";
      })
      .map((entry: [string, string]): string => {
        return entry[1];
      });

    for (const moment of [
      MaintenanceSubscriberMoment.Scheduled,
      MaintenanceSubscriberMoment.Started,
      MaintenanceSubscriberMoment.Ended,
    ]) {
      outcomesSeen.add(`${moment} ${momentsTold.includes(moment)}`);
    }

    outcomesSeen.add(`reminder ${remindersTold}`);

    if (momentsTold.length > 0) {
      expect(line).toContain(getMomentsSummary(momentsTold));
    } else {
      // Nobody told at any moment: the line names none.
      for (const sentence of positiveMoments) {
        expect(line).not.toContain(sentence);
      }
    }

    expect(line.includes(SUBSCRIBER_REMINDERS_SUMMARY)).toBe(remindersTold);
  });

  /*
   * The mixes are no empty agreement: each moment, and a reminder, tells
   * someone in some of them and nobody in others.
   */
  test("tell someone at every moment in some mixes, and nobody in others", () => {
    expect(Array.from(outcomesSeen).sort()).toEqual([
      "Ended false",
      "Ended true",
      "Scheduled false",
      "Scheduled true",
      "Started false",
      "Started true",
      "reminder false",
      "reminder true",
    ]);
  });
});
