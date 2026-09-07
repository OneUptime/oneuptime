import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import ValueFormatter from "../../../Utils/ValueFormatter";
import { describe, expect, test } from "@jest/globals";

/*
 * How a metric value is written into an alert or incident.
 *
 * The behaviour has three tiers and every test below belongs to one:
 *
 *   1. The unit names a SCALE LADDER (bytes, seconds and their prefixed
 *      members) — the value is rescaled the way the dashboard rescales it,
 *      so 1073741824 By reads "1.07 GB".
 *   2. The unit names a dimension but NO ladder (cores, Celsius, ops) —
 *      the unit symbol is appended and the digits are left alone,
 *      because an
 *      alert reader needs to tell 1500 restarts from 1549 and "1.5K" does
 *      not let them.
 *   3. The unit names NO dimension ("", "1" on a counter, "{restarts}",
 *      the catalogs' "count") — the number stands on its own.
 */
describe("MetricValueFormatter", () => {
  describe("format — units with a scale ladder", () => {
    test("scales bytes the way the dashboard does", () => {
      expect(MetricValueFormatter.format({ value: 0, unit: "By" })).toBe("0 B");
      expect(MetricValueFormatter.format({ value: 512, unit: "By" })).toBe(
        "512 B",
      );
      expect(MetricValueFormatter.format({ value: 1000, unit: "By" })).toBe(
        "1 KB",
      );
      expect(
        MetricValueFormatter.format({ value: 1048576, unit: "bytes" }),
      ).toBe("1.05 MB");
      expect(
        MetricValueFormatter.format({ value: 1073741824, unit: "By" }),
      ).toBe("1.07 GB");
      expect(
        MetricValueFormatter.format({ value: 1099511627776, unit: "bytes" }),
      ).toBe("1.1 TB");
    });

    test("scales time units", () => {
      expect(MetricValueFormatter.format({ value: 750, unit: "ms" })).toBe(
        "750 ms",
      );
      expect(MetricValueFormatter.format({ value: 1500, unit: "ms" })).toBe(
        "1.5 sec",
      );
      expect(
        MetricValueFormatter.format({ value: 3661, unit: "seconds" }),
      ).toBe("1.02 hours");
      expect(MetricValueFormatter.format({ value: 1500, unit: "ns" })).toBe(
        "1.5 µs",
      );
      expect(MetricValueFormatter.format({ value: 0, unit: "seconds" })).toBe(
        "0 sec",
      );
    });

    /*
     * A user who types a threshold in "GB" makes every sample arrive
     * carrying the unit "GB". ValueFormatter has a ladder for "bytes" but
     * not for "GB", so on its own it rendered 2500 of them as "2.5K GB".
     * The value is restated in the family's base unit first.
     */
    test("rescales a PREFIXED unit through its family base", () => {
      expect(MetricValueFormatter.format({ value: 2500, unit: "GB" })).toBe(
        "2.5 TB",
      );
      expect(MetricValueFormatter.format({ value: 2, unit: "GB" })).toBe(
        "2 GB",
      );
      expect(MetricValueFormatter.format({ value: 0.5, unit: "MB" })).toBe(
        "500 KB",
      );
      expect(MetricValueFormatter.format({ value: 1500, unit: "KB" })).toBe(
        "1.5 MB",
      );
      expect(MetricValueFormatter.format({ value: 36, unit: "hours" })).toBe(
        "1.5 days",
      );
      expect(MetricValueFormatter.format({ value: 5, unit: "min" })).toBe(
        "5 min",
      );
      expect(MetricValueFormatter.format({ value: 90, unit: "min" })).toBe(
        "1.5 hours",
      );
    });

    test("scales the numerator of a rate unit and keeps the denominator", () => {
      expect(
        MetricValueFormatter.format({ value: 1500000, unit: "By/s" }),
      ).toBe("1.5 MB/s");
      expect(MetricValueFormatter.format({ value: 2.5, unit: "GB/s" })).toBe(
        "2.5 GB/s",
      );
      expect(MetricValueFormatter.format({ value: 2000, unit: "GB/s" })).toBe(
        "2 TB/s",
      );
    });

    test("a rate whose numerator has no ladder keeps its digits", () => {
      expect(
        MetricValueFormatter.format({ value: 1500, unit: "requests/s" }),
      ).toBe("1500 requests/s");
    });

    test("negatives keep their sign through the ladder", () => {
      expect(MetricValueFormatter.format({ value: -2048, unit: "bytes" })).toBe(
        "-2.05 KB",
      );
      expect(MetricValueFormatter.format({ value: -1500, unit: "ms" })).toBe(
        "-1.5 sec",
      );
    });
  });

  describe("format — percent and fraction metrics", () => {
    test("percent units render inline with two decimals", () => {
      expect(MetricValueFormatter.format({ value: 87.5, unit: "%" })).toBe(
        "87.50%",
      );
      expect(MetricValueFormatter.format({ value: 100, unit: "percent" })).toBe(
        "100.00%",
      );
      expect(MetricValueFormatter.format({ value: 2.04, unit: "pct" })).toBe(
        "2.04%",
      );
    });

    /*
     * The flagship case: a ratio metric whose samples are fractions in
     * [0, 1] carrying OTel's dimensionless "1". The alert used to say
     * "0.06 1"; the dashboard has always said "5.85%".
     */
    test("a [0,1] fraction on a ratio metric becomes a percentage", () => {
      expect(
        MetricValueFormatter.format({
          value: 0.0585,
          unit: "1",
          metricName: "system.cpu.utilization",
        }),
      ).toBe("5.85%");
      expect(
        MetricValueFormatter.format({
          value: 0.2534,
          unit: "1",
          metricName: "db.client.connection.usage_ratio",
        }),
      ).toBe("25.34%");
    });

    /*
     * kubeletstats reports these two as CPU CORES despite the
     * `.utilization` name, and ValueFormatter.isFractionMetric excludes
     * them by exact name. Four other places in the repo depend on that
     * exclusion; this pins that the alert path honours it too, so 0.18
     * cores never reads as "18.31%".
     */
    test("the kubeletstats cores gauges are NOT treated as fractions", () => {
      expect(
        MetricValueFormatter.format({
          value: 0.1831,
          unit: "1",
          metricName: "k8s.pod.cpu.utilization",
        }),
      ).toBe("0.18");
      expect(
        MetricValueFormatter.format({
          value: 0.1831,
          unit: "1",
          metricName: "k8s.node.cpu.utilization",
        }),
      ).toBe("0.18");
    });

    test("a fraction unit with no metric name stays a bare number", () => {
      expect(MetricValueFormatter.format({ value: 0.25, unit: "1" })).toBe(
        "0.25",
      );
    });

    /*
     * The catalogs spell the dimensionless fraction "ratio". It means what
     * "1" means, so it needs the same metric-name signal before it can be
     * shown as a percentage.
     */
    test("the catalogs' 'ratio' behaves exactly like '1'", () => {
      expect(
        MetricValueFormatter.format({
          value: 0.97,
          unit: "ratio",
          metricName: "pve_cpu_usage_ratio",
        }),
      ).toBe("97.00%");
      expect(MetricValueFormatter.format({ value: 0.97, unit: "ratio" })).toBe(
        "0.97",
      );
    });

    /*
     * Values reaching this formatter have ALREADY been converted into the
     * threshold unit by MetricMonitorCriteria, so a ratio metric whose
     * threshold is in "%" arrives pre-multiplied. Re-applying the fraction
     * heuristic there would report 6% as 600%.
     */
    test("does not double-scale a value already converted into percent", () => {
      expect(
        MetricValueFormatter.format({
          value: 6,
          unit: "%",
          metricName: "system.cpu.utilization",
        }),
      ).toBe("6.00%");
    });
  });

  describe("format — units with a dimension but no ladder", () => {
    test("appends the unit symbol and leaves every digit alone", () => {
      expect(MetricValueFormatter.format({ value: 0.42, unit: "cores" })).toBe(
        "0.42 cores",
      );
      expect(
        MetricValueFormatter.format({ value: 1234567, unit: "cores" }),
      ).toBe("1234567 cores");
      expect(MetricValueFormatter.format({ value: 95, unit: "Cel" })).toBe(
        "95 °C",
      );
      expect(MetricValueFormatter.format({ value: 1500, unit: "kbit" })).toBe(
        "1500 kbit",
      );
      expect(MetricValueFormatter.format({ value: 1024, unit: "KiBy" })).toBe(
        "1024 KiB",
      );
      expect(MetricValueFormatter.format({ value: 4200, unit: "ops" })).toBe(
        "4200 ops",
      );
    });

    /*
     * This is the whole reason the formatter is not a bare call to
     * ValueFormatter: on a chart axis "1.23M cores" is right, in an alert
     * the exact count is the thing the reader came for.
     */
    test("does NOT abbreviate large numbers the way a chart axis would", () => {
      expect(ValueFormatter.formatValue(1234567, "cores")).toBe("1.23M cores");
      expect(
        MetricValueFormatter.format({ value: 1234567, unit: "cores" }),
      ).toBe("1234567 cores");
    });

    test("rounds a non-integer to two decimals", () => {
      expect(MetricValueFormatter.format({ value: 3.14159, unit: "ops" })).toBe(
        "3.14 ops",
      );
      expect(MetricValueFormatter.format({ value: 2.5, unit: "ops" })).toBe(
        "2.5 ops",
      );
    });
  });

  describe("format — units that name no dimension", () => {
    test("no unit at all leaves the number exactly as it was", () => {
      expect(MetricValueFormatter.format({ value: 97 })).toBe("97");
      expect(MetricValueFormatter.format({ value: 5000 })).toBe("5000");
      expect(MetricValueFormatter.format({ value: 250, unit: "" })).toBe("250");
      expect(MetricValueFormatter.format({ value: 12, unit: null })).toBe("12");
      expect(MetricValueFormatter.format({ value: 12, unit: "   " })).toBe(
        "12",
      );
    });

    test("rounds a bare non-integer to two decimals", () => {
      // A count metric arrives as a float from an aggregation.
      expect(MetricValueFormatter.format({ value: 2.3333333333333335 })).toBe(
        "2.33",
      );
      expect(MetricValueFormatter.format({ value: 0.9712 })).toBe("0.97");
      // Trailing zeros are dropped: 1.50 reads "1.5".
      expect(MetricValueFormatter.format({ value: 1.5 })).toBe("1.5");
    });

    test("UCUM annotation-only units are dropped", () => {
      expect(
        MetricValueFormatter.format({ value: 1500, unit: "{restarts}" }),
      ).toBe("1500");
      expect(MetricValueFormatter.format({ value: 42, unit: "{cpu}" })).toBe(
        "42",
      );
      expect(MetricValueFormatter.format({ value: 7, unit: "{packets}" })).toBe(
        "7",
      );
    });

    test("the catalogs' 'count' is dropped like the dimensionless '1'", () => {
      expect(MetricValueFormatter.format({ value: 250, unit: "count" })).toBe(
        "250",
      );
      expect(MetricValueFormatter.format({ value: 12, unit: "COUNT" })).toBe(
        "12",
      );
    });

    test("the dimensionless '1' on a counter is dropped", () => {
      expect(
        MetricValueFormatter.format({
          value: 0.31,
          unit: "1",
          metricName: "browser.cumulative_layout_shift",
        }),
      ).toBe("0.31");
    });
  });

  /*
   * Three Proxmox catalog entries declare `unit: "seconds"` for a value
   * that is a Unix epoch, not a duration. Run through the time ladder,
   * an epoch of 1750000000 renders "20.25K days" — which does not just
   * fail to help, it actively misleads: a replication job that synced a
   * minute ago reads as 55 years stale.
   */
  describe("format — metrics whose 'seconds' is a point in time", () => {
    test("epoch timestamps keep their digits instead of becoming durations", () => {
      for (const metricName of [
        "pve_replication_last_sync_timestamp_seconds",
        "pve_replication_last_try_timestamp_seconds",
        "pve_replication_next_sync_timestamp_seconds",
      ]) {
        expect(
          MetricValueFormatter.format({
            value: 1750000000,
            unit: "seconds",
            metricName: metricName,
          }),
        ).toBe("1750000000 s");
      }
    });

    test("the ladder is what would otherwise mislead", () => {
      expect(ValueFormatter.formatValue(1750000000, "seconds")).toBe(
        "20.25K days",
      );
    });

    test("recognises the shapes a timestamp metric name takes", () => {
      expect(
        MetricValueFormatter.isAbsoluteTimestampMetric(
          "pve_replication_last_sync_timestamp_seconds",
        ),
      ).toBe(true);
      expect(
        MetricValueFormatter.isAbsoluteTimestampMetric(
          "process.start.timestamp",
        ),
      ).toBe(true);
      expect(
        MetricValueFormatter.isAbsoluteTimestampMetric("build_timestamps"),
      ).toBe(true);
    });

    /*
     * Narrow on purpose. A genuine duration whose name merely mentions
     * time must still scale — this is the control that stops the carve-out
     * from swallowing the common case.
     */
    test("does not swallow genuine durations", () => {
      expect(
        MetricValueFormatter.isAbsoluteTimestampMetric(
          "http.server.request.duration",
        ),
      ).toBe(false);
      expect(
        MetricValueFormatter.isAbsoluteTimestampMetric(
          "timestamp_delta_seconds",
        ),
      ).toBe(false);
      expect(MetricValueFormatter.isAbsoluteTimestampMetric(undefined)).toBe(
        false,
      );

      expect(
        MetricValueFormatter.format({
          value: 3661,
          unit: "seconds",
          metricName: "http.server.request.duration",
        }),
      ).toBe("1.02 hours");
    });

    test("only suppresses the ladder, not the unit label", () => {
      expect(
        MetricValueFormatter.getReadableUnit(
          "seconds",
          "pve_replication_last_sync_timestamp_seconds",
        ),
      ).toBe("Seconds");
    });
  });

  describe("format — non-finite values", () => {
    /*
     * ValueFormatter has no non-finite guard outside its percent branch:
     * formatLargeNumber divides Infinity by 1e15, gets Infinity, and
     * appends the "P" suffix. Anything routed through it would report a
     * broken metric as "InfinityP PB" in an on-call email.
     */
    test("are reported verbatim, never through the scaling ladder", () => {
      expect(ValueFormatter.formatValue(Infinity, "By")).toBe("InfinityP PB");

      expect(MetricValueFormatter.format({ value: NaN, unit: "By" })).toBe(
        "NaN",
      );
      expect(MetricValueFormatter.format({ value: Infinity, unit: "By" })).toBe(
        "Infinity",
      );
      expect(
        MetricValueFormatter.format({ value: -Infinity, unit: "seconds" }),
      ).toBe("-Infinity");
      expect(MetricValueFormatter.format({ value: NaN })).toBe("NaN");
      expect(MetricValueFormatter.format({ value: NaN, unit: "%" })).toBe(
        "NaN",
      );
    });
  });

  describe("hasDisplayableUnit", () => {
    test("true for units that name a dimension", () => {
      for (const unit of [
        "By",
        "bytes",
        "GB",
        "ms",
        "seconds",
        "%",
        "percent",
        "cores",
        "Cel",
        "ops",
        "By/s",
      ]) {
        expect(MetricValueFormatter.hasDisplayableUnit(unit)).toBe(true);
      }
    });

    test("false for units that do not", () => {
      for (const unit of [
        undefined,
        null,
        "",
        "   ",
        "1",
        "count",
        "counts",
        "{restarts}",
        "{}",
      ]) {
        expect(MetricValueFormatter.hasDisplayableUnit(unit)).toBe(false);
      }
    });

    test("'1' and 'ratio' become displayable on a fraction metric", () => {
      expect(
        MetricValueFormatter.hasDisplayableUnit("1", "system.cpu.utilization"),
      ).toBe(true);
      expect(
        MetricValueFormatter.hasDisplayableUnit("ratio", "pve_cpu_usage_ratio"),
      ).toBe(true);
      expect(
        MetricValueFormatter.hasDisplayableUnit(
          "1",
          "k8s.node.cpu.utilization",
        ),
      ).toBe(false);
    });
  });

  describe("getReadableUnit", () => {
    test("spells UCUM codes out", () => {
      expect(MetricValueFormatter.getReadableUnit("By")).toBe("Bytes");
      expect(MetricValueFormatter.getReadableUnit("ms")).toBe("Milliseconds");
      expect(MetricValueFormatter.getReadableUnit("s")).toBe("Seconds");
      expect(MetricValueFormatter.getReadableUnit("Cel")).toBe("Celsius");
      expect(MetricValueFormatter.getReadableUnit("%")).toBe("Percent");
      expect(MetricValueFormatter.getReadableUnit("By/s")).toBe(
        "Bytes per Second",
      );
    });

    test("echoes a unit it does not recognise", () => {
      expect(MetricValueFormatter.getReadableUnit("cores")).toBe("cores");
      expect(MetricValueFormatter.getReadableUnit("widgets")).toBe("widgets");
    });

    /*
     * Returning null rather than "" is what lets the caller drop the whole
     * "- Unit:" line instead of emitting the noise "- Unit: 1".
     */
    test("returns null when there is no dimension to name", () => {
      expect(MetricValueFormatter.getReadableUnit(undefined)).toBeNull();
      expect(MetricValueFormatter.getReadableUnit(null)).toBeNull();
      expect(MetricValueFormatter.getReadableUnit("")).toBeNull();
      expect(MetricValueFormatter.getReadableUnit("1")).toBeNull();
      expect(MetricValueFormatter.getReadableUnit("count")).toBeNull();
      expect(MetricValueFormatter.getReadableUnit("{restarts}")).toBeNull();
    });

    test("names the percent a fraction metric really carries", () => {
      expect(
        MetricValueFormatter.getReadableUnit("1", "system.cpu.utilization"),
      ).toBe("Percent");
      expect(
        MetricValueFormatter.getReadableUnit("ratio", "pve_cpu_usage_ratio"),
      ).toBe("Percent");
      expect(
        MetricValueFormatter.getReadableUnit("1", "k8s.node.cpu.utilization"),
      ).toBeNull();
    });
  });

  describe("agreement with the dashboard", () => {
    /*
     * The point of reusing ValueFormatter is that an email and the metric
     * explorer say the same thing about the same sample. Where a ladder
     * applies, the two must be byte-identical.
     */
    test("matches ValueFormatter exactly for every ladder unit", () => {
      const cases: Array<[number, string]> = [
        [1073741824, "By"],
        [1048576, "bytes"],
        [512, "By"],
        [1500, "ms"],
        [3661, "seconds"],
        [1500, "ns"],
        [1500000, "By/s"],
        [87.5, "%"],
        [0, "bytes"],
      ];

      for (const [value, unit] of cases) {
        expect(MetricValueFormatter.format({ value: value, unit: unit })).toBe(
          ValueFormatter.formatValue(value, unit),
        );
      }
    });
  });
});
