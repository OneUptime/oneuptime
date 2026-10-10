import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  DockerAlertTemplate,
  getAllDockerAlertTemplates,
} from "Common/Types/Monitor/DockerAlertTemplates";
import {
  DockerMetricDefinition,
  getAllDockerMetrics,
} from "Common/Types/Monitor/DockerMetricCatalog";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import {
  DockerSwarmMetricDefinition,
  getAllDockerSwarmMetrics,
} from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import {
  HostAlertTemplate,
  getAllHostAlertTemplates,
} from "Common/Types/Monitor/HostAlertTemplates";
import {
  HostMetricDefinition,
  getAllHostMetrics,
} from "Common/Types/Monitor/HostMetricCatalog";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  KubernetesMetricDefinition,
  getAllKubernetesMetrics,
} from "Common/Types/Monitor/KubernetesMetricCatalog";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepDockerMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepPodmanMonitorUtil } from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
  MonitorTypeProps,
} from "Common/Types/Monitor/MonitorType";
import {
  PodmanAlertTemplate,
  getAllPodmanAlertTemplates,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import {
  PodmanMetricDefinition,
  getAllPodmanMetrics,
} from "Common/Types/Monitor/PodmanMetricCatalog";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
} from "Common/Types/Monitor/ProxmoxAlertTemplates";
import {
  ProxmoxMetricDefinition,
  getAllProxmoxMetrics,
} from "Common/Types/Monitor/ProxmoxMetricCatalog";
import {
  DefaultRecoveryMarginFraction,
  SustainedEvaluation,
} from "Common/Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import fs from "fs";
import path from "path";

/*
 * What the English infrastructure monitor pages say about the product, held
 * to the code that makes it true: Server / VM, Kubernetes, Docker, Host,
 * Podman, Proxmox and Docker Swarm (docs overhaul task 9).
 *
 *   - Every Quick Setup template row (name, severity, what it queries, how
 *     it aggregates and groups, its window, the threshold it fires on and
 *     the one it recovers at) against the monitor the template builds.
 *   - The metric tables against the catalogs the Custom Metric pickers list.
 *   - The create steps against the type picker and the step forms: the
 *     type's title and category, the field and tab names, the aggregations
 *     and the default window.
 *   - The criteria the pages describe against the criteria form, the
 *     default criteria a new monitor gets and the evaluator's rules.
 *   - The agents' collection settings, log files and paths, the Server /
 *     VM agent's commands, files and messages, and the worker that judges
 *     a silent server.
 *
 * Renaming any of these in the product fails this until the English page
 * follows; InfrastructureMonitorDocsTranslations then holds the 16
 * translations to the English page.
 */

const SERVER: string = "monitor/server-monitor";
const KUBERNETES: string = "monitor/kubernetes-monitor";
const DOCKER: string = "monitor/docker-monitor";
const HOST: string = "monitor/host-monitor";
const PODMAN: string = "monitor/podman-monitor";
const PROXMOX: string = "monitor/proxmox-monitor";
const SWARM: string = "monitor/docker-swarm-monitor";

const TELEMETRY_PAGES: Array<string> = [
  KUBERNETES,
  DOCKER,
  HOST,
  PODMAN,
  PROXMOX,
  SWARM,
];

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD_SRC: string = "packages/App/FeatureSet/Dashboard/src";
const FORMS: string = `${DASHBOARD_SRC}/Components/Form/Monitor`;
const WORKER: string =
  "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts";

const RECEIVING_PAGE_LINK: string =
  "](/docs/monitor/when-oneuptime-is-not-receiving)";

const TABLE_DELIMITER_ROW: RegExp = /^\|\s*-/;
const HEADING_MARKS: RegExp = /^(#{1,6}) /;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const PAST_WINDOW: RegExp = /\bpast (\d+) minutes?\b/;
const AGGREGATION_WORD: RegExp = /\b(Avg|Max|Min|Sum)\b/;
const KEY_EQUALS_VALUE: RegExp = /^([\w.]+) = (\S+)$/;
const SAME_AS_ABOVE: string = "The same";
const EMPTY_DISK_PATH_IS_ROOT: RegExp =
  /if \(normalized === ""\) \{\s+return "\/";/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function source(relativeToRepo: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativeToRepo), "utf8");
}

// The text under a heading, up to the next heading of the same or a higher level.
function sectionOf(page: string, heading: string): string {
  const lines: Array<string> = englishPage(page).split("\n");
  const start: number = lines.indexOf(heading);
  const level: number = heading.indexOf(" ");

  expect({ page, heading, found: start >= 0 }).toEqual({
    page,
    heading,
    found: true,
  });

  const end: number = lines.findIndex((line: string, index: number) => {
    const marks: RegExpMatchArray | null = line.match(HEADING_MARKS);

    return index > start && marks !== null && marks[1]!.length <= level;
  });

  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// The body rows of the first table in a text, as trimmed cells.
function tableBody(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let started: boolean = false;

  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      if (started) {
        break;
      }
      continue;
    }

    started = true;

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  // The first row is the header.
  return rows.slice(1);
}

function inlineCodeIn(text: string): Array<string> {
  return Array.from(text.matchAll(INLINE_CODE)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The body of a const arrow function or exported function in a source file.
function functionBody(text: string, declaration: string): string {
  const start: number = text.indexOf(declaration);

  expect({ declaration, found: start >= 0 }).toEqual({
    declaration,
    found: true,
  });

  const next: number = text.indexOf("\nexport const ", start + 1);

  return text.slice(start, next < 0 ? undefined : next);
}

const WINDOW_MINUTES: Partial<Record<RollingTime, number>> = {
  [RollingTime.Past1Minute]: 1,
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past10Minutes]: 10,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past30Minutes]: 30,
};

const AGGREGATION_OF_WORD: Record<string, MetricsAggregationType> = {
  Avg: MetricsAggregationType.Avg,
  Max: MetricsAggregationType.Max,
  Min: MetricsAggregationType.Min,
  Sum: MetricsAggregationType.Sum,
};

const NUMBER_WORDS: Record<number, string> = {
  4: "four",
  5: "five",
  6: "six",
  11: "eleven",
  17: "seventeen",
};

interface Comparison {
  // Undefined only on a template with no filter, which matches no row.
  filterType: FilterType | undefined;
  value: number;
}

// How a "Fires when" or "Recovers when" cell states its comparison.
const COMPARISON_PHRASES: Array<{ pattern: RegExp; filterType: FilterType }> = [
  {
    pattern: /^(?:Any value is )?below (\d+(?:\.\d+)?)/i,
    filterType: FilterType.LessThan,
  },
  {
    pattern: /^(?:Every value is )?at or above (\d+(?:\.\d+)?)/i,
    filterType: FilterType.GreaterThanOrEqualTo,
  },
  {
    pattern: /^at or below (\d+(?:\.\d+)?)/i,
    filterType: FilterType.LessThanOrEqualTo,
  },
  {
    pattern: /^(?:above|more than) (\d+(?:\.\d+)?)/i,
    filterType: FilterType.GreaterThan,
  },
  { pattern: /^equal to (\d+(?:\.\d+)?)/i, filterType: FilterType.EqualTo },
  { pattern: /^at (\d+(?:\.\d+)?)$/i, filterType: FilterType.EqualTo },
  {
    pattern: /^(\d+(?:\.\d+)?)(?:%| ms)? or (?:fewer|less)\b/i,
    filterType: FilterType.LessThanOrEqualTo,
  },
];

function comparisonIn(cell: string): Comparison | null {
  for (const phrase of COMPARISON_PHRASES) {
    const match: RegExpMatchArray | null = cell.match(phrase.pattern);

    if (match) {
      return {
        filterType: phrase.filterType,
        value: parseFloat(match[1] as string),
      };
    }
  }

  return null;
}

/*
 * Whether the page's comparison is the code's. "At 1" on a metric that is
 * only ever 0 or 1 is how the page says ">= 1".
 */
function sameComparison(code: Comparison, page: Comparison | null): boolean {
  if (!page) {
    return false;
  }

  if (page.filterType === code.filterType && page.value === code.value) {
    return true;
  }

  return (
    page.filterType === FilterType.EqualTo &&
    page.value === 1 &&
    code.filterType === FilterType.GreaterThanOrEqualTo &&
    code.value === 1
  );
}

interface BuiltTemplate {
  name: string;
  severity: string;
  queries: Array<MetricQueryConfigData>;
  formulas: Array<string>;
  rollingTime: RollingTime;
  first: MonitorCriteriaInstance;
  last: MonitorCriteriaInstance;
  instances: Array<MonitorCriteriaInstance>;
}

interface TelemetryConfig {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

const IDS: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
};

function built(
  template: { name: string; severity: string },
  step: MonitorStep,
  config: TelemetryConfig | undefined,
): BuiltTemplate {
  expect(config).toBeDefined();

  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    name: template.name,
    severity: template.severity,
    queries: config!.metricViewConfig.queryConfigs,
    formulas: config!.metricViewConfig.formulaConfigs.map(
      (formula: { metricFormulaData: { metricFormula: string } }): string => {
        return formula.metricFormulaData.metricFormula;
      },
    ),
    rollingTime: config!.rollingTime,
    first: instances[0] as MonitorCriteriaInstance,
    last: instances[instances.length - 1] as MonitorCriteriaInstance,
    instances: instances,
  };
}

function dockerTemplates(): Array<BuiltTemplate> {
  return getAllDockerAlertTemplates().map((t: DockerAlertTemplate) => {
    const step: MonitorStep = t.getMonitorStep({
      ...IDS,
      hostIdentifier: "docker-host-01",
      monitorName: "docker-host-01",
    });

    return built(t, step, step.data!.dockerMonitor);
  });
}

function podmanTemplates(): Array<BuiltTemplate> {
  return getAllPodmanAlertTemplates().map((t: PodmanAlertTemplate) => {
    const step: MonitorStep = t.getMonitorStep({
      ...IDS,
      hostIdentifier: "podman-host-01",
      monitorName: "podman-host-01",
    });

    return built(t, step, step.data!.podmanMonitor);
  });
}

function hostTemplates(): Array<BuiltTemplate> {
  return getAllHostAlertTemplates().map((t: HostAlertTemplate) => {
    const step: MonitorStep = t.getMonitorStep({
      ...IDS,
      hostIdentifier: "web-01",
      monitorName: "web-01",
    });

    return built(t, step, step.data!.hostMonitor);
  });
}

function proxmoxTemplates(): Array<BuiltTemplate> {
  return getAllProxmoxAlertTemplates().map((t: ProxmoxAlertTemplate) => {
    const step: MonitorStep = t.getMonitorStep({
      ...IDS,
      clusterIdentifier: "pve-prod",
      monitorName: "pve-prod",
    });

    return built(t, step, step.data!.proxmoxMonitor);
  });
}

function swarmTemplates(): Array<BuiltTemplate> {
  return getAllDockerSwarmAlertTemplates().map(
    (t: DockerSwarmAlertTemplate) => {
      const step: MonitorStep = t.getMonitorStep({
        ...IDS,
        clusterIdentifier: "swarm-prod",
        monitorName: "swarm-prod",
      });

      return built(t, step, step.data!.dockerSwarmMonitor);
    },
  );
}

function kubernetesTemplates(): Array<BuiltTemplate> {
  return getAllKubernetesAlertTemplates().map((t: KubernetesAlertTemplate) => {
    const step: MonitorStep = t.getMonitorStep({
      ...IDS,
      clusterIdentifier: "prod-cluster",
      monitorName: "prod-cluster",
    });

    return built(t, step, step.data!.kubernetesMonitor);
  });
}

function metricNameOf(query: MetricQueryConfigData): string {
  return query.metricQueryData.filterData.metricName as string;
}

function aggregationOf(query: MetricQueryConfigData): MetricsAggregationType {
  return query.metricQueryData.filterData
    .aggegationType as MetricsAggregationType;
}

function attributesOf(query: MetricQueryConfigData): Record<string, string> {
  return (query.metricQueryData.filterData.attributes || {}) as Record<
    string,
    string
  >;
}

function groupByOf(template: BuiltTemplate): Array<string> {
  const keys: Array<string> = [];

  for (const query of template.queries) {
    for (const key of query.metricQueryData.groupByAttributeKeys || []) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }

  return keys;
}

function primary(instance: MonitorCriteriaInstance): CriteriaFilter {
  return instance.data!.filters[0] as CriteriaFilter;
}

function comparisonOf(filter: CriteriaFilter): Comparison {
  return { filterType: filter.filterType, value: Number(filter.value) };
}

function windowAggregationOf(filter: CriteriaFilter): EvaluateOverTimeType {
  return filter.metricMonitorOptions
    ?.metricAggregationType as EvaluateOverTimeType;
}

interface TemplateRow {
  name: string;
  severity: string;
  watches: string;
  fires: string;
  recovers: string;
}

// The Template | Severity | Watches | Fires when | Recovers when table.
function templateRows(page: string, heading: string): Array<TemplateRow> {
  return tableBody(sectionOf(page, heading)).map(
    (cells: Array<string>): TemplateRow => {
      return {
        name: cells[0] as string,
        severity: cells[1] as string,
        watches: cells[2] as string,
        fires: cells[3] as string,
        recovers: cells[4] as string,
      };
    },
  );
}

/*
 * What a page writes for a group-by: "per container" and "per task" are the
 * container's name, "per `id`" the Proxmox id label, "per `a` and `b`" the
 * keys named.
 */
const GROUP_BY_WORDS: Array<{ pattern: RegExp; keys: Array<string> }> = [
  { pattern: /\bper container\b/, keys: ["resource.container.name"] },
  { pattern: /\bper task\b/, keys: ["resource.container.name"] },
  { pattern: /\bper `id`/, keys: ["id"] },
  {
    pattern: /\bper `mountpoint` and `device`/,
    keys: ["mountpoint", "device"],
  },
];

function groupByWritten(watches: string): Array<string> {
  for (const words of GROUP_BY_WORDS) {
    if (words.pattern.test(watches)) {
      return words.keys;
    }
  }

  return [];
}

/*
 * The checks every Template | Severity | Watches | Fires when | Recovers when
 * table shares: the rows are the templates, in the picker's order; each
 * names its severity, every metric it queries and every attribute filter it
 * sets, its group-by, its window (the page's default when the row has none),
 * its aggregation where the row names one, and the comparison it fires and
 * recovers on - sustained over the window unless the row says otherwise.
 */
function describeTemplateTable(data: {
  page: string;
  heading: string;
  templates: () => Array<BuiltTemplate>;
  defaultWindowMinutes?: number | undefined;
  // Rows whose comparisons the generic phrases cannot state.
  specialRows?: Array<string> | undefined;
}): void {
  describe(`${data.page}: the template table`, () => {
    const templates: Array<BuiltTemplate> = data.templates();
    const rows: Array<TemplateRow> = templateRows(data.page, data.heading);

    it("lists every template the picker offers, in the picker's order", () => {
      expect(
        rows.map((row: TemplateRow): string => {
          return row.name;
        }),
      ).toEqual(
        templates.map((template: BuiltTemplate): string => {
          return template.name;
        }),
      );
    });

    it.each(
      templates.map((t: BuiltTemplate): [string, BuiltTemplate] => {
        return [t.name, t];
      }),
    )(
      "%s: severity, metrics, filters, group-by, window and aggregation",
      (_name: string, template: BuiltTemplate) => {
        const index: number = rows.findIndex((candidate: TemplateRow) => {
          return candidate.name === template.name;
        });
        const row: TemplateRow = rows[index] as TemplateRow;
        const code: Array<string> = inlineCodeIn(row.watches);
        // "The same disk ratio for ..." watches the metrics of the row above.
        const metricCode: Array<string> =
          row.watches.startsWith(SAME_AS_ABOVE) && index > 0
            ? inlineCodeIn((rows[index - 1] as TemplateRow).watches)
            : code;

        expect(row.severity).toBe(template.severity);

        for (const query of template.queries) {
          expect({ metric: metricNameOf(query), named: true }).toEqual({
            metric: metricNameOf(query),
            named: metricCode.includes(metricNameOf(query)),
          });

          for (const [key, value] of Object.entries(attributesOf(query))) {
            expect({ key, value, named: true }).toEqual({
              key,
              value,
              named: code.includes(`${key} = ${value}`) || code.includes(value),
            });
          }
        }

        // Every `key = value` the row writes is a filter the template sets.
        for (const written of code) {
          const pair: RegExpMatchArray | null = written.match(KEY_EQUALS_VALUE);

          if (!pair) {
            continue;
          }

          expect({ written, set: true }).toEqual({
            written,
            set: template.queries.some(
              (query: MetricQueryConfigData): boolean => {
                return attributesOf(query)[pair[1] as string] === pair[2];
              },
            ),
          });
        }

        expect(groupByWritten(row.watches)).toEqual(groupByOf(template));

        const past: RegExpMatchArray | null = row.watches.match(PAST_WINDOW);
        const minutes: number | undefined = past
          ? parseInt(past[1] as string, 10)
          : data.defaultWindowMinutes;

        expect(minutes).toBe(WINDOW_MINUTES[template.rollingTime]);

        const word: RegExpMatchArray | null =
          row.watches.match(AGGREGATION_WORD);

        if (word) {
          for (const query of template.queries) {
            expect({ query: metricNameOf(query), aggregation: true }).toEqual({
              query: metricNameOf(query),
              aggregation:
                aggregationOf(query) === AGGREGATION_OF_WORD[word[1] as string],
            });
          }
        }
      },
    );

    it.each(
      templates
        .filter((t: BuiltTemplate): boolean => {
          return !(data.specialRows || []).includes(t.name);
        })
        .map((t: BuiltTemplate): [string, BuiltTemplate] => {
          return [t.name, t];
        }),
    )(
      "%s: fires and recovers on the comparison the row states",
      (_name: string, template: BuiltTemplate) => {
        const row: TemplateRow = rows.find((candidate: TemplateRow) => {
          return candidate.name === template.name;
        }) as TemplateRow;
        const fire: CriteriaFilter = primary(template.first);
        const recover: CriteriaFilter = primary(template.last);

        expect({ row: row.fires, same: true }).toEqual({
          row: row.fires,
          same: sameComparison(comparisonOf(fire), comparisonIn(row.fires)),
        });
        expect({ row: row.recovers, same: true }).toEqual({
          row: row.recovers,
          same: sameComparison(
            comparisonOf(recover),
            comparisonIn(row.recovers),
          ),
        });

        // "(Sum)" and "Any value is" say how the window is read; otherwise every minute.
        const expectedFireWindow: EvaluateOverTimeType = row.fires.includes(
          "(Sum)",
        )
          ? EvaluateOverTimeType.Sum
          : row.fires.startsWith("Any value")
            ? EvaluateOverTimeType.AnyValue
            : SustainedEvaluation;

        expect(windowAggregationOf(fire)).toBe(expectedFireWindow);
        expect(windowAggregationOf(recover)).toBe(
          expectedFireWindow === EvaluateOverTimeType.AnyValue
            ? SustainedEvaluation
            : expectedFireWindow,
        );
      },
    );

    it("builds two criteria for every template: one that opens an incident and an alert, one that recovers", () => {
      for (const template of templates) {
        expect(template.instances).toHaveLength(2);
        expect(template.first.data).toEqual(
          expect.objectContaining({
            monitorStatusId: IDS.offlineMonitorStatusId,
            changeMonitorStatus: true,
            createIncidents: true,
            createAlerts: true,
          }),
        );
        expect(template.first.data!.incidents[0]!.incidentSeverityId).toEqual(
          IDS.defaultIncidentSeverityId,
        );
        expect(template.first.data!.alerts[0]!.alertSeverityId).toEqual(
          IDS.defaultAlertSeverityId,
        );
        expect(template.last.data).toEqual(
          expect.objectContaining({
            monitorStatusId: IDS.onlineMonitorStatusId,
            changeMonitorStatus: true,
            createIncidents: false,
            createAlerts: false,
          }),
        );
      }
    });

    it("says how many templates there are, in the card and in the section lead", () => {
      const count: number = templates.length;
      const word: string = NUMBER_WORDS[count] as string;
      const capitalized: string = `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
      const lead: string = sectionOf(data.page, data.heading);

      expect(englishPage(data.page)).toContain(
        `(#pre-built-alert-templates): ${capitalized} ready-made alerts`,
      );
      expect(
        lead.includes(`**Quick Setup** offers ${word} templates.`) ||
          lead.includes(`**Quick Setup** offers ${count} templates.`),
      ).toBe(true);
    });
  });
}

describe("the evaluation rules every template page states", () => {
  it("a template's criteria fires only when the condition holds for every minute of its window", () => {
    expect(SustainedEvaluation).toBe(EvaluateOverTimeType.AllValues);

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "fires only when the condition holds for every minute of its window",
      );
    }
  });

  it("and recovers 10% past the threshold", () => {
    expect(DefaultRecoveryMarginFraction).toBe(0.1);

    for (const page of [DOCKER, HOST, PODMAN, SWARM]) {
      expect(englishPage(page)).toContain("recovers 10% past the threshold");
    }

    expect(englishPage(PROXMOX)).toContain(
      "a threshold criteria recovers 10% past its threshold",
    );
  });
});

describeTemplateTable({
  page: DOCKER,
  heading: "## Pre-built Alert Templates",
  templates: dockerTemplates,
});

describeTemplateTable({
  page: PODMAN,
  heading: "## Pre-built Alert Templates",
  templates: podmanTemplates,
});

describeTemplateTable({
  page: HOST,
  heading: "## Pre-built Alert Templates",
  templates: hostTemplates,
});

describeTemplateTable({
  page: SWARM,
  heading: "## Pre-built Alert Templates",
  templates: swarmTemplates,
});

describeTemplateTable({
  page: PROXMOX,
  heading: "## Pre-built Alert Templates",
  templates: proxmoxTemplates,
  defaultWindowMinutes: 5,
  specialRows: ["Guest Down"],
});

describe("the Docker templates the page explains", () => {
  const templates: Array<BuiltTemplate> = dockerTemplates();

  function named(name: string): BuiltTemplate {
    return templates.find((template: BuiltTemplate): boolean => {
      return template.name === name;
    }) as BuiltTemplate;
  }

  it("alert on how much a lifetime counter grew: a Maximum and a Minimum query per minute, subtracted by a formula", () => {
    for (const name of ["Container Restart Loop", "Container CPU Throttling"]) {
      const template: BuiltTemplate = named(name);

      expect(template.queries.map(aggregationOf)).toEqual([
        MetricsAggregationType.Max,
        MetricsAggregationType.Min,
      ]);
      expect(template.formulas).toHaveLength(1);
      expect(template.formulas[0]).toContain(" - ");
    }

    // The throttled time is nanoseconds; the row reads it in milliseconds.
    expect(named("Container CPU Throttling").formulas[0]).toContain(
      "/ 1000000",
    );
  });

  it("watch the 30-second scrape that the delta templates rely on", () => {
    expect(source("agents/DockerAgent/otel-collector-config.yaml")).toContain(
      "collection_interval: 30s",
    );
    expect(englishPage(DOCKER)).toContain(
      "If you raise the agent's `collection_interval` to 60 seconds or more, each minute holds one sample and both templates stop alerting.",
    );
  });
});

describe("the Proxmox templates the page explains", () => {
  const templates: Array<BuiltTemplate> = proxmoxTemplates();

  function named(name: string): BuiltTemplate {
    return templates.find((template: BuiltTemplate): boolean => {
      return template.name === name;
    }) as BuiltTemplate;
  }

  it("Guest Down pages only for a stopped guest that starts on boot, and recovers when it runs or stops starting on boot", () => {
    const template: BuiltTemplate = named("Guest Down");
    const row: TemplateRow = templateRows(
      PROXMOX,
      "## Pre-built Alert Templates",
    ).find((candidate: TemplateRow) => {
      return candidate.name === "Guest Down";
    }) as TemplateRow;

    expect(template.queries.map(metricNameOf)).toEqual([
      "pve_up",
      "pve_onboot_status",
    ]);
    expect(template.first.data!.filterCondition).toBe(FilterCondition.All);
    expect(template.first.data!.filters.map(comparisonOf)).toEqual([
      { filterType: FilterType.LessThan, value: 1 },
      { filterType: FilterType.GreaterThan, value: 0 },
    ]);
    expect(template.last.data!.filterCondition).toBe(FilterCondition.Any);
    expect(template.last.data!.filters.map(comparisonOf)).toEqual([
      { filterType: FilterType.GreaterThanOrEqualTo, value: 1 },
      { filterType: FilterType.EqualTo, value: 0 },
    ]);
    expect(row.fires).toBe(
      "`pve_up` is below 1 while `pve_onboot_status` is 1",
    );
    expect(row.recovers).toBe(
      "`pve_up` is back at 1, or start on boot is turned off",
    );
  });

  it("ratio formulas take the Sum of both sides and give a percentage", () => {
    for (const template of templates) {
      if (template.formulas.length === 0) {
        continue;
      }

      expect(template.queries.map(aggregationOf)).toEqual(
        template.queries.map((): MetricsAggregationType => {
          return MetricsAggregationType.Sum;
        }),
      );
      expect(template.formulas[0]).toContain("* 100");
    }

    expect(englishPage(PROXMOX)).toContain(
      "**Ratio formulas** take the **Sum** of both sides.",
    );
  });

  it("the down templates use Minimum", () => {
    for (const name of ["Node Offline", "Guest Down"]) {
      expect(named(name).queries.map(aggregationOf)).toEqual(
        named(name).queries.map((): MetricsAggregationType => {
          return MetricsAggregationType.Min;
        }),
      );
    }
  });

  it("Container Root Disk Near Full leaves out QEMU VMs", () => {
    expect(
      named("Container Root Disk Near Full").queries.map(attributesOf),
    ).toEqual([{ "pve.type": "lxc" }, { "pve.type": "lxc" }]);
  });
});

describe("the Docker Swarm template the page explains", () => {
  it("Task Down fires on a single young sample and clears once every sample passes a minute plus the margin", () => {
    const template: BuiltTemplate = swarmTemplates().find(
      (candidate: BuiltTemplate): boolean => {
        return candidate.name === "Task Down (Low Uptime)";
      },
    ) as BuiltTemplate;

    expect(windowAggregationOf(primary(template.first))).toBe(
      EvaluateOverTimeType.AnyValue,
    );
    expect(comparisonOf(primary(template.first))).toEqual({
      filterType: FilterType.LessThan,
      value: 60,
    });
    expect(comparisonOf(primary(template.last))).toEqual({
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 66,
    });
  });
});

describe("the Host templates the page explains", () => {
  const templates: Array<BuiltTemplate> = hostTemplates();

  function named(name: string): BuiltTemplate {
    return templates.find((template: BuiltTemplate): boolean => {
      return template.name === name;
    }) as BuiltTemplate;
  }

  it("CPU is user plus system, memory the used state, both shown as a percentage", () => {
    expect(named("High CPU Utilization").queries.map(attributesOf)).toEqual([
      { state: "user" },
      { state: "system" },
    ]);
    expect(named("High CPU Utilization").formulas).toEqual([
      "(host_cpu_user + host_cpu_system) * 100",
    ]);
    expect(named("High Memory Utilization").queries.map(attributesOf)).toEqual([
      { state: "used" },
    ]);
    expect(named("High Memory Utilization").formulas[0]).toContain("* 100");
    expect(named("High Filesystem Usage").formulas[0]).toContain("* 100");
  });

  it("the CPU, memory and filesystem templates need the utilization metrics the dashboard's configuration turns on", () => {
    const configuration: string = source(
      `${DASHBOARD_SRC}/Pages/Host/Utils/DocumentationMarkdown.ts`,
    );

    for (const metric of [
      "system.cpu.utilization",
      "system.memory.utilization",
      "system.filesystem.utilization",
    ]) {
      expect(configuration).toContain(`${metric}:\n            enabled: true`);
      expect(englishPage(HOST)).toContain(`\`${metric}\``);
    }

    expect(configuration).toContain("collection_interval: 30s");
  });
});

describe(`${KUBERNETES}: the template table`, () => {
  const templates: Array<KubernetesAlertTemplate> =
    getAllKubernetesAlertTemplates();
  const builtTemplates: Array<BuiltTemplate> = kubernetesTemplates();
  const rows: Array<Array<string>> = tableBody(
    sectionOf(KUBERNETES, "## Pre-built alert templates"),
  );

  // The template picker's category headings.
  const CATEGORY_LABELS: Record<string, string> = {
    Workload: "Workload",
    Node: "Node",
    ControlPlane: "Control Plane",
    Storage: "Storage",
    Scheduling: "Scheduling",
  };

  it("lists every template, in the picker's order, with its category and severity", () => {
    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return [cells[0] as string, cells[1] as string, cells[3] as string];
      }),
    ).toEqual(
      templates.map((template: KubernetesAlertTemplate): Array<string> => {
        return [
          template.name,
          CATEGORY_LABELS[template.category] as string,
          template.severity,
        ];
      }),
    );
  });

  it("the picker draws those category headings", () => {
    const picker: string = source(
      `${FORMS}/KubernetesMonitor/KubernetesTemplatePicker.tsx`,
    );

    for (const label of Object.values(CATEGORY_LABELS)) {
      expect(picker).toContain(`label: "${label}"`);
    }
  });

  it("states every threshold and long window a template fires on", () => {
    for (const template of builtTemplates) {
      const cell: string = (
        rows.find((cells: Array<string>): boolean => {
          return cells[0] === template.name;
        }) as Array<string>
      )[2] as string;
      const fire: Comparison = comparisonOf(primary(template.first));

      if (fire.value > 1) {
        expect({ template: template.name, cell, stated: true }).toEqual({
          template: template.name,
          cell,
          stated: cell.includes(String(fire.value)),
        });
      }

      if (fire.filterType === FilterType.GreaterThanOrEqualTo) {
        expect(cell).toContain("or more");
      }

      if (template.rollingTime === RollingTime.Past15Minutes) {
        expect({ template: template.name, cell, window: true }).toEqual({
          template: template.name,
          cell,
          window: cell.includes("15-minute") || cell.includes("15 minutes"),
        });
      }
    }
  });

  it("fills in two criteria for every template, offline with an incident and an alert, then online", () => {
    for (const template of builtTemplates) {
      expect(template.instances).toHaveLength(2);
      expect(template.first.data).toEqual(
        expect.objectContaining({
          changeMonitorStatus: true,
          createIncidents: true,
          createAlerts: true,
          monitorStatusId: IDS.offlineMonitorStatusId,
        }),
      );
      expect(template.last.data).toEqual(
        expect.objectContaining({
          monitorStatusId: IDS.onlineMonitorStatusId,
          createIncidents: false,
          createAlerts: false,
        }),
      );
    }

    expect(englishPage(KUBERNETES)).toContain(
      "Each one fills in two criteria: one that marks the monitor offline and opens an incident and an alert when the condition holds, and one that brings it back online when it clears.",
    );
  });

  it("counts the templates in the card", () => {
    expect(englishPage(KUBERNETES)).toContain(
      `(#pre-built-alert-templates): Seventeen ready-made alerts`,
    );
    expect(templates).toHaveLength(17);
  });

  it("CrashLoopBackOff Detection reads the lifetime restart count of each pod's containers", () => {
    const template: BuiltTemplate = builtTemplates.find(
      (candidate: BuiltTemplate): boolean => {
        return candidate.name === "CrashLoopBackOff Detection";
      },
    ) as BuiltTemplate;

    expect(template.queries.map(metricNameOf)).toEqual([
      "k8s.container.restarts",
    ]);
    expect(groupByOf(template)).toContain("resource.k8s.pod.name");
    expect(comparisonOf(primary(template.first))).toEqual({
      filterType: FilterType.GreaterThan,
      value: 5,
    });
    expect(englishPage(KUBERNETES)).toContain(
      "so the count does not fall back once it has passed 5.",
    );
  });

  it("the control-plane templates need the agent's control-plane scrape, which is off by default", () => {
    const values: string = source(
      "HelmChart/Public/kubernetes-agent/values.yaml",
    );

    expect(values).toContain("controlPlane:\n  enabled: false");

    for (const template of templates) {
      if (template.category === "ControlPlane") {
        expect(englishPage(KUBERNETES)).toContain(`**${template.name}**`);
      }
    }

    expect(
      templates
        .filter((template: KubernetesAlertTemplate): boolean => {
          return template.category === "ControlPlane";
        })
        .map((template: KubernetesAlertTemplate): string => {
          return template.name;
        }),
    ).toEqual(["etcd No Leader", "API Server Request Saturation"]);
    expect(englishPage(KUBERNETES)).toContain("`controlPlane.enabled`");
  });
});

describe(`${KUBERNETES}: the metric catalog`, () => {
  const CATEGORY_ROWS: Record<string, string> = {
    Pod: "Pod",
    Node: "Node",
    Container: "Container",
    Workload: "Workload",
    HPA: "HPA",
    ControlPlane: "Control Plane",
  };

  it("lists every metric the Custom Metric tab offers, under its category", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(KUBERNETES, "## Metric catalog"),
    );
    const listed: Record<string, Array<string>> = {};

    for (const cells of rows) {
      listed[cells[0] as string] = (cells[1] as string).split(/, (?![^(]*\))/);
    }

    const expected: Record<string, Array<string>> = {};

    for (const metric of getAllKubernetesMetrics()) {
      const category: string = CATEGORY_ROWS[metric.category] as string;

      expected[category] = [...(expected[category] || []), metric.friendlyName];
    }

    expect(listed).toEqual(expected);
  });

  it("gives the pod phase codes the catalog gives", () => {
    const phase: KubernetesMetricDefinition = getAllKubernetesMetrics().find(
      (metric: KubernetesMetricDefinition): boolean => {
        return metric.metricName === "k8s.pod.phase";
      },
    ) as KubernetesMetricDefinition;

    for (const [code, name] of [
      [1, "Pending"],
      [2, "Running"],
      [3, "Succeeded"],
      [4, "Failed"],
      [5, "Unknown"],
    ] as Array<[number, string]>) {
      expect(phase.description).toContain(`${code} = ${name}`);
      expect(englishPage(KUBERNETES)).toContain(`${code} ${name}`);
    }

    expect(phase.friendlyName).toBe("Pod Phase (Code)");
  });

  it("says Pod and Node CPU Usage are in cores", () => {
    for (const name of ["Pod CPU Usage", "Node CPU Usage"]) {
      const metric: KubernetesMetricDefinition = getAllKubernetesMetrics().find(
        (candidate: KubernetesMetricDefinition): boolean => {
          return candidate.friendlyName === name;
        },
      ) as KubernetesMetricDefinition;

      expect(metric.unit).toBe("cores");
    }

    expect(englishPage(KUBERNETES)).toContain(
      "**Pod CPU Usage** and **Node CPU Usage** are in cores, not percent",
    );
  });
});

describe(`${KUBERNETES}: the form`, () => {
  const form: string = source(
    `${FORMS}/KubernetesMonitor/KubernetesMonitorStepForm.tsx`,
  );

  it("scopes to the levels the page lists, each showing the filters the page lists", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(KUBERNETES, "### Resource scope and filters"),
    );

    expect(
      rows.map((cells: Array<string>): string => {
        return cells[0] as string;
      }),
    ).toEqual(["Cluster", "Namespace", "Workload", "Node", "Pod"]);

    for (const scope of ["Cluster", "Namespace", "Workload", "Node", "Pod"]) {
      expect(form).toContain(`label: "${scope}",`);
    }

    for (const filter of [
      "Namespace",
      "Workload Name",
      "Node Name",
      "Pod Name",
    ]) {
      expect(form).toContain(`title="${filter}"`);
    }

    // Namespace shows for the namespace, workload and pod scopes.
    expect(
      rows.map((cells: Array<string>): string => {
        return cells[2] as string;
      }),
    ).toEqual([
      "—",
      "**Namespace**",
      "**Namespace**, **Workload Name**",
      "**Node Name**",
      "**Namespace**, **Pod Name**",
    ]);
    expect(form).toContain(
      "const showNamespaceFilter: boolean =\n    monitorStepKubernetesMonitor.resourceScope ===\n      KubernetesResourceScope.Namespace ||\n    monitorStepKubernetesMonitor.resourceScope ===\n      KubernetesResourceScope.Workload ||\n    monitorStepKubernetesMonitor.resourceScope === KubernetesResourceScope.Pod;",
    );
  });

  it("names the cluster field and the search word", () => {
    expect(form).toContain('title="Kubernetes Cluster"');
    expect(englishPage(KUBERNETES)).toContain("**Kubernetes Cluster**");

    const props: MonitorTypeProps = monitorTypeProps(MonitorType.Kubernetes);

    expect(props.keywords).toContain("k8s");
    expect(englishPage(KUBERNETES)).toContain("type `k8s` in the search box");
  });
});

function monitorTypeProps(monitorType: MonitorType): MonitorTypeProps {
  return MonitorTypeHelper.getAllMonitorTypeProps().find(
    (props: MonitorTypeProps): boolean => {
      return props.monitorType === monitorType;
    },
  ) as MonitorTypeProps;
}

interface CreateFacts {
  page: string;
  monitorType: MonitorType;
  // The type picker's title, as the "Pick ..." step names it.
  pickerTitle: string;
  form: string;
  configurationTitle: string;
  resourceField: string;
  metricField: string;
  searchWord: string | null;
}

const CREATE_FACTS: Array<CreateFacts> = [
  {
    page: DOCKER,
    monitorType: MonitorType.Docker,
    pickerTitle: "Docker Container",
    form: "DockerMonitor/DockerMonitorStepForm.tsx",
    configurationTitle: "Docker Monitor Configuration",
    resourceField: "Docker Host",
    metricField: "Docker Metric",
    searchWord: "docker",
  },
  {
    page: HOST,
    monitorType: MonitorType.Host,
    pickerTitle: "Host",
    form: "HostMonitor/HostMonitorStepForm.tsx",
    configurationTitle: "Host Monitor Configuration",
    resourceField: "Host",
    metricField: "Host Metric",
    searchWord: null,
  },
  {
    page: PODMAN,
    monitorType: MonitorType.Podman,
    pickerTitle: "Podman Container",
    form: "PodmanMonitor/PodmanMonitorStepForm.tsx",
    configurationTitle: "Podman Monitor Configuration",
    resourceField: "Podman Host",
    metricField: "Podman Metric",
    searchWord: "podman",
  },
  {
    page: PROXMOX,
    monitorType: MonitorType.Proxmox,
    pickerTitle: "Proxmox",
    form: "ProxmoxMonitor/ProxmoxMonitorStepForm.tsx",
    configurationTitle: "Proxmox Monitor Configuration",
    resourceField: "Proxmox Cluster",
    metricField: "Proxmox Metric",
    searchWord: "proxmox",
  },
  {
    page: SWARM,
    monitorType: MonitorType.DockerSwarm,
    pickerTitle: "Docker Swarm",
    form: "DockerSwarmMonitor/DockerSwarmMonitorStepForm.tsx",
    configurationTitle: "Docker Swarm Monitor Configuration",
    resourceField: "Docker Swarm Cluster",
    metricField: "Docker Swarm Metric",
    searchWord: "swarm",
  },
];

describe("creating a telemetry-backed infrastructure monitor", () => {
  const infrastructure: MonitorTypeCategory =
    MonitorTypeHelper.getMonitorTypeCategories().find(
      (category: MonitorTypeCategory): boolean => {
        return category.label === "Infrastructure";
      },
    ) as MonitorTypeCategory;
  const monitorStepForm: string = source(`${FORMS}/MonitorStep.tsx`);

  it.each(CREATE_FACTS)(
    "$page picks $pickerTitle under Infrastructure, behind More monitor types",
    (facts: CreateFacts) => {
      expect(infrastructure.monitorTypes).toContain(facts.monitorType);
      expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
        facts.monitorType,
      );
      expect(monitorTypeProps(facts.monitorType).title).toBe(facts.pickerTitle);
      expect(englishPage(facts.page)).toContain(
        `click **More monitor types** and pick **${facts.pickerTitle}** under **Infrastructure**`,
      );

      if (facts.searchWord) {
        const props: MonitorTypeProps = monitorTypeProps(facts.monitorType);
        const searchable: string = [props.title, ...props.keywords]
          .join(" ")
          .toLowerCase();

        expect(searchable).toContain(facts.searchWord);
        expect(englishPage(facts.page)).toContain(
          `type \`${facts.searchWord}\` in the search box`,
        );
      }
    },
  );

  it.each(CREATE_FACTS)(
    "$page names the form's configuration card, resource field, metric field and tabs",
    (facts: CreateFacts) => {
      const form: string = source(`${FORMS}/${facts.form}`);
      const page: string = englishPage(facts.page);

      expect(monitorStepForm).toContain(`title="${facts.configurationTitle}"`);
      expect(page).toContain(`Under **${facts.configurationTitle}**, pick the`);
      expect(form).toContain(`title="${facts.resourceField}"`);
      expect(page).toContain(`from **${facts.resourceField}**.`);
      expect(form).toContain(`title="${facts.metricField}"`);
      expect(page).toContain(`| **${facts.metricField}** | Custom Metric |`);

      const tabs: Array<string> = Array.from(
        form.matchAll(/name: "([^"]+)",\n\s+children: render/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(tabs).toEqual(["Quick Setup", "Custom Metric", "Advanced"]);
      expect(page).toContain("Pick one of the three tabs:");
    },
  );

  it.each([
    ...CREATE_FACTS.map((facts: CreateFacts) => {
      return facts.form;
    }),
    "KubernetesMonitor/KubernetesMonitorStepForm.tsx",
  ])("%s offers the aggregations the pages list", (formFile: string) => {
    const form: string = source(`${FORMS}/${formFile}`);
    const labels: Array<string> = Array.from(
      form.matchAll(
        /\{ label: "([^"]+)", value: MetricsAggregationType\.\w+ \}/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(labels).toEqual(["Average", "Maximum", "Minimum", "Sum", "Count"]);
  });

  it("every page lists those aggregations and the time range", () => {
    for (const facts of CREATE_FACTS) {
      expect(englishPage(facts.page)).toContain(
        "How samples are combined: **Average**, **Maximum**, **Minimum**, **Sum** or **Count**. Starts at the metric's usual aggregation.",
      );
      expect(englishPage(facts.page)).toContain(
        "The rolling window the query reads, from **Past 1 Minute** to **Past 365 Days**. A new monitor starts at **Past 1 Minute**; templates set their own.",
      );
    }

    expect(englishPage(KUBERNETES)).toContain(
      "**Aggregation** (Average, Maximum, Minimum, Sum or Count)",
    );
    expect(englishPage(KUBERNETES)).toContain(
      "from **Past 1 Minute** up to **Past 365 Days**",
    );

    const windows: Array<string> = Object.values(RollingTime);

    expect(windows[0]).toBe("Past 1 Minute");
    expect(windows[windows.length - 1]).toBe("Past 365 Days");
  });

  it("a new monitor starts at Past 1 Minute", () => {
    for (const config of [
      MonitorStepDockerMonitorUtil.getDefault(),
      MonitorStepHostMonitorUtil.getDefault(),
      MonitorStepPodmanMonitorUtil.getDefault(),
      MonitorStepProxmoxMonitorUtil.getDefault(),
      MonitorStepDockerSwarmMonitorUtil.getDefault(),
      MonitorStepKubernetesMonitorUtil.getDefault(),
    ]) {
      expect(config.rollingTime).toBe(RollingTime.Past1Minute);
    }
  });

  it("a template's names stay as the picker shows them, and its Time Range stays editable", () => {
    for (const facts of CREATE_FACTS) {
      const form: string = source(`${FORMS}/${facts.form}`);

      expect(form).toContain(
        "The following settings have been auto-configured. You can adjust the time range below.",
      );
      expect(englishPage(facts.page)).toContain(
        "You can still change the **Time Range**.",
      );
    }
  });

  it("the Recommendations page of each resource sets up several templates at once", () => {
    const viewMenus: Record<string, string> = {
      [DOCKER]: "Docker",
      [HOST]: "Host",
      [PODMAN]: "Podman",
      [PROXMOX]: "Proxmox",
      [SWARM]: "DockerSwarm",
    };

    for (const [page, folder] of Object.entries(viewMenus)) {
      expect(
        source(`${DASHBOARD_SRC}/Pages/${folder}/View/SideMenu.tsx`),
      ).toContain('title: "Recommendations"');
      expect(englishPage(page)).toContain("and go to **Recommendations**.");
    }
  });
});

describe("the Products menu paths the pages give", () => {
  const navigation: string = source(
    `${DASHBOARD_SRC}/Utils/NavigationItems.tsx`,
  );

  // The product's title key in the Products menu, and its own side menu folder.
  const PRODUCTS: Record<
    string,
    { titleKey: string; folder: string; list: string }
  > = {
    Hosts: { titleKey: "hostsTitle", folder: "Host", list: "All Hosts" },
    Kubernetes: {
      titleKey: "kubernetesTitle",
      folder: "Kubernetes",
      list: "All Clusters",
    },
    Docker: { titleKey: "dockerTitle", folder: "Docker", list: "All Hosts" },
    Podman: { titleKey: "podmanTitle", folder: "Podman", list: "All Hosts" },
    Proxmox: {
      titleKey: "proxmoxTitle",
      folder: "Proxmox",
      list: "All Clusters",
    },
    "Docker Swarm": {
      titleKey: "dockerSwarmTitle",
      folder: "DockerSwarm",
      list: "All Clusters",
    },
  };

  const PATH: RegExp =
    /\*\*Products → Infrastructure → ([^*→]+?)(?: → ([^*]+?))?\*\*/g;

  it("each product is under Infrastructure, and each path's last step is on the product's own menu", () => {
    let paths: number = 0;

    for (const page of TELEMETRY_PAGES) {
      for (const match of Array.from(englishPage(page).matchAll(PATH))) {
        const product: string = (match[1] as string).trim();
        const facts: { titleKey: string; folder: string; list: string } =
          PRODUCTS[product] as {
            titleKey: string;
            folder: string;
            list: string;
          };

        expect({ page, product, known: true }).toEqual({
          page,
          product,
          known: facts !== undefined,
        });

        const at: number = navigation.indexOf(
          `t("navbar.items.${facts.titleKey}"`,
        );
        const category: RegExpMatchArray | null = navigation
          .slice(at)
          .match(/category: (\w+),/);

        expect(at).toBeGreaterThan(0);
        expect(category?.[1]).toBe("infrastructureCategory");

        if (match[2]) {
          const menu: string = source(
            `${DASHBOARD_SRC}/Pages/${facts.folder}/SideMenu.tsx`,
          );

          expect(menu).toContain(`title: "${(match[2] as string).trim()}"`);
        }

        paths++;
      }
    }

    expect(paths).toBeGreaterThanOrEqual(10);
  });

  it("names each product's list as its menu does", () => {
    for (const facts of Object.values(PRODUCTS)) {
      expect(
        source(`${DASHBOARD_SRC}/Pages/${facts.folder}/SideMenu.tsx`),
      ).toContain(`title: "${facts.list}"`);
    }
  });
});

describe("the criteria of the telemetry-backed monitors", () => {
  const criteriaForm: string = source(`${FORMS}/CriteriaFilter.tsx`);

  it("check only the metric value: no Filter Type", () => {
    for (const monitorType of [
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.Proxmox,
      MonitorType.DockerSwarm,
    ]) {
      expect(CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType)).toBe(
        true,
      );
      expect(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
          (option: DropdownOption): string => {
            return String(option.value);
          },
        ),
      ).toEqual([CheckOn.MetricValue]);
    }

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "criteria have no **Filter Type**: every rule checks the metric value, with these fields.",
      );
    }

    expect(englishPage(KUBERNETES)).toContain(
      "These monitors always evaluate the **Metric Value**",
    );
    expect(CheckOn.MetricValue).toBe("Metric Value");
  });

  it("name the form's fields as the metric-only form draws them", () => {
    for (const title of [
      '"Aggregation"',
      '"Condition"',
      '"Threshold"',
      'title="Sensitivity"',
      'title="Baseline Window"',
    ]) {
      expect(criteriaForm).toContain(title);
    }

    expect(criteriaForm).toContain(
      'title={isMetricOnly ? "Metric" : "Select Metric Variable"}',
    );
  });

  it("offer the comparisons and anomaly conditions the pages list", () => {
    const conditions: Array<string> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(CheckOn.MetricValue).map(
        (option: DropdownOption): string => {
          return String(option.value);
        },
      );

    expect(conditions.sort()).toEqual(
      [
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.AnomalouslyHigh,
        FilterType.AnomalouslyLow,
        FilterType.Anomalous,
      ].sort(),
    );

    const written: string =
      "**Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** or **Equal To** — or an anomaly condition: **Anomalously High**, **Anomalously Low** or **Anomalous**.";

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(written);
    }

    expect(englishPage(KUBERNETES)).toContain(
      "**Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** and **Equal To**.",
    );
  });

  it("aggregate the window as the pages list", () => {
    expect(Object.values(EvaluateOverTimeType)).toEqual([
      "Average",
      "Sum",
      "Maximum Value",
      "Minimum Value",
      "All Values",
      "Any Value",
    ]);

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "**Average**, **Sum**, **Maximum Value**, **Minimum Value**, **All Values** (every value must match) or **Any Value** (one is enough).",
      );
    }

    expect(
      tableBody(sectionOf(KUBERNETES, "### Aggregation types")).map(
        (cells: Array<string>): string => {
          return cells[0] as string;
        },
      ),
    ).toEqual(Object.values(EvaluateOverTimeType));
  });

  it("detect anomalies with the sensitivities and baseline windows the pages give", () => {
    for (const label of [
      "Low (4σ — egregious deviations only)",
      "Medium (3σ — recommended)",
      "High (2σ — noisier, very stable services)",
    ]) {
      expect(criteriaForm).toContain(`label: "${label}"`);
      expect(englishPage(KUBERNETES)).toContain(`**${label}**`);
    }

    for (const days of [14, 28, 60, 90]) {
      expect(criteriaForm).toContain(`{ value: ${days}, label: "`);
    }

    expect(criteriaForm).toContain('label: "14 days (default)"');
    expect(criteriaForm).toContain("|| AnomalyDetectionSensitivity.Medium;");
    expect(criteriaForm).toContain('"Learning" state');

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "**Low** (4σ), **Medium** (3σ, the default) or **High** (2σ).",
      );
      expect(englishPage(page)).toContain(
        "14 days (the default), 28, 60 or 90 days of history.",
      );
      expect(englishPage(page)).toContain('They stay in a "Learning" state');
    }
  });

  it("fold If No Data under More fields, with Ignore the default", () => {
    const moreFields: number = criteriaForm.indexOf(
      "title={MORE_FIELDS_SECTION_TITLE}",
    );

    expect(moreFields).toBeGreaterThan(0);
    expect(
      criteriaForm.indexOf('title="If No Data"', moreFields),
    ).toBeGreaterThan(moreFields);
    expect(criteriaForm).toContain(
      "criteriaFilter?.metricMonitorOptions?.onNoDataPolicy ||\n                        NoDataPolicy.Ignore;",
    );
    expect(Object.values(NoDataPolicy).sort()).toEqual(
      ["Ignore", "Treat As Zero", "Trigger"].sort(),
    );

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "| **If No Data** | Under **More fields**. What happens when the window has no samples: **Ignore** (the default), **Treat As Zero** or **Trigger**. |",
      );
    }

    expect(englishPage(KUBERNETES)).toContain(
      "**If No Data**, under **More fields**, decides what happens when the query returns nothing in the window: **Ignore** (the default)",
    );
  });

  it.each([
    [DOCKER, MonitorType.Docker],
    [HOST, MonitorType.Host],
    [PODMAN, MonitorType.Podman],
    [PROXMOX, MonitorType.Proxmox],
    [SWARM, MonitorType.DockerSwarm],
  ])(
    "%s states the default criteria a new %s monitor gets",
    (page: string, monitorType: MonitorType) => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: monitorType,
          monitorName: "Acme",
          ...IDS,
        });
      const [offline, online] = criteria.data!.monitorCriteriaInstanceArray as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];
      const rows: Array<Array<string>> = tableBody(
        sectionOf(page, "### Default criteria"),
      );

      expect(criteria.data!.monitorCriteriaInstanceArray).toHaveLength(2);

      expect(offline.data!.name).toBe("Check if Acme is offline");
      expect(comparisonOf(primary(offline))).toEqual({
        filterType: FilterType.EqualTo,
        value: 0,
      });
      expect(windowAggregationOf(primary(offline))).toBe(
        EvaluateOverTimeType.AnyValue,
      );
      expect(offline.data!.monitorStatusId).toEqual(IDS.offlineMonitorStatusId);
      expect(offline.data!.createIncidents).toBe(true);
      expect(offline.data!.incidents[0]!.title).toBe("Acme is offline");
      expect(offline.data!.incidents[0]!.autoResolveIncident).toBe(true);

      expect(online.data!.name).toBe("Check if Acme is online");
      expect(comparisonOf(primary(online))).toEqual({
        filterType: FilterType.GreaterThan,
        value: 0,
      });
      expect(online.data!.monitorStatusId).toEqual(IDS.onlineMonitorStatusId);
      expect(online.data!.createIncidents).toBe(false);

      expect(rows).toEqual([
        [
          "1",
          "Check if _monitor name_ is offline",
          "Any value of the first query is `0`",
          'Marks the monitor **Offline** and declares the incident "_monitor name_ is offline", which resolves itself when the monitor recovers.',
        ],
        [
          "2",
          "Check if _monitor name_ is online",
          "Any value is above `0`",
          "Marks the monitor **Operational**.",
        ],
      ]);
    },
  );
});

describe("when the telemetry-backed monitors are checked", () => {
  it("every minute", () => {
    expect(
      source(
        "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/ScheduleTelemetryMonitorEvaluations.ts",
      ),
    ).toContain("{ schedule: EVERY_MINUTE, runOnStartup: false }");

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(
        "Every minute it runs its query over that",
      );
    }

    expect(englishPage(KUBERNETES)).toContain(
      "Every minute, the monitor queries those metrics over its **Time Range**",
    );
  });

  it("a check waits while its window holds time OneUptime was not receiving, and every page says so", () => {
    const worker: string = source(WORKER);

    expect(worker).toContain(
      "await ReceivingCoverage.planTelemetryEvaluation({",
    );
    expect(worker).toContain("if (!plan.evaluate) {");

    for (const monitorType of [
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.Proxmox,
      MonitorType.DockerSwarm,
    ]) {
      expect(MonitorTypeHelper.isTelemetryMonitor(monitorType)).toBe(true);
    }

    for (const page of TELEMETRY_PAGES) {
      expect(englishPage(page)).toContain(
        "Time OneUptime itself was not receiving is never no data: a check whose window holds it waits instead, as [When OneUptime Is Not Receiving Data](/docs/monitor/when-oneuptime-is-not-receiving) explains.",
      );
    }
  });
});

describe("the worker scopes each monitor as its page says", () => {
  const worker: string = source(WORKER);

  it("Docker and Podman: the host's resource.host.name, plus the runtime", () => {
    const docker: string = functionBody(worker, "export const monitorDocker");
    const podman: string = functionBody(worker, "export const monitorPodman");

    expect(docker).toContain('attributes["resource.host.name"]');
    expect(docker).toContain(
      'attributes["resource.container.runtime"] = "docker";',
    );
    expect(podman).toContain('attributes["resource.host.name"]');
    expect(podman).toContain(
      'attributes["resource.container.runtime"] = "podman";',
    );

    for (const [page, runtime] of [
      [DOCKER, "docker"],
      [PODMAN, "podman"],
    ] as Array<[string, string]>) {
      expect(englishPage(page)).toContain(
        `Scopes every query to the host's \`resource.host.name\`. OneUptime also adds \`resource.container.runtime = ${runtime}\` to every query.`,
      );
    }

    for (const body of [docker, podman]) {
      expect(body).toContain('attributes["resource.container.name"]');
      expect(body).toContain('attributes["resource.container.image.name"]');
    }
  });

  it("Host: the host's resource.host.name only", () => {
    const host: string = functionBody(worker, "export const monitorHost");

    expect(host).toContain('attributes["resource.host.name"]');
    expect(host).not.toContain("resource.container.runtime");
    expect(englishPage(HOST)).toContain(
      "| **Host** | All | Required. Scopes every query to the host's `resource.host.name`. |",
    );
  });

  it("Proxmox: the cluster, then the Guest ID over the Node Name over the scope and PVE ID", () => {
    const proxmox: string = functionBody(worker, "export const monitorProxmox");
    const guest: number = proxmox.indexOf("if (resourceFilters.guestId) {");
    const node: number = proxmox.indexOf(
      "} else if (resourceFilters.nodeName) {",
    );

    expect(proxmox).toContain('attributes["resource.proxmox.cluster.name"]');
    expect(guest).toBeGreaterThan(0);
    expect(node).toBeGreaterThan(guest);
    expect(proxmox).toContain(
      'attributes["pve.scope"] = ProxmoxResourceScope.Node;',
    );
    expect(englishPage(PROXMOX)).toContain(
      "Exact match on the raw `id` label, such as `qemu/100` or `lxc/101`. When set, the other filters are ignored.",
    );
  });

  it("Docker Swarm: the cluster name, and no runtime or host filter", () => {
    const swarm: string = functionBody(
      worker,
      "export const monitorDockerSwarm",
    );

    expect(swarm).toContain('attributes["resource.docker.swarm.cluster.name"]');
    expect(swarm).not.toContain('attributes["resource.container.runtime"]');
    expect(swarm).not.toContain('attributes["resource.host.name"]');
    expect(swarm).toContain('attributes["docker.swarm.service.name"]');
    expect(swarm).toContain('attributes["docker.swarm.node.name"]');
  });
});

describe("the agents the pages describe", () => {
  it("Docker: docker_stats every 30 seconds, json-file logs, and the optional metrics it turns on", () => {
    const config: string = source(
      "agents/DockerAgent/otel-collector-config.yaml",
    );

    expect(config).toContain("endpoint: unix:///var/run/docker.sock");
    expect(config).toContain("collection_interval: 30s");
    expect(config).toContain("- /var/lib/docker/containers/*/*-json.log");
    expect(englishPage(DOCKER)).toContain(
      "The agent looks for `/var/lib/docker/containers/*/*-json.log`",
    );
  });

  it("Podman: Podman's Docker-compatible socket every 30 seconds, and the k8s-file logs", () => {
    const config: string = source(
      "agents/PodmanAgent/otel-collector-config.yaml",
    );

    expect(config).toContain("endpoint: unix:///run/podman/podman.sock");
    expect(config).toContain("collection_interval: 30s");
    expect(config).toContain(
      "- /var/lib/containers/storage/overlay-containers/*/userdata/ctr.log",
    );
    expect(englishPage(PODMAN)).toContain(
      "Podman's Docker-compatible socket, `/run/podman/podman.sock`, every 30 seconds",
    );
    expect(englishPage(PODMAN)).toContain(
      "at `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`",
    );
  });

  it.each([
    ["agents/DockerAgent/otel-collector-config.yaml", DOCKER],
    ["agents/PodmanAgent/otel-collector-config.yaml", PODMAN],
  ])(
    "%s reads a level where one sits in the line, and falls back to the stream",
    (configPath: string, page: string) => {
      const config: string = source(configPath);

      expect(config).toContain(
        'value: \'EXPR(attributes["log.iostream"] == "stderr" ? "ERROR" : "INFO")\'',
      );
      expect(config).toContain(
        "is_first_entry: 'body matches \"^[^\\\\s\\\\}\\\\)\\\\]]\"'",
      );
      expect(englishPage(page)).toContain(
        "A line with no level falls back to its stream: `stderr` is `ERROR`, `stdout` is `INFO`.",
      );
    },
  );

  it.each([
    [
      "agents/DockerAgent/otel-collector-config.yaml",
      DOCKER,
      getAllDockerMetrics,
    ],
    [
      "agents/PodmanAgent/otel-collector-config.yaml",
      PODMAN,
      getAllPodmanMetrics,
    ],
  ] as Array<
    [
      string,
      string,
      () => Array<DockerMetricDefinition | PodmanMetricDefinition>,
    ]
  >)(
    "%s leaves off the extra metrics the page says the picker lists but the agent does not turn on",
    (
      configPath: string,
      page: string,
      catalog: () => Array<DockerMetricDefinition | PodmanMetricDefinition>,
    ) => {
      const config: string = source(configPath);
      const extras: Array<string> = [
        "container.cpu.usage.percpu",
        "container.memory.rss",
        "container.memory.cache",
        "container.network.io.usage.rx_packets",
        "container.network.io.usage.tx_packets",
      ];
      const listed: Array<string> = catalog().map(
        (metric: DockerMetricDefinition | PodmanMetricDefinition): string => {
          return metric.metricName;
        },
      );

      for (const metric of extras) {
        expect(listed).toContain(metric);
        expect(config).not.toContain(`${metric}:\n        enabled: true`);
      }

      for (const metric of [
        "container.restarts",
        "container.uptime",
        "container.pids.count",
        "container.cpu.throttling_data.throttled_time",
        "container.cpu.throttling_data.throttled_periods",
      ]) {
        expect(config).toContain(`${metric}:\n        enabled: true`);
      }

      // Collected, but not offered by the Custom Metric picker.
      expect(listed).not.toContain(
        "container.cpu.throttling_data.throttled_periods",
      );
      expect(englishPage(page)).toContain(
        "`container.cpu.throttling_data.throttled_periods` is not in the list; query it from **Advanced**.",
      );
    },
  );

  it("Docker Swarm: the collector stamps only the cluster name, and the inventory is read every 5 minutes", () => {
    const config: string = source(
      "agents/DockerSwarmAgent/otel-collector-config.yaml",
    );
    const compose: string = source(
      "agents/DockerSwarmAgent/docker-compose.yml",
    );

    expect(config).toContain("collection_interval: 30s");
    expect(config).toContain("- key: docker.swarm.cluster.name");
    expect(config).not.toContain("docker.swarm.service.name");
    expect(config).not.toContain("docker.swarm.node.name");
    expect(compose).toContain(
      "DOCKER_INVENTORY_INTERVAL_SECONDS=${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}",
    );
    expect(englishPage(SWARM)).toContain(
      "reads the cluster's nodes, services and tasks from the Swarm API every 5 minutes",
    );
    expect(englishPage(SWARM)).toContain(
      "The shipped agent does not set `docker.swarm.service.name` or `docker.swarm.node.name` yet",
    );
  });

  it("Proxmox: the cluster and node collectors every 30 seconds, and id split into pve.scope, pve.type and pve.id", () => {
    const config: string = source(
      "agents/ProxmoxAgent/otel-collector-config.yaml",
    );

    expect(config).toContain('cluster: ["1"]');
    expect(config).toContain('node: ["1"]');
    expect(config).toContain("scrape_interval: 30s");

    for (const [prefix, scope, type] of [
      ["node", "node", "node"],
      ["qemu", "guest", "qemu"],
      ["lxc", "guest", "lxc"],
      ["storage", "storage", "storage"],
    ] as Array<[string, string, string]>) {
      expect(config).toContain(
        `set(attributes["pve.scope"], "${scope}") where attributes["id"] != nil and IsMatch(attributes["id"], "^${prefix}/")`,
      );
      expect(config).toContain(
        `set(attributes["pve.type"], "${type}") where attributes["id"] != nil and IsMatch(attributes["id"], "^${prefix}/")`,
      );
    }

    expect(config).toContain(
      'replace_pattern(attributes["pve.id"], "^[^/]+/", "")',
    );
    expect(englishPage(PROXMOX)).toContain(
      "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` are both `guest`) | `guest` |",
    );
  });

  it("Proxmox: a silent native-push node stays Offline for up to 7 days unless it is removed", () => {
    const cleanup: string = source(
      "packages/App/FeatureSet/Workers/Jobs/Proxmox/CleanupStaleResources.ts",
    );
    const nodePage: string = source(
      `${DASHBOARD_SRC}/Pages/Proxmox/View/NodeDetail.tsx`,
    );

    expect(cleanup).toContain("(7 days by default,");
    expect(nodePage).toContain('title="Remove Node"');
    expect(englishPage(PROXMOX)).toContain(
      "Open the node's page and click **Remove Node** — the node goes away and its alert resolves. Otherwise it stays Offline for up to 7 days.",
    );
  });
});

describe("the metric tables against the catalogs", () => {
  const DOCKER_HEADINGS: Record<string, string> = {
    CPU: "### CPU",
    Memory: "### Memory",
    Network: "### Network",
    BlockIO: "### Block I/O",
    Container: "### Container",
  };

  function firstColumnCode(text: string): Array<string> {
    return tableBody(text).map((cells: Array<string>): string => {
      return (cells[0] as string).replace(/`/g, "");
    });
  }

  it.each([
    [DOCKER, getAllDockerMetrics],
    [PODMAN, getAllPodmanMetrics],
  ] as Array<
    [string, () => Array<DockerMetricDefinition | PodmanMetricDefinition>]
  >)(
    "%s lists every catalog metric under its category, or in the sentence on the extras",
    (
      page: string,
      catalog: () => Array<DockerMetricDefinition | PodmanMetricDefinition>,
    ) => {
      const extras: string = sectionOf(page, "### Container")
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("The **");
        })
        .join("\n");

      for (const metric of catalog()) {
        const listed: boolean = firstColumnCode(
          sectionOf(page, DOCKER_HEADINGS[metric.category] as string),
        ).includes(metric.metricName);
        const mentioned: boolean =
          extras.includes(`\`${metric.metricName}\``) ||
          (metric.metricName.endsWith("_packets") &&
            extras.includes("the network packet counters"));

        expect({ metric: metric.metricName, onThePage: true }).toEqual({
          metric: metric.metricName,
          onThePage: listed || mentioned,
        });
      }
    },
  );

  it("Host lists exactly the Host Metric catalog, with its units, under its categories", () => {
    const HEADINGS: Record<string, string> = {
      CPU: "### CPU",
      Memory: "### Memory",
      Disk: "### Disk",
      Network: "### Network",
      Load: "### Load",
      Processes: "### Processes",
    };
    const listed: Array<string> = [];

    for (const metric of getAllHostMetrics()) {
      const rows: Array<Array<string>> = tableBody(
        sectionOf(HOST, HEADINGS[metric.category] as string),
      );
      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === `\`${metric.metricName}\``;
        },
      );

      expect({ metric: metric.metricName, row: row?.[1] }).toEqual({
        metric: metric.metricName,
        row: metric.unit,
      });
      listed.push(metric.metricName);
    }

    const onPage: Array<string> = Object.values(HEADINGS).flatMap(
      (heading: string): Array<string> => {
        return firstColumnCode(sectionOf(HOST, heading));
      },
    );

    expect(onPage.sort()).toEqual(listed.sort());
  });

  it("Docker Swarm lists exactly its catalog, with units", () => {
    const HEADINGS: Record<string, string> = {
      CPU: "### CPU",
      Memory: "### Memory",
      Network: "### Network",
      Container: "### Container",
    };

    for (const metric of getAllDockerSwarmMetrics()) {
      const row: Array<string> | undefined = tableBody(
        sectionOf(SWARM, HEADINGS[metric.category] as string),
      ).find((cells: Array<string>): boolean => {
        return cells[0] === `\`${metric.metricName}\``;
      });

      expect({ metric: metric.metricName, unit: row?.[1] }).toEqual({
        metric: metric.metricName,
        unit: (metric as DockerSwarmMetricDefinition).unit,
      });
    }

    const onPage: Array<string> = Object.values(HEADINGS).flatMap(
      (heading: string): Array<string> => {
        return firstColumnCode(sectionOf(SWARM, heading));
      },
    );

    expect(onPage.sort()).toEqual(
      getAllDockerSwarmMetrics()
        .map((metric: DockerSwarmMetricDefinition): string => {
          return metric.metricName;
        })
        .sort(),
    );
  });

  it("Proxmox lists exactly its catalog, with units, under its categories", () => {
    const HEADINGS: Record<string, string> = {
      Availability: "### Availability",
      Node: "### Node",
      Guest: "### Guest",
      Storage: "### Storage",
      HA: "### HA",
      Backup: "### Backup",
      Replication: "### Replication",
    };

    for (const metric of getAllProxmoxMetrics()) {
      const row: Array<string> | undefined = tableBody(
        sectionOf(PROXMOX, HEADINGS[metric.category] as string),
      ).find((cells: Array<string>): boolean => {
        return cells[0] === `\`${metric.metricName}\``;
      });

      expect({ metric: metric.metricName, unit: row?.[1] }).toEqual({
        metric: metric.metricName,
        unit: (metric as ProxmoxMetricDefinition).unit || "—",
      });
    }

    const onPage: Array<string> = Object.values(HEADINGS).flatMap(
      (heading: string): Array<string> => {
        return firstColumnCode(sectionOf(PROXMOX, heading));
      },
    );

    expect(onPage.sort()).toEqual(
      getAllProxmoxMetrics()
        .map((metric: ProxmoxMetricDefinition): string => {
          return metric.metricName;
        })
        .sort(),
    );
  });

  it("the Host page's metric list is the Host Metric picker's", () => {
    for (const metric of getAllHostMetrics()) {
      expect((metric as HostMetricDefinition).metricName).toBeTruthy();
    }

    expect(englishPage(HOST)).toContain(
      "| **Host Metric** | Custom Metric | One metric from the [catalog](#collected-metrics), grouped as CPU, memory, disk, network, load and processes. |",
    );
  });
});

describe(`${SERVER}`, () => {
  const agentMain: string = source("agents/InfrastructureAgent/main.go");
  const agent: string = source("agents/InfrastructureAgent/agent.go");
  const config: string = source("agents/InfrastructureAgent/config.go");
  const logger: string = source("agents/InfrastructureAgent/utils/logger.go");
  const page: string = englishPage(SERVER);

  it("is not offered by Create Monitor, and keeps its name for existing monitors", () => {
    for (const category of MonitorTypeHelper.getMonitorTypeCategories()) {
      expect(category.monitorTypes).not.toContain(MonitorType.Server);
    }

    expect(monitorTypeProps(MonitorType.Server).title).toBe("Server / VM");
    expect(page).toContain(
      "**Create Monitor** no longer offers **Server / VM**.",
    );
  });

  it("the agent reports every 30 seconds, and straight away when it starts", () => {
    expect(agent).toContain("gocron.DurationJob(30*time.Second)");
    expect(agent).toContain("err := ag.mainJob.RunNow()");
    expect(page).toContain("every 30 seconds");
    expect(page).toContain(
      "When it starts, the agent checks the secret key with OneUptime and sends its first report straight away.",
    );
  });

  it("checks the secret key when it starts, and logs what the troubleshooting quotes", () => {
    expect(agent).toContain("if !checkIfSecretKeyIsValid(");
    expect(agent).toContain('slog.Error("Secret key is invalid.');
    expect(agent).toContain(
      'slog.Info("Metrics successfully pushed to OneUptime server"',
    );
    expect(page).toContain("logging `Secret key is invalid`");
    expect(page).toContain(
      "A line `Metrics successfully pushed to OneUptime server` means reports are getting through.",
    );
  });

  it("lists exactly the agent's commands", () => {
    const help: Array<string> = Array.from(
      agentMain.matchAll(/fmt\.Println\(" {2}(\w+) {2,}/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const listed: Array<string> = tableBody(
      sectionOf(SERVER, "### Commands"),
    ).map((cells: Array<string>): string => {
      return (cells[0] as string).replace(/`/g, "").split(" ")[0] as string;
    });

    expect(listed.sort()).toEqual(help.sort());
    expect(help).toEqual(
      expect.arrayContaining([
        "configure",
        "start",
        "stop",
        "restart",
        "status",
        "logs",
        "uninstall",
        "help",
      ]),
    );
  });

  it("configure needs both the secret key and the URL, and takes a proxy", () => {
    expect(agentMain).toContain('installFlags.String("secret-key", "",');
    expect(agentMain).toContain('installFlags.String("oneuptime-url", "",');
    expect(agentMain).toContain('installFlags.String("proxy-url", "",');
    expect(agentMain).toContain(
      'if agentSvc.config.SecretKey == "" || agentSvc.config.OneUptimeURL == "" {',
    );
    expect(page).toContain("Both flags are required.");
  });

  it("start refuses until configure has run; status and logs print what the page says", () => {
    expect(agentMain).toContain(
      "Service configuration not found. Please run 'oneuptime-infrastructure-agent configure' to configure the service.",
    );
    expect(agentMain).toContain('slog.Info("Service is running")');
    expect(agentMain).toContain('logFlags.Int("n", 100, ');
    expect(agentMain).toContain('logFlags.Bool("f", false, ');
    expect(page).toContain("it prints `Service is running`");
    expect(page).toContain(
      "Prints the last 100 lines of the agent's log. `-n <lines>` prints a different number of lines, and `-f` follows new ones.",
    );
  });

  it("uninstall removes the service and deletes the configuration file", () => {
    expect(agentMain).toContain("err := agentSvc.config.removeConfigFile()");
    expect(page).toContain(
      "| `uninstall` | Removes the service and deletes the agent's configuration file. |",
    );
  });

  it("keeps its files where the page says, with the fallback and the overrides", () => {
    expect(config).toContain(
      'basePath = fmt.Sprintf("%setc", string(filepath.Separator))',
    );
    expect(config).toContain('basePath = os.Getenv("PROGRAMDATA")');
    expect(config).toContain(
      'configDirectory := filepath.Join(basePath, "oneuptime-infrastructure-agent")',
    );
    expect(config).toContain(
      'return filepath.Join(configDirectory, "config.json")',
    );
    expect(config).toContain('os.Getenv("ONEUPTIME_AGENT_CONFIG_PATH")');
    expect(config).toContain(
      'configDirectory = filepath.Join(home, ".oneuptime-infrastructure-agent")',
    );
    expect(logger).toContain('basePath = "/var/log"');
    expect(logger).toContain(
      'return filepath.Join(logDirectory, "oneuptime-infrastructure-agent.log")',
    );
    expect(logger).toContain('os.Getenv("ONEUPTIME_AGENT_LOG_PATH")');

    expect(page).toContain(
      "| Configuration | `/etc/oneuptime-infrastructure-agent/config.json` | `%PROGRAMDATA%\\oneuptime-infrastructure-agent\\config.json` |",
    );
    expect(page).toContain(
      "| Log | `/var/log/oneuptime-infrastructure-agent/oneuptime-infrastructure-agent.log` | `%PROGRAMDATA%\\oneuptime-infrastructure-agent\\oneuptime-infrastructure-agent.log` |",
    );
    expect(page).toContain(
      "When the agent cannot write to these directories, it uses `~/.oneuptime-infrastructure-agent/` instead. The `ONEUPTIME_AGENT_CONFIG_PATH` and `ONEUPTIME_AGENT_LOG_PATH` environment variables set either path explicitly.",
    );
  });

  it("installs into $HOME/bin, prints where, and takes -b", () => {
    const script: string = source(
      "packages/App/FeatureSet/Docs/Static/scripts/infrastructure-agent/install.sh",
    );

    expect(script).toContain("BINDIR=$HOME/bin");
    expect(script).toContain('echo "Installing to ${BINDIR}"');
    expect(script).toContain('while getopts "b:d" opt; do');
    expect(page).toContain(
      "puts the `oneuptime-infrastructure-agent` binary in `$HOME/bin`",
    );
    expect(page).toContain("| sudo bash -s -- -b /usr/local/bin");
  });

  it("the Windows downloads are the release's zip archives", () => {
    const release: string = source(
      "agents/InfrastructureAgent/.goreleaser.yaml",
    );

    expect(release).toContain(
      "name_template: '{{ .Binary }}_{{ .Os }}_{{ .Arch }}'",
    );
    expect(release).toContain("- goos: windows\n        format: zip");
    expect(page).toContain(
      "`oneuptime-infrastructure-agent_windows_amd64.zip`",
    );
    expect(page).toContain(
      "`oneuptime-infrastructure-agent_windows_arm64.zip`",
    );
  });

  it("the monitor's setup commands are on Documentation, and on Overview until the first report", () => {
    const documentation: string = source(
      `${DASHBOARD_SRC}/Components/Monitor/ServerMonitor/Documentation.tsx`,
    );
    const setupCard: string = source(
      `${DASHBOARD_SRC}/Components/Monitor/Overview/MonitorSetupCard.tsx`,
    );

    for (const title of [
      "Set up your Server Monitor (Linux/Mac)",
      "Set up your Server Monitor (Windows)",
    ]) {
      expect(documentation).toContain(`<Card title={\`${title}\`}>`);
      expect(page).toContain(`**${title}**`);
    }

    expect(setupCard).toContain(
      "return <ServerMonitorDocumentation secretKey={secretKey} />;",
    );
    expect(setupCard).toContain(
      "The install command contains this monitor's secret key, so only people who can edit monitors can see it.",
    );
    expect(page).toContain(
      "The secret key, and the setup commands that contain it, are only shown to people who can edit monitors.",
    );
  });

  it("the key is reset on the monitor's Settings page", () => {
    expect(
      source(`${DASHBOARD_SRC}/Pages/Monitor/View/Settings.tsx`),
    ).toContain('title={"Reset Server Monitor Secret Key"}');
    expect(page).toContain(
      "on the monitor's **Settings** page, under **Reset Server Monitor Secret Key**",
    );
  });

  it("a silent server is checked every minute, after 3 minutes of silence by default", () => {
    const sweep: string = source(
      "packages/App/FeatureSet/Workers/Jobs/ServerMonitor/CheckOnlineStatus.ts",
    );
    const criteria: string = source(
      "packages/Common/Server/Utils/Monitor/Criteria/ServerMonitorCriteria.ts",
    );

    expect(sweep).toContain("{ schedule: EVERY_MINUTE, runOnStartup: false }");
    expect(sweep).toContain("OneUptimeDate.getSomeMinutesAgo(3)");
    expect(sweep).toContain("if (filters.checkOn === CheckOn.IsOnline) {");
    expect(criteria).toContain("let offlineIfNotCheckedInMinutes: number = 3;");
    expect(criteria).toContain("await ReceivingSilence.measure({");
    expect(page).toContain(
      "Every minute, OneUptime re-evaluates the **Is Online** criteria of every Server / VM monitor that has not reported for 3 minutes or more, and a server silent for longer than its criteria allows (3 minutes by default) counts as offline.",
    );
    expect(page).toContain(RECEIVING_PAGE_LINK);
  });

  it("lists exactly the filter types and conditions the criteria form offers a Server / VM monitor", () => {
    const rows: Array<Array<string>> = tableBody(
      sectionOf(SERVER, "## Monitoring criteria"),
    );
    const offered: Array<string> =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Server).map(
        (option: DropdownOption): string => {
          return String(option.value);
        },
      );

    expect(
      rows
        .map((cells: Array<string>): string => {
          return cells[0] as string;
        })
        .sort(),
    ).toEqual([...offered].sort());

    const cpuConditions: string = (
      rows.find((cells: Array<string>): boolean => {
        return cells[0] === CheckOn.CPUUsagePercent;
      }) as Array<string>
    )[2] as string;

    for (const cells of rows) {
      const written: string =
        cells[2] === "Same as CPU" ? cpuConditions : (cells[2] as string);
      const conditions: Array<string> =
        CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
          cells[0] as CheckOn,
        ).map((option: DropdownOption): string => {
          return String(option.value);
        });

      expect({
        filter: cells[0],
        conditions: written.split(", ").sort(),
      }).toEqual({
        filter: cells[0],
        conditions: [...conditions].sort(),
      });
    }
  });

  it("checks the disk the Disk Path names, / when it is empty, or every disk for *", () => {
    const criteria: string = source(
      "packages/Common/Server/Utils/Monitor/Criteria/ServerMonitorCriteria.ts",
    );
    const form: string = source(`${FORMS}/CriteriaFilter.tsx`);

    expect(form).toContain('title="Disk Path"');
    expect(form).toContain(
      'placeholder={"* or C:\\\\ or /mnt/data or /dev/sda1"}',
    );
    expect(criteria).toMatch(EMPTY_DISK_PATH_IS_ROOT);
    expect(page).toContain(
      "**Disk Path** takes a mount point or device, such as `/`, `/mnt/data`, `C:\\` or `/dev/sda1`; it is `/` when left empty. Enter `*` to check every disk the agent reports",
    );
  });

  it("evaluates over time with the aggregates and no-data choices the page lists", () => {
    const form: string = source(`${FORMS}/CriteriaFilter.tsx`);

    expect(form).toContain(
      'title={"Evaluate this criteria over a period of time"}',
    );
    expect(form).toContain('<FieldLabelElement title="Evaluate" />');
    expect(form).toContain(
      '<FieldLabelElement title="For the last (in minutes)" />',
    );
    expect(page).toContain(
      "chosen under **Evaluate** (Average, Sum, Maximum Value, Minimum Value, All Values, Any Value)",
    );
    expect(
      tableBody(sectionOf(SERVER, "### Evaluate over a period of time")).map(
        (cells: Array<string>): string => {
          return cells[0] as string;
        },
      ),
    ).toEqual(["**Ignore** (default)", "**Trigger**", "**Treat As Zero**"]);
    expect(Object.values(NoDataPolicy)).toEqual(
      expect.arrayContaining(["Ignore", "Trigger", "Treat As Zero"]),
    );
  });
});
