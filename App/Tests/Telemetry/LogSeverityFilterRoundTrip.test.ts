import evaluateFilter from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import LogFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/LogFilterConfig";
import {
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { JSONObject } from "Common/Types/JSON";

/*
 * The severity dropdown and the filter evaluator have to agree on one
 * vocabulary, and nothing structural forced them to.
 *
 * They disagreed for a long time: the dropdown offered TRACE/DEBUG/INFO/
 * WARNING/ERROR/FATAL while ingest stores Trace/Debug/Information/Warning/
 * Error/Fatal. `=` compares case-sensitively, so every severity filter built in
 * the UI matched zero rows, forever, without erroring. "INFO" was the worst of
 * them — it is not the stored value under any casing.
 *
 * This test walks the actual dropdown options and asserts each one matches a
 * row carrying that severity. It fails if either side drifts again.
 */
describe("severity filter round trip: dropdown option -> stored row", () => {
  const severityField: FilterFieldDefinition | undefined =
    LogFilterConfig.fields.find((f: FilterFieldDefinition) => {
      return f.key === "severityText";
    });

  const logRowWith: (severity: string) => JSONObject = (
    severity: string,
  ): JSONObject => {
    return { severityText: severity, body: "something happened" };
  };

  test("the severity field is a dropdown with options", () => {
    expect(severityField).toBeDefined();
    expect(severityField?.valueOptions?.length).toBeGreaterThan(0);
  });

  test("every dropdown option is a real LogSeverity member", () => {
    const stored: Array<string> = Object.values(LogSeverity);
    for (const option of (severityField?.valueOptions ||
      []) as Array<FilterFieldValueOption>) {
      expect(stored).toContain(option.value);
    }
  });

  test("every dropdown option matches a row of that severity via `=`", () => {
    for (const option of (severityField?.valueOptions ||
      []) as Array<FilterFieldValueOption>) {
      const matched: boolean = evaluateFilter(
        logRowWith(option.value),
        `severityText = '${option.value}'`,
      );
      expect({ option: option.value, matched }).toEqual({
        option: option.value,
        matched: true,
      });
    }
  });

  test("every dropdown option matches via `IN`", () => {
    for (const option of (severityField?.valueOptions ||
      []) as Array<FilterFieldValueOption>) {
      const matched: boolean = evaluateFilter(
        logRowWith(option.value),
        `severityText IN ('${option.value}')`,
      );
      expect({ option: option.value, matched }).toEqual({
        option: option.value,
        matched: true,
      });
    }
  });

  test("Information is offered, and 'INFO' is not", () => {
    const values: Array<string> = (severityField?.valueOptions || []).map(
      (o: FilterFieldValueOption) => {
        return o.value;
      },
    );
    expect(values).toContain(LogSeverity.Information);
    expect(values).not.toContain("INFO");
  });

  /*
   * Pins the bug itself, so the regression is loud rather than silent. If
   * someone later makes `=` case-insensitive, this flips for the first case but
   * NOT the second — 'INFO' can never equal 'Information' whatever the casing.
   */
  describe("the old dropdown values match nothing (why this was broken)", () => {
    test.each([["DEBUG"], ["TRACE"], ["WARNING"], ["ERROR"], ["FATAL"]])(
      "legacy %s does not match its stored row (case)",
      (legacy: string) => {
        const stored: string | null =
          {
            DEBUG: LogSeverity.Debug,
            TRACE: LogSeverity.Trace,
            WARNING: LogSeverity.Warning,
            ERROR: LogSeverity.Error,
            FATAL: LogSeverity.Fatal,
          }[legacy] || null;
        expect(
          evaluateFilter(
            logRowWith(stored as string),
            `severityText = '${legacy}'`,
          ),
        ).toBe(false);
      },
    );

    test("legacy INFO does not match an Information row (wrong word, not just case)", () => {
      expect(
        evaluateFilter(
          logRowWith(LogSeverity.Information),
          "severityText = 'INFO'",
        ),
      ).toBe(false);
    });
  });
});
