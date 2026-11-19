import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
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

    test("a duration floor keeps only the spans at least that long, in nanoseconds", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanName: "AppStart",
        attributes: { "start.type": "cold" },
        minimumDurationInMs: 5000,
        lastXSecondsOfSpans: 0,
      });

      expect(query.durationUnixNano).toBeInstanceOf(GreaterThanOrEqual);
      expect((query.durationUnixNano as GreaterThanOrEqual<number>).value).toBe(
        5_000_000_000,
      );
      // The floor narrows the other filters, never replaces them.
      expect((query.name as Search<string>).value).toBe("AppStart");
      expect(query.attributes).toEqual({ "start.type": "cold" });
    });

    test("a fractional floor is rounded to a whole nanosecond", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        minimumDurationInMs: 1.5,
        lastXSecondsOfSpans: 0,
      });

      expect((query.durationUnixNano as GreaterThanOrEqual<number>).value).toBe(
        1_500_000,
      );
    });

    test("a step saved without a floor counts spans of any duration", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanName: "AppStart",
        lastXSecondsOfSpans: 0,
      });

      expect(query.durationUnixNano).toBeUndefined();
    });

    test.each([[0], [-5], [NaN], [Infinity], [""], ["  "], ["fast"], [null]])(
      "a floor of %j is no floor",
      (minimumDurationInMs: unknown) => {
        const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          minimumDurationInMs: minimumDurationInMs as number,
          lastXSecondsOfSpans: 0,
        });

        expect(query.durationUnixNano).toBeUndefined();
        expect(
          MonitorStepTraceMonitorUtil.getMinimumDurationInMs({
            minimumDurationInMs: minimumDurationInMs as number,
          }),
        ).toBeNull();
      },
    );

    test("a floor written as text through the API still counts", () => {
      expect(
        MonitorStepTraceMonitorUtil.getMinimumDurationInMs({
          minimumDurationInMs: "2500" as unknown as number,
        }),
      ).toBe(2500);
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
      expect(roundTripped.minimumDurationInMs).toBeUndefined();
    });

    test("round-trips a duration floor", () => {
      const original: MonitorStepTraceMonitor = {
        ...MonitorStepTraceMonitorUtil.getDefault(),
        spanName: "AppStart",
        minimumDurationInMs: 5000,
      };

      const json: ReturnType<typeof MonitorStepTraceMonitorUtil.toJSON> =
        MonitorStepTraceMonitorUtil.toJSON(original);

      expect(json["minimumDurationInMs"]).toBe(5000);
      expect(
        MonitorStepTraceMonitorUtil.fromJSON(json).minimumDurationInMs,
      ).toBe(5000);
    });

    test("a step with no floor is stored without the key, as before it existed", () => {
      const json: ReturnType<typeof MonitorStepTraceMonitorUtil.toJSON> =
        MonitorStepTraceMonitorUtil.toJSON({
          ...MonitorStepTraceMonitorUtil.getDefault(),
          minimumDurationInMs: 0,
        });

      expect(Object.keys(json)).not.toContain("minimumDurationInMs");
      expect(
        Object.keys(MonitorStepTraceMonitorUtil.fromJSON(json)),
      ).not.toContain("minimumDurationInMs");
    });
  });
});
