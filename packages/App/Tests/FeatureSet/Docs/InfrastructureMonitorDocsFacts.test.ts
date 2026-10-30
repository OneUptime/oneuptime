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
  getDockerAlertTemplateById,
  getDockerDefaultAlertTemplateId,
} from "Common/Types/Monitor/DockerAlertTemplates";
import {
  DockerMetricDefinition,
  getAllDockerMetrics,
} from "Common/Types/Monitor/DockerMetricCatalog";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmAlertTemplateById,
  getDockerSwarmDefaultAlertTemplateId,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import {
  DockerSwarmMetricDefinition,
  getAllDockerSwarmMetrics,
} from "Common/Types/Monitor/DockerSwarmMetricCatalog";
import {
  HostAlertTemplate,
  getAllHostAlertTemplates,
  getHostAlertTemplateById,
  getHostDefaultAlertTemplateId,
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
  getPodmanAlertTemplateById,
  getPodmanDefaultAlertTemplateId,
} from "Common/Types/Monitor/PodmanAlertTemplates";
import {
  PodmanMetricDefinition,
  getAllPodmanMetrics,
} from "Common/Types/Monitor/PodmanMetricCatalog";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
  getProxmoxAlertTemplateById,
  getProxmoxDefaultAlertTemplateId,
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
import { KUBERNETES_TEMPLATE_CATEGORIES } from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import {
  ALERT_TEMPLATE_CHANGE,
  ALERT_TEMPLATE_TIME_RANGE,
  AlertTemplateCategory,
} from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";
import {
  INFRASTRUCTURE_ALERT_SECTION_TITLE,
  INFRASTRUCTURE_CUSTOM_METRIC_TAB,
  INFRASTRUCTURE_QUERY_BUILDER_TAB,
} from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/InfrastructureMonitorSetup/InfrastructureMonitorSetupText";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
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
// Their own suites hold the rest; they share the criteria table's wording.
const CEPH: string = "monitor/ceph-monitor";
const STORAGE_ARRAY: string = "monitor/storage-array-monitor";
const IOT_DEVICE: string = "monitor/iot-device-monitor";
const VMWARE: string = "monitor/vmware-monitor";

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
const AGGREGATION_WORD: RegExp = /\b(Avg|Max|Min|Sum|Count)\b/;
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
  Count: MetricsAggregationType.Count,
};

const NUMBER_WORDS: Record<number, string> = {
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  11: "eleven",
  12: "twelve",
  17: "seventeen",
  18: "eighteen",
};

/*
 * Each type's Stopped Reporting template: its row says it fires on a silent
 * window and recovers when data comes back, which no threshold phrase above
 * can state - the template's `< 0` on a count only fires through its
 * no-data policy. Checked by the suite of its own below.
 */
const STOPPED_REPORTING_FIRES: string = "No data for the whole window";
const STOPPED_REPORTING_RECOVERS: string = "Data arrives again";

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
        lead.includes(
          `The **${INFRASTRUCTURE_ALERT_SECTION_TITLE}** list offers ${word} templates.`,
        ) ||
          lead.includes(
            `The **${INFRASTRUCTURE_ALERT_SECTION_TITLE}** list offers ${count} templates.`,
          ),
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
  specialRows: ["Host Stopped Reporting"],
});

describeTemplateTable({
  page: PODMAN,
  heading: "## Pre-built Alert Templates",
  templates: podmanTemplates,
  specialRows: ["Host Stopped Reporting"],
});

describeTemplateTable({
  page: HOST,
  heading: "## Pre-built Alert Templates",
  templates: hostTemplates,
  specialRows: ["Host Stopped Reporting"],
});

describeTemplateTable({
  page: SWARM,
  heading: "## Pre-built Alert Templates",
  templates: swarmTemplates,
  specialRows: ["Cluster Stopped Reporting"],
});

describeTemplateTable({
  page: PROXMOX,
  heading: "## Pre-built Alert Templates",
  templates: proxmoxTemplates,
  defaultWindowMinutes: 5,
  specialRows: ["Cluster Stopped Reporting", "Guest Down"],
});

describe("the Stopped Reporting template each page explains", () => {
  const PAGES: Array<{
    page: string;
    name: string;
    templates: () => Array<BuiltTemplate>;
  }> = [
    {
      page: DOCKER,
      name: "Host Stopped Reporting",
      templates: dockerTemplates,
    },
    {
      page: PODMAN,
      name: "Host Stopped Reporting",
      templates: podmanTemplates,
    },
    { page: HOST, name: "Host Stopped Reporting", templates: hostTemplates },
    {
      page: SWARM,
      name: "Cluster Stopped Reporting",
      templates: swarmTemplates,
    },
    {
      page: PROXMOX,
      name: "Cluster Stopped Reporting",
      templates: proxmoxTemplates,
    },
  ];

  it.each(
    PAGES.map(
      (entry: {
        page: string;
        name: string;
        templates: () => Array<BuiltTemplate>;
      }): [string, string, () => Array<BuiltTemplate>] => {
        return [entry.page, entry.name, entry.templates];
      },
    ),
  )(
    "%s: %s comes first, fires on a silent window and recovers when data comes back",
    (page: string, name: string, templates: () => Array<BuiltTemplate>) => {
      const built: Array<BuiltTemplate> = templates();
      const template: BuiltTemplate = built[0] as BuiltTemplate;
      const row: TemplateRow = templateRows(
        page,
        "## Pre-built Alert Templates",
      )[0] as TemplateRow;

      expect(template.name).toBe(name);
      expect(row.name).toBe(name);
      expect(row.fires).toBe(STOPPED_REPORTING_FIRES);
      expect(row.recovers).toBe(STOPPED_REPORTING_RECOVERS);

      // A count is never below 0: only the Trigger no-data policy fires it.
      expect(template.queries.map(aggregationOf)).toEqual([
        MetricsAggregationType.Count,
      ]);
      expect(comparisonOf(primary(template.first))).toEqual({
        filterType: FilterType.LessThan,
        value: 0,
      });
      expect(primary(template.first).metricMonitorOptions?.onNoDataPolicy).toBe(
        NoDataPolicy.Trigger,
      );
      expect(comparisonOf(primary(template.last))).toEqual({
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 0,
      });
      expect(groupByOf(template)).toEqual([]);
      expect(englishPage(page)).toContain(
        `**${name}** fires when nothing arrives from the`,
      );
    },
  );
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
    Availability: "Availability",
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

    expect(picker).toContain("categories={KUBERNETES_TEMPLATE_CATEGORIES}");
    expect(
      Object.fromEntries(
        KUBERNETES_TEMPLATE_CATEGORIES.map(
          (category: AlertTemplateCategory): [string, string] => {
            return [category.category, category.label];
          },
        ),
      ),
    ).toEqual(CATEGORY_LABELS);
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
      `(#pre-built-alert-templates): Eighteen ready-made alerts`,
    );
    expect(templates).toHaveLength(18);
  });

  it("Cluster Stopped Reporting comes first and fires only when the agent sends nothing", () => {
    const template: BuiltTemplate = builtTemplates[0] as BuiltTemplate;

    expect(template.name).toBe("Cluster Stopped Reporting");
    expect(template.queries.map(metricNameOf)).toEqual([
      "k8s.node.condition_ready",
    ]);
    expect(template.queries.map(aggregationOf)).toEqual([
      MetricsAggregationType.Count,
    ]);
    expect(primary(template.first).metricMonitorOptions?.onNoDataPolicy).toBe(
      NoDataPolicy.Trigger,
    );
    expect(template.rollingTime).toBe(RollingTime.Past10Minutes);
    expect(rows[0]).toEqual([
      "Cluster Stopped Reporting",
      "Availability",
      "No data arrives from the cluster's agent for 10 minutes",
      "Critical",
    ]);
  });

  it("CrashLoopBackOff Detection and Job Failures count growth in the window, not the lifetime count", () => {
    function named(name: string): BuiltTemplate {
      return builtTemplates.find((candidate: BuiltTemplate): boolean => {
        return candidate.name === name;
      }) as BuiltTemplate;
    }

    const crashLoop: BuiltTemplate = named("CrashLoopBackOff Detection");

    expect(crashLoop.queries.map(metricNameOf)).toEqual([
      "k8s.container.restarts",
      "k8s.container.restarts",
      "k8s.container.ready",
    ]);
    expect(groupByOf(crashLoop)).toContain("resource.k8s.pod.name");
    expect(crashLoop.formulas).toEqual([
      "container_restarts_max - container_restarts_min",
    ]);
    expect(comparisonOf(primary(crashLoop.first))).toEqual({
      filterType: FilterType.GreaterThan,
      value: 0,
    });
    expect(windowAggregationOf(primary(crashLoop.first))).toBe(
      EvaluateOverTimeType.Sum,
    );
    // ...while the container was ready for less than half the window.
    expect(crashLoop.first.data!.filterCondition).toBe(FilterCondition.All);
    expect(
      comparisonOf(crashLoop.first.data!.filters[1] as CriteriaFilter),
    ).toEqual({ filterType: FilterType.LessThan, value: 0.5 });

    const jobFailures: BuiltTemplate = named("Job Failures");

    expect(jobFailures.formulas).toEqual(["failed_pods_max - failed_pods_min"]);
    expect(windowAggregationOf(primary(jobFailures.first))).toBe(
      EvaluateOverTimeType.Sum,
    );

    expect(englishPage(KUBERNETES)).toContain(
      "count how much a restart or failed-pod count grew in the window, not the count itself",
    );
  });

  it("Node Not Ready fires below 1, so a node whose status is Unknown fires too", () => {
    const template: BuiltTemplate = builtTemplates.find(
      (candidate: BuiltTemplate): boolean => {
        return candidate.name === "Node Not Ready";
      },
    ) as BuiltTemplate;

    expect(comparisonOf(primary(template.first))).toEqual({
      filterType: FilterType.LessThan,
      value: 1,
    });
    expect(comparisonOf(primary(template.last))).toEqual({
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    });
    expect(englishPage(KUBERNETES)).toContain(
      "**Node Ready Condition** is 1 when Ready, 0 when NotReady and -1 when Unknown",
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
      "Workload Kind",
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
      "**Namespace**, **Workload Kind**, **Workload Name**",
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
  // The alert a new monitor starts on, and how the form asks for it.
  defaultTemplateName: string;
  defaultTemplateCall: string;
  // The resource field's Add button, and the file its title comes from.
  addTitle: string;
  addTitleReference: string;
  addTitleFile: string | null;
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
    defaultTemplateName: getDockerAlertTemplateById(
      getDockerDefaultAlertTemplateId(),
    )!.name,
    defaultTemplateCall: "getDockerDefaultAlertTemplateId()",
    addTitle: "Add Docker Host",
    addTitleReference: "title: DOCKER_HOST_ONBOARDING.addTitle,",
    addTitleFile: "Components/Docker/DockerHostOnboarding.tsx",
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
    defaultTemplateName: getHostAlertTemplateById(
      getHostDefaultAlertTemplateId(),
    )!.name,
    defaultTemplateCall: "getHostDefaultAlertTemplateId()",
    addTitle: "Add Host",
    addTitleReference: 'title: "Add Host",',
    addTitleFile: null,
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
    defaultTemplateName: getPodmanAlertTemplateById(
      getPodmanDefaultAlertTemplateId(),
    )!.name,
    defaultTemplateCall: "getPodmanDefaultAlertTemplateId()",
    addTitle: "Add Podman Host",
    addTitleReference: "title: PODMAN_HOST_ONBOARDING.addTitle,",
    addTitleFile: "Components/Podman/PodmanHostOnboarding.tsx",
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
    defaultTemplateName: getProxmoxAlertTemplateById(
      getProxmoxDefaultAlertTemplateId(),
    )!.name,
    defaultTemplateCall: "getProxmoxDefaultAlertTemplateId()",
    addTitle: "Add Proxmox Cluster",
    addTitleReference: "title: PROXMOX_CLUSTER_ONBOARDING.addTitle,",
    addTitleFile: "Components/Proxmox/ProxmoxClusterOnboarding.tsx",
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
    defaultTemplateName: getDockerSwarmAlertTemplateById(
      getDockerSwarmDefaultAlertTemplateId(),
    )!.name,
    defaultTemplateCall: "getDockerSwarmDefaultAlertTemplateId()",
    addTitle: "Add Docker Swarm Cluster",
    addTitleReference: "title: DOCKER_SWARM_CLUSTER_ONBOARDING.addTitle,",
    addTitleFile: "Components/DockerSwarm/DockerSwarmClusterOnboarding.tsx",
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
    "$page names the form's configuration card, resource field and metric field, the alert a new monitor starts on, and what More fields holds",
    (facts: CreateFacts) => {
      const form: string = source(`${FORMS}/${facts.form}`);
      const setup: string = source(
        `${FORMS}/InfrastructureMonitorSetup/InfrastructureMonitorSetup.tsx`,
      );
      const page: string = englishPage(facts.page);

      expect(monitorStepForm).toContain(`title="${facts.configurationTitle}"`);
      expect(page).toContain(`Under **${facts.configurationTitle}**, pick the`);
      expect(form).toContain(`title="${facts.resourceField}"`);
      expect(page).toContain(`from **${facts.resourceField}**.`);
      expect(form).toContain(`title="${facts.metricField}"`);
      expect(page).toContain(`| **${facts.metricField}** | Custom Metric |`);

      // The resource field: whether data is arriving, and its Add button.
      expect(form).toContain("<InfrastructureResourceField");
      expect(page).toContain(
        "Once picked, a line under the field says whether data is arriving.",
      );
      expect(form).toContain(facts.addTitleReference);
      if (facts.addTitleFile) {
        expect(source(`${DASHBOARD_SRC}/${facts.addTitleFile}`)).toContain(
          `addTitle: translationKey("${facts.addTitle}"),`,
        );
      }
      expect(page).toContain(
        `**${facts.addTitle}** opens setup steps with your keys filled in, which wait for the first data.`,
      );

      // A new monitor starts on the type's default alert; Change picks another.
      expect(form).toContain(facts.defaultTemplateCall);
      expect(page).toContain(
        `A new monitor starts on **${facts.defaultTemplateName}**, under **${INFRASTRUCTURE_ALERT_SECTION_TITLE}**. To watch something else:`,
      );
      expect(page).toContain(
        `- **${ALERT_TEMPLATE_CHANGE}** — pick another [template](#pre-built-alert-templates).`,
      );

      // Templates first; a metric of your own and the query builder under More fields.
      expect(form).toContain("<InfrastructureMonitorSetup");
      for (const slot of [
        "alertTemplates={",
        "customMetric={",
        "queryBuilder={",
      ]) {
        expect(form).toContain(slot);
      }
      expect(setup).toContain("title={MORE_FIELDS_SECTION_TITLE}");
      expect(page).toContain(
        `- **${INFRASTRUCTURE_CUSTOM_METRIC_TAB}** (under **${MORE_FIELDS_SECTION_TITLE}**) — pick one metric from **${facts.metricField}**`,
      );
      expect(page).toContain(
        `- **${INFRASTRUCTURE_QUERY_BUILDER_TAB}** (under **${MORE_FIELDS_SECTION_TITLE}**) — build queries and formulas yourself`,
      );
      expect(page).not.toContain("Quick Setup");
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
    /*
     * Once a template is picked, the list folds into it, and its Time Range
     * (the step form hands it to the picker) stays editable under it.
     */
    const configuration: string = source(
      `${FORMS}/AlertTemplatePicker/AlertTemplateConfiguration.tsx`,
    );

    expect(ALERT_TEMPLATE_TIME_RANGE).toBe("Time Range");
    expect(configuration).toContain("title={ALERT_TEMPLATE_TIME_RANGE}");
    expect(configuration).toContain("<RollingTimePicker");

    for (const facts of CREATE_FACTS) {
      const form: string = source(`${FORMS}/${facts.form}`);

      expect(form).toContain("<AlertTemplateConfiguration");
      expect(form).toContain("onRollingTimeChange={");
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
        FilterType.IsEmpty,
        FilterType.IsNotEmpty,
      ].sort(),
    );

    const written: string =
      "**Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** or **Equal To** — or an anomaly condition: **Anomalously High**, **Anomalously Low** or **Anomalous**. **Has No Data** matches when the query sent nothing in the window, **Has Data** when it sent anything.";

    for (const page of [DOCKER, HOST, PODMAN, PROXMOX, SWARM]) {
      expect(englishPage(page)).toContain(written);
    }

    expect(englishPage(KUBERNETES)).toContain(
      "**Greater Than**, **Less Than**, **Greater Than Or Equal To**, **Less Than Or Equal To** and **Equal To**. **Has No Data** matches when the query sent nothing in the window, **Has Data** when it sent anything.",
    );

    // The words the Condition dropdown draws for the two data conditions.
    const labels: Array<string> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(CheckOn.MetricValue).map(
        (option: DropdownOption): string => {
          return option.label;
        },
      );
    expect(labels).toContain("Has No Data");
    expect(labels).toContain("Has Data");
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

    /*
     * All Values over the whole window: its data must cover the window, not
     * just match where there is some (#4793) - what MetricMonitorCriteria
     * holds it to, for every one of these monitor types.
     */
    for (const page of [
      DOCKER,
      HOST,
      PODMAN,
      PROXMOX,
      SWARM,
      CEPH,
      STORAGE_ARRAY,
      IOT_DEVICE,
      VMWARE,
    ]) {
      expect(englishPage(page)).toContain(
        "**Average**, **Sum**, **Maximum Value**, **Minimum Value**, **All Values** (every value must match, over the whole window) or **Any Value** (one is enough).",
      );
    }

    expect(
      source(
        "packages/Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts",
      ),
    ).toContain("MetricWindowCoverage.judge(");

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

      /*
       * Has No Data / Has Data: whether the agent sends anything, never
       * "0 is offline" - a metric that is healthy at zero used to open
       * "is offline" on a healthy resource.
       */
      expect(offline.data!.name).toBe("Check if Acme is offline");
      expect(primary(offline).filterType).toBe(FilterType.IsEmpty);
      expect(primary(offline).value).toBeUndefined();
      expect(windowAggregationOf(primary(offline))).toBe(
        EvaluateOverTimeType.AnyValue,
      );
      expect(offline.data!.monitorStatusId).toEqual(IDS.offlineMonitorStatusId);
      expect(offline.data!.createIncidents).toBe(true);
      expect(offline.data!.incidents[0]!.title).toBe("Acme is offline");
      expect(offline.data!.incidents[0]!.autoResolveIncident).toBe(true);

      expect(online.data!.name).toBe("Check if Acme is online");
      expect(primary(online).filterType).toBe(FilterType.IsNotEmpty);
      expect(primary(online).value).toBeUndefined();
      expect(online.data!.monitorStatusId).toEqual(IDS.onlineMonitorStatusId);
      expect(online.data!.createIncidents).toBe(false);

      expect(rows).toEqual([
        [
          "1",
          "Check if _monitor name_ is offline",
          "The first query has no data for the whole window",
          'Marks the monitor **Offline** and declares the incident "_monitor name_ is offline", which resolves itself when the monitor recovers.',
        ],
        [
          "2",
          "Check if _monitor name_ is online",
          "The first query has data",
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
    "%s sends every metric the picker offers: no optional metric the agent leaves off",
    (
      configPath: string,
      page: string,
      catalog: () => Array<DockerMetricDefinition | PodmanMetricDefinition>,
    ) => {
      const config: string = source(configPath);
      /*
       * Optional docker_stats metrics the shipped agent leaves off. The
       * picker used to offer them (and a `.read` / `.write` block I/O pair
       * the receiver never emits), so a monitor built on one never fired.
       */
      const offInTheAgent: Array<string> = [
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

      for (const metric of offInTheAgent) {
        expect(listed).not.toContain(metric);
        expect(config).not.toContain(`${metric}:\n        enabled: true`);
        expect(englishPage(page)).not.toContain(`\`${metric}\``);
      }

      // Block I/O is one metric, split by an `operation` attribute.
      expect(listed).toContain("container.blockio.io_service_bytes_recursive");
      expect(englishPage(page)).not.toContain(
        "container.blockio.io_service_bytes_recursive.read",
      );

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
        "`container.cpu.throttling_data.throttled_periods` is not in the **",
      );
      expect(englishPage(page)).toContain(
        " Metric** list; query it from **Advanced**.",
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
  });

  /*
   * The ingest answers 200 before the job that checks the secret key runs,
   * so the agent's "pushed" line says only that OneUptime received the
   * report. The page used to say it meant reports were getting through.
   */
  it("says the agent's pushed line means received, not accepted: ingest answers before it checks the key", () => {
    const ingest: string = source(
      "packages/App/FeatureSet/Telemetry/API/ServerMonitorIngest/ServerMonitor.ts",
    );
    const route: string = ingest.substring(
      ingest.indexOf('"/server-monitor/response/ingest/:secretkey"'),
    );

    expect(
      route.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    ).toBeGreaterThan(-1);
    expect(
      route.indexOf("Response.sendEmptySuccessResponse(req, res);"),
    ).toBeLessThan(
      route.indexOf("TelemetryQueueService.addServerMonitorIngestJob("),
    );
    expect(page).toContain(
      "A line `Metrics successfully pushed to OneUptime server` means OneUptime received a report, not that it accepted it: OneUptime answers before it checks the secret key.",
    );
    expect(page).not.toContain("means reports are getting through");
  });

  it("asks again about a key it could not verify, as often as the page says, and logs what it quotes", () => {
    expect(agent).toContain("keyVerificationFirstRetry   = 5 * time.Second");
    expect(agent).toContain("keyVerificationLongestRetry = 5 * time.Minute");
    expect(agent).toContain(
      'slog.Warn("The secret key could not be verified with OneUptime yet; asking again in "',
    );
    expect(page).toContain(
      "While it cannot reach OneUptime, it keeps trying: again after 5 seconds, then twice as long each time, up to every 5 minutes.",
    );
    expect(page).toContain(
      "the agent logs `The secret key could not be verified with OneUptime yet` and tries again.",
    );
  });

  it("starts a failed service again, two minutes later on Windows as on Linux", () => {
    expect(agentMain).toContain('const serviceRestartDelay = "2m"');
    expect(agentMain).toContain('"OnFailure":              "restart",');
    expect(agentMain).toContain(
      '"OnFailureDelayDuration": serviceRestartDelay,',
    );
    expect(page).toContain(
      "If the service stops on a failure, the service manager starts it again, after two minutes on Linux and Windows. A Windows service set up by an older agent's `configure` restarts only once you run `uninstall` and `configure` again.",
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
    // The commands' log lines reach the terminal: they went only to the log file.
    expect(agentMain).toContain("utils.EchoToTerminal(os.Stdout, os.Stderr)");
    expect(agentMain).toContain('return args[1] != "run" || interactive');
    expect(logger).toContain(
      "func EchoToTerminal(stdout io.Writer, stderr io.Writer) {",
    );
    expect(agentMain).toContain('logFlags.Int("n", 100, ');
    expect(agentMain).toContain('logFlags.Bool("f", false, ');
    expect(page).toContain("it prints `Service is running`");
    expect(page).toContain(
      "Each command prints what it did, or why it failed, and writes the same to the agent's log.",
    );
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

  /*
   * Under sudo the script used to install into $HOME/bin, /root/bin, which is
   * not on sudo's path, so the next step was not found.
   * InfrastructureAgentInstallScript runs the script.
   */
  it("installs into /usr/local/bin as root and $HOME/bin otherwise, prints where, and takes -b", () => {
    const script: string = source(
      "packages/App/FeatureSet/Docs/Static/scripts/infrastructure-agent/install.sh",
    );

    expect(script).toContain(
      'if [ "$(id -u)" = "0" ]; then\n  BINDIR=/usr/local/bin',
    );
    expect(script).toContain("BINDIR=$HOME/bin");
    expect(script).toContain('echo "Installing to ${BINDIR}"');
    expect(script).toContain('while getopts "b:d" opt; do');
    expect(script).toContain("if command -v curl > /dev/null 2>&1; then");
    expect(script).not.toContain("apt-get");
    expect(page).toContain(
      "Run with `sudo`, the install script puts the `oneuptime-infrastructure-agent` binary in `/usr/local/bin` (in `$HOME/bin` without `sudo`), and it downloads with `curl` or `wget`.",
    );
    expect(page).toContain(
      "there, the script prints the commands with the agent's full path, `sudo /usr/local/bin/oneuptime-infrastructure-agent configure ...`",
    );
    expect(page).toContain("| sudo bash -s -- -b /usr/bin");
  });

  it("reports the disks that can fill up as df counts them, the CPU's time since the previous report, and the processes it cannot fully read", () => {
    const disk: string = source("agents/InfrastructureAgent/utils/disk.go");
    const cpu: string = source("agents/InfrastructureAgent/utils/cpu.go");
    const procs: string = source("agents/InfrastructureAgent/utils/procs.go");

    for (const fstype of ["squashfs", "iso9660", "devfs", "autofs"]) {
      expect(disk).toContain(`"${fstype}":`);
    }
    expect(disk).toContain(
      "percentUsed = float64(usageStat.Used) / float64(usable) * 100",
    );
    expect(cpu).toContain("return cpuTimeSharesBetween(*previous, *current)");
    expect(procs).toContain('cmdline = ""');
    expect(page).toContain(
      "| Disks | For each mounted disk, except read-only images (snaps, ISOs) and `/dev`: mount path, device, file system, total, used and free space, usage % as `df` counts it,",
    );
    expect(page).toContain("IRQ and soft IRQ since the previous report |");
    expect(page).toContain(
      "a process whose command line cannot be read, such as a protected Windows process, without its command |",
    );
  });

  it("matches nothing on a value, disk or process list the report does not have", () => {
    const criteria: string = source(
      "packages/Common/Server/Utils/Monitor/Criteria/ServerMonitorCriteria.ts",
    );

    expect(criteria).toContain(
      "reading: ServerMonitorCriteria.reportedNumber(cpuMetrics?.percentUsed),",
    );
    expect(criteria).toContain(
      "ServerMonitorCriteria.reportedProcesses(serverResponse);",
    );
    expect(page).toContain(
      "a criteria on a value the report does not have is not met: a missing value is not 0.",
    );
    expect(page).toContain(
      "When the agent cannot read the server's processes, its report has no process list, and no process filter matches, whether it checks that a process is executing or that it is not.",
    );
  });

  /*
   * Each release publishes the agent to apt and yum (packages.oneuptime.com),
   * Homebrew and winget (Scripts/PackageManagers, release.yml's
   * publish-infrastructure-agent-* jobs). The page installs from where they
   * publish, under the names they publish. Tests/Ops/package-repository-e2e.sh
   * runs the apt and dnf commands against a repository they built.
   */
  it("installs from the package managers each release publishes to, by the names they publish under", () => {
    const release: string = source(
      "agents/InfrastructureAgent/.goreleaser.yaml",
    );
    const build: string = source(
      "Scripts/PackageManagers/BuildPackageRepository.sh",
    );
    const publish: string = source(
      "Scripts/PackageManagers/PublishPackageRepository.sh",
    );

    // apt: the suite and component the repository is built with, at the site it is pushed to.
    expect(publish).toContain(
      'URL="${PACKAGE_REPOSITORY_URL:-https://packages.oneuptime.com}"',
    );
    expect(build).toContain('readonly SUITE="stable"');
    expect(build).toContain('readonly COMPONENT="main"');
    expect(build).toContain(
      'gpg --batch --armor --export "$SIGNING_KEY" >"$REPOSITORY/gpg.key"',
    );
    expect(page).toContain(
      "sudo curl -fsSL https://packages.oneuptime.com/gpg.key -o /etc/apt/keyrings/oneuptime.asc",
    );
    expect(page).toContain(
      'echo "deb [signed-by=/etc/apt/keyrings/oneuptime.asc] https://packages.oneuptime.com/deb stable main" | sudo tee /etc/apt/sources.list.d/oneuptime.list',
    );

    // yum and dnf: the .repo file the build writes.
    expect(build).toContain('cat >"$RPM/oneuptime.repo" <<EOF');
    expect(page).toContain(
      "sudo curl -fsSL https://packages.oneuptime.com/rpm/oneuptime.repo -o /etc/yum.repos.d/oneuptime.repo",
    );

    // The packages are nfpm's, with its default bindir.
    expect(release).toContain("package_name: oneuptime-infrastructure-agent");
    expect(release).not.toContain("bindir:");
    expect(page).toContain("the packages put the binary in `/usr/bin`");

    // Homebrew: GoReleaser's cask, in OneUptime/homebrew-tap, which brew calls oneuptime/tap.
    expect(release).toContain(
      "homebrew_casks:\n  - name: oneuptime-infrastructure-agent",
    );
    expect(release).toContain(
      "    repository:\n      owner: OneUptime\n      name: homebrew-tap",
    );
    expect(page).toContain(
      "brew install oneuptime/tap/oneuptime-infrastructure-agent",
    );

    // winget: the identifier GoReleaser writes the manifests under.
    expect(release).toContain(
      "package_identifier: OneUptime.InfrastructureAgent",
    );
    expect(page).toContain(
      "winget install --id OneUptime.InfrastructureAgent --exact --scope machine",
    );
  });

  it("names the release's MSIs, where they install the agent, and that a newer one upgrades and restarts it", () => {
    const build: string = source("agents/InfrastructureAgent/build-msi.sh");
    const installer: string = source(
      "agents/InfrastructureAgent/windows/oneuptime-infrastructure-agent.wxs",
    );

    expect(build).toContain('ARCHES=("amd64" "arm64")');
    expect(build).toContain('MSI_FILE="$OUTPUT_DIR/$APP_NAME-$ARCH.msi"');
    expect(installer).toContain(
      "<Directory Id='ProgramFiles64Folder' Name='PFiles'>",
    );
    expect(installer).toContain(
      "<Directory Id='OneUptimeInfrastructureAgent' Name='OneUptimeInfrastructureAgent'>",
    );
    expect(installer).toContain("<MajorUpgrade");
    expect(installer).toContain(
      "ExeCommand='start oneuptime-infrastructure-agent'",
    );
    expect(page).toContain(
      "`oneuptime-infrastructure-agent-amd64.msi` (or `oneuptime-infrastructure-agent-arm64.msi`)",
    );
    expect(page).toContain(
      "It installs the agent in `C:\\Program Files\\OneUptimeInfrastructureAgent`, and a newer MSI upgrades it in place and starts it again.",
    );
    expect(page).toContain("| MSI | Install the newer MSI. |");
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

    // The card installs the way the page does, and sends people here for the other ways.
    expect(documentation).toContain(
      '"winget install --id OneUptime.InfrastructureAgent --exact --scope machine"',
    );
    expect(page).toContain(
      "winget install --id OneUptime.InfrastructureAgent --exact --scope machine",
    );
    expect(documentation).toContain(
      "/docs/static/scripts/infrastructure-agent/install.sh | sudo bash`",
    );
    expect(page).toContain(
      "/docs/static/scripts/infrastructure-agent/install.sh | sudo bash\n",
    );
    expect(documentation).toContain("/docs/monitor/server-monitor`");
    expect(documentation).not.toContain("uninstall");
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
    // A device names the disk on it, and the window is read for that disk's own path.
    expect(criteria).toContain(
      "ServerMonitorCriteria.normalizeDiskPath(disk.device) === wanted",
    );
    expect(criteria).toContain("miscData: { diskPath: input.agentDiskPath },");
    expect(page).toContain(
      "**Disk Path** takes a mount point or device, such as `/`, `/mnt/data`, `C:\\` or `/dev/sda1`; it is `/` when left empty. Enter `*` to check every disk the agent reports",
    );
    expect(page).toContain(
      "Case and a trailing `/` or `\\` do not matter, and a device stands for the disk mounted from it. A path that names no disk the agent reports does not match.",
    );
  });

  it("evaluates over time with the aggregates and no-data choices the page lists", () => {
    const form: string = source(`${FORMS}/CriteriaFilter.tsx`);

    expect(form).toContain(
      'title={"Evaluate this criteria over a period of time"}',
    );
    // The window's two labels, each drawn with a description under it.
    expect(form).toMatch(
      new RegExp('<FieldLabelElement\\s+title="Evaluate"\\s+description='),
    );
    expect(form).toMatch(
      new RegExp(
        '<FieldLabelElement\\s+title="For the last \\(in minutes\\)"\\s+description=',
      ),
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
