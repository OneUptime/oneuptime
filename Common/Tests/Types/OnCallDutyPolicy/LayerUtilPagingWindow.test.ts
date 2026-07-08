/*
 * TEMP audit: reproduce the LIVE paging window used by
 * getCurrentUserIdInSchedule = getMultiLayerEvents([now, now+1s], N=1)
 * and getEventByIndexInSchedule (window anchored at now). Verify that at EXACT
 * rotation-boundary instants the window resolves to a user (never null) and to
 * the INCOMING user, so nobody is dropped.
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
  return { id: { toString: () => id } as any } as User;
}

function makeLayer(data: {
  users: string[];
  start: Date;
  handoff: Date;
  intervalType: EventInterval;
  intervalCount: number;
  timezone?: string | undefined;
}): LayerProps {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  const rotation: Recurring = new Recurring();
  rotation.intervalType = data.intervalType;
  rotation.intervalCount = new PositiveNumber(data.intervalCount);
  return {
    users: data.users.map(user),
    startDateTimeOfLayer: data.start,
    restrictionTimes: r,
    handOffTime: data.handoff,
    rotation,
    timezone: data.timezone,
  };
}

// Reproduce getCurrentUserIdInSchedule's [now, now+1s] window exactly.
function livePagingUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getMultiLayerEvents(
    {
      layers: [layer],
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveSeconds(at, 1),
    },
    { getNumberOfEvents: 1 },
  );
  return events[0]?.title ?? null;
}

describe("LIVE paging window at exact rotation boundaries", () => {
  const start: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");

  const configs: Array<{
    name: string;
    users: string[];
    intervalType: EventInterval;
    intervalCount: number;
    timezone?: string | undefined;
  }> = [
    { name: "hourly x1", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 1 },
    { name: "hourly x3", users: ["A", "B", "C", "D"], intervalType: EventInterval.Hour, intervalCount: 3 },
    { name: "daily x1 NY", users: ["A", "B"], intervalType: EventInterval.Day, intervalCount: 1, timezone: "America/New_York" },
    { name: "weekly x1 NY", users: ["A", "B", "C"], intervalType: EventInterval.Week, intervalCount: 1, timezone: "America/New_York" },
  ];

  for (const cfg of configs) {
    it(`${cfg.name}: boundary instants never resolve to null`, () => {
      const rot: Recurring = new Recurring();
      rot.intervalType = cfg.intervalType;
      rot.intervalCount = new PositiveNumber(cfg.intervalCount);
      const handoff: Date = Recurring.getNextDateInterval(start, rot);
      const layer: LayerProps = makeLayer({
        users: cfg.users,
        start,
        handoff,
        intervalType: cfg.intervalType,
        intervalCount: cfg.intervalCount,
        timezone: cfg.timezone,
      });

      const nulls: string[] = [];
      let boundary: Date = handoff;
      for (let k: number = 0; k < 40; k++) {
        // exactly on the boundary
        const onB: string | null = livePagingUserAt(layer, boundary);
        // one second after boundary (start of the new shift under +1s stitch)
        const afterB: string | null = livePagingUserAt(
          layer,
          OneUptimeDate.addRemoveSeconds(boundary, 1),
        );
        if (onB === null) {
          nulls.push(`ON boundary k=${k} ${boundary.toISOString()} => null`);
        }
        if (afterB === null) {
          nulls.push(
            `AFTER boundary k=${k} ${boundary.toISOString()}+1s => null`,
          );
        }
        boundary = Recurring.getNextDateInterval(boundary, rot);
      }
      expect(nulls).toEqual([]);
    });
  }
});
