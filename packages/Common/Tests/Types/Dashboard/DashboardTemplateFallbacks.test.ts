import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DASHBOARD_TEMPLATE_FALLBACK_HINTS } from "../../../Types/Dashboard/DashboardTemplateFallbackHints";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import { MetricQueryFallbackHint } from "../../../Types/Metrics/MetricQueryFallback";
import MetricQueryFallbackUtil from "../../../Utils/Metrics/MetricQueryFallback";
import { describe, expect, test } from "@jest/globals";

/*
 * The fallbacks the dashboard templates ship (MetricQueryConfigData.fallback),
 * and the running counts they chart.
 *
 * Restarts and a Job's failed pods arrive as running counts that only ever
 * grow: k8s.container.restarts, Docker's and Podman's container.restarts,
 * k8s.job.failed_pods. Charted as they are, they are a line that steps up,
 * and the reader has to find the restarts as the steps in it. The agents
 * send each one's increase with every sample as well (#5452, #5458, #5461),
 * whose Sum per interval is what happened in it - but older agents do not.
 * So a template that charts one of them reads the increase and falls back to
 * the running count, never the other way round, and never the count alone.
 *
 * Today that is the Kubernetes dashboard's restarts chart; the rules hold
 * every template, so a Docker, Podman or Job chart added later is held to
 * them too.
 */

// Each running count, and the increase a template reads in its place.
const RUNNING_COUNTS: Record<string, string> = {
  "k8s.container.restarts": "k8s.container.restarts.increase",
  "container.restarts": "container.restarts.increase",
  "k8s.job.failed_pods": "k8s.job.failed_pods.increase",
};

const TEMPLATE_TYPES: Array<DashboardTemplateType> = Object.values(
  DashboardTemplateType,
).filter((type: DashboardTemplateType): boolean => {
  return type !== DashboardTemplateType.Blank;
});

interface TemplateQuery {
  widget: string;
  componentType: DashboardComponentType;
  query: MetricQueryConfigData;
}

function describeWidget(
  type: DashboardTemplateType,
  component: DashboardBaseComponent,
): string {
  const args: Record<string, unknown> =
    (component.arguments as Record<string, unknown>) || {};
  const label: unknown =
    args["chartTitle"] ??
    args["title"] ??
    args["gaugeTitle"] ??
    args["tableTitle"];

  return `${type} ${component.componentType} "${String(label ?? "<untitled>")}"`;
}

// Every query of every widget of every template, as stored (through JSON).
function collectQueries(): Array<TemplateQuery> {
  const queries: Array<TemplateQuery> = [];

  for (const type of TEMPLATE_TYPES) {
    const config: DashboardViewConfig | null = getTemplateConfig(type);

    if (!config) {
      throw new Error(`Expected ${type} to resolve to a config`);
    }

    const stored: DashboardViewConfig = JSON.parse(
      JSON.stringify(config),
    ) as DashboardViewConfig;

    for (const component of stored.components) {
      const args: Record<string, unknown> =
        (component.arguments as Record<string, unknown>) || {};
      const widgetQueries: Array<MetricQueryConfigData> = [];

      if (args["metricQueryConfig"]) {
        widgetQueries.push(args["metricQueryConfig"] as MetricQueryConfigData);
      }

      if (Array.isArray(args["metricQueryConfigs"])) {
        widgetQueries.push(
          ...(args["metricQueryConfigs"] as Array<MetricQueryConfigData>),
        );
      }

      for (const query of widgetQueries) {
        queries.push({
          widget: describeWidget(type, component),
          componentType: component.componentType,
          query: query,
        });
      }
    }
  }

  return queries;
}

function metricNameOf(query: MetricQueryConfigData | undefined): string {
  return String(query?.metricQueryData?.filterData?.metricName ?? "");
}

const QUERIES: Array<TemplateQuery> = collectQueries();

const WITH_FALLBACK: Array<TemplateQuery> = QUERIES.filter(
  (entry: TemplateQuery): boolean => {
    return Boolean(entry.query.fallback);
  },
);

describe("the dashboard templates' fallbacks and running counts", () => {
  test("ships at least one fallback (guards the guard)", () => {
    expect(QUERIES.length).toBeGreaterThan(0);
    expect(
      WITH_FALLBACK.map((entry: TemplateQuery): string => {
        return `${entry.widget} ${metricNameOf(entry.query)}`;
      }),
    ).toContain(
      'Kubernetes Chart "Container Restarts Over Time" k8s.container.restarts.increase',
    );
  });

  test("no template charts a running count of restarts or failed pods as a query of its own", () => {
    const runningCounts: Array<string> = QUERIES.filter(
      (entry: TemplateQuery): boolean => {
        return metricNameOf(entry.query) in RUNNING_COUNTS;
      },
    ).map((entry: TemplateQuery): string => {
      return `${entry.widget} -> ${metricNameOf(entry.query)}`;
    });

    expect(runningCounts).toEqual([]);
  });

  test("a running count is charted only as the fallback of its own increase", () => {
    for (const entry of QUERIES) {
      const fallbackMetric: string = metricNameOf(
        entry.query.fallback?.queryConfig,
      );

      if (!(fallbackMetric in RUNNING_COUNTS)) {
        continue;
      }

      expect(`${entry.widget}: ${metricNameOf(entry.query)}`).toBe(
        `${entry.widget}: ${RUNNING_COUNTS[fallbackMetric]}`,
      );
      // The increase is summed per interval: that is what happened in it.
      expect(
        `${entry.widget}: ${entry.query.metricQueryData.filterData.aggegationType}`,
      ).toBe(`${entry.widget}: Sum`);
    }
  });

  test("only Chart widgets carry a fallback: the other widgets do not draw one", () => {
    for (const entry of WITH_FALLBACK) {
      expect(`${entry.widget}`).toMatch(/ Chart "/);
      expect(entry.componentType).toBe(DashboardComponentType.Chart);
    }
  });

  test("every fallback reads another metric, in its query's slot, under a legend of its own", () => {
    for (const entry of WITH_FALLBACK) {
      const fallback: MetricQueryConfigData = entry.query.fallback!.queryConfig;

      expect(metricNameOf(fallback)).not.toBe("");
      expect(metricNameOf(fallback)).not.toBe(metricNameOf(entry.query));
      expect(fallback.metricQueryData.filterData.aggegationType).toBeTruthy();
      expect(fallback.metricAliasData?.metricVariable).toBe(
        entry.query.metricAliasData?.metricVariable,
      );
      expect(fallback.metricAliasData?.legend).toBeTruthy();
      expect(entry.query.metricAliasData?.legend).toBeTruthy();
      expect(fallback.metricAliasData?.legend).not.toBe(
        entry.query.metricAliasData?.legend,
      );
      expect(fallback.fallback).toBeUndefined();
      // It is the query the chart draws when it falls back.
      expect(
        metricNameOf(
          MetricQueryFallbackUtil.getFallbackQueryConfig(entry.query),
        ),
      ).toBe(metricNameOf(fallback));
    }
  });

  test("every fallback says why, with words the locales hold and a docs link the chart draws", () => {
    for (const entry of WITH_FALLBACK) {
      const hint: MetricQueryFallbackHint | undefined =
        entry.query.fallback?.hint;

      expect(hint).toBeDefined();
      // One of the marked hints, so the Dashboard's locales word it.
      expect(DASHBOARD_TEMPLATE_FALLBACK_HINTS).toContainEqual(hint);
      expect(hint?.text.trim().length).toBeGreaterThan(0);
      expect(hint?.linkText?.trim().length).toBeGreaterThan(0);
      expect(hint?.linkUrl?.startsWith("/docs/")).toBe(true);
      expect(MetricQueryFallbackUtil.getSafeLinkUrl(hint?.linkUrl)).toBe(
        hint?.linkUrl,
      );
    }
  });
});
