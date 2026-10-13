import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

/*
 * THE FINAL SCHEDULE AND THE OVERRIDES CARD, READ THE WAY A PERSON READS
 * THEM (UI review of task oncall-skip-user-until).
 *
 *   - A turn that is somebody's because the person whose turn it was is away
 *     with nobody named to cover says "Next in the rotation" next to who has
 *     it - the reason it is them - then "Covering for <who is away>" and the
 *     time away. It never says "Skipped" beside the person on call, which
 *     read as if THEY had been skipped. A named cover still says "Override".
 *   - On a phone the "on call right now" and "up next" cards share one
 *     column that is never wider than the screen: a long name is cut short
 *     instead of pushing the page sideways (grid-cols-1 below sm; an
 *     implicit grid column grows to its widest content).
 *   - The overrides card says what an override does - a skip included - in
 *     three short sentences.
 */

import ActiveOverridesCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard";
import FinalScheduleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/FinalScheduleSummary";
import {
  OverrideSummaryRow,
  buildOverrideSummaryRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import OneUptimeDate from "../../../Types/Date";
import ScheduleShiftUtil, {
  OnCallShift,
  ScheduleCoverageState,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import { OverrideEventMeta } from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

const HOUR_MS: number = 3600 * 1000;

const ALICE: string = "a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b";
const CAROL: string = "c9d8e7f6-a5b4-4c3d-8e2f-1a0b9c8d7e6f";
const DANA: string = "9f3b2c1d-7e6a-4b5c-8d9e-000000000005";

// A name long enough to be wider than a phone's card.
const LONG_NAME: string =
  "Samuel Oluwaseun Adebayo-Lindqvist Konstantinopoulou-Whitfield";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALICE]: { name: "Alice Andersson", email: "alice@example.com" },
  [CAROL]: { name: LONG_NAME, email: "carol@example.com" },
  [DANA]: { name: "Dana Dark", email: "dana@example.com" },
};

afterEach(() => {
  cleanup();
});

function hoursFromNow(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

function override(data: {
  away: string;
  takes: string;
  from: Date;
  until: Date;
  isSkip: boolean;
}): OverrideEventMeta {
  return {
    isOverride: true,
    originalUserId: data.away,
    overrideUserId: data.takes,
    overrideStartsAt: data.from,
    overrideEndsAt: data.until,
    onCallDutyPolicyId: null,
    ...(data.isSkip ? { isSkip: true as const } : {}),
  };
}

/*
 * Carol is on call now because Alice is skipped; Dana is up next, covering
 * for Alice by name.
 */
function renderSummary(): { now: Date } {
  const now: Date = OneUptimeDate.getCurrentDate();

  const shifts: Array<OnCallShift> = [
    {
      userId: CAROL,
      start: hoursFromNow(now, -1),
      end: hoursFromNow(now, 3),
      coverageSeconds: 4 * 3600,
      override: override({
        away: ALICE,
        takes: CAROL,
        from: hoursFromNow(now, -2),
        until: hoursFromNow(now, 3),
        isSkip: true,
      }),
    },
    {
      userId: DANA,
      start: hoursFromNow(now, 3),
      end: hoursFromNow(now, 8),
      coverageSeconds: 5 * 3600,
      override: override({
        away: ALICE,
        takes: DANA,
        from: hoursFromNow(now, 3),
        until: hoursFromNow(now, 8),
        isSkip: false,
      }),
    },
  ];

  const windowEnd: Date = hoursFromNow(now, 8);

  const coverage: ScheduleCoverageState = ScheduleShiftUtil.getCoverageState({
    layerCount: 1,
    assignedUserCount: 3,
    shifts,
    now,
    windowEnd,
  });

  render(
    <FinalScheduleSummary
      shifts={shifts}
      now={now}
      windowEnd={windowEnd}
      timezone="UTC"
      userById={PEOPLE}
      coverage={coverage}
    />,
  );

  return { now };
}

describe("the final schedule's 'on call right now' and 'up next'", () => {
  test("a turn taken because somebody is skipped says 'Next in the rotation', never 'Skipped'", () => {
    renderSummary();

    const strip: HTMLElement = screen.getByTestId("on-call-now-override");

    expect(strip).toHaveAttribute("data-skip", "true");
    // The reason, first: the person on call is next in the rotation...
    expect(strip.firstElementChild).toHaveTextContent("Next in the rotation");
    // ...covering for the person who is away, for the time they are away.
    expect(strip).toHaveTextContent("Covering for Alice Andersson");
    expect(strip).toHaveTextContent("Away ");
    expect(strip).not.toHaveTextContent("Override runs");
    // Beside Carol's name, "Skipped" read as if Carol had been skipped.
    expect(strip).not.toHaveTextContent("Skipped");
  });

  test("a turn somebody was named to cover still says 'Override'", () => {
    renderSummary();

    const strip: HTMLElement = screen.getByTestId("up-next-override");

    expect(strip).toHaveAttribute("data-skip", "false");
    expect(strip.firstElementChild).toHaveTextContent("Override");
    expect(strip).toHaveTextContent("Covering for Alice Andersson");
    expect(strip).toHaveTextContent("Override runs");
    expect(strip).not.toHaveTextContent("Next in the rotation");
  });

  test("on a phone the two cards share one column no wider than the screen, and a long name is cut short", () => {
    renderSummary();

    const nowCard: HTMLElement = screen
      .getByTestId("on-call-now-override")
      .closest(".rounded-xl") as HTMLElement;
    const grid: HTMLElement = nowCard.parentElement as HTMLElement;

    /*
     * One explicit column below sm (minmax(0, 1fr) in Tailwind): an implicit
     * column grows to its widest content, and a long name pushed the page
     * sideways on a phone.
     */
    expect(grid.className.split(" ")).toEqual(
      expect.arrayContaining(["grid", "grid-cols-1", "sm:grid-cols-2"]),
    );
    expect(grid.children).toHaveLength(2);

    // The name is cut short inside a box allowed to shrink.
    const name: HTMLElement = within(nowCard).getByText(LONG_NAME);
    expect(name.className).toContain("truncate");
    expect((name.parentElement as HTMLElement).className).toContain("min-w-0");
  });
});

describe("the overrides card", () => {
  test("says what an override does, a skip included, in three short sentences", () => {
    const now: Date = OneUptimeDate.getCurrentDate();

    const rows: Array<OverrideSummaryRow> = buildOverrideSummaryRows({
      records: [
        {
          overrideUserId: ALICE,
          routeAlertsToUserId: null,
          startsAt: hoursFromNow(now, -1),
          endsAt: hoursFromNow(now, 24),
          onCallDutyPolicyId: null,
        },
      ],
      userInfoById: PEOPLE,
      policyNameById: {},
      now,
    });

    render(
      <ActiveOverridesCard rows={rows} userById={PEOPLE} timezone="UTC" />,
    );

    const card: HTMLElement = screen.getByTestId("active-overrides-card");

    expect(card).toHaveTextContent(
      "An override sends the pages of someone who is away to the person who covers for them. With nobody named, each of their turns goes to the next person in the rotation instead. The calendar below shows who has each shift.",
    );
    // The old one ran a dash and a colon into one long sentence.
    expect(card).not.toHaveTextContent("skips them:");
    // The skip's row: the person away, and the rotation covering.
    expect(card).toHaveTextContent("Alice Andersson");
    expect(card).toHaveTextContent("Next person in the rotation");
  });
});
