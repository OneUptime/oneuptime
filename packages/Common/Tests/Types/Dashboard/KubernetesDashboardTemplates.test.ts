import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import { AGENT_EMITTED_METRIC_NAMES } from "../Monitor/Utils/KubernetesAgentEmittedMetrics";
import { describe, expect, test } from "@jest/globals";

/*
 * The Kubernetes dashboard templates chart what the kubernetes-agent chart
 * sends, and nothing else feeds them. A widget naming a metric the agent
 * never sends does not error — its query returns zero rows and the widget
 * renders empty on every dashboard created from the template.
 *
 * That shipped: the Kubernetes template's four CPU widgets read
 * `k8s.pod.cpu.usage` and `k8s.node.cpu.usage`, which kubeletstats at the
 * pinned collector leaves off by default, before the chart enabled them.
 * Nothing checked the dashboards against AGENT_EMITTED_METRIC_NAMES, so
 * this holds every widget of both templates to it.
 */
const KUBERNETES_TEMPLATE_TYPES: Array<DashboardTemplateType> = [
  DashboardTemplateType.Kubernetes,
  DashboardTemplateType.KubernetesCost,
];

interface MetricQuery {
  widget: string;
  metricName: string;
}

function getConfig(type: DashboardTemplateType): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(type);

  if (!config) {
    throw new Error(`Expected ${type} to resolve to a config`);
  }

  return config;
}

/*
 * Every `filterData.metricName` anywhere in a widget's arguments, so a
 * widget that carries several queries cannot hide one from the check.
 */
function collectMetricNames(value: unknown, into: Array<string>): void {
  if (!value || typeof value !== "object") {
    return;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const filterData: Record<string, unknown> | undefined = record[
    "filterData"
  ] as Record<string, unknown> | undefined;

  if (filterData && typeof filterData["metricName"] === "string") {
    into.push(filterData["metricName"]);
  }

  for (const child of Object.values(record)) {
    collectMetricNames(child, into);
  }
}

function getMetricQueries(type: DashboardTemplateType): Array<MetricQuery> {
  const queries: Array<MetricQuery> = [];

  for (const component of getConfig(type).components) {
    const args: Record<string, unknown> =
      (component.arguments as Record<string, unknown>) || {};
    const label: unknown =
      args["title"] ??
      args["chartTitle"] ??
      args["gaugeTitle"] ??
      args["tableTitle"];
    const metricNames: Array<string> = [];

    collectMetricNames(args, metricNames);

    for (const metricName of metricNames) {
      queries.push({
        widget: `${component.componentType} "${String(label ?? "<untitled>")}"`,
        metricName: metricName,
      });
    }
  }

  return queries;
}

describe("Kubernetes dashboard templates", () => {
  describe.each(KUBERNETES_TEMPLATE_TYPES)(
    "%s",
    (type: DashboardTemplateType) => {
      test("queries at least one metric (guards the guard)", () => {
        expect(getMetricQueries(type).length).toBeGreaterThan(0);
      });

      test("every widget queries a metric the agent emits", () => {
        for (const query of getMetricQueries(type)) {
          expect(
            `${query.widget} → ${query.metricName} emitted: ${AGENT_EMITTED_METRIC_NAMES.has(query.metricName)}`,
          ).toBe(`${query.widget} → ${query.metricName} emitted: true`);
        }
      });
    },
  );
});
