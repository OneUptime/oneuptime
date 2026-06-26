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
});
