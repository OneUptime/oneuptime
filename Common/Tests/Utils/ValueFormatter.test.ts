import ValueFormatter, { FormattedValue } from "../../Utils/ValueFormatter";

describe("ValueFormatter", () => {
  describe("formatValue - bytes", () => {
    test("scales bytes up to the right unit", () => {
      expect(ValueFormatter.formatValue(1048576, "bytes")).toBe("1.05 MB");
      expect(ValueFormatter.formatValue(1e6, "bytes")).toBe("1 MB");
      expect(ValueFormatter.formatValue(1e9, "bytes")).toBe("1 GB");
      expect(ValueFormatter.formatValue(1e12, "bytes")).toBe("1 TB");
      expect(ValueFormatter.formatValue(1e15, "bytes")).toBe("1 PB");
    });

    test("keeps small byte values in B", () => {
      expect(ValueFormatter.formatValue(512, "bytes")).toBe("512 B");
      expect(ValueFormatter.formatValue(1, "bytes")).toBe("1 B");
    });

    test("recognizes UCUM byte aliases", () => {
      expect(ValueFormatter.formatValue(2000, "By")).toBe("2 KB");
      expect(ValueFormatter.formatValue(2000, "b")).toBe("2 KB");
      expect(ValueFormatter.formatValue(2000, "byte")).toBe("2 KB");
    });

    test("renders 0 bytes with the natural byte unit", () => {
      expect(ValueFormatter.formatValue(0, "bytes")).toBe("0 B");
    });

    test("handles negative byte values", () => {
      expect(ValueFormatter.formatValue(-2000, "bytes")).toBe("-2 KB");
    });
  });

  describe("formatValue - seconds", () => {
    test("scales seconds into larger units", () => {
      expect(ValueFormatter.formatValue(60, "seconds")).toBe("1 min");
      expect(ValueFormatter.formatValue(3600, "seconds")).toBe("1 hours");
      expect(ValueFormatter.formatValue(86400, "seconds")).toBe("1 days");
    });

    test("scales sub-second values down", () => {
      expect(ValueFormatter.formatValue(0.5, "seconds")).toBe("500 ms");
      expect(ValueFormatter.formatValue(0.0005, "seconds")).toBe("500 µs");
    });

    test("renders 0 seconds with the natural second unit, not ns", () => {
      expect(ValueFormatter.formatValue(0, "seconds")).toBe("0 sec");
    });

    test("recognizes second aliases", () => {
      expect(ValueFormatter.formatValue(120, "s")).toBe("2 min");
      expect(ValueFormatter.formatValue(120, "sec")).toBe("2 min");
    });
  });

  describe("formatValue - milliseconds", () => {
    test("scales milliseconds into seconds and beyond", () => {
      expect(ValueFormatter.formatValue(1000, "ms")).toBe("1 sec");
      expect(ValueFormatter.formatValue(60000, "ms")).toBe("1 min");
    });

    test("keeps small ms values", () => {
      expect(ValueFormatter.formatValue(5, "ms")).toBe("5 ms");
    });

    test("renders 0 ms with the natural ms unit", () => {
      expect(ValueFormatter.formatValue(0, "ms")).toBe("0 ms");
    });
  });

  describe("formatValue - percent", () => {
    test("renders percent inline with two decimals", () => {
      expect(ValueFormatter.formatValue(42, "%")).toBe("42.00%");
      expect(ValueFormatter.formatValue(100, "%")).toBe("100.00%");
      expect(ValueFormatter.formatValue(2.04, "%")).toBe("2.04%");
    });

    test("treats spelled-out percent variants the same", () => {
      expect(ValueFormatter.formatValue(50, "percent")).toBe("50.00%");
      expect(ValueFormatter.formatValue(50, "percentage")).toBe("50.00%");
      expect(ValueFormatter.formatValue(50, "pct")).toBe("50.00%");
    });

    test("non-finite percent falls back to 0.00", () => {
      expect(ValueFormatter.formatValue(Infinity, "%")).toBe("0.00%");
      expect(ValueFormatter.formatValue(NaN, "%")).toBe("0.00%");
    });
  });

  describe("formatValue - dimensionless and fraction metrics", () => {
    test("dimensionless unit '1' renders a bare number", () => {
      expect(ValueFormatter.formatValue(1234, "1")).toBe("1.23K");
      expect(ValueFormatter.formatValue(5, "1")).toBe("5");
    });

    test("empty unit renders a bare number", () => {
      expect(ValueFormatter.formatValue(5, "")).toBe("5");
    });

    test("fraction metric with unit '1' renders as a percentage", () => {
      expect(
        ValueFormatter.formatValue(0.25, "1", {
          metricName: "system.cpu.utilization",
        }),
      ).toBe("25.00%");
      expect(
        ValueFormatter.formatValue(0.5, "1", {
          metricName: "db.client.connection.usage_ratio",
        }),
      ).toBe("50.00%");
    });

    test("non-fraction metric with unit '1' stays a bare number", () => {
      expect(
        ValueFormatter.formatValue(0.25, "1", {
          metricName: "http.server.request.count",
        }),
      ).toBe("0.25");
    });
  });

  describe("formatValue - annotation-only units", () => {
    test("renders bare number for UCUM annotation units", () => {
      expect(ValueFormatter.formatValue(42, "{thread}")).toBe("42");
      expect(ValueFormatter.formatValue(1500, "{packets}")).toBe("1.5K");
    });
  });

  describe("formatValue - compound rate units", () => {
    test("scales the numerator and keeps a compact denominator", () => {
      expect(ValueFormatter.formatValue(1500000, "By/s")).toBe("1.5 MB/s");
      expect(ValueFormatter.formatValue(2000, "bytes/s")).toBe("2 KB/s");
    });

    test("falls back to readable form for unknown numerator", () => {
      expect(ValueFormatter.formatValue(5, "requests/s")).toBe(
        "5 requests per Second",
      );
    });
  });

  describe("formatValue - unknown units", () => {
    test("formats number and appends a readable unit name", () => {
      expect(ValueFormatter.formatValue(10, "hz")).toBe("10 Hertz");
      expect(ValueFormatter.formatValue(5, "v")).toBe("5 Volts");
    });

    test("keeps the original unit when unrecognized", () => {
      expect(ValueFormatter.formatValue(5, "widgets")).toBe("5 widgets");
    });
  });

  describe("formatValue - large number abbreviation", () => {
    test("abbreviates thousands, millions, billions", () => {
      expect(ValueFormatter.formatValue(5000, "widgets")).toBe("5K widgets");
      expect(ValueFormatter.formatValue(1500000, "widgets")).toBe(
        "1.5M widgets",
      );
      expect(ValueFormatter.formatValue(2000000000, "widgets")).toBe(
        "2B widgets",
      );
    });

    test("trims trailing zeros but keeps distinguishing decimals", () => {
      expect(ValueFormatter.formatValue(119250000000, "widgets")).toBe(
        "119.25B widgets",
      );
    });
  });

  describe("formatValue - small number precision", () => {
    test("keeps two significant digits below 1", () => {
      expect(ValueFormatter.formatValue(0.004, "widgets")).toBe(
        "0.004 widgets",
      );
      expect(ValueFormatter.formatValue(0.006, "widgets")).toBe(
        "0.006 widgets",
      );
    });

    test("expands very small numbers out of exponential notation", () => {
      const result: string = ValueFormatter.formatValue(0.00000012, "widgets");
      // Should not fall back to exponential notation like "1.2e-7".
      expect(result).not.toMatch(/e[+-]/i);
      expect(result).toContain("0.00000012");
    });
  });

  describe("isPercentUnit", () => {
    test("returns true for percent variants", () => {
      expect(ValueFormatter.isPercentUnit("%")).toBe(true);
      expect(ValueFormatter.isPercentUnit("percent")).toBe(true);
      expect(ValueFormatter.isPercentUnit("PERCENTAGE")).toBe(true);
      expect(ValueFormatter.isPercentUnit(" pct ")).toBe(true);
    });

    test("returns false otherwise", () => {
      expect(ValueFormatter.isPercentUnit("bytes")).toBe(false);
      expect(ValueFormatter.isPercentUnit(undefined)).toBe(false);
      expect(ValueFormatter.isPercentUnit("")).toBe(false);
    });
  });

  describe("isFractionMetric", () => {
    test("matches utilization/ratio/fraction/percent suffixes", () => {
      expect(ValueFormatter.isFractionMetric("system.cpu.utilization")).toBe(
        true,
      );
      expect(ValueFormatter.isFractionMetric("some_ratio")).toBe(true);
      expect(ValueFormatter.isFractionMetric("mem.fraction")).toBe(true);
      expect(ValueFormatter.isFractionMetric("disk_percentage")).toBe(true);
    });

    test("does not match unrelated names", () => {
      expect(ValueFormatter.isFractionMetric("request.count")).toBe(false);
      expect(ValueFormatter.isFractionMetric(undefined)).toBe(false);
      expect(ValueFormatter.isFractionMetric("")).toBe(false);
    });

    /*
     * The two kubeletstats cores gauges are misnamed. `.utilization` is a
     * lie the OTel receiver tells: the value is CPU *cores in use*
     * (UsageNanoCores / 1e9) with unit "1", not a [0, 1] ratio. Before
     * this exclusion an 0.1831-core pod rendered as "18.31%" with a
     * "Percent" axis, on the very page that also showed it at 91.55% of
     * its CPU limit. Reverting the guard flips every assertion below.
     */
    test("the two kubeletstats cores gauges are NOT fractions", () => {
      expect(ValueFormatter.isFractionMetric("k8s.pod.cpu.utilization")).toBe(
        false,
      );
      expect(ValueFormatter.isFractionMetric("k8s.node.cpu.utilization")).toBe(
        false,
      );
    });

    test("the exclusion is anchored, not a prefix or substring match", () => {
      /*
       * Kept deliberately narrow so a future widening has to be a
       * conscious edit. These four still multiply by 100.
       */
      expect(
        ValueFormatter.isFractionMetric("k8s.pod.memory.utilization"),
      ).toBe(true);
      expect(
        ValueFormatter.isFractionMetric("k8s.pod.cpu_limit_utilization"),
      ).toBe(true);
      expect(
        ValueFormatter.isFractionMetric(
          "k8s.container.cpu_request_utilization",
        ),
      ).toBe(true);
      // Emitted by BOTH kubeletstats and docker_stats; scale is contested.
      expect(ValueFormatter.isFractionMetric("container.cpu.utilization")).toBe(
        true,
      );
      // Not anchored at the start: a decorated name is still a ratio.
      expect(
        ValueFormatter.isFractionMetric("prefix.k8s.pod.cpu.utilization"),
      ).toBe(true);
    });

    test("the exclusion ignores surrounding whitespace and case", () => {
      expect(
        ValueFormatter.isFractionMetric("  k8s.pod.cpu.utilization  "),
      ).toBe(false);
      expect(ValueFormatter.isFractionMetric("K8S.Node.CPU.Utilization")).toBe(
        false,
      );
    });
  });

  describe("kubeletstats cores gauges render as cores, never as a percent", () => {
    /*
     * These pin the user-visible half of the same defect. Each case is
     * paired with the genuine OTel ratio metric so the two behaviours are
     * visibly contrasted: system.cpu.utilization really is a [0, 1]
     * fraction and must keep scaling by 100.
     */
    test("formatValue renders 0.1831 cores as a bare number", () => {
      expect(
        ValueFormatter.formatValue(0.1831, "1", {
          metricName: "k8s.pod.cpu.utilization",
        }),
      ).toBe("0.18");
      expect(
        ValueFormatter.formatValue(0.1831, "1", {
          metricName: "k8s.node.cpu.utilization",
        }),
      ).toBe("0.18");

      // The reported dashboard string must not come back.
      expect(
        ValueFormatter.formatValue(0.1831, "1", {
          metricName: "k8s.pod.cpu.utilization",
        }),
      ).not.toContain("%");

      // The genuine ratio metric is untouched.
      expect(
        ValueFormatter.formatValue(0.25, "1", {
          metricName: "system.cpu.utilization",
        }),
      ).toBe("25.00%");
    });

    test("a multi-core pod is not reported as a four-figure percentage", () => {
      // 1.4 cores used to render as "140.00%".
      expect(
        ValueFormatter.formatValue(1.4, "1", {
          metricName: "k8s.node.cpu.utilization",
        }),
      ).toBe("1.4");
    });

    test("getReadableUnit does not label the axis 'Percent'", () => {
      expect(
        ValueFormatter.getReadableUnit("1", {
          metricName: "k8s.pod.cpu.utilization",
        }),
      ).toBe("");
      expect(
        ValueFormatter.getReadableUnit("1", {
          metricName: "k8s.node.cpu.utilization",
        }),
      ).toBe("");
      expect(
        ValueFormatter.getReadableUnit("1", {
          metricName: "system.cpu.utilization",
        }),
      ).toBe("Percent");
    });

    test("getCompactUnit does not label the tile '%'", () => {
      expect(
        ValueFormatter.getCompactUnit("1", {
          metricName: "k8s.pod.cpu.utilization",
        }),
      ).toBe("");
      expect(
        ValueFormatter.getCompactUnit("1", {
          metricName: "k8s.node.cpu.utilization",
        }),
      ).toBe("");
      expect(
        ValueFormatter.getCompactUnit("1", {
          metricName: "system.cpu.utilization",
        }),
      ).toBe("%");
    });

    test("value and unit label agree — neither scales without the other", () => {
      /*
       * The failure this guards is the divergent pair: a value left in
       * cores beside a unit still reading "Percent". formatValueCompact
       * returns both halves from one call, so they cannot drift.
       */
      const parts: FormattedValue = ValueFormatter.formatValueCompact(
        0.1831,
        "1",
        { metricName: "k8s.pod.cpu.utilization" },
      );
      expect(parts.value).toBe("0.18");
      expect(parts.unit).toBe("");
      expect(parts.formatted).toBe("0.18");
    });
  });

  describe("isHigherWorseMetric", () => {
    test("returns false for higher-is-better metrics", () => {
      expect(
        ValueFormatter.isHigherWorseMetric("oneuptime.monitor.online"),
      ).toBe(false);
      expect(ValueFormatter.isHigherWorseMetric("service.uptime")).toBe(false);
      expect(ValueFormatter.isHigherWorseMetric("availability_percent")).toBe(
        false,
      );
    });

    test("returns true for higher-is-worse metrics", () => {
      expect(ValueFormatter.isHigherWorseMetric("http.error.count")).toBe(true);
      expect(ValueFormatter.isHigherWorseMetric("incident.count")).toBe(true);
      expect(ValueFormatter.isHigherWorseMetric("request.latency")).toBe(true);
      expect(ValueFormatter.isHigherWorseMetric("cpu.utilization")).toBe(true);
      expect(ValueFormatter.isHigherWorseMetric("pod.restart")).toBe(true);
    });

    test("returns false for neutral counters and undefined", () => {
      expect(ValueFormatter.isHigherWorseMetric("network.bytes")).toBe(false);
      expect(ValueFormatter.isHigherWorseMetric(undefined)).toBe(false);
    });

    test("higher-is-better token wins over higher-is-worse token", () => {
      // Contains both "uptime" (better) and would otherwise be neutral.
      expect(ValueFormatter.isHigherWorseMetric("system.uptime.seconds")).toBe(
        false,
      );
    });
  });

  describe("isScalableUnit", () => {
    test("true for known scalable units", () => {
      expect(ValueFormatter.isScalableUnit("bytes")).toBe(true);
      expect(ValueFormatter.isScalableUnit("ms")).toBe(true);
      expect(ValueFormatter.isScalableUnit("By")).toBe(true);
    });

    test("false for empty or unknown units", () => {
      expect(ValueFormatter.isScalableUnit("")).toBe(false);
      expect(ValueFormatter.isScalableUnit("   ")).toBe(false);
      expect(ValueFormatter.isScalableUnit("%")).toBe(false);
      expect(ValueFormatter.isScalableUnit("widgets")).toBe(false);
    });
  });

  describe("getReadableUnit", () => {
    test("maps UCUM codes to readable names", () => {
      expect(ValueFormatter.getReadableUnit("By")).toBe("Bytes");
      expect(ValueFormatter.getReadableUnit("s")).toBe("Seconds");
      expect(ValueFormatter.getReadableUnit("ms")).toBe("Milliseconds");
    });

    test("dimensionless returns empty string", () => {
      expect(ValueFormatter.getReadableUnit("1")).toBe("");
      expect(ValueFormatter.getReadableUnit("")).toBe("");
    });

    test("fraction metric with '1' returns Percent", () => {
      expect(
        ValueFormatter.getReadableUnit("1", {
          metricName: "cpu.utilization",
        }),
      ).toBe("Percent");
    });

    test("percent variants return Percent", () => {
      expect(ValueFormatter.getReadableUnit("%")).toBe("Percent");
      expect(ValueFormatter.getReadableUnit("pct")).toBe("Percent");
    });

    test("annotation-only unit is capitalized", () => {
      expect(ValueFormatter.getReadableUnit("{thread}")).toBe("Thread");
      expect(ValueFormatter.getReadableUnit("{packets}")).toBe("Packets");
    });

    test("compound rate unit reads as 'X per Y' with singular denominator", () => {
      expect(ValueFormatter.getReadableUnit("By/s")).toBe("Bytes per Second");
    });

    test("unknown unit is returned unchanged", () => {
      expect(ValueFormatter.getReadableUnit("widgets")).toBe("widgets");
    });
  });

  /*
   * `formatValue` was refactored to delegate to a shared core that can emit
   * either the spelled-out unit name or its symbol. Its readable output must
   * not have moved by a single character: it feeds chart axis ticks, threshold
   * annotations, the gauge widget and the metric list. This table walks every
   * branch of that core and pins the readable result.
   */
  describe("formatValue - no drift after the shared-core extraction", () => {
    interface NoDriftCase {
      value: number;
      unit: string;
      options?: { metricName?: string } | undefined;
      expected: string;
    }

    const cases: Array<NoDriftCase> = [
      { value: 23.5, unit: "Cel", expected: "23.5 Celsius" },
      { value: 12, unit: "ug/m3", expected: "12 ug per m3" },
      { value: 23.5, unit: "%", expected: "23.50%" },
      { value: 1536, unit: "By", expected: "1.54 KB" },
      { value: 0, unit: "By", expected: "0 B" },
      { value: -2000, unit: "bytes", expected: "-2 KB" },
      { value: 90, unit: "s", expected: "1.5 min" },
      { value: 3600, unit: "seconds", expected: "1 hours" },
      { value: 86400, unit: "seconds", expected: "1 days" },
      { value: 0, unit: "seconds", expected: "0 sec" },
      { value: 0.5, unit: "seconds", expected: "500 ms" },
      { value: 1500, unit: "ms", expected: "1.5 sec" },
      { value: 42, unit: "1", expected: "42" },
      { value: 1234, unit: "1", expected: "1.23K" },
      {
        value: 0.25,
        unit: "1",
        options: { metricName: "system.cpu.utilization" },
        expected: "25.00%",
      },
      { value: 42, unit: "{thread}", expected: "42" },
      { value: 1500000, unit: "By/s", expected: "1.5 MB/s" },
      { value: 2000, unit: "bytes/s", expected: "2 KB/s" },
      { value: 5, unit: "requests/s", expected: "5 requests per Second" },
      { value: 98.6, unit: "[degF]", expected: "98.6 Fahrenheit" },
      { value: 10, unit: "hz", expected: "10 Hertz" },
      { value: 5, unit: "v", expected: "5 Volts" },
      { value: 5, unit: "widgets", expected: "5 widgets" },
      { value: 7, unit: "St", expected: "7 St" },
      { value: 42, unit: "", expected: "42" },
    ];

    test.each(cases)(
      "formatValue($value, '$unit') stays '$expected'",
      (noDriftCase: NoDriftCase) => {
        expect(
          ValueFormatter.formatValue(
            noDriftCase.value,
            noDriftCase.unit,
            noDriftCase.options,
          ),
        ).toBe(noDriftCase.expected);
      },
    );
  });

  describe("getCompactUnit", () => {
    test("maps UCUM codes to their symbols", () => {
      expect(ValueFormatter.getCompactUnit("By")).toBe("B");
      expect(ValueFormatter.getCompactUnit("Cel")).toBe("°C");
      expect(ValueFormatter.getCompactUnit("[degF]")).toBe("°F");
      expect(ValueFormatter.getCompactUnit("kW")).toBe("kW");
      expect(ValueFormatter.getCompactUnit("hz")).toBe("Hz");
      expect(ValueFormatter.getCompactUnit("ms")).toBe("ms");
      expect(ValueFormatter.getCompactUnit("microseconds")).toBe("µs");
      expect(ValueFormatter.getCompactUnit("hours")).toBe("h");
    });

    test("is case-insensitive", () => {
      expect(ValueFormatter.getCompactUnit("CEL")).toBe("°C");
      expect(ValueFormatter.getCompactUnit("by")).toBe("B");
      expect(ValueFormatter.getCompactUnit("  Cel  ")).toBe("°C");
    });

    test("percent and dimensionless behave like getReadableUnit's contract", () => {
      expect(ValueFormatter.getCompactUnit("%")).toBe("%");
      expect(ValueFormatter.getCompactUnit("pct")).toBe("%");
      expect(ValueFormatter.getCompactUnit("1")).toBe("");
      expect(ValueFormatter.getCompactUnit("")).toBe("");
      expect(
        ValueFormatter.getCompactUnit("1", { metricName: "cpu.utilization" }),
      ).toBe("%");
    });

    test("annotation-only units carry no suffix at all", () => {
      /*
       * formatValue already drops them from the number, so the compact unit is
       * empty rather than getReadableUnit's capitalised "Thread" — a widget
       * that showed "42 Thread" next to a big number would be spending width
       * on a word the metric name already says.
       */
      expect(ValueFormatter.getCompactUnit("{thread}")).toBe("");
      expect(ValueFormatter.getCompactUnit("{packets}")).toBe("");
    });

    test("compound units keep the slash rather than spelling out 'per'", () => {
      expect(ValueFormatter.getCompactUnit("By/s")).toBe("B/s");
      expect(ValueFormatter.getCompactUnit("ug/m3")).toBe("ug/m3");
      expect(ValueFormatter.getCompactUnit("m/s")).toBe("m/s");
      expect(ValueFormatter.getCompactUnit("requests/s")).toBe("requests/s");
    });

    test("unknown units are returned unchanged", () => {
      expect(ValueFormatter.getCompactUnit("widgets")).toBe("widgets");
      expect(ValueFormatter.getCompactUnit("rad")).toBe("rad");
      expect(ValueFormatter.getCompactUnit("St")).toBe("St");
    });

    test("ambiguous single letters echo the exporter's own code", () => {
      /*
       * These are the keys readableUnitMap resolves ambiguously, so the
       * compact map deliberately omits them and they fall through to the code
       * the exporter actually wrote. Mapping them would assert a reading we
       * cannot justify: in UCUM "a" is the annum, not the ampere, and "b" is
       * the bel rather than the bit or the byte. Echoing the code is both
       * shorter than the spelled-out guess and honest about the ambiguity.
       *
       * Casing is preserved for the same reason — "K" for kelvin is what the
       * metric declared, and it is worth keeping distinct from the "300K"
       * formatLargeNumber emits for 300000.
       *
       * A later "completeness" change that adds these to the map has to argue
       * with this test.
       */
      expect(ValueFormatter.getCompactUnit("a")).toBe("a");
      expect(ValueFormatter.getCompactUnit("A")).toBe("A");
      expect(ValueFormatter.getCompactUnit("K")).toBe("K");
      expect(ValueFormatter.getReadableUnit("a")).toBe("Amperes");
      expect(ValueFormatter.getReadableUnit("K")).toBe("Kelvin");
    });

    test("bytes still scale through the threshold table, whatever the code", () => {
      // "b" is in unitTableMap, so it never reaches the compact-unit lookup.
      expect(ValueFormatter.formatValueCompact(1536, "b").unit).toBe("KB");
      expect(ValueFormatter.formatValueCompact(512, "b").unit).toBe("B");
    });
  });

  describe("formatValueCompact", () => {
    test("returns the number and the unit as separate parts", () => {
      const parts: FormattedValue = ValueFormatter.formatValueCompact(
        23.5,
        "Cel",
      );

      expect(parts.value).toBe("23.5");
      expect(parts.unit).toBe("°C");
      expect(parts.formatted).toBe("23.5 °C");
    });

    test("splits compound units the string-splitting heuristic got wrong", () => {
      /*
       * These are the exact cases that broke the old widget: it joined the
       * value and unit into one string and then split on the LAST space, so
       * "5 requests per Second" put "requests per" in the big-number span.
       */
      expect(ValueFormatter.formatValueCompact(5, "requests/s")).toEqual({
        value: "5",
        unit: "requests/s",
        formatted: "5 requests/s",
      });
      expect(ValueFormatter.formatValueCompact(12, "ug/m3")).toEqual({
        value: "12",
        unit: "ug/m3",
        formatted: "12 ug/m3",
      });
      expect(ValueFormatter.formatValueCompact(12, "m/s")).toEqual({
        value: "12",
        unit: "m/s",
        formatted: "12 m/s",
      });
      expect(ValueFormatter.formatValueCompact(1.5, "MB/s")).toEqual({
        value: "1.5",
        unit: "MB/s",
        formatted: "1.5 MB/s",
      });
    });

    test("scales the value exactly as formatValue does", () => {
      expect(ValueFormatter.formatValueCompact(1536, "By")).toEqual({
        value: "1.54",
        unit: "KB",
        formatted: "1.54 KB",
      });
      expect(ValueFormatter.formatValueCompact(1500000, "By/s")).toEqual({
        value: "1.5",
        unit: "MB/s",
        formatted: "1.5 MB/s",
      });
      expect(ValueFormatter.formatValueCompact(1234, "1").value).toBe("1.23K");
    });

    test("compacts the suffixes the threshold tables spell out", () => {
      /*
       * A second source of long suffixes the unit map alone cannot reach:
       * formatValue(3600, "s") scales to "1 hours".
       */
      expect(ValueFormatter.formatValueCompact(3600, "s")).toEqual({
        value: "1",
        unit: "h",
        formatted: "1 h",
      });
      expect(ValueFormatter.formatValueCompact(86400, "seconds").unit).toBe(
        "d",
      );
      expect(ValueFormatter.formatValueCompact(0, "seconds").unit).toBe("s");
      expect(ValueFormatter.formatValueCompact(90, "s").unit).toBe("min");
    });

    test("percent joins with no space", () => {
      expect(ValueFormatter.formatValueCompact(23.5, "%")).toEqual({
        value: "23.50",
        unit: "%",
        formatted: "23.50%",
      });
      expect(
        ValueFormatter.formatValueCompact(0.25, "1", {
          metricName: "system.cpu.utilization",
        }),
      ).toEqual({ value: "25.00", unit: "%", formatted: "25.00%" });
    });

    test("dimensionless and annotation-only units carry no suffix", () => {
      expect(ValueFormatter.formatValueCompact(42, "{thread}")).toEqual({
        value: "42",
        unit: "",
        formatted: "42",
      });
      expect(ValueFormatter.formatValueCompact(42, "1")).toEqual({
        value: "42",
        unit: "",
        formatted: "42",
      });
      expect(ValueFormatter.formatValueCompact(42, "")).toEqual({
        value: "42",
        unit: "",
        formatted: "42",
      });
    });

    test("is never longer than the readable form, and usually much shorter", () => {
      const units: Array<string> = [
        "Cel",
        "[degF]",
        "kW",
        "ms",
        "By",
        "hz",
        "ug/m3",
        "s",
      ];

      for (const unit of units) {
        const compact: FormattedValue = ValueFormatter.formatValueCompact(
          42,
          unit,
        );
        const readable: string = ValueFormatter.formatValue(42, unit);

        expect(compact.formatted.length).toBeLessThanOrEqual(readable.length);
      }
    });

    test("keeps the value identical to formatValue for every branch", () => {
      const units: Array<string> = [
        "Cel",
        "%",
        "By",
        "s",
        "ms",
        "1",
        "{thread}",
        "By/s",
        "ug/m3",
        "widgets",
      ];

      for (const unit of units) {
        for (const value of [0, 0.25, 42, 1536, 1500000]) {
          const compact: FormattedValue = ValueFormatter.formatValueCompact(
            value,
            unit,
          );
          const readable: string = ValueFormatter.formatValue(value, unit);

          // The numeric portion never changes — only how the unit is spelled.
          expect(readable.startsWith(compact.value)).toBe(true);
        }
      }
    });
  });
});
