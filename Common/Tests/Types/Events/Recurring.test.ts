import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";

describe("Recurring", () => {
  const baseDate: Date = OneUptimeDate.fromString("2020-01-01T00:00:00.000Z");

  const makeRecurring: (
    intervalType: EventInterval,
    intervalCount: number,
  ) => Recurring = (
    intervalType: EventInterval,
    intervalCount: number,
  ): Recurring => {
    const recurring: Recurring = new Recurring();
    recurring.intervalType = intervalType;
    recurring.intervalCount = new PositiveNumber(intervalCount);
    return recurring;
  };

  describe("getDefaultRotationData / getDefault", () => {
    test("defaults to every 1 day", () => {
      const data: ReturnType<typeof Recurring.getDefaultRotationData> =
        Recurring.getDefaultRotationData();

      expect(data.intervalType).toBe(EventInterval.Day);
      expect(data.intervalCount.toNumber()).toBe(1);
    });

    test("getDefault returns a Recurring instance with the defaults", () => {
      const recurring: Recurring = Recurring.getDefault();

      expect(recurring).toBeInstanceOf(Recurring);
      expect(recurring.intervalType).toBe(EventInterval.Day);
      expect(recurring.intervalCount.toNumber()).toBe(1);
    });
  });

  describe("getNextDateInterval", () => {
    test("adds hours for an hourly interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Hour, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveHours(baseDate, 2).getTime(),
      );
    });

    test("adds days for a daily interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Day, 3),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveDays(baseDate, 3).getTime(),
      );
    });

    test("adds seven days per week for a weekly interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Week, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveDays(baseDate, 14).getTime(),
      );
    });

    test("adds months for a monthly interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Month, 1),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveMonths(baseDate, 1).getTime(),
      );
    });

    test("adds years for a yearly interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Year, 1),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveYears(baseDate, 1).getTime(),
      );
    });

    test("moves backwards when getDateInThePast is true", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Day, 1),
        true,
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveDays(baseDate, -1).getTime(),
      );
    });

    test("adds multiple hours when intervalCount is greater than one", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Hour, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveHours(baseDate, 2).getTime(),
      );
    });

    test("adds multiple days when intervalCount is greater than one", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Day, 3),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveDays(baseDate, 3).getTime(),
      );
    });

    test("adds fourteen days for a two-week interval", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Week, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveDays(baseDate, 14).getTime(),
      );
    });

    test("adds multiple months when intervalCount is greater than one", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Month, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveMonths(baseDate, 2).getTime(),
      );
    });

    test("adds multiple years when intervalCount is greater than one", () => {
      const next: Date = Recurring.getNextDateInterval(
        baseDate,
        makeRecurring(EventInterval.Year, 2),
      );

      expect(next.getTime()).toBe(
        OneUptimeDate.addRemoveYears(baseDate, 2).getTime(),
      );
    });

    test("throws BadDataException for an unknown interval type", () => {
      const recurring: Recurring = makeRecurring(EventInterval.Day, 1);
      recurring.intervalType = "Decade" as unknown as EventInterval;

      expect(() => {
        Recurring.getNextDateInterval(baseDate, recurring);
      }).toThrowError(BadDataException);
    });
  });

  describe("getNextDate", () => {
    test("returns a future start date unchanged", () => {
      const futureDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        5,
      );

      const next: Date = Recurring.getNextDate(
        futureDate,
        makeRecurring(EventInterval.Day, 1),
      );

      expect(next.getTime()).toBe(futureDate.getTime());
    });

    test("advances a past start date to the future", () => {
      const pastDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        -10,
      );

      const next: Date = Recurring.getNextDate(
        pastDate,
        makeRecurring(EventInterval.Day, 1),
      );

      expect(next.getTime()).toBeGreaterThan(pastDate.getTime());
      expect(next.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.getCurrentDate().getTime() - 1000,
      );
    });

    test("advances a past start date by whole hourly intervals", () => {
      const intervalMillis: number = 2 * 3600000;
      const pastDate: Date = new Date(
        OneUptimeDate.getCurrentDate().getTime() - intervalMillis * 5,
      );

      const next: Date = Recurring.getNextDate(
        pastDate,
        makeRecurring(EventInterval.Hour, 2),
      );

      expect(next.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.getCurrentDate().getTime() - 1000,
      );
      expect((next.getTime() - pastDate.getTime()) % intervalMillis).toBe(0);
    });

    test("advances a past start date by whole weekly intervals", () => {
      const intervalMillis: number = 604800000;
      const pastDate: Date = new Date(
        OneUptimeDate.getCurrentDate().getTime() - intervalMillis * 3,
      );

      const next: Date = Recurring.getNextDate(
        pastDate,
        makeRecurring(EventInterval.Week, 1),
      );

      expect(next.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.getCurrentDate().getTime() - 1000,
      );
      expect((next.getTime() - pastDate.getTime()) % intervalMillis).toBe(0);
    });

    test("advances a past start date by whole monthly intervals", () => {
      const intervalMillis: number = 2629800000;
      const pastDate: Date = new Date(
        OneUptimeDate.getCurrentDate().getTime() - intervalMillis * 4,
      );

      const next: Date = Recurring.getNextDate(
        pastDate,
        makeRecurring(EventInterval.Month, 1),
      );

      expect(next.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.getCurrentDate().getTime() - 1000,
      );
      expect((next.getTime() - pastDate.getTime()) % intervalMillis).toBe(0);
    });

    test("advances a past start date by whole yearly intervals", () => {
      const intervalMillis: number = 31557600000;
      const pastDate: Date = new Date(
        OneUptimeDate.getCurrentDate().getTime() - intervalMillis * 2,
      );

      const next: Date = Recurring.getNextDate(
        pastDate,
        makeRecurring(EventInterval.Year, 1),
      );

      expect(next.getTime()).toBeGreaterThanOrEqual(
        OneUptimeDate.getCurrentDate().getTime() - 1000,
      );
      expect((next.getTime() - pastDate.getTime()) % intervalMillis).toBe(0);
    });

    test("leaves a start date equal to now unchanged (zero intervals to add)", () => {
      const now: Date = OneUptimeDate.getCurrentDate();

      const next: Date = Recurring.getNextDate(
        now,
        makeRecurring(EventInterval.Day, 1),
      );

      // The <= branch is entered, diff is 0, so Math.ceil(0) === 0 intervals are added.
      expect(next.getTime()).toBe(now.getTime());
    });

    test("throws BadDataException for an unknown interval type when the start date is in the past", () => {
      const pastDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        -10,
      );

      const recurring: Recurring = makeRecurring(EventInterval.Day, 1);
      recurring.intervalType = "Fortnight" as unknown as EventInterval;

      expect(() => {
        Recurring.getNextDate(pastDate, recurring);
      }).toThrowError(BadDataException);
    });

    test("does not reach the interval switch for a future start date even with an unknown interval type", () => {
      const futureDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        5,
      );

      const recurring: Recurring = makeRecurring(EventInterval.Day, 1);
      recurring.intervalType = "Fortnight" as unknown as EventInterval;

      const next: Date = Recurring.getNextDate(futureDate, recurring);

      expect(next.getTime()).toBe(futureDate.getTime());
    });
  });

  describe("toString", () => {
    test("formats as count and interval type", () => {
      expect(makeRecurring(EventInterval.Day, 1).toString()).toBe("1 Day");
      expect(makeRecurring(EventInterval.Week, 2).toString()).toBe("2 Week");
    });
  });

  describe("toJSON / fromJSON", () => {
    test("serializes with the Recurring object type", () => {
      const json: ReturnType<Recurring["toJSON"]> = makeRecurring(
        EventInterval.Week,
        2,
      ).toJSON();

      expect(json["_type"]).toBe(ObjectType.Recurring);
      expect(json["value"]).toBeDefined();
    });

    test("round-trips interval type and count", () => {
      const restored: Recurring = Recurring.fromJSON(
        makeRecurring(EventInterval.Month, 4).toJSON(),
      );

      expect(restored).toBeInstanceOf(Recurring);
      expect(restored.intervalType).toBe(EventInterval.Month);
      expect(restored.intervalCount.toNumber()).toBe(4);
    });

    test("returns the same instance when given a Recurring", () => {
      const recurring: Recurring = new Recurring();

      expect(Recurring.fromJSON(recurring)).toBe(recurring);
    });

    test("throws BadDataException for a missing object type", () => {
      expect(() => {
        Recurring.fromJSON({});
      }).toThrowError(BadDataException);
    });

    test("throws BadDataException when value is missing", () => {
      expect(() => {
        Recurring.fromJSON({ _type: ObjectType.Recurring });
      }).toThrowError(BadDataException);
    });

    test("falls back to a daily interval when intervalType is missing", () => {
      const restored: Recurring = Recurring.fromJSON({
        _type: ObjectType.Recurring,
        value: {
          intervalCount: new PositiveNumber(5).toJSON(),
        },
      });

      expect(restored.intervalType).toBe(EventInterval.Day);
      expect(restored.intervalCount.toNumber()).toBe(5);
    });

    test("falls back to a count of one when intervalCount is missing", () => {
      const restored: Recurring = Recurring.fromJSON({
        _type: ObjectType.Recurring,
        value: {
          intervalType: EventInterval.Week,
        },
      });

      expect(restored.intervalType).toBe(EventInterval.Week);
      expect(restored.intervalCount.toNumber()).toBe(1);
    });

    test("applies both defaults when value is an empty object", () => {
      const restored: Recurring = Recurring.fromJSON({
        _type: ObjectType.Recurring,
        value: {},
      });

      expect(restored.intervalType).toBe(EventInterval.Day);
      expect(restored.intervalCount.toNumber()).toBe(1);
    });
  });

  describe("getDatabaseTransformer (toDatabase / fromDatabase)", () => {
    test("to/from round-trips a single Recurring instance", () => {
      const transformer: ReturnType<typeof Recurring.getDatabaseTransformer> =
        Recurring.getDatabaseTransformer();

      const stored: unknown = transformer.to(
        makeRecurring(EventInterval.Month, 4),
      );

      expect((stored as { _type: string })["_type"]).toBe(ObjectType.Recurring);

      const restored: Recurring = transformer.from(stored) as Recurring;

      expect(restored).toBeInstanceOf(Recurring);
      expect(restored.intervalType).toBe(EventInterval.Month);
      expect(restored.intervalCount.toNumber()).toBe(4);
    });

    test("to/from round-trips an array of Recurrings", () => {
      const transformer: ReturnType<typeof Recurring.getDatabaseTransformer> =
        Recurring.getDatabaseTransformer();

      const stored: unknown = transformer.to([
        makeRecurring(EventInterval.Day, 1),
        makeRecurring(EventInterval.Year, 3),
      ] as unknown as Recurring);

      expect(Array.isArray(stored)).toBe(true);

      const restored: Array<Recurring> = transformer.from(
        stored,
      ) as Array<Recurring>;

      expect(restored.length).toBe(2);
      expect(restored[0]!.intervalType).toBe(EventInterval.Day);
      expect(restored[1]!.intervalType).toBe(EventInterval.Year);
      expect(restored[1]!.intervalCount.toNumber()).toBe(3);
    });

    test("to returns null and from returns null for nullish values", () => {
      const transformer: ReturnType<typeof Recurring.getDatabaseTransformer> =
        Recurring.getDatabaseTransformer();

      expect(transformer.to(null as unknown as Recurring)).toBeNull();
      expect(transformer.from(null as unknown as JSONObject)).toBeNull();
    });
  });

  describe("toJSONArray / fromJSONArray", () => {
    test("round-trips an array of recurrings", () => {
      const recurrings: Array<Recurring> = [
        makeRecurring(EventInterval.Day, 1),
        makeRecurring(EventInterval.Year, 3),
      ];

      const restored: Array<Recurring> = Recurring.fromJSONArray(
        Recurring.toJSONArray(recurrings),
      );

      expect(restored.length).toBe(2);
      expect(restored[0]!.intervalType).toBe(EventInterval.Day);
      expect(restored[0]!.intervalCount.toNumber()).toBe(1);
      expect(restored[1]!.intervalType).toBe(EventInterval.Year);
      expect(restored[1]!.intervalCount.toNumber()).toBe(3);
    });

    test("round-trips an empty array to an empty array", () => {
      const json: ReturnType<typeof Recurring.toJSONArray> =
        Recurring.toJSONArray([]);

      expect(json).toEqual([]);

      const restored: Array<Recurring> = Recurring.fromJSONArray(json);

      expect(restored).toEqual([]);
      expect(restored.length).toBe(0);
    });
  });
});
