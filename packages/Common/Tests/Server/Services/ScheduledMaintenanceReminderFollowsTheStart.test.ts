import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN EVENT'S REMINDERS FOLLOW ITS START WHEN THEY ARE COUNTED FROM IT.
 *
 * A reminder rule set not to remind while an event is still scheduled
 * (remindWhileScheduled off) counts the event's first reminder from its
 * start: nextReminderNotificationAt is the start plus the interval. Moving
 * the start refreshed nothing, so an event moved earlier reminded its
 * owners late - at the old start plus the interval. Now a start that really
 * moved asks refreshReminderSchedule to follow it (startMovedFrom), and it
 * does only where the schedule is counted from the start: anywhere else the
 * interval running now is left as it is, since every refresh starts it
 * over. An unrelated edit asks for nothing at all
 * (ScheduledMaintenanceUpdatedFeedRealChanges).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000e1",
);

const NOW: Date = new Date("2026-11-02T08:00:00.000Z");
const INTERVAL_IN_MINUTES: number = 30;

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

let storedEvent: ScheduledMaintenance;
let matchingRule: ScheduledMaintenanceReminderRule | null;
let writes: MockFunction;

function eventStartingAt(
  startsAt: Date,
  enableReminders: boolean = true,
): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.projectId = PROJECT_ID;
  event.startsAt = startsAt;
  event.enableReminders = enableReminders;
  event.labels = [];
  return event;
}

function rule(remindWhileScheduled: boolean): ScheduledMaintenanceReminderRule {
  const reminderRule: ScheduledMaintenanceReminderRule =
    new ScheduledMaintenanceReminderRule();
  reminderRule._id = "5b000000-0000-4000-8000-0000000000f1";
  reminderRule.reminderIntervalInMinutes = INTERVAL_IN_MINUTES;
  reminderRule.remindWhileScheduled = remindWhileScheduled;
  return reminderRule;
}

// The next reminder time the refresh wrote, or undefined when it wrote none.
function nextReminderWritten(): Date | null | undefined {
  if (writes.mock.calls.length === 0) {
    return undefined;
  }

  expect(writes).toHaveBeenCalledTimes(1);

  return (
    writes.mock.calls[0]![0] as {
      data: { nextReminderNotificationAt: Date | null };
    }
  ).data.nextReminderNotificationAt;
}

async function refresh(
  startMovedFrom?: { startsAtBefore: Date | null } | undefined,
): Promise<void> {
  await ScheduledMaintenanceService.refreshReminderSchedule({
    scheduledMaintenanceId: EVENT_ID,
    projectId: PROJECT_ID,
    startMovedFrom: startMovedFrom,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });

  storedEvent = eventStartingAt(hoursFromNow(2));
  matchingRule = rule(false);

  jest
    .spyOn(ScheduledMaintenanceService, "findOneById")
    .mockImplementation((async (): Promise<ScheduledMaintenance> => {
      return storedEvent;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceReminderRuleService, "findMatchingRule")
    .mockImplementation((async (): Promise<ScheduledMaintenanceReminderRule | null> => {
      return matchingRule;
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
    .mockResolvedValue(false as never);

  writes = getJestMockFunction();
  writes.mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneById")
    .mockImplementation(writes as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a start that moved, under a rule that waits for the start", () => {
  test("moved earlier: the first reminder moves with it", async () => {
    storedEvent = eventStartingAt(hoursFromNow(1));

    await refresh({ startsAtBefore: hoursFromNow(3) });

    expect(nextReminderWritten()).toEqual(
      minutesAfter(hoursFromNow(1), INTERVAL_IN_MINUTES),
    );
  });

  test("moved later: the first reminder moves with it", async () => {
    storedEvent = eventStartingAt(hoursFromNow(5));

    await refresh({ startsAtBefore: hoursFromNow(2) });

    expect(nextReminderWritten()).toEqual(
      minutesAfter(hoursFromNow(5), INTERVAL_IN_MINUTES),
    );
  });

  test("moved from ahead into the past: counted from now, as an event under way", async () => {
    storedEvent = eventStartingAt(hoursFromNow(-1));

    await refresh({ startsAtBefore: hoursFromNow(2) });

    expect(nextReminderWritten()).toEqual(
      minutesAfter(NOW, INTERVAL_IN_MINUTES),
    );
  });

  test("moved while long past: the interval running now is left as it is", async () => {
    storedEvent = eventStartingAt(hoursFromNow(-3));

    await refresh({ startsAtBefore: hoursFromNow(-5) });

    expect(nextReminderWritten()).toBeUndefined();
  });

  test("from a start the read did not know, ahead now: it follows the start", async () => {
    storedEvent = eventStartingAt(hoursFromNow(4));

    await refresh({ startsAtBefore: null });

    expect(nextReminderWritten()).toEqual(
      minutesAfter(hoursFromNow(4), INTERVAL_IN_MINUTES),
    );
  });
});

describe("a start that moved, where the reminders are not counted from it", () => {
  test("a rule that reminds while the event is scheduled: the interval is left as it is", async () => {
    matchingRule = rule(true);
    storedEvent = eventStartingAt(hoursFromNow(1));

    await refresh({ startsAtBefore: hoursFromNow(3) });

    expect(nextReminderWritten()).toBeUndefined();
  });

  test("no rule matches the event: nothing is written", async () => {
    matchingRule = null;

    await refresh({ startsAtBefore: hoursFromNow(3) });

    expect(nextReminderWritten()).toBeUndefined();
  });

  test("the event's reminders are switched off: nothing is written", async () => {
    storedEvent = eventStartingAt(hoursFromNow(1), false);

    await refresh({ startsAtBefore: hoursFromNow(3) });

    expect(nextReminderWritten()).toBeUndefined();
  });

  test("a completed event: nothing is written", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
      .mockResolvedValue(true as never);

    await refresh({ startsAtBefore: hoursFromNow(3) });

    expect(nextReminderWritten()).toBeUndefined();
  });
});

describe("a refresh for a change of the labels or the Send reminders switch, as before", () => {
  test("always writes the schedule, counted from now under a rule that reminds while scheduled", async () => {
    matchingRule = rule(true);

    await refresh();

    expect(nextReminderWritten()).toEqual(
      minutesAfter(NOW, INTERVAL_IN_MINUTES),
    );
  });

  test("clears it when no rule matches any more", async () => {
    matchingRule = null;

    await refresh();

    expect(nextReminderWritten()).toBeNull();
  });
});
