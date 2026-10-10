import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import {
  CephAlertTemplate,
  CephAlertTemplateCategory,
  getAllCephAlertTemplates,
} from "Common/Types/Monitor/CephAlertTemplates";
import {
  CephMetricCategory,
  CephMetricDefinition,
  getAllCephMetrics,
} from "Common/Types/Monitor/CephMetricCatalog";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepCephMonitor from "Common/Types/Monitor/MonitorStepCephMonitor";
import {
  DefaultRecoveryMarginFraction,
  SustainedEvaluation,
} from "Common/Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import fs from "fs";
import path from "path";

/*
 * What the English Ceph Monitor page says about the product, held to the code
 * that makes it true: every Quick Setup template's row against the monitor
 * the template builds (what it queries, how it aggregates and groups, its
 * window, the threshold it fires on and the one it recovers at), the
 * evaluation rules the page states for all of them, the collected metrics
 * tables against the metric catalog the Custom Metric picker lists, and the
 * agent's scrape settings. The translations are held to this page by
 * OtelDatabaseCephRollupDocsTranslations, and the agent installer by
 * ProxmoxCephInstallerDocs.
 */

const PAGE: string = "monitor/ceph-monitor";
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

function englishPage(): string {
  return readPage("en", PAGE);
}

const TABLE_DELIMITER_ROW: RegExp = /^\|\s*-/;
const SAYS_A_CHECK_IS_ACTIVE: RegExp =
  /^(The check is active|Either check is active)\b/;
const SAYS_THE_SERIES_IS_GONE: RegExp = /\b(clears|clear|are archived)$/;

// The body rows of every Markdown table in a text, as trimmed cells.
function tableRows(text: string): Array<Array<string>> {
  return text
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|") && !TABLE_DELIMITER_ROW.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The text under a heading, up to the next heading of the same or a higher level.
function sectionOf(page: string, heading: string): string {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(heading);
  const level: number = heading.indexOf(" ");

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    const marks: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    return index > start && marks !== null && marks[1]!.length <= level;
  });

  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// The table each template category is listed in.
const TABLE_OF_CATEGORY: Record<CephAlertTemplateCategory, string> = {
  "Cluster Health": "### Cluster health templates",
  OSD: "### OSD templates",
  PG: "### Placement group templates",
  Capacity: "### Capacity templates",
};

// The table each collected metric category is listed in.
const TABLE_OF_METRIC_CATEGORY: Record<CephMetricCategory, string> = {
  "Cluster Health": "### Cluster health metrics",
  OSD: "### OSD metrics",
  Pool: "### Pool metrics",
  PG: "### Placement group metrics",
};

interface TemplateRow {
  name: string;
  severity: string;
  watches: string;
  fires: string;
  recovers: string;
}

// A row that watches "The same ratio" watches what the row above it does.
const SAME_AS_ABOVE: string = "The same ratio";

function templateRow(template: CephAlertTemplate): TemplateRow {
  const rows: Array<Array<string>> = tableRows(
    sectionOf(englishPage(), TABLE_OF_CATEGORY[template.category]),
  );
  const index: number = rows.findIndex((cells: Array<string>): boolean => {
    return cells[0] === template.name;
  });

  expect({ template: template.name, listed: index >= 0 }).toEqual({
    template: template.name,
    listed: true,
  });

  const row: Array<string> = rows[index] as Array<string>;
  const watches: string =
    row[2] === SAME_AS_ABOVE && index > 1
      ? ((rows[index - 1] as Array<string>)[2] as string)
      : (row[2] as string);

  return {
    name: row[0] as string,
    severity: row[1] as string,
    watches: watches,
    fires: row[3] as string,
    recovers: row[4] as string,
  };
}

interface BuiltTemplate {
  ceph: MonitorStepCephMonitor;
  queries: Array<MetricQueryConfigData>;
  fire: Array<CriteriaFilter>;
  recover: Array<CriteriaFilter>;
}

function build(template: CephAlertTemplate): BuiltTemplate {
  const step: MonitorStep = template.getMonitorStep({
    clusterIdentifier: "ceph-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "ceph-prod",
  });

  const ceph: MonitorStepCephMonitor = step.data!
    .cephMonitor as MonitorStepCephMonitor;
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    ceph: ceph,
    queries: ceph.metricViewConfig.queryConfigs,
    fire: instances[0]!.data!.filters,
    recover: instances[instances.length - 1]!.data!.filters,
  };
}

function numberIn(text: string, pattern: RegExp): number | null {
  const match: RegExpMatchArray | null = text.match(pattern);

  return match ? parseFloat(match[1] as string) : null;
}

// What a "Fires when" cell says, as the comparison the criteria makes.
function firingComparison(cell: string): {
  filterType: FilterType;
  value: number;
} {
  if (SAYS_A_CHECK_IS_ACTIVE.test(cell)) {
    return { filterType: FilterType.GreaterThan, value: 0 };
  }

  const orMore: number | null = numberIn(cell, /^(\d+(?:\.\d+)?) or more\b/);

  if (orMore !== null) {
    return { filterType: FilterType.GreaterThanOrEqualTo, value: orMore };
  }

  const above: number | null = numberIn(cell, /^Above (\d+(?:\.\d+)?)/);

  if (above !== null) {
    return { filterType: FilterType.GreaterThan, value: above };
  }

  const below: number | null = numberIn(cell, /drops below (\d+(?:\.\d+)?)/);

  if (below !== null) {
    return { filterType: FilterType.LessThan, value: below };
  }

  throw new Error(`No firing comparison in "${cell}"`);
}

// What a "Recovers when" cell says, as the comparison the criteria makes.
function recoveryComparison(cell: string): {
  filterType: Array<FilterType>;
  value: number;
  treatsNoDataAsZero: boolean;
} {
  if (SAYS_THE_SERIES_IS_GONE.test(cell)) {
    return {
      filterType: [FilterType.LessThanOrEqualTo, FilterType.EqualTo],
      value: 0,
      treatsNoDataAsZero: true,
    };
  }

  const belowValue: number | null = numberIn(cell, /^Below (\d+(?:\.\d+)?)/);

  if (belowValue !== null) {
    return {
      filterType: [FilterType.LessThan],
      value: belowValue,
      treatsNoDataAsZero: false,
    };
  }

  const atOrBelow: number | null = numberIn(
    cell,
    /^At or below (\d+(?:\.\d+)?)/,
  );

  if (atOrBelow !== null) {
    return {
      filterType: [FilterType.LessThanOrEqualTo],
      value: atOrBelow,
      treatsNoDataAsZero: false,
    };
  }

  const backAt: number | null = numberIn(cell, /^Back at (\d+(?:\.\d+)?)/);

  if (backAt !== null) {
    return {
      filterType: [FilterType.GreaterThanOrEqualTo],
      value: backAt,
      treatsNoDataAsZero: false,
    };
  }

  if (cell === "At 0") {
    return {
      filterType: [FilterType.LessThanOrEqualTo, FilterType.EqualTo],
      value: 0,
      treatsNoDataAsZero: false,
    };
  }

  throw new Error(`No recovery comparison in "${cell}"`);
}

describe("the Ceph Monitor page's templates", () => {
  const templates: Array<CephAlertTemplate> = getAllCephAlertTemplates();

  it("counts the templates Quick Setup offers", () => {
    expect(englishPage()).toContain(
      `**Quick Setup** offers ${templates.length} templates`,
    );
    expect(englishPage()).toContain(
      `[Templates](#pre-built-alert-templates): ${templates.length} ready-made alerts`,
    );
  });

  it("lists each template once, in its category's table, with its severity", () => {
    const listed: Array<string> = Object.values(TABLE_OF_CATEGORY).flatMap(
      (heading: string): Array<string> => {
        return tableRows(sectionOf(englishPage(), heading))
          .slice(1)
          .map((cells: Array<string>): string => {
            return cells[0] as string;
          });
      },
    );

    expect([...listed].sort()).toEqual(
      templates
        .map((template: CephAlertTemplate): string => {
          return template.name;
        })
        .sort(),
    );

    for (const template of templates) {
      expect({
        template: template.name,
        severity: templateRow(template).severity,
      }).toEqual({ template: template.name, severity: template.severity });
    }
  });

  it("names every series, label filter and group-by a template queries", () => {
    for (const template of templates) {
      const watches: string = templateRow(template).watches;

      for (const query of build(template).queries) {
        const expected: Array<string> = [
          `\`${query.metricQueryData.filterData.metricName}\``,
          ...Object.entries(
            (query.metricQueryData.filterData.attributes || {}) as Record<
              string,
              unknown
            >,
          ).map((entry: [string, unknown]): string => {
            return `\`${entry[0]} = ${String(entry[1])}\``;
          }),
          ...(query.metricQueryData.groupByAttributeKeys || []).map(
            (key: string): string => {
              return `per \`${key}\``;
            },
          ),
        ];

        for (const text of expected) {
          expect({ template: template.name, text, named: watches }).toEqual(
            expect.objectContaining({
              template: template.name,
              text,
              named: expect.stringContaining(text),
            }),
          );
        }
      }
    }
  });

  it("names the aggregation of every single-query template", () => {
    for (const template of templates) {
      const queries: Array<MetricQueryConfigData> = build(template).queries;
      const aggregations: Set<string> = new Set(
        queries.map((query: MetricQueryConfigData): string => {
          return String(query.metricQueryData.filterData.aggegationType);
        }),
      );

      if (aggregations.size !== 1) {
        continue;
      }

      const aggregation: string = Array.from(aggregations)[0] as string;
      const watches: string = templateRow(template).watches;

      // A ratio's two sides are named in the bullets below the tables.
      if (watches.includes("÷")) {
        continue;
      }

      expect({ template: template.name, watches }).toEqual({
        template: template.name,
        watches: expect.stringMatching(new RegExp(`\\b${aggregation}\\b`)),
      });
    }
  });

  it("says which templates read the past minute, and that the rest read five", () => {
    expect(englishPage()).toContain(
      "Templates read the past 5 minutes unless the table says otherwise.",
    );

    for (const template of templates) {
      const rollingTime: RollingTime = build(template).ceph.rollingTime;
      const saysPastMinute: boolean =
        templateRow(template).watches.includes("past 1 minute");

      expect({ template: template.name, rollingTime }).toEqual({
        template: template.name,
        rollingTime: saysPastMinute
          ? RollingTime.Past1Minute
          : RollingTime.Past5Minutes,
      });
    }
  });

  it("gives the threshold each template fires on", () => {
    for (const template of templates) {
      const said: { filterType: FilterType; value: number } = firingComparison(
        templateRow(template).fires,
      );

      for (const filter of build(template).fire) {
        expect({
          template: template.name,
          filterType: filter.filterType,
          value: Number(filter.value),
        }).toEqual({
          template: template.name,
          filterType: said.filterType,
          value: said.value,
        });
      }
    }
  });

  it("gives the threshold each template recovers at", () => {
    for (const template of templates) {
      const said: {
        filterType: Array<FilterType>;
        value: number;
        treatsNoDataAsZero: boolean;
      } = recoveryComparison(templateRow(template).recovers);

      for (const filter of build(template).recover) {
        expect({
          template: template.name,
          filterType: said.filterType.includes(filter.filterType!),
          value: Number(filter.value),
          treatsNoDataAsZero:
            filter.metricMonitorOptions?.onNoDataPolicy ===
            NoDataPolicy.TreatAsZero,
        }).toEqual({
          template: template.name,
          filterType: true,
          value: expect.closeTo(said.value, 6),
          treatsNoDataAsZero: said.treatsNoDataAsZero,
        });
      }
    }
  });

  it("fires only on a sustained breach, and recovers ten percent past the line", () => {
    expect(SustainedEvaluation).toBe(EvaluateOverTimeType.AllValues);

    for (const template of templates) {
      for (const filter of build(template).fire) {
        expect({
          template: template.name,
          aggregation: filter.metricMonitorOptions?.metricAggregationType,
        }).toEqual({
          template: template.name,
          aggregation: SustainedEvaluation,
        });
      }
    }

    expect(englishPage()).toContain(
      "A criteria fires only when the condition holds for every minute of its window, " +
        `and a threshold criteria recovers ${DefaultRecoveryMarginFraction * 100}% past its threshold`,
    );
  });

  it("names every template that watches ceph_health_detail in the troubleshooting", () => {
    const healthDetail: Array<string> = templates
      .filter((template: CephAlertTemplate): boolean => {
        return build(template).queries.some(
          (query: MetricQueryConfigData): boolean => {
            return (
              query.metricQueryData.filterData.metricName ===
              "ceph_health_detail"
            );
          },
        );
      })
      .map((template: CephAlertTemplate): string => {
        return template.name;
      });

    const paragraph: string | undefined = englishPage()
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(
          "The templates that watch `ceph_health_detail` — ",
        );
      });

    expect(paragraph).toBeDefined();

    // Two of them are named together, as "the two monitor-disk templates".
    const monitorDisk: Array<string> = healthDetail.filter(
      (name: string): boolean => {
        return name.startsWith("Monitor Disk ");
      },
    );

    expect(monitorDisk.length).toBe(2);
    expect(paragraph).toContain("the two monitor-disk templates");

    for (const name of healthDetail) {
      if (!monitorDisk.includes(name)) {
        expect({ name, named: paragraph!.includes(name) }).toEqual({
          name,
          named: true,
        });
      }
    }
  });
});

describe("the Ceph Monitor page's collected metrics", () => {
  const UNIT_ON_PAGE: (metric: CephMetricDefinition) => string = (
    metric: CephMetricDefinition,
  ): string => {
    return metric.unit || "—";
  };

  it("lists every catalog metric, in its category's table, with its unit", () => {
    for (const category of Object.keys(
      TABLE_OF_METRIC_CATEGORY,
    ) as Array<CephMetricCategory>) {
      const rows: Array<Array<string>> = tableRows(
        sectionOf(englishPage(), TABLE_OF_METRIC_CATEGORY[category]),
      ).slice(1);

      expect({
        category,
        rows: rows.map((cells: Array<string>): Array<string> => {
          return [cells[0] as string, cells[1] as string];
        }),
      }).toEqual({
        category,
        rows: getAllCephMetrics()
          .filter((metric: CephMetricDefinition): boolean => {
            return metric.category === category;
          })
          .map((metric: CephMetricDefinition): Array<string> => {
            return [`\`${metric.metricName}\``, UNIT_ON_PAGE(metric)];
          }),
      });
    }
  });

  it("gives the agent's scrape interval and the mgr module's port", () => {
    const collectorConfig: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents/CephAgent/otel-collector-config.yaml"),
      "utf8",
    );
    const interval: number | null = numberIn(
      collectorConfig,
      /\n\s*scrape_interval:\s*(\d+)s/,
    );

    expect(interval).not.toBeNull();
    expect(collectorConfig).toContain("default port 9283");

    const page: string = englishPage();

    expect(page).toContain(
      `The OneUptime Ceph Agent scrapes every mgr daemon every ${interval} seconds`,
    );
    expect(page).toContain(
      `The agent scrapes every mgr daemon every ${interval} seconds`,
    );
    expect(page).toContain("serves the cluster's metrics on port 9283");
    expect(collectorConfig).toContain("${env:CEPH_MGR_ENDPOINTS}");
    expect(collectorConfig).toContain('"${env:CEPH_CLUSTER_NAME}"');
    expect(page).toContain("`CEPH_MGR_ENDPOINTS`");
    expect(page).toContain("`CEPH_CLUSTER_NAME`");
  });
});
