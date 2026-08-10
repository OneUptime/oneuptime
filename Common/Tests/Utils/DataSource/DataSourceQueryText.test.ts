import DataSourceQueryText from "../../../Utils/DataSource/DataSourceQueryText";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { describe, expect, test } from "@jest/globals";

function makeVariable(
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-1",
    name: "cluster",
    type: DashboardVariableType.CustomList,
    ...overrides,
  } as DashboardVariable;
}

describe("DataSourceQueryText.applyVariables", () => {
  test("replaces a scalar variable", () => {
    const result: string = DataSourceQueryText.applyVariables(
      'up{cluster="{{cluster}}"}',
      [makeVariable({ selectedValue: "prod" })],
    );
    expect(result).toBe('up{cluster="prod"}');
  });

  test("replaces every occurrence and tolerates inner whitespace", () => {
    const result: string = DataSourceQueryText.applyVariables(
      "{{ cluster }} and {{cluster}}",
      [makeVariable({ selectedValue: "prod" })],
    );
    expect(result).toBe("prod and prod");
  });

  test("joins multi-select values with | for regex matchers", () => {
    const result: string = DataSourceQueryText.applyVariables(
      'up{cluster=~"{{cluster}}"}',
      [
        makeVariable({
          isMultiSelect: true,
          selectedValues: ["prod", "staging"],
        }),
      ],
    );
    expect(result).toBe('up{cluster=~"prod|staging"}');
  });

  test("falls back to defaultValue when nothing is selected", () => {
    const result: string = DataSourceQueryText.applyVariables("{{cluster}}", [
      makeVariable({ defaultValue: "default-cluster" }),
    ]);
    expect(result).toBe("default-cluster");
  });

  test("leaves the token untouched when the variable is unresolved", () => {
    const result: string = DataSourceQueryText.applyVariables("{{cluster}}", [
      makeVariable({}),
    ]);
    expect(result).toBe("{{cluster}}");
  });

  test("leaves unknown tokens untouched", () => {
    const result: string = DataSourceQueryText.applyVariables("{{unknown}}", [
      makeVariable({ selectedValue: "prod" }),
    ]);
    expect(result).toBe("{{unknown}}");
  });

  test("returns query untouched with no variables", () => {
    expect(DataSourceQueryText.applyVariables("SELECT 1", undefined)).toBe(
      "SELECT 1",
    );
    expect(DataSourceQueryText.applyVariables("SELECT 1", [])).toBe("SELECT 1");
  });

  test("escapes regex metacharacters in variable names", () => {
    const result: string = DataSourceQueryText.applyVariables(
      "{{a.b}} stays, {{acb}} stays too",
      [makeVariable({ name: "a.b", selectedValue: "X" })],
    );
    /*
     * A "." in the variable name must NOT act as a regex wildcard —
     * only the literal {{a.b}} token is replaced.
     */
    expect(result).toBe("X stays, {{acb}} stays too");
  });

  test("handles multiple variables in one query", () => {
    const result: string = DataSourceQueryText.applyVariables(
      "SELECT * FROM t WHERE env = '{{env}}' AND region = '{{region}}'",
      [
        makeVariable({ name: "env", selectedValue: "prod" }),
        makeVariable({ id: "var-2", name: "region", selectedValue: "eu-1" }),
      ],
    );
    expect(result).toBe(
      "SELECT * FROM t WHERE env = 'prod' AND region = 'eu-1'",
    );
  });
});

describe("DataSourceQueryText.applyLegendTemplate", () => {
  test("substitutes attribute values", () => {
    const result: string = DataSourceQueryText.applyLegendTemplate(
      "{{instance}} ({{job}})",
      { instance: "api-1:9090", job: "api" },
    );
    expect(result).toBe("api-1:9090 (api)");
  });

  test("renders (unset) for missing or empty attributes", () => {
    expect(
      DataSourceQueryText.applyLegendTemplate("{{missing}}", { a: "b" }),
    ).toBe("(unset)");
    expect(
      DataSourceQueryText.applyLegendTemplate("{{empty}}", { empty: "" }),
    ).toBe("(unset)");
    expect(DataSourceQueryText.applyLegendTemplate("{{a}}", undefined)).toBe(
      "(unset)",
    );
  });

  test("returns template untouched when it has no placeholders", () => {
    expect(
      DataSourceQueryText.applyLegendTemplate("Errors per second", {
        a: "b",
      }),
    ).toBe("Errors per second");
  });

  test("tolerates whitespace inside placeholders", () => {
    expect(
      DataSourceQueryText.applyLegendTemplate("{{ instance }}", {
        instance: "web-1",
      }),
    ).toBe("web-1");
  });
});
