import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import MaintenanceReminderTimingText from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderTimingText";

/*
 * Scheduled Maintenance > Rules > Reminder Rules lists when each rule
 * reminds as its form asks it - "While it is in progress", "Before it
 * starts", or both - in one Remind Owners column, where it showed the two
 * columns the answer is stored in ("Stop Reminders When: Completed",
 * "Remind While Scheduled: No"). A rule stored with the pair that never
 * reminds shows an empty value's dash: its form says why.
 */

function rule(
  remindWhileScheduled: boolean | undefined,
  stopRemindersOnState: ScheduledMaintenanceReminderStopState | undefined,
): ScheduledMaintenanceReminderRule {
  return Object.assign(new ScheduledMaintenanceReminderRule(), {
    remindWhileScheduled,
    stopRemindersOnState,
  });
}

afterEach(() => {
  cleanup();
});

describe("a maintenance reminder rule's answer in the list", () => {
  test.each([
    [
      false,
      ScheduledMaintenanceReminderStopState.Completed,
      "While it is in progress",
    ],
    [true, ScheduledMaintenanceReminderStopState.Ongoing, "Before it starts"],
    [
      true,
      ScheduledMaintenanceReminderStopState.Completed,
      "Before it starts and while it is in progress",
    ],
    // Columns not read: what a new rule stores.
    [undefined, undefined, "While it is in progress"],
  ] as Array<
    [
      boolean | undefined,
      ScheduledMaintenanceReminderStopState | undefined,
      string,
    ]
  >)(
    "remind while scheduled %p, stop %p reads %p",
    (
      remindWhileScheduled: boolean | undefined,
      stopState: ScheduledMaintenanceReminderStopState | undefined,
      answer: string,
    ) => {
      render(
        <MaintenanceReminderTimingText
          rule={rule(remindWhileScheduled, stopState)}
        />,
      );

      expect(screen.getByText(answer)).toBeInTheDocument();
    },
  );

  test("a rule that never reminds shows the empty value's dash", () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(false, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
  });
});
