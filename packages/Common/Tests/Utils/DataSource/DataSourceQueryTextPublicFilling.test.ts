import { describe, expect, test } from "@jest/globals";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DataSourceQueryText from "../../../Utils/DataSource/DataSourceQueryText";
import { PromQLNodeKind } from "../../../Utils/PromQL/PromQLAst";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";

/*
 * Where a PromQL query reads each of its variables (issue #10226).
 *
 * A public dashboard lets a visitor pick any value of a text box or a
 * telemetry attribute only where the query reads it as a label matcher's
 * value: applyVariablesToPromQL always writes a value there as a quoted
 * string, so a value can only choose which values of that label match.
 * Anywhere else - in the query's code, in a function's string argument, in
 * a comment - it is written in as it is, and a value could turn the query
 * into another one. So getVariableNamesOutsidePromQLMatchers has to find
 * every such place, and the cases below try the ways a value could get
 * out of a string.
 */

const outside: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  return Array.from(
    DataSourceQueryText.getVariableNamesOutsidePromQLMatchers(query),
  ).sort();
};

const textBox: (name: string, value: string) => DashboardVariable = (
  name: string,
  value: string,
): DashboardVariable => {
  return {
    id: name,
    name,
    type: DashboardVariableType.TextInput,
    selectedValue: value,
  };
};

describe("a variable read only as a label matcher's value", () => {
  test.each([
    ['up{job="{{job}}"}'],
    ["up{job='{{job}}'}"],
    ["up{job=`{{job}}`}"],
    ['up{job=~"{{job}}"}'],
    ['up{job!="{{job}}"}'],
    ['up{job!~"{{job}}"}'],
    ['up{job = "{{ job }}"}'],
    ['sum by (pod) (rate(http_requests_total{job=~"{{job}}.*", code="5.."}[5m]))'],
    ['{__name__="{{job}}"}'],
    // Grafana's interval macros are read as the durations they become.
    ['rate(http_requests_total{job="{{job}}"}[$__rate_interval])'],
  ])("%s is read only inside a matcher", (query: string) => {
    expect(outside(query)).toEqual([]);
  });

  test("several matchers, several variables", () => {
    expect(
      outside(
        'sum(rate(x{job="{{job}}", instance=~"{{instance}}"}[5m])) / sum(rate(x{job="{{job}}"}[5m]))',
      ),
    ).toEqual([]);
  });
});

describe("a variable read anywhere else", () => {
  test.each([
    ["in a range", 'rate(x{job="a"}[{{range}}])', ["range"]],
    ["as a metric's name", "rate({{metric}}[5m])", ["metric"]],
    ["in a grouping", "sum by ({{label}}) (x)", ["label"]],
    ["as a number", "x > {{threshold}}", ["threshold"]],
    [
      "in a function's string argument",
      'label_replace(x, "dst", "{{value}}", "src", "(.*)")',
      ["value"],
    ],
    ["in a comment", 'x # job="{{job}}"', ["job"]],
    ["in a comment after a line", 'x\n# up{job="{{job}}"}', ["job"]],
    [
      "both in and outside a matcher",
      'x{job="{{job}}"} or on() vector({{job}})',
      ["job"],
    ],
    [
      // The pattern reads `x="` as a matcher; the lexer knows better.
      "in code after a string the pattern misreads",
      'label_join(x, "x=", {{value}}, "y")',
      ["value"],
    ],
    // A matcher on a quoted label name is not filled as one.
    ['in a quoted label name\'s matcher', '{"job"="{{job}}"}', ["job"]],
  ])(
    "%s",
    (_label: string, query: string, expected: Array<string>) => {
      expect(outside(query)).toEqual(expected);
    },
  );

  test("a query that does not lex reads every variable as outside a matcher", () => {
    expect(outside('up{job="{{job}}"} $nope')).toEqual(["job"]);
    expect(outside('up{job="{{job}}')).toEqual(["job"]);
  });

  test("a query with no variables names none, and an empty one none", () => {
    expect(outside('up{job="api"}')).toEqual([]);
    expect(outside("")).toEqual([]);
  });
});

describe("a value read as a matcher's value never gets out of its string", () => {
  /*
   * What a visitor could type into a text box read only as a matcher's
   * value: whatever it holds, the query parses to the same selector with
   * that label matched - never a second expression.
   */
  test.each([
    ['x"} or vector(1) or up{a="'],
    ["x'} or vector(1) or up{a='"],
    ["x`} or vector(1) or up{a=`"],
    ['x\\"} or vector(1)'],
    ["x\\"],
    ['" or "'],
  ])("%s stays the label's value", (value: string) => {
    for (const query of [
      'up{job="{{job}}"}',
      "up{job='{{job}}'}",
      "up{job=`{{job}}`}",
      'up{job=~"{{job}}"}',
    ]) {
      expect(outside(query)).toEqual([]);

      const filled: string = DataSourceQueryText.applyVariablesToPromQL(query, [
        textBox("job", value),
      ]);

      /*
       * One selector of up, its job matched: nothing else. A regex
       * matcher's value is a pattern, and one that is no pattern ("x\")
       * is refused as one - never read as more of the query.
       */
      let kind: string;

      try {
        kind = parsePromQL(filled).kind;
      } catch {
        kind = query.includes("=~") ? "refused as a pattern" : "refused";
      }

      expect([query, value, kind]).toEqual([
        query,
        value,
        kind === "refused as a pattern"
          ? "refused as a pattern"
          : PromQLNodeKind.VectorSelector,
      ]);
    }
  });
});

describe("a legend template's labels", () => {
  test("are the keys it names, in order, each once", () => {
    expect(
      DataSourceQueryText.getLegendTemplateKeys(
        "{{instance}} ({{job}}) {{ instance }}",
      ),
    ).toEqual(["instance", "job"]);
    expect(DataSourceQueryText.getLegendTemplateKeys("Requests")).toEqual([]);
    expect(DataSourceQueryText.getLegendTemplateKeys("")).toEqual([]);
    expect(DataSourceQueryText.getLegendTemplateKeys("{{ }} {{a}")).toEqual(
      [],
    );
  });

  test("a template is written as before, and an inherited key reads as unset", () => {
    expect(
      DataSourceQueryText.applyLegendTemplate("{{instance}} ({{job}})", {
        instance: "a:9090",
        job: "api",
      }),
    ).toBe("a:9090 (api)");
    expect(
      DataSourceQueryText.applyLegendTemplate("{{job}} - {{pod}}", {
        job: "",
      }),
    ).toBe("(unset) - (unset)");
    expect(DataSourceQueryText.applyLegendTemplate("Requests", {})).toBe(
      "Requests",
    );
    // A number a SQL column holds reads as it always did.
    expect(
      DataSourceQueryText.applyLegendTemplate("region {{region}}", {
        region: 3 as unknown as string,
      }),
    ).toBe("region 3");
    // Never the code of the function every object inherits.
    expect(
      DataSourceQueryText.applyLegendTemplate(
        "{{constructor}} {{toString}}",
        {},
      ),
    ).toBe("(unset) (unset)");
  });
});
