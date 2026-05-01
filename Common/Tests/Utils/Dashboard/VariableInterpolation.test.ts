import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";

const buildVariable: (
  overrides: Partial<DashboardVariable>,
) => DashboardVariable = (
  overrides: Partial<DashboardVariable>,
): DashboardVariable => {
  return {
    id: "var-1",
    name: "service",
    type: DashboardVariableType.TextInput,
    ...overrides,
  };
};

describe("DashboardVariableInterpolation.interpolateString", () => {
  test("returns input untouched when no variables are provided", () => {
    expect(
      DashboardVariableInterpolation.interpolateString("hello ${world}", []),
    ).toEqual("hello ${world}");
  });

  test("substitutes a single variable using selectedValue", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ selectedValue: "checkout" }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service=${service}",
        variables,
      ),
    ).toEqual("service=checkout");
  });

  test("falls back to defaultValue when selectedValue is missing", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ defaultValue: "frontend" }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service=${service}",
        variables,
      ),
    ).toEqual("service=frontend");
  });

  test("leaves placeholders alone when variable is unknown", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ selectedValue: "checkout" }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "host=${unknown}",
        variables,
      ),
    ).toEqual("host=${unknown}");
  });

  test("leaves placeholders alone when variable has no resolvable value", () => {
    const variables: Array<DashboardVariable> = [buildVariable({})];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service=${service}",
        variables,
      ),
    ).toEqual("service=${service}");
  });

  test("joins multi-select values with commas", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({
        isMultiSelect: true,
        selectedValues: ["a", "b", "c"],
      }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service in (${service})",
        variables,
      ),
    ).toEqual("service in (a,b,c)");
  });

  test("falls through to selectedValue when multi-select array is empty", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({
        isMultiSelect: true,
        selectedValues: [],
        selectedValue: "fallback",
      }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service=${service}",
        variables,
      ),
    ).toEqual("service=fallback");
  });

  test("substitutes multiple distinct variables in one string", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ name: "service", selectedValue: "checkout" }),
      buildVariable({ id: "v2", name: "env", selectedValue: "prod" }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "${service}/${env}",
        variables,
      ),
    ).toEqual("checkout/prod");
  });

  test("ignores malformed placeholders", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ selectedValue: "checkout" }),
    ];
    expect(
      DashboardVariableInterpolation.interpolateString(
        "service=$service ${} ${1bad}",
        variables,
      ),
    ).toEqual("service=$service ${} ${1bad}");
  });
});

describe("DashboardVariableInterpolation.interpolateValue", () => {
  test("returns null and undefined unchanged", () => {
    expect(
      DashboardVariableInterpolation.interpolateValue(null, []),
    ).toBeNull();
    expect(
      DashboardVariableInterpolation.interpolateValue(undefined, []),
    ).toBeUndefined();
  });

  test("returns numbers and booleans unchanged", () => {
    expect(DashboardVariableInterpolation.interpolateValue(42, [])).toEqual(42);
    expect(DashboardVariableInterpolation.interpolateValue(true, [])).toEqual(
      true,
    );
  });

  test("walks nested objects and arrays substituting placeholders", () => {
    const variables: Array<DashboardVariable> = [
      buildVariable({ name: "service", selectedValue: "checkout" }),
      buildVariable({ id: "v2", name: "env", selectedValue: "prod" }),
    ];
    const input: {
      filterData: { service: string; env: string };
      tags: Array<string>;
      counts: Array<number>;
    } = {
      filterData: { service: "${service}", env: "${env}" },
      tags: ["region:us", "owner:${service}"],
      counts: [1, 2, 3],
    };
    expect(
      DashboardVariableInterpolation.interpolateValue(input, variables),
    ).toEqual({
      filterData: { service: "checkout", env: "prod" },
      tags: ["region:us", "owner:checkout"],
      counts: [1, 2, 3],
    });
  });
});

describe("DashboardVariableInterpolation.extractVariableNames", () => {
  test("returns empty array for empty input", () => {
    expect(DashboardVariableInterpolation.extractVariableNames("")).toEqual([]);
  });

  test("extracts unique variable names in order", () => {
    expect(
      DashboardVariableInterpolation.extractVariableNames(
        "${a}/${b}/${a}/${c}",
      ),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("DashboardVariableInterpolation.hasVariableReference", () => {
  test("detects valid placeholders", () => {
    expect(
      DashboardVariableInterpolation.hasVariableReference("foo ${bar}"),
    ).toBe(true);
  });

  test("returns false for plain strings", () => {
    expect(DashboardVariableInterpolation.hasVariableReference("foo")).toBe(
      false,
    );
  });

  test("returns false for malformed placeholders", () => {
    expect(
      DashboardVariableInterpolation.hasVariableReference("foo ${} ${1bad}"),
    ).toBe(false);
  });
});
