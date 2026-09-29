import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "Common/Types/ObjectID";

/*
 * The reminder job — the "your maintenance window starts soon" mail — hands
 * its events to the same `notififySubscribersOnEventScheduled` the creation
 * job does, and that service fills `{{scheduledEndTime}}` from `event.endsAt`.
 *
 * Like its sibling, this job selected `startsAt` but not `endsAt`, so the end
 * time reached the template renderer as undefined and came out as an empty
 * string. (GitHub issue #3545.)
 *
 * The fake `findAllBy` below projects each row through the select the job
 * actually asked for, exactly as the database does, so an unselected column
 * arrives undefined here for the same reason it did in production.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler and each test drives one full
 * tick.
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
      getNextTimeToNotify: jest.fn(),
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

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import URL from "Common/Types/API/URL";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/SendSubscriberRemindersOnEventScheduled";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string =
  "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const STARTS_AT: Date = new Date("2024-03-04T06:08:00.000Z");
const ENDS_AT: Date = new Date("2024-03-04T08:00:00.000Z");

// A full database row — every column the table has that this job could ask for.
function storedEvent(overrides?: {
  id?: string;
  endsAt?: Date | undefined;
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
  event.sendSubscriberNotificationsOnBeforeTheEvent = [];
  event.nextSubscriberNotificationBeforeTheEventAt = new Date(
    "2024-03-04T05:08:00.000Z",
  );
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

function findAllBySelect(): Record<string, unknown> {
  const args: { select: Record<string, unknown> } = (
    ScheduledMaintenanceService.findAllBy as unknown as jest.Mock
  ).mock.calls[0]![0] as { select: Record<string, unknown> };

  return args.select;
}

function notifiedEvents(): Array<ScheduledMaintenance> {
  const calls: Array<Array<unknown>> = (
    ScheduledMaintenanceService.notififySubscribersOnEventScheduled as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return (calls[0]?.[0] as Array<ScheduledMaintenance>) || [];
}

describe("ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    storedEvents = [storedEvent()];

    (
      ScheduledMaintenanceService.findAllBy as unknown as jest.Mock
    ).mockImplementation(
      async (args: unknown): Promise<Array<ScheduledMaintenance>> => {
        const select: Record<string, unknown> = (
          args as { select: Record<string, unknown> }
        ).select;

        return storedEvents.map((row: ScheduledMaintenance) => {
          return project(row, select);
        });
      },
    );

    (
      ScheduledMaintenanceService.updateOneById as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);

    (
      ScheduledMaintenanceService.getNextTimeToNotify as unknown as jest.Mock
    ).mockReturnValue(null);

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

  test("still reschedules the next reminder off the start time", async () => {
    /*
     * The reminder cadence is driven by `startsAt`, not `endsAt`; widening the
     * select must not disturb it.
     */
    const nextAt: Date = new Date("2024-03-04T05:38:00.000Z");

    (
      ScheduledMaintenanceService.getNextTimeToNotify as unknown as jest.Mock
    ).mockReturnValue(nextAt);

    await mockCapturedJobs[JOB_NAME]!();

    const nextTimeArgs: { eventScheduledDate: Date } = (
      ScheduledMaintenanceService.getNextTimeToNotify as unknown as jest.Mock
    ).mock.calls[0]![0] as { eventScheduledDate: Date };

    expect(nextTimeArgs.eventScheduledDate).toEqual(STARTS_AT);

    const updateArgs: {
      data: { nextSubscriberNotificationBeforeTheEventAt?: Date };
    } = (ScheduledMaintenanceService.updateOneById as unknown as jest.Mock).mock
      .calls[0]![0] as {
      data: { nextSubscriberNotificationBeforeTheEventAt?: Date };
    };

    expect(updateArgs.data.nextSubscriberNotificationBeforeTheEventAt).toEqual(
      nextAt,
    );
  });
});
