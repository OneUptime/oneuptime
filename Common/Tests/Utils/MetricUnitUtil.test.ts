import MetricUnitUtil from "../../Utils/MetricUnitUtil";

describe("MetricUnitUtil", () => {
  describe("getCompatibleUnits", () => {
    test("returns empty array for undefined / empty unit", () => {
      expect(MetricUnitUtil.getCompatibleUnits(undefined)).toEqual([]);
      expect(MetricUnitUtil.getCompatibleUnits("")).toEqual([]);
      expect(MetricUnitUtil.getCompatibleUnits("   ")).toEqual([]);
    });

    test("returns byte family for 'bytes'", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("bytes");
      const values: Array<string> = options.map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toEqual(["B", "KB", "MB", "GB", "TB", "PB"]);
    });

    test("returns byte family for UCUM 'By' code", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("By");
      expect(options.length).toBe(6);
      expect(options[0]!.value).toBe("B");
    });

    test("returns time family for 'ms'", () => {
      const values: Array<string> = MetricUnitUtil.getCompatibleUnits("ms").map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toEqual(["ns", "µs", "ms", "sec", "min", "hours", "days"]);
    });

    test("returns time family for 's'", () => {
      const values: Array<string> = MetricUnitUtil.getCompatibleUnits("s").map(
        (o: { value: string; label: string }) => {
          return o.value;
        },
      );
      expect(values).toContain("sec");
      expect(values).toContain("ms");
      expect(values).toContain("hours");
    });

    test("returns percent family for '%'", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("%");
      expect(options).toEqual([{ value: "%", label: "Percent (%)" }]);
    });

    test("returns raw unit as sole option for unknown unit", () => {
      const options: Array<{ value: string; label: string }> =
        MetricUnitUtil.getCompatibleUnits("widgets");
      expect(options).toEqual([{ value: "widgets", label: "widgets" }]);
    });
  });

  describe("getCanonicalUnitValue", () => {
    test("returns canonical value for aliases", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("bytes")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("Byte")).toBe("B");
      expect(MetricUnitUtil.getCanonicalUnitValue("MB")).toBe("MB");
      expect(MetricUnitUtil.getCanonicalUnitValue("milliseconds")).toBe("ms");
      expect(MetricUnitUtil.getCanonicalUnitValue("second")).toBe("sec");
      expect(MetricUnitUtil.getCanonicalUnitValue("percent")).toBe("%");
    });

    test("passes through unknown units", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue("widgets")).toBe("widgets");
    });

    test("returns undefined for empty", () => {
      expect(MetricUnitUtil.getCanonicalUnitValue(undefined)).toBeUndefined();
      expect(MetricUnitUtil.getCanonicalUnitValue("")).toBeUndefined();
    });
  });

  describe("convertToMetricUnit", () => {
    test("no conversion when units match", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 123,
          fromUnit: "MB",
          metricUnit: "MB",
        }),
      ).toBe(123);
    });

    test("converts MB to bytes", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "MB",
          metricUnit: "bytes",
        }),
      ).toBe(2e6);
    });

    test("converts bytes to GB", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 5e9,
          fromUnit: "bytes",
          metricUnit: "GB",
        }),
      ).toBe(5);
    });

    test("converts sec to ms", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "sec",
          metricUnit: "ms",
        }),
      ).toBe(2000);
    });

    test("converts ms to sec", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1500,
          fromUnit: "ms",
          metricUnit: "sec",
        }),
      ).toBe(1.5);
    });

    test("converts min to sec", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "min",
          metricUnit: "sec",
        }),
      ).toBe(120);
    });

    test("converts hours to ms", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 1,
          fromUnit: "hours",
          metricUnit: "ms",
        }),
      ).toBe(3_600_000);
    });

    test("returns value unchanged when units are from different families", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: "sec",
        }),
      ).toBe(100);
    });

    test("returns value unchanged when metric unit is unknown", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: "widgets",
        }),
      ).toBe(100);
    });

    test("returns value unchanged when either unit is missing", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: undefined,
          metricUnit: "bytes",
        }),
      ).toBe(100);

      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 100,
          fromUnit: "MB",
          metricUnit: undefined,
        }),
      ).toBe(100);
    });

    test("handles case-insensitive unit matching", () => {
      expect(
        MetricUnitUtil.convertToMetricUnit({
          value: 2,
          fromUnit: "gb",
          metricUnit: "BYTES",
        }),
      ).toBe(2e9);
    });
  });

  describe("hasCompatibleUnitFamily", () => {
    test("true for known families", () => {
      expect(MetricUnitUtil.hasCompatibleUnitFamily("bytes")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("ms")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("%")).toBe(true);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("GB")).toBe(true);
    });

    test("false for unknown or empty", () => {
      expect(MetricUnitUtil.hasCompatibleUnitFamily(undefined)).toBe(false);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("")).toBe(false);
      expect(MetricUnitUtil.hasCompatibleUnitFamily("widgets")).toBe(false);
    });
  });
});
