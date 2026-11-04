import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  AdditionalCriteriaFilterSpec,
  STOPPED_REPORTING_METRIC_ALIAS,
  buildHealthyCriteriaInstance,
  buildStoppedReportingCriteriaInstances,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import FilterCondition from "../Filter/FilterCondition";
import { CriteriaFilter, FilterType, NoDataPolicy } from "./CriteriaFilter";
import MonitorStepOpenStackMonitor, {
  OPENSTACK_REGION_ATTRIBUTE,
} from "./MonitorStepOpenStackMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
  OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
} from "../OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
} from "../OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackServiceType,
} from "../OpenStack/OpenStackResourceKind";

export type OpenStackAlertTemplateCategory =
  | "Availability"
  | "Control Plane"
  | "Compute"
  | "Network"
  | "Storage"
  | "Projects";

export type OpenStackAlertTemplateSeverity = "Critical" | "Warning";

export interface OpenStackAlertTemplateArgs {
  cloudIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface OpenStackAlertTemplate {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold and window,
   * without metric names. The picker and a cloud's Recommendations list show it on
   * the card; `description` (how it is computed, its caveats and what to check
   * next) is shown once a template is picked.
   */
  summary: string;
  description: string;
  category: OpenStackAlertTemplateCategory;
  severity: OpenStackAlertTemplateSeverity;
  getMonitorStep: (args: OpenStackAlertTemplateArgs) => MonitorStep;
}

/*
 * WHERE THESE COME FROM, AND WHERE THEY DIFFER. The rules operators already run,
 * from StackHPC, Atmosphere, Canonical and MOSK (Kolla-Ansible ships none):
 *
 *   - Worker down: all four have it. Atmosphere fires on any worker `!= 1`, so on
 *     one someone disabled too, and StackHPC by name across every *_state series.
 *     Canonical filters adminState, which is what these do. They wait 15, 1 and 5
 *     minutes; here it is three collections.
 *   - Every worker of a kind down: MOSK's Outage rules, kept for the scheduler and
 *     conductor, where one host down is a Warning and all of them the outage. MOSK
 *     also grades one Cinder service a Warning, until half are down. Here it stays
 *     Critical: no Outage template stands behind it, and a backend's one
 *     cinder-volume going down is that backend's outage.
 *   - Disabled: MOSK pages when a binary is disabled on every host. Here that never
 *     fires, as planned work; the pages warn once it has lasted a week.
 *   - Instance in error: Atmosphere waits 24 hours per instance, because a failed
 *     boot is often a project's own. Here one incident per region, after 10 minutes.
 *   - Stuck: Atmosphere's task state and build request series are not series this
 *     exporter has. Here the status word, for the hour the pages also call stuck.
 *     MOSK waits 30 minutes on VERIFY_RESIZE: the same line as the other words here.
 *   - Router agents: StackHPC's `count(active) != 1` never fires on no active agent,
 *     since a count of nothing is nothing. So no alive agent reads the alive value
 *     instead, and two active ones stay a count, as Atmosphere's do.
 *   - Address pools: Atmosphere warns at 80% for 6 hours on external, shared networks.
 *     Here the pages' own 90% and 100%, on external networks.
 *   - Metrics missing: Canonical has an absent() rule per service, which on a cloud
 *     without that service never clears. Here only Keystone and Nova's API read an
 *     empty collection as down; a silent cloud is Cloud Stopped Reporting.
 *
 * WHAT THESE TEMPLATES HOLD THEMSELVES TO, each with a test over every template
 * (Tests/Types/Monitor/OpenStackAlertTemplates.test.ts). They are the findings of
 * the resource-monitoring audit (#5433), which found templates that never
 * recovered, watched the wrong state, read too short a window and added up scrapes.
 *
 * Reads a window of at least three collections. The agent collects compute,
 * network, volume and placement every 2 minutes and identity and image every 5, so
 * a compute template reads 10 minutes (the next window after 6 that a monitor
 * offers) and an identity one 15. "All Values" needs them: with fewer, a window is
 * too short to show how often a series reports (MetricWindowCoverage).
 *
 * Reads a label for a state, never a value. openstack-exporter's status series
 * carry a numeric code (ERROR is 4), so a template filters on the `status` word.
 *
 * Never fires on what someone disabled. A worker's template filters on adminState:
 * enabled on Nova and Cinder, up on Neutron.
 *
 * Never adds up. Up, alive and state series read Min (any one down reads 0), counts
 * read Max, and Count only counts rows where a scrape writes one row per thing
 * (one per minute, at most, since a collection takes at least 2 minutes).
 *
 * Recovers when its series goes away. A status series exists only while something
 * is in that status, and disabling a worker takes it out of the adminState filter,
 * so nothing would ever read as recovered: #5433 found incidents stuck open that
 * way, because silence no longer closes one. Recovery counts a gone series as
 * recovered, and every step reads its service's own `_up` series beside it (the
 * ANCHOR below), for two reasons:
 *
 *   - A grouped monitor acts on the series it was handed. With every series of a
 *     query gone it has none, and MonitorCriteriaEvaluator calls a criteria no
 *     series satisfied not met. So the last instance in ERROR going away would
 *     leave its incident open for ever. The anchor keeps a series in the window.
 *   - Silence still is not recovery (MonitorResourceUtil
 *     .isSilentInfrastructureWindow). When the agent stops, or the exporter cannot
 *     log in to Keystone, the anchor goes too, the window is silent and open
 *     incidents stay open: Cloud Stopped Reporting is the one speaking then.
 */

/*
 * What one incident is about: the labels a template groups by. All are datapoint
 * labels, so none is `resource.`-prefixed in ClickHouse.
 */
const REGION: string = OPENSTACK_REGION_ATTRIBUTE;
const SERVICE_JOB: string = "openstack_service";

// A worker: its host and binary. A host name can repeat between regions.
const WORKER_GROUP: Array<string> = [REGION, "hostname", "service"];
// An API, or a count the exporter only keeps per region.
const API_GROUP: Array<string> = [REGION, SERVICE_JOB];
const HYPERVISOR_GROUP: Array<string> = [REGION, "hostname"];
const INSTANCE_GROUP: Array<string> = [REGION, "uuid", "name"];
const VOLUME_GROUP: Array<string> = [REGION, "id", "name", "volume_type"];
const STORAGE_POOL_GROUP: Array<string> = [
  REGION,
  "name",
  "volume_backend_name",
];
const ROUTER_GROUP: Array<string> = [REGION, "router_id"];
const NETWORK_GROUP: Array<string> = [REGION, "network_id", "network_name"];
const PROJECT_GROUP: Array<string> = [REGION, "tenant_id", "tenant"];

// The smallest window holding three collections of what a service's job collects.
export const OPENSTACK_WINDOW_BY_SERVICE: Record<
  OpenStackServiceType,
  RollingTime
> = {
  [OpenStackServiceType.Identity]: RollingTime.Past15Minutes,
  [OpenStackServiceType.Image]: RollingTime.Past15Minutes,
  [OpenStackServiceType.Compute]: RollingTime.Past10Minutes,
  [OpenStackServiceType.Network]: RollingTime.Past10Minutes,
  [OpenStackServiceType.Volume]: RollingTime.Past10Minutes,
  [OpenStackServiceType.Placement]: RollingTime.Past10Minutes,
};

export const OPENSTACK_API_UP_METRIC_BY_SERVICE: Record<
  OpenStackServiceType,
  string
> = {
  [OpenStackServiceType.Identity]: "openstack_identity_up",
  [OpenStackServiceType.Compute]: "openstack_nova_up",
  [OpenStackServiceType.Placement]: "openstack_placement_up",
  [OpenStackServiceType.Network]: "openstack_neutron_up",
  [OpenStackServiceType.Volume]: "openstack_cinder_up",
  [OpenStackServiceType.Image]: "openstack_glance_up",
};

/*
 * The query that keeps a grouped step's window from reading as silent while the
 * service still reports: see the top of this file. No criteria compares it.
 */
export const OPENSTACK_ANCHOR_METRIC_ALIAS: string = "service_reporting";

/*
 * The windows a monitor offers, in minutes, for a line a health rule draws in
 * minutes: so changing the rule moves the template with it.
 */
const WINDOWS_IN_MINUTES: ReadonlyArray<{
  minutes: number;
  rollingTime: RollingTime;
}> = [
  { minutes: 5, rollingTime: RollingTime.Past5Minutes },
  { minutes: 10, rollingTime: RollingTime.Past10Minutes },
  { minutes: 15, rollingTime: RollingTime.Past15Minutes },
  { minutes: 30, rollingTime: RollingTime.Past30Minutes },
  { minutes: 60, rollingTime: RollingTime.Past1Hour },
  { minutes: 120, rollingTime: RollingTime.Past2Hours },
  { minutes: 180, rollingTime: RollingTime.Past3Hours },
  { minutes: 360, rollingTime: RollingTime.Past6Hours },
  { minutes: 720, rollingTime: RollingTime.Past12Hours },
];

function windowHolding(minutes: number): RollingTime {
  for (const window of WINDOWS_IN_MINUTES) {
    if (window.minutes >= minutes) {
      return window.rollingTime;
    }
  }

  return RollingTime.Past12Hours;
}

export function buildOpenStackMonitorStep(args: {
  openstackMonitor: MonitorStepOpenStackMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    dockerMonitor: undefined,
    openstackMonitor: args.openstackMonitor,
  };

  return monitorStep;
}

// One metric read for one alias, as a form's custom metric reads it.
export function buildOpenStackMonitorConfig(args: {
  cloudIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}): MonitorStepOpenStackMonitor {
  return buildOpenStackSeriesConfig({
    cloudIdentifier: args.cloudIdentifier,
    queries: [
      {
        alias: args.metricAlias,
        metricName: args.metricName,
        aggregationType: args.aggregationType,
        attributes: args.attributes,
      },
    ],
    rollingTime: args.rollingTime,
    groupByAttributeKeys: args.groupByAttributeKeys,
  });
}

export interface OpenStackQuery {
  alias: string;
  metricName: string;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
}

export interface OpenStackFormula {
  alias: string;
  legend: string;
  formula: string;
  legendUnit?: string | undefined;
}

function buildOpenStackSeriesConfig(args: {
  cloudIdentifier: string;
  queries: Array<OpenStackQuery>;
  formulas?: Array<OpenStackFormula> | undefined;
  rollingTime: RollingTime;
  groupByAttributeKeys?: Array<string> | undefined;
  /*
   * The service whose `_up` series keeps the window from reading as silent: see
   * the top of this file.
   */
  anchorService?: OpenStackServiceType | undefined;
}): MonitorStepOpenStackMonitor {
  const queries: Array<OpenStackQuery> = args.anchorService
    ? [
        ...args.queries,
        {
          alias: OPENSTACK_ANCHOR_METRIC_ALIAS,
          metricName: OPENSTACK_API_UP_METRIC_BY_SERVICE[args.anchorService],
          aggregationType: MetricsAggregationType.Min,
        },
      ]
    : args.queries;

  return {
    cloudIdentifier: args.cloudIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: queries.map(
        (query: OpenStackQuery): MetricQueryConfigData => {
          return {
            metricAliasData: {
              metricVariable: query.alias,
              title: query.alias,
              description: query.alias,
              legend: query.alias,
              legendUnit: undefined,
            },
            metricQueryData: {
              filterData: {
                metricName: query.metricName,
                attributes: query.attributes || {},
                aggegationType: query.aggregationType,
                aggregateBy: {},
              },
              ...(args.groupByAttributeKeys &&
              args.groupByAttributeKeys.length > 0
                ? { groupByAttributeKeys: args.groupByAttributeKeys }
                : {}),
            },
          } as unknown as MetricQueryConfigData;
        },
      ),
      formulaConfigs: (args.formulas || []).map(
        (formula: OpenStackFormula): MetricFormulaConfigData => {
          return {
            metricAliasData: {
              metricVariable: formula.alias,
              title: formula.legend,
              description: formula.legend,
              legend: formula.legend,
              legendUnit: formula.legendUnit,
            },
            metricFormulaData: {
              metricFormula: formula.formula,
            },
          };
        },
      ),
    },
    rollingTime: args.rollingTime,
  };
}

/*
 * A gone series reads as recovered when the recovery compares a floor: `>= 1` on
 * no data has nothing to compare, and treating no data as 0 would read as down. So
 * its no-data policy says the comparison holds. A criteria that matches on no data
 * is safe here for the reason at the top of this file: this one only ever matches
 * while the anchor keeps the window from being silent.
 */
function countGoneSeriesAsRecovered(
  instance: MonitorCriteriaInstance,
): MonitorCriteriaInstance {
  for (const filter of (instance.data?.filters ||
    []) as Array<CriteriaFilter>) {
    filter.metricMonitorOptions = {
      ...filter.metricMonitorOptions,
      onNoDataPolicy: NoDataPolicy.Trigger,
    };
  }

  return instance;
}

interface IncidentWords {
  incidentTitle: string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
}

interface TemplateNotification extends IncidentWords {
  args: OpenStackAlertTemplateArgs;
}

function buildOfflineCriteria(data: {
  notification: TemplateNotification;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  const args: OpenStackAlertTemplateArgs = data.notification.args;

  return buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: args.offlineMonitorStatusId,
    incidentSeverityId: args.defaultIncidentSeverityId,
    alertSeverityId: args.defaultAlertSeverityId,
    monitorName: args.monitorName,
    metricAlias: data.metricAlias,
    filterType: data.filterType,
    value: data.value,
    additionalFilters: data.additionalFilters,
    filterCondition: data.filterCondition,
    incidentTitle: `${data.notification.incidentTitle} - ${args.monitorName}`,
    incidentDescription: data.notification.incidentDescription,
    criteriaName: data.notification.criteriaName,
    criteriaDescription: data.notification.criteriaDescription,
    resourceNoun: "OpenStack cloud",
  });
}

/*
 * A step whose series should read 1: an API or worker that is up, an agent alive.
 * Fires when ANY of its aliases reads below 1 for the whole window; recovers when
 * EVERY one reads 1 or has gone away.
 */
function buildFloorStep(data: {
  args: OpenStackAlertTemplateArgs;
  service: OpenStackServiceType;
  queries: Array<OpenStackQuery>;
  groupByAttributeKeys: Array<string>;
  // An API's own queries keep its window from being silent: it needs no anchor.
  hasOwnAnchor?: boolean | undefined;
  words: IncidentWords;
}): MonitorStep {
  const [firstQuery, ...otherQueries] = data.queries;

  return buildOpenStackMonitorStep({
    openstackMonitor: buildOpenStackSeriesConfig({
      cloudIdentifier: data.args.cloudIdentifier,
      queries: data.queries,
      rollingTime: OPENSTACK_WINDOW_BY_SERVICE[data.service],
      groupByAttributeKeys: data.groupByAttributeKeys,
      anchorService: data.hasOwnAnchor ? undefined : data.service,
    }),
    offlineCriteriaInstance: buildOfflineCriteria({
      notification: { args: data.args, ...data.words },
      metricAlias: firstQuery!.alias,
      filterType: FilterType.LessThan,
      value: 1,
      additionalFilters: otherQueries.map(
        (query: OpenStackQuery): AdditionalCriteriaFilterSpec => {
          return {
            metricAlias: query.alias,
            filterType: FilterType.LessThan,
            value: 1,
          };
        },
      ),
    }),
    onlineCriteriaInstance: countGoneSeriesAsRecovered(
      buildHealthyCriteriaInstance({
        onlineMonitorStatusId: data.args.onlineMonitorStatusId,
        metricAlias: firstQuery!.alias,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        // These series are 0 or 1: a dead band above 1 could never be crossed.
        isBinaryMetric: true,
        filterCondition: FilterCondition.All,
        additionalFilters: otherQueries.map(
          (query: OpenStackQuery): AdditionalCriteriaFilterSpec => {
            return {
              metricAlias: query.alias,
              filterType: FilterType.GreaterThanOrEqualTo,
              value: 1,
            };
          },
        ),
      }),
    ),
  });
}

/*
 * A step whose values should stay under a line: a count that should read 0, or a
 * share of something. Fires when ANY alias passes its line for the whole window;
 * recovers when EVERY one is back under it or has gone away, as the Ceph health
 * templates do: a gone series reads as 0, which is under any line.
 */
function buildCeilingStep(data: {
  args: OpenStackAlertTemplateArgs;
  service: OpenStackServiceType;
  queries: Array<OpenStackQuery>;
  formulas?: Array<OpenStackFormula> | undefined;
  rollingTime?: RollingTime | undefined;
  groupByAttributeKeys: Array<string>;
  aliases: Array<string>;
  filterType?: FilterType | undefined;
  value: number;
  // Where a whole-number count recovers, when a dead band would never be reached.
  recoveryValue?: number | undefined;
  words: IncidentWords;
}): MonitorStep {
  const firingFilterType: FilterType =
    data.filterType || FilterType.GreaterThan;
  const recoveryFilterType: FilterType =
    firingFilterType === FilterType.GreaterThanOrEqualTo
      ? FilterType.LessThan
      : data.value === 0
        ? FilterType.EqualTo
        : FilterType.LessThanOrEqualTo;
  const [firstAlias, ...otherAliases] = data.aliases;

  return buildOpenStackMonitorStep({
    openstackMonitor: buildOpenStackSeriesConfig({
      cloudIdentifier: data.args.cloudIdentifier,
      queries: data.queries,
      formulas: data.formulas,
      rollingTime:
        data.rollingTime || OPENSTACK_WINDOW_BY_SERVICE[data.service],
      groupByAttributeKeys: data.groupByAttributeKeys,
      anchorService: data.service,
    }),
    offlineCriteriaInstance: buildOfflineCriteria({
      notification: { args: data.args, ...data.words },
      metricAlias: firstAlias!,
      filterType: firingFilterType,
      value: data.value,
      additionalFilters: otherAliases.map(
        (alias: string): AdditionalCriteriaFilterSpec => {
          return {
            metricAlias: alias,
            filterType: firingFilterType,
            value: data.value,
          };
        },
      ),
    }),
    onlineCriteriaInstance: buildHealthyCriteriaInstance({
      onlineMonitorStatusId: data.args.onlineMonitorStatusId,
      metricAlias: firstAlias!,
      filterType: recoveryFilterType,
      value: data.value,
      recoveryValue: data.recoveryValue,
      filterCondition: FilterCondition.All,
      treatNoDataAsZero: true,
      additionalFilters: otherAliases.map(
        (alias: string): AdditionalCriteriaFilterSpec => {
          return {
            metricAlias: alias,
            filterType: recoveryFilterType,
            value: data.value,
          };
        },
      ),
    }),
  });
}

// A status word as a query alias: BUILD(spawning) reads in_build_spawning.
function statusAlias(status: string): string {
  return `in_${status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+$/g, "")}`;
}

// --- Availability ---

const cloudStoppedReportingTemplate: OpenStackAlertTemplate = {
  id: "openstack-cloud-stopped-reporting",
  name: "Cloud Stopped Reporting",
  summary: "The cloud sends no data for 15 minutes.",
  description:
    "Alert when the cloud sends no data for 15 minutes: the OpenStack Agent's collector or exporter stopped, it lost its route to OneUptime or had its token revoked, or the exporter can no longer log in to Keystone, which leaves every service's collection empty. Reads openstack_identity_up, which the exporter sends on every identity collection whether or not Keystone's lists answered, so only silence fires it, and a Count of it holds for the whole cloud however many regions it has. One incident for the whole cloud. Check the agent's containers and logs first, then run `openstack token issue` with the agent's credential.",
  category: "Availability",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

    return buildOpenStackMonitorStep({
      openstackMonitor: buildOpenStackMonitorConfig({
        cloudIdentifier: args.cloudIdentifier,
        /*
         * The heartbeat. The identity job runs every 5 minutes, so 15 minutes is
         * its three collections. Ungrouped and counted, with no filter: only a
         * window with no row at all is the breach.
         */
        metricName: "openstack_identity_up",
        metricAlias,
        rollingTime: OPENSTACK_WINDOW_BY_SERVICE[OpenStackServiceType.Identity],
        aggregationType: MetricsAggregationType.Count,
      }),
      ...buildStoppedReportingCriteriaInstances({
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        incidentSeverityId: args.defaultIncidentSeverityId,
        alertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
        metricAlias,
        resourceNoun: "OpenStack cloud",
        incidentTitle: `[OpenStack] Cloud Stopped Reporting - ${args.monitorName}`,
        incidentDescription: `OneUptime has received nothing from this OpenStack cloud for 15 minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the machine running the OpenStack Agent is up and its containers are running (docker compose ps, and the collector's and exporter's logs name the error); whether the exporter can still log in to Keystone (openstack token issue, with the agent's credential: when it cannot, every service's collection comes back empty, and Identity API Down fires too); and whether the agent can reach OneUptime with its token. The incident resolves on its own once data arrives again.`,
        criteriaName: "Cloud Stopped Reporting - No data for 15 minutes",
        criteriaDescription:
          "Triggers when the cloud sends no openstack_identity_up data for the whole 15-minute window.",
      }),
    });
  },
};

/*
 * One API in one region. The exporter says an API is down in two ways, and which
 * one depends on what failed:
 *
 *  - `openstack_<service>_up` reads 0 when every one of its calls failed.
 *  - The series goes away when the exporter could not build that service's client
 *    (main.go logs it and carries on, and answers 200 with nothing). It logs in to
 *    Keystone first for every service, and asks Nova's API for its microversions
 *    before it reads anything of Nova's: so a Keystone or Nova API that is simply
 *    stopped leaves no `_up` series at all. `up` still reads 1 then, because the
 *    collection itself answered; `scrape_samples_scraped` reads 0.
 *
 * So the APIs that fail that way also read how many series the collection held.
 * The others read `up`, for an exporter that timed out or errored, which is what
 * the pages call down too (OpenStackSnapshotScan). They do not read the sample
 * count, because a cloud without Cinder answers that job with nothing for ever:
 * that is a service it does not have, not an outage.
 */
function buildApiDownTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  service: OpenStackServiceType;
  // What a collection that failed reads as: see above.
  collectionMetricName: "up" | "scrape_samples_scraped";
  incidentDescription: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Availability",
    severity: "Critical",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildFloorStep({
        args,
        service: data.service,
        hasOwnAnchor: true,
        groupByAttributeKeys: API_GROUP,
        queries: [
          {
            alias: "api_up",
            metricName: OPENSTACK_API_UP_METRIC_BY_SERVICE[data.service],
            aggregationType: MetricsAggregationType.Min,
          },
          {
            alias:
              data.collectionMetricName === "up"
                ? "collection_answered"
                : "series_in_collection",
            metricName: data.collectionMetricName,
            aggregationType: MetricsAggregationType.Min,
            attributes: { [SERVICE_JOB]: data.service },
          },
        ],
        words: {
          incidentTitle: `[OpenStack] ${data.name}`,
          incidentDescription: data.incidentDescription,
          criteriaName: `${data.name} - not answering`,
          criteriaDescription: `Triggers when the ${data.name.replace(" Down", "")} does not answer for the whole window.`,
        },
      });
    },
  };
}

const identityApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-identity-api-down",
  name: "Identity API Down",
  summary: "Keystone does not answer for 15 minutes.",
  description:
    "Alert when Keystone does not answer for 15 minutes: every call the exporter made failed (openstack_identity_up reads 0), or it could not log in at all, which leaves its identity collection empty (scrape_samples_scraped reads 0). One incident per region. Nothing else can be read while it is down, so Cloud Stopped Reporting fires beside it. Check keystone's service and the database behind it, then run `openstack token issue`.",
  service: OpenStackServiceType.Identity,
  collectionMetricName: "scrape_samples_scraped",
  incidentDescription: `Keystone is not answering: every call the exporter made failed, or it could not log in at all. Nobody can get a token while this lasts, so every other API refuses new requests too, though running instances carry on. Check keystone's service and logs on the controllers, the load balancer in front of it and the database behind it, then run openstack token issue. The incident resolves on its own once it answers again.`,
});

const computeApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-compute-api-down",
  name: "Compute API Down",
  summary: "Nova's API does not answer for 10 minutes.",
  description:
    "Alert when Nova's API does not answer for 10 minutes: every call the exporter made failed (openstack_nova_up reads 0), or it could not reach the API at all, which leaves its compute collection empty (scrape_samples_scraped reads 0). One incident per region. While it lasts, Nova's own series are gone, so its other templates resolve and come back later if the fault is still there. Check nova-api's service and logs, then run `openstack compute service list`.",
  service: OpenStackServiceType.Compute,
  collectionMetricName: "scrape_samples_scraped",
  incidentDescription: `Nova's API is not answering: every call the exporter made failed, or it could not reach the API at all. Running instances carry on, but nothing can be created, changed or deleted. Check nova-api's service and logs on the controllers, the load balancer in front of it, RabbitMQ and the database, then run openstack compute service list. The incident resolves on its own once it answers again.`,
});

const networkApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-network-api-down",
  name: "Network API Down",
  summary: "Neutron's API does not answer for 10 minutes.",
  description:
    "Alert when Neutron's API does not answer for 10 minutes: every call the exporter made failed (openstack_neutron_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. If every API reads down at once, look at the exporter first. Check neutron-server's service and logs, then run `openstack network agent list`.",
  service: OpenStackServiceType.Network,
  collectionMetricName: "up",
  incidentDescription: `Neutron's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. Traffic already flowing carries on, but no port, router or floating IP can be changed, so new instances fail to boot. If every API reads down at once, look at the exporter first. Otherwise check neutron-server's service and logs, RabbitMQ and the database, then run openstack network agent list. The incident resolves on its own once it answers again.`,
});

const blockStorageApiDownTemplate: OpenStackAlertTemplate =
  buildApiDownTemplate({
    id: "openstack-block-storage-api-down",
    name: "Block Storage API Down",
    summary: "Cinder's API does not answer for 10 minutes.",
    description:
      "Alert when Cinder's API does not answer for 10 minutes: every call the exporter made failed (openstack_cinder_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. If every API reads down at once, look at the exporter first. Check cinder-api's service and logs, then run `openstack volume service list`.",
    service: OpenStackServiceType.Volume,
    collectionMetricName: "up",
    incidentDescription: `Cinder's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. Attached volumes carry on working, but none can be created, attached or deleted. If every API reads down at once, look at the exporter first. Otherwise check cinder-api's service and logs, RabbitMQ and the database, then run openstack volume service list. The incident resolves on its own once it answers again.`,
  });

const imageApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-image-api-down",
  name: "Image API Down",
  summary: "Glance's API does not answer for 15 minutes.",
  description:
    "Alert when Glance's API does not answer for 15 minutes: every call the exporter made failed (openstack_glance_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. If every API reads down at once, look at the exporter first. Check glance-api's service and logs, then run `openstack image list --limit 1`.",
  service: OpenStackServiceType.Image,
  collectionMetricName: "up",
  incidentDescription: `Glance's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. New instances that need an image they do not have cached fail to boot. If every API reads down at once, look at the exporter first. Otherwise check glance-api's service and logs and the image store behind it, then run openstack image list --limit 1. The incident resolves on its own once it answers again.`,
});

const placementApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-placement-api-down",
  name: "Placement API Down",
  summary: "Placement's API does not answer for 10 minutes.",
  description:
    "Alert when Placement's API does not answer for 10 minutes: every call the exporter made failed (openstack_placement_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. If every API reads down at once, look at the exporter first. Check placement-api's service and logs, then run `openstack endpoint list --service placement`.",
  service: OpenStackServiceType.Placement,
  collectionMetricName: "up",
  incidentDescription: `Placement's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. The scheduler asks it where an instance fits, so new instances fail to boot with No valid host. If every API reads down at once, look at the exporter first. Otherwise check placement-api's service and logs and the database, then run openstack endpoint list --service placement. The incident resolves on its own once it answers again.`,
});

// --- Control plane ---

const NOVA_AGENT_STATE: string = "openstack_nova_agent_state";

const computeServiceDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-compute-service-down",
  name: "Compute Service Down",
  summary: "An enabled nova-compute is down.",
  description:
    "Alert when an enabled nova-compute is down for 10 minutes (openstack_nova_agent_state below 1, filtered to adminState enabled). One incident per host, and one someone disabled never fires, so planned work is quiet. Its instances may still be running, but Nova cannot manage them. Check `openstack compute service list --host <host>`, then nova-compute's service and logs on that host, and its route to RabbitMQ.",
  category: "Control Plane",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Compute,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "compute_service_up",
          metricName: NOVA_AGENT_STATE,
          aggregationType: MetricsAggregationType.Min,
          attributes: { service: "nova-compute", adminState: "enabled" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Compute Service Down",
        incidentDescription: `An enabled nova-compute has stopped reporting to Nova. Instances on that host may still be running, but Nova cannot start, stop or move them, and it schedules nothing new there. Check openstack compute service list --host for the host named above, then nova-compute's service and logs on that host, and its route to RabbitMQ. If you are working on the host, disable the service first (openstack compute service set --disable) and this monitor stays quiet. The incident resolves on its own once it is up again, or disabled.`,
        criteriaName: "Compute Service Down - enabled nova-compute < 1",
        criteriaDescription:
          "Triggers when an enabled nova-compute reports down for the whole window.",
      },
    });
  },
};

const schedulerAndConductorQueries: (data: {
  aggregationType: MetricsAggregationType;
  schedulerAlias: string;
  conductorAlias: string;
}) => Array<OpenStackQuery> = (data: {
  aggregationType: MetricsAggregationType;
  schedulerAlias: string;
  conductorAlias: string;
}): Array<OpenStackQuery> => {
  return [
    {
      alias: data.schedulerAlias,
      metricName: NOVA_AGENT_STATE,
      aggregationType: data.aggregationType,
      attributes: { service: "nova-scheduler", adminState: "enabled" },
    },
    {
      alias: data.conductorAlias,
      metricName: NOVA_AGENT_STATE,
      aggregationType: data.aggregationType,
      attributes: { service: "nova-conductor", adminState: "enabled" },
    },
  ];
};

const schedulerOrConductorDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-scheduler-or-conductor-down",
  name: "Scheduler or Conductor Down",
  summary: "An enabled nova-scheduler or nova-conductor is down.",
  description:
    "Alert when an enabled nova-scheduler or nova-conductor is down for 10 minutes (openstack_nova_agent_state below 1, filtered to adminState enabled). One incident per host and binary, and one someone disabled never fires. The others carry on while any is left, which is why this is a Warning: Every Scheduler or Conductor Down is the outage. Check `openstack compute service list --service nova-scheduler`, then the service's logs on that host.",
  category: "Control Plane",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Compute,
      groupByAttributeKeys: WORKER_GROUP,
      queries: schedulerAndConductorQueries({
        aggregationType: MetricsAggregationType.Min,
        schedulerAlias: "scheduler_up",
        conductorAlias: "conductor_up",
      }),
      words: {
        incidentTitle: "[OpenStack] Scheduler or Conductor Down",
        incidentDescription: `An enabled nova-scheduler or nova-conductor has stopped reporting to Nova. The others carry on while any is left, though with less room. Check openstack compute service list for the host and binary named above, then that service's logs on that host, and its route to RabbitMQ and the database. The incident resolves on its own once it is up again, or disabled.`,
        criteriaName: "Scheduler or Conductor Down - enabled worker < 1",
        criteriaDescription:
          "Triggers when an enabled nova-scheduler or nova-conductor reports down for the whole window.",
      },
    });
  },
};

const everySchedulerOrConductorDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-every-scheduler-or-conductor-down",
  name: "Every Scheduler or Conductor Down",
  summary:
    "Every enabled nova-scheduler or nova-conductor in a region is down.",
  description:
    "Alert when every enabled nova-scheduler, or every enabled nova-conductor, in a region is down for 10 minutes (the Max of openstack_nova_agent_state across their hosts reads below 1, filtered to adminState enabled). One incident per region and binary. Nothing new can boot. Check `openstack compute service list`, then RabbitMQ and the database they all depend on, before the workers themselves.",
  category: "Control Plane",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Compute,
      groupByAttributeKeys: [REGION, "service"],
      /*
       * Max across hosts: 1 while any one of them is alive. These read the same
       * series as Scheduler or Conductor Down, so their own aliases are what tell
       * the Recommendations page the two apart: a monitor's fingerprint is its
       * metrics, aliases and filters, and setting up one must not read as both.
       */
      queries: schedulerAndConductorQueries({
        aggregationType: MetricsAggregationType.Max,
        schedulerAlias: "any_scheduler_up",
        conductorAlias: "any_conductor_up",
      }),
      words: {
        incidentTitle: "[OpenStack] Every Scheduler or Conductor Down",
        incidentDescription: `Every enabled nova-scheduler, or every enabled nova-conductor, in this region has stopped reporting. Nothing new can boot, move or resize until one is back. They rarely all fail on their own: check openstack compute service list, then RabbitMQ and the database they all depend on, then the workers' logs. The incident resolves on its own once one is up again.`,
        criteriaName: "Every Scheduler or Conductor Down - none alive",
        criteriaDescription:
          "Triggers when no enabled nova-scheduler, or no enabled nova-conductor, in a region reports up for the whole window.",
      },
    });
  },
};

const networkAgentDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-network-agent-down",
  name: "Network Agent Down",
  summary: "An enabled Neutron agent is down.",
  description:
    "Alert when a Neutron agent set up is not alive for 10 minutes (openstack_neutron_agent_state below 1, filtered to adminState up). One incident per host and binary, and one someone set down never fires, so planned work is quiet. Ports on that host may stop being wired, and on ML2/OVS its routers and DHCP may go with it. Check `openstack network agent list --host <host>`, then the agent's service and logs on that host.",
  category: "Control Plane",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Network,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "network_agent_alive",
          metricName: "openstack_neutron_agent_state",
          aggregationType: MetricsAggregationType.Min,
          attributes: { adminState: "up" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Network Agent Down",
        incidentDescription: `A Neutron agent that is set up has stopped reporting. Traffic already flowing often carries on, but ports on that host stop being wired, and on ML2/OVS its routers and DHCP may go with it. Check openstack network agent list --host for the host named above, then that agent's service and logs on the host, and its route to RabbitMQ. If you are working on the host, set the agent down first (openstack network agent set --disable) and this monitor stays quiet. The incident resolves on its own once it is alive again, or set down.`,
        criteriaName: "Network Agent Down - agent set up and not alive",
        criteriaDescription:
          "Triggers when a Neutron agent with adminState up reports not alive for the whole window.",
      },
    });
  },
};

const blockStorageServiceDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-block-storage-service-down",
  name: "Block Storage Service Down",
  summary: "An enabled Cinder service is down.",
  description:
    "Alert when an enabled cinder-volume, cinder-scheduler or cinder-backup is down for 10 minutes (openstack_cinder_agent_state below 1, filtered to adminState enabled). One incident per host and binary, and one someone disabled never fires, so planned work is quiet. Attached volumes usually carry on, but nothing new can be created or attached on that backend. Check `openstack volume service list --host <host>`, then the service's logs on that host and the backend behind it.",
  category: "Control Plane",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Volume,
      /*
       * By host and binary, never its uuid label: the exporter makes that up
       * afresh on every collection, so each one would be a new series.
       */
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "block_storage_service_up",
          metricName: "openstack_cinder_agent_state",
          aggregationType: MetricsAggregationType.Min,
          attributes: { adminState: "enabled" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Block Storage Service Down",
        incidentDescription: `An enabled Cinder service has stopped reporting. Attached volumes usually carry on, but nothing new can be created or attached on its backend. Check openstack volume service list --host for the host named above (for cinder-volume that is host@backend), then that service's logs on the host and the storage backend behind it. If you are working on it, disable the service first (openstack volume service set --disable) and this monitor stays quiet. The incident resolves on its own once it is up again, or disabled.`,
        criteriaName: "Block Storage Service Down - enabled service < 1",
        criteriaDescription:
          "Triggers when an enabled Cinder service reports down for the whole window.",
      },
    });
  },
};

// --- Compute ---

/*
 * What Placement has promised on a hypervisor, as a share of what it will promise.
 * That is what OpenStackSnapshotScan reads for the pages: (total - reserved) x ratio.
 * All four come from one collection, so they line up minute by minute, and Max
 * reads each one's value whatever else the bucket holds.
 */
function buildAllocationTemplate(data: {
  id: string;
  name: string;
  resourceType: string;
  noun: string;
  summary: string;
  incidentDescription: string;
}): OpenStackAlertTemplate {
  const metricAlias: string = "allocated_percent";

  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: `Alert when Placement has promised more than ${OPENSTACK_ALLOCATION_WARNING_PERCENT}% of what it will promise of a hypervisor's ${data.noun}, for 10 minutes. Computed per hypervisor as usage / ((total - reserved) x allocation ratio) from the openstack_placement_resource_* series, filtered to resourcetype ${data.resourceType}. This is allocation, not load: an idle instance holds all of it. Check \`openstack hypervisor show <hypervisor>\`, then move instances away, raise the allocation ratio or add capacity.`,
    category: "Compute",
    severity: "Warning",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      const attributes: Record<string, string> = {
        resourcetype: data.resourceType,
      };

      return buildCeilingStep({
        args,
        service: OpenStackServiceType.Placement,
        groupByAttributeKeys: HYPERVISOR_GROUP,
        queries: [
          {
            alias: "allocated",
            metricName: "openstack_placement_resource_usage",
            aggregationType: MetricsAggregationType.Max,
            attributes,
          },
          {
            alias: "capacity",
            metricName: "openstack_placement_resource_total",
            aggregationType: MetricsAggregationType.Max,
            attributes,
          },
          {
            alias: "reserved",
            metricName: "openstack_placement_resource_reserved",
            aggregationType: MetricsAggregationType.Max,
            attributes,
          },
          {
            alias: "allocation_ratio",
            metricName: "openstack_placement_resource_allocation_ratio",
            aggregationType: MetricsAggregationType.Max,
            attributes,
          },
        ],
        formulas: [
          {
            alias: metricAlias,
            legend: `${data.name} (%)`,
            legendUnit: "%",
            formula:
              "(allocated / ((capacity - reserved) * allocation_ratio)) * 100",
          },
        ],
        aliases: [metricAlias],
        value: OPENSTACK_ALLOCATION_WARNING_PERCENT,
        words: {
          incidentTitle: `[OpenStack] ${data.name} (>${OPENSTACK_ALLOCATION_WARNING_PERCENT}%)`,
          incidentDescription: data.incidentDescription,
          criteriaName: `${data.name} - allocated > ${OPENSTACK_ALLOCATION_WARNING_PERCENT}%`,
          criteriaDescription: `Triggers when Placement has promised more than ${OPENSTACK_ALLOCATION_WARNING_PERCENT}% of a hypervisor's ${data.noun} for the whole window.`,
        },
      });
    },
  };
}

const vcpuAllocationHighTemplate: OpenStackAlertTemplate =
  buildAllocationTemplate({
    id: "openstack-vcpu-allocation-high",
    name: "vCPU Allocation High",
    resourceType: "VCPU",
    noun: "vCPUs",
    summary: `A hypervisor has promised more than ${OPENSTACK_ALLOCATION_WARNING_PERCENT}% of its vCPUs.`,
    incidentDescription: `Placement has promised nearly all the vCPUs this hypervisor will give, so new instances soon fail to land on it with No valid host. This is allocation, not load: an idle instance holds all of its vCPUs. Check openstack hypervisor show for the hypervisor named above, then move instances away, raise its CPU allocation ratio or add capacity. The incident resolves on its own once it falls back.`,
  });

const memoryAllocationHighTemplate: OpenStackAlertTemplate =
  buildAllocationTemplate({
    id: "openstack-memory-allocation-high",
    name: "Memory Allocation High",
    resourceType: "MEMORY_MB",
    noun: "memory",
    summary: `A hypervisor has promised more than ${OPENSTACK_ALLOCATION_WARNING_PERCENT}% of its memory.`,
    incidentDescription: `Placement has promised nearly all the memory this hypervisor will give, so new instances soon fail to land on it with No valid host. This is allocation, not usage: an instance holds its flavor's memory whether it uses it or not. Check openstack hypervisor show for the hypervisor named above, then move instances away, raise its memory allocation ratio or add capacity. The incident resolves on its own once it falls back.`,
  });

const localDiskAllocationHighTemplate: OpenStackAlertTemplate =
  buildAllocationTemplate({
    id: "openstack-local-disk-allocation-high",
    name: "Local Disk Allocation High",
    resourceType: "DISK_GB",
    noun: "local disk",
    summary: `A hypervisor has promised more than ${OPENSTACK_ALLOCATION_WARNING_PERCENT}% of its local disk.`,
    incidentDescription: `Placement has promised nearly all the local disk this hypervisor will give, so new instances soon fail to land on it with No valid host. This is allocation, not usage: an instance holds its flavor's disk whether it fills it or not. Check openstack hypervisor show for the hypervisor named above, then move instances away, raise its disk allocation ratio or add capacity. The incident resolves on its own once it falls back.`,
  });

/*
 * WHAT IS REALLY BUSY. Worked out at ingest from libvirt's or Ceilometer's exporter, so
 * they mean the same whichever a cloud has, and these never fire on a cloud with neither:
 * with no series there is nothing to compare, and the page says what to add.
 *
 * Fifteen minutes, because Ceilometer's readings change once a polling cycle, five minutes
 * by default, and a window has to hold three of them.
 */
const INSTANCE_USAGE_WINDOW: RollingTime = RollingTime.Past15Minutes;
const INSTANCE_USAGE_GROUP: Array<string> = [
  REGION,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
];
const INSTANCE_DISK_GROUP: Array<string> = [
  ...INSTANCE_USAGE_GROUP,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
];

const NEEDS_INSTANCE_SOURCE: string =
  "Needs libvirt's or Ceilometer's exporter to be read: without one it has nothing to compare, and stays quiet.";

const hypervisorCpuSaturatedTemplate: OpenStackAlertTemplate = {
  id: "openstack-hypervisor-cpu-saturated",
  name: "Hypervisor CPU Saturated",
  summary: `A hypervisor's instances use over ${OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT}% of its CPU for 15 minutes.`,
  description: `Alert when what a hypervisor's instances really use passes ${OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT}% of its CPU threads for 15 minutes, read from openstack.hypervisor.instances.cpu.utilization. That is worked out at ingest against the threads Placement says it has, before any allocation ratio. This is load, not allocation: instances that hold vCPUs and do nothing add nothing to it. The hypervisor's page names the instances responsible. ${NEEDS_INSTANCE_SOURCE} Check \`openstack server list --all-projects --host <hypervisor>\`, then live-migrate the busiest instance away or lower the CPU allocation ratio.`,
  category: "Compute",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cpu_percent";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      rollingTime: INSTANCE_USAGE_WINDOW,
      groupByAttributeKeys: HYPERVISOR_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: OpenStackHypervisorMetric.InstancesCpuUtilization,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: [metricAlias],
      value: OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
      words: {
        incidentTitle: `[OpenStack] Hypervisor CPU Saturated (>${OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT}%)`,
        incidentDescription: `The instances on this hypervisor are really using nearly all of its CPU, so they are waiting for each other and everything on it is slower than its flavor says. This is load rather than what Placement has promised. The hypervisor's page names the busiest instances and which of them are being made to wait. Check openstack server list --all-projects --host for the hypervisor named above, then live-migrate the busiest instance away. The incident resolves on its own once it falls back.`,
        criteriaName: `Hypervisor CPU Saturated - CPU > ${OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT}%`,
        criteriaDescription: `Triggers when a hypervisor's instances use more than ${OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT}% of its CPU threads for the whole window.`,
      },
    });
  },
};

const hypervisorMemoryPressureTemplate: OpenStackAlertTemplate = {
  id: "openstack-hypervisor-memory-pressure",
  name: "Hypervisor Memory Pressure",
  summary: `A hypervisor's instances hold over ${OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT}% of its memory for 15 minutes.`,
  description: `Alert when what a hypervisor's instances really hold passes ${OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT}% of its memory for 15 minutes, read from openstack.hypervisor.instances.memory.utilization. That is worked out at ingest against the memory Placement says it has, before any allocation ratio. This is memory in use, not memory promised, which is what Memory Allocation High reads. ${NEEDS_INSTANCE_SOURCE} Check \`openstack server list --all-projects --host <hypervisor>\`, then live-migrate an instance away before the kernel starts killing them.`,
  category: "Compute",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "memory_percent";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      rollingTime: INSTANCE_USAGE_WINDOW,
      groupByAttributeKeys: HYPERVISOR_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: OpenStackHypervisorMetric.InstancesMemoryUtilization,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: [metricAlias],
      value: OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
      words: {
        incidentTitle: `[OpenStack] Hypervisor Memory Pressure (>${OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT}%)`,
        incidentDescription: `The instances on this hypervisor really hold nearly all of its memory, which leaves little for the host and its services. Past this the kernel swaps or kills an instance to make room. Check openstack server list --all-projects --host for the hypervisor named above, then live-migrate an instance away, and look at its memory allocation ratio if this is how it is meant to run. The incident resolves on its own once it falls back.`,
        criteriaName: `Hypervisor Memory Pressure - held > ${OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT}%`,
        criteriaDescription: `Triggers when a hypervisor's instances hold more than ${OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT}% of its memory for the whole window.`,
      },
    });
  },
};

const instanceCpuSaturatedTemplate: OpenStackAlertTemplate = {
  id: "openstack-instance-cpu-saturated",
  name: "Instance CPU Saturated",
  summary: `An instance uses over ${OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT}% of its vCPUs for 15 minutes.`,
  description: `Alert when an instance uses more than ${OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT}% of its vCPUs for 15 minutes, read from openstack.instance.cpu.utilization. One incident per instance, and it names the project it belongs to, because this is usually the project's to act on. ${NEEDS_INSTANCE_SOURCE} Check \`openstack server show <instance>\` for its flavor, then resize it or look at what is running in it.`,
  category: "Compute",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "cpu_percent";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      rollingTime: INSTANCE_USAGE_WINDOW,
      groupByAttributeKeys: INSTANCE_USAGE_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: OpenStackInstanceMetric.CpuUtilization,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: [metricAlias],
      value: OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
      words: {
        incidentTitle: `[OpenStack] Instance CPU Saturated (>${OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT}%)`,
        incidentDescription: `This instance has been using all of its vCPUs for a quarter of an hour, so whatever runs in it is limited by its flavor. Check openstack server show for the instance named above for its flavor, then resize it, or look at what is running inside it. If its CPU Contention is high too, its hypervisor is what is short, and moving it helps more than resizing. The incident resolves on its own once it falls back.`,
        criteriaName: `Instance CPU Saturated - CPU > ${OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT}%`,
        criteriaDescription: `Triggers when an instance uses more than ${OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT}% of its vCPUs for the whole window.`,
      },
    });
  },
};

const instanceDiskLatencyHighTemplate: OpenStackAlertTemplate = {
  id: "openstack-instance-disk-latency-high",
  name: "Instance Disk Latency High",
  summary: `An instance's disk takes over ${OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS} ms per request for 15 minutes.`,
  description: `Alert when reads or writes on one of an instance's disks take more than ${OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS} ms on average for 15 minutes, read from openstack.instance.disk.read.latency and openstack.instance.disk.write.latency. A disk with no requests has no latency, so an idle disk never fires this. ${NEEDS_INSTANCE_SOURCE} Check \`openstack server show <instance>\` for its volumes, then the storage pool and backend behind them.`,
  category: "Compute",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      rollingTime: INSTANCE_USAGE_WINDOW,
      groupByAttributeKeys: INSTANCE_DISK_GROUP,
      queries: [
        {
          alias: "read_latency_ms",
          metricName: OpenStackInstanceMetric.DiskReadLatency,
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "write_latency_ms",
          metricName: OpenStackInstanceMetric.DiskWriteLatency,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: ["read_latency_ms", "write_latency_ms"],
      value: OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
      words: {
        incidentTitle: `[OpenStack] Instance Disk Latency High (>${OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS} ms)`,
        incidentDescription: `Reads or writes on this instance's disk have been slow for a quarter of an hour, which its users feel as a slow application however idle its CPU looks. Check openstack server show for the instance named above for its volumes, then the storage pool and the backend behind them, and whether Ceph or the array under it is degraded. The incident resolves on its own once it falls back, or once the disk stops being used.`,
        criteriaName: `Instance Disk Latency High - latency > ${OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS} ms`,
        criteriaDescription: `Triggers when an instance's disk takes more than ${OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS} ms per read or write for the whole window.`,
      },
    });
  },
};

const instancesInErrorTemplate: OpenStackAlertTemplate = {
  id: "openstack-instances-in-error",
  name: "Instances in Error",
  summary: "An instance in a region is in ERROR.",
  description:
    "Alert when any instance in a region stays in ERROR for 10 minutes (openstack_nova_server_status filtered to the status label ERROR: its value is a code, so a Count of its rows says how many). One incident per region rather than per instance, because a failed boot is often a project's own and one cloud can hold many. Check `openstack server list --all-projects --status ERROR`, then `openstack server show` for the fault Nova recorded on each.",
  category: "Compute",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "instances_in_error";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      groupByAttributeKeys: [REGION, "status"],
      queries: [
        {
          alias: metricAlias,
          metricName: "openstack_nova_server_status",
          /*
           * One row per instance per collection, and a collection takes at least
           * 2 minutes, so a one-minute bucket's Count is how many instances. And
           * it only has to tell none from some.
           */
          aggregationType: MetricsAggregationType.Count,
          attributes: { status: "ERROR" },
        },
      ],
      aliases: [metricAlias],
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Instances in Error",
        incidentDescription: `One or more instances in this region are in ERROR. Check openstack server list --all-projects --status ERROR, then openstack server show for the fault Nova recorded on each: No valid host means the scheduler found no room, and anything else usually names the host or the service that failed. An instance in ERROR holds no resources it can use, so delete or rebuild it once you know why. The incident resolves on its own once none is left.`,
        criteriaName: "Instances in Error - count > 0",
        criteriaDescription:
          "Triggers when a region holds an instance in ERROR for the whole window.",
      },
    });
  },
};

/*
 * An instance that has held one status word for the whole window. Each word is its
 * own query, because a monitor's attribute filter is equality, and per instance,
 * because grouped by region a busy cloud's steady stream of builds would read as
 * one instance stuck for ever.
 */
function buildInstanceStuckTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  statuses: Array<string>;
  incidentDescription: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Compute",
    severity: "Warning",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      const queries: Array<OpenStackQuery> = data.statuses.map(
        (status: string): OpenStackQuery => {
          return {
            alias: statusAlias(status),
            metricName: "openstack_nova_server_status",
            /*
             * The value is the status's code, none of them 0 for these words, so
             * it says the row is there rather than how much of anything.
             */
            aggregationType: MetricsAggregationType.Max,
            attributes: { status },
          };
        },
      );

      return buildCeilingStep({
        args,
        service: OpenStackServiceType.Compute,
        rollingTime: windowHolding(OPENSTACK_INSTANCE_STUCK_MINUTES),
        groupByAttributeKeys: INSTANCE_GROUP,
        queries,
        aliases: queries.map((query: OpenStackQuery): string => {
          return query.alias;
        }),
        value: 0,
        words: {
          incidentTitle: `[OpenStack] ${data.name}`,
          incidentDescription: data.incidentDescription,
          criteriaName: `${data.name} - same status for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes`,
          criteriaDescription: `Triggers when an instance holds the status for the whole ${OPENSTACK_INSTANCE_STUCK_MINUTES}-minute window.`,
        },
      });
    },
  };
}

const INSTANCE_BUILD_STATUSES: Array<string> = ["BUILD", "BUILD(spawning)"];
const INSTANCE_VERIFY_RESIZE_STATUSES: Array<string> = ["VERIFY_RESIZE"];

/*
 * Every other word the health rules call on the way to something else, read from
 * the set: a word added there is watched here, as it is on the pages.
 */
const INSTANCE_TRANSITIONING_STATUSES: Array<string> = Array.from(
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
).filter((status: string): boolean => {
  return (
    !INSTANCE_BUILD_STATUSES.includes(status) &&
    !INSTANCE_VERIFY_RESIZE_STATUSES.includes(status)
  );
});

const instanceStuckBuildingTemplate: OpenStackAlertTemplate =
  buildInstanceStuckTemplate({
    id: "openstack-instance-stuck-building",
    name: "Instance Stuck Building",
    statuses: INSTANCE_BUILD_STATUSES,
    summary: `An instance stays in BUILD for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes.`,
    description: `Alert when an instance stays in BUILD for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes (openstack_nova_server_status filtered to that status label, in every collection of the window). One incident per instance. A build normally takes seconds to minutes, so this one is waiting on something. Check \`openstack server show <instance>\` and \`openstack server event list <instance>\`, then nova-compute's log on its host.`,
    incidentDescription: `This instance has been in BUILD for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes, when a build normally takes seconds to minutes. It is usually waiting on an image download, a port Neutron cannot bind, a volume, or a nova-compute that has gone quiet. Check openstack server show and openstack server event list for the instance named above, then nova-compute's log on its host. The incident resolves on its own once it leaves BUILD or is deleted.`,
  });

const instanceStuckTransitioningTemplate: OpenStackAlertTemplate =
  buildInstanceStuckTemplate({
    id: "openstack-instance-stuck-transitioning",
    name: "Instance Stuck Transitioning",
    statuses: INSTANCE_TRANSITIONING_STATUSES,
    summary: `An instance stays resizing, migrating or rebooting for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes.`,
    description: `Alert when an instance stays in one of ${INSTANCE_TRANSITIONING_STATUSES.join(", ")} for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes (openstack_nova_server_status filtered to that status label, in every collection of the window). One incident per instance. Check \`openstack server show <instance>\` and \`openstack server event list <instance>\`, then nova-compute's log on its host. A large live migration can honestly take this long: \`openstack server migration list --server <instance>\` says how far it has got.`,
    incidentDescription: `This instance has held one status on the way to another for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes. Most of these finish in minutes, though a large live migration can honestly take this long. Check openstack server show and openstack server event list for the instance named above, then nova-compute's log on its host. If nothing is running any more, openstack server set --state active is the usual way out, once you know why it stopped. The incident resolves on its own once it reaches its next status.`,
  });

const instanceStuckInVerifyResizeTemplate: OpenStackAlertTemplate =
  buildInstanceStuckTemplate({
    id: "openstack-instance-stuck-in-verify-resize",
    name: "Instance Stuck in Verify Resize",
    statuses: INSTANCE_VERIFY_RESIZE_STATUSES,
    summary: `A resized instance waits for confirmation for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes.`,
    description: `Alert when an instance stays in VERIFY_RESIZE for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes (openstack_nova_server_status filtered to that status label, in every collection of the window). One incident per instance. Nova is waiting for someone to confirm or revert, and holds the resources of both the old and new size until then. Check with its owner, then run \`openstack server resize confirm <instance>\` or \`openstack server resize revert <instance>\`.`,
    incidentDescription: `This instance has finished resizing and is waiting for someone to confirm or revert it, and has been for ${OPENSTACK_INSTANCE_STUCK_MINUTES} minutes. Nova holds the resources of both its old and its new size until then. Check with its owner, then run openstack server resize confirm or openstack server resize revert for the instance named above. The incident resolves on its own once it is confirmed or reverted.`,
  });

// --- Network ---

const routerNotActiveTemplate: OpenStackAlertTemplate = {
  id: "openstack-router-not-active",
  name: "Router Not Active",
  summary: "A router's status is not ACTIVE.",
  description:
    "Alert when a region holds a router whose status is not ACTIVE for 10 minutes (openstack_neutron_routers_not_active above 0). One incident per region, because the exporter only counts them. Check `openstack router list --long`, then `openstack router show` on each one that is not ACTIVE, and the L3 agents or OVN behind it.",
  category: "Network",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "routers_not_active";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Network,
      groupByAttributeKeys: API_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: "openstack_neutron_routers_not_active",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: [metricAlias],
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Router Not Active",
        incidentDescription: `A router in this region has a status other than ACTIVE, so the networks behind it may have lost their way out. Check openstack router list --long, then openstack router show on each one that is not ACTIVE, and the L3 agents or OVN behind it. The incident resolves on its own once every router is ACTIVE.`,
        criteriaName: "Router Not Active - count > 0",
        criteriaDescription:
          "Triggers when a region holds a router that is not ACTIVE for the whole window.",
      },
    });
  },
};

const floatingIpNotActiveTemplate: OpenStackAlertTemplate = {
  id: "openstack-floating-ip-not-active",
  name: "Floating IP Not Active",
  summary: "A floating IP in use is not ACTIVE.",
  description:
    "Alert when a region holds a floating IP that is attached to something and not ACTIVE, for 10 minutes (openstack_neutron_floating_ips_associated_not_active above 0). A spare one is meant to be down, and does not count. One incident per region, because the exporter only counts them. Check `openstack floating ip list --long`, then the router it goes through and the L3 agents or OVN behind that.",
  category: "Network",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "floating_ips_not_active";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Network,
      groupByAttributeKeys: API_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: "openstack_neutron_floating_ips_associated_not_active",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      aliases: [metricAlias],
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Floating IP Not Active",
        incidentDescription: `A floating IP in this region is attached to something and is not ACTIVE, so that instance cannot be reached from outside on it. Check openstack floating ip list --long for the ones that are not ACTIVE, then the router each goes through, and the L3 agents or OVN behind that. The incident resolves on its own once every one in use is ACTIVE.`,
        criteriaName: "Floating IP Not Active - count > 0",
        criteriaDescription:
          "Triggers when a region holds a floating IP in use that is not ACTIVE for the whole window.",
      },
    });
  },
};

/*
 * How full an external network is. Only the networks people depend on drawing from
 * count, as on the pages: a tenant's own small network filling up is theirs to see.
 *
 * Whether a network is external is only on `openstack_neutron_network`, so that is
 * read beside the address series, and the worker lines the two up on network_id
 * (getOpenStackGroupByKeysForMetric). Its value is a status code, 0 for ACTIVE, so
 * a Count says the row is there.
 *
 * Avg over Avg is the network's total, not a Sum: the Avgs of its subnets divide to
 * the same share as their totals, whatever a bucket holds. And IPv4 alone, because
 * a /64 is 2^64 addresses, so with one beside it a full IPv4 pool reads as 0%.
 */
function buildExternalPoolStep(data: {
  args: OpenStackAlertTemplateArgs;
  filterType: FilterType;
  value: number;
  words: IncidentWords;
}): MonitorStep {
  const metricAlias: string = "addresses_used_percent";
  const externalAlias: string = "is_external_network";
  const attributes: Record<string, string> = { ip_version: "4" };

  return buildOpenStackMonitorStep({
    openstackMonitor: buildOpenStackSeriesConfig({
      cloudIdentifier: data.args.cloudIdentifier,
      queries: [
        {
          alias: "addresses_used",
          metricName: "openstack_neutron_network_ip_availabilities_used",
          aggregationType: MetricsAggregationType.Avg,
          attributes,
        },
        {
          alias: "addresses_total",
          metricName: "openstack_neutron_network_ip_availabilities_total",
          aggregationType: MetricsAggregationType.Avg,
          attributes,
        },
        {
          alias: externalAlias,
          metricName: "openstack_neutron_network",
          aggregationType: MetricsAggregationType.Count,
          attributes: { is_external: "true" },
        },
      ],
      formulas: [
        {
          alias: metricAlias,
          legend: "IPv4 Addresses Used (%)",
          legendUnit: "%",
          formula: "(addresses_used / addresses_total) * 100",
        },
      ],
      rollingTime: OPENSTACK_WINDOW_BY_SERVICE[OpenStackServiceType.Network],
      groupByAttributeKeys: NETWORK_GROUP,
      anchorService: OpenStackServiceType.Network,
    }),
    offlineCriteriaInstance: buildOfflineCriteria({
      notification: { args: data.args, ...data.words },
      metricAlias,
      filterType: data.filterType,
      value: data.value,
      // Both on one series: this network is external, and this full.
      filterCondition: FilterCondition.All,
      additionalFilters: [
        {
          metricAlias: externalAlias,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    }),
    onlineCriteriaInstance: buildHealthyCriteriaInstance({
      onlineMonitorStatusId: data.args.onlineMonitorStatusId,
      metricAlias,
      filterType:
        data.filterType === FilterType.GreaterThanOrEqualTo
          ? FilterType.LessThan
          : FilterType.LessThanOrEqualTo,
      value: data.value,
      treatNoDataAsZero: true,
      /*
       * Any: a tenant's network reads as fine here however full it is, and a
       * network that stopped being external stops being this monitor's business.
       */
      additionalFilters: [
        {
          metricAlias: externalAlias,
          filterType: FilterType.EqualTo,
          value: 0,
        },
      ],
    }),
  });
}

const externalIpPoolNearlyFullTemplate: OpenStackAlertTemplate = {
  id: "openstack-external-ip-pool-nearly-full",
  name: "External IP Pool Nearly Full",
  summary: `An external network has used more than ${OPENSTACK_IP_POOL_WARNING_PERCENT}% of its addresses.`,
  description: `Alert when an external network has used more than ${OPENSTACK_IP_POOL_WARNING_PERCENT}% of its IPv4 addresses for 10 minutes (openstack_neutron_network_ip_availabilities_used / _total, read beside is_external on openstack_neutron_network). One incident per network. Tenant networks never fire: they are theirs to see. Check \`openstack ip availability show <network>\` and \`openstack floating ip list --network <network>\` for spare floating IPs to release, then add a subnet.`,
  category: "Network",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildExternalPoolStep({
      args,
      filterType: FilterType.GreaterThan,
      value: OPENSTACK_IP_POOL_WARNING_PERCENT,
      words: {
        incidentTitle: `[OpenStack] External IP Pool Nearly Full (>${OPENSTACK_IP_POOL_WARNING_PERCENT}%)`,
        incidentDescription: `This external network has used nearly all its IPv4 addresses, so floating IPs and router gateways will soon stop being given out. Check openstack ip availability show for the network named above and openstack floating ip list --network for spare floating IPs to release, then add a subnet. The incident resolves on its own once it falls back.`,
        criteriaName: `External IP Pool - used > ${OPENSTACK_IP_POOL_WARNING_PERCENT}%`,
        criteriaDescription: `Triggers when an external network has used more than ${OPENSTACK_IP_POOL_WARNING_PERCENT}% of its IPv4 addresses for the whole window.`,
      },
    });
  },
};

const networkOutOfIpsTemplate: OpenStackAlertTemplate = {
  id: "openstack-network-out-of-ips",
  name: "Network Out of IPs",
  summary: "An external network has no addresses left.",
  description: `Alert when an external network has given out every IPv4 address it has, for 10 minutes (openstack_neutron_network_ip_availabilities_used / _total at ${OPENSTACK_IP_POOL_EXHAUSTED_PERCENT}%, read beside is_external on openstack_neutron_network). One incident per network. No new floating IP or router gateway can come from it. Tenant networks never fire: they are theirs to see. Check \`openstack ip availability show <network>\` and \`openstack floating ip list --network <network>\` for spare floating IPs to release, then add a subnet.`,
  category: "Network",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildExternalPoolStep({
      args,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
      words: {
        incidentTitle: "[OpenStack] Network Out of IPs",
        incidentDescription: `This external network has given out every IPv4 address it has, so no new floating IP or router gateway can come from it. Check openstack ip availability show for the network named above and openstack floating ip list --network for spare floating IPs to release, then add a subnet. The incident resolves on its own once it has room again.`,
        criteriaName: "Network Out of IPs - no addresses left",
        criteriaDescription:
          "Triggers when an external network has no IPv4 addresses left for the whole window.",
      },
    });
  },
};

const L3_AGENT_OF_ROUTER: string = "openstack_neutron_l3_agent_of_router";

const routerWithoutActiveAgentTemplate: OpenStackAlertTemplate = {
  id: "openstack-router-without-active-agent",
  name: "Router Without Active Agent",
  summary: "No alive L3 agent holds a router.",
  description:
    "Alert when no L3 agent set up that holds a router is alive, for 10 minutes (the Max of openstack_neutron_l3_agent_of_router by router reads below 1, filtered to agent_admin_up true). One incident per router. Its traffic has no way out. A cloud on OVN has no such agents, so this stays quiet there. Check `openstack network agent list --router <router> --long`, then the L3 agents' services and logs.",
  category: "Network",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Network,
      groupByAttributeKeys: ROUTER_GROUP,
      queries: [
        {
          alias: "agent_alive",
          metricName: L3_AGENT_OF_ROUTER,
          // Max across its agents: 1 while any one of them is alive.
          aggregationType: MetricsAggregationType.Max,
          attributes: { agent_admin_up: "true" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Router Without Active Agent",
        incidentDescription: `No L3 agent holding this router is alive, so the networks behind it have no way out. Check openstack network agent list --router for the router named above, then the L3 agents' services and logs on those hosts. openstack network agent add router moves it to an agent that is alive, if none of them will come back. The incident resolves on its own once an agent is alive again.`,
        criteriaName: "Router Without Active Agent - none alive",
        criteriaDescription:
          "Triggers when no alive L3 agent holds a router for the whole window.",
      },
    });
  },
};

const routerWithTwoActiveAgentsTemplate: OpenStackAlertTemplate = {
  id: "openstack-router-with-two-active-agents",
  name: "Router With Two Active Agents",
  summary: "Two L3 agents are both active for one router.",
  description:
    "Alert when two alive L3 agents both say they are active for one router, for 10 minutes (a Count of openstack_neutron_l3_agent_of_router filtered to ha_state active, agent_alive true and agent_admin_up true, above 1). One incident per router. A split brain: both answer for its addresses, and its traffic resets and drops. A cloud on OVN has no such agents, so this stays quiet there. Check `openstack network agent list --router <router> --long`, then keepalived and the HA network between those hosts.",
  category: "Network",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "active_agents";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Network,
      groupByAttributeKeys: ROUTER_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: L3_AGENT_OF_ROUTER,
          /*
           * One row per agent per collection, and the network job takes at least
           * 2 minutes (a test holds the agent to that), so a one-minute bucket's
           * Count is how many agents.
           */
          aggregationType: MetricsAggregationType.Count,
          attributes: {
            ha_state: "active",
            agent_alive: "true",
            agent_admin_up: "true",
          },
        },
      ],
      aliases: [metricAlias],
      value: OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
      // A count recovers at the line: a dead band below 1 would never be reached.
      recoveryValue: OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
      words: {
        incidentTitle: "[OpenStack] Router With Two Active Agents",
        incidentDescription: `Two alive L3 agents both say they are active for this router. That is a split brain: both answer for its addresses, so its traffic resets and drops. Check openstack network agent list --router for the router named above, then keepalived and the HA network between those hosts. The incident resolves on its own once only one is active.`,
        criteriaName: "Router With Two Active Agents - active agents > 1",
        criteriaDescription:
          "Triggers when more than one alive L3 agent is active for a router for the whole window.",
      },
    });
  },
};

// --- Storage ---

function buildStoragePoolTemplate(data: {
  id: string;
  name: string;
  severity: OpenStackAlertTemplateSeverity;
  value: number;
  incidentDescription: string;
}): OpenStackAlertTemplate {
  const metricAlias: string = "pool_used_percent";

  return {
    id: data.id,
    name: data.name,
    summary: `A storage pool is more than ${data.value}% full.`,
    description: `Alert when a Cinder storage pool is more than ${data.value}% full for 10 minutes. Computed per pool as (total - free) / total from openstack_cinder_pool_capacity_total_gb and _free_gb, as the backend reports them. One incident per pool. Check \`openstack volume backend pool list --long\`, then delete what is no longer used, or add capacity.`,
    category: "Storage",
    severity: data.severity,
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildCeilingStep({
        args,
        service: OpenStackServiceType.Volume,
        groupByAttributeKeys: STORAGE_POOL_GROUP,
        queries: [
          {
            alias: "pool_total",
            metricName: "openstack_cinder_pool_capacity_total_gb",
            aggregationType: MetricsAggregationType.Max,
          },
          {
            alias: "pool_free",
            metricName: "openstack_cinder_pool_capacity_free_gb",
            aggregationType: MetricsAggregationType.Min,
          },
        ],
        formulas: [
          {
            alias: metricAlias,
            legend: "Storage Pool Used (%)",
            legendUnit: "%",
            formula: "((pool_total - pool_free) / pool_total) * 100",
          },
        ],
        aliases: [metricAlias],
        value: data.value,
        words: {
          incidentTitle: `[OpenStack] ${data.name} (>${data.value}%)`,
          incidentDescription: data.incidentDescription,
          criteriaName: `${data.name} - used > ${data.value}%`,
          criteriaDescription: `Triggers when a storage pool is more than ${data.value}% full for the whole window.`,
        },
      });
    },
  };
}

const storagePoolWarningTemplate: OpenStackAlertTemplate =
  buildStoragePoolTemplate({
    id: "openstack-storage-pool-warning",
    name: "Storage Pool Warning",
    severity: "Warning",
    value: OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
    incidentDescription: `This Cinder storage pool is filling up. New volumes start failing with No valid backend before it is actually full, because Cinder keeps some back. Check openstack volume backend pool list --long, then delete what is no longer used or add capacity. The incident resolves on its own once it falls back.`,
  });

const storagePoolCriticalTemplate: OpenStackAlertTemplate =
  buildStoragePoolTemplate({
    id: "openstack-storage-pool-critical",
    name: "Storage Pool Critical",
    severity: "Critical",
    value: OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
    incidentDescription: `This Cinder storage pool is nearly full. New volumes and snapshots are failing or about to, and on a thin-provisioned backend writes to existing volumes can fail too. Check openstack volume backend pool list --long, then delete what is no longer used or add capacity now. The incident resolves on its own once it falls back.`,
  });

const volumesInErrorTemplate: OpenStackAlertTemplate = {
  id: "openstack-volumes-in-error",
  name: "Volumes in Error",
  summary: "A volume in a region is in an error state.",
  description: `Alert when a region holds a volume in an error state for 10 minutes (openstack_cinder_volume_status_counter above 0, for each of ${Array.from(OPENSTACK_VOLUME_ERROR_STATUSES).join(", ")}). One incident per region and status word, so one cloud's many volumes make few incidents. Check \`openstack volume list --all-projects --status <status>\`, then \`openstack volume show\` and cinder-volume's log on its backend.`,
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = Array.from(
      OPENSTACK_VOLUME_ERROR_STATUSES,
    ).map((status: string): OpenStackQuery => {
      return {
        alias: statusAlias(status),
        metricName: "openstack_cinder_volume_status_counter",
        aggregationType: MetricsAggregationType.Max,
        attributes: { status },
      };
    });

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Volume,
      groupByAttributeKeys: [REGION, "status"],
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Volumes in Error",
        incidentDescription: `One or more volumes in this region are in the error state named above. Check openstack volume list --all-projects --status for that state, then openstack volume show on each and cinder-volume's log on its backend. openstack volume set --state available is the usual way out once you know the volume is sound. The incident resolves on its own once none is left.`,
        criteriaName: "Volumes in Error - count > 0",
        criteriaDescription:
          "Triggers when a region holds a volume in an error state for the whole window.",
      },
    });
  },
};

/*
 * Per volume, read from its own series, rather than from the status counter the
 * issue names. The counter cannot tell one volume stuck for half an hour from a
 * steady stream of them each passing through `creating`, and cannot name it. Each
 * status word is its own query, as for instances.
 */
const volumeStuckTemplate: OpenStackAlertTemplate = {
  id: "openstack-volume-stuck",
  name: "Volume Stuck",
  summary: `A volume stays in a passing state for ${OPENSTACK_VOLUME_STUCK_MINUTES} minutes.`,
  description: `Alert when a volume stays in one of ${Array.from(OPENSTACK_VOLUME_TRANSITIONAL_STATUSES).join(", ")} for ${OPENSTACK_VOLUME_STUCK_MINUTES} minutes (openstack_cinder_volume_gb filtered to that status label, in every collection of the window). One incident per volume. Check \`openstack volume show <volume>\`, then cinder-volume's log on its backend. A large copy can honestly take this long.`,
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = Array.from(
      OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
    ).map((status: string): OpenStackQuery => {
      return {
        alias: statusAlias(status),
        metricName: "openstack_cinder_volume_gb",
        // Its value is its size, never 0: it says the row is there.
        aggregationType: MetricsAggregationType.Max,
        attributes: { status },
      };
    });

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Volume,
      rollingTime: windowHolding(OPENSTACK_VOLUME_STUCK_MINUTES),
      groupByAttributeKeys: VOLUME_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Volume Stuck",
        incidentDescription: `This volume has held one status on the way to another for ${OPENSTACK_VOLUME_STUCK_MINUTES} minutes. A large copy can honestly take this long, but it is usually waiting on a cinder-volume that has gone quiet, or a backend that stopped answering. Check openstack volume show for the volume named above, then cinder-volume's log on its backend. openstack volume set --state is the way out once you know nothing is still working on it. The incident resolves on its own once it reaches its next status.`,
        criteriaName: `Volume Stuck - same status for ${OPENSTACK_VOLUME_STUCK_MINUTES} minutes`,
        criteriaDescription: `Triggers when a volume holds the status for the whole ${OPENSTACK_VOLUME_STUCK_MINUTES}-minute window.`,
      },
    });
  },
};

// --- Projects ---

const projectQuotaNearlyReachedTemplate: OpenStackAlertTemplate = {
  id: "openstack-project-quota-nearly-reached",
  name: "Project Quota Nearly Reached",
  summary: `A project has used ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}% or more of a quota.`,
  description: `Alert when a project has used ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}% or more of its vCPU, memory, instance or volume quota for 10 minutes (openstack_nova_limits_* and openstack_cinder_limits_volume_*, used / max per project). One incident per project, and a project with no limit never fires. These series are off by default, because they read the API once per project on every collection, so this template stays quiet until you turn them on: delete the --disable-metric=nova-limits_vcpus_max and --disable-metric=cinder-limits_volume_max_gb lines from the exporter's command in docker-compose.yml, or from ExecStart in oneuptime-openstack-exporter.service without Docker, and restart the exporter. Check \`openstack limits show --absolute --project <project>\`, then raise the quota or ask its owner to free some.`,
  category: "Projects",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const percent: (data: {
      used: string;
      limit: string;
      alias: string;
      legend: string;
    }) => OpenStackFormula = (data: {
      used: string;
      limit: string;
      alias: string;
      legend: string;
    }): OpenStackFormula => {
      return {
        alias: data.alias,
        legend: data.legend,
        legendUnit: "%",
        formula: `(${data.used} / ${data.limit}) * 100`,
      };
    };

    const limit: (alias: string, metricName: string) => OpenStackQuery = (
      alias: string,
      metricName: string,
    ): OpenStackQuery => {
      return {
        alias,
        metricName,
        aggregationType: MetricsAggregationType.Max,
      };
    };

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      groupByAttributeKeys: PROJECT_GROUP,
      queries: [
        limit("vcpus_used", "openstack_nova_limits_vcpus_used"),
        limit("vcpus_limit", "openstack_nova_limits_vcpus_max"),
        limit("memory_used", "openstack_nova_limits_memory_used"),
        limit("memory_limit", "openstack_nova_limits_memory_max"),
        limit("instances_used", "openstack_nova_limits_instances_used"),
        limit("instances_limit", "openstack_nova_limits_instances_max"),
        limit("volume_gb_used", "openstack_cinder_limits_volume_used_gb"),
        limit("volume_gb_limit", "openstack_cinder_limits_volume_max_gb"),
      ],
      formulas: [
        percent({
          alias: "vcpus_used_percent",
          legend: "vCPU Quota Used (%)",
          used: "vcpus_used",
          limit: "vcpus_limit",
        }),
        percent({
          alias: "memory_used_percent",
          legend: "Memory Quota Used (%)",
          used: "memory_used",
          limit: "memory_limit",
        }),
        percent({
          alias: "instances_used_percent",
          legend: "Instance Quota Used (%)",
          used: "instances_used",
          limit: "instances_limit",
        }),
        percent({
          alias: "volume_gb_used_percent",
          legend: "Volume Quota Used (%)",
          used: "volume_gb_used",
          limit: "volume_gb_limit",
        }),
      ],
      aliases: [
        "vcpus_used_percent",
        "memory_used_percent",
        "instances_used_percent",
        "volume_gb_used_percent",
      ],
      // At the line, as Needs attention reads it: isOpenStackQuotaAtLine.
      filterType: FilterType.GreaterThanOrEqualTo,
      value: OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
      words: {
        incidentTitle: `[OpenStack] Project Quota Nearly Reached (>=${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}%)`,
        incidentDescription: `This project has used nearly all of a quota, so its next instance or volume is about to be refused. Check openstack limits show --absolute --project for the project named above, then raise the quota or ask its owner to free some. The incident resolves on its own once it falls back.`,
        criteriaName: `Project Quota - used >= ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}%`,
        criteriaDescription: `Triggers when a project has used ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}% or more of a quota for the whole window.`,
      },
    });
  },
};

export function getAllOpenStackAlertTemplates(): Array<OpenStackAlertTemplate> {
  return [
    cloudStoppedReportingTemplate,
    identityApiDownTemplate,
    computeApiDownTemplate,
    networkApiDownTemplate,
    blockStorageApiDownTemplate,
    imageApiDownTemplate,
    placementApiDownTemplate,
    computeServiceDownTemplate,
    schedulerOrConductorDownTemplate,
    everySchedulerOrConductorDownTemplate,
    networkAgentDownTemplate,
    blockStorageServiceDownTemplate,
    vcpuAllocationHighTemplate,
    memoryAllocationHighTemplate,
    localDiskAllocationHighTemplate,
    hypervisorCpuSaturatedTemplate,
    hypervisorMemoryPressureTemplate,
    instanceCpuSaturatedTemplate,
    instanceDiskLatencyHighTemplate,
    instancesInErrorTemplate,
    instanceStuckBuildingTemplate,
    instanceStuckTransitioningTemplate,
    instanceStuckInVerifyResizeTemplate,
    routerNotActiveTemplate,
    floatingIpNotActiveTemplate,
    externalIpPoolNearlyFullTemplate,
    networkOutOfIpsTemplate,
    routerWithoutActiveAgentTemplate,
    routerWithTwoActiveAgentsTemplate,
    storagePoolWarningTemplate,
    storagePoolCriticalTemplate,
    volumesInErrorTemplate,
    volumeStuckTemplate,
    projectQuotaNearlyReachedTemplate,
  ];
}

export function getOpenStackAlertTemplatesByCategory(
  category: OpenStackAlertTemplateCategory,
): Array<OpenStackAlertTemplate> {
  return getAllOpenStackAlertTemplates().filter(
    (template: OpenStackAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getOpenStackAlertTemplateById(
  id: string,
): OpenStackAlertTemplate | undefined {
  return getAllOpenStackAlertTemplates().find(
    (template: OpenStackAlertTemplate) => {
      return template.id === id;
    },
  );
}

/*
 * The template a NEW OpenStack monitor starts on: the cloud going silent. It is the
 * one template that still speaks when every other one has stopped being evaluated,
 * and it has no threshold to tune.
 */
export function getOpenStackDefaultAlertTemplateId(): string {
  return cloudStoppedReportingTemplate.id;
}
