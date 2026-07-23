import ValueFormatter from "../../Utils/ValueFormatter";

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
});
