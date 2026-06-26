import DayOfWeek from "../../../Types/Day/DayOfWeek";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";

describe("RestrictionTimes", () => {
  describe("getDefaultRestrictonTimeData / getDefault", () => {
    test("default data has no restriction", () => {
      const data: ReturnType<
        typeof RestrictionTimes.getDefaultRestrictonTimeData
      > = RestrictionTimes.getDefaultRestrictonTimeData();

      expect(data.restictionType).toBe(RestrictionType.None);
      expect(data.dayRestrictionTimes).toBeNull();
      expect(data.weeklyRestrictionTimes).toEqual([]);
    });

    test("getDefault returns an instance with no restriction", () => {
      const restrictionTimes: RestrictionTimes = RestrictionTimes.getDefault();

      expect(restrictionTimes).toBeInstanceOf(RestrictionTimes);
      expect(restrictionTimes.restictionType).toBe(RestrictionType.None);
      expect(restrictionTimes.dayRestrictionTimes).toBeNull();
      expect(restrictionTimes.weeklyRestrictionTimes).toEqual([]);
    });

    test("getDefaultRestrictonTimeData returns a fresh object each call", () => {
      const first: ReturnType<
        typeof RestrictionTimes.getDefaultRestrictonTimeData
      > = RestrictionTimes.getDefaultRestrictonTimeData();
      const second: ReturnType<
        typeof RestrictionTimes.getDefaultRestrictonTimeData
      > = RestrictionTimes.getDefaultRestrictonTimeData();

      expect(first).not.toBe(second);
      expect(first.weeklyRestrictionTimes).not.toBe(
        second.weeklyRestrictionTimes,
      );

      // Mutating the first call's array must not leak into the second call.
      first.weeklyRestrictionTimes.push(
        RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
      );

      expect(first.weeklyRestrictionTimes.length).toBe(1);
      expect(second.weeklyRestrictionTimes).toEqual([]);
    });

    test("getDefault returns a new instance each call", () => {
      const first: RestrictionTimes = RestrictionTimes.getDefault();
      const second: RestrictionTimes = RestrictionTimes.getDefault();

      expect(first).not.toBe(second);

      // Mutating one instance must not affect the other.
      first.addDefaultWeeklyRestriction();

      expect(first.restictionType).toBe(RestrictionType.Weekly);
      expect(second.restictionType).toBe(RestrictionType.None);
      expect(second.weeklyRestrictionTimes).toEqual([]);
    });
  });

  describe("getDefaultWeeklyRestrictionTIme", () => {
    test("spans Sunday to Monday with date start/end times", () => {
      const weekly: WeeklyResctriction =
        RestrictionTimes.getDefaultWeeklyRestrictionTIme();

      expect(weekly.startDay).toBe(DayOfWeek.Sunday);
      expect(weekly.endDay).toBe(DayOfWeek.Monday);
      expect(weekly.startTime).toBeInstanceOf(Date);
      expect(weekly.endTime).toBeInstanceOf(Date);
    });
  });

  describe("addDefaultDailyRestriction", () => {
    test("sets a daily restriction with day times and clears weekly", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultDailyRestriction();

      expect(restrictionTimes.restictionType).toBe(RestrictionType.Daily);
      expect(restrictionTimes.dayRestrictionTimes).not.toBeNull();
      expect(restrictionTimes.dayRestrictionTimes!.startTime).toBeInstanceOf(
        Date,
      );
      expect(restrictionTimes.dayRestrictionTimes!.endTime).toBeInstanceOf(
        Date,
      );
      expect(restrictionTimes.weeklyRestrictionTimes).toEqual([]);
    });

    test("start time is at 00:00:00 and end time is at 01:00:00", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultDailyRestriction();

      const startTime: Date = restrictionTimes.dayRestrictionTimes!
        .startTime as Date;
      const endTime: Date = restrictionTimes.dayRestrictionTimes!
        .endTime as Date;

      expect(startTime.getHours()).toBe(0);
      expect(startTime.getMinutes()).toBe(0);
      expect(startTime.getSeconds()).toBe(0);

      expect(endTime.getHours()).toBe(1);
      expect(endTime.getMinutes()).toBe(0);
      expect(endTime.getSeconds()).toBe(0);
    });

    test("switching from weekly to daily clears the weekly restrictions", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultWeeklyRestriction();
      expect(restrictionTimes.weeklyRestrictionTimes.length).toBe(1);

      restrictionTimes.addDefaultDailyRestriction();

      expect(restrictionTimes.restictionType).toBe(RestrictionType.Daily);
      expect(restrictionTimes.weeklyRestrictionTimes).toEqual([]);
      expect(restrictionTimes.dayRestrictionTimes).not.toBeNull();
    });
  });

  describe("addDefaultWeeklyRestriction", () => {
    test("sets a weekly restriction and clears day times", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultWeeklyRestriction();

      expect(restrictionTimes.restictionType).toBe(RestrictionType.Weekly);
      expect(restrictionTimes.dayRestrictionTimes).toBeNull();
      expect(restrictionTimes.weeklyRestrictionTimes.length).toBe(1);
      expect(restrictionTimes.weeklyRestrictionTimes[0]!.startDay).toBe(
        DayOfWeek.Sunday,
      );
    });

    test("default weekly entry ends on Monday with date start/end times", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultWeeklyRestriction();

      const entry: WeeklyResctriction =
        restrictionTimes.weeklyRestrictionTimes[0]!;

      expect(entry.endDay).toBe(DayOfWeek.Monday);
      expect(entry.startTime).toBeInstanceOf(Date);
      expect(entry.endTime).toBeInstanceOf(Date);
    });

    test("switching from daily to weekly clears the day restriction", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultDailyRestriction();
      expect(restrictionTimes.dayRestrictionTimes).not.toBeNull();

      restrictionTimes.addDefaultWeeklyRestriction();

      expect(restrictionTimes.restictionType).toBe(RestrictionType.Weekly);
      expect(restrictionTimes.dayRestrictionTimes).toBeNull();
      expect(restrictionTimes.weeklyRestrictionTimes.length).toBe(1);
    });
  });

  describe("removeAllRestrictions", () => {
    test("resets a configured instance back to no restriction", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultWeeklyRestriction();

      restrictionTimes.removeAllRestrictions();

      expect(restrictionTimes.restictionType).toBe(RestrictionType.None);
      expect(restrictionTimes.dayRestrictionTimes).toBeNull();
      expect(restrictionTimes.weeklyRestrictionTimes).toEqual([]);
    });
  });

  describe("toJSON / fromJSON", () => {
    test("serializes with the RestrictionTimes object type", () => {
      const json: JSONObject = new RestrictionTimes().toJSON();

      expect(json["_type"]).toBe(ObjectType.RestrictionTimes);
      expect(json["value"]).toBeDefined();
    });

    test("round-trips the restriction type", () => {
      const original: RestrictionTimes = new RestrictionTimes();
      original.addDefaultWeeklyRestriction();

      const restored: RestrictionTimes = RestrictionTimes.fromJSON(
        original.toJSON(),
      );

      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored.restictionType).toBe(RestrictionType.Weekly);
    });

    test("round-trips a daily restriction preserving day times", () => {
      const original: RestrictionTimes = new RestrictionTimes();
      original.addDefaultDailyRestriction();

      const restored: RestrictionTimes = RestrictionTimes.fromJSON(
        original.toJSON(),
      );

      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored.restictionType).toBe(RestrictionType.Daily);
      expect(restored.dayRestrictionTimes).not.toBeNull();
      expect(restored.dayRestrictionTimes!.startTime).toBeDefined();
      expect(restored.dayRestrictionTimes!.endTime).toBeDefined();
    });

    test("falls back to an empty object when weeklyRestrictionTimes is missing", () => {
      /*
       * The source uses `(data["weeklyRestrictionTimes"] ...) || {}`, so when the
       * value object omits weeklyRestrictionTimes the fallback is an empty object
       * (NOT an empty array). This documents that quirky behavior precisely.
       */
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
        },
      });

      expect(restored.weeklyRestrictionTimes).toEqual({});
      expect(Array.isArray(restored.weeklyRestrictionTimes)).toBe(false);
    });

    test("preserves a provided weeklyRestrictionTimes array on fromJSON", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [],
        },
      });

      expect(restored.weeklyRestrictionTimes).toEqual([]);
      expect(Array.isArray(restored.weeklyRestrictionTimes)).toBe(true);
    });

    test("throws BadDataException when given null", () => {
      expect(() => {
        RestrictionTimes.fromJSON(null as unknown as JSONObject);
      }).toThrowError(BadDataException);
    });

    test("returns the same instance when given a RestrictionTimes", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();

      expect(RestrictionTimes.fromJSON(restrictionTimes)).toBe(
        restrictionTimes,
      );
    });

    test("throws BadDataException for a missing object type", () => {
      expect(() => {
        RestrictionTimes.fromJSON({});
      }).toThrowError(BadDataException);
    });

    test("throws BadDataException when value is missing", () => {
      expect(() => {
        RestrictionTimes.fromJSON({ _type: ObjectType.RestrictionTimes });
      }).toThrowError(BadDataException);
    });
  });

  describe("toDatabase / fromDatabase", () => {
    /*
     * toDatabase and fromDatabase are protected static overrides; reach them
     * through a typed accessor so the database (de)serialization branches are
     * exercised directly.
     */
    type DbAccessor = {
      toDatabase(value: unknown): JSONObject | null;
      fromDatabase(value: JSONObject): RestrictionTimes | null;
    };
    const accessor: DbAccessor = RestrictionTimes as unknown as DbAccessor;

    test("toDatabase serializes a RestrictionTimes instance to its JSON", () => {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.addDefaultWeeklyRestriction();

      const db: JSONObject | null = accessor.toDatabase(restrictionTimes);

      expect(db).not.toBeNull();
      expect(db!["_type"]).toBe(ObjectType.RestrictionTimes);
      expect(db).toEqual(restrictionTimes.toJSON());
    });

    test("toDatabase serializes a plain value object when not an instance", () => {
      const plain: JSONObject = {
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [],
        },
      };

      const db: JSONObject | null = accessor.toDatabase(plain);

      expect(db).not.toBeNull();
      expect(db!["_type"]).toBe(ObjectType.RestrictionTimes);
    });

    test("toDatabase returns null for a falsy value", () => {
      expect(accessor.toDatabase(null)).toBeNull();
      expect(accessor.toDatabase(undefined)).toBeNull();
    });

    test("fromDatabase rebuilds a RestrictionTimes from stored JSON", () => {
      const original: RestrictionTimes = new RestrictionTimes();
      original.addDefaultWeeklyRestriction();

      const restored: RestrictionTimes | null = accessor.fromDatabase(
        original.toJSON(),
      );

      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored!.restictionType).toBe(RestrictionType.Weekly);
    });

    test("fromDatabase returns null for a falsy value", () => {
      expect(accessor.fromDatabase(null as unknown as JSONObject)).toBeNull();
    });
  });
});
