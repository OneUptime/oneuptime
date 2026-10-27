import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import MaintenanceReminderTimingText, {
  MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID,
  MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderTimingText";
import {
  MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
  MAINTENANCE_REMINDER_TIMING_COPY,
  MaintenanceReminderTiming,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/MaintenanceReminderTiming";

/*
 * Scheduled Maintenance > Rules > Reminder Rules lists when each rule
 * reminds as its form asks it - "While it is in progress", "Before it
 * starts", or both - in one Remind Owners column, where it showed the two
 * columns the answer is stored in ("Stop Reminders When: Completed",
 * "Remind While Scheduled: No"). A rule stored with the pair that never
 * reminds is marked "Never reminds" in amber, as a label rule that adds
 * nothing is marked "Adds nothing": an empty value's dash passed for "not
 * set", and a phone's card left the line out. Why is said on hover, on a
 * tap, on keyboard focus and to a screen reader - not under a mouse only.
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

  test("a rule that never reminds is marked Never reminds, in amber, not a dash", () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(false, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    const mark: HTMLElement = screen.getByTestId(
      MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID,
    );
    expect(mark).toHaveTextContent("Never reminds");
    // A pill, as a label rule that adds nothing is marked "Adds nothing".
    expect(within(mark).getByTestId("pill")).toBeInTheDocument();
    // A value, not an empty one: a phone's card keeps the line.
    expect(screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
    // None of the three answers.
    for (const timing of Object.values(MaintenanceReminderTiming)) {
      expect(
        screen.queryByText(MAINTENANCE_REMINDER_TIMING_COPY[timing].title),
      ).toBeNull();
    }
  });

  test("its tooltip says why and what to do, as the Edit form's note does", async () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(false, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByTestId(MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID),
    );

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
    );
  });

  test("a tap says why too - a phone's card of the list never hovers", async () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(false, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID,
    );

    fireEvent.mouseDown(button);
    act(() => {
      button.focus();
    });
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    fireEvent.mouseLeave(button);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
    );
  });

  test("a keyboard reaches it, and a screen reader hears why without opening anything", () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(false, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Never reminds",
    });

    expect(button).toBe(
      screen.getByTestId(MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID),
    );
    expect(button).toHaveAccessibleDescription(
      MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
    );
  });

  test("a rule that reminds is never marked", () => {
    render(
      <MaintenanceReminderTimingText
        rule={rule(true, ScheduledMaintenanceReminderStopState.Ongoing)}
      />,
    );

    expect(
      screen.queryByTestId(MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText("Never reminds")).toBeNull();
  });
});
