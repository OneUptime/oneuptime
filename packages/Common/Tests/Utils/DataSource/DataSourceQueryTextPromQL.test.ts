import { describe, expect, test } from "@jest/globals";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "../../../Types/DataSource/ProjectMetricsDataSource";
import DataSourceQueryText from "../../../Utils/DataSource/DataSourceQueryText";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * A PromQL widget's variables, filled the way Grafana's Prometheus data
 * source fills them (issue #7697): several values as an escaped
 * alternation, and All - nothing picked - as every value, where the
 * literal "{{node}}" used to match no series at all.
 */

const variable: (
  data: Partial<DashboardVariable> & { name: string },
) => DashboardVariable = (
  data: Partial<DashboardVariable> & { name: string },
): DashboardVariable => {
  return {
    id: data.name,
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: data.name,
    ...data,
  };
};

const fill: (query: string, variables: Array<DashboardVariable>) => string = (
  query: string,
  variables: Array<DashboardVariable>,
): string => {
  return DataSourceQueryText.applyVariablesToPromQL(query, variables);
};

describe("a variable on All matches every value", () => {
  test("an equality matcher becomes a regex matcher of everything", () => {
    expect(
      fill('up{instance="{{node}}",job="api"}', [variable({ name: "node" })]),
    ).toBe('up{instance=~".*",job="api"}');
  });

  test("a regex matcher keeps the rest of its pattern", () => {
    expect(
      fill('up{instance=~"{{node}}:9100"}', [variable({ name: "node" })]),
    ).toBe('up{instance=~".*:9100"}');
  });

  test("an equality matcher with text around the token reads that text as written", () => {
    expect(
      fill('up{instance="{{node}}:9100"}', [variable({ name: "node" })]),
    ).toBe('up{instance=~".*:9100"}');
  });

  test("a negated matcher becomes a negated regex", () => {
    expect(fill('up{instance!="{{node}}"}', [variable({ name: "node" })])).toBe(
      'up{instance!~".*"}',
    );
  });

  test("a multi-select variable with nothing picked is All too", () => {
    expect(
      fill('up{namespace=~"{{ns}}"}', [
        variable({ name: "ns", isMultiSelect: true, selectedValues: [] }),
      ]),
    ).toBe('up{namespace=~".*"}');
  });

  test("Grafana's Node Exporter Full query reads every node, and parses", () => {
    const query: string = fill(
      'avg(rate(node_cpu_seconds_total{instance="{{node}}",job="{{job}}", mode="idle"}[5m]))',
      [variable({ name: "node" }), variable({ name: "job" })],
    );

    expect(query).toBe(
      'avg(rate(node_cpu_seconds_total{instance=~".*",job=~".*", mode="idle"}[5m]))',
    );
    expect(() => {
      parsePromQL(query);
    }).not.toThrow();
  });
});

describe("a variable with values", () => {
  test("one value of a single-select variable fills an equality matcher as written", () => {
    expect(
      fill('up{instance="{{node}}"}', [
        variable({ name: "node", selectedValue: "10.0.0.1:9100" }),
      ]),
    ).toBe('up{instance="10.0.0.1:9100"}');
  });

  test("the default value counts when nothing is picked", () => {
    expect(
      fill('up{instance="{{node}}"}', [
        variable({ name: "node", defaultValue: "a:9100" }),
      ]),
    ).toBe('up{instance="a:9100"}');
  });

  test("several values are an escaped alternation, and = becomes =~", () => {
    expect(
      fill('up{namespace="{{ns}}"}', [
        variable({
          name: "ns",
          isMultiSelect: true,
          selectedValues: ["shop", "check.out"],
        }),
      ]),
    ).toBe('up{namespace=~"(shop|check\\\\.out)"}');
  });

  test("several values in a regex matcher are wrapped, so a pattern around them still reads them", () => {
    const query: string = fill('up{instance=~"{{node}}:9100"}', [
      variable({
        name: "node",
        isMultiSelect: true,
        selectedValues: ["a", "b"],
      }),
    ]);

    expect(query).toBe('up{instance=~"(a|b):9100"}');
    expect(() => {
      parsePromQL(query);
    }).not.toThrow();
  });

  test("a single-select value in a regex matcher is read as a pattern, as Grafana reads it", () => {
    expect(
      fill('up{job=~"{{job}}"}', [
        variable({ name: "job", selectedValue: "api-.*" }),
      ]),
    ).toBe('up{job=~"api-.*"}');
  });

  test("one value picked of a multi-select variable is escaped, as Grafana escapes it", () => {
    expect(
      fill('up{job=~"{{job}}"}', [
        variable({ name: "job", isMultiSelect: true, selectedValues: ["a.b"] }),
      ]),
    ).toBe('up{job=~"a\\\\.b"}');
  });

  test("a value with a quote or a backslash stays one string", () => {
    const query: string = fill('up{path="{{path}}"}', [
      variable({ name: "path", selectedValue: 'C:\\temp "x"' }),
    ]);

    expect(query).toBe('up{path="C:\\\\temp \\"x\\""}');
    expect(() => {
      parsePromQL(query);
    }).not.toThrow();
  });

  test("single-quoted and raw strings are kept in their own quotes", () => {
    expect(fill("up{job='{{job}}'}", [variable({ name: "job" })])).toBe(
      "up{job=~'.*'}",
    );
    expect(
      fill("up{job=`{{job}}`}", [
        variable({ name: "job", selectedValue: "api" }),
      ]),
    ).toBe("up{job=`api`}");
  });
});

describe("tokens outside a matcher, and tokens of no variable", () => {
  test("outside a matcher a token is filled as applyVariables fills it", () => {
    expect(
      fill("rate(x[{{window}}])", [
        variable({
          name: "window",
          type: DashboardVariableType.CustomList,
          selectedValue: "5m",
        }),
      ]),
    ).toBe("rate(x[5m])");
  });

  test("a token outside a matcher of a variable on All is left for the engine to name", () => {
    expect(fill("rate(x[{{window}}])", [variable({ name: "window" })])).toBe(
      "rate(x[{{window}}])",
    );
  });

  test("a token no variable answers is left as it is", () => {
    expect(fill('up{job="{{other}}"}', [variable({ name: "job" })])).toBe(
      'up{job="{{other}}"}',
    );
  });

  test("a label_replace's strings are no matchers", () => {
    expect(
      fill('label_replace(up, "dst", "{{job}}", "src", "(.*)")', [
        variable({ name: "job", selectedValue: "api" }),
      ]),
    ).toBe('label_replace(up, "dst", "api", "src", "(.*)")');
  });

  test("a query with no variables comes back as it was", () => {
    expect(fill('up{job="api"}', [])).toBe('up{job="api"}');
  });
});

describe("which way a widget's query is filled", () => {
  test("the project's own metrics read as Grafana's Prometheus does", () => {
    expect(
      DataSourceQueryText.applyVariablesForSource({
        dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
        queryText: 'up{instance="{{node}}"}',
        variables: [variable({ name: "node" })],
      }),
    ).toBe('up{instance=~".*"}');
  });

  test("an outside data source of no known type keeps applyVariables, whatever its language", () => {
    expect(
      DataSourceQueryText.applyVariablesForSource({
        dataSourceId: "6c7a8b9c-0000-4000-8000-000000000001",
        queryText: "SELECT * FROM t WHERE host = '{{node}}'",
        variables: [variable({ name: "node" })],
      }),
    ).toBe("SELECT * FROM t WHERE host = '{{node}}'");
  });

  /*
   * An outside Prometheus (Prometheus, Thanos, Mimir, VictoriaMetrics)
   * reads a variable as Grafana's Prometheus data source does, as the
   * project's own metrics do (issue #10326): a dashboard brought over from
   * Grafana reads the same whichever Prometheus it points at.
   */
  const PROMETHEUS: string = "6c7a8b9c-0000-4000-8000-000000000002";

  test("an outside Prometheus: a variable on All matches every value", () => {
    expect(
      DataSourceQueryText.applyVariablesForSource({
        dataSourceId: PROMETHEUS,
        dataSourceType: DataSourceType.Prometheus,
        queryText: 'node_load1{instance="{{node}}"}',
        variables: [variable({ name: "node" })],
      }),
    ).toBe('node_load1{instance=~".*"}');
  });

  test("an outside Prometheus: several values are an escaped alternation, one value as written", () => {
    expect(
      DataSourceQueryText.applyVariablesForSource({
        dataSourceId: PROMETHEUS,
        dataSourceType: DataSourceType.Prometheus,
        queryText: 'up{namespace="{{namespace}}",job="{{job}}"}',
        variables: [
          variable({
            name: "namespace",
            isMultiSelect: true,
            selectedValues: ["shop", "check.out"],
          }),
          variable({ name: "job", selectedValue: "api" }),
        ],
      }),
    ).toBe('up{namespace=~"(shop|check\\\\.out)",job="api"}');
  });

  test("an outside Prometheus: a query with no variable, or with no variables given, comes back unchanged", () => {
    for (const queryText of [
      'sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))',
      "up",
      'label_replace(up, "a", "$1", "instance", "(.*):.*")',
    ]) {
      for (const variables of [
        [variable({ name: "node" })],
        [],
        undefined,
      ] as Array<Array<DashboardVariable> | undefined>) {
        expect(
          DataSourceQueryText.applyVariablesForSource({
            dataSourceId: PROMETHEUS,
            dataSourceType: DataSourceType.Prometheus,
            queryText,
            variables,
          }),
        ).toBe(queryText);
      }
    }
  });

  test("an outside Loki, SQL or search source keeps applyVariables: several values joined with |, a variable with nothing picked left as written", () => {
    const cluster: DashboardVariable = variable({
      name: "cluster",
      isMultiSelect: true,
      selectedValues: ["eu-1", "us-2"],
    });

    for (const dataSourceType of [
      DataSourceType.Loki,
      DataSourceType.PostgreSQL,
      DataSourceType.ClickHouse,
      DataSourceType.Elasticsearch,
      DataSourceType.RestApi,
    ]) {
      expect(
        DataSourceQueryText.applyVariablesForSource({
          dataSourceId: "6c7a8b9c-0000-4000-8000-000000000003",
          dataSourceType,
          queryText: '{cluster=~"{{cluster}}", node="{{node}}"}',
          variables: [cluster, variable({ name: "node" })],
        }),
      ).toBe('{cluster=~"eu-1|us-2", node="{{node}}"}');
    }
  });

  test("an outside Prometheus fills the same as the project's own metrics, for any variables", () => {
    const random: SeededRandom = seededRandom(10326);
    const values: Array<string> = ["a", "b.c", "d|e", "f\\g", 'h"i', "*", ""];
    const queries: Array<string> = [
      'up{job="{{v}}"}',
      'up{job=~"{{v}}"}',
      'up{job!="{{v}}"}',
      'rate(x{a="{{v}}",b=~"pre-{{v}}"}[5m])',
      'sum by ({{v}}) (up{job="{{v}}"})',
      "up{job='{{v}}'}",
    ];

    for (let draw: number = 0; draw < 500; draw++) {
      const picked: Array<string> = values.filter((): boolean => {
        return random(2) === 1;
      });
      const isMultiSelect: boolean = random(2) === 1;
      const v: DashboardVariable = variable({
        name: "v",
        isMultiSelect,
        ...(isMultiSelect
          ? { selectedValues: picked }
          : picked[0]
            ? { selectedValue: picked[0] }
            : {}),
      });
      const queryText: string = queries[random(queries.length)] as string;

      expect(
        DataSourceQueryText.applyVariablesForSource({
          dataSourceId: PROMETHEUS,
          dataSourceType: DataSourceType.Prometheus,
          queryText,
          variables: [v],
        }),
      ).toBe(
        DataSourceQueryText.applyVariablesForSource({
          dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
          queryText,
          variables: [v],
        }),
      );
    }
  });
});
