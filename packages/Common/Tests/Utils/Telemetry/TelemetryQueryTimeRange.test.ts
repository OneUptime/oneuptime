import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import { MonitorStepExceptionMonitorUtil } from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepTraceMonitorUtil } from "../../../Types/Monitor/MonitorStepTraceMonitor";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import TelemetryQueryTimeRange from "../../../Utils/Telemetry/TelemetryQueryTimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * When a telemetry monitor opens an incident it stamps the window it just
 * evaluated over onto the query it stores on the row. The incident page is
 * supposed to render that exact window — "the logs at the moment this fired" —
 * but the logs viewer was substituting a rolling "past 1 hour" over it, so an
 * incident from last Tuesday showed the last hour of unrelated traffic under
 * the heading "Logs for this incident".
 *
 * The root cause that let it go unnoticed for so long is in these tests'
 * crosshairs: the window survives storage by VALUE but not by TYPE. It is
 * persisted through JSON.stringify, which calls InBetween.toJSON() and then
 * flattens each Date bound to an ISO string; InBetween.fromJSON hands those
 * strings straight to the constructor. So a restored window is a real
 * InBetween whose `startValue` is a `string`, even though the type says Date —
 * and every consumer guarding on `instanceof Date` silently did nothing.
 *
 * These tests pin both halves: the coercion itself, and the full
 * monitor -> store -> load round trip that produces the awkward shape.
 */
describe("TelemetryQueryTimeRange", () => {
  const START_ISO: string = "2026-08-04T10:00:00.000Z";
  const END_ISO: string = "2026-08-04T10:01:00.000Z";
  const START_DATE: Date = new Date(START_ISO);
  const END_DATE: Date = new Date(END_ISO);

  describe("toDateWindow", () => {
    test("returns Date bounds unchanged when they are already Dates", () => {
      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>(START_DATE, END_DATE),
        );

      expect(window).not.toBeNull();
      expect(window!.startValue).toBeInstanceOf(Date);
      expect(window!.startValue.getTime()).toBe(START_DATE.getTime());
      expect(window!.endValue.getTime()).toBe(END_DATE.getTime());
    });

    test("hands back the same instance when nothing needs coercing", () => {
      /*
       * Identity is the signal callers use to decide whether anything changed;
       * an equal-but-fresh object would churn React state on every load.
       */
      const already: InBetween<Date> = new InBetween<Date>(
        START_DATE,
        END_DATE,
      );

      expect(TelemetryQueryTimeRange.toDateWindow(already)).toBe(already);
    });

    test("coerces ISO string bounds back to Dates — the shape storage actually returns", () => {
      /*
       * This is the exact value InBetween.fromJSON produces for a stored
       * window: the right class, the wrong bound type.
       */
      const restored: InBetween<Date> = new InBetween<Date>(
        START_ISO as unknown as Date,
        END_ISO as unknown as Date,
      );

      expect(restored.startValue).not.toBeInstanceOf(Date);

      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.toDateWindow(restored);

      expect(window!.startValue).toBeInstanceOf(Date);
      expect(window!.endValue).toBeInstanceOf(Date);
      expect(window!.startValue.toISOString()).toBe(START_ISO);
      expect(window!.endValue.toISOString()).toBe(END_ISO);
    });

    test("coerces epoch-number bounds", () => {
      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>(
            START_DATE.getTime() as unknown as Date,
            END_DATE.getTime() as unknown as Date,
          ),
        );

      expect(window!.startValue.getTime()).toBe(START_DATE.getTime());
      expect(window!.endValue.getTime()).toBe(END_DATE.getTime());
    });

    test("accepts the plain tagged object, for callers that skipped deserialize", () => {
      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.toDateWindow({
          _type: "InBetween",
          startValue: START_ISO,
          endValue: END_ISO,
        });

      expect(window!.startValue.getTime()).toBe(START_DATE.getTime());
      expect(window!.endValue.getTime()).toBe(END_DATE.getTime());
    });

    test("returns null for absent, non-object and untagged values", () => {
      expect(TelemetryQueryTimeRange.toDateWindow(null)).toBeNull();
      expect(TelemetryQueryTimeRange.toDateWindow(undefined)).toBeNull();
      expect(TelemetryQueryTimeRange.toDateWindow(START_ISO)).toBeNull();
      expect(TelemetryQueryTimeRange.toDateWindow(12345)).toBeNull();
      expect(
        TelemetryQueryTimeRange.toDateWindow({
          startValue: START_ISO,
          endValue: END_ISO,
        }),
      ).toBeNull();
      // A different operator must not be mistaken for a window.
      expect(
        TelemetryQueryTimeRange.toDateWindow(new Search("boom")),
      ).toBeNull();
    });

    test("returns null when either bound is unparseable, rather than an Invalid Date", () => {
      expect(
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>("not-a-date" as unknown as Date, END_DATE),
        ),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>(START_DATE, "" as unknown as Date),
        ),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>(
            START_DATE,
            new Date("nonsense") as unknown as Date,
          ),
        ),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.toDateWindow({
          _type: "InBetween",
          startValue: null,
          endValue: END_ISO,
        }),
      ).toBeNull();
    });

    test("preserves an inverted window instead of falling back", () => {
      /*
       * A start after the end is a server-side bug. Rendering it makes that
       * visible; quietly reverting to a rolling default would reintroduce the
       * exact failure this whole helper exists to stop — unrelated data shown
       * under an incident's heading with nothing to indicate it.
       */
      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.toDateWindow(
          new InBetween<Date>(END_DATE, START_DATE),
        );

      expect(window!.startValue.getTime()).toBe(END_DATE.getTime());
      expect(window!.endValue.getTime()).toBe(START_DATE.getTime());
    });
  });

  describe("getWindowFieldName", () => {
    test("maps each telemetry type to the field its monitor stamps", () => {
      expect(
        TelemetryQueryTimeRange.getWindowFieldName(TelemetryType.Log),
      ).toBe("time");
      expect(
        TelemetryQueryTimeRange.getWindowFieldName(TelemetryType.Exception),
      ).toBe("time");
      expect(
        TelemetryQueryTimeRange.getWindowFieldName(TelemetryType.Trace),
      ).toBe("startTime");
    });

    test("returns null for types that carry no query window", () => {
      expect(
        TelemetryQueryTimeRange.getWindowFieldName(TelemetryType.Metric),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.getWindowFieldName(TelemetryType.Profile),
      ).toBeNull();
      expect(TelemetryQueryTimeRange.getWindowFieldName(undefined)).toBeNull();
    });
  });

  describe("getQueryWindow", () => {
    test("reads the field named by the telemetry type", () => {
      const spanQuery: JSONObject = {
        startTime: new InBetween<Date>(START_DATE, END_DATE),
      };

      expect(
        TelemetryQueryTimeRange.getQueryWindow(
          spanQuery,
          TelemetryType.Trace,
        )!.startValue.getTime(),
      ).toBe(START_DATE.getTime());

      // Spans keep theirs on startTime, so looking for `time` must find nothing.
      expect(
        TelemetryQueryTimeRange.getQueryWindow(spanQuery, TelemetryType.Log),
      ).toBeNull();
    });

    test("tries both known fields when the type is unknown", () => {
      expect(
        TelemetryQueryTimeRange.getQueryWindow({
          time: new InBetween<Date>(START_DATE, END_DATE),
        }),
      ).not.toBeNull();

      expect(
        TelemetryQueryTimeRange.getQueryWindow({
          startTime: new InBetween<Date>(START_DATE, END_DATE),
        }),
      ).not.toBeNull();
    });

    test("returns null for an empty or absent query, and for a query with no window", () => {
      expect(TelemetryQueryTimeRange.getQueryWindow(null)).toBeNull();
      expect(TelemetryQueryTimeRange.getQueryWindow(undefined)).toBeNull();
      expect(TelemetryQueryTimeRange.getQueryWindow({})).toBeNull();
      expect(
        TelemetryQueryTimeRange.getQueryWindow({
          body: new Search("boom"),
          severityText: new Includes([LogSeverity.Error]),
        }),
      ).toBeNull();
    });
  });

  describe("round trip from a real monitor evaluation", () => {
    /*
     * The regression that matters. These walk the actual production path —
     * build the query the way the worker does, persist it the way the worker
     * does, restore it the way the page does — instead of hand-writing a
     * fixture of what that is assumed to look like. A hand-written fixture is
     * how the previous attempt at covering this drifted into asserting
     * nothing.
     */
    type StoreAndRestoreFunction = (query: JSONObject) => JSONObject;

    const storeAndRestore: StoreAndRestoreFunction = (
      query: JSONObject,
    ): JSONObject => {
      // Exactly what the worker writes, then what the client reads back.
      const stored: JSONObject = JSONFunctions.anyObjectToJSONObject(query);

      return JSONFunctions.deserialize(stored);
    };

    test("log monitor: the stored window is flat ISO strings, and is recovered as Dates", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        body: "boom",
        lastXSecondsOfLogs: 60,
      });

      const evaluated: InBetween<Date> = (query as JSONObject)[
        "time"
      ] as InBetween<Date>;
      expect(evaluated.startValue).toBeInstanceOf(Date);

      const stored: JSONObject = JSONFunctions.anyObjectToJSONObject(query);

      /*
       * Pin the on-disk shape. It is FLAT — `{_type, startValue, endValue}`,
       * with no `value` wrapper and no `{_type:"DateTime"}` tagging of the
       * bounds. Any fixture that models it otherwise deserializes to an empty
       * InBetween and silently asserts nothing.
       */
      expect(stored["time"]).toEqual({
        _type: "InBetween",
        startValue: evaluated.startValue.toISOString(),
        endValue: evaluated.endValue.toISOString(),
      });

      const restored: JSONObject = JSONFunctions.deserialize(stored);
      const restoredWindow: InBetween<Date> = restored[
        "time"
      ] as InBetween<Date>;

      // The class survives; the bound type does not. This is the whole trap.
      expect(restoredWindow).toBeInstanceOf(InBetween);
      expect(typeof restoredWindow.startValue).toBe("string");

      const recovered: InBetween<Date> | null =
        TelemetryQueryTimeRange.getQueryWindow(restored, TelemetryType.Log);

      expect(recovered!.startValue).toBeInstanceOf(Date);
      expect(recovered!.startValue.getTime()).toBe(
        evaluated.startValue.getTime(),
      );
      expect(recovered!.endValue.getTime()).toBe(evaluated.endValue.getTime());
    });

    test("log monitor: the window is exactly lastXSecondsOfLogs wide", () => {
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 300,
      });

      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.getQueryWindow(
          storeAndRestore(query as JSONObject),
          TelemetryType.Log,
        );

      expect(window!.endValue.getTime() - window!.startValue.getTime()).toBe(
        300 * 1000,
      );
    });

    test("trace monitor: the window round-trips off startTime", () => {
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 120,
      });

      const evaluated: InBetween<Date> = (query as JSONObject)[
        "startTime"
      ] as InBetween<Date>;

      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.getQueryWindow(
          storeAndRestore(query as JSONObject),
          TelemetryType.Trace,
        );

      expect(window!.startValue).toBeInstanceOf(Date);
      expect(window!.startValue.getTime()).toBe(evaluated.startValue.getTime());
      expect(window!.endValue.getTime() - window!.startValue.getTime()).toBe(
        120 * 1000,
      );
    });

    test("exception monitor: the window round-trips off time", () => {
      const query: Query<ExceptionInstance> =
        MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          lastXSecondsOfExceptions: 90,
        });

      const window: InBetween<Date> | null =
        TelemetryQueryTimeRange.getQueryWindow(
          storeAndRestore(query as JSONObject),
          TelemetryType.Exception,
        );

      expect(window!.startValue).toBeInstanceOf(Date);
      expect(window!.endValue.getTime() - window!.startValue.getTime()).toBe(
        90 * 1000,
      );
    });

    test("a monitor configured with no window stores none, and none is recovered", () => {
      // Backwards compatibility: older incidents, and monitors with the window off.
      const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
        ...MonitorStepLogMonitorUtil.getDefault(),
        body: "boom",
        lastXSecondsOfLogs: 0,
      });

      expect((query as JSONObject)["time"]).toBeUndefined();

      expect(
        TelemetryQueryTimeRange.getQueryWindow(
          storeAndRestore(query as JSONObject),
          TelemetryType.Log,
        ),
      ).toBeNull();
    });
  });

  describe("getSnapshotWindow", () => {
    test("finds the window for each telemetry type", () => {
      const logWindow: InBetween<Date> | null =
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Log,
          telemetryQuery: {
            time: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
          } as Query<Log>,
          metricViewData: null,
        });
      expect(logWindow!.startValue.getTime()).toBe(START_DATE.getTime());

      const traceWindow: InBetween<Date> | null =
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Trace,
          telemetryQuery: {
            startTime: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
          } as Query<Span>,
          metricViewData: null,
        });
      expect(traceWindow!.startValue.getTime()).toBe(START_DATE.getTime());

      const exceptionWindow: InBetween<Date> | null =
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Exception,
          telemetryQuery: {
            time: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
          } as Query<ExceptionInstance>,
          metricViewData: null,
        });
      expect(exceptionWindow!.startValue.getTime()).toBe(START_DATE.getTime());

      const metricWindow: InBetween<Date> | null =
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Metric,
          telemetryQuery: null,
          metricViewData: {
            startAndEndDate: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
            queryConfigs: [],
            formulaConfigs: [],
          } as MetricViewData,
        });
      expect(metricWindow!.startValue).toBeInstanceOf(Date);
      expect(metricWindow!.startValue.getTime()).toBe(START_DATE.getTime());
    });

    test("returns null for no telemetry query and for one carrying no window", () => {
      expect(TelemetryQueryTimeRange.getSnapshotWindow(null)).toBeNull();
      expect(TelemetryQueryTimeRange.getSnapshotWindow(undefined)).toBeNull();
      expect(
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Log,
          telemetryQuery: { body: new Search("boom") } as Query<Log>,
          metricViewData: null,
        }),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.getSnapshotWindow({
          telemetryType: TelemetryType.Metric,
          telemetryQuery: null,
          metricViewData: {
            startAndEndDate: null,
            queryConfigs: [],
            formulaConfigs: [],
          } as MetricViewData,
        }),
      ).toBeNull();
    });
  });

  describe("toRangeStartAndEndDateTime / getPinnedRangeForQuery", () => {
    test("resolves to CUSTOM so the window cannot re-anchor to now", () => {
      const range: RangeStartAndEndDateTime | null =
        TelemetryQueryTimeRange.toRangeStartAndEndDateTime(
          new InBetween<Date>(START_DATE, END_DATE),
        );

      expect(range!.range).toBe(TimeRange.CUSTOM);
      expect(range!.startAndEndDate!.startValue.getTime()).toBe(
        START_DATE.getTime(),
      );
    });

    test("survives the picker's own resolution unchanged", () => {
      /*
       * The property the whole fix rests on: the logs viewer stores this value
       * as picker state and every downstream request (list, histogram, facets)
       * re-resolves it through RangeStartAndEndDateTimeUtil. A relative range
       * would slide to "now" on each of those calls; CUSTOM must come back
       * byte-identical every time.
       */
      const range: RangeStartAndEndDateTime | null =
        TelemetryQueryTimeRange.toRangeStartAndEndDateTime(
          new InBetween<Date>(START_DATE, END_DATE),
        );

      const resolved: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(range!);

      expect(resolved.startValue.getTime()).toBe(START_DATE.getTime());
      expect(resolved.endValue.getTime()).toBe(END_DATE.getTime());

      // And again — resolving twice must not move it.
      const resolvedAgain: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(range!);
      expect(resolvedAgain.startValue.getTime()).toBe(START_DATE.getTime());
    });

    test("resolved bounds are real Dates, which downstream callers require", () => {
      /*
       * The facets request calls `.toISOString()` on these bounds directly. A
       * string-valued bound would throw, so coercion is load-bearing, not
       * cosmetic.
       */
      const range: RangeStartAndEndDateTime | null =
        TelemetryQueryTimeRange.getPinnedRangeForQuery(
          {
            time: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
          },
          TelemetryType.Log,
        );

      const resolved: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(range!);

      expect(() => {
        return resolved.startValue.toISOString();
      }).not.toThrow();
      expect(resolved.startValue.toISOString()).toBe(START_ISO);
    });

    test("returns null when there is nothing to pin, so hosts keep their own default", () => {
      expect(
        TelemetryQueryTimeRange.toRangeStartAndEndDateTime(null),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.getPinnedRangeForQuery({}, TelemetryType.Log),
      ).toBeNull();
      expect(
        TelemetryQueryTimeRange.getPinnedRangeForQuery(
          undefined,
          TelemetryType.Log,
        ),
      ).toBeNull();
    });
  });

  describe("isSameRange", () => {
    test("compares by value, not identity", () => {
      const a: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
      };
      const b: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date(START_ISO),
          new Date(END_ISO),
        ),
      };

      expect(a.startAndEndDate).not.toBe(b.startAndEndDate);
      expect(TelemetryQueryTimeRange.isSameRange(a, b)).toBe(true);
    });

    test("treats string-valued and Date-valued bounds for the same instant as equal", () => {
      // A host rebuilding its query from stored JSON must not look like a change.
      expect(
        TelemetryQueryTimeRange.isSameRange(
          {
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
          },
          {
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(
              START_ISO as unknown as Date,
              END_ISO as unknown as Date,
            ),
          },
        ),
      ).toBe(true);
    });

    test("detects a different window and a different range kind", () => {
      const base: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
      };

      expect(
        TelemetryQueryTimeRange.isSameRange(base, {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            START_DATE,
            new Date("2026-08-04T10:05:00.000Z"),
          ),
        }),
      ).toBe(false);

      expect(
        TelemetryQueryTimeRange.isSameRange(base, {
          range: TimeRange.PAST_ONE_HOUR,
        }),
      ).toBe(false);
    });

    test("handles absent values", () => {
      expect(TelemetryQueryTimeRange.isSameRange(null, null)).toBe(true);
      expect(TelemetryQueryTimeRange.isSameRange(undefined, null)).toBe(true);
      expect(
        TelemetryQueryTimeRange.isSameRange(null, {
          range: TimeRange.PAST_ONE_HOUR,
        }),
      ).toBe(false);
      expect(
        TelemetryQueryTimeRange.isSameRange(
          { range: TimeRange.PAST_ONE_HOUR },
          { range: TimeRange.PAST_ONE_HOUR },
        ),
      ).toBe(true);
    });
  });

  describe("hydrate", () => {
    test("gives the metric view real Date bounds", () => {
      /*
       * The metric chart gates bucket-grid alignment and exemplar fetching on
       * `instanceof Date`. Until this runs, both are switched off on every
       * incident and alert page.
       */
      const telemetryQuery: TelemetryQuery = {
        telemetryType: TelemetryType.Metric,
        telemetryQuery: null,
        metricViewData: {
          startAndEndDate: new InBetween<Date>(
            START_ISO as unknown as Date,
            END_ISO as unknown as Date,
          ),
          queryConfigs: [],
          formulaConfigs: [],
          rangeToken: undefined,
        } as MetricViewData,
      };

      const hydrated: TelemetryQuery | null =
        TelemetryQueryTimeRange.hydrate(telemetryQuery);

      expect(
        hydrated!.metricViewData!.startAndEndDate!.startValue,
      ).toBeInstanceOf(Date);
      expect(
        hydrated!.metricViewData!.startAndEndDate!.startValue.getTime(),
      ).toBe(START_DATE.getTime());
      expect(
        hydrated!.metricViewData!.startAndEndDate!.endValue.getTime(),
      ).toBe(END_DATE.getTime());
    });

    test("gives log, trace and exception queries real Date bounds on the right field", () => {
      const log: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
        telemetryType: TelemetryType.Log,
        telemetryQuery: {
          time: new InBetween<Date>(
            START_ISO as unknown as Date,
            END_ISO as unknown as Date,
          ),
        } as Query<Log>,
        metricViewData: null,
      });
      expect(
        ((log!.telemetryQuery as JSONObject)["time"] as InBetween<Date>)
          .startValue,
      ).toBeInstanceOf(Date);

      const trace: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
        telemetryType: TelemetryType.Trace,
        telemetryQuery: {
          startTime: new InBetween<Date>(
            START_ISO as unknown as Date,
            END_ISO as unknown as Date,
          ),
        } as Query<Span>,
        metricViewData: null,
      });
      expect(
        ((trace!.telemetryQuery as JSONObject)["startTime"] as InBetween<Date>)
          .startValue,
      ).toBeInstanceOf(Date);

      const exception: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
        telemetryType: TelemetryType.Exception,
        telemetryQuery: {
          time: new InBetween<Date>(
            START_ISO as unknown as Date,
            END_ISO as unknown as Date,
          ),
        } as Query<ExceptionInstance>,
        metricViewData: null,
      });
      expect(
        ((exception!.telemetryQuery as JSONObject)["time"] as InBetween<Date>)
          .startValue,
      ).toBeInstanceOf(Date);
    });

    test("leaves every other filter on the query untouched", () => {
      const body: Search<string> = new Search("boom");
      const severity: Includes = new Includes([LogSeverity.Error]);

      const hydrated: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
        telemetryType: TelemetryType.Log,
        telemetryQuery: {
          body: body,
          severityText: severity,
          time: new InBetween<Date>(
            START_ISO as unknown as Date,
            END_ISO as unknown as Date,
          ),
        } as unknown as Query<Log>,
        metricViewData: null,
      });

      const query: JSONObject = hydrated!.telemetryQuery as JSONObject;
      expect(query["body"]).toBe(body);
      expect(query["severityText"]).toBe(severity);
    });

    test("leaves the rest of the metric view untouched, including rangeToken", () => {
      const queryConfigs: MetricViewData["queryConfigs"] = [];
      const metricViewData: MetricViewData = {
        startAndEndDate: new InBetween<Date>(
          START_ISO as unknown as Date,
          END_ISO as unknown as Date,
        ),
        queryConfigs: queryConfigs,
        formulaConfigs: [],
        rangeToken: TimeRange.PAST_ONE_HOUR,
      };

      const hydrated: TelemetryQuery | null = TelemetryQueryTimeRange.hydrate({
        telemetryType: TelemetryType.Metric,
        telemetryQuery: null,
        metricViewData: metricViewData,
      });

      expect(hydrated!.metricViewData!.queryConfigs).toBe(queryConfigs);
      expect(hydrated!.metricViewData!.rangeToken).toBe(
        TimeRange.PAST_ONE_HOUR,
      );
    });

    test("returns the same reference when there is nothing to fix", () => {
      /*
       * React hosts call this on every load; handing back a fresh-but-equal
       * object would churn state and refetch.
       */
      const alreadyDates: TelemetryQuery = {
        telemetryType: TelemetryType.Log,
        telemetryQuery: {
          time: new InBetween<Date>(START_DATE, END_DATE),
        } as Query<Log>,
        metricViewData: null,
      };
      expect(TelemetryQueryTimeRange.hydrate(alreadyDates)).toBe(alreadyDates);

      const noWindow: TelemetryQuery = {
        telemetryType: TelemetryType.Log,
        telemetryQuery: { body: new Search("boom") } as Query<Log>,
        metricViewData: null,
      };
      expect(TelemetryQueryTimeRange.hydrate(noWindow)).toBe(noWindow);
    });

    test("returns null for no telemetry query", () => {
      expect(TelemetryQueryTimeRange.hydrate(null)).toBeNull();
      expect(TelemetryQueryTimeRange.hydrate(undefined)).toBeNull();
    });

    test("hydrating a stored blob end to end yields a chart-ready window", () => {
      // The full production path for a metric incident, in one assertion chain.
      const evaluated: InBetween<Date> = new InBetween<Date>(
        START_DATE,
        END_DATE,
      );

      const restored: TelemetryQuery = JSONFunctions.deserialize(
        JSONFunctions.anyObjectToJSONObject({
          telemetryType: TelemetryType.Metric,
          telemetryQuery: null,
          metricViewData: {
            startAndEndDate: evaluated,
            queryConfigs: [],
            formulaConfigs: [],
          },
        }),
      ) as unknown as TelemetryQuery;

      // Before hydration the guard downstream would reject this.
      expect(
        restored.metricViewData!.startAndEndDate!.startValue,
      ).not.toBeInstanceOf(Date);

      const hydrated: TelemetryQuery | null =
        TelemetryQueryTimeRange.hydrate(restored);

      expect(
        hydrated!.metricViewData!.startAndEndDate!.startValue,
      ).toBeInstanceOf(Date);
      expect(
        hydrated!.metricViewData!.startAndEndDate!.startValue.getTime(),
      ).toBe(START_DATE.getTime());
    });
  });
});
