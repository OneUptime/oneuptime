import ValueFormatter, {
  FormattedValue,
  ValueFormatterOptions,
} from "../../Utils/ValueFormatter";
import { DASHBOARD_LANGUAGES } from "../Helpers/TranslatedLanguages";
import { getNumberLocale } from "../../Types/DateLanguage";

describe("ValueFormatter", () => {
  describe("formatValue - bytes", () => {
    test("scales bytes up to the right unit", () => {
      expect(ValueFormatter.formatValue(1048576, "bytes")).toBe("1.05\u00A0MB");
      expect(ValueFormatter.formatValue(1e6, "bytes")).toBe("1\u00A0MB");
      expect(ValueFormatter.formatValue(1e9, "bytes")).toBe("1\u00A0GB");
      expect(ValueFormatter.formatValue(1e12, "bytes")).toBe("1\u00A0TB");
      expect(ValueFormatter.formatValue(1e15, "bytes")).toBe("1\u00A0PB");
    });

    test("keeps small byte values in B", () => {
      expect(ValueFormatter.formatValue(512, "bytes")).toBe("512\u00A0B");
      expect(ValueFormatter.formatValue(1, "bytes")).toBe("1\u00A0B");
    });

    test("recognizes UCUM byte aliases", () => {
      expect(ValueFormatter.formatValue(2000, "By")).toBe("2\u00A0KB");
      expect(ValueFormatter.formatValue(2000, "b")).toBe("2\u00A0KB");
      expect(ValueFormatter.formatValue(2000, "byte")).toBe("2\u00A0KB");
    });

    test("renders 0 bytes with the natural byte unit", () => {
      expect(ValueFormatter.formatValue(0, "bytes")).toBe("0\u00A0B");
    });

    test("handles negative byte values", () => {
      expect(ValueFormatter.formatValue(-2000, "bytes")).toBe("-2\u00A0KB");
    });
  });

  describe("formatValue - seconds", () => {
    test("scales seconds into larger units", () => {
      expect(ValueFormatter.formatValue(60, "seconds")).toBe("1\u00A0min");
      expect(ValueFormatter.formatValue(3600, "seconds")).toBe("1\u00A0hours");
      expect(ValueFormatter.formatValue(86400, "seconds")).toBe("1\u00A0days");
    });

    test("scales sub-second values down", () => {
      expect(ValueFormatter.formatValue(0.5, "seconds")).toBe("500\u00A0ms");
      expect(ValueFormatter.formatValue(0.0005, "seconds")).toBe("500\u00A0µs");
    });

    test("renders 0 seconds with the natural second unit, not ns", () => {
      expect(ValueFormatter.formatValue(0, "seconds")).toBe("0\u00A0sec");
    });

    test("recognizes second aliases", () => {
      expect(ValueFormatter.formatValue(120, "s")).toBe("2\u00A0min");
      expect(ValueFormatter.formatValue(120, "sec")).toBe("2\u00A0min");
    });
  });

  describe("formatValue - milliseconds", () => {
    test("scales milliseconds into seconds and beyond", () => {
      expect(ValueFormatter.formatValue(1000, "ms")).toBe("1\u00A0sec");
      expect(ValueFormatter.formatValue(60000, "ms")).toBe("1\u00A0min");
    });

    test("keeps small ms values", () => {
      expect(ValueFormatter.formatValue(5, "ms")).toBe("5\u00A0ms");
    });

    test("renders 0 ms with the natural ms unit", () => {
      expect(ValueFormatter.formatValue(0, "ms")).toBe("0\u00A0ms");
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

    /*
     * CloudWatch's "None" is the unit of a metric published without one
     * (an AWS metric added from a resource's More Metrics read with it until
     * its datapoints say otherwise, #9809), and Azure Monitor's
     * "Unspecified" the same. Both read "5 None" and "5 Unspecified" on
     * every chart and axis.
     */
    test("a cloud's own word for no unit renders a bare number, never as a unit", () => {
      for (const unit of ["None", "none", "Unspecified", " None "]) {
        expect(ValueFormatter.formatValue(5, unit)).toBe("5");
        expect(ValueFormatter.formatValue(1234, unit)).toBe("1.23K");
        expect(ValueFormatter.getCompactUnit(unit)).toBe("");
        expect(ValueFormatter.getReadableUnit(unit)).toBe("");
      }
    });

    test("a cloud's no-unit is never read as a share, as '1' can be", () => {
      expect(
        ValueFormatter.formatValue(0.25, "None", {
          metricName: "system.cpu.utilization",
        }),
      ).toBe("0.25");
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

    /*
     * Redis' memory fragmentation ratio is resident over allocated memory:
     * about 1.0 when healthy, 1.5 and up when fragmented. Read as a [0, 1]
     * share it rendered 1.62 as "162.00%" on every chart and in every alert
     * a user built on it.
     */
    test("a fragmentation ratio renders as the ratio it is, never x100", () => {
      expect(
        ValueFormatter.formatValue(1.62, "1", {
          metricName: "redis.memory.fragmentation_ratio",
        }),
      ).toBe("1.62");
      expect(
        ValueFormatter.formatValue(1.62, "1", {
          metricName: "redis_mem_fragmentation_ratio",
        }),
      ).toBe("1.62");
      expect(
        ValueFormatter.getCompactUnit("1", {
          metricName: "redis.memory.fragmentation_ratio",
        }),
      ).toBe("");
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
      expect(ValueFormatter.formatValue(1500000, "By/s")).toBe("1.5\u00A0MB/s");
      expect(ValueFormatter.formatValue(2000, "bytes/s")).toBe("2\u00A0KB/s");
    });

    test("keeps the slash for a numerator it cannot scale, never the words (#8049)", () => {
      expect(ValueFormatter.formatValue(5, "requests/s")).toBe(
        "5\u00A0requests/s",
      );
      expect(ValueFormatter.formatValue(100, "req/s")).toBe("100\u00A0req/s");
    });
  });

  describe("formatValue - unknown units", () => {
    test("formats number and appends the unit's symbol (#8284)", () => {
      expect(ValueFormatter.formatValue(10, "hz")).toBe("10\u00A0Hz");
      expect(ValueFormatter.formatValue(5, "v")).toBe("5\u00A0V");
    });

    test("keeps the original unit when unrecognized", () => {
      expect(ValueFormatter.formatValue(5, "widgets")).toBe("5\u00A0widgets");
    });
  });

  describe("formatValue - large number abbreviation", () => {
    test("abbreviates thousands, millions, billions", () => {
      expect(ValueFormatter.formatValue(5000, "widgets")).toBe(
        "5K\u00A0widgets",
      );
      expect(ValueFormatter.formatValue(1500000, "widgets")).toBe(
        "1.5M\u00A0widgets",
      );
      expect(ValueFormatter.formatValue(2000000000, "widgets")).toBe(
        "2B\u00A0widgets",
      );
    });

    test("trims trailing zeros but keeps distinguishing decimals", () => {
      expect(ValueFormatter.formatValue(119250000000, "widgets")).toBe(
        "119.25B\u00A0widgets",
      );
    });
  });

  describe("formatValue - small number precision", () => {
    test("keeps two significant digits below 1", () => {
      expect(ValueFormatter.formatValue(0.004, "widgets")).toBe(
        "0.004\u00A0widgets",
      );
      expect(ValueFormatter.formatValue(0.006, "widgets")).toBe(
        "0.006\u00A0widgets",
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

    test("a memory fragmentation ratio is not a fraction", () => {
      // The OTel redis receiver, and redis_exporter's Prometheus name.
      expect(
        ValueFormatter.isFractionMetric("redis.memory.fragmentation_ratio"),
      ).toBe(false);
      expect(
        ValueFormatter.isFractionMetric("redis_mem_fragmentation_ratio"),
      ).toBe(false);
      expect(
        ValueFormatter.isFractionMetric(" Redis.Memory.Fragmentation_Ratio "),
      ).toBe(false);
    });

    test("the fragmentation exclusion leaves every other ratio a fraction", () => {
      for (const metricName of [
        "db.client.connection.usage_ratio",
        "redis.keyspace.hit_ratio",
        "cache_hit_ratio",
        "some_ratio",
        // Anchored at the end: only the fragmentation ratio itself.
        "redis.memory.fragmentation_ratio.utilization",
      ]) {
        expect(ValueFormatter.isFractionMetric(metricName)).toBe(true);
      }
    });

    test("a storage array's data reduction ratio is not a fraction", () => {
      // Logical over physical space: 4.2 means 4.2:1, never 420%.
      for (const metricName of [
        "purefa_array_space_data_reduction_ratio",
        "purefa_volume_space_data_reduction_ratio",
        "purefb_array_space_data_reduction_ratio",
        " PureFA_Array_Space_Data_Reduction_Ratio ",
      ]) {
        expect(ValueFormatter.isFractionMetric(metricName)).toBe(false);
      }
    });

    test("the data reduction exclusion leaves every other ratio a fraction", () => {
      for (const metricName of [
        "volume_space_used_ratio",
        "cache_hit_ratio",
        // Anchored at the end: only the data reduction ratio itself.
        "purefa_array_space_data_reduction_ratio.utilization",
      ]) {
        expect(ValueFormatter.isFractionMetric(metricName)).toBe(true);
      }
    });

    test("formatValue shows a data reduction ratio on its own scale", () => {
      expect(
        ValueFormatter.formatValue(4.2, "1", {
          metricName: "purefa_array_space_data_reduction_ratio",
        }),
      ).toBe("4.2");
      expect(
        ValueFormatter.formatValue(0.42, "1", {
          metricName: "volume_space_used_ratio",
        }),
      ).toBe("42.00%");
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
      { value: 23.5, unit: "Cel", expected: "23.5\u00A0°C" },
      { value: 12, unit: "ug/m3", expected: "12\u00A0ug/m3" },
      { value: 23.5, unit: "%", expected: "23.50%" },
      { value: 1536, unit: "By", expected: "1.54\u00A0KB" },
      { value: 0, unit: "By", expected: "0\u00A0B" },
      { value: -2000, unit: "bytes", expected: "-2\u00A0KB" },
      { value: 90, unit: "s", expected: "1.5\u00A0min" },
      { value: 3600, unit: "seconds", expected: "1\u00A0hours" },
      { value: 86400, unit: "seconds", expected: "1\u00A0days" },
      { value: 0, unit: "seconds", expected: "0\u00A0sec" },
      { value: 0.5, unit: "seconds", expected: "500\u00A0ms" },
      { value: 1500, unit: "ms", expected: "1.5\u00A0sec" },
      { value: 42, unit: "1", expected: "42" },
      { value: 1234, unit: "1", expected: "1.23K" },
      {
        value: 0.25,
        unit: "1",
        options: { metricName: "system.cpu.utilization" },
        expected: "25.00%",
      },
      { value: 42, unit: "{thread}", expected: "42" },
      { value: 1500000, unit: "By/s", expected: "1.5\u00A0MB/s" },
      { value: 2000, unit: "bytes/s", expected: "2\u00A0KB/s" },
      { value: 5, unit: "requests/s", expected: "5\u00A0requests/s" },
      { value: 98.6, unit: "[degF]", expected: "98.6\u00A0°F" },
      { value: 10, unit: "hz", expected: "10\u00A0Hz" },
      { value: 5, unit: "v", expected: "5\u00A0V" },
      { value: 5, unit: "widgets", expected: "5\u00A0widgets" },
      { value: 7, unit: "St", expected: "7\u00A0St" },
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
      expect(parts.formatted).toBe("23.5\u00A0°C");
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
        formatted: "5\u00A0requests/s",
      });
      expect(ValueFormatter.formatValueCompact(12, "ug/m3")).toEqual({
        value: "12",
        unit: "ug/m3",
        formatted: "12\u00A0ug/m3",
      });
      expect(ValueFormatter.formatValueCompact(12, "m/s")).toEqual({
        value: "12",
        unit: "m/s",
        formatted: "12\u00A0m/s",
      });
      expect(ValueFormatter.formatValueCompact(1.5, "MB/s")).toEqual({
        value: "1.5",
        unit: "MB/s",
        formatted: "1.5\u00A0MB/s",
      });
    });

    test("scales the value exactly as formatValue does", () => {
      expect(ValueFormatter.formatValueCompact(1536, "By")).toEqual({
        value: "1.54",
        unit: "KB",
        formatted: "1.54\u00A0KB",
      });
      expect(ValueFormatter.formatValueCompact(1500000, "By/s")).toEqual({
        value: "1.5",
        unit: "MB/s",
        formatted: "1.5\u00A0MB/s",
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
        formatted: "1\u00A0h",
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
  /*
   * #7094: the Gauge and the Value widget drew every number with Latin
   * digits and a point, on every board - "73.40%" beside a Persian SLO
   * tile's "۹۹٫۹٪". Given the reader's language, a number is written the
   * way that language writes it: its digits, its decimal sign, its minus,
   * its percent sign and the space before it, keeping exactly the
   * decimals and the scale letter it was written with. No language, or
   * English, writes every number exactly as it always was.
   */
  describe("in the reader's language", () => {
    const NBSP: string = String.fromCharCode(0xa0);
    const NARROW_NBSP: string = String.fromCharCode(0x202f);
    const LATIN_DIGIT: RegExp = /[0-9]/;
    // A digit that is not a Latin one: Persian's, Arabic-Indic, any other.
    const OTHER_DIGIT: RegExp = /(?![0-9])\p{Nd}/u;

    interface LanguageCase {
      value: number;
      unit: string;
      options?: ValueFormatterOptions;
    }

    const CPU: ValueFormatterOptions = { metricName: "system.cpu.utilization" };

    // Every branch of the core, as the no-drift table walks it, and more.
    const CASES: Array<LanguageCase> = [
      { value: 23.5, unit: "Cel" },
      { value: 12, unit: "ug/m3" },
      { value: 23.5, unit: "%" },
      { value: 73.4, unit: "%" },
      { value: 12345, unit: "%" },
      { value: -4.25, unit: "%" },
      { value: 1536, unit: "By" },
      { value: 0, unit: "By" },
      { value: -2000, unit: "bytes" },
      { value: 90, unit: "s" },
      { value: 3600, unit: "seconds" },
      { value: 0.5, unit: "seconds" },
      { value: 1500, unit: "ms" },
      { value: 42, unit: "1" },
      { value: 1234, unit: "1" },
      { value: 119250000000, unit: "" },
      { value: 0.25, unit: "1", options: CPU },
      { value: 42, unit: "{thread}" },
      { value: 1500000, unit: "By/s" },
      { value: 5, unit: "requests/s" },
      { value: 98.6, unit: "[degF]" },
      { value: -3.2, unit: "" },
      { value: 0.000123, unit: "" },
      { value: 0.0000001234, unit: "" },
      { value: Number.NaN, unit: "" },
      { value: Number.POSITIVE_INFINITY, unit: "%" },
      { value: 42, unit: "" },
    ];

    function withLanguage(
      options: ValueFormatterOptions | undefined,
      language: string | undefined,
    ): ValueFormatterOptions {
      return { ...(options || {}), language: language };
    }

    test.each([undefined, "en", "en-GB", "en-US", "EN", " en ", ""])(
      "language %p writes every number exactly as before",
      (language: string | undefined) => {
        for (const languageCase of CASES) {
          const before: string = ValueFormatter.formatValue(
            languageCase.value,
            languageCase.unit,
            languageCase.options,
          );
          const options: ValueFormatterOptions = withLanguage(
            languageCase.options,
            language,
          );

          expect({
            ...languageCase,
            written: ValueFormatter.formatValue(
              languageCase.value,
              languageCase.unit,
              options,
            ),
          }).toEqual({ ...languageCase, written: before });
          expect(
            ValueFormatter.formatValueInParts(
              languageCase.value,
              languageCase.unit,
              options,
            ).formatted,
          ).toBe(before);
          expect(
            ValueFormatter.formatValueCompact(
              languageCase.value,
              languageCase.unit,
              options,
            ),
          ).toEqual(
            ValueFormatter.formatValueCompact(
              languageCase.value,
              languageCase.unit,
              languageCase.options,
            ),
          );
        }
      },
    );

    test("in German: a decimal comma, and the percent sign set apart as German sets it", () => {
      const de: ValueFormatterOptions = { language: "de" };

      expect(ValueFormatter.formatValue(73.4, "%", de)).toBe(`73,40${NBSP}%`);
      expect(ValueFormatter.formatValue(12345, "%", de)).toBe(
        `12.345,00${NBSP}%`,
      );
      expect(ValueFormatter.formatValue(-4.25, "%", de)).toBe(`-4,25${NBSP}%`);
      expect(ValueFormatter.formatValue(1536, "By", de)).toBe("1,54\u00A0KB");
      expect(ValueFormatter.formatValue(-2000, "bytes", de)).toBe("-2\u00A0KB");
      // A span of time in German's words, and a big number in its scale (#7518).
      expect(ValueFormatter.formatValue(3600, "seconds", de)).toBe(
        "1\u00A0Stunde",
      );
      expect(ValueFormatter.formatValue(1234, "1", de)).toBe("1230");
      expect(ValueFormatter.formatValue(119250000000, "", de)).toBe(
        `119,25${NBSP}Mrd.`,
      );
      expect(ValueFormatter.formatValue(0.000123, "", de)).toBe("0,00012");
      expect(ValueFormatter.formatValue(42, "", de)).toBe("42");
      expect(
        ValueFormatter.formatValue(0.25, "1", { ...CPU, language: "de" }),
      ).toBe(`25,00${NBSP}%`);
    });

    test("in German, its parts: the number, and the sign that follows it", () => {
      const parts: FormattedValue = ValueFormatter.formatValueInParts(
        73.4,
        "%",
        { language: "de" },
      );

      expect(parts).toEqual({
        value: "73,40",
        unit: "%",
        formatted: `73,40${NBSP}%`,
      });
      expect(ValueFormatter.isUnitSetApart(parts)).toBe(true);
      expect(
        ValueFormatter.formatValueCompact(23.5, "Cel", { language: "de" }),
      ).toEqual({ value: "23,5", unit: "°C", formatted: "23,5\u00A0°C" });
    });

    test("in Persian: Persian digits, its decimal sign and its percent sign, no space before it", () => {
      const fa: ValueFormatterOptions = { language: "fa" };
      const parts: FormattedValue = ValueFormatter.formatValueInParts(
        73.4,
        "%",
        fa,
      );

      expect(parts).toEqual({
        value: "۷۳٫۴۰",
        unit: "٪",
        formatted: "۷۳٫۴۰٪",
      });
      expect(ValueFormatter.isUnitSetApart(parts)).toBe(false);
      expect(ValueFormatter.formatValue(1536, "By", fa)).toBe("۱٫۵۴\u00A0KB");
      expect(ValueFormatter.formatValue(1234, "1", fa)).toBe(`۱٫۲۳${NBSP}هزار`);
      expect(ValueFormatter.formatValue(42, "", fa)).toBe("۴۲");

      for (const languageCase of CASES) {
        // The number: a unit's own figures ("m3") are the unit's.
        const written: string = ValueFormatter.formatValueInParts(
          languageCase.value,
          languageCase.unit,
          withLanguage(languageCase.options, "fa"),
        ).value;

        // A number it could not read (NaN) is left as it was written.
        if (Number.isFinite(languageCase.value)) {
          expect({
            ...languageCase,
            written,
            latin: LATIN_DIGIT.test(written),
          }).toEqual({ ...languageCase, written, latin: false });
        }
      }
    });

    test("in Persian a negative number keeps its minus before its digits, on a page read from the right too", () => {
      const written: string = ValueFormatter.formatValue(-3.2, "", {
        language: "fa",
      });

      expect(written).toContain("۳٫۲");
      expect(written).toContain("−");
      expect(written.indexOf("−")).toBeLessThan(written.indexOf("۳"));
      expect(written).not.toMatch(LATIN_DIGIT);
    });

    test("in Arabic: the Latin digits Arabic pages write, the percent sign as Arabic sets it", () => {
      const parts: FormattedValue = ValueFormatter.formatValueInParts(
        73.4,
        "%",
        { language: "ar" },
      );

      expect(parts.value).toBe("73.40");
      expect(parts.unit).toContain("%");
      expect(parts.formatted.startsWith("73.40")).toBe(true);
      expect(ValueFormatter.isUnitSetApart(parts)).toBe(false);
      expect(ValueFormatter.formatValue(1536, "By", { language: "ar" })).toBe(
        "1.54\u00A0KB",
      );

      for (const languageCase of CASES) {
        const written: string = ValueFormatter.formatValue(
          languageCase.value,
          languageCase.unit,
          withLanguage(languageCase.options, "ar"),
        );

        expect({
          ...languageCase,
          written,
          other: OTHER_DIGIT.test(written),
        }).toEqual({ ...languageCase, written, other: false });
      }
    });

    test("in French the percent sign is set apart by the space French puts before it", () => {
      const parts: FormattedValue = ValueFormatter.formatValueInParts(
        73.4,
        "%",
        { language: "fr" },
      );

      // A space that never breaks: a wide one or a narrow one, as ICU has it.
      expect([`73,40${NBSP}%`, `73,40${NARROW_NBSP}%`]).toContain(
        parts.formatted,
      );
      expect(parts.value).toBe("73,40");
      expect(ValueFormatter.isUnitSetApart(parts)).toBe(true);
    });

    test("every Dashboard language writes a number its own way, the number found in what it writes", () => {
      for (const language of DASHBOARD_LANGUAGES) {
        for (const languageCase of CASES) {
          const options: ValueFormatterOptions = withLanguage(
            languageCase.options,
            language,
          );
          const parts: FormattedValue = ValueFormatter.formatValueInParts(
            languageCase.value,
            languageCase.unit,
            options,
          );
          const compact: FormattedValue = ValueFormatter.formatValueCompact(
            languageCase.value,
            languageCase.unit,
            options,
          );

          expect(parts.value).not.toBe("");
          expect({
            language,
            ...languageCase,
            found: parts.formatted.includes(parts.value),
          }).toEqual({ language, ...languageCase, found: true });
          // The compact form changes how the unit is spelled, never the number.
          expect(compact.value).toBe(parts.value);
          expect(
            ValueFormatter.formatValue(
              languageCase.value,
              languageCase.unit,
              options,
            ),
          ).toBe(parts.formatted);
        }

        // Latin digits in every language but Persian, Arabic too.
        expect({
          language,
          latin: LATIN_DIGIT.test(
            ValueFormatter.formatValue(73.4, "%", { language }),
          ),
        }).toEqual({ language, latin: language !== "fa" });
      }
    });

    test("a language Intl cannot read writes English", () => {
      for (const language of ["!!", "a b", "x-"]) {
        expect(ValueFormatter.formatValue(73.4, "%", { language })).toBe(
          "73.40%",
        );
        expect(ValueFormatter.formatValue(1536, "By", { language })).toBe(
          "1.54\u00A0KB",
        );
      }
    });

    test("the unit stays as the formatter names it", () => {
      expect(
        ValueFormatter.formatValueInParts(5, "requests/s", { language: "de" }),
      ).toEqual({
        value: "5",
        unit: "requests/s",
        formatted: "5\u00A0requests/s",
      });
    });

    /*
     * A unit with a symbol is written by it, whatever the caller names
     * ("Hz", "°C"; #8284). A unit the formatter names in English words and
     * has no symbol for ("Kelvin": "300 K" would sit one space from the
     * "300K" a big count reads) is named by its caller, who knows the
     * reader (unitName). Left to itself, it writes the English. A rate keeps
     * its slash, as a chart writes it (#8049), whatever the caller names.
     */
    test("a unit's name in words is the caller's to give, English when it gives none", () => {
      const naming: ValueFormatterOptions = {
        language: "de",
        unitName: (unit: string): string => {
          return `«${unit}»`;
        },
      };

      expect(
        ValueFormatter.formatValueInParts(5, "K", { language: "de" }),
      ).toEqual({ value: "5", unit: "Kelvin", formatted: "5\u00A0Kelvin" });
      expect(ValueFormatter.formatValueInParts(5, "K", naming)).toEqual({
        value: "5",
        unit: "«K»",
        formatted: "5\u00A0«K»",
      });
      expect(ValueFormatter.formatValueInParts(5, "Hz", naming)).toEqual({
        value: "5",
        unit: "Hz",
        formatted: "5\u00A0Hz",
      });
      expect(
        ValueFormatter.formatValueInParts(5, "Hz", { language: "de" }),
      ).toEqual({ value: "5", unit: "Hz", formatted: "5\u00A0Hz" });
      expect(
        ValueFormatter.formatValueInParts(5, "requests/s", naming),
      ).toEqual({
        value: "5",
        unit: "requests/s",
        formatted: "5\u00A0requests/s",
      });
    });
  });

  /*
   * THE SCALE AND A SPAN OF TIME, IN THE READER'S LANGUAGE (#7518).
   *
   * A Gauge or a Value widget wrote a big number with English's scale
   * letter after the reader's digits ("1,2K", "۱٫۲K") and a span of time
   * in English's words ("12,5 hours", "۱ hours"). A language writes them
   * its own way now: "1,2 Mio.", "۱٫۲ هزار", "120万"; "6,91 Stunden", "۶٫۹۱
   * ساعت". The symbols every language writes alike stay as they are.
   */
  describe("the scale and the time words, in the reader's language", () => {
    const NBSP: string = String.fromCharCode(0xa0);
    const LATIN_DIGIT: RegExp = /[0-9]/;
    const SCALE_LETTER: RegExp = /\d[KMBTP](?![\p{L}])/u;
    const ENGLISH_TIME_WORD: RegExp = /\b(hours|days)\b/;

    test.each([
      [1234, "1.23K"],
      [15300, "15.3K"],
      [1200000, "1.2M"],
      [119250000000, "119.25B"],
      [2.5e12, "2.5T"],
      [1.5e15, "1.5P"],
      [-1500, "-1.5K"],
    ])(
      "English writes %d as %s, as it always did",
      (value: number, english: string) => {
        for (const language of [undefined, "en", "en-GB"]) {
          expect(ValueFormatter.formatValue(value, "", { language })).toBe(
            english,
          );
          expect(
            ValueFormatter.formatValueCompact(value, "", { language }).value,
          ).toBe(english);
        }
      },
    );

    test.each([
      ["de", 1200000, "1,2 Mio."],
      ["de", 119250000000, "119,25 Mrd."],
      ["de", 15300, "15.300"],
      ["fa", 1200, "۱٫۲ هزار"],
      ["fa", 1200000, "۱٫۲ میلیون"],
      ["ar", 1200000, "1.2 مليون"],
      ["ja", 1200000, "120万"],
      ["ja", 15300, "1.53万"],
      ["fr", 1500, "1,5 k"],
      ["ru", 1500, "1,5 тыс."],
      ["zh-CN", 1200000, "120万"],
    ])(
      "%s writes %d in its own scale: %s",
      (language: string, value: number, written: string) => {
        const NARROW_NBSP: string = String.fromCharCode(0x202f);
        const normalized: (text: string) => string = (text: string) => {
          return text.split(NBSP).join(" ").split(NARROW_NBSP).join(" ");
        };

        expect(
          normalized(ValueFormatter.formatValue(value, "", { language })),
        ).toBe(written);
        expect(
          normalized(
            ValueFormatter.formatValueCompact(value, "", { language }).value,
          ),
        ).toBe(written);
      },
    );

    test("a scaled number keeps the two decimals English keeps, rounded as English rounds it", () => {
      expect(
        ValueFormatter.formatValue(119254000000, "", { language: "de" }),
      ).toBe(`119,25${NBSP}Mrd.`);
      expect(ValueFormatter.formatValue(119250000000, "")).toBe("119.25B");
    });

    /*
     * Each language's own short scale, as Intl writes it: a letter only
     * where the language writes one itself (Italian's and Dutch's "K"
     * for a thousand, Spanish's "B" for a billón), never English's
     * letters after a German or a Persian number.
     */
    test("every Dashboard language writes a big number in its own short scale", () => {
      for (const language of DASHBOARD_LANGUAGES) {
        const own: Intl.NumberFormat = new Intl.NumberFormat(
          getNumberLocale(language),
          {
            notation: "compact",
            maximumFractionDigits: 2,
          } as Intl.NumberFormatOptions,
        );

        for (const value of [1234, 15300, 1.2e6, 119.25e9, 2.5e12, -1500]) {
          // Rounded to English's two decimals of its scale first.
          const english: string = ValueFormatter.formatValue(value, "");
          const scale: Record<string, number> = {
            K: 1e3,
            M: 1e6,
            B: 1e9,
            T: 1e12,
          };
          const rounded: number =
            Number(english.slice(0, -1)) * (scale[english.slice(-1)] || 1);

          expect({
            language,
            value,
            written: ValueFormatter.formatValue(value, "", { language }),
          }).toEqual({ language, value, written: own.format(rounded) });
        }
      }
    });

    test("German, French, Russian, Persian, Arabic, Japanese and Chinese write no scale letter of English's", () => {
      for (const language of ["de", "fr", "ru", "fa", "ar", "ja", "zh-CN"]) {
        for (const value of [1.2e6, 119.25e9, 2.5e12]) {
          const written: string = ValueFormatter.formatValue(value, "", {
            language,
          });

          expect({
            language,
            value,
            written,
            letter: SCALE_LETTER.test(written),
          }).toEqual({ language, value, written, letter: false });
        }
      }
    });

    test("a Persian big number has no Latin digit or letter in it", () => {
      for (const value of [1234, 15300, 1.2e6, 119.25e9]) {
        const written: string = ValueFormatter.formatValue(value, "1", {
          language: "fa",
        });

        expect(written).not.toMatch(LATIN_DIGIT);
        expect(written).not.toMatch(/[A-Za-z]/);
      }
    });

    test("in German, a span of time in German's words and the form its number takes", () => {
      const de: ValueFormatterOptions = { language: "de" };

      expect(ValueFormatter.formatValueInParts(3600, "s", de)).toEqual({
        value: "1",
        unit: "Stunde",
        formatted: "1\u00A0Stunde",
      });
      expect(ValueFormatter.formatValueInParts(6.91 * 3600, "s", de)).toEqual({
        value: "6,91",
        unit: "Stunden",
        formatted: "6,91\u00A0Stunden",
      });
      expect(ValueFormatter.formatValue(2 * 86400, "s", de)).toBe(
        "2\u00A0Tage",
      );
      expect(ValueFormatter.formatValue(120, "sec", de)).toBe("2\u00A0Min.");
      expect(ValueFormatter.formatValue(1500, "ms", de)).toBe("1,5\u00A0Sek.");
      // A symbol reads as it is: milliseconds, bytes, a percentage.
      expect(ValueFormatter.formatValue(12, "ms", de)).toBe("12\u00A0ms");
    });

    test("in Persian and Arabic, its words; in Japanese and Chinese, set as they set them", () => {
      expect(
        ValueFormatter.formatValueInParts(3600, "seconds", { language: "fa" }),
      ).toEqual({ value: "۱", unit: "ساعت", formatted: "۱\u00A0ساعت" });
      expect(
        ValueFormatter.formatValue(6.91 * 3600, "s", { language: "fa" }),
      ).toBe("۶٫۹۱\u00A0ساعت");
      expect(
        ValueFormatter.formatValue(6.91 * 3600, "s", { language: "ar" }),
      ).toBe("6.91\u00A0ساعة");
      expect(
        ValueFormatter.formatValue(6.91 * 3600, "s", { language: "ja" }),
      ).toBe("6.91\u00A0時間");

      const chinese: FormattedValue = ValueFormatter.formatValueInParts(
        6.91 * 3600,
        "s",
        { language: "zh-CN" },
      );

      expect(chinese).toEqual({
        value: "6.91",
        unit: "小时",
        formatted: "6.91小时",
      });
      // Chinese sets no space between them, so the widgets leave none.
      expect(ValueFormatter.isUnitSetApart(chinese)).toBe(false);
    });

    test("Arabic's one hour and two, named by a word with no number in it, keep their number", () => {
      for (const hours of [1, 2]) {
        const parts: FormattedValue = ValueFormatter.formatValueInParts(
          hours * 3600,
          "s",
          { language: "ar" },
        );

        expect(parts.value).toBe(String(hours));
        expect(parts.formatted).toBe(`${hours}\u00A0ساعة`);
      }
    });

    /*
     * "hours" and "days" are English's words in every other language; "min"
     * and "sec" are what Intl shortens a minute and a second to - French,
     * Spanish and Italian write "min" themselves - so those are held to
     * Intl's own short unit for the language.
     */
    test("every Dashboard language names a span of time in its own words", () => {
      const intlUnitOf: (
        language: string,
        unit: string,
        display: "long" | "short",
        value: number,
        decimals: number,
      ) => string = (
        language: string,
        unit: string,
        display: "long" | "short",
        value: number,
        decimals: number,
      ): string => {
        return new Intl.NumberFormat(getNumberLocale(language), {
          style: "unit",
          unit: unit,
          unitDisplay: display,
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        } as Intl.NumberFormatOptions)
          .formatToParts(value)
          .filter((part: Intl.NumberFormatPart): boolean => {
            return part.type === "unit";
          })
          .map((part: Intl.NumberFormatPart): string => {
            return part.value;
          })
          .join(" ");
      };

      for (const language of DASHBOARD_LANGUAGES) {
        for (const [value, unit, intlUnit, display, shown, decimals] of [
          [6.91 * 3600, "s", "hour", "long", 6.91, 2],
          [2.5 * 86400, "s", "day", "long", 2.5, 1],
          [90, "s", "minute", "short", 1.5, 1],
          [1500, "ms", "second", "short", 1.5, 1],
        ] as Array<
          [number, string, string, "long" | "short", number, number]
        >) {
          const parts: FormattedValue = ValueFormatter.formatValueInParts(
            value,
            unit,
            { language },
          );

          expect({ language, value, unit: parts.unit }).toEqual({
            language,
            value,
            unit: intlUnitOf(language, intlUnit, display, shown, decimals),
          });
          // The number is found in what it writes, as the widgets draw it apart.
          expect(parts.formatted.includes(parts.value)).toBe(true);
          expect(parts.formatted.includes(parts.unit)).toBe(true);
        }

        for (const [value, unit] of [
          [3600, "seconds"],
          [6.91 * 3600, "s"],
          [2 * 86400, "s"],
          [1500 * 86400, "s"],
        ] as Array<[number, string]>) {
          const written: string = ValueFormatter.formatValue(value, unit, {
            language,
          });

          expect({
            language,
            written,
            english: ENGLISH_TIME_WORD.test(written),
          }).toEqual({ language, written, english: false });
        }
      }
    });

    test("the compact style keeps the symbol: 2 min, 1 h, in every language", () => {
      for (const language of ["de", "fa", "ar", "ja"]) {
        expect(
          ValueFormatter.formatValueCompact(3600, "s", { language }).unit,
        ).toBe("h");
        expect(
          ValueFormatter.formatValueCompact(120, "s", { language }).unit,
        ).toBe("min");
      }
    });

    test("a long span, scaled: in the language's scale and its words", () => {
      expect(
        ValueFormatter.formatValue(1500 * 86400, "s", { language: "de" }),
      ).toBe("1500\u00A0Tage");
      expect(
        ValueFormatter.formatValue(1500 * 86400, "s", { language: "fa" }),
      ).toBe(`۱٫۵${NBSP}هزار${NBSP}روز`);
      expect(ValueFormatter.formatValue(1500 * 86400, "s")).toBe(
        "1.5K\u00A0days",
      );
    });

    test("a language Intl cannot read keeps English's letter and words", () => {
      expect(ValueFormatter.formatValue(1234, "", { language: "!!" })).toBe(
        "1.23K",
      );
      expect(ValueFormatter.formatValue(3600, "s", { language: "!!" })).toBe(
        "1\u00A0hours",
      );
    });
  });

  describe("a rate of a dimensionless count", () => {
    /*
     * Its unit chip names it per its period, where it read " per Second"
     * with a space before it; a value keeps the slash a chart writes it
     * with (#8049).
     */
    test("is named per its period, with no space before it, and written with its slash", () => {
      expect(ValueFormatter.getReadableUnit("1/s")).toBe("per Second");
      expect(ValueFormatter.getReadableUnit("1/min")).toBe("per Minute");
      expect(ValueFormatter.formatValue(12.5, "1/s")).toBe("12.5/s");
    });

    test("a rate with a numerator reads as it always did", () => {
      expect(ValueFormatter.getReadableUnit("{request}/s")).toBe(
        "{request} per Second",
      );
      expect(ValueFormatter.getReadableUnit("By/s")).toBe("Bytes per Second");
    });
  });

  describe("isUnitSetApart", () => {
    const NBSP: string = String.fromCharCode(0xa0);

    test("a unit written after a space is set apart; a percent sign written on its number is not", () => {
      expect(
        ValueFormatter.isUnitSetApart({
          value: "1.5",
          unit: "MB",
          formatted: "1.5 MB",
        }),
      ).toBe(true);
      expect(
        ValueFormatter.isUnitSetApart({
          value: "73.40",
          unit: "%",
          formatted: "73.40%",
        }),
      ).toBe(false);
      expect(
        ValueFormatter.isUnitSetApart({
          value: "73,40",
          unit: "%",
          formatted: `73,40${NBSP}%`,
        }),
      ).toBe(true);
    });

    test("no unit, nothing to set apart", () => {
      expect(
        ValueFormatter.isUnitSetApart({
          value: "42",
          unit: "",
          formatted: "42",
        }),
      ).toBe(false);
    });

    test("a number not found in its text: a percent sign is written on it, any other unit set apart", () => {
      expect(
        ValueFormatter.isUnitSetApart({
          value: "x",
          unit: "%",
          formatted: "y%",
        }),
      ).toBe(false);
      expect(
        ValueFormatter.isUnitSetApart({
          value: "x",
          unit: "MB",
          formatted: "y MB",
        }),
      ).toBe(true);
    });

    test("every English number reads as formatValue wrote it: a gap but before a percent sign", () => {
      for (const [value, unit] of [
        [1536, "By"],
        [73.4, "%"],
        [42, ""],
        [3600, "seconds"],
        [5, "requests/s"],
      ] as Array<[number, string]>) {
        const parts: FormattedValue = ValueFormatter.formatValueInParts(
          value,
          unit,
        );

        expect(ValueFormatter.isUnitSetApart(parts)).toBe(
          parts.unit !== "" && parts.unit !== "%",
        );
      }
    });
  });
});
