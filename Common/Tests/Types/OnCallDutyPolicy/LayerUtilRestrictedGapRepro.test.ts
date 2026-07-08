/**
 * REPRO: restricted daily rotation resolved during the post-window gap of the
 * current rotation period attributes the NEXT shift to the WRONG (previous)
 * user, and stays off-by-one forever after.
 *
 * Config: daily rotation x1, users [A,B], daily restriction 09:00-17:00.
 * Layer start Mon 2025-01-06 00:00 UTC, handoff = +1 day.
 *   Full expansion (calendar/preview) : Jan6=A, Jan7=B, Jan8=A ...
 *   Windowed resolution asked at Jan6 20:52 (after 17:00 close) : Jan7=A (WRONG).
 */
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";

function user(id: string): User {
  return { id: { toString: (): string => id } as any } as User;
}

function dailyRestriction(sh: number, eh: number): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: sh,
      minutes: 0,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: eh,
      minutes: 0,
      seconds: 0,
    }),
  };
  return r;
}

function makeLayer(): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = EventInterval.Day;
  rot.intervalCount = new PositiveNumber(1);
  const start: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z");
  return {
    users: [user("A"), user("B")],
    startDateTimeOfLayer: start,
    restrictionTimes: dailyRestriction(9, 17),
    handOffTime: Recurring.getNextDateInterval(start, rot),
    rotation: rot,
    timezone: undefined,
  };
}

function fmt(e: CalendarEvent): string {
  return `${e.title} [${e.start.toISOString()} -> ${e.end.toISOString()}]`;
}

describe("Restricted daily rotation: post-window gap query is off-by-one", () => {
  test("full expansion says Jan7=B but a Jan6-evening query says Jan7=A", () => {
    const layer: LayerProps = makeLayer();
    const util: LayerUtil = new LayerUtil();

    // FULL expansion (ground truth = what the dashboard calendar shows).
    const full: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: layer.startDateTimeOfLayer,
      calendarEndDate: OneUptimeDate.fromString("2025-01-10T00:00:00.000Z"),
    });

    // Identify who covers the Jan 7 09:00-17:00 window in the full expansion.
    const jan7noon: Date = OneUptimeDate.fromString(
      "2025-01-07T12:00:00.000Z",
    );
    const jan7Cover: CalendarEvent | undefined = full.find(
      (e: CalendarEvent) => {
        return (
          OneUptimeDate.isOnOrAfter(jan7noon, e.start) &&
          OneUptimeDate.isBefore(jan7noon, e.end)
        );
      },
    );

    // WINDOWED resolution asked during the Jan 6 evening gap (after 17:00).
    const askAt: Date = OneUptimeDate.fromString("2025-01-06T20:52:48.000Z");
    const windowed: Array<CalendarEvent> = util.getEvents(
      {
        ...layer,
        calendarStartDate: askAt,
        calendarEndDate: OneUptimeDate.addRemoveDays(askAt, 5),
      },
      { getNumberOfEvents: 1 },
    );
    const windowedNext: CalendarEvent | undefined = windowed[0];

    // Also the LIVE multi-layer path used by paging (single layer).
    const live: Array<CalendarEvent> = util.getMultiLayerEvents(
      {
        layers: [layer],
        calendarStartDate: askAt,
        calendarEndDate: OneUptimeDate.addRemoveDays(askAt, 5),
      },
      { getNumberOfEvents: 1 },
    );

    // eslint-disable-next-line no-console
    console.log("FULL:", full.map(fmt));
    // eslint-disable-next-line no-console
    console.log("Jan7 covered by (full):", jan7Cover && fmt(jan7Cover));
    // eslint-disable-next-line no-console
    console.log("WINDOWED next @Jan6 20:52:", windowedNext && fmt(windowedNext));
    // eslint-disable-next-line no-console
    console.log("LIVE next @Jan6 20:52:", live[0] && fmt(live[0]));

    // Ground truth: Jan 7 belongs to B.
    expect(jan7Cover?.title).toBe("B");

    // The windowed "next on-call" is the Jan 7 09:00-17:00 window ...
    expect(
      OneUptimeDate.getDateAsLocalFormattedString(windowedNext!.start),
    ).toContain("2025");
    expect(windowedNext!.start.getUTCHours()).toBe(9);
    expect(windowedNext!.start.getUTCDate()).toBe(7);
    // ... and MUST be B to match the calendar. It is A -> BUG.
    expect(windowedNext?.title).toBe("B");
    expect(live[0]?.title).toBe("B");
  });

  test("querying INSIDE Jan7 window correctly returns B (proves inconsistency)", () => {
    const layer: LayerProps = makeLayer();
    const util: LayerUtil = new LayerUtil();
    const askInside: Date = OneUptimeDate.fromString(
      "2025-01-07T10:00:00.000Z",
    );
    const windowed: Array<CalendarEvent> = util.getEvents(
      {
        ...layer,
        calendarStartDate: askInside,
        calendarEndDate: OneUptimeDate.addRemoveDays(askInside, 5),
      },
      { getNumberOfEvents: 1 },
    );
    // Asked inside the window, the same day resolves to B (correct).
    expect(windowed[0]?.title).toBe("B");
  });
});
