import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";

function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}
function rotation(it: EventInterval, ic: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: { intervalType: it, intervalCount: { _type: "PositiveNumber", value: ic } },
  } as any);
}
function daily(startH: number, endH: number): RestrictionTimes {
  const r = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({ hours: startH, minutes: 0, seconds: 0 }),
    endTime: OneUptimeDate.getDateWithCustomTime({ hours: endH, minutes: 0, seconds: 0 }),
  };
  return r;
}
function dump(name: string, layer: Omit<LayerProps, "timezone">, days: number): void {
  const util = new LayerUtil();
  const bigEnd = OneUptimeDate.addRemoveDays(layer.startDateTimeOfLayer, days);
  const full = util.getEvents({ ...layer, calendarStartDate: layer.startDateTimeOfLayer, calendarEndDate: bigEnd });
  // eslint-disable-next-line no-console
  console.log(`\n=== ${name} ===`);
  for (const e of full) {
    // eslint-disable-next-line no-console
    console.log(`  ${e.title}  ${e.start.toISOString()} -> ${e.end.toISOString()}`);
  }
}

describe("ZZDebug2", () => {
  test("week rotation + daily 9-17, handoff Monday 10:00", () => {
    const layerStart = new Date(2026, 0, 5, 0, 0, 0); // Mon Jan 5
    const handOff = OneUptimeDate.addRemoveHours(layerStart, 10); // Mon 10:00
    dump(
      "WEEK x1, daily 9-17, handoff 10:00 (expect A on-call 9-17 EVERY day for a week)",
      {
        users: [user("A"), user("B")],
        startDateTimeOfLayer: layerStart,
        handOffTime: handOff,
        restrictionTimes: daily(9, 17),
        rotation: rotation(EventInterval.Week, 1),
      },
      16,
    );
    expect(true).toBe(true);
  });

  test("day x2 + daily 9-17, handoff 10:00", () => {
    const layerStart = new Date(2026, 0, 5, 0, 0, 0);
    const handOff = OneUptimeDate.addRemoveHours(layerStart, 10);
    dump(
      "DAY x2, daily 9-17, handoff 10:00 (expect coverage on BOTH days of each 2-day period)",
      {
        users: [user("A"), user("B")],
        startDateTimeOfLayer: layerStart,
        handOffTime: handOff,
        restrictionTimes: daily(9, 17),
        rotation: rotation(EventInterval.Day, 2),
      },
      10,
    );
    expect(true).toBe(true);
  });

  test("control: day x2 + daily 9-17, handoff 08:00 (before restriction start)", () => {
    const layerStart = new Date(2026, 0, 5, 0, 0, 0);
    const handOff = OneUptimeDate.addRemoveHours(layerStart, 8);
    dump(
      "DAY x2, daily 9-17, handoff 08:00 (control - should cover both days)",
      {
        users: [user("A"), user("B")],
        startDateTimeOfLayer: layerStart,
        handOffTime: handOff,
        restrictionTimes: daily(9, 17),
        rotation: rotation(EventInterval.Day, 2),
      },
      10,
    );
    expect(true).toBe(true);
  });
});
