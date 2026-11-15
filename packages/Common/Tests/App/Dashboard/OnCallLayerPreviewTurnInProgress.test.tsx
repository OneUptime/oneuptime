import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import LayerRotationSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerRotationSummary";
import {
  getLayerPreviewEvents,
  LayerPreviewResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerShiftPreview";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";

/*
 * A LAYER CARD SHOWS THE TURN IN PROGRESS FROM ITS REAL START (issue #7720).
 *
 * Each layer card lists its shifts, the turn in progress first, worked out
 * over a preview window that starts two rotations (at least two days) back.
 * The engine starts the first event at the later of the window's start and
 * the layer's, so a turn that began before the window was cut at its edge:
 * a layer that starts Sep 1 08:00 in Singapore, rotating daily with its
 * first hand-off on Sep 8 08:00 (a week-long first turn), read on Sep 5 at
 * 11:15:42, showed "Sep 3, 11:15 -> Sep 8, 08:00" - a moment that was never
 * a hand-off, the minute the page was opened at. Only the first turn can be
 * longer than two rotations, so while it is still on the window starts with
 * the layer, and the card reads "Sep 1, 08:00 -> Sep 8, 08:00".
 */

const ALICE: string = "aaaaaaaa-1111-4111-8111-111111111111";
const BOB: string = "bbbbbbbb-2222-4222-8222-222222222222";

const SINGAPORE: string = "Asia/Singapore";

// Sep 1 08:00, Sep 8 08:00 and Sep 5 11:15:42 in Singapore (UTC+8).
const SEP_1_0800: Date = new Date("2026-09-01T00:00:00.000Z");
const SEP_8_0800: Date = new Date("2026-09-08T00:00:00.000Z");
const SEP_5_111542: Date = new Date("2026-09-05T03:15:42.000Z");

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function makeUser(id: string, name: string): User {
  const user: User = new User();
  user.id = new ObjectID(id);
  user.name = name as any;
  user.email = `${id}@example.com` as any;
  return user;
}

function layerUsers(): Array<OnCallDutyPolicyScheduleLayerUser> {
  return [
    [ALICE, "Alice Andersson"],
    [BOB, "Bob Berg"],
  ].map(([id, name]: Array<string>, index: number) => {
    const layerUser: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    layerUser.userId = new ObjectID(id!);
    layerUser.user = makeUser(id!, name!);
    layerUser.order = index + 1;
    return layerUser;
  });
}

function rotation(intervalType: EventInterval, count: number = 1): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType,
      intervalCount: { _type: "PositiveNumber", value: count },
    },
  } as any) as Recurring;
}

function noRestrictions(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  return restrictionTimes;
}

// On call 09:00-17:00 in Singapore every day.
function workingHours(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: new Date("2026-09-01T01:00:00.000Z"),
    endTime: new Date("2026-09-01T09:00:00.000Z"),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

function makeLayer(options: {
  startsAt: Date | string;
  handOffTime: Date | string;
  rotation: Recurring;
  restrictionTimes?: RestrictionTimes;
}): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  layer.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  layer.startsAt = options.startsAt as Date;
  layer.handOffTime = options.handOffTime as Date;
  layer.rotation = options.rotation;
  layer.restrictionTimes = options.restrictionTimes || noRestrictions();
  return layer;
}

function previewAt(
  now: Date,
  layer: OnCallDutyPolicyScheduleLayer,
  timezone: string = SINGAPORE,
): LayerPreviewResult {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

  return getLayerPreviewEvents({
    layer,
    users: layerUsers(),
    timezone,
    numberOfShifts: 6,
  });
}

// The event the engine has on now, as the card's "on call now" reads it.
function eventInProgress(preview: LayerPreviewResult): CalendarEvent {
  const event: CalendarEvent | undefined = preview.events.find(
    (candidate: CalendarEvent): boolean => {
      return (
        OneUptimeDate.isOnOrBefore(candidate.start, preview.now) &&
        OneUptimeDate.isAfter(candidate.end, preview.now)
      );
    },
  );

  if (!event) {
    throw new Error("No event is on now");
  }

  return event;
}

// The turn in progress, grouped the way the card's list groups its turns.
function turnInProgress(
  preview: LayerPreviewResult,
  hasRestriction: boolean,
): OnCallShift {
  const turns: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
    preview.events,
    {
      mergeAcrossGaps: hasRestriction,
      bridgeGapsWithinTurnOnly: true,
      groupKey: ScheduleShiftUtil.groupKeyByUserAndOverride,
    },
  );
  const current: OnCallShift | null = ScheduleShiftUtil.getCurrentAndNextShift(
    turns,
    preview.now,
  ).current;

  if (!current) {
    throw new Error("No turn is in progress");
  }

  return current;
}

// The window the preview had before #7720: two rotations, or two days, back.
function oldWindowStart(now: Date, days: number): Date {
  const twoDaysBack: Date = new Date(now.getTime() - 2 * DAY);
  const cadence: Date = new Date(now.getTime() - days * DAY);
  return OneUptimeDate.isBefore(cadence, twoDaysBack) ? cadence : twoDaysBack;
}

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a first turn longer than the preview window", () => {
  test("the case in the issue: a daily layer's week-long first turn starts at the layer's start", () => {
    const preview: LayerPreviewResult = previewAt(
      SEP_5_111542,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: SEP_8_0800,
        rotation: rotation(EventInterval.Day),
      }),
    );

    const event: CalendarEvent = eventInProgress(preview);

    expect(event.start.toISOString()).toBe(SEP_1_0800.toISOString());
    expect(event.end.toISOString()).toBe(SEP_8_0800.toISOString());
    expect(event.title).toBe(ALICE);

    const turn: OnCallShift = turnInProgress(preview, false);

    expect(turn.start.toISOString()).toBe(SEP_1_0800.toISOString());
    expect(turn.end.toISOString()).toBe(SEP_8_0800.toISOString());
    expect(preview.windowStart.toISOString()).toBe(SEP_1_0800.toISOString());
  });

  test("no event starts at a moment that was never a hand-off: none carries the seconds the page was opened at", () => {
    const preview: LayerPreviewResult = previewAt(
      SEP_5_111542,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: SEP_8_0800,
        rotation: rotation(EventInterval.Day),
      }),
    );

    for (const event of preview.events) {
      expect(event.start.getUTCSeconds() === 42).toBe(false);
      expect(event.start.getUTCMinutes() === 15).toBe(false);
    }
  });

  test("an hourly layer whose first turn is longer than two days starts it at the layer's start", () => {
    const now: Date = new Date("2026-09-05T03:15:42.000Z");
    const startsAt: Date = new Date(now.getTime() - 3 * DAY - 7 * HOUR);
    const handOffTime: Date = new Date(now.getTime() + 5 * HOUR);

    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt,
        handOffTime,
        rotation: rotation(EventInterval.Hour),
      }),
    );

    const event: CalendarEvent = eventInProgress(preview);

    expect(event.start.toISOString()).toBe(startsAt.toISOString());
    expect(event.end.toISOString()).toBe(handOffTime.toISOString());
    expect(turnInProgress(preview, false).start.toISOString()).toBe(
      startsAt.toISOString(),
    );
  });

  test("a weekly layer whose first hand-off is more than two weeks out starts its turn at the layer's start", () => {
    const now: Date = new Date("2026-09-25T03:15:42.000Z");
    const startsAt: Date = SEP_1_0800;
    const handOffTime: Date = new Date("2026-09-28T00:00:00.000Z");

    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt,
        handOffTime,
        rotation: rotation(EventInterval.Week),
      }),
    );

    const event: CalendarEvent = eventInProgress(preview);

    expect(event.start.toISOString()).toBe(startsAt.toISOString());
    expect(event.end.toISOString()).toBe(handOffTime.toISOString());
    // The window reached back past its usual two weeks to hold it.
    expect(
      OneUptimeDate.isBefore(preview.windowStart, oldWindowStart(now, 14)),
    ).toBe(true);
  });

  test("with active hours, the turn starts at its first active hour, not at the window's edge", () => {
    const preview: LayerPreviewResult = previewAt(
      SEP_5_111542,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: SEP_8_0800,
        rotation: rotation(EventInterval.Day),
        restrictionTimes: workingHours(),
      }),
    );

    // On call 09:00-17:00: the turn's first hour on call is Sep 1, 09:00.
    expect(turnInProgress(preview, true).start.toISOString()).toBe(
      "2026-09-01T01:00:00.000Z",
    );
    // Now, 11:15 on Sep 5, is inside the day's hours, from 09:00.
    expect(eventInProgress(preview).start.toISOString()).toBe(
      "2026-09-05T01:00:00.000Z",
    );
  });

  test("a layer read back as JSON, with its moments as strings, is read the same way", () => {
    const preview: LayerPreviewResult = previewAt(
      SEP_5_111542,
      makeLayer({
        startsAt: SEP_1_0800.toISOString(),
        handOffTime: SEP_8_0800.toISOString(),
        rotation: rotation(EventInterval.Day),
      }),
    );

    expect(eventInProgress(preview).start.toISOString()).toBe(
      SEP_1_0800.toISOString(),
    );
  });
});

describe("what does not change", () => {
  test("a plain weekly rotation past its first hand-off keeps its window, and its turn starts at its real hand-off", () => {
    const now: Date = new Date("2026-09-25T03:15:42.000Z");
    // Weekly hand-offs on Tuesdays at 08:00, from Aug 11: the last was Sep 22.
    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt: new Date("2026-08-04T00:00:00.000Z"),
        handOffTime: new Date("2026-08-11T00:00:00.000Z"),
        rotation: rotation(EventInterval.Week),
      }),
    );

    expect(preview.windowStart.toISOString()).toBe(
      oldWindowStart(now, 14).toISOString(),
    );

    const turn: OnCallShift = turnInProgress(preview, false);

    // The engine's turns after the first start a second after the hand-off.
    expect(turn.start.toISOString()).toBe("2026-09-22T00:00:01.000Z");
    expect(turn.end.toISOString()).toBe("2026-09-29T00:00:00.000Z");
  });

  test("a daily rotation past its first hand-off keeps the two-day floor", () => {
    const now: Date = new Date("2026-09-25T03:15:42.000Z");
    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: SEP_8_0800,
        rotation: rotation(EventInterval.Day),
      }),
    );

    expect(preview.windowStart.toISOString()).toBe(
      oldWindowStart(now, 2).toISOString(),
    );
    expect(turnInProgress(preview, false).start.toISOString()).toBe(
      "2026-09-25T00:00:01.000Z",
    );
  });

  test("a layer that has not started yet keeps its window, and its first turn starts with it", () => {
    const now: Date = new Date("2026-08-25T03:15:42.000Z");
    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: SEP_8_0800,
        rotation: rotation(EventInterval.Day),
      }),
    );

    expect(preview.windowStart.toISOString()).toBe(
      oldWindowStart(now, 2).toISOString(),
    );
    expect(preview.events[0]!.start.toISOString()).toBe(
      SEP_1_0800.toISOString(),
    );
  });

  test("a first turn that fits in the window keeps the window", () => {
    // Started yesterday, hands off tomorrow: inside two days back.
    const now: Date = SEP_5_111542;
    const startsAt: Date = new Date(now.getTime() - DAY);
    const preview: LayerPreviewResult = previewAt(
      now,
      makeLayer({
        startsAt,
        handOffTime: new Date(now.getTime() + DAY),
        rotation: rotation(EventInterval.Day),
      }),
    );

    expect(preview.windowStart.toISOString()).toBe(
      oldWindowStart(now, 2).toISOString(),
    );
    expect(eventInProgress(preview).start.toISOString()).toBe(
      startsAt.toISOString(),
    );
  });

  test.each([
    ["daily, in a long first turn", EventInterval.Day, SEP_8_0800, 8],
    ["daily, past its first hand-off", EventInterval.Day, SEP_1_0800, 8],
    [
      "weekly, in a long first turn",
      EventInterval.Week,
      new Date("2026-09-28T00:00:00.000Z"),
      8 * 7,
    ],
    ["hourly, in a long first turn", EventInterval.Hour, SEP_8_0800, 0],
  ])(
    "the window still ends where it did: %s",
    (
      _case: string,
      intervalType: EventInterval,
      handOffTime: Date,
      cadenceDays: number,
    ) => {
      const now: Date = SEP_5_111542;
      const preview: LayerPreviewResult = previewAt(
        now,
        makeLayer({
          startsAt: SEP_1_0800,
          handOffTime,
          rotation: rotation(intervalType),
        }),
      );

      // numberOfShifts + 2 rotations ahead, at least 14 days.
      const days: number = Math.max(cadenceDays, 14);

      expect(preview.windowEnd.toISOString()).toBe(
        new Date(now.getTime() + days * DAY).toISOString(),
      );
    },
  );

  test("a layer with no first hand-off keeps the window and shows nothing", () => {
    const preview: LayerPreviewResult = previewAt(
      SEP_5_111542,
      makeLayer({
        startsAt: SEP_1_0800,
        handOffTime: undefined as unknown as Date,
        rotation: rotation(EventInterval.Day),
      }),
    );

    expect(preview.windowStart.toISOString()).toBe(
      oldWindowStart(SEP_5_111542, 2).toISOString(),
    );
    expect(preview.events).toEqual([]);
  });
});

describe("the layer card's list of turns", () => {
  test("reads the turn in progress from Sep 1, 08:00 to Sep 8, 08:00", () => {
    const layer: OnCallDutyPolicyScheduleLayer = makeLayer({
      startsAt: SEP_1_0800,
      handOffTime: SEP_8_0800,
      rotation: rotation(EventInterval.Day),
    });
    const preview: LayerPreviewResult = previewAt(SEP_5_111542, layer);

    render(
      <LayerRotationSummary
        layer={layer}
        users={layerUsers()}
        timezone={SINGAPORE}
        events={preview.events}
        now={preview.now}
        hasLowerPriorityLayer={false}
      />,
    );

    const firstRow: HTMLElement = within(
      screen.getByTestId("layer-upcoming-turns"),
    ).getAllByRole("listitem")[0]!;
    const moments: Array<string> = within(firstRow)
      .getAllByTestId("hand-off-moment")
      .map((moment: HTMLElement): string => {
        return (moment.textContent || "").trim();
      });

    expect(firstRow).toHaveTextContent("Alice Andersson");
    expect(firstRow).toHaveTextContent("On call now");
    expect(moments[0]).toContain("Sep 1");
    expect(moments[0]).toContain("08:00");
    expect(moments[1]).toContain("Sep 8");
    expect(moments[1]).toContain("08:00");
    // Not the window's edge: Sep 3, 11:15.
    expect(firstRow).not.toHaveTextContent("Sep 3");
    expect(firstRow).not.toHaveTextContent("11:15");
  });
});
