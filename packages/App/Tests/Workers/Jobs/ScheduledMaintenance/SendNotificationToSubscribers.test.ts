import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE } from "Common/Types/StatusPage/StatusPageProjectBlock";

/*
 * Subscriber notifications for a newly created scheduled maintenance are
 * rendered from the event models this job hands to
 * `notififySubscribersOnEventScheduled`. That service reads `event.endsAt`
 * straight off them to fill `{{scheduledEndTime}}`.
 *
 * This job's select listed `startsAt` but not `endsAt`, so every event arrived
 * with `endsAt` undefined and the service's `event.endsAt ? ... : ""` branch
 * silently rendered an empty string. `{{scheduledStartTime}}` worked, which is
 * exactly why the hole went unnoticed for so long: the mail looked correct
 * apart from a blank end time. (GitHub issue #3545.)
 *
 * `endsAt` is never read inside this job's own body, so no assertion about
 * what the job DOES can catch its absence. The fake below therefore behaves
 * like the database it stands in for: it projects each row through the select
 * the job actually asked for, so an unselected column arrives undefined here
 * for the same reason it does in production. That is what makes the
 * pass-through tests real regression tests rather than restatements of the
 * fixture.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler — the same recorder the other
 * App/Tests/Workers/Jobs suites use — and each test drives one full tick.
 *
 * Each tick first marks Skipped the events whose 'scheduled' message is queued
 * while notifying subscribers is off, as the incident and announcement jobs
 * do: an update that turns the flag off no longer writes the status itself
 * (an update that merely re-sent the flag used to queue the message again),
 * so the job is where a queued message meets the flag.
 *
 * An event kept to the team until its publish time (Publish on Status Page
 * At, #5249) tells its subscribers it is scheduled when it is published:
 * once, at that time, whatever was edited before it.
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
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
      notififySubscribersOnEventScheduled: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return {
    __esModule: true,
    default: { createScheduledMaintenanceFeedItem: jest.fn() },
  };
});

// Whether the event's project is blocked (BlockedProjectStatusPages).
jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { isProjectBlocked: jest.fn() } };
});

import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/SendNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const JOB_NAME: string = "ScheduledMaintenance:SendNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const STARTS_AT: Date = new Date("2024-03-04T06:08:00.000Z");
const ENDS_AT: Date = new Date("2024-03-04T08:00:00.000Z");

// A full database row — every column the table has that this job could ask for.
function storedEvent(overrides?: {
  id?: string;
  endsAt?: Date | undefined;
  isVisibleOnStatusPage?: boolean;
  shouldNotify?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();

  event._id = overrides?.id || "22222222-2222-4222-8222-222222222222";
  event.projectId = PROJECT_ID;
  event.title = "Quarterly database failover drill";
  event.description = "Failing over the primary.";
  event.startsAt = STARTS_AT;
  event.endsAt =
    overrides && "endsAt" in overrides
      ? (overrides.endsAt as Date)
      : new Date(ENDS_AT);
  event.isVisibleOnStatusPage = overrides?.isVisibleOnStatusPage !== false;
  event.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
    overrides?.shouldNotify !== false;
  event.subscriberNotificationStatusOnEventScheduled =
    StatusPageSubscriberNotificationStatus.Pending;
  event.scheduledMaintenanceNumber = 7;
  event.scheduledMaintenanceNumberWithPrefix = "SM-7";

  return event;
}

/*
 * Stands in for the database's column projection: a column the caller did not
 * select is simply not on the model that comes back.
 */
function project(
  row: ScheduledMaintenance,
  select: Record<string, unknown>,
): ScheduledMaintenance {
  const projected: ScheduledMaintenance = new ScheduledMaintenance();
  const source: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  const target: Record<string, unknown> = projected as unknown as Record<
    string,
    unknown
  >;

  for (const [column, isSelected] of Object.entries(select)) {
    if (!isSelected) {
      continue;
    }

    target[column] = source[column];
  }

  return projected;
}

let storedEvents: Array<ScheduledMaintenance> = [];

// A time condition, as QueryHelper builds one (typeorm's FindOperator).
interface TimeCondition {
  getSql: (alias: string) => string;
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

// Up to a time, or no time at all: published by then.
const UP_TO_OR_NONE_SQL: RegExp = /^\(x <= :\w+ or x IS NULL\)$/;

/*
 * Whether a row's publish time passes the query's condition on it, as
 * Postgres would decide it: none, or one not after the time asked about.
 */
function isPublishedBy(row: ScheduledMaintenance, condition: unknown): boolean {
  if (condition === undefined) {
    return true;
  }

  const timeCondition: TimeCondition = condition as TimeCondition;
  const sql: string = timeCondition.getSql("x");

  if (!UP_TO_OR_NONE_SQL.test(sql)) {
    throw new Error(`No stand-in for the publish time condition ${sql}`);
  }

  const asOf: Date = Object.values(
    timeCondition.objectLiteralParameters || {},
  )[0] as Date;

  return (
    !row.publishOnStatusPageAt ||
    new Date(row.publishOnStatusPageAt).getTime() <= asOf.getTime()
  );
}

/*
 * The rows a query matches, on the columns the job queries by, as the
 * database would answer it.
 */
function matches(
  row: ScheduledMaintenance,
  query: Record<string, unknown>,
): boolean {
  for (const column of [
    "subscriberNotificationStatusOnEventScheduled",
    "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
  ]) {
    if (
      query[column] !== undefined &&
      (row as unknown as Record<string, unknown>)[column] !== query[column]
    ) {
      return false;
    }
  }

  return isPublishedBy(row, query["publishOnStatusPageAt"]);
}

type FindAllByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

function findAllByCalls(): Array<FindAllByArgs> {
  return (
    ScheduledMaintenanceService.findAllBy as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>): FindAllByArgs => {
    return call[0] as FindAllByArgs;
  });
}

// The query for the events to notify, the one whose select feeds the service.
function findAllBySelect(): Record<string, unknown> {
  const args: FindAllByArgs | undefined = findAllByCalls().find(
    (call: FindAllByArgs): boolean => {
      return (
        call.query["shouldStatusPageSubscribersBeNotifiedOnEventCreated"] ===
        true
      );
    },
  );

  return args!.select;
}

// The statuses the job wrote, by event id.
function writtenStatuses(): Array<{ id: string; status: unknown }> {
  return (
    ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>) => {
    const args: {
      id: ObjectID;
      data: { subscriberNotificationStatusOnEventScheduled?: unknown };
    } = call[0] as {
      id: ObjectID;
      data: { subscriberNotificationStatusOnEventScheduled?: unknown };
    };

    return {
      id: args.id.toString(),
      status: args.data.subscriberNotificationStatusOnEventScheduled,
    };
  });
}

function notifiedEvents(): Array<ScheduledMaintenance> {
  const calls: Array<Array<unknown>> = (
    ScheduledMaintenanceService.notififySubscribersOnEventScheduled as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return (calls[0]?.[0] as Array<ScheduledMaintenance>) || [];
}

describe("ScheduledMaintenance:SendNotificationToSubscribers", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    storedEvents = [storedEvent()];

    (
      ScheduledMaintenanceService.findAllBy as unknown as jest.Mock
    ).mockImplementation(
      async (args: unknown): Promise<Array<ScheduledMaintenance>> => {
        const { query, select } = args as FindAllByArgs;

        return storedEvents
          .filter((row: ScheduledMaintenance) => {
            return matches(row, query);
          })
          .map((row: ScheduledMaintenance) => {
            return project(row, select);
          });
      },
    );

    (
      ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);

    (
      ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard as unknown as jest.Mock
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.com/dashboard/sm-1") as never,
    );

    (
      ScheduledMaintenanceService.notififySubscribersOnEventScheduled as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);

    (
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);

    (ProjectService.isProjectBlocked as unknown as jest.Mock).mockResolvedValue(
      false as never,
    );
  });

  test("selects endsAt so {{scheduledEndTime}} has a value to render", async () => {
    await mockCapturedJobs[JOB_NAME]!();

    expect(findAllBySelect()["endsAt"]).toBe(true);
    expect(findAllBySelect()["startsAt"]).toBe(true);
  });

  test("hands the end time through to the notification service", async () => {
    await mockCapturedJobs[JOB_NAME]!();

    const events: Array<ScheduledMaintenance> = notifiedEvents();

    expect(events).toHaveLength(1);
    expect(events[0]!.endsAt).toEqual(ENDS_AT);
    expect(events[0]!.startsAt).toEqual(STARTS_AT);
  });

  test("keeps an absent end time absent rather than inventing one", async () => {
    /*
     * An event with no end time is legitimate — the service renders
     * `{{scheduledEndTime}}` as an empty string for it. The fix must not
     * paper over that case with a fabricated date.
     */
    storedEvents = [storedEvent({ endsAt: undefined })];

    await mockCapturedJobs[JOB_NAME]!();

    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]!.endsAt).toBeUndefined();
  });

  test("carries the end time on every event of a multi-event tick", async () => {
    const second: ScheduledMaintenance = storedEvent({
      id: "44444444-4444-4444-8444-444444444444",
    });
    second.endsAt = new Date("2024-03-05T09:30:00.000Z");

    storedEvents = [
      storedEvent({ id: "33333333-3333-4333-8333-333333333333" }),
      second,
    ];

    await mockCapturedJobs[JOB_NAME]!();

    expect(
      notifiedEvents().map((event: ScheduledMaintenance) => {
        return event.endsAt;
      }),
    ).toEqual([ENDS_AT, new Date("2024-03-05T09:30:00.000Z")]);
  });

  test("still excludes events hidden from the status page", async () => {
    /*
     * Guards the filter the end-time fix sits next to: a hidden event is
     * marked Skipped and never reaches the notification service.
     */
    storedEvents = [storedEvent({ isVisibleOnStatusPage: false })];

    await mockCapturedJobs[JOB_NAME]!();

    expect(
      ScheduledMaintenanceService.notififySubscribersOnEventScheduled,
    ).not.toHaveBeenCalled();

    const skipped: boolean = (
      ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
    ).mock.calls.some((call: Array<unknown>) => {
      const args: {
        data: { subscriberNotificationStatusOnEventScheduled?: string };
      } = call[0] as {
        data: { subscriberNotificationStatusOnEventScheduled?: string };
      };

      return (
        args.data.subscriberNotificationStatusOnEventScheduled ===
        StatusPageSubscriberNotificationStatus.Skipped
      );
    });

    expect(skipped).toBe(true);
  });

  describe("a queued message whose event no longer notifies subscribers", () => {
    const QUIET_ID: string = "55555555-5555-4555-8555-555555555555";
    const NOTIFYING_ID: string = "66666666-6666-4666-8666-666666666666";

    test("is marked Skipped, with the same reason the event's create gives, and never sent", async () => {
      storedEvents = [storedEvent({ id: QUIET_ID, shouldNotify: false })];

      await mockCapturedJobs[JOB_NAME]!();

      const updates: Array<Array<unknown>> = (
        ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;

      expect(updates).toHaveLength(1);
      expect(updates[0]![0]).toEqual({
        id: new ObjectID(QUIET_ID),
        data: {
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            "Notifications skipped as subscribers are not to be notified for this scheduled maintenance.",
        },
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(
        ScheduledMaintenanceService.notififySubscribersOnEventScheduled,
      ).not.toHaveBeenCalled();
      expect(
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
      ).not.toHaveBeenCalled();
    });

    test("is looked up by the queued status and the flag being off, reading the id alone", async () => {
      storedEvents = [storedEvent({ id: QUIET_ID, shouldNotify: false })];

      await mockCapturedJobs[JOB_NAME]!();

      const skipQuery: FindAllByArgs | undefined = findAllByCalls().find(
        (call: FindAllByArgs): boolean => {
          return (
            call.query[
              "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
            ] === false
          );
        },
      );

      expect(skipQuery!.query).toEqual({
        subscriberNotificationStatusOnEventScheduled:
          StatusPageSubscriberNotificationStatus.Pending,
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
      });
      expect(skipQuery!.select).toEqual({ _id: true });
    });

    test("does not hold up the events that do notify in the same tick", async () => {
      storedEvents = [
        storedEvent({ id: QUIET_ID, shouldNotify: false }),
        storedEvent({ id: NOTIFYING_ID }),
      ];

      await mockCapturedJobs[JOB_NAME]!();

      expect(writtenStatuses()).toEqual([
        {
          id: QUIET_ID,
          status: StatusPageSubscriberNotificationStatus.Skipped,
        },
        {
          id: NOTIFYING_ID,
          status: StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          id: NOTIFYING_ID,
          status: StatusPageSubscriberNotificationStatus.Success,
        },
      ]);

      expect(
        notifiedEvents().map((event: ScheduledMaintenance) => {
          return event.id?.toString();
        }),
      ).toEqual([NOTIFYING_ID]);
    });

    test("a failure to mark one Skipped does not stop the tick", async () => {
      storedEvents = [
        storedEvent({ id: QUIET_ID, shouldNotify: false }),
        storedEvent({ id: NOTIFYING_ID }),
      ];

      (
        ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
      ).mockImplementationOnce(async () => {
        throw new Error("database went away");
      });

      await mockCapturedJobs[JOB_NAME]!();

      expect(
        notifiedEvents().map((event: ScheduledMaintenance) => {
          return event.id?.toString();
        }),
      ).toEqual([NOTIFYING_ID]);
    });

    test("an event that notifies is never marked Skipped by that step", async () => {
      storedEvents = [storedEvent({ id: NOTIFYING_ID })];

      await mockCapturedJobs[JOB_NAME]!();

      expect(
        writtenStatuses().some((written: { id: string; status: unknown }) => {
          return (
            written.status === StatusPageSubscriberNotificationStatus.Skipped
          );
        }),
      ).toBe(false);
      expect(notifiedEvents()).toHaveLength(1);
    });
  });

  /*
   * A blocked project's status pages send nothing: the one lookup every
   * subscriber notification reads (getStatusPagesToSendNotification) leaves
   * them out. The event says why, rather than that it was sent to every
   * subscriber, and is not handed on to be sent.
   */
  describe("an event of a blocked project", () => {
    const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
      "b10c0000-0000-4000-8000-0000000000b1",
    );
    const BLOCKED_EVENT_ID: string = "77777777-7777-4777-8777-777777777777";
    const LIVE_EVENT_ID: string = "88888888-8888-4888-8888-888888888888";

    function blockedEvent(): ScheduledMaintenance {
      const event: ScheduledMaintenance = storedEvent({
        id: BLOCKED_EVENT_ID,
      });
      event.projectId = BLOCKED_PROJECT_ID;
      return event;
    }

    beforeEach(() => {
      (
        ProjectService.isProjectBlocked as unknown as jest.Mock
      ).mockImplementation(async (projectId: unknown): Promise<boolean> => {
        return (
          (projectId as ObjectID).toString() === BLOCKED_PROJECT_ID.toString()
        );
      });
    });

    test("is marked Skipped with the reason, with no 'sent' feed item, and is not sent", async () => {
      storedEvents = [blockedEvent()];

      await mockCapturedJobs[JOB_NAME]!();

      expect(writtenStatuses()).toEqual([
        {
          id: BLOCKED_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          id: BLOCKED_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.Skipped,
        },
      ]);

      const updates: Array<Array<unknown>> = (
        ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;

      expect(updates[1]![0]).toEqual({
        id: new ObjectID(BLOCKED_EVENT_ID),
        data: {
          subscriberNotificationStatusOnEventScheduled:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessage:
            STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE,
        },
        props: { isRoot: true, ignoreHooks: true },
      });
      expect(
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
      ).not.toHaveBeenCalled();
      expect(
        ScheduledMaintenanceService.notififySubscribersOnEventScheduled,
      ).not.toHaveBeenCalled();
    });

    test("does not hold up a live project's event in the same tick", async () => {
      storedEvents = [blockedEvent(), storedEvent({ id: LIVE_EVENT_ID })];

      await mockCapturedJobs[JOB_NAME]!();

      expect(writtenStatuses()).toEqual([
        {
          id: BLOCKED_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          id: BLOCKED_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.Skipped,
        },
        {
          id: LIVE_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          id: LIVE_EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.Success,
        },
      ]);
      expect(
        notifiedEvents().map((event: ScheduledMaintenance) => {
          return event.id?.toString();
        }),
      ).toEqual([LIVE_EVENT_ID]);
    });
  });
  /*
   * An event kept to the team until its publish time (#5249). The job runs
   * every minute; each test moves its clock and runs it again, and the
   * statuses it writes land on the stored row, as the database keeps them -
   * so "sent once" is what several runs leave behind.
   */
  describe("an event kept to the team until its publish time", () => {
    const EVENT_ID: string = "99999999-9999-4999-8999-999999999999";
    const CREATED_ON: Date = new Date("2026-10-01T08:00:00.000Z");
    const PUBLISH_AT: Date = new Date("2026-11-24T09:00:00.000Z");
    const MINUTE: number = 60 * 1000;

    let now: Date = CREATED_ON;

    function plannedEvent(): ScheduledMaintenance {
      const event: ScheduledMaintenance = storedEvent({ id: EVENT_ID });
      event.publishOnStatusPageAt = PUBLISH_AT;
      return event;
    }

    function storedRow(): ScheduledMaintenance {
      return storedEvents.find((row: ScheduledMaintenance): boolean => {
        return row._id === EVENT_ID;
      })!;
    }

    async function runAt(time: Date): Promise<void> {
      now = time;
      await mockCapturedJobs[JOB_NAME]!();
    }

    // How many times subscribers were told, over every run so far.
    function timesSent(): number {
      return (
        ScheduledMaintenanceService.notififySubscribersOnEventScheduled as unknown as jest.Mock
      ).mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as Array<ScheduledMaintenance>).some(
          (event: ScheduledMaintenance): boolean => {
            return event.id?.toString() === EVENT_ID;
          },
        );
      }).length;
    }

    beforeEach(() => {
      now = CREATED_ON;
      storedEvents = [plannedEvent()];

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now);
      });

      (
        ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
      ).mockImplementation(async (args: unknown): Promise<void> => {
        const { id, data } = args as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
        const row: ScheduledMaintenance | undefined = storedEvents.find(
          (candidate: ScheduledMaintenance): boolean => {
            return candidate._id === id.toString();
          },
        );

        if (row) {
          Object.assign(row, data);
        }
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("waits while its publish time is still to come: nothing written, nothing sent, still queued", async () => {
      await runAt(CREATED_ON);
      await runAt(new Date(PUBLISH_AT.getTime() - MINUTE));
      await runAt(new Date(PUBLISH_AT.getTime() - 1));

      expect(ScheduledMaintenanceService.updateOneById).not.toHaveBeenCalled();
      expect(timesSent()).toBe(0);
      expect(
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
      ).not.toHaveBeenCalled();
      expect(storedRow().subscriberNotificationStatusOnEventScheduled).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
    });

    test("is sent at its publish time, and only once however often the job runs after", async () => {
      await runAt(CREATED_ON);
      await runAt(PUBLISH_AT);
      await runAt(new Date(PUBLISH_AT.getTime() + MINUTE));
      await runAt(new Date(PUBLISH_AT.getTime() + 60 * MINUTE));

      expect(timesSent()).toBe(1);
      expect(writtenStatuses()).toEqual([
        {
          id: EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.InProgress,
        },
        {
          id: EVENT_ID,
          status: StatusPageSubscriberNotificationStatus.Success,
        },
      ]);
      expect(storedRow().subscriberNotificationStatusOnEventScheduled).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
    });

    test("the job asks for the events published by the time it runs", async () => {
      await runAt(PUBLISH_AT);

      const sendQuery: FindAllByArgs | undefined = findAllByCalls().find(
        (call: FindAllByArgs): boolean => {
          return (
            call.query[
              "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
            ] === true
          );
        },
      );
      const condition: TimeCondition = sendQuery!.query[
        "publishOnStatusPageAt"
      ] as TimeCondition;

      expect(UP_TO_OR_NONE_SQL.test(condition.getSql("x"))).toBe(true);
      expect(Object.values(condition.objectLiteralParameters || {})).toEqual([
        PUBLISH_AT,
      ]);
      // It reads both columns the rule decides by.
      expect(sendQuery!.select["isVisibleOnStatusPage"]).toBe(true);
      expect(sendQuery!.select["publishOnStatusPageAt"]).toBe(true);
    });

    test("a publish time moved later waits for the new time, then is sent once", async () => {
      const MOVED_TO: Date = new Date(PUBLISH_AT.getTime() + 24 * 60 * MINUTE);

      await runAt(new Date(PUBLISH_AT.getTime() - 60 * MINUTE));
      storedRow().publishOnStatusPageAt = MOVED_TO;

      await runAt(PUBLISH_AT);
      await runAt(new Date(MOVED_TO.getTime() - MINUTE));
      expect(timesSent()).toBe(0);

      await runAt(MOVED_TO);
      await runAt(new Date(MOVED_TO.getTime() + MINUTE));
      expect(timesSent()).toBe(1);
    });

    test("a publish time moved earlier is sent at the earlier time", async () => {
      const MOVED_TO: Date = new Date(PUBLISH_AT.getTime() - 7 * 24 * 60 * MINUTE);

      await runAt(CREATED_ON);
      storedRow().publishOnStatusPageAt = MOVED_TO;

      await runAt(MOVED_TO);
      await runAt(PUBLISH_AT);

      expect(timesSent()).toBe(1);
    });

    test("a publish time cleared - published right away - is sent on the next run", async () => {
      await runAt(CREATED_ON);
      expect(timesSent()).toBe(0);

      storedRow().publishOnStatusPageAt = null as unknown as Date;

      await runAt(new Date(CREATED_ON.getTime() + MINUTE));
      await runAt(PUBLISH_AT);

      expect(timesSent()).toBe(1);
    });

    test("hidden from status pages before its time: skipped at its time, never sent", async () => {
      await runAt(CREATED_ON);
      storedRow().isVisibleOnStatusPage = false;

      await runAt(PUBLISH_AT);
      await runAt(new Date(PUBLISH_AT.getTime() + MINUTE));

      expect(timesSent()).toBe(0);
      expect(storedRow().subscriberNotificationStatusOnEventScheduled).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
      expect(storedRow().subscriberNotificationStatusMessage).toBe(
        "Notifications skipped as scheduled maintenance is not visible on status page.",
      );
    });

    test("subscribers to be told nothing: skipped at once, and still never sent at its time", async () => {
      storedRow().shouldStatusPageSubscribersBeNotifiedOnEventCreated = false;

      await runAt(CREATED_ON);
      expect(storedRow().subscriberNotificationStatusOnEventScheduled).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );

      await runAt(PUBLISH_AT);
      expect(timesSent()).toBe(0);
    });

    test("the feed says it went out because the event was published on its status pages", async () => {
      await runAt(PUBLISH_AT);

      const feedItem: { feedInfoInMarkdown: string } = (
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem as unknown as jest.Mock
      ).mock.calls[0]![0] as { feedInfoInMarkdown: string };

      expect(feedItem.feedInfoInMarkdown).toContain(
        "because this scheduled maintenance was published on its status pages.",
      );
      expect(feedItem.feedInfoInMarkdown).not.toContain("was created.");
    });

    test("an event published from the start still says it went out because it was created", async () => {
      storedRow().publishOnStatusPageAt = null as unknown as Date;

      await runAt(CREATED_ON);

      const feedItem: { feedInfoInMarkdown: string } = (
        ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem as unknown as jest.Mock
      ).mock.calls[0]![0] as { feedInfoInMarkdown: string };

      expect(feedItem.feedInfoInMarkdown).toContain(
        "because this scheduled maintenance was created.",
      );
    });

    test("one event waiting does not hold up another published in the same run", async () => {
      const PUBLISHED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

      storedEvents = [plannedEvent(), storedEvent({ id: PUBLISHED_ID })];

      await runAt(CREATED_ON);

      expect(
        notifiedEvents().map((event: ScheduledMaintenance) => {
          return event.id?.toString();
        }),
      ).toEqual([PUBLISHED_ID]);
      expect(storedRow().subscriberNotificationStatusOnEventScheduled).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
    });
  });
});
