import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepOpenStackMonitor, {
  OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
  OPENSTACK_REGION_ATTRIBUTE,
} from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OPENSTACK_API_UP_METRIC_BY_SERVICE,
  OPENSTACK_WINDOW_BY_SERVICE,
  OpenStackAlertTemplate,
  OpenStackAlertTemplateArgs,
  OpenStackAlertTemplateCategory,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplateById,
  getOpenStackAlertTemplatesByCategory,
  getOpenStackDefaultAlertTemplateId,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import { getOpenStackMetricByMetricName } from "../../../Types/Monitor/OpenStackMetricCatalog";
import { STOPPED_REPORTING_METRIC_ALIAS } from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import {
  OPENSTACK_EXPORTER_INSTANCE_STATUS_CODES,
  OPENSTACK_EXPORTER_SERIES,
  OPENSTACK_EXPORTER_VOLUME_STATUSES,
  OPENSTACK_RECEIVER_SERIES,
} from "./Utils/OpenStackExporterSeries";
import {
  SamplesByAlias,
  WINDOW_END_MS,
  evaluateTemplateCriteria,
  isCriteriaInstanceMet,
} from "./Utils/TemplateCriteriaEvaluation";

/*
 * THE RULES EVERY OPENSTACK ALERT TEMPLATE PASSES, RUN OVER EVERY TEMPLATE.
 *
 * Issue #5433 found templates that never recovered, watched the wrong state, read
 * too short a window and added up scrapes. Each of those is a rule here, run over
 * getAllOpenStackAlertTemplates(), so a new template cannot skip them: it fails until
 * it has passed each one, and until it has said what it fires on below.
 *
 * Fires and recovers through the real evaluator (MetricMonitorCriteria), at the
 * cadence each service's job really collects at. The path a grouped monitor takes
 * through MonitorCriteriaEvaluator, when every series of a query has gone, is in
 * OpenStackAlertRecovery.test.ts.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const COLLECTOR_CONFIG: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "agents",
    "OpenStackAgent",
    "otel-collector-config.yaml",
  ),
  "utf8",
);

const COMPOSE: string = fs.readFileSync(
  path.join(REPO_ROOT, "agents", "OpenStackAgent", "docker-compose.yml"),
  "utf8",
);

const DOCS: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "Docs",
    "Content",
    "en",
    "monitor",
    "openstack-monitor.md",
  ),
  "utf8",
);

// What a card's one line holds (InfrastructureAlertTemplateSummaries.test.ts).
const MAX_SUMMARY_LENGTH: number = 80;

const ARGS: OpenStackAlertTemplateArgs = {
  cloudIdentifier: "production",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Test Cloud",
};

const TEMPLATES: Array<OpenStackAlertTemplate> =
  getAllOpenStackAlertTemplates();

type TemplateCase = [string, OpenStackAlertTemplate];

const TEMPLATE_CASES: Array<TemplateCase> = TEMPLATES.map(
  (template: OpenStackAlertTemplate): TemplateCase => {
    return [template.id, template];
  },
);

const CLOUD_STOPPED_REPORTING: string = "openstack-cloud-stopped-reporting";

// The one template with no series to go away: silence is what it fires on.
const CASES_WITH_SERIES: Array<TemplateCase> = TEMPLATE_CASES.filter(
  (templateCase: TemplateCase): boolean => {
    return templateCase[0] !== CLOUD_STOPPED_REPORTING;
  },
);

function stepOf(template: OpenStackAlertTemplate): MonitorStep {
  return template.getMonitorStep(ARGS);
}

function monitorOf(step: MonitorStep): MonitorStepOpenStackMonitor {
  return step.data!.openstackMonitor!;
}

function queriesOf(step: MonitorStep): Array<MetricQueryConfigData> {
  return monitorOf(step).metricViewConfig.queryConfigs;
}

function formulasOf(step: MonitorStep): Array<MetricFormulaConfigData> {
  return monitorOf(step).metricViewConfig.formulaConfigs || [];
}

function firingOf(step: MonitorStep): MonitorCriteriaInstance {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
}

function recoveryOf(step: MonitorStep): MonitorCriteriaInstance {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!;
}

function aliasOf(query: MetricQueryConfigData): string {
  return query.metricAliasData?.metricVariable || "";
}

function metricNameOf(query: MetricQueryConfigData): string {
  return (query.metricQueryData.filterData.metricName as string) || "";
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

function comparedAliases(instance: MonitorCriteriaInstance): Array<string> {
  return (instance.data?.filters || []).map(
    (filter: CriteriaFilter): string => {
      return filter.metricMonitorOptions?.metricAlias || "";
    },
  );
}

function windowMinutesOf(step: MonitorStep): number {
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    monitorOf(step).rollingTime,
    new Date(WINDOW_END_MS),
  );

  return (
    ((window.endValue as Date).getTime() -
      (window.startValue as Date).getTime()) /
    60000
  );
}

/*
 * How often each job collects, from the agent's own config: slow one down there
 * and every template reading it has to hold three of the longer collection.
 */
function scrapeIntervalsInSeconds(): Record<string, number> {
  const intervals: Record<string, number> = {};
  const jobs: RegExp =
    /job_name:\s*oneuptime-openstack-(\w+)[\s\S]*?scrape_interval:\s*(\d+)s/g;

  for (const match of COLLECTOR_CONFIG.matchAll(jobs)) {
    intervals[match[1]!] = Number(match[2]);
  }

  return intervals;
}

const INTERVALS: Record<string, number> = scrapeIntervalsInSeconds();

// Which job's collections a query reads.
function serviceOf(query: MetricQueryConfigData): OpenStackServiceType {
  const job: string | undefined = attributesOf(query)["openstack_service"];

  if (job) {
    return job as OpenStackServiceType;
  }

  return OPENSTACK_EXPORTER_SERIES[metricNameOf(query)]!.service;
}

const AGGREGATION_EXCEPTIONS: Readonly<Record<string, string>> = {
  /*
   * Count is the heartbeat, and only ever asks whether a row arrived.
   */
  [`${CLOUD_STOPPED_REPORTING}|${STOPPED_REPORTING_METRIC_ALIAS}`]: "Count",
  /*
   * The value is a code, so the rows are the number. One row per instance or agent
   * per collection, and these jobs collect no more than once a minute.
   */
  "openstack-instances-in-error|instances_in_error": "Count",
  "openstack-router-with-two-active-agents|active_agents": "Count",
  /*
   * The network's value is a code, 0 for ACTIVE: a Count says the row is there.
   */
  "openstack-external-ip-pool-nearly-full|is_external_network": "Count",
  "openstack-network-out-of-ips|is_external_network": "Count",
  /*
   * A network's total across its subnets, without a Sum: the Avgs of its subnets
   * divide to the same share as their totals, whatever a bucket holds.
   */
  "openstack-external-ip-pool-nearly-full|addresses_used": "Avg",
  "openstack-external-ip-pool-nearly-full|addresses_total": "Avg",
  "openstack-network-out-of-ips|addresses_used": "Avg",
  "openstack-network-out-of-ips|addresses_total": "Avg",
  /*
   * Every worker of a kind: the Max across hosts is 1 while any one is alive.
   */
  "openstack-every-scheduler-or-conductor-down|any_scheduler_up": "Max",
  "openstack-every-scheduler-or-conductor-down|any_conductor_up": "Max",
};

// The line each template draws, which has to be the health rules' line.
const THRESHOLDS: Readonly<
  Record<string, { filterType: FilterType; value: number }>
> = {
  "openstack-identity-api-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-compute-api-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-network-api-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-block-storage-api-down": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-image-api-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-placement-api-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-compute-service-down": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-scheduler-or-conductor-down": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-every-scheduler-or-conductor-down": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-network-agent-down": { filterType: FilterType.LessThan, value: 1 },
  "openstack-block-storage-service-down": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-vcpu-allocation-high": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_ALLOCATION_WARNING_PERCENT,
  },
  "openstack-memory-allocation-high": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_ALLOCATION_WARNING_PERCENT,
  },
  "openstack-local-disk-allocation-high": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_ALLOCATION_WARNING_PERCENT,
  },
  "openstack-instances-in-error": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-instance-stuck-building": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-instance-stuck-transitioning": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-instance-stuck-in-verify-resize": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-router-not-active": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-floating-ip-not-active": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-external-ip-pool-nearly-full": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_IP_POOL_WARNING_PERCENT,
  },
  "openstack-network-out-of-ips": {
    filterType: FilterType.GreaterThanOrEqualTo,
    value: OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  },
  "openstack-router-without-active-agent": {
    filterType: FilterType.LessThan,
    value: 1,
  },
  "openstack-router-with-two-active-agents": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
  },
  "openstack-storage-pool-warning": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  },
  "openstack-storage-pool-critical": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  },
  "openstack-volumes-in-error": {
    filterType: FilterType.GreaterThan,
    value: 0,
  },
  "openstack-volume-stuck": { filterType: FilterType.GreaterThan, value: 0 },
  "openstack-project-quota-nearly-reached": {
    filterType: FilterType.GreaterThan,
    value: OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  },
};

/*
 * One value per alias for each state a series can be in, as the exporter says it
 * for that part. Every template has to say what it fires on here, so a new one is
 * shown firing and recovering through the evaluator before it ships. The queries
 * a template names are read as they are; an anchor, when a step has one, is 1.
 */
interface Scene {
  breached: Record<string, number>;
  healthy: Record<string, number>;
}

function allocationScene(): Scene {
  return {
    // 92 of (100 - 0) x 1.
    breached: {
      allocated: 92,
      capacity: 100,
      reserved: 0,
      allocation_ratio: 1,
    },
    // 92 of (100 - 0) x 4: what a ratio is for.
    healthy: { allocated: 92, capacity: 100, reserved: 0, allocation_ratio: 4 },
  };
}

function statusScene(statuses: Array<string>): Scene {
  const breached: Record<string, number> = {};
  const healthy: Record<string, number> = {};

  statuses.forEach((status: string, index: number) => {
    const alias: string = `in_${status
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+$/g, "")}`;

    if (index === 0) {
      breached[alias] = 1;
    }

    healthy[alias] = 0;
  });

  return { breached, healthy };
}

function poolScene(usedPercent: number): Scene {
  return {
    breached: { pool_total: 100, pool_free: 100 - usedPercent },
    healthy: { pool_total: 100, pool_free: 50 },
  };
}

const SCENES: Readonly<Record<string, Scene>> = {
  "openstack-identity-api-down": {
    breached: { api_up: 0, series_in_collection: 1 },
    healthy: { api_up: 1, series_in_collection: 8 },
  },
  "openstack-compute-api-down": {
    breached: { api_up: 0, series_in_collection: 1 },
    healthy: { api_up: 1, series_in_collection: 40 },
  },
  "openstack-network-api-down": {
    breached: { api_up: 0, collection_answered: 1 },
    healthy: { api_up: 1, collection_answered: 1 },
  },
  "openstack-block-storage-api-down": {
    breached: { api_up: 0, collection_answered: 1 },
    healthy: { api_up: 1, collection_answered: 1 },
  },
  "openstack-image-api-down": {
    breached: { api_up: 0, collection_answered: 1 },
    healthy: { api_up: 1, collection_answered: 1 },
  },
  "openstack-placement-api-down": {
    breached: { api_up: 0, collection_answered: 1 },
    healthy: { api_up: 1, collection_answered: 1 },
  },
  "openstack-compute-service-down": {
    breached: { compute_service_up: 0 },
    healthy: { compute_service_up: 1 },
  },
  "openstack-scheduler-or-conductor-down": {
    breached: { scheduler_up: 0 },
    healthy: { scheduler_up: 1 },
  },
  "openstack-every-scheduler-or-conductor-down": {
    breached: { any_conductor_up: 0 },
    healthy: { any_conductor_up: 1 },
  },
  "openstack-network-agent-down": {
    breached: { network_agent_alive: 0 },
    healthy: { network_agent_alive: 1 },
  },
  "openstack-block-storage-service-down": {
    breached: { block_storage_service_up: 0 },
    healthy: { block_storage_service_up: 1 },
  },
  "openstack-vcpu-allocation-high": allocationScene(),
  "openstack-memory-allocation-high": allocationScene(),
  "openstack-local-disk-allocation-high": allocationScene(),
  "openstack-instances-in-error": {
    breached: { instances_in_error: 3 },
    healthy: { instances_in_error: 0 },
  },
  "openstack-instance-stuck-building": statusScene([
    "BUILD",
    "BUILD(spawning)",
  ]),
  "openstack-instance-stuck-transitioning": statusScene([
    "MIGRATING",
    "RESIZE",
  ]),
  "openstack-instance-stuck-in-verify-resize": statusScene(["VERIFY_RESIZE"]),
  "openstack-router-not-active": {
    breached: { routers_not_active: 1 },
    healthy: { routers_not_active: 0 },
  },
  "openstack-floating-ip-not-active": {
    breached: { floating_ips_not_active: 2 },
    healthy: { floating_ips_not_active: 0 },
  },
  "openstack-external-ip-pool-nearly-full": {
    breached: {
      addresses_used: 95,
      addresses_total: 100,
      is_external_network: 1,
    },
    healthy: {
      addresses_used: 10,
      addresses_total: 100,
      is_external_network: 1,
    },
  },
  "openstack-network-out-of-ips": {
    breached: {
      addresses_used: 100,
      addresses_total: 100,
      is_external_network: 1,
    },
    healthy: {
      addresses_used: 10,
      addresses_total: 100,
      is_external_network: 1,
    },
  },
  "openstack-router-without-active-agent": {
    breached: { agent_alive: 0 },
    healthy: { agent_alive: 1 },
  },
  "openstack-router-with-two-active-agents": {
    breached: { active_agents: 2 },
    healthy: { active_agents: 1 },
  },
  "openstack-storage-pool-warning": poolScene(90),
  "openstack-storage-pool-critical": poolScene(98),
  "openstack-volumes-in-error": {
    breached: { in_error: 1 },
    healthy: { in_error: 0 },
  },
  "openstack-volume-stuck": {
    breached: { in_creating: 10 },
    healthy: { in_creating: 0 },
  },
  "openstack-project-quota-nearly-reached": {
    breached: { vcpus_used: 95, vcpus_limit: 100 },
    healthy: { vcpus_used: 10, vcpus_limit: 100 },
  },
};

// The scene's values for every minute of the window, and the anchor's.
function everyMinute(
  step: MonitorStep,
  values: Record<string, number>,
): SamplesByAlias {
  const minutes: number = windowMinutesOf(step);
  const samples: SamplesByAlias = {};

  for (const alias of Object.keys(values)) {
    samples[alias] = new Array<number>(minutes).fill(values[alias]!);
  }

  return samples;
}

/*
 * A response the way the worker reads it at the cadence the agent collects at:
 * a data point in the minute of each collection and none between them, with every
 * formula worked out over them.
 */
function responseAtCadence(data: {
  step: MonitorStep;
  values: Record<string, number>;
  cadenceMinutes: number;
  // How long before the end of the window the newest collection was.
  ageOfNewestMinutes: number;
}): MetricMonitorResponse {
  const windowMinutes: number = windowMinutesOf(data.step);
  const queries: Array<MetricQueryConfigData> = queriesOf(data.step);
  const formulas: Array<MetricFormulaConfigData> = formulasOf(data.step);

  const results: Array<AggregatedResult> = queries.map(
    (query: MetricQueryConfigData): AggregatedResult => {
      const value: number | undefined = data.values[aliasOf(query)];

      if (value === undefined) {
        return { data: [] };
      }

      const rows: Array<AggregateModel> = [];

      for (
        let minutesAgo: number = data.ageOfNewestMinutes + 1;
        minutesAgo <= windowMinutes;
        minutesAgo += data.cadenceMinutes
      ) {
        rows.unshift({
          timestamp: new Date(WINDOW_END_MS - minutesAgo * 60000),
          value: value,
        } as AggregateModel);
      }

      return { data: rows };
    },
  );

  formulas.forEach((formula: MetricFormulaConfigData, index: number) => {
    results.push(
      MetricFormulaEvaluator.evaluateFormula({
        formula: formula.metricFormulaData.metricFormula,
        queryConfigs: queries,
        formulaConfigs: formulas.slice(0, index),
        results: results,
      }),
    );
  });

  return {
    projectId: ObjectID.generate(),
    metricViewConfig: monitorOf(data.step).metricViewConfig,
    monitorId: ObjectID.generate(),
    startAndEndDate: {
      startValue: new Date(WINDOW_END_MS - windowMinutes * 60000),
      endValue: new Date(WINDOW_END_MS),
    } as NonNullable<MetricMonitorResponse["startAndEndDate"]>,
    metricResult: results,
  };
}

// The status words a template reads, one query each.
function statusesOf(id: string): Array<string> {
  return queriesOf(stepOf(getOpenStackAlertTemplateById(id)!))
    .filter((query: MetricQueryConfigData): boolean => {
      return aliasOf(query) !== OPENSTACK_ANCHOR_METRIC_ALIAS;
    })
    .map((query: MetricQueryConfigData): string => {
      return attributesOf(query)["status"]!;
    });
}

function longestIntervalMinutesOf(step: MonitorStep): number {
  return Math.max(
    ...queriesOf(step).map((query: MetricQueryConfigData): number => {
      return INTERVALS[serviceOf(query)]! / 60;
    }),
  );
}

describe("OpenStack alert templates: the rules every template passes", () => {
  test("every template the issue asks for is here, each with its one id", () => {
    expect(
      TEMPLATES.map((template: OpenStackAlertTemplate): string => {
        return template.name;
      }).sort(),
    ).toEqual(
      [
        "Cloud Stopped Reporting",
        "Identity API Down",
        "Compute API Down",
        "Network API Down",
        "Block Storage API Down",
        "Image API Down",
        "Placement API Down",
        "Compute Service Down",
        "Scheduler or Conductor Down",
        // Beyond the issue's table: the outage the pages call Critical.
        "Every Scheduler or Conductor Down",
        "Network Agent Down",
        "Block Storage Service Down",
        "vCPU Allocation High",
        "Memory Allocation High",
        "Local Disk Allocation High",
        "Instances in Error",
        "Instance Stuck Building",
        "Instance Stuck Transitioning",
        "Instance Stuck in Verify Resize",
        "Router Not Active",
        "Floating IP Not Active",
        "External IP Pool Nearly Full",
        "Network Out of IPs",
        "Router Without Active Agent",
        "Router With Two Active Agents",
        "Storage Pool Warning",
        "Storage Pool Critical",
        "Volumes in Error",
        "Volume Stuck",
        "Project Quota Nearly Reached",
      ].sort(),
    );

    expect(
      new Set(
        TEMPLATES.map((template: OpenStackAlertTemplate): string => {
          return template.id;
        }),
      ).size,
    ).toBe(TEMPLATES.length);

    for (const template of TEMPLATES) {
      expect(getOpenStackAlertTemplateById(template.id)).toBe(template);
    }
  });

  test("the categories are what breaks, and every template is in one", () => {
    const count: number = (
      [
        "Availability",
        "Control Plane",
        "Compute",
        "Network",
        "Storage",
        "Projects",
      ] as const
    ).reduce(
      (total: number, category: OpenStackAlertTemplateCategory): number => {
        const templates: Array<OpenStackAlertTemplate> =
          getOpenStackAlertTemplatesByCategory(category);

        expect(templates.length).toBeGreaterThan(0);

        return total + templates.length;
      },
      0,
    );

    expect(count).toBe(TEMPLATES.length);
  });

  test("a new monitor starts on the cloud going quiet", () => {
    expect(getOpenStackDefaultAlertTemplateId()).toBe(CLOUD_STOPPED_REPORTING);
    expect(TEMPLATES[0]!.id).toBe(CLOUD_STOPPED_REPORTING);
    expect(TEMPLATES[0]!.severity).toBe("Critical");
  });

  describe("builds a monitor for the cloud it was given", () => {
    test.each(TEMPLATE_CASES)(
      "%s reads only that cloud, fires then recovers, and resolves on its own",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);

        expect(monitorOf(step).cloudIdentifier).toBe("production");
        expect(monitorOf(step).resourceFilters).toEqual({});
        expect(JSON.stringify(monitorOf(step))).not.toContain(
          OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
        );

        expect(
          step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray,
        ).toHaveLength(2);

        const firing: MonitorCriteriaInstance = firingOf(step);
        const recovery: MonitorCriteriaInstance = recoveryOf(step);

        expect(firing.data!.createIncidents).toBe(true);
        expect(firing.data!.createAlerts).toBe(true);
        expect(firing.data!.incidents[0]!.autoResolveIncident).toBe(true);
        expect(firing.data!.alerts[0]!.autoResolveAlert).toBe(true);
        expect(firing.data!.monitorStatusId?.toString()).toBe(
          ARGS.offlineMonitorStatusId.toString(),
        );

        expect(recovery.data!.createIncidents).toBe(false);
        expect(recovery.data!.createAlerts).toBe(false);
        expect(recovery.data!.monitorStatusId?.toString()).toBe(
          ARGS.onlineMonitorStatusId.toString(),
        );
      },
    );

    test.each(TEMPLATE_CASES)(
      "%s compares only what it reads, and holds for the whole window",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const aliases: Array<string> = [
          ...queriesOf(step).map(aliasOf),
          ...formulasOf(step).map((formula: MetricFormulaConfigData) => {
            return formula.metricAliasData.metricVariable || "";
          }),
        ];

        for (const instance of [firingOf(step), recoveryOf(step)]) {
          for (const alias of comparedAliases(instance)) {
            expect(aliases).toContain(alias);
          }

          for (const filter of instance.data!.filters) {
            expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
              EvaluateOverTimeType.AllValues,
            );
          }
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s never hands a formula an alias it does not read",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const aliases: Array<string> = queriesOf(step).map(aliasOf);

        for (const formula of formulasOf(step)) {
          const referenced: Array<string> =
            MetricFormulaEvaluator.getReferencedVariables(
              formula.metricFormulaData.metricFormula,
            );

          expect(referenced.length).toBeGreaterThan(0);

          for (const variable of referenced) {
            expect(aliases).toContain(variable);
          }
        }
      },
    );
  });

  describe("never adds up scrapes", () => {
    test.each(TEMPLATE_CASES)(
      "%s uses no Sum, and Min or Max as its series say",
      (id: string, template: OpenStackAlertTemplate) => {
        for (const query of queriesOf(stepOf(template))) {
          const aggregation: MetricsAggregationType = aggregationOf(query);

          expect(aggregation).not.toBe(MetricsAggregationType.Sum);

          const exception: string | undefined =
            AGGREGATION_EXCEPTIONS[`${id}|${aliasOf(query)}`];

          expect({
            query: aliasOf(query),
            aggregation,
          }).toEqual({
            query: aliasOf(query),
            aggregation:
              exception ||
              getOpenStackMetricByMetricName(metricNameOf(query))!
                .defaultAggregation,
          });
        }
      },
    );

    test("each exception above is one a template really takes", () => {
      for (const key of Object.keys(AGGREGATION_EXCEPTIONS)) {
        const [id, alias] = key.split("|");
        const query: MetricQueryConfigData | undefined = queriesOf(
          stepOf(getOpenStackAlertTemplateById(id!)!),
        ).find((candidate: MetricQueryConfigData): boolean => {
          return aliasOf(candidate) === alias;
        });

        expect(query).toBeDefined();
        expect(aggregationOf(query!)).toBe(AGGREGATION_EXCEPTIONS[key]);
      }
    });

    test("a Count holds because no job collects more than once a minute", () => {
      for (const seconds of Object.values(INTERVALS)) {
        expect(seconds).toBeGreaterThanOrEqual(60);
      }
    });
  });

  describe("reads a window of at least three collections of what it reads", () => {
    test("every service's job was read from the agent's config", () => {
      expect(Object.keys(INTERVALS).sort()).toEqual(
        Object.values(OpenStackServiceType).sort(),
      );
    });

    test.each(TEMPLATE_CASES)(
      "%s holds three collections of its slowest series",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);

        for (const query of queriesOf(step)) {
          // The anchor is not compared: only whether it has any data matters.
          if (aliasOf(query) === OPENSTACK_ANCHOR_METRIC_ALIAS) {
            continue;
          }

          expect({
            query: aliasOf(query),
            collections:
              (windowMinutesOf(step) * 60) / INTERVALS[serviceOf(query)]! >= 3,
          }).toEqual({ query: aliasOf(query), collections: true });
        }
      },
    );

    test("the smallest window for each service holds three of its collections", () => {
      for (const service of Object.values(OpenStackServiceType)) {
        const window: InBetween<Date> =
          RollingTimeUtil.convertToStartAndEndDate(
            OPENSTACK_WINDOW_BY_SERVICE[service],
            new Date(WINDOW_END_MS),
          );
        const seconds: number =
          ((window.endValue as Date).getTime() -
            (window.startValue as Date).getTime()) /
          1000;

        expect(seconds / INTERVALS[service]!).toBeGreaterThanOrEqual(3);
      }
    });

    test.each(CASES_WITH_SERIES)(
      "%s fires at the cadence the agent really collects, whenever in the cycle it is checked",
      async (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const cadenceMinutes: number = longestIntervalMinutesOf(step);

        for (
          let ageOfNewestMinutes: number = 0;
          ageOfNewestMinutes < cadenceMinutes;
          ageOfNewestMinutes++
        ) {
          expect({
            ageOfNewestMinutes,
            breached: await isCriteriaInstanceMet(
              step,
              firingOf(step),
              responseAtCadence({
                step,
                values: SCENES[id]!.breached,
                cadenceMinutes,
                ageOfNewestMinutes,
              }),
            ),
          }).toEqual({ ageOfNewestMinutes, breached: true });
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s waits for its window: two collections are not enough",
      async (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const minutes: number = windowMinutesOf(step);

        expect(
          (
            await evaluateTemplateCriteria({
              step,
              viewConfig: monitorOf(step).metricViewConfig,
              samplesByAlias: Object.fromEntries(
                Object.entries(SCENES[id]!.breached).map(
                  ([alias, value]: [string, number]) => {
                    return [alias, [value, value]];
                  },
                ),
              ),
              windowMinutes: minutes,
            })
          ).breached,
        ).toBe(false);
      },
    );
  });

  describe("fires on what breaks, and recovers", () => {
    test("every template with a series says what it fires on", () => {
      expect(Object.keys(SCENES).sort()).toEqual(
        CASES_WITH_SERIES.map((templateCase: TemplateCase): string => {
          return templateCase[0];
        }).sort(),
      );
    });

    test.each(CASES_WITH_SERIES)(
      "%s fires for a whole window of what breaks",
      async (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);

        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, SCENES[id]!.breached),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: true, healthy: false });
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s recovers when it reads fine again",
      async (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);

        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, SCENES[id]!.healthy),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: false, healthy: true });
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s does not fire on one good reading in its window",
      async (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const samples: SamplesByAlias = everyMinute(step, SCENES[id]!.breached);

        for (const alias of Object.keys(samples)) {
          const healthyValue: number | undefined = SCENES[id]!.healthy[alias];

          if (healthyValue !== undefined) {
            samples[alias]![samples[alias]!.length - 1] = healthyValue;
          }
        }

        expect(
          (
            await evaluateTemplateCriteria({
              step,
              viewConfig: monitorOf(step).metricViewConfig,
              samplesByAlias: samples,
              windowMinutes: windowMinutesOf(step),
            })
          ).breached,
        ).toBe(false);
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s counts a series that goes away as recovered",
      async (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);

        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: {},
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: false, healthy: true });
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s has a recovery for everything that fires, and a floor's no-data policy says a gone series is fine",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const recovery: MonitorCriteriaInstance = recoveryOf(step);

        for (const alias of comparedAliases(firingOf(step))) {
          expect(comparedAliases(recovery)).toContain(alias);
        }

        for (const filter of recovery.data!.filters) {
          const policy: NoDataPolicy | undefined =
            filter.metricMonitorOptions?.onNoDataPolicy;

          expect(
            filter.filterType === FilterType.GreaterThanOrEqualTo
              ? policy === NoDataPolicy.Trigger
              : policy === NoDataPolicy.TreatAsZero,
          ).toBe(true);
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s never fires on no data",
      (_id: string, template: OpenStackAlertTemplate) => {
        for (const filter of firingOf(stepOf(template)).data!.filters) {
          expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
        }
      },
    );
  });

  describe("tells a part that went away from a cloud that went quiet", () => {
    test.each(CASES_WITH_SERIES)(
      "%s reads its service's own series beside it, and never compares it",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const queries: Array<MetricQueryConfigData> = queriesOf(step);
        const anchor: MetricQueryConfigData | undefined = queries.find(
          (query: MetricQueryConfigData): boolean => {
            return aliasOf(query) === OPENSTACK_ANCHOR_METRIC_ALIAS;
          },
        );

        // An API's own series and its collection's are already that.
        if (!anchor) {
          expect(template.id).toMatch(/-api-down$/);
          expect(metricNameOf(queries[0]!)).toMatch(/^openstack_\w+_up$/);
          return;
        }

        expect(Object.values(OPENSTACK_API_UP_METRIC_BY_SERVICE)).toContain(
          metricNameOf(anchor),
        );
        expect(attributesOf(anchor)).toEqual({});
        expect(aggregationOf(anchor)).toBe(MetricsAggregationType.Min);

        // And it is the service the template's own series are from.
        const service: OpenStackServiceType = serviceOf(queries[0]!);

        expect(metricNameOf(anchor)).toBe(
          OPENSTACK_API_UP_METRIC_BY_SERVICE[service],
        );

        for (const instance of [firingOf(step), recoveryOf(step)]) {
          expect(comparedAliases(instance)).not.toContain(
            OPENSTACK_ANCHOR_METRIC_ALIAS,
          );
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s is grouped, so one incident is about one thing",
      (_id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

        expect(keys).toContain(OPENSTACK_REGION_ATTRIBUTE);

        for (const query of queriesOf(step)) {
          expect(query.metricQueryData.groupByAttributeKeys).toEqual(keys);
        }
      },
    );

    test("only the cloud going quiet is ungrouped", () => {
      const step: MonitorStep = stepOf(
        getOpenStackAlertTemplateById(CLOUD_STOPPED_REPORTING)!,
      );

      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    });

    test.each(TEMPLATE_CASES)(
      "%s names each thing it groups by, in words a person can read",
      (_id: string, template: OpenStackAlertTemplate) => {
        for (const key of MonitorStep.getGroupByAttributeKeys(
          stepOf(template),
        )) {
          expect({
            key,
            known: SeriesLabelDisplay.isKnownLabelKey(key),
          }).toEqual({ key, known: true });
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s groups each series by labels it really has",
      (id: string, template: OpenStackAlertTemplate) => {
        const step: MonitorStep = stepOf(template);
        const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

        for (const query of queriesOf(step)) {
          const metricName: string = metricNameOf(query);

          // What the anchor and a collection's series lack read as "", by design.
          if (
            aliasOf(query) === OPENSTACK_ANCHOR_METRIC_ALIAS ||
            OPENSTACK_RECEIVER_SERIES.includes(metricName)
          ) {
            continue;
          }

          // The network's own spelling: getOpenStackGroupByKeysForMetric.
          if (metricName === "openstack_neutron_network") {
            expect(id).toMatch(/ip-pool|out-of-ips/);
            continue;
          }

          const labels: Array<string> = [
            ...OPENSTACK_EXPORTER_SERIES[metricName]!.labels,
            OPENSTACK_REGION_ATTRIBUTE,
            "openstack_service",
          ];

          for (const key of keys) {
            expect({ metricName, key, has: labels.includes(key) }).toEqual({
              metricName,
              key,
              has: true,
            });
          }
        }
      },
    );

    test.each(CASES_WITH_SERIES)(
      "%s filters each series on labels it really has",
      (_id: string, template: OpenStackAlertTemplate) => {
        for (const query of queriesOf(stepOf(template))) {
          const metricName: string = metricNameOf(query);

          for (const key of Object.keys(attributesOf(query))) {
            const labels: Array<string> = OPENSTACK_RECEIVER_SERIES.includes(
              metricName,
            )
              ? ["openstack_service"]
              : [...OPENSTACK_EXPORTER_SERIES[metricName]!.labels];

            expect({ metricName, key, has: labels.includes(key) }).toEqual({
              metricName,
              key,
              has: true,
            });
          }
        }
      },
    );
  });

  describe("never fires on a service someone disabled", () => {
    const ADMIN_STATE: Readonly<Record<string, string>> = {
      openstack_nova_agent_state: "enabled",
      openstack_cinder_agent_state: "enabled",
      openstack_neutron_agent_state: "up",
    };

    test.each(TEMPLATE_CASES)(
      "%s, if it reads a worker, reads only what an operator left on",
      (_id: string, template: OpenStackAlertTemplate) => {
        for (const query of queriesOf(stepOf(template))) {
          const adminState: string | undefined =
            ADMIN_STATE[metricNameOf(query)];

          if (adminState) {
            expect(attributesOf(query)["adminState"]).toBe(adminState);
          }
        }
      },
    );

    test("there are worker templates for that to hold on", () => {
      const workerTemplates: Array<OpenStackAlertTemplate> = TEMPLATES.filter(
        (template: OpenStackAlertTemplate): boolean => {
          return queriesOf(stepOf(template)).some(
            (query: MetricQueryConfigData): boolean => {
              return Boolean(ADMIN_STATE[metricNameOf(query)]);
            },
          );
        },
      );

      expect(workerTemplates.length).toBe(5);
    });

    test("a worker is never grouped by an id, which Cinder makes up afresh every time", () => {
      for (const template of TEMPLATES) {
        const step: MonitorStep = stepOf(template);

        if (
          queriesOf(step).some((query: MetricQueryConfigData): boolean => {
            return Boolean(ADMIN_STATE[metricNameOf(query)]);
          })
        ) {
          const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

          expect(keys).not.toContain("uuid");
          expect(keys).not.toContain("id");
          expect(keys).toContain("service");
        }
      }
    });

    test("an L3 agent someone set down does not count as a router's agent", () => {
      for (const id of [
        "openstack-router-without-active-agent",
        "openstack-router-with-two-active-agents",
      ]) {
        const query: MetricQueryConfigData = queriesOf(
          stepOf(getOpenStackAlertTemplateById(id)!),
        )[0]!;

        expect(attributesOf(query)["agent_admin_up"]).toBe("true");
      }
    });
  });

  describe("its threshold is the health rules' threshold", () => {
    test("every template with a series has its line here", () => {
      expect(Object.keys(THRESHOLDS).sort()).toEqual(
        CASES_WITH_SERIES.map((templateCase: TemplateCase): string => {
          return templateCase[0];
        }).sort(),
      );
    });

    test.each(CASES_WITH_SERIES)(
      "%s fires at the health rules' line",
      (id: string, template: OpenStackAlertTemplate) => {
        const firing: MonitorCriteriaInstance = firingOf(stepOf(template));
        const primary: CriteriaFilter = firing.data!.filters[0]!;

        expect(primary.filterType).toBe(THRESHOLDS[id]!.filterType);
        expect(primary.value).toBe(THRESHOLDS[id]!.value);
      },
    );

    test.each([
      [
        "openstack-instance-stuck-building",
        OPENSTACK_INSTANCE_STUCK_MINUTES,
        RollingTime.Past1Hour,
      ],
      [
        "openstack-instance-stuck-transitioning",
        OPENSTACK_INSTANCE_STUCK_MINUTES,
        RollingTime.Past1Hour,
      ],
      [
        "openstack-instance-stuck-in-verify-resize",
        OPENSTACK_INSTANCE_STUCK_MINUTES,
        RollingTime.Past1Hour,
      ],
      [
        "openstack-volume-stuck",
        OPENSTACK_VOLUME_STUCK_MINUTES,
        RollingTime.Past30Minutes,
      ],
    ])(
      "%s waits the health rules' %d minutes",
      (id: string, minutes: number, rollingTime: RollingTime) => {
        const step: MonitorStep = stepOf(getOpenStackAlertTemplateById(id)!);

        expect(windowMinutesOf(step)).toBeGreaterThanOrEqual(minutes);
        expect(monitorOf(step).rollingTime).toBe(rollingTime);
      },
    );

    test("the pages and the alerts draw one line for a storage pool", () => {
      expect(
        firingOf(
          stepOf(
            getOpenStackAlertTemplateById("openstack-storage-pool-warning")!,
          ),
        ).data!.filters[0]!.value,
      ).toBe(85);
      expect(
        firingOf(
          stepOf(
            getOpenStackAlertTemplateById("openstack-storage-pool-critical")!,
          ),
        ).data!.filters[0]!.value,
      ).toBe(95);
    });

    test("a threshold has a dead band, except where the value is a whole count", () => {
      const quota: MonitorCriteriaInstance = recoveryOf(
        stepOf(
          getOpenStackAlertTemplateById(
            "openstack-project-quota-nearly-reached",
          )!,
        ),
      );

      for (const filter of quota.data!.filters) {
        expect(filter.value).toBe(
          OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT * 0.9,
        );
      }

      expect(
        recoveryOf(
          stepOf(
            getOpenStackAlertTemplateById(
              "openstack-router-with-two-active-agents",
            )!,
          ),
        ).data!.filters[0]!.value,
      ).toBe(OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS);
    });
  });

  describe("says it in one line, and says what to check next", () => {
    test.each(TEMPLATE_CASES)(
      "%s has a one-line summary under the card's limit, with no metric names",
      (_id: string, template: OpenStackAlertTemplate) => {
        const summary: string = template.summary;

        expect(summary).toBe(summary.trim());
        expect(summary.length).toBeGreaterThan(0);
        expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
        expect(summary.endsWith(".")).toBe(true);
        expect(summary).not.toContain("\n");
        expect(summary).not.toMatch(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/);
        expect(summary).not.toContain("`");
        expect(summary).not.toContain(" = ");
        expect(summary.toLowerCase()).not.toBe(
          `${template.name.toLowerCase()}.`,
        );
      },
    );

    test.each(TEMPLATE_CASES)(
      "%s says what to check next, with the command to run",
      (_id: string, template: OpenStackAlertTemplate) => {
        expect(template.description).toMatch(/\bCheck\b/);
        expect(template.description).toMatch(/`openstack [^`]+`/);
      },
    );

    test.each(TEMPLATE_CASES)(
      "%s tells whoever it wakes what to do, and that it resolves on its own",
      (_id: string, template: OpenStackAlertTemplate) => {
        const description: string | undefined = firingOf(stepOf(template)).data!
          .incidents[0]!.description;

        expect(description).toMatch(/\b[Cc]heck\b/);
        expect(description).toMatch(/resolves on its own/);
        expect(description).toMatch(/openstack /);
      },
    );

    test.each(TEMPLATE_CASES)(
      "%s names the monitor in its title, and alert and incident say the same",
      (_id: string, template: OpenStackAlertTemplate) => {
        const firing: MonitorCriteriaInstance = firingOf(stepOf(template));

        expect(firing.data!.incidents[0]!.title).toContain("[OpenStack]");
        expect(firing.data!.incidents[0]!.title).toContain(ARGS.monitorName);
        expect(firing.data!.alerts[0]!.title).toBe(
          firing.data!.incidents[0]!.title,
        );
      },
    );

    test("Project Quota Nearly Reached says its series are off, and how to turn them on", () => {
      const description: string = getOpenStackAlertTemplateById(
        "openstack-project-quota-nearly-reached",
      )!.description;

      expect(description).toContain("off by default");

      for (const metric of queriesOf(
        stepOf(
          getOpenStackAlertTemplateById(
            "openstack-project-quota-nearly-reached",
          )!,
        ),
      )
        .filter((query: MetricQueryConfigData): boolean => {
          return aliasOf(query) !== OPENSTACK_ANCHOR_METRIC_ALIAS;
        })
        .map((query: MetricQueryConfigData): string => {
          return getOpenStackMetricByMetricName(metricNameOf(query))!
            .offByDefault as string;
        })) {
        // Each line it reads through is named, and is a line the agent has.
        expect(description).toContain(`--disable-metric=${metric}`);
        expect(COMPOSE).toContain(`- --disable-metric=${metric}`);
      }

      expect(description).toContain("docker-compose.yml");
      expect(description).toContain("oneuptime-openstack-exporter.service");
    });
  });

  describe("reads what the exporter really says", () => {
    test.each(TEMPLATE_CASES)(
      "%s reads only series in the catalogue and in the exporter",
      (_id: string, template: OpenStackAlertTemplate) => {
        for (const query of queriesOf(stepOf(template))) {
          const metricName: string = metricNameOf(query);

          expect(getOpenStackMetricByMetricName(metricName)).toBeDefined();
          expect(
            Boolean(OPENSTACK_EXPORTER_SERIES[metricName]) ||
              OPENSTACK_RECEIVER_SERIES.includes(metricName),
          ).toBe(true);
        }
      },
    );

    test("the only template on series that are off by default says so", () => {
      for (const template of TEMPLATES) {
        const off: boolean = queriesOf(stepOf(template)).some(
          (query: MetricQueryConfigData): boolean => {
            return Boolean(
              getOpenStackMetricByMetricName(metricNameOf(query))!.offByDefault,
            );
          },
        );

        expect({ id: template.id, off }).toEqual({
          id: template.id,
          off: template.id === "openstack-project-quota-nearly-reached",
        });
      }
    });

    test("no template compares a status series' code: it filters on the word", () => {
      for (const template of TEMPLATES) {
        for (const query of queriesOf(stepOf(template))) {
          if (metricNameOf(query) === "openstack_nova_server_status") {
            expect(attributesOf(query)["status"]).toBeDefined();
          }
        }
      }
    });

    test("every status word an instance template reads is one the exporter knows, and none of their codes is 0", () => {
      for (const status of OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES) {
        expect(
          OPENSTACK_EXPORTER_INSTANCE_STATUS_CODES[status],
        ).toBeGreaterThan(0);
      }

      expect(OPENSTACK_EXPORTER_INSTANCE_STATUS_CODES["ERROR"]).toBeGreaterThan(
        0,
      );
    });

    test("the three Instance Stuck templates read exactly the words the health rules call transitional", () => {
      const statuses: Array<string> = [
        "openstack-instance-stuck-building",
        "openstack-instance-stuck-transitioning",
        "openstack-instance-stuck-in-verify-resize",
      ].flatMap(statusesOf);

      expect(statuses.sort()).toEqual(
        Array.from(OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES).sort(),
      );
    });

    test("Stuck in Verify Resize and Stuck Building read their own words", () => {
      expect(statusesOf("openstack-instance-stuck-in-verify-resize")).toEqual([
        "VERIFY_RESIZE",
      ]);
      expect(statusesOf("openstack-instance-stuck-building")).toEqual([
        "BUILD",
        "BUILD(spawning)",
      ]);
    });

    test("Volumes in Error and Volume Stuck read the words the health rules name", () => {
      expect(statusesOf("openstack-volumes-in-error").sort()).toEqual(
        Array.from(OPENSTACK_VOLUME_ERROR_STATUSES).sort(),
      );
      expect(statusesOf("openstack-volume-stuck").sort()).toEqual(
        Array.from(OPENSTACK_VOLUME_TRANSITIONAL_STATUSES).sort(),
      );

      // All but one of Cinder's own: error_managing is seeded only when one exists.
      for (const status of statusesOf("openstack-volumes-in-error")) {
        if (status !== "error_managing") {
          expect(OPENSTACK_EXPORTER_VOLUME_STATUSES).toContain(status);
        }
      }
    });

    test("an instance or a volume stuck is judged on its own, not on a stream of them", () => {
      expect(
        MonitorStep.getGroupByAttributeKeys(
          stepOf(
            getOpenStackAlertTemplateById("openstack-instance-stuck-building")!,
          ),
        ),
      ).toContain("uuid");
      expect(
        MonitorStep.getGroupByAttributeKeys(
          stepOf(getOpenStackAlertTemplateById("openstack-volume-stuck")!),
        ),
      ).toContain("id");
    });

    test("an address pool's share leaves IPv6 out, because a /64 would hide a full IPv4 pool", () => {
      for (const id of [
        "openstack-external-ip-pool-nearly-full",
        "openstack-network-out-of-ips",
      ]) {
        const queries: Array<MetricQueryConfigData> = queriesOf(
          stepOf(getOpenStackAlertTemplateById(id)!),
        );

        for (const alias of ["addresses_used", "addresses_total"]) {
          expect(
            attributesOf(
              queries.find((query: MetricQueryConfigData): boolean => {
                return aliasOf(query) === alias;
              })!,
            )["ip_version"],
          ).toBe("4");
        }

        expect(
          attributesOf(
            queries.find((query: MetricQueryConfigData): boolean => {
              return aliasOf(query) === "is_external_network";
            })!,
          ),
        ).toEqual({ is_external: "true" });
      }
    });

    test("a tenant's network filling up never fires an external pool's template", async () => {
      for (const id of [
        "openstack-external-ip-pool-nearly-full",
        "openstack-network-out-of-ips",
      ]) {
        const step: MonitorStep = stepOf(getOpenStackAlertTemplateById(id)!);

        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, {
              addresses_used: 100,
              addresses_total: 100,
            }),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: false, healthy: true });
      }
    });

    test.each([
      ["openstack-identity-api-down", "series_in_collection"],
      ["openstack-compute-api-down", "series_in_collection"],
    ])(
      "%s fires when the exporter answers with nothing, which leaves no up series at all",
      async (id: string, alias: string) => {
        const step: MonitorStep = stepOf(getOpenStackAlertTemplateById(id)!);

        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, { [alias]: 0 }),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: true, healthy: false });
      },
    );

    test.each([
      "openstack-network-api-down",
      "openstack-block-storage-api-down",
      "openstack-image-api-down",
      "openstack-placement-api-down",
    ])(
      "%s fires when the exporter does not answer, and never on a service this cloud does not have",
      async (id: string) => {
        const step: MonitorStep = stepOf(getOpenStackAlertTemplateById(id)!);

        // The exporter timed out, or errored: the collection itself reads 0.
        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, { collection_answered: 0 }),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: true, healthy: false });

        /*
         * A cloud without this service: the exporter says so with an empty answer
         * and a 200, recorded for the services a DevStack lacks. So the collection
         * reads 1, there is no up series, and nothing is wrong.
         */
        expect(
          await evaluateTemplateCriteria({
            step,
            viewConfig: monitorOf(step).metricViewConfig,
            samplesByAlias: everyMinute(step, { collection_answered: 1 }),
            windowMinutes: windowMinutesOf(step),
          }),
        ).toEqual({ breached: false, healthy: true });
      },
    );

    test("an API that is down recovers only once the up series and the collection both say so", async () => {
      const step: MonitorStep = stepOf(
        getOpenStackAlertTemplateById("openstack-compute-api-down")!,
      );

      expect(recoveryOf(step).data!.filterCondition).toBe(FilterCondition.All);

      expect(
        await evaluateTemplateCriteria({
          step,
          viewConfig: monitorOf(step).metricViewConfig,
          samplesByAlias: everyMinute(step, {
            api_up: 0,
            series_in_collection: 40,
          }),
          windowMinutes: windowMinutesOf(step),
        }),
      ).toEqual({ breached: true, healthy: false });
    });

    test("the Project Quota formula is quiet for a project with no limit", async () => {
      const step: MonitorStep = stepOf(
        getOpenStackAlertTemplateById(
          "openstack-project-quota-nearly-reached",
        )!,
      );

      for (const limit of [-1, 0]) {
        expect(
          (
            await evaluateTemplateCriteria({
              step,
              viewConfig: monitorOf(step).metricViewConfig,
              samplesByAlias: everyMinute(step, {
                vcpus_used: 200,
                vcpus_limit: limit,
              }),
              windowMinutes: windowMinutesOf(step),
            })
          ).breached,
        ).toBe(false);
      }
    });

    test("allocation is measured against what Placement will promise, as the pages measure it", async () => {
      const step: MonitorStep = stepOf(
        getOpenStackAlertTemplateById("openstack-memory-allocation-high")!,
      );

      expect(formulasOf(step)[0]!.metricFormulaData.metricFormula).toBe(
        "(allocated / ((capacity - reserved) * allocation_ratio)) * 100",
      );

      // The recording's hypervisor: 384 of (15982 - 512) MiB.
      expect(
        await evaluateTemplateCriteria({
          step,
          viewConfig: monitorOf(step).metricViewConfig,
          samplesByAlias: everyMinute(step, {
            allocated: 384,
            capacity: 15982,
            reserved: 512,
            allocation_ratio: 1,
          }),
          windowMinutes: windowMinutesOf(step),
        }),
      ).toEqual({ breached: false, healthy: true });

      // Its memory all but gone.
      expect(
        await evaluateTemplateCriteria({
          step,
          viewConfig: monitorOf(step).metricViewConfig,
          samplesByAlias: everyMinute(step, {
            allocated: 15000,
            capacity: 15982,
            reserved: 512,
            allocation_ratio: 1,
          }),
          windowMinutes: windowMinutesOf(step),
        }),
      ).toEqual({ breached: true, healthy: false });
    });
  });

  describe("Cloud Stopped Reporting", () => {
    const step: MonitorStep = stepOf(
      getOpenStackAlertTemplateById(CLOUD_STOPPED_REPORTING)!,
    );

    test("counts an always-present series over the whole cloud, for three of its collections", () => {
      const query: MetricQueryConfigData = queriesOf(step)[0]!;

      expect(queriesOf(step)).toHaveLength(1);
      expect(metricNameOf(query)).toBe("openstack_identity_up");
      expect(aggregationOf(query)).toBe(MetricsAggregationType.Count);
      expect(attributesOf(query)).toEqual({});
      expect(monitorOf(step).rollingTime).toBe(RollingTime.Past15Minutes);
    });

    test("fires only through silence, and recovers on any data", async () => {
      const firing: CriteriaFilter = firingOf(step).data!.filters[0]!;

      expect(firing.filterType).toBe(FilterType.LessThan);
      expect(firing.value).toBe(0);
      expect(firing.metricMonitorOptions?.onNoDataPolicy).toBe(
        NoDataPolicy.Trigger,
      );

      expect(
        await evaluateTemplateCriteria({
          step,
          viewConfig: monitorOf(step).metricViewConfig,
          samplesByAlias: { [STOPPED_REPORTING_METRIC_ALIAS]: [] },
          windowMinutes: windowMinutesOf(step),
        }),
      ).toEqual({ breached: true, healthy: false });

      expect(
        await evaluateTemplateCriteria({
          step,
          viewConfig: monitorOf(step).metricViewConfig,
          samplesByAlias: {
            [STOPPED_REPORTING_METRIC_ALIAS]: new Array<number>(15).fill(1),
          },
          windowMinutes: windowMinutesOf(step),
        }),
      ).toEqual({ breached: false, healthy: true });
    });

    test("its window and words name the cloud, its agent and Keystone", () => {
      const description: string = firingOf(step).data!.incidents[0]!
        .description as string;

      expect(description).toContain("OpenStack Agent");
      expect(description).toContain("Keystone");
      expect(description).toContain("15 minutes");
    });
  });

  describe("the docs say what the code does", () => {
    test.each(TEMPLATE_CASES)(
      "the docs list %s, with its severity and category",
      (_id: string, template: OpenStackAlertTemplate) => {
        expect(DOCS).toContain(
          `| ${template.name} | ${template.category} | ${template.severity} |`,
        );
      },
    );

    test("the docs count the templates", () => {
      expect(DOCS).toContain(`OneUptime ships ${TEMPLATES.length} templates`);
    });
  });
});
