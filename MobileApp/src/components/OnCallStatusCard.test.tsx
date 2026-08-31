import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import OnCallStatusCard from "./OnCallStatusCard";
import type { OnCallDutySummary } from "../oncall/duty";
import type { OnCallShift } from "../api/types";

/*
 * This card is the answer to "am I on call, and until when". It is allowed to
 * be vague; it is not allowed to be wrong. The tests below are the four ways
 * it could be wrong:
 *
 *   - claiming a handoff for a standing assignment that has none;
 *   - showing a countdown while saying "off call";
 *   - hiding the next shift from somebody who is currently off;
 *   - rendering a NaN or an empty fragment when the roster is incomplete.
 */

const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();
const HOUR: number = 60 * 60 * 1000;

function shift(overrides: Partial<OnCallShift> = {}): OnCallShift {
  return {
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    projectId: "project-1",
    projectName: "Acme",
    status: "active",
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function summary(
  overrides: Partial<OnCallDutySummary> = {},
): OnCallDutySummary {
  return {
    isOnCall: false,
    activeShifts: [],
    upcomingShifts: [],
    nextHandoffAt: null,
    nextShiftStartsAt: null,
    standingAssignmentCount: 0,
    scheduleAssignmentCount: 0,
    ...overrides,
  };
}

describe("OnCallStatusCard on duty", () => {
  test("leads with the countdown to the handoff", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          activeShifts: [
            shift({ endsAt: new Date(NOW + 3 * HOUR).toISOString() }),
          ],
          nextHandoffAt: new Date(NOW + 3 * HOUR).toISOString(),
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(screen.getByText("You're on call")).toBeTruthy();
    expect(screen.getByText("ON CALL")).toBeTruthy();
    expect(screen.getByText("Handoff in 3h")).toBeTruthy();
    expect(screen.getByText("Today 3:00 PM")).toBeTruthy();
  });

  test("a standing assignment says so instead of inventing a handoff", async (): Promise<void> => {
    /*
     * The single most important assertion in this file. A direct escalation
     * rule has no shift window at all; a card that borrowed one would tell a
     * responder they stop carrying the phone at a time that means nothing.
     */
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({ isOnCall: true, standingAssignmentCount: 2 })}
      />,
    );

    expect(screen.getByText("You're on call")).toBeTruthy();
    expect(
      screen.getByText("Standing assignment — no scheduled handoff"),
    ).toBeTruthy();
    expect(screen.queryByText(/Handoff in/)).toBeNull();
  });

  test("an active shift with no computed handoff does not fabricate one", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          activeShifts: [shift()],
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(screen.getByText("On duty — no scheduled handoff")).toBeTruthy();
  });
});

describe("OnCallStatusCard off duty", () => {
  test("counts down to the next shift", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          upcomingShifts: [
            shift({
              status: "upcoming",
              startsAt: new Date(NOW + 26 * HOUR).toISOString(),
            }),
          ],
          nextShiftStartsAt: new Date(NOW + 26 * HOUR).toISOString(),
        })}
      />,
    );

    expect(screen.getByText("You're not on call")).toBeTruthy();
    expect(screen.getByText("OFF CALL")).toBeTruthy();
    expect(screen.getByText("Next shift starts in 1d 2h")).toBeTruthy();
  });

  test("says there is nothing coming when there is nothing coming", async (): Promise<void> => {
    await render(<OnCallStatusCard now={NOW} summary={summary()} />);

    expect(
      screen.getByText("No upcoming shifts on your schedules"),
    ).toBeTruthy();
  });

  test("renders no handoff row at all when neither timestamp exists", async (): Promise<void> => {
    /*
     * An empty meta row would leave two uppercase labels over blank space,
     * which reads as a failed load rather than as "nothing scheduled".
     */
    await render(<OnCallStatusCard now={NOW} summary={summary()} />);

    expect(screen.queryByText("Handoff")).toBeNull();
    expect(screen.queryByText("Next shift")).toBeNull();
  });
});

describe("OnCallStatusCard while loading", () => {
  test("does not assert a duty state it has not read yet", async (): Promise<void> => {
    /*
     * Rendering "You're not on call" before the answer arrives is the one
     * loading state that could send somebody back to sleep.
     */
    await render(
      <OnCallStatusCard now={NOW} summary={summary()} isLoading={true} />,
    );

    expect(screen.getByText("Checking your duty status")).toBeTruthy();
    expect(screen.queryByText("You're not on call")).toBeNull();
  });
});

describe("OnCallStatusCard accessibility", () => {
  test("the card announces the state and the countdown together", async (): Promise<void> => {
    await render(
      <OnCallStatusCard
        now={NOW}
        summary={summary({
          isOnCall: true,
          nextHandoffAt: new Date(NOW + 90 * 60 * 1000).toISOString(),
          scheduleAssignmentCount: 1,
        })}
      />,
    );

    expect(
      screen.getByLabelText("You're on call. Handoff in 1h 30m."),
    ).toBeTruthy();
  });
});
