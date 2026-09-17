/**
 * EXHAUSTIVE suite for the RestrictionTimes type.
 *
 * Covers: getDefault / getDefaultRestrictonTimeData (+ per-call independence),
 * getDefaultWeeklyRestrictionTIme, addDefaultDailyRestriction /
 * addDefaultWeeklyRestriction / removeAllRestrictions state machine,
 * toJSON structural correctness (DateTime wrappers, order preservation),
 * toJSON/fromJSON round-trips for None / Daily / Weekly incl. MULTIPLE weekly
 * windows (raw round-trip vs the realistic deserialize-at-the-model-boundary
 * round-trip that restores real Date instances), the F20 fix (absent
 * weeklyRestrictionTimes yields an ARRAY, never {}, and iterating it never
 * throws), fromJSON error handling, and toDatabase/fromDatabase.
 *
 * These lock in the CURRENT (fixed) behavior. A couple of residual quirks are
 * asserted as "current behavior" and reported separately.
 */
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import RestrictionTimes, {
  RestrictionTimesData,
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";

// ---- helpers ---------------------------------------------------------------

function valueOf(json: JSONObject): JSONObject {
  return json["value"] as JSONObject;
}

// A raw round-trip: toJSON then straight back through fromJSON (no deserialize).
function roundTripRaw(r: RestrictionTimes): RestrictionTimes {
  return RestrictionTimes.fromJSON(r.toJSON());
}

/*
 * The realistic model-boundary round-trip: serialize -> persist as pure JSON
 * (JSONB) -> deserialize (restores Date instances from the DateTime wrappers)
 * -> fromJSON. This is what actually happens loading a layer from the database.
 */
function roundTripThroughDb(r: RestrictionTimes): RestrictionTimes {
  const persisted: JSONObject = JSON.parse(
    JSON.stringify(r.toJSON()),
  ) as JSONObject;
  const deserialized: JSONObject = JSONFunctions.deserialize(persisted);
  return RestrictionTimes.fromJSON(deserialized);
}

function weeklyWindow(data: {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startIso: string;
  endIso: string;
}): WeeklyResctriction {
  return {
    startDay: data.startDay,
    endDay: data.endDay,
    startTime: OneUptimeDate.fromString(data.startIso),
    endTime: OneUptimeDate.fromString(data.endIso),
  };
}

// A wrapper object as produced by JSONFunctions.serialize for a Date value.
function expectDateTimeWrapper(v: unknown): void {
  const wrapper: JSONObject = v as JSONObject;
  expect(wrapper["_type"]).toBe(ObjectType.DateTime);
  expect(typeof wrapper["value"]).toBe("string");
}

// Typed accessor for the protected static (de)serialization overrides.
type DbAccessor = {
  toDatabase(value: unknown): JSONObject | null;
  fromDatabase(value: JSONObject | null): RestrictionTimes | null;
};
const dbAccessor: DbAccessor = RestrictionTimes as unknown as DbAccessor;

// ---- tests -----------------------------------------------------------------

describe("RestrictionTimes (exhaustive)", () => {
  describe("getDefaultRestrictonTimeData", () => {
    test("shape is None / null / empty-array", () => {
      const data: RestrictionTimesData =
        RestrictionTimes.getDefaultRestrictonTimeData();

      expect(data.restictionType).toBe(RestrictionType.None);
      expect(data.dayRestrictionTimes).toBeNull();
      expect(Array.isArray(data.weeklyRestrictionTimes)).toBe(true);
      expect(data.weeklyRestrictionTimes).toEqual([]);
    });

    test("returns an independent object graph on every call", () => {
      const a: RestrictionTimesData =
        RestrictionTimes.getDefaultRestrictonTimeData();
      const b: RestrictionTimesData =
        RestrictionTimes.getDefaultRestrictonTimeData();

      expect(a).not.toBe(b);
      expect(a.weeklyRestrictionTimes).not.toBe(b.weeklyRestrictionTimes);

      a.weeklyRestrictionTimes.push(
        RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
      );
      a.restictionType = RestrictionType.Daily;

      expect(b.weeklyRestrictionTimes).toEqual([]);
      expect(b.restictionType).toBe(RestrictionType.None);
    });
  });

  describe("getDefault / constructor", () => {
    test("getDefault yields an unrestricted instance", () => {
      const r: RestrictionTimes = RestrictionTimes.getDefault();

      expect(r).toBeInstanceOf(RestrictionTimes);
      expect(r.restictionType).toBe(RestrictionType.None);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });

    test("new RestrictionTimes() matches getDefault state", () => {
      const ctor: RestrictionTimes = new RestrictionTimes();
      const def: RestrictionTimes = RestrictionTimes.getDefault();

      expect(ctor.restictionType).toBe(def.restictionType);
      expect(ctor.dayRestrictionTimes).toBe(def.dayRestrictionTimes);
      expect(ctor.weeklyRestrictionTimes).toEqual(def.weeklyRestrictionTimes);
    });

    test("each instance owns independent internal data", () => {
      const a: RestrictionTimes = RestrictionTimes.getDefault();
      const b: RestrictionTimes = RestrictionTimes.getDefault();

      expect(a).not.toBe(b);

      a.addDefaultWeeklyRestriction();

      expect(a.restictionType).toBe(RestrictionType.Weekly);
      expect(a.weeklyRestrictionTimes.length).toBe(1);
      // b must be untouched.
      expect(b.restictionType).toBe(RestrictionType.None);
      expect(b.weeklyRestrictionTimes).toEqual([]);
    });

    test("mutating the array returned by the getter is isolated per instance", () => {
      const a: RestrictionTimes = RestrictionTimes.getDefault();
      const b: RestrictionTimes = RestrictionTimes.getDefault();

      a.weeklyRestrictionTimes.push(
        RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
      );

      expect(a.weeklyRestrictionTimes.length).toBe(1);
      expect(b.weeklyRestrictionTimes.length).toBe(0);
    });
  });

  describe("getDefaultWeeklyRestrictionTIme", () => {
    test("spans Sunday -> Monday with 00:00:00 -> 01:00:00 local times", () => {
      const w: WeeklyResctriction =
        RestrictionTimes.getDefaultWeeklyRestrictionTIme();

      expect(w.startDay).toBe(DayOfWeek.Sunday);
      expect(w.endDay).toBe(DayOfWeek.Monday);
      expect(w.startTime).toBeInstanceOf(Date);
      expect(w.endTime).toBeInstanceOf(Date);

      // Hours are set in LOCAL time and are therefore TZ-independent getters.
      expect(w.startTime.getHours()).toBe(0);
      expect(w.startTime.getMinutes()).toBe(0);
      expect(w.startTime.getSeconds()).toBe(0);
      expect(w.endTime.getHours()).toBe(1);
      expect(w.endTime.getMinutes()).toBe(0);
      expect(w.endTime.getSeconds()).toBe(0);
    });

    test("returns a fresh window (and fresh Date objects) each call", () => {
      const a: WeeklyResctriction =
        RestrictionTimes.getDefaultWeeklyRestrictionTIme();
      const b: WeeklyResctriction =
        RestrictionTimes.getDefaultWeeklyRestrictionTIme();

      expect(a).not.toBe(b);
      expect(a.startTime).not.toBe(b.startTime);
      expect(a.endTime).not.toBe(b.endTime);
    });
  });

  describe("addDefaultDailyRestriction", () => {
    test("switches to Daily with 00:00 -> 01:00 day times and empty weekly", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();

      expect(r.restictionType).toBe(RestrictionType.Daily);
      expect(r.dayRestrictionTimes).not.toBeNull();
      const day: StartAndEndTime = r.dayRestrictionTimes as StartAndEndTime;
      expect(day.startTime).toBeInstanceOf(Date);
      expect(day.endTime).toBeInstanceOf(Date);
      expect((day.startTime as Date).getHours()).toBe(0);
      expect((day.startTime as Date).getMinutes()).toBe(0);
      expect((day.startTime as Date).getSeconds()).toBe(0);
      expect((day.endTime as Date).getHours()).toBe(1);
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });

    test("clears a pre-existing weekly configuration", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();
      expect(r.weeklyRestrictionTimes.length).toBe(1);

      r.addDefaultDailyRestriction();

      expect(r.restictionType).toBe(RestrictionType.Daily);
      expect(r.weeklyRestrictionTimes).toEqual([]);
      expect(r.dayRestrictionTimes).not.toBeNull();
    });

    test("is idempotent and produces fresh Date objects on repeat calls", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();
      const first: StartAndEndTime = r.dayRestrictionTimes as StartAndEndTime;

      r.addDefaultDailyRestriction();
      const second: StartAndEndTime = r.dayRestrictionTimes as StartAndEndTime;

      expect(r.restictionType).toBe(RestrictionType.Daily);
      expect(second).not.toBe(first);
      expect((second.startTime as Date).getHours()).toBe(0);
      expect((second.endTime as Date).getHours()).toBe(1);
    });
  });

  describe("addDefaultWeeklyRestriction", () => {
    test("switches to Weekly with exactly one Sunday->Monday window, no day time", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();

      expect(r.restictionType).toBe(RestrictionType.Weekly);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes.length).toBe(1);
      const w: WeeklyResctriction = r.weeklyRestrictionTimes[0]!;
      expect(w.startDay).toBe(DayOfWeek.Sunday);
      expect(w.endDay).toBe(DayOfWeek.Monday);
      expect(w.startTime).toBeInstanceOf(Date);
      expect(w.endTime).toBeInstanceOf(Date);
    });

    test("clears a pre-existing daily configuration", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();
      expect(r.dayRestrictionTimes).not.toBeNull();

      r.addDefaultWeeklyRestriction();

      expect(r.restictionType).toBe(RestrictionType.Weekly);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes.length).toBe(1);
    });

    test("repeated calls replace rather than append (always exactly one window)", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();
      r.addDefaultWeeklyRestriction();
      r.addDefaultWeeklyRestriction();

      expect(r.weeklyRestrictionTimes.length).toBe(1);
    });
  });

  describe("removeAllRestrictions", () => {
    test("resets a Weekly instance to None", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();

      r.removeAllRestrictions();

      expect(r.restictionType).toBe(RestrictionType.None);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });

    test("resets a Daily instance to None", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();

      r.removeAllRestrictions();

      expect(r.restictionType).toBe(RestrictionType.None);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });

    test("is a no-op on an already-unrestricted instance", () => {
      const r: RestrictionTimes = new RestrictionTimes();

      r.removeAllRestrictions();

      expect(r.restictionType).toBe(RestrictionType.None);
      expect(r.dayRestrictionTimes).toBeNull();
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });

    test("clears a manually configured multi-window weekly list", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.restictionType = RestrictionType.Weekly;
      r.weeklyRestrictionTimes = [
        weeklyWindow({
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Tuesday,
          startIso: "2025-01-06T09:00:00.000Z",
          endIso: "2025-01-06T17:00:00.000Z",
        }),
        weeklyWindow({
          startDay: DayOfWeek.Saturday,
          endDay: DayOfWeek.Sunday,
          startIso: "2025-01-11T00:00:00.000Z",
          endIso: "2025-01-12T00:00:00.000Z",
        }),
      ];

      r.removeAllRestrictions();

      expect(r.restictionType).toBe(RestrictionType.None);
      expect(r.weeklyRestrictionTimes).toEqual([]);
    });
  });

  describe("toJSON structural correctness", () => {
    test("None serializes with null day time and empty weekly array", () => {
      const json: JSONObject = new RestrictionTimes().toJSON();

      expect(json["_type"]).toBe(ObjectType.RestrictionTimes);
      const v: JSONObject = valueOf(json);
      expect(v["restictionType"]).toBe(RestrictionType.None);
      expect(v["dayRestrictionTimes"]).toBeNull();
      expect(v["weeklyRestrictionTimes"]).toEqual([]);
    });

    test("Daily serializes day times as DateTime wrappers", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();

      const v: JSONObject = valueOf(r.toJSON());
      expect(v["restictionType"]).toBe(RestrictionType.Daily);
      const day: JSONObject = v["dayRestrictionTimes"] as JSONObject;
      expectDateTimeWrapper(day["startTime"]);
      expectDateTimeWrapper(day["endTime"]);
      expect(v["weeklyRestrictionTimes"]).toEqual([]);
    });

    test("Weekly serializes each window's days as strings and times as wrappers", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();

      const v: JSONObject = valueOf(r.toJSON());
      expect(v["restictionType"]).toBe(RestrictionType.Weekly);
      expect(v["dayRestrictionTimes"]).toBeNull();
      const list: Array<JSONObject> = v[
        "weeklyRestrictionTimes"
      ] as Array<JSONObject>;
      expect(list.length).toBe(1);
      expect(list[0]!["startDay"]).toBe(DayOfWeek.Sunday);
      expect(list[0]!["endDay"]).toBe(DayOfWeek.Monday);
      expectDateTimeWrapper(list[0]!["startTime"]);
      expectDateTimeWrapper(list[0]!["endTime"]);
    });

    test("multiple weekly windows preserve count, order and day labels", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.restictionType = RestrictionType.Weekly;
      r.weeklyRestrictionTimes = [
        weeklyWindow({
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Wednesday,
          startIso: "2025-01-06T09:00:00.000Z",
          endIso: "2025-01-08T17:00:00.000Z",
        }),
        weeklyWindow({
          startDay: DayOfWeek.Thursday,
          endDay: DayOfWeek.Friday,
          startIso: "2025-01-09T00:00:00.000Z",
          endIso: "2025-01-10T12:30:45.000Z",
        }),
        weeklyWindow({
          startDay: DayOfWeek.Saturday,
          endDay: DayOfWeek.Sunday,
          startIso: "2025-01-11T00:00:00.000Z",
          endIso: "2025-01-12T23:59:59.000Z",
        }),
      ];

      const list: Array<JSONObject> = valueOf(r.toJSON())[
        "weeklyRestrictionTimes"
      ] as Array<JSONObject>;

      expect(list.length).toBe(3);
      expect(
        list.map((w: JSONObject) => {
          return w["startDay"];
        }),
      ).toEqual([DayOfWeek.Monday, DayOfWeek.Thursday, DayOfWeek.Saturday]);
      expect(
        list.map((w: JSONObject) => {
          return w["endDay"];
        }),
      ).toEqual([DayOfWeek.Wednesday, DayOfWeek.Friday, DayOfWeek.Sunday]);
      list.forEach((w: JSONObject) => {
        expectDateTimeWrapper(w["startTime"]);
        expectDateTimeWrapper(w["endTime"]);
      });
    });

    test("toJSON output is pure JSON (survives JSON.stringify round-trip)", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultDailyRestriction();
      const json: JSONObject = r.toJSON();

      expect(() => {
        JSON.parse(JSON.stringify(json));
      }).not.toThrow();
      expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    });

    test("toJSON does not mutate the instance", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();
      const before: WeeklyResctriction = r.weeklyRestrictionTimes[0]!;

      r.toJSON();

      expect(r.restictionType).toBe(RestrictionType.Weekly);
      expect(r.weeklyRestrictionTimes[0]).toBe(before);
      expect(r.weeklyRestrictionTimes[0]!.startTime).toBeInstanceOf(Date);
    });
  });

  describe("fromJSON: identity and passthrough", () => {
    test("returns the same instance when handed a RestrictionTimes", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      expect(RestrictionTimes.fromJSON(r)).toBe(r);
    });

    test("reads restriction type / day times / weekly list from value", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.Weekly,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [],
        },
      });
      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored.restictionType).toBe(RestrictionType.Weekly);
      expect(restored.dayRestrictionTimes).toBeNull();
      expect(restored.weeklyRestrictionTimes).toEqual([]);
    });
  });

  describe("fromJSON: F20 weeklyRestrictionTimes normalization", () => {
    test("absent weeklyRestrictionTimes yields an ARRAY, never {}", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
        },
      });

      expect(Array.isArray(restored.weeklyRestrictionTimes)).toBe(true);
      expect(restored.weeklyRestrictionTimes).toEqual([]);
    });

    test("null weeklyRestrictionTimes falls back to an empty array", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: null,
        },
      });

      expect(Array.isArray(restored.weeklyRestrictionTimes)).toBe(true);
      expect(restored.weeklyRestrictionTimes).toEqual([]);
    });

    test("iterating the fallback array does NOT throw (the F20 crash guard)", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: { restictionType: RestrictionType.None },
      });

      expect(() => {
        // Exactly the loop shape Layer.getEventsByWeeklyRestriction runs.
        for (const _w of restored.weeklyRestrictionTimes) {
          void _w;
        }
        const copy: Array<WeeklyResctriction> = [
          ...restored.weeklyRestrictionTimes,
        ];
        restored.weeklyRestrictionTimes.map((w: WeeklyResctriction) => {
          return w;
        });
        void copy;
      }).not.toThrow();
      expect(restored.weeklyRestrictionTimes.length).toBe(0);
    });

    test("a provided weekly list is preserved verbatim (raw, no deserialize)", () => {
      const window: WeeklyResctriction = weeklyWindow({
        startDay: DayOfWeek.Tuesday,
        endDay: DayOfWeek.Thursday,
        startIso: "2025-02-04T08:00:00.000Z",
        endIso: "2025-02-06T20:00:00.000Z",
      });
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.Weekly,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [window as unknown as JSONObject],
        },
      });

      expect(restored.weeklyRestrictionTimes.length).toBe(1);
      expect(restored.weeklyRestrictionTimes[0]!.startDay).toBe(
        DayOfWeek.Tuesday,
      );
      expect(restored.weeklyRestrictionTimes[0]!.endDay).toBe(
        DayOfWeek.Thursday,
      );
    });

    test(
      "NOTE current behavior: an explicit {} weekly value is NOT normalized " +
        "to [] (|| [] only rescues falsy values); see reported bug",
      () => {
        const restored: RestrictionTimes = RestrictionTimes.fromJSON({
          _type: ObjectType.RestrictionTimes,
          value: {
            restictionType: RestrictionType.None,
            dayRestrictionTimes: null,
            weeklyRestrictionTimes: {} as unknown as JSONObject,
          },
        });

        // Current behavior: stays a non-array {} because {} is truthy.
        expect(Array.isArray(restored.weeklyRestrictionTimes)).toBe(false);
      },
    );
  });

  describe("fromJSON: missing / omitted day time", () => {
    test("None round-trip keeps dayRestrictionTimes null", () => {
      const restored: RestrictionTimes = roundTripRaw(new RestrictionTimes());
      expect(restored.dayRestrictionTimes).toBeNull();
    });

    test("omitting dayRestrictionTimes leaves it undefined (current behavior)", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: { restictionType: RestrictionType.None },
      });
      // NOTE current behavior: absent -> undefined (not coerced to null).
      expect(restored.dayRestrictionTimes).toBeUndefined();
    });
  });

  describe("fromJSON: validation / error handling", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["empty object (no _type)", {}],
      ["wrong _type", { _type: ObjectType.Recurring, value: {} }],
      [
        "correct _type but missing value",
        { _type: ObjectType.RestrictionTimes },
      ],
      [
        "correct _type but null value",
        { _type: ObjectType.RestrictionTimes, value: null },
      ],
    ])("throws BadDataException for %s", (_label: string, input: unknown) => {
      expect(() => {
        RestrictionTimes.fromJSON(input as unknown as JSONObject);
      }).toThrowError(BadDataException);
    });

    test("a present-but-empty value object does NOT throw (only truthiness checked)", () => {
      const restored: RestrictionTimes = RestrictionTimes.fromJSON({
        _type: ObjectType.RestrictionTimes,
        value: {},
      });
      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored.restictionType).toBeUndefined();
      expect(restored.weeklyRestrictionTimes).toEqual([]);
    });

    test(
      "NOTE current behavior: an invalid restictionType string is passed " +
        "through unvalidated",
      () => {
        const restored: RestrictionTimes = RestrictionTimes.fromJSON({
          _type: ObjectType.RestrictionTimes,
          value: {
            restictionType: "TotallyInvalid",
            dayRestrictionTimes: null,
            weeklyRestrictionTimes: [],
          },
        });
        expect(restored.restictionType).toBe(
          "TotallyInvalid" as unknown as RestrictionType,
        );
      },
    );
  });

  describe("round-trip: None / Daily / Weekly", () => {
    test("None survives a raw round-trip", () => {
      const restored: RestrictionTimes = roundTripRaw(new RestrictionTimes());
      expect(restored.restictionType).toBe(RestrictionType.None);
      expect(restored.dayRestrictionTimes).toBeNull();
      expect(restored.weeklyRestrictionTimes).toEqual([]);
    });

    test(
      "NOTE current behavior: a raw (no-deserialize) round-trip does NOT " +
        "restore Date instances for day times",
      () => {
        const r: RestrictionTimes = new RestrictionTimes();
        r.addDefaultDailyRestriction();
        const restored: RestrictionTimes = roundTripRaw(r);

        expect(restored.restictionType).toBe(RestrictionType.Daily);
        expect(restored.dayRestrictionTimes).not.toBeNull();
        // The times come back as {_type:"DateTime", value} wrappers, not Dates.
        const start: unknown = (restored.dayRestrictionTimes as StartAndEndTime)
          .startTime;
        expect(start instanceof Date).toBe(false);
        expectDateTimeWrapper(start);
      },
    );

    test("Daily survives the realistic DB round-trip with Date times intact", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.dayRestrictionTimes = {
        startTime: OneUptimeDate.fromString("2025-03-10T09:15:30.000Z"),
        endTime: OneUptimeDate.fromString("2025-03-10T17:45:00.000Z"),
      };
      r.restictionType = RestrictionType.Daily;
      const startMs: number = (
        r.dayRestrictionTimes.startTime as Date
      ).getTime();
      const endMs: number = (r.dayRestrictionTimes.endTime as Date).getTime();

      const restored: RestrictionTimes = roundTripThroughDb(r);

      expect(restored.restictionType).toBe(RestrictionType.Daily);
      const day: StartAndEndTime =
        restored.dayRestrictionTimes as StartAndEndTime;
      expect(day.startTime).toBeInstanceOf(Date);
      expect(day.endTime).toBeInstanceOf(Date);
      // getTime() is absolute and thus TZ-independent -> exact preservation.
      expect((day.startTime as Date).getTime()).toBe(startMs);
      expect((day.endTime as Date).getTime()).toBe(endMs);
    });

    test("single Weekly window survives the DB round-trip", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();
      const origStartMs: number =
        r.weeklyRestrictionTimes[0]!.startTime.getTime();
      const origEndMs: number = r.weeklyRestrictionTimes[0]!.endTime.getTime();

      const restored: RestrictionTimes = roundTripThroughDb(r);

      expect(restored.restictionType).toBe(RestrictionType.Weekly);
      expect(restored.weeklyRestrictionTimes.length).toBe(1);
      const w: WeeklyResctriction = restored.weeklyRestrictionTimes[0]!;
      expect(w.startDay).toBe(DayOfWeek.Sunday);
      expect(w.endDay).toBe(DayOfWeek.Monday);
      expect(w.startTime).toBeInstanceOf(Date);
      expect(w.endTime).toBeInstanceOf(Date);
      expect(w.startTime.getTime()).toBe(origStartMs);
      expect(w.endTime.getTime()).toBe(origEndMs);
    });

    test("MULTIPLE Weekly windows survive the DB round-trip in order", () => {
      const windows: Array<WeeklyResctriction> = [
        weeklyWindow({
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Wednesday,
          startIso: "2025-01-06T09:00:00.000Z",
          endIso: "2025-01-08T17:00:00.000Z",
        }),
        weeklyWindow({
          startDay: DayOfWeek.Thursday,
          endDay: DayOfWeek.Friday,
          startIso: "2025-01-09T00:00:00.000Z",
          endIso: "2025-01-10T12:30:45.000Z",
        }),
        weeklyWindow({
          startDay: DayOfWeek.Saturday,
          endDay: DayOfWeek.Sunday,
          startIso: "2025-01-11T06:00:00.000Z",
          endIso: "2025-01-12T23:59:59.000Z",
        }),
      ];
      const r: RestrictionTimes = new RestrictionTimes();
      r.restictionType = RestrictionType.Weekly;
      r.weeklyRestrictionTimes = windows;

      const restored: RestrictionTimes = roundTripThroughDb(r);

      expect(restored.weeklyRestrictionTimes.length).toBe(3);
      restored.weeklyRestrictionTimes.forEach(
        (w: WeeklyResctriction, i: number) => {
          expect(w.startDay).toBe(windows[i]!.startDay);
          expect(w.endDay).toBe(windows[i]!.endDay);
          expect(w.startTime).toBeInstanceOf(Date);
          expect(w.endTime).toBeInstanceOf(Date);
          expect(w.startTime.getTime()).toBe(windows[i]!.startTime.getTime());
          expect(w.endTime.getTime()).toBe(windows[i]!.endTime.getTime());
        },
      );
    });

    test("restriction type round-trips for every RestrictionType value", () => {
      const types: Array<RestrictionType> = [
        RestrictionType.None,
        RestrictionType.Daily,
        RestrictionType.Weekly,
      ];
      types.forEach((t: RestrictionType) => {
        const r: RestrictionTimes = new RestrictionTimes();
        r.restictionType = t;
        expect(roundTripRaw(r).restictionType).toBe(t);
        expect(roundTripThroughDb(r).restictionType).toBe(t);
      });
    });
  });

  describe("toDatabase / fromDatabase", () => {
    test("toDatabase(instance) equals its toJSON()", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();

      const db: JSONObject | null = dbAccessor.toDatabase(r);

      expect(db).not.toBeNull();
      expect(db!["_type"]).toBe(ObjectType.RestrictionTimes);
      expect(db).toEqual(r.toJSON());
    });

    test("toDatabase(plain value object) serializes without instanceof", () => {
      const plain: JSONObject = {
        _type: ObjectType.RestrictionTimes,
        value: {
          restictionType: RestrictionType.None,
          dayRestrictionTimes: null,
          weeklyRestrictionTimes: [],
        },
      };

      const db: JSONObject | null = dbAccessor.toDatabase(plain);

      expect(db).not.toBeNull();
      expect(db!["_type"]).toBe(ObjectType.RestrictionTimes);
    });

    test("toDatabase(null) and toDatabase(undefined) return null", () => {
      expect(dbAccessor.toDatabase(null)).toBeNull();
      expect(dbAccessor.toDatabase(undefined)).toBeNull();
    });

    test("fromDatabase rebuilds an instance from stored JSON", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.addDefaultWeeklyRestriction();

      const restored: RestrictionTimes | null = dbAccessor.fromDatabase(
        r.toJSON(),
      );

      expect(restored).toBeInstanceOf(RestrictionTimes);
      expect(restored!.restictionType).toBe(RestrictionType.Weekly);
      expect(restored!.weeklyRestrictionTimes.length).toBe(1);
    });

    test("fromDatabase(null) returns null", () => {
      expect(dbAccessor.fromDatabase(null)).toBeNull();
    });

    test("toDatabase -> deserialize -> fromDatabase restores Date times (Daily)", () => {
      const r: RestrictionTimes = new RestrictionTimes();
      r.restictionType = RestrictionType.Daily;
      r.dayRestrictionTimes = {
        startTime: OneUptimeDate.fromString("2025-06-01T00:00:00.000Z"),
        endTime: OneUptimeDate.fromString("2025-06-01T08:30:00.000Z"),
      };
      const startMs: number = (
        r.dayRestrictionTimes.startTime as Date
      ).getTime();

      const stored: JSONObject = JSON.parse(
        JSON.stringify(dbAccessor.toDatabase(r)),
      ) as JSONObject;
      const restored: RestrictionTimes | null = dbAccessor.fromDatabase(
        JSONFunctions.deserialize(stored),
      );

      expect(restored).toBeInstanceOf(RestrictionTimes);
      const day: StartAndEndTime = restored!
        .dayRestrictionTimes as StartAndEndTime;
      expect(day.startTime).toBeInstanceOf(Date);
      expect((day.startTime as Date).getTime()).toBe(startMs);
    });
  });
});
