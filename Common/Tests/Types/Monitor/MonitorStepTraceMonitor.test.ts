import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import ObjectID from "../../../Types/ObjectID";

/*
 * Parity coverage for the trace monitor step util. monitorTrace() now falls
 * back to MonitorStepTraceMonitorUtil.getDefault() when a step was saved with
 * no config, so getDefault() must produce a query that toQuery() turns into a
 * valid, minimal Span query (just a trailing time window).
 */
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

    test("toQuery(getDefault()) is a valid minimal query (time window only)", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(
        MonitorStepTraceMonitorUtil.getDefault(),
      );

      // Only the trailing time window is set; no over-scoping filters.
      expect(query.startTime).toBeInstanceOf(InBetween);
      expect(query.primaryEntityId).toBeUndefined();
      expect(query.entityKeys).toBeUndefined();
      expect(query.attributes).toBeUndefined();
      expect(query.statusCode).toBeUndefined();
      expect(query.name).toBeUndefined();
    });
  });

  describe("toQuery", () => {
    test("builds no filters for an empty monitor with the time window off", () => {
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
        entityKeys: ["host-1"],
        lastXSecondsOfSpans: 0,
      });
      expect(query.entityKeys).toBeInstanceOf(Includes);
      expect((query.entityKeys as Includes).values).toEqual(["host-1"]);
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

    test("searches the span name when provided", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanName: "GET /checkout",
        lastXSecondsOfSpans: 0,
      });
      expect(query.name).toBeInstanceOf(Search);
      expect((query.name as Search<string>).value).toBe("GET /checkout");
    });

    test("builds a trailing time window from lastXSecondsOfSpans", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 120,
      });
      expect(query.startTime).toBeInstanceOf(InBetween);
      const time: InBetween<Date> = query.startTime as InBetween<Date>;
      const spanMs: number =
        time.endValue.getTime() - time.startValue.getTime();
      expect(Math.abs(spanMs - 120 * 1000)).toBeLessThan(2000);
    });
  });

  describe("toJSON / fromJSON", () => {
    test("round-trips a fully populated monitor", () => {
      const original: MonitorStepTraceMonitor = {
        attributes: { env: "prod" },
        spanName: "GET /checkout",
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
  });
});
