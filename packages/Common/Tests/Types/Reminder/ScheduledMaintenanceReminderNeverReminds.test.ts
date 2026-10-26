import { describe, expect, test } from "@jest/globals";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import {
  SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL,
  SCHEDULED_MAINTENANCE_REMINDER_TIMING_COLUMNS,
  doesScheduledMaintenanceReminderRuleNeverRemind,
  getScheduledMaintenanceReminderRuleRefusal,
} from "../../../Types/Reminder/ScheduledMaintenanceReminderNeverReminds";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";

/*
 * A SCHEDULED MAINTENANCE REMINDER RULE THAT WOULD NEVER REMIND.
 *
 * "Remind While Event is Scheduled" off holds the first reminder back until
 * the event starts, and "Stop Reminders When" Ongoing stops the reminders at
 * the start: together they remind nobody. That one pair - and only that
 * pair - is what the server refuses, and what the rules list marks "Never
 * reminds".
 */

const { Ongoing, Completed } = ScheduledMaintenanceReminderStopState;

describe("which reminder rules never remind", () => {
  test("waiting for the start and stopping at it: never", () => {
    expect(
      doesScheduledMaintenanceReminderRuleNeverRemind({
        remindWhileScheduled: false,
        stopRemindersOnState: Ongoing,
      }),
    ).toBe(true);
  });

  test("the switch never set reads as off, as a new rule stores it", () => {
    expect(
      doesScheduledMaintenanceReminderRuleNeverRemind({
        stopRemindersOnState: Ongoing,
      }),
    ).toBe(true);
    expect(
      doesScheduledMaintenanceReminderRuleNeverRemind({
        remindWhileScheduled: null,
        stopRemindersOnState: Ongoing,
      }),
    ).toBe(true);
  });

  test.each([
    ["while it is in progress", false, Completed],
    ["before it starts", true, Ongoing],
    ["before it starts and while it is in progress", true, Completed],
  ] as Array<[string, boolean, ScheduledMaintenanceReminderStopState]>)(
    "a rule that reminds %s reminds",
    (
      _answer: string,
      remindWhileScheduled: boolean,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState,
    ) => {
      expect(
        doesScheduledMaintenanceReminderRuleNeverRemind({
          remindWhileScheduled,
          stopRemindersOnState,
        }),
      ).toBe(false);
      expect(
        getScheduledMaintenanceReminderRuleRefusal({
          remindWhileScheduled,
          stopRemindersOnState,
        }),
      ).toBeNull();
    },
  );

  test("a new rule's defaults - nothing given - remind while it is in progress", () => {
    expect(doesScheduledMaintenanceReminderRuleNeverRemind({})).toBe(false);
    expect(getScheduledMaintenanceReminderRuleRefusal({})).toBeNull();
  });

  test("a stop state it does not know is not read as Ongoing", () => {
    expect(
      doesScheduledMaintenanceReminderRuleNeverRemind({
        remindWhileScheduled: false,
        stopRemindersOnState: "ongoing",
      }),
    ).toBe(false);
  });
});

describe("what saving one is refused with", () => {
  test("the pair that never reminds gets the refusal", () => {
    expect(
      getScheduledMaintenanceReminderRuleRefusal({
        remindWhileScheduled: false,
        stopRemindersOnState: Ongoing,
      }),
    ).toBe(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL);
  });

  test("it says why, and both ways out, in the API's own column titles", () => {
    const model: ScheduledMaintenanceReminderRule =
      new ScheduledMaintenanceReminderRule();
    const switchTitle: string = model.getTableColumnMetadata(
      "remindWhileScheduled",
    )!.title!;
    const stopTitle: string = model.getTableColumnMetadata(
      "stopRemindersOnState",
    )!.title!;

    expect(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL).toContain(
      "would never send a reminder",
    );
    expect(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL).toContain(
      `Turn on ${switchTitle}`,
    );
    expect(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL).toContain(
      `set ${stopTitle} to ${Completed}`,
    );
    expect(SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL).toContain(
      `${stopTitle} ${Ongoing}`,
    );
  });

  test("the columns it reads are the model's own", () => {
    const model: ScheduledMaintenanceReminderRule =
      new ScheduledMaintenanceReminderRule();

    expect([...SCHEDULED_MAINTENANCE_REMINDER_TIMING_COLUMNS]).toEqual([
      "remindWhileScheduled",
      "stopRemindersOnState",
    ]);

    for (const column of SCHEDULED_MAINTENANCE_REMINDER_TIMING_COLUMNS) {
      expect([column, model.hasColumn(column)]).toEqual([column, true]);
    }
  });

  test("the model's own description of Stop Reminders When says Ongoing needs the switch on", () => {
    const description: string =
      new ScheduledMaintenanceReminderRule().getTableColumnMetadata(
        "stopRemindersOnState",
      )!.description!;

    expect(description).toContain(
      "Ongoing needs Remind While Event is Scheduled on",
    );
    expect(description).toContain("would never remind, so it is refused");
  });
});
