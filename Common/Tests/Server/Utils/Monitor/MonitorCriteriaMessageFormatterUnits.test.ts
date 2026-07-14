import MonitorCriteriaMessageFormatter from "../../../../Server/Utils/Monitor/MonitorCriteriaMessageFormatter";

/*
 * Exhaustive, isolated unit tests for the pure helper
 * MonitorCriteriaMessageFormatter.summarizeNumericSeries(values, unit?).
 *
 * The function turns a numeric series into a single human readable line:
 *   - empty array            => null
 *   - length === 1           => "latest <v> across 1 data point"
 *   - length  >  1           => "latest <last> (min <min>, max <max>) across N data points"
 * Every number is rendered with value.toFixed(2) (always exactly 2 decimals),
 * and a " <unit>" suffix is appended to every number ONLY when unit is truthy.
 * "latest" is always the LAST element of the array, never the maximum.
 */
describe("MonitorCriteriaMessageFormatter.summarizeNumericSeries", () => {
  /* ----- Empty input ----- */
  describe("empty input", () => {
    test("returns null for an empty array", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([]);

      expect(summary).toBeNull();
    });

    test("returns null for an empty array even when a unit is provided", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([], "sec");

      expect(summary).toBeNull();
    });
  });

  /* ----- Single value (singular, no min/max clause) ----- */
  describe("single value", () => {
    test("renders the singular 'data point' with a unit suffix", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.06], "sec");

      expect(summary).toBe("latest 0.06 sec across 1 data point");
    });

    test("renders the singular 'data point' with no unit suffix", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.06]);

      expect(summary).toBe("latest 0.06 across 1 data point");
    });

    test("omits the (min .., max ..) clause entirely for a single value", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.06], "sec");

      expect(summary).not.toContain("min");
      expect(summary).not.toContain("max");
      expect(summary).not.toContain("(");
    });
  });

  /* ----- Multiple values (plural, full clause) ----- */
  describe("multiple values", () => {
    test("renders the full 'latest .. (min .., max ..) across N data points' shape with a unit", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries(
          [0.05, 0.06, 0.07],
          "sec",
        );

      expect(summary).toBe(
        "latest 0.07 sec (min 0.05 sec, max 0.07 sec) across 3 data points",
      );
    });

    test("renders the same shape without any unit suffix when no unit is given", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([
          0.05, 0.06, 0.07,
        ]);

      expect(summary).toBe(
        "latest 0.07 (min 0.05, max 0.07) across 3 data points",
      );
    });

    test("uses the LAST element for 'latest', not the maximum", () => {
      // Last element is 0.06 while the max is 0.07 and the min is 0.05.
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([
          0.07, 0.05, 0.06,
        ]);

      expect(summary).toBe(
        "latest 0.06 (min 0.05, max 0.07) across 3 data points",
      );
    });
  });

  /* ----- toFixed(2) number formatting proof ----- */
  describe("toFixed(2) number formatting", () => {
    test("pads a sub-unit fraction to two decimals (0.5 => '0.50')", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.5]);

      expect(summary).toBe("latest 0.50 across 1 data point");
    });

    test("pads small integers to two decimals (5 => '5.00', 60 => '60.00')", () => {
      const five: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([5]);
      const sixty: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([60]);

      expect(five).toBe("latest 5.00 across 1 data point");
      expect(sixty).toBe("latest 60.00 across 1 data point");
    });

    test("keeps two decimals for large integers (2500 => '2500.00')", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([2500]);

      expect(summary).toBe("latest 2500.00 across 1 data point");
    });

    test("still emits two decimals for a plain integer (42 => '42.00')", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([42], "GB");

      expect(summary).toBe("latest 42.00 GB across 1 data point");
    });
  });

  /* ----- Negative values ----- */
  describe("negative values", () => {
    test("formats negatives with a leading minus and two decimals", () => {
      // Last element (-0.5) is the latest; min is -1.5, max is -0.5.
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([-1.5, -0.5]);

      expect(summary).toBe(
        "latest -0.50 (min -1.50, max -0.50) across 2 data points",
      );
    });

    test("formats a single negative value with a unit suffix", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([-1.5], "sec");

      expect(summary).toBe("latest -1.50 sec across 1 data point");
    });
  });

  /* ----- Unit handling (truthiness) ----- */
  describe("unit handling", () => {
    test("treats an empty-string unit as no unit (no suffix)", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.06], "");

      expect(summary).toBe("latest 0.06 across 1 data point");
    });

    test("treats an undefined unit as no unit (no suffix)", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries(
          [0.06],
          undefined,
        );

      expect(summary).toBe("latest 0.06 across 1 data point");
    });

    test("renders multi-character and symbolic units verbatim on every number", () => {
      const ms: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries(
          [100, 200],
          "ms",
        );
      const gb: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([4], "GB");
      const reqPerSec: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries(
          [1234.5],
          "req/s",
        );
      const percent: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([50, 99.9], "%");

      expect(ms).toBe(
        "latest 200.00 ms (min 100.00 ms, max 200.00 ms) across 2 data points",
      );
      expect(gb).toBe("latest 4.00 GB across 1 data point");
      expect(reqPerSec).toBe("latest 1234.50 req/s across 1 data point");
      expect(percent).toBe(
        "latest 99.90 % (min 50.00 %, max 99.90 %) across 2 data points",
      );
    });
  });

  /* ----- data point pluralization boundary ----- */
  describe("data point pluralization", () => {
    test("exactly 1 value => singular '1 data point'", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([3]);

      expect(summary).toContain("1 data point");
      expect(summary).not.toContain("1 data points");
    });

    test("exactly 2 values => plural '2 data points'", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([3, 4]);

      expect(summary).toContain("2 data points");
      expect(summary).toBe(
        "latest 4.00 (min 3.00, max 4.00) across 2 data points",
      );
    });
  });

  /* ----- Large series ----- */
  describe("large series", () => {
    test("produces one single-line summary with correct latest/min/max/N for 50 values", () => {
      const values: Array<number> = [];
      for (let i: number = 1; i <= 50; i++) {
        values.push(i);
      }

      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries(values, "ms");

      expect(summary).toBe(
        "latest 50.00 ms (min 1.00 ms, max 50.00 ms) across 50 data points",
      );
      // Single line: no newline characters anywhere in the output.
      expect(summary).not.toContain("\n");
    });
  });

  /* ----- Rounding boundaries (discovered by running the real toFixed) ----- */
  describe("rounding boundaries", () => {
    test("0.005 rounds up to '0.01' via toFixed(2)", () => {
      // The double nearest 0.005 is slightly above 0.005, so it rounds up.
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([0.005]);

      expect(summary).toBe("latest 0.01 across 1 data point");
    });

    test("9.999 rounds up to '10.00' via toFixed(2)", () => {
      const summary: string | null =
        MonitorCriteriaMessageFormatter.summarizeNumericSeries([9.999], "sec");

      expect(summary).toBe("latest 10.00 sec across 1 data point");
    });
  });
});
