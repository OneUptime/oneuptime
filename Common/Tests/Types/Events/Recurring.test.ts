import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import { ObjectType } from "../../../Types/JSON";
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
  });
});
