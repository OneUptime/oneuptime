import { describe, expect, test } from "@jest/globals";
import TraceFilterConfig, {
  getStatusCodePillClass,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import { getSpanStatusPresentation } from "../../FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";

/*
 * The Status field of the trace filter builder. The stored values and the
 * "Unset" / "Ok" / "Error" names are what saved queries, monitors and the API
 * use, so they stay put. The descriptions and the value pill are presentation,
 * and #4118 changed them: Unset is OpenTelemetry's default for a span that
 * finished without an error, not a missing status, so it reads as a success
 * and not as the grey of an unknown value.
 */

function getStatusField(): FilterFieldDefinition {
  const field: FilterFieldDefinition | undefined =
    TraceFilterConfig.fields.find(
      (candidate: FilterFieldDefinition): boolean => {
        return candidate.key === "statusCode";
      },
    );
  if (!field) {
    throw new Error("TraceFilterConfig has no statusCode field");
  }
  return field;
}

function getStatusOptions(): Array<FilterFieldValueOption> {
  return getStatusField().valueOptions || [];
}

function getStatusOption(value: string): FilterFieldValueOption {
  const option: FilterFieldValueOption | undefined = getStatusOptions().find(
    (candidate: FilterFieldValueOption): boolean => {
      return candidate.value === value;
    },
  );
  if (!option) {
    throw new Error(`The statusCode field has no "${value}" option`);
  }
  return option;
}

// A pill's classes as a set, so the assertions do not depend on their order.
function pillClasses(value: string): Set<string> {
  return new Set<string>(getStatusCodePillClass(value).trim().split(/\s+/));
}

describe("TraceFilterConfig status field", () => {
  test("is a dropdown of the stored values 0 / 1 / 2", () => {
    const field: FilterFieldDefinition = getStatusField();

    expect(field.label).toBe("Status");
    expect(field.valueType).toBe("dropdown");
    expect(
      getStatusOptions().map((option: FilterFieldValueOption): string => {
        return option.value;
      }),
    ).toEqual(["0", "1", "2"]);
  });

  test("keeps the status names that filters and the API use", () => {
    expect(
      getStatusOptions().map((option: FilterFieldValueOption): string => {
        return option.label;
      }),
    ).toEqual(["Unset", "Ok", "Error"]);
  });

  test("describes each status", () => {
    expect(getStatusOption("0").description).toBe(
      "No error recorded (OpenTelemetry default)",
    );
    expect(getStatusOption("1").description).toBe(
      "Explicitly marked successful",
    );
    expect(getStatusOption("2").description).toBe("Span ended in error");
  });

  test("REGRESSION: Unset is described as no error, not as no status (#4118)", () => {
    const description: string | undefined = getStatusOption("0").description;

    expect(description).not.toBe("No status set");
    expect(description).toMatch(/no error/i);
  });

  /*
   * "Span completed successfully" on Ok implied an Unset span had not, when
   * Unset is how most successful spans arrive. Ok is now the explicit mark.
   */
  test("REGRESSION: Ok is no longer described as the only successful status (#4118)", () => {
    const description: string | undefined = getStatusOption("1").description;

    expect(description).not.toBe("Span completed successfully");
    expect(description).toMatch(/explicitly/i);
  });

  test("its value pill comes from getStatusCodePillClass", () => {
    expect(getStatusField().getValuePillClass).toBe(getStatusCodePillClass);
  });
});

describe("TraceFilterConfig.getStatusCodePillClass", () => {
  test("Unset is an emerald pill", () => {
    expect(pillClasses("0")).toEqual(
      new Set<string>([
        "bg-emerald-50",
        "text-emerald-700",
        "ring-emerald-600/10",
      ]),
    );
  });

  test("Ok is a deeper emerald pill", () => {
    expect(pillClasses("1")).toEqual(
      new Set<string>([
        "bg-emerald-50",
        "text-emerald-800",
        "ring-emerald-600/10",
      ]),
    );
  });

  test("Error is a red pill", () => {
    expect(pillClasses("2")).toEqual(
      new Set<string>(["bg-red-50", "text-red-700", "ring-red-600/10"]),
    );
  });

  test("REGRESSION: an Unset pill is not the grey of an unknown value (#4118)", () => {
    const unsetClasses: string = getStatusCodePillClass("0");

    expect(unsetClasses).not.toMatch(/gray/);
    expect(unsetClasses).not.toBe(getStatusCodePillClass("3"));
  });

  test("only Error uses red", () => {
    expect(getStatusCodePillClass("0")).not.toMatch(/red/);
    expect(getStatusCodePillClass("1")).not.toMatch(/red/);
    expect(getStatusCodePillClass("2")).not.toMatch(/emerald|gray/);
  });

  test("a value that is not a stored status stays grey", () => {
    for (const value of ["", "3", "ok"]) {
      expect(pillClasses(value)).toEqual(
        new Set<string>(["bg-gray-50", "text-gray-600", "ring-gray-500/10"]),
      );
    }
  });

  test("each status pill carries the classes every other status pill uses", () => {
    for (const value of ["0", "1", "2"]) {
      const shared: Array<string> =
        getSpanStatusPresentation(value).pillClassName.split(" ");

      expect(Array.from(pillClasses(value))).toEqual(
        expect.arrayContaining(shared),
      );
    }
  });
});
