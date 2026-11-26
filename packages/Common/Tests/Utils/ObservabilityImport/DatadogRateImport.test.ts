import { describe, expect, test } from "@jest/globals";
import {
  AlertImportItem,
  AlertImportPlan,
  ConvertedQuery,
  DashboardImportPlan,
  ImportItemStatus,
  ImportNoteKind,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import {
  DATADOG_RATE_INTERVAL_ASSUMED,
  DATADOG_READ_AS_COUNT,
  DOGSTATSD_FLUSH_INTERVAL_IN_SECONDS,
  DatadogConversionOptions,
  DatadogMetricKind,
  DatadogQueryContext,
  collectDatadogAsCountMetricNames,
  convertDatadogQuery,
  readDatadogAsCountMetricNames,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogPromQL";
import { parseDatadogExpression } from "../../../Utils/ObservabilityImport/Datadog/DatadogQueryParser";
import {
  ALERT_SOURCE_KINDS,
  DASHBOARD_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  listDatadogAsCountMetricNames,
  planAlertImport,
  planDashboardImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A DogStatsD count, which the Datadog Agent sends as a rate per second and
 * OneUptime keeps as a gauge marked as a rate (issue #10327): Datadog's
 * .as_count() counts it per interval, multiplying each interval's sum by
 * the seconds each point covers, and so does the import, exactly, when the
 * project's data says how many; a true gauge is left as it is.
 */

const RATES: DatadogConversionOptions = {
  context: DatadogQueryContext.Dashboard,
  variablePrefixes: new Map<string, string>(),
  knownMetricKinds: new Map<string, DatadogMetricKind>([
    ["app.requests", DatadogMetricKind.Rate],
    ["app.errors", DatadogMetricKind.Rate],
    ["app.queue.depth", DatadogMetricKind.Gauge],
  ]),
  rateIntervalsInSeconds: new Map<string, number>([["app.requests", 10]]),
};

const convert: (
  query: string,
  options?: DatadogConversionOptions,
) => ConvertedQuery = (
  query: string,
  options?: DatadogConversionOptions,
): ConvertedQuery => {
  return convertDatadogQuery({ query, options: options || RATES });
};

describe("a rate's .as_count()", () => {
  test("is its points added up and multiplied by the seconds each covers, exactly, with no note", () => {
    const converted: ConvertedQuery = convert(
      "sum:app.requests{env:prod}.as_count()",
    );

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.promQL).toBe(
      'sum (sum_over_time(app_requests{env="prod"}[$__interval]) * 10)',
    );
    expect(converted.notes).toEqual([]);
  });

  test("in a monitor: each minute's count, which the window adds up", () => {
    expect(
      convert("sum:app.requests{*}.as_count()", {
        ...RATES,
        context: DatadogQueryContext.Monitor,
        monitorTimeAggregation: "sum",
      }).promQL,
    ).toBe("sum (sum_over_time(app_requests[1m]) * 10)");
  });

  test("after .rollup(): the rollup's function, then the seconds, as Datadog multiplies post-aggregation", () => {
    expect(
      convert("sum:app.requests{*}.rollup(sum, 60).as_count()").promQL,
    ).toBe("sum (sum_over_time(app_requests[60s]) * 10)");
  });

  test("when the project's data does not say the seconds, DogStatsD's flush interval is read, and said once for every such metric", () => {
    const converted: ConvertedQuery = convert(
      "sum:app.errors{*}.as_count() / sum:app.requests{*}.as_count()",
      {
        ...RATES,
        rateIntervalsInSeconds: new Map<string, number>(),
      },
    );

    expect(DOGSTATSD_FLUSH_INTERVAL_IN_SECONDS).toBe(10);
    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.promQL).toBe(
      "(sum (sum_over_time(app_errors[$__interval]) * 10)) / (sum (sum_over_time(app_requests[$__interval]) * 10))",
    );
    expect(converted.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: DATADOG_RATE_INTERVAL_ASSUMED,
        values: { metrics: "app.errors, app.requests" },
      },
    ]);
  });

  test("a rate read without .as_count() is per second, as Datadog shows a rate: averaged, exactly", () => {
    for (const query of [
      "avg:app.requests{*}",
      "sum:app.requests{*}.as_rate()",
    ]) {
      const converted: ConvertedQuery = convert(query);

      expect(converted.status).toBe(ImportItemStatus.Exact);
      expect(converted.promQL).toContain("avg_over_time(app_requests");
      expect(converted.promQL).not.toContain("* 10");
    }
  });

  test("a true gauge's .as_count() leaves it as it is, exactly, as Datadog does", () => {
    const converted: ConvertedQuery = convert(
      "avg:app.queue.depth{*}.as_count()",
    );

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.promQL).toBe(
      "avg (avg_over_time(app_queue_depth[$__interval]))",
    );
  });

  test("a metric the project has no data for keeps today's reading: a count, said", () => {
    const converted: ConvertedQuery = convert("sum:app.new{*}.as_count()");

    expect(converted.promQL).toBe("sum (sum_over_time(app_new[$__interval]))");
    expect(converted.notes[0]?.text).toBe(DATADOG_READ_AS_COUNT);
  });

  test("whatever the seconds, the query parses as OneUptime runs it", () => {
    const random: SeededRandom = seededRandom(10327);

    for (let draw: number = 0; draw < 300; draw++) {
      const seconds: number = 1 + random(3600);
      const converted: ConvertedQuery = convert(
        "sum:app.requests{env:prod} by {host}.as_count()",
        {
          ...RATES,
          rateIntervalsInSeconds: new Map<string, number>([
            ["app.requests", seconds],
          ]),
        },
      );

      expect(converted.promQL).toBe(
        `sum by (resource_host_name) (sum_over_time(app_requests{env="prod"}[$__interval]) * ${seconds})`,
      );
      expect(() => {
        parsePromQL(converted.promQL.replace(/\$__interval/g, "60s"));
      }).not.toThrow();
    }
  });
});

describe("the metrics a file reads with .as_count()", () => {
  test("in a query, a formula and a function's arguments", () => {
    const names: Set<string> = new Set<string>();

    collectDatadogAsCountMetricNames(
      parseDatadogExpression(
        "100 * sum:a.errors{*}.as_count() / sum:a.requests{*}.as_count() + avg:a.load{*} + per_minute(sum:a.retries{*}.as_count())",
      ),
      names,
    );

    expect(Array.from(names).sort()).toEqual([
      "a.errors",
      "a.requests",
      "a.retries",
    ]);
    expect(readDatadogAsCountMetricNames("not a query")).toEqual([]);
  });

  test("of a dashboard's widgets and of monitors, for the preview to ask about", () => {
    expect(
      listDatadogAsCountMetricNames(
        readImportSource({
          text: JSON.stringify({
            title: "Checkout",
            layout_type: "ordered",
            widgets: [
              {
                definition: {
                  type: "timeseries",
                  requests: [
                    {
                      queries: [
                        {
                          data_source: "metrics",
                          name: "query1",
                          query: "sum:checkout.orders{*}.as_count()",
                        },
                        {
                          data_source: "metrics",
                          name: "query2",
                          query: "avg:checkout.latency{*}",
                        },
                      ],
                      formulas: [{ formula: "query1" }, { formula: "query2" }],
                    },
                  ],
                },
              },
            ],
          }),
          accepts: DASHBOARD_SOURCE_KINDS,
        }),
      ),
    ).toEqual(["checkout.orders"]);

    expect(
      listDatadogAsCountMetricNames(
        readImportSource({
          text: JSON.stringify([
            {
              name: "Too many orders",
              type: "query alert",
              query: "sum(last_5m):sum:checkout.orders{*}.as_count() > 100",
            },
          ]),
          accepts: ALERT_SOURCE_KINDS,
        }),
      ),
    ).toEqual(["checkout.orders"]);
  });

  test("a plan reads the rates and their seconds the preview found", () => {
    const dashboard: DashboardImportPlan = planDashboardImport(
      readImportSource({
        text: JSON.stringify({
          title: "Checkout",
          layout_type: "ordered",
          widgets: [
            {
              definition: {
                type: "timeseries",
                title: "Orders",
                requests: [{ q: "sum:checkout.orders{*}.as_count()" }],
              },
            },
          ],
        }),
        accepts: DASHBOARD_SOURCE_KINDS,
      }),
      {
        knownMetricKinds: new Map<string, DatadogMetricKind>([
          ["checkout.orders", DatadogMetricKind.Rate],
        ]),
        rateIntervalsInSeconds: new Map<string, number>([
          ["checkout.orders", 15],
        ]),
      },
    );

    expect(dashboard.items[0]?.status).toBe(ImportItemStatus.Exact);
    expect(dashboard.items[0]?.queries[0]?.promQL).toBe(
      "sum (sum_over_time(checkout_orders[$__interval]) * 15)",
    );

    const monitors: AlertImportPlan = planAlertImport(
      readImportSource({
        text: JSON.stringify({
          name: "Too many orders",
          type: "query alert",
          query: "sum(last_5m):sum:checkout.orders{*}.as_count() > 100",
          options: {},
        }),
        accepts: ALERT_SOURCE_KINDS,
      }),
      {
        knownMetricKinds: new Map<string, DatadogMetricKind>([
          ["checkout.orders", DatadogMetricKind.Rate],
        ]),
        rateIntervalsInSeconds: new Map<string, number>([
          ["checkout.orders", 15],
        ]),
      },
    );
    const item: AlertImportItem | undefined = monitors.items[0];

    expect(item?.status).toBe(ImportItemStatus.Exact);
    expect(item?.rule?.promQL).toBe(
      "sum (sum_over_time(checkout_orders[1m]) * 15)",
    );
  });
});
