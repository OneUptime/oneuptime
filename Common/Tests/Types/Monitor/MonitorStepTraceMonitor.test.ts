import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import ObjectID from "../../../Types/ObjectID";

describe("MonitorStepTraceMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty monitor scoped to the last 60 seconds", () => {
      const def: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.getDefault();

      expect(def.attributes).toEqual({});
      expect(def.spanName).toBe("");
      expect(def.spanStatuses).toEqual([]);
      expect(def.telemetryServiceIds).toEqual([]);
      expect(def.entityKeys).toEqual([]);
      expect(def.lastXSecondsOfSpans).toBe(60);
    });
  });

  describe("toQuery", () => {
    test("builds no filters for the empty default when the time window is off", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 0,
      });

      expect(query).toEqual({});
    });

    test("scopes to telemetry services when provided", () => {
      const serviceId: ObjectID = ObjectID.generate();

      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        telemetryServiceIds: [serviceId],
        lastXSecondsOfSpans: 0,
      });

      expect(query.primaryEntityId).toBeInstanceOf(Includes);
      expect((query.primaryEntityId as Includes).values).toEqual([serviceId]);
    });

    test("scopes to entity keys when provided", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        entityKeys: ["host-1", "pod-2"],
        lastXSecondsOfSpans: 0,
      });

      expect(query.entityKeys).toBeInstanceOf(Includes);
      expect((query.entityKeys as Includes).values).toEqual([
        "host-1",
        "pod-2",
      ]);
    });

    test("omits entity keys when the list is empty or undefined", () => {
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          entityKeys: [],
          lastXSecondsOfSpans: 0,
        }).entityKeys,
      ).toBeUndefined();

      // Monitors saved before entityKeys existed carry it as undefined.
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          entityKeys: undefined,
          lastXSecondsOfSpans: 0,
        }).entityKeys,
      ).toBeUndefined();
    });

    test("passes attributes through when non-empty", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        attributes: { env: "prod", retries: 3, ok: true },
        lastXSecondsOfSpans: 0,
      });

      expect(query.attributes).toEqual({ env: "prod", retries: 3, ok: true });
    });

    test("omits attributes when the dictionary is empty", () => {
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          attributes: {},
          lastXSecondsOfSpans: 0,
        }).attributes,
      ).toBeUndefined();
    });

    test("filters by span status when provided", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanStatuses: [SpanStatus.Error],
        lastXSecondsOfSpans: 0,
      });

      expect(query.statusCode).toBeInstanceOf(Includes);
      expect((query.statusCode as Includes).values).toEqual([SpanStatus.Error]);
    });

    test("keeps the falsy Unset (0) status in the filter", () => {
      // SpanStatus.Unset === 0, so a naive truthiness check would drop it.
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanStatuses: [SpanStatus.Unset, SpanStatus.Ok],
        lastXSecondsOfSpans: 0,
      });

      expect((query.statusCode as Includes).values).toEqual([
        SpanStatus.Unset,
        SpanStatus.Ok,
      ]);
    });

    test("omits the span status filter when the list is empty", () => {
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          spanStatuses: [],
          lastXSecondsOfSpans: 0,
        }).statusCode,
      ).toBeUndefined();
    });

    test("searches the span name when provided", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanName: "GET /api",
        lastXSecondsOfSpans: 0,
      });

      expect(query.name).toBeInstanceOf(Search);
      expect((query.name as Search<string>).value).toBe("GET /api");
    });

    test("omits the span name filter when it is an empty string", () => {
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          spanName: "",
          lastXSecondsOfSpans: 0,
        }).name,
      ).toBeUndefined();
    });

    test("builds a trailing startTime window from lastXSecondsOfSpans", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 120,
      });

      expect(query.startTime).toBeInstanceOf(InBetween);

      const window: InBetween<Date> = query.startTime as InBetween<Date>;
      const spanMs: number =
        window.endValue.getTime() - window.startValue.getTime();

      expect(Math.abs(spanMs - 120 * 1000)).toBeLessThan(2000);
      expect(window.startValue.getTime()).toBeLessThan(
        window.endValue.getTime(),
      );
    });

    test("omits the time window when lastXSecondsOfSpans is 0", () => {
      expect(
        MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          lastXSecondsOfSpans: 0,
        }).startTime,
      ).toBeUndefined();
    });

    test("combines every filter when all are set", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        attributes: { env: "prod" },
        spanName: "GET /api",
        spanStatuses: [SpanStatus.Error],
        telemetryServiceIds: [ObjectID.generate()],
        entityKeys: ["host-1"],
        lastXSecondsOfSpans: 60,
      });

      expect(query.primaryEntityId).toBeDefined();
      expect(query.entityKeys).toBeDefined();
      expect(query.attributes).toBeDefined();
      expect(query.statusCode).toBeDefined();
      expect(query.name).toBeDefined();
      expect(query.startTime).toBeDefined();
    });
  });

  describe("toJSON / round trip", () => {
    test("normalizes an undefined entityKeys to an empty array", () => {
      const json: JSONObject = MonitorStepTraceMonitorUtil.toJSON({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        entityKeys: undefined,
      });

      expect(json["entityKeys"]).toEqual([]);
    });

    test("round-trips a fully populated monitor", () => {
      const original: MonitorStepTraceMonitor = {
        attributes: { env: "prod", retries: 3 },
        spanName: "GET /api",
        spanStatuses: [SpanStatus.Error, SpanStatus.Ok],
        telemetryServiceIds: [ObjectID.generate()],
        entityKeys: ["host-1"],
        lastXSecondsOfSpans: 300,
      };

      const roundTripped: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.fromJSON(
          MonitorStepTraceMonitorUtil.toJSON(original),
        );

      expect(roundTripped.attributes).toEqual(original.attributes);
      expect(roundTripped.spanName).toBe(original.spanName);
      expect(roundTripped.spanStatuses).toEqual(original.spanStatuses);
      expect(roundTripped.entityKeys).toEqual(original.entityKeys);
      expect(roundTripped.lastXSecondsOfSpans).toBe(
        original.lastXSecondsOfSpans,
      );
      expect(roundTripped.telemetryServiceIds.map(String)).toEqual(
        original.telemetryServiceIds.map(String),
      );
    });

    test("fromJSON defaults attributes and entityKeys when absent", () => {
      const monitor: MonitorStepTraceMonitor =
        MonitorStepTraceMonitorUtil.fromJSON({
          telemetryServiceIds: [],
        } as JSONObject);

      expect(monitor.attributes).toEqual({});
      expect(monitor.entityKeys).toEqual([]);
    });
  });
});
