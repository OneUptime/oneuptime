import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import ObjectID from "../../../Types/ObjectID";

describe("MonitorStepExceptionMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty monitor scoped to the last 60 seconds", () => {
      const def: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.getDefault();

      expect(def.telemetryServiceIds).toEqual([]);
      expect(def.entityKeys).toEqual([]);
      expect(def.exceptionTypes).toEqual([]);
      expect(def.message).toBe("");
      expect(def.includeResolved).toBe(false);
      expect(def.includeArchived).toBe(false);
      expect(def.lastXSecondsOfExceptions).toBe(60);
    });
  });

  describe("toAnalyticsQuery", () => {
    test("builds no filters for the empty default when the time window is off", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          lastXSecondsOfExceptions: 0,
        });

      expect(query).toEqual({});
    });

    test("scopes to telemetry services when provided", () => {
      const serviceId: ObjectID = ObjectID.generate();

      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          telemetryServiceIds: [serviceId],
          lastXSecondsOfExceptions: 0,
        });

      expect(query.primaryEntityId).toBeInstanceOf(Includes);
      expect((query.primaryEntityId as Includes).values).toEqual([serviceId]);
    });

    test("scopes to entity keys when provided", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          entityKeys: ["host-1", "pod-2"],
          lastXSecondsOfExceptions: 0,
        });

      expect(query.entityKeys).toBeInstanceOf(Includes);
      expect((query.entityKeys as Includes).values).toEqual([
        "host-1",
        "pod-2",
      ]);
    });

    test("omits entity keys when the list is empty or undefined", () => {
      expect(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          entityKeys: [],
          lastXSecondsOfExceptions: 0,
        }).entityKeys,
      ).toBeUndefined();

      // Monitors saved before entityKeys existed carry it as undefined.
      expect(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          entityKeys: undefined,
          lastXSecondsOfExceptions: 0,
        }).entityKeys,
      ).toBeUndefined();
    });

    test("filters by exception type when provided", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          exceptionTypes: ["TypeError", "ValueError"],
          lastXSecondsOfExceptions: 0,
        });

      expect(query.exceptionType).toBeInstanceOf(Includes);
      expect((query.exceptionType as Includes).values).toEqual([
        "TypeError",
        "ValueError",
      ]);
    });

    test("omits the exception type filter when the list is empty", () => {
      expect(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          exceptionTypes: [],
          lastXSecondsOfExceptions: 0,
        }).exceptionType,
      ).toBeUndefined();
    });

    test("searches the message when provided", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          message: "null pointer",
          lastXSecondsOfExceptions: 0,
        });

      expect(query.message).toBeInstanceOf(Search);
      expect((query.message as Search<string>).value).toBe("null pointer");
    });

    test("omits the message filter when it is an empty string", () => {
      expect(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          message: "",
          lastXSecondsOfExceptions: 0,
        }).message,
      ).toBeUndefined();
    });

    test("builds a trailing time window from lastXSecondsOfExceptions", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          lastXSecondsOfExceptions: 300,
        });

      expect(query.time).toBeInstanceOf(InBetween);

      const time: InBetween<Date> = query.time as InBetween<Date>;
      const spanMs: number =
        time.endValue.getTime() - time.startValue.getTime();

      expect(Math.abs(spanMs - 300 * 1000)).toBeLessThan(2000);
      expect(time.startValue.getTime()).toBeLessThan(time.endValue.getTime());
    });

    test("omits the time window when lastXSecondsOfExceptions is 0", () => {
      expect(
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          lastXSecondsOfExceptions: 0,
        }).time,
      ).toBeUndefined();
    });

    test("does not encode includeResolved / includeArchived into the query", () => {
      /*
       * These flags are intentionally not part of the analytics query — the
       * resolved/archived exclusion is applied by the telemetry monitor worker
       * (see MonitorTelemetryMonitor), not here.
       */
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          includeResolved: true,
          includeArchived: true,
          lastXSecondsOfExceptions: 0,
        });

      expect(query).toEqual({});
    });

    test("combines every filter when all are set", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          telemetryServiceIds: [ObjectID.generate()],
          entityKeys: ["host-1"],
          exceptionTypes: ["TypeError"],
          message: "boom",
          includeResolved: false,
          includeArchived: false,
          lastXSecondsOfExceptions: 60,
        });

      expect(query.primaryEntityId).toBeDefined();
      expect(query.entityKeys).toBeDefined();
      expect(query.exceptionType).toBeDefined();
      expect(query.message).toBeDefined();
      expect(query.time).toBeDefined();
    });
  });

  describe("fromJSON", () => {
    test("fills every field with a default when the JSON is empty", () => {
      const monitor: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.fromJSON({});

      expect(monitor.telemetryServiceIds).toEqual([]);
      expect(monitor.entityKeys).toEqual([]);
      expect(monitor.exceptionTypes).toEqual([]);
      expect(monitor.message).toBe("");
      expect(monitor.includeResolved).toBe(false);
      expect(monitor.includeArchived).toBe(false);
      expect(monitor.lastXSecondsOfExceptions).toBe(60);
    });

    test("coerces the include flags to booleans", () => {
      const monitor: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.fromJSON({
          includeResolved: true,
          includeArchived: true,
        });

      expect(monitor.includeResolved).toBe(true);
      expect(monitor.includeArchived).toBe(true);
    });

    test("falls back to 60 seconds for a zero/absent window", () => {
      // `|| 60` means a stored 0 is treated as "unset" and becomes 60.
      expect(
        MonitorStepExceptionMonitorUtil.fromJSON({
          lastXSecondsOfExceptions: 0,
        }).lastXSecondsOfExceptions,
      ).toBe(60);

      expect(
        MonitorStepExceptionMonitorUtil.fromJSON({
          lastXSecondsOfExceptions: 120,
        }).lastXSecondsOfExceptions,
      ).toBe(120);
    });
  });

  describe("toJSON / round trip", () => {
    test("normalizes an undefined entityKeys to an empty array", () => {
      const json: JSONObject = MonitorStepExceptionMonitorUtil.toJSON({
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        entityKeys: undefined,
      });

      expect(json["entityKeys"]).toEqual([]);
    });

    test("round-trips a fully populated monitor", () => {
      const original: MonitorStepExceptionMonitor = {
        telemetryServiceIds: [ObjectID.generate()],
        entityKeys: ["host-1"],
        exceptionTypes: ["TypeError"],
        message: "boom",
        includeResolved: true,
        includeArchived: true,
        lastXSecondsOfExceptions: 300,
      };

      const roundTripped: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.fromJSON(
          MonitorStepExceptionMonitorUtil.toJSON(original),
        );

      expect(roundTripped.entityKeys).toEqual(original.entityKeys);
      expect(roundTripped.exceptionTypes).toEqual(original.exceptionTypes);
      expect(roundTripped.message).toBe(original.message);
      expect(roundTripped.includeResolved).toBe(original.includeResolved);
      expect(roundTripped.includeArchived).toBe(original.includeArchived);
      expect(roundTripped.lastXSecondsOfExceptions).toBe(
        original.lastXSecondsOfExceptions,
      );
      expect(roundTripped.telemetryServiceIds.map(String)).toEqual(
        original.telemetryServiceIds.map(String),
      );
    });

    test("the default value round-trips unchanged", () => {
      const def: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.getDefault();

      const roundTripped: MonitorStepExceptionMonitor =
        MonitorStepExceptionMonitorUtil.fromJSON(
          MonitorStepExceptionMonitorUtil.toJSON(def),
        );

      expect(roundTripped).toEqual(def);
    });
  });
});
