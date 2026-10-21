import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import {
  DEFAULT_LAYER_ROTATION_INTERVAL_COUNT,
  DEFAULT_LAYER_ROTATION_INTERVAL_TYPE,
  buildNewScheduleLayer,
  getDefaultLayerRotation,
  getFirstHandOffTime,
  getLayerName,
  getNewLayerName,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test } from "@jest/globals";

/*
 * A NEW LAYER OF AN ON-CALL SCHEDULE, AS IT STARTS.
 *
 * One builder makes every layer OneUptime adds on someone's behalf: the
 * first layer of a schedule created with "Who takes turns?" (on the server)
 * and a layer added with Add Layer (in the dashboard). A new layer is on
 * call from now, hands off once a week, first one rotation after it starts
 * at the same time of day in the schedule's time zone, and is on call
 * around the clock.
 */

const SCHEDULE_ID: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000002",
);

function rotationOf(intervalType: EventInterval, count: number): Recurring {
  const rotation: Recurring = new Recurring();
  rotation.intervalType = intervalType;
  rotation.intervalCount = new PositiveNumber(count);
  return rotation;
}

describe("the default rotation", () => {
  test("is a week: each person is on call for a week", () => {
    expect(DEFAULT_LAYER_ROTATION_INTERVAL_TYPE).toBe(EventInterval.Week);
    expect(DEFAULT_LAYER_ROTATION_INTERVAL_COUNT).toBe(1);

    const rotation: Recurring = getDefaultLayerRotation();

    expect(rotation).toBeInstanceOf(Recurring);
    expect(rotation.intervalType).toBe(EventInterval.Week);
    expect(rotation.intervalCount.toNumber()).toBe(1);
  });

  test("is a fresh rotation every time: changing one changes no other", () => {
    const first: Recurring = getDefaultLayerRotation();
    first.intervalType = EventInterval.Day;

    expect(getDefaultLayerRotation().intervalType).toBe(EventInterval.Week);
    expect(getDefaultLayerRotation()).not.toBe(getDefaultLayerRotation());
  });

  test("leaves the API's own default alone: a layer created without a rotation still hands off daily", () => {
    /*
     * The column default is the API contract (and the database's DEFAULT):
     * only the layers the product adds start weekly.
     */
    expect(Recurring.getDefault().intervalType).toBe(EventInterval.Day);
    expect(Recurring.getDefault().intervalCount.toNumber()).toBe(1);
  });
});

describe("layer names", () => {
  test("are called after their place", () => {
    expect(getLayerName(1)).toBe("Layer 1");
    expect(getLayerName(12)).toBe("Layer 12");
  });

  test("a new layer is named after its order when that name is free", () => {
    expect(getNewLayerName({ order: 1, existingNames: [] })).toBe("Layer 1");
    expect(
      getNewLayerName({ order: 3, existingNames: ["Layer 1", "Layer 2"] }),
    ).toBe("Layer 3");
  });

  test("skips names still taken after a layer in the middle was deleted", () => {
    // Layers 1, 2, 3; Layer 2 deleted: orders become 1 and 2, names stay.
    expect(
      getNewLayerName({ order: 3, existingNames: ["Layer 1", "Layer 3"] }),
    ).toBe("Layer 4");
    expect(
      getNewLayerName({
        order: 2,
        existingNames: ["Layer 2", "Layer 3", "Layer 5"],
      }),
    ).toBe("Layer 4");
  });

  test("names the user chose take nothing", () => {
    expect(
      getNewLayerName({
        order: 3,
        existingNames: ["Weekdays", "Weekends", "layer 3", "Layer 3 "],
      }),
    ).toBe("Layer 3");
  });

  test.each([0, -2, Number.NaN, 2.7])(
    "an order of %p still gives a name from Layer 1 up",
    (order: number) => {
      const name: string = getNewLayerName({ order, existingNames: [] });

      expect(name).toMatch(/^Layer [1-9]\d*$/);
      expect(name).toBe(order === 2.7 ? "Layer 2" : "Layer 1");
    },
  );
});

describe("the first hand-off", () => {
  test("is one week after the start for a weekly rotation", () => {
    const startsAt: Date = new Date("2026-06-10T12:00:00.000Z");

    expect(
      getFirstHandOffTime({
        startsAt,
        rotation: getDefaultLayerRotation(),
        timezone: "UTC",
      }).toISOString(),
    ).toBe("2026-06-17T12:00:00.000Z");
  });

  test.each([
    [EventInterval.Day, 1, "2026-06-11T12:00:00.000Z"],
    [EventInterval.Day, 3, "2026-06-13T12:00:00.000Z"],
    [EventInterval.Week, 2, "2026-06-24T12:00:00.000Z"],
    [EventInterval.Month, 1, "2026-07-10T12:00:00.000Z"],
    [EventInterval.Year, 1, "2027-06-10T12:00:00.000Z"],
    [EventInterval.Hour, 12, "2026-06-11T00:00:00.000Z"],
  ] as Array<[EventInterval, number, string]>)(
    "every %s x%i: %s",
    (intervalType: EventInterval, count: number, expected: string) => {
      expect(
        getFirstHandOffTime({
          startsAt: new Date("2026-06-10T12:00:00.000Z"),
          rotation: rotationOf(intervalType, count),
          timezone: "UTC",
        }).toISOString(),
      ).toBe(expected);
    },
  );

  test("keeps the time of day in the schedule's time zone across a daylight saving change", () => {
    // Thursday 29 October 2026, 14:30 in New York (EDT, UTC-4).
    const startsAt: Date = new Date("2026-10-29T18:30:00.000Z");

    /*
     * New York leaves daylight saving time on 1 November: the next Thursday
     * at 14:30 is 19:30 UTC, not 18:30.
     */
    expect(
      getFirstHandOffTime({
        startsAt,
        rotation: getDefaultLayerRotation(),
        timezone: "America/New_York",
      }).toISOString(),
    ).toBe("2026-11-05T19:30:00.000Z");

    // Berlin leaves it on 25 October: Thursday 09:00 stays 09:00.
    expect(
      getFirstHandOffTime({
        startsAt: new Date("2026-10-22T07:00:00.000Z"),
        rotation: getDefaultLayerRotation(),
        timezone: "Europe/Berlin",
      }).toISOString(),
    ).toBe("2026-10-29T08:00:00.000Z");
  });

  test("counts an hourly rotation in absolute hours, as the layer engine does", () => {
    // 01:30 EST on 8 March 2026, half an hour before clocks go forward.
    expect(
      getFirstHandOffTime({
        startsAt: new Date("2026-03-08T06:30:00.000Z"),
        rotation: rotationOf(EventInterval.Hour, 1),
        timezone: "America/New_York",
      }).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  test("without a time zone, counts in the local one", () => {
    // No daylight saving change anywhere near this week.
    expect(
      getFirstHandOffTime({
        startsAt: new Date("2026-06-10T12:00:00.000Z"),
        rotation: getDefaultLayerRotation(),
      }).toISOString(),
    ).toBe("2026-06-17T12:00:00.000Z");
  });

  test("reads a rotation as JSON too", () => {
    expect(
      getFirstHandOffTime({
        startsAt: new Date("2026-06-10T12:00:00.000Z"),
        rotation: rotationOf(EventInterval.Day, 2).toJSON() as never,
        timezone: "UTC",
      }).toISOString(),
    ).toBe("2026-06-12T12:00:00.000Z");
  });
});

describe("a new layer", () => {
  const STARTS_AT: Date = new Date("2026-06-10T12:00:00.000Z");

  function build(
    extra: Partial<Parameters<typeof buildNewScheduleLayer>[0]> = {},
  ): OnCallDutyPolicyScheduleLayer {
    return buildNewScheduleLayer({
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      projectId: PROJECT_ID,
      name: "Layer 1",
      startsAt: STARTS_AT,
      timezone: "UTC",
      ...extra,
    });
  }

  test("belongs to the schedule and the project, under the name given", () => {
    const layer: OnCallDutyPolicyScheduleLayer = build();

    expect(layer).toBeInstanceOf(OnCallDutyPolicyScheduleLayer);
    expect(layer.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(layer.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(layer.name).toBe("Layer 1");
    expect(layer.description).toBeUndefined();
  });

  test("hands off weekly, first a week after it starts, and is on call around the clock", () => {
    const layer: OnCallDutyPolicyScheduleLayer = build();

    expect(layer.startsAt?.toISOString()).toBe(STARTS_AT.toISOString());
    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.rotation?.intervalCount.toNumber()).toBe(1);
    expect(layer.handOffTime?.toISOString()).toBe("2026-06-17T12:00:00.000Z");

    expect(layer.restrictionTimes).toBeInstanceOf(RestrictionTimes);
    expect(layer.restrictionTimes?.restictionType).toBe(RestrictionType.None);
    expect(layer.restrictionTimes?.toJSON()).toEqual(
      RestrictionTimes.getDefault().toJSON(),
    );
  });

  test("hands off on the rotation it is given, first one rotation after it starts", () => {
    const layer: OnCallDutyPolicyScheduleLayer = build({
      rotation: rotationOf(EventInterval.Week, 2),
    });

    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.rotation?.intervalCount.toNumber()).toBe(2);
    expect(layer.handOffTime?.toISOString()).toBe("2026-06-24T12:00:00.000Z");
  });

  test("keeps a rotation of its own: the caller's is neither shared nor changed", () => {
    const rotation: Recurring = rotationOf(EventInterval.Day, 1);
    const layer: OnCallDutyPolicyScheduleLayer = build({ rotation });

    expect(layer.rotation).not.toBe(rotation);

    rotation.intervalType = EventInterval.Month;

    expect(layer.rotation?.intervalType).toBe(EventInterval.Day);
  });

  test("hands off in the schedule's time zone", () => {
    const layer: OnCallDutyPolicyScheduleLayer = build({
      startsAt: new Date("2026-10-29T18:30:00.000Z"),
      timezone: "America/New_York",
    });

    expect(layer.handOffTime?.toISOString()).toBe("2026-11-05T19:30:00.000Z");
  });

  test("starts now unless told otherwise", () => {
    const before: number = Date.now();

    const layer: OnCallDutyPolicyScheduleLayer = buildNewScheduleLayer({
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      projectId: PROJECT_ID,
      name: "Layer 1",
    });

    const after: number = Date.now();
    const startsAt: number = layer.startsAt!.getTime();

    expect(startsAt).toBeGreaterThanOrEqual(before);
    expect(startsAt).toBeLessThanOrEqual(after);

    // A week later, give or take an hour for a daylight saving change.
    const handOffIn: number = layer.handOffTime!.getTime() - startsAt;

    expect(Math.abs(handOffIn - 7 * 24 * 3600 * 1000)).toBeLessThanOrEqual(
      3600 * 1000,
    );
  });

  test("leaves the order to the layer service unless one is given", () => {
    expect(build().order).toBeUndefined();
    expect(build({ order: 3 }).order).toBe(3);
  });

  test("gets restriction times of its own", () => {
    expect(build().restrictionTimes).not.toBe(build().restrictionTimes);
  });
});
