import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

function makeVariable(
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-1",
    name: "cluster",
    type: DashboardVariableType.TelemetryAttribute,
    ...overrides,
  } as DashboardVariable;
}

describe("DashboardVariableInterpolation", () => {
  describe("resolveValue", () => {
    test("returns scalar for a single-select with selectedValue", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "prod",
      });
    });

    test("falls back to defaultValue when selectedValue is unset", () => {
      const variable: DashboardVariable = makeVariable({
        defaultValue: "staging",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "staging",
      });
    });

    test("prefers selectedValue over defaultValue", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
        defaultValue: "staging",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "prod",
      });
    });

    test("returns undefined when nothing is selected", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(makeVariable({})),
      ).toBeUndefined();
      expect(
        DashboardVariableInterpolation.resolveValue(
          makeVariable({ selectedValue: "" }),
        ),
      ).toBeUndefined();
    });

    test("returns multi for a multi-select with values", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["a", "b"],
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        multi: ["a", "b"],
      });
    });

    test("filters out empty values in multi-select", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["a", "", "b"],
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        multi: ["a", "b"],
      });
    });

    test("multi-select with no picks falls through to scalar default", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "d",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "d",
      });
    });
  });

  describe("applyToAttributes", () => {
    test("returns the same reference when there are no variables", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, undefined),
      ).toBe(attrs);
      expect(DashboardVariableInterpolation.applyToAttributes(attrs, [])).toBe(
        attrs,
      );
    });

    test("injects a scalar attribute for a selected variable", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [variable]);
      expect(result).toEqual({ "k8s.cluster.name": "prod" });
    });

    test("emits an Includes operator for multi-select", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        isMultiSelect: true,
        selectedValues: ["a", "b"],
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [variable]);
      const value: unknown = result["k8s.cluster.name"];
      expect(value).toBeInstanceOf(Includes);
      expect((value as Includes).values).toEqual(["a", "b"]);
    });

    test("removes a previously-set filter when selection is cleared (All)", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(
          { "k8s.cluster.name": "prod", other: "keep" },
          [variable],
        );
      expect(result).toEqual({ other: "keep" });
    });

    test("ignores non-TelemetryAttribute variables", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      const variable: DashboardVariable = makeVariable({
        type: DashboardVariableType.TextInput,
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("ignores TelemetryAttribute variables without an attributeKey", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("returns same reference when scalar value is already set", () => {
      const attrs: Record<string, unknown> = { "k8s.cluster.name": "prod" };
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("handles undefined attributes map", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(undefined, [variable]);
      expect(result).toEqual({ "k8s.cluster.name": "prod" });
    });

    test("applies multiple variables at once", () => {
      const v1: DashboardVariable = makeVariable({
        id: "v1",
        attributeKey: "cluster",
        selectedValue: "prod",
      });
      const v2: DashboardVariable = makeVariable({
        id: "v2",
        attributeKey: "namespace",
        selectedValue: "default",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [v1, v2]);
      expect(result).toEqual({ cluster: "prod", namespace: "default" });
    });
  });
});
