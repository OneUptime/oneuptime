import { describe, expect, test } from "@jest/globals";
import {
  GRAFANA_DEFAULT_SCRAPE_INTERVAL_IN_SECONDS,
  GRAFANA_MACRO_CHECK_VALUES,
  applyGrafanaIntervalMacros,
  fillGrafanaIntervalMacros,
  getGrafanaIntervalValues,
  hasGrafanaIntervalMacro,
} from "../../../Utils/PromQL/PromQLGrafanaMacros";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";

/*
 * Grafana's interval macros in a widget's PromQL (issue #7697): filled from
 * the window and step the query runs at, as Grafana fills them, so a panel
 * moved over from Grafana reads what it read there.
 */

const HOUR_START: Date = new Date("2026-11-20T10:00:00.000Z");
const HOUR_END: Date = new Date("2026-11-20T11:00:00.000Z");

describe("what each macro stands for", () => {
  test("the interval is the step, never under the scrape interval", () => {
    expect(
      getGrafanaIntervalValues({
        startDate: HOUR_START,
        endDate: HOUR_END,
        stepInSeconds: 60,
      }).intervalInSeconds,
    ).toBe(60);

    // A 10-second step is read at Grafana's 15-second scrape interval.
    expect(
      getGrafanaIntervalValues({
        startDate: HOUR_START,
        endDate: HOUR_END,
        stepInSeconds: 10,
      }).intervalInSeconds,
    ).toBe(GRAFANA_DEFAULT_SCRAPE_INTERVAL_IN_SECONDS);
  });

  test("the rate interval is max(interval + scrape, 4 x scrape), as Grafana works it out", () => {
    // A minute's step: 60 + 15 = 75 seconds, past 4 x 15 = 60.
    expect(
      getGrafanaIntervalValues({
        startDate: HOUR_START,
        endDate: HOUR_END,
        stepInSeconds: 60,
      }).rateIntervalInSeconds,
    ).toBe(75);

    // A 15-second step: 15 + 15 = 30 is under 4 x 15 = 60.
    expect(
      getGrafanaIntervalValues({
        startDate: HOUR_START,
        endDate: HOUR_END,
        stepInSeconds: 15,
      }).rateIntervalInSeconds,
    ).toBe(60);
  });

  test("the range is the window's length, and the step comes from the window when none is given", () => {
    const values: ReturnType<typeof getGrafanaIntervalValues> =
      getGrafanaIntervalValues({ startDate: HOUR_START, endDate: HOUR_END });

    expect(values.rangeInSeconds).toBe(3600);
    // An hour over 250 points is a 15-second step (DataSourceLimits).
    expect(values.intervalInSeconds).toBe(15);
  });
});

describe("filling a query", () => {
  test("each macro, by both of Grafana's spellings", () => {
    const filled: string = applyGrafanaIntervalMacros(
      "rate(a[$__rate_interval]) + rate(b[${__interval}]) + c[$__range] + $__range_s + $__range_ms + $__interval_ms + $__rate_interval_ms",
      { startDate: HOUR_START, endDate: HOUR_END, stepInSeconds: 60 },
    );

    expect(filled).toBe(
      "rate(a[75s]) + rate(b[60s]) + c[3600s] + 3600 + 3600000 + 60000 + 75000",
    );
  });

  test("a longer macro is never read as a shorter one and a suffix", () => {
    expect(
      fillGrafanaIntervalMacros("$__interval_ms", GRAFANA_MACRO_CHECK_VALUES),
    ).toBe("15000");
    expect(
      fillGrafanaIntervalMacros(
        "$__rate_interval_ms",
        GRAFANA_MACRO_CHECK_VALUES,
      ),
    ).toBe("60000");
  });

  test("a name that only starts like a macro is left alone", () => {
    expect(
      fillGrafanaIntervalMacros(
        "$__intervals + $__ranges",
        GRAFANA_MACRO_CHECK_VALUES,
      ),
    ).toBe("$__intervals + $__ranges");
    expect(hasGrafanaIntervalMacro("$__intervals")).toBe(false);
  });

  test("a query with no macro comes back as it was", () => {
    const query: string =
      'sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))';

    expect(hasGrafanaIntervalMacro(query)).toBe(false);
    expect(
      applyGrafanaIntervalMacros(query, {
        startDate: HOUR_START,
        endDate: HOUR_END,
      }),
    ).toBe(query);
  });

  test("a filled query parses with OneUptime's PromQL parser", () => {
    const filled: string = applyGrafanaIntervalMacros(
      '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval])))',
      { startDate: HOUR_START, endDate: HOUR_END, stepInSeconds: 60 },
    );

    expect(() => {
      parsePromQL(filled);
    }).not.toThrow();
  });

  test("the macros are read the same however often they are asked", () => {
    const query: string = "rate(a[$__rate_interval])";

    expect(hasGrafanaIntervalMacro(query)).toBe(true);
    expect(hasGrafanaIntervalMacro(query)).toBe(true);
  });
});
