import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";

function u(id: string): User {
  return { id: { toString: () => id } } as unknown as User;
}
function d(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}
function rot(t: EventInterval, c: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: { intervalType: t, intervalCount: { _type: "PositiveNumber", value: c } },
  } as any);
}

test("debug F5 events", () => {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: d("2026-03-05T14:00:00.000Z"),
    endTime: d("2026-03-05T22:00:00.000Z"),
  };
  const layer: LayerProps = {
    users: [u("A")],
    startDateTimeOfLayer: d("2026-03-05T00:00:00.000Z"),
    handOffTime: d("2026-03-05T00:00:00.000Z"),
    restrictionTimes: r,
    rotation: rot(EventInterval.Week, 1),
    timezone: "America/New_York",
  };
  const events: Array<CalendarEvent> = new LayerUtil().getEvents({
    ...layer,
    calendarStartDate: d("2026-03-05T00:00:00.000Z"),
    calendarEndDate: d("2026-03-12T00:00:00.000Z"),
  });
  // eslint-disable-next-line no-console
  console.log(
    "EVENTS:\n" +
      events
        .map((e: CalendarEvent) => {
          return `${e.title} ${new Date(e.start).toISOString()} -> ${new Date(e.end).toISOString()}`;
        })
        .join("\n"),
  );
  expect(true).toBe(true);
});
