import OneUptimeDate from "../../../Types/Date";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloStatusChange, {
  SLO_STATUS_CHANGES,
  getSloStatusChange,
  isSloStatusChange,
} from "../../../Types/ServiceLevelObjective/SloStatusChange";
import {
  SLO_STATUS_POST_MIN_INTERVAL_MINUTES,
  SloStatusPost,
  SloStatusPostDecision,
  decideSloStatusPost,
} from "../../../Utils/Slo/SloStatusPosts";
import { describe, expect, test } from "@jest/globals";

/*
 * AN SLO'S STATUS IN SLACK, MICROSOFT TEAMS AND MATTERMOST (#6596): what a
 * channel is told of a status change, and when - at most once an interval,
 * and always where the SLO is now, so a flapping SLO cannot flood a
 * channel.
 */

const NOW: Date = new Date("2026-11-18T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return OneUptimeDate.addRemoveMinutes(NOW, -minutes);
}

function heard(status: SloStatus, minutes: number): SloStatusPost {
  return { status: status, postedAt: minutesAgo(minutes) };
}

describe("what a channel is told of a status change", () => {
  test.each([
    [SloStatus.Healthy, SloStatus.AtRisk, SloStatusChange.BecameAtRisk],
    [
      SloStatus.Healthy,
      SloStatus.BudgetExhausted,
      SloStatusChange.BudgetExhausted,
    ],
    [
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
      SloStatusChange.BudgetExhausted,
    ],
    // The budget coming back is still At Risk, and the channel hears it.
    [SloStatus.BudgetExhausted, SloStatus.AtRisk, SloStatusChange.BecameAtRisk],
    [SloStatus.AtRisk, SloStatus.Healthy, SloStatusChange.HealthyAgain],
    [
      SloStatus.BudgetExhausted,
      SloStatus.Healthy,
      SloStatusChange.HealthyAgain,
    ],
    // First measured so: the channel hears where the SLO is.
    [SloStatus.Waiting, SloStatus.AtRisk, SloStatusChange.BecameAtRisk],
    [
      SloStatus.Misconfigured,
      SloStatus.BudgetExhausted,
      SloStatusChange.BudgetExhausted,
    ],
    [undefined, SloStatus.AtRisk, SloStatusChange.BecameAtRisk],
  ])(
    "%s -> %s: %s",
    (from: SloStatus | undefined, to: SloStatus, change: SloStatusChange) => {
      expect(getSloStatusChange(from, to)).toBe(change);
    },
  );

  test.each([
    // Healthy after a status that measured nothing: nothing about reliability moved.
    [SloStatus.Waiting, SloStatus.Healthy],
    [SloStatus.Misconfigured, SloStatus.Healthy],
    [SloStatus.Paused, SloStatus.Healthy],
    [undefined, SloStatus.Healthy],
    // Into a status that measures nothing.
    [SloStatus.AtRisk, SloStatus.Paused],
    [SloStatus.BudgetExhausted, SloStatus.Waiting],
    [SloStatus.Healthy, SloStatus.Misconfigured],
    // No move at all.
    [SloStatus.AtRisk, SloStatus.AtRisk],
  ])("%s -> %s: nothing", (from: SloStatus | undefined, to: SloStatus) => {
    expect(getSloStatusChange(from, to)).toBeNull();
  });

  test("knows its own values and nothing else", () => {
    expect([...SLO_STATUS_CHANGES]).toEqual([
      "Became At Risk",
      "Budget exhausted",
      "Healthy again",
    ]);

    for (const change of SLO_STATUS_CHANGES) {
      expect(isSloStatusChange(change)).toBe(true);
    }

    expect(isSloStatusChange("Entered a more severe tier")).toBe(false);
    expect(isSloStatusChange("healthy again")).toBe(false);
    expect(isSloStatusChange(undefined)).toBe(false);
  });
});

describe("when a status change is said", () => {
  test("a transition with nothing remembered is said at once, against the status the evaluation started from", () => {
    expect(
      decideSloStatusPost({
        lastPost: null,
        previousStatus: SloStatus.Healthy,
        newStatus: SloStatus.AtRisk,
        now: NOW,
      }),
    ).toEqual({
      change: SloStatusChange.BecameAtRisk,
      from: SloStatus.Healthy,
    });
  });

  test("an SLO that holds its status says nothing, tick after tick", () => {
    expect(
      decideSloStatusPost({
        lastPost: null,
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.AtRisk,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 600),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.AtRisk,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a change within the interval of the last waits, and is said once the interval is up if the SLO is still there", () => {
    // At Risk was said 20 minutes ago; the SLO is Healthy again now.
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 20),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.Healthy,
        now: NOW,
      }),
    ).toBeNull();

    // An evaluation once the interval is up, with no transition of its own.
    const decision: SloStatusPostDecision | null = decideSloStatusPost({
      lastPost: heard(SloStatus.AtRisk, SLO_STATUS_POST_MIN_INTERVAL_MINUTES),
      previousStatus: SloStatus.Healthy,
      newStatus: SloStatus.Healthy,
      now: NOW,
    });

    expect(decision).toEqual({
      change: SloStatusChange.HealthyAgain,
      from: SloStatus.AtRisk,
    });
  });

  test("a flap that comes back to what the channels heard says nothing at all", () => {
    // At Risk said; Healthy for a while (held back); At Risk again.
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 40),
        previousStatus: SloStatus.Healthy,
        newStatus: SloStatus.AtRisk,
        now: NOW,
      }),
    ).toBeNull();
    // And still nothing once the interval is up: the channels already know.
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 90),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.AtRisk,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("an exhausted budget is said at once, whatever the interval, and only once", () => {
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 5),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.BudgetExhausted,
        now: NOW,
      }),
    ).toEqual({
      change: SloStatusChange.BudgetExhausted,
      from: SloStatus.AtRisk,
    });

    // Back to At Risk and exhausted again within the interval: nothing new to say.
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.BudgetExhausted, 5),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.BudgetExhausted,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a status that measures nothing is never said", () => {
    for (const status of [
      SloStatus.Waiting,
      SloStatus.Misconfigured,
      SloStatus.Paused,
    ]) {
      expect(
        decideSloStatusPost({
          lastPost: heard(SloStatus.AtRisk, 600),
          previousStatus: SloStatus.AtRisk,
          newStatus: status,
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("Healthy after a pause is said when the channels last heard At Risk, and not otherwise", () => {
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 6000),
        previousStatus: SloStatus.Paused,
        newStatus: SloStatus.Healthy,
        now: NOW,
      }),
    ).toEqual({ change: SloStatusChange.HealthyAgain, from: SloStatus.AtRisk });

    expect(
      decideSloStatusPost({
        lastPost: null,
        previousStatus: SloStatus.Paused,
        newStatus: SloStatus.Healthy,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("takes an interval of its own when given one", () => {
    expect(
      decideSloStatusPost({
        lastPost: heard(SloStatus.AtRisk, 10),
        previousStatus: SloStatus.AtRisk,
        newStatus: SloStatus.Healthy,
        now: NOW,
        minIntervalMinutes: 5,
      }),
    ).toEqual({ change: SloStatusChange.HealthyAgain, from: SloStatus.AtRisk });
  });
});
