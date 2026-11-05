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
  OPENSTACK_CERTIFICATE_EXPIRY_CRITICAL_DAYS,
  OPENSTACK_CERTIFICATE_EXPIRY_WARNING_DAYS,
  OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
  OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
  OPENSTACK_BARE_METAL_STUCK_MINUTES,
  OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
  OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS,
  OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
  OPENSTACK_STACK_STUCK_MINUTES,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES,
  OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
  OPENSTACK_SHARE_STUCK_MINUTES,
  OPENSTACK_VOLUME_STUCK_MINUTES,
} from "../OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
  OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
  OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
  OPENSTACK_CAPACITY_NAME_LABEL,
  OPENSTACK_CAPACITY_RESOURCE_LABEL,
  OPENSTACK_CAPACITY_SCOPE_LABEL,
} from "../OpenStack/OpenStackCapacitySeries";
import {
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
} from "../OpenStack/OpenStackInstanceMetrics";
import { getAllOpenStackControlPlaneAlertTemplates } from "./OpenStackControlPlaneAlertTemplates";
import {
  OpenStackCheckReportKind,
  OpenStackLifecyclePhase,
  OpenStackLifecycleStep,
} from "../OpenStack/OpenStackCheck";
import { OpenStackCheckMetric } from "../../Utils/OpenStack/OpenStackCheckMetrics";
import {
  OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_STACK_FAILED_STATUSES,
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
  OPENSTACK_DATABASE_INSTANCE_ERROR_STATUSES,
  OPENSTACK_DATABASE_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_SHARE_ERROR_STATUSES,
  OPENSTACK_SHARE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackServiceType,
} from "../OpenStack/OpenStackResourceKind";
import { isOpenStackOptionalService } from "../OpenStack/OpenStackOptionalServices";

export type OpenStackAlertTemplateCategory =
  | "Availability"
  | "Control Plane"
  | "RabbitMQ"
  | "MariaDB and Galera"
  | "Memcached"
  | "HAProxy"
  | "OVN and Open vSwitch"
  | "libvirt"
  | "Compute"
  | "Network"
  | "Storage"
  | "Orchestration"
  | "Bare Metal"
  | "Databases"
  | "Projects"
  | "Capacity";

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
  /*
   * The service a cloud may not run that this is about. Only a cloud reporting that service is
   * offered it, so a cloud without Ironic has no bare metal alert to dismiss: see
   * getOpenStackRecommendations. Left out of what every cloud runs.
   */
  forService?: OpenStackServiceType | undefined;
  /*
   * Reads a series only a native read of an API sends: the exporter has no such thing, so on a cloud
   * the agent collects this could never fire either (OpenStackMetricCatalog's onlyFromProbe).
   */
  requiresProbe?: boolean | undefined;
  /*
   * Reads what a check from outside reports. With that check off nothing sends its series, so on
   * such a cloud this could never fire either.
   */
  requiresCheck?: OpenStackCheckReportKind | undefined;
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
 *     empty collection as down; a silent cloud is Cloud Stopped Reporting. A service a
 *     cloud may not run has no such read at all: Bare Metal API Down has what it says.
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
const IMAGE_GROUP: Array<string> = [REGION, "id", "name"];
const STACK_GROUP: Array<string> = [REGION, "id", "name"];
const CONTAINER_CLUSTER_GROUP: Array<string> = [REGION, "uuid", "name"];
const STORAGE_POOL_GROUP: Array<string> = [
  REGION,
  "name",
  "volume_backend_name",
];
const ROUTER_GROUP: Array<string> = [REGION, "router_id"];
const NETWORK_GROUP: Array<string> = [REGION, "network_id", "network_name"];
const PROJECT_GROUP: Array<string> = [REGION, "tenant_id", "tenant"];
// A node's id is what it is, and its name what a person calls it, which Ironic does not require.
const BARE_METAL_NODE_GROUP: Array<string> = [REGION, "id", "name"];
const SHARE_GROUP: Array<string> = [REGION, "id", "name"];
const DATABASE_INSTANCE_GROUP: Array<string> = [REGION, "id", "name"];

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
  // The agent asks about the services a cloud may not run every five minutes.
  [OpenStackServiceType.Orchestration]: RollingTime.Past15Minutes,
  [OpenStackServiceType.ContainerInfra]: RollingTime.Past15Minutes,
  [OpenStackServiceType.Rating]: RollingTime.Past15Minutes,
  [OpenStackServiceType.BareMetal]: RollingTime.Past15Minutes,
  [OpenStackServiceType.SharedFileSystems]: RollingTime.Past15Minutes,
  [OpenStackServiceType.Database]: RollingTime.Past15Minutes,
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
  [OpenStackServiceType.Orchestration]: "openstack_heat_up",
  [OpenStackServiceType.ContainerInfra]: "openstack_container_infra_up",
  [OpenStackServiceType.Rating]: "openstack_cloudkitty_up",
  [OpenStackServiceType.BareMetal]: "openstack_ironic_up",
  [OpenStackServiceType.SharedFileSystems]: "openstack_sharev2_up",
  [OpenStackServiceType.Database]: "openstack_trove_up",
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
  { minutes: 7 * 24 * 60, rollingTime: RollingTime.Past7Days },
];

function windowHolding(minutes: number): RollingTime {
  for (const window of WINDOWS_IN_MINUTES) {
    if (window.minutes >= minutes) {
      return window.rollingTime;
    }
  }

  return RollingTime.Past7Days;
}

/*
 * A grouped step's anchor says how often its service is collected, which its own series can't when
 * they come and go. One per status word exists only while something has that status, so the first
 * thing seen in that status, or the only thing, has one data point and nothing beside it to say
 * that it isn't all a window ever holds. Anything on its way to something else is seen that way.
 */
function readCadenceFromAnchor(args: {
  openstackMonitor: MonitorStepOpenStackMonitor;
  instances: Array<MonitorCriteriaInstance>;
}): void {
  const hasAnchor: boolean =
    args.openstackMonitor.metricViewConfig.queryConfigs.some(
      (query: MetricQueryConfigData): boolean => {
        return (
          query.metricAliasData?.metricVariable ===
          OPENSTACK_ANCHOR_METRIC_ALIAS
        );
      },
    );

  if (!hasAnchor) {
    return;
  }

  for (const instance of args.instances) {
    for (const filter of instance.data?.filters || []) {
      filter.metricMonitorOptions = {
        ...filter.metricMonitorOptions,
        cadenceMetricAlias: OPENSTACK_ANCHOR_METRIC_ALIAS,
      };
    }
  }
}

export function buildOpenStackMonitorStep(args: {
  openstackMonitor: MonitorStepOpenStackMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  readCadenceFromAnchor({
    openstackMonitor: args.openstackMonitor,
    instances: [args.offlineCriteriaInstance, args.onlineCriteriaInstance],
  });

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

export function buildOpenStackSeriesConfig(args: {
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
  // Or the series that does, for what is not collected from a service: see the checks below.
  anchorMetricName?: string | undefined;
}): MonitorStepOpenStackMonitor {
  const anchorMetricName: string | undefined =
    args.anchorMetricName ||
    (args.anchorService
      ? OPENSTACK_API_UP_METRIC_BY_SERVICE[args.anchorService]
      : undefined);

  const queries: Array<OpenStackQuery> = anchorMetricName
    ? [
        ...args.queries,
        {
          alias: OPENSTACK_ANCHOR_METRIC_ALIAS,
          metricName: anchorMetricName,
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

export interface IncidentWords {
  incidentTitle: string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
}

interface TemplateNotification extends IncidentWords {
  args: OpenStackAlertTemplateArgs;
}

export function buildOfflineCriteria(data: {
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
  rollingTime?: RollingTime | undefined;
  anchorMetricName?: string | undefined;
  /*
   * The floor, where it isn't whether something reads 1. A number with room in it gets a dead band
   * to recover past, so it doesn't flap on its line. Whole series of 0 or 1 have nowhere to put one.
   */
  value?: number | undefined;
  words: IncidentWords;
}): MonitorStep {
  const [firstQuery, ...otherQueries] = data.queries;
  const value: number = data.value ?? 1;

  return buildOpenStackMonitorStep({
    openstackMonitor: buildOpenStackSeriesConfig({
      cloudIdentifier: data.args.cloudIdentifier,
      queries: data.queries,
      rollingTime:
        data.rollingTime || OPENSTACK_WINDOW_BY_SERVICE[data.service],
      groupByAttributeKeys: data.groupByAttributeKeys,
      anchorService: data.hasOwnAnchor ? undefined : data.service,
      anchorMetricName: data.hasOwnAnchor ? undefined : data.anchorMetricName,
    }),
    offlineCriteriaInstance: buildOfflineCriteria({
      notification: { args: data.args, ...data.words },
      metricAlias: firstQuery!.alias,
      filterType: FilterType.LessThan,
      value: value,
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
        value: value,
        // These series are 0 or 1: a dead band above 1 could never be crossed.
        isBinaryMetric: data.value === undefined,
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
  anchorMetricName?: string | undefined;
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
      anchorMetricName: data.anchorMetricName,
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
    ...(isOpenStackOptionalService(data.service)
      ? { forService: data.service }
      : {}),
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

const orchestrationApiDownTemplate: OpenStackAlertTemplate =
  buildApiDownTemplate({
    id: "openstack-orchestration-api-down",
    name: "Orchestration API Down",
    summary: "Heat's API does not answer for 15 minutes.",
    description:
      "Alert when Heat's API does not answer for 15 minutes: every call the exporter made failed (openstack_heat_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. Heat's API asks an engine for its lists, so a stopped heat-engine reads as this too, recorded: each read then waits a minute for an RPC timeout. Check `openstack orchestration service list`, then heat-api's and heat-engine's services and logs.",
    service: OpenStackServiceType.Orchestration,
    collectionMetricName: "up",
    incidentDescription: `Heat's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. Heat's API asks an engine for its lists, so this is also what a stopped heat-engine looks like. What Heat already built carries on, but no stack can be created, changed or deleted, and Magnum builds its clusters with Heat. Check openstack orchestration service list, then heat-api's and heat-engine's services and logs, and RabbitMQ. The incident resolves on its own once it answers again.`,
  });

const ratingApiDownTemplate: OpenStackAlertTemplate = {
  ...buildApiDownTemplate({
    id: "openstack-rating-api-down",
    name: "Rating API Down",
    summary: "CloudKitty's API does not answer for 15 minutes.",
    description:
      "Alert when CloudKitty's API does not answer for 15 minutes (openstack_cloudkitty_up reads 0, which only a probe sends, because the agent's exporter has no series for it), or that collection did not answer (up reads 0). One incident per region. What a project was rated stops moving until it answers again, and the Spend page says when it was last read. Check `openstack catalog show rating`, then cloudkitty-api's service and logs.",
    service: OpenStackServiceType.Rating,
    collectionMetricName: "up",
    incidentDescription: `CloudKitty's API is not answering, so what each project was rated has stopped moving. Instances, volumes and everything else carry on, and usage goes on being counted from the inventory. Check openstack catalog show rating, then cloudkitty-api's service and logs, and the database behind it. The incident resolves on its own once it answers again.`,
  }),
  // The agent's exporter has no series for it.
  requiresProbe: true,
};

const containerInfraApiDownTemplate: OpenStackAlertTemplate =
  buildApiDownTemplate({
    id: "openstack-container-infra-api-down",
    name: "Kubernetes Clusters API Down",
    summary: "Magnum's API does not answer for 15 minutes.",
    description:
      "Alert when Magnum's API does not answer for 15 minutes: every call the exporter made failed (openstack_container_infra_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. Check `openstack coe service list`, then magnum-api's service and logs.",
    service: OpenStackServiceType.ContainerInfra,
    collectionMetricName: "up",
    incidentDescription: `Magnum's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. Clusters already running carry on, but none can be created, resized or deleted. Check openstack coe service list, then magnum-api's service and logs, and the database behind it. The incident resolves on its own once it answers again.`,
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

/*
 * Per image, from the one series of an image that names its status. Its value is when it was
 * created, never 0, so it says the row is there. Glance is read every five minutes, so the hour the
 * pages call stuck holds twelve collections. A status series exists only while an image is in that
 * status, so one uploaded at last, or deleted, recovers by going away.
 */
const imageStuckTemplate: OpenStackAlertTemplate = {
  id: "openstack-image-stuck",
  name: "Image Stuck",
  summary: `An image stays in a passing state for ${OPENSTACK_IMAGE_STUCK_MINUTES} minutes.`,
  description: `Alert when an image stays in one of ${Array.from(OPENSTACK_IMAGE_TRANSITIONAL_STATUSES).join(", ")} for ${OPENSTACK_IMAGE_STUCK_MINUTES} minutes (openstack_glance_image_created_at filtered to that status label, in every collection of the window). One incident per image. An image left in queued is what a failed upload looks like, and nothing moves it on. Check \`openstack image show <image>\`, then glance-api's log. A very large import can honestly take this long.`,
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = Array.from(
      OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
    ).map((status: string): OpenStackQuery => {
      return {
        alias: statusAlias(status),
        metricName: "openstack_glance_image_created_at",
        aggregationType: MetricsAggregationType.Max,
        attributes: { status },
      };
    });

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Image,
      rollingTime: windowHolding(OPENSTACK_IMAGE_STUCK_MINUTES),
      groupByAttributeKeys: IMAGE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Image Stuck",
        incidentDescription: `This image has held one status on the way to another for ${OPENSTACK_IMAGE_STUCK_MINUTES} minutes. An image left in queued is what a failed upload looks like: nothing moves it on, and an instance asking for it fails. Check openstack image show for the image named above, then glance-api's log. Upload it again, or delete it with openstack image delete. The incident resolves on its own once it reaches its next status or is deleted.`,
        criteriaName: `Image Stuck - same status for ${OPENSTACK_IMAGE_STUCK_MINUTES} minutes`,
        criteriaDescription: `Triggers when an image holds the status for the whole ${OPENSTACK_IMAGE_STUCK_MINUTES}-minute window.`,
      },
    });
  },
};

// --- Orchestration ---

/*
 * A stack or cluster holding one word for the whole window, each word its own query because a
 * monitor's attribute filter is equality. Per part rather than per region, because what someone needs
 * from these is its name: the exporter counts Heat's words per region too, but a count cannot tell one
 * stack stuck for two hours from a stream of them passing through, and cannot say which. Its value is
 * the word's code, none of them 0 for the words read here, so it says the row is there. A word's series
 * goes away with the word, so one fixed, deleted or finished recovers by that.
 *
 * Heat's and Magnum's own timeouts fail what takes too long, and the agent reads both every five
 * minutes, so a failed one holds three collections in fifteen minutes and a stuck one twenty-four.
 */
function buildLifecycleTemplate(data: {
  id: string;
  name: string;
  summary: string;
  description: string;
  service: OpenStackServiceType;
  metricName: string;
  statuses: ReadonlyArray<string>;
  groupByAttributeKeys: Array<string>;
  rollingTime?: RollingTime | undefined;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
}): OpenStackAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    summary: data.summary,
    description: data.description,
    category: "Orchestration",
    severity: "Warning",
    forService: data.service,
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      const queries: Array<OpenStackQuery> = data.statuses.map(
        (status: string): OpenStackQuery => {
          return {
            alias: statusAlias(status),
            metricName: data.metricName,
            aggregationType: MetricsAggregationType.Max,
            attributes: { status },
          };
        },
      );

      return buildCeilingStep({
        args,
        service: data.service,
        rollingTime: data.rollingTime,
        groupByAttributeKeys: data.groupByAttributeKeys,
        queries,
        aliases: queries.map((query: OpenStackQuery): string => {
          return query.alias;
        }),
        value: 0,
        words: {
          incidentTitle: `[OpenStack] ${data.name}`,
          incidentDescription: data.incidentDescription,
          criteriaName: data.criteriaName,
          criteriaDescription: data.criteriaDescription,
        },
      });
    },
  };
}

const stackFailedTemplate: OpenStackAlertTemplate = buildLifecycleTemplate({
  id: "openstack-stack-failed",
  name: "Stack Failed",
  summary: "A Heat stack is in a failed state.",
  description: `Alert when a stack reads one of ${Array.from(OPENSTACK_STACK_FAILED_STATUSES).join(", ")} for 15 minutes (openstack_heat_stack_status filtered to that status label, in every collection of the window). One incident per stack. A failed stack stays failed until someone updates or deletes it. Check \`openstack stack failures list <stack>\`, then \`openstack stack event list <stack>\`. Magnum builds each cluster with a stack, so a failed cluster fires this too, on its stack.`,
  service: OpenStackServiceType.Orchestration,
  metricName: "openstack_heat_stack_status",
  statuses: Array.from(OPENSTACK_STACK_FAILED_STATUSES),
  groupByAttributeKeys: STACK_GROUP,
  incidentDescription: `This Heat stack is in the failed state named above, and stays that way until someone updates or deletes it. Whatever asked for it did not get it: what it built may be partly there, and is still using its project's quota. Check openstack stack failures list for the stack named above, then openstack stack event list. If it belongs to a Kubernetes cluster, openstack coe cluster show says which of its node groups failed. The incident resolves on its own once it is updated or deleted.`,
  criteriaName: "Stack Failed - a failed status for the whole window",
  criteriaDescription:
    "Triggers when a stack holds a failed status for the whole window.",
});

/*
 * INIT_IN_PROGRESS is left out, because its code is 0 and so reads as nothing here. It lasts a moment
 * in Heat, before a stack has an action to be stuck in.
 */
const STACK_STUCK_STATUSES: Array<string> = Array.from(
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
).filter((status: string): boolean => {
  return status !== "INIT_IN_PROGRESS";
});

const stackStuckTemplate: OpenStackAlertTemplate = buildLifecycleTemplate({
  id: "openstack-stack-stuck",
  name: "Stack Stuck In Progress",
  summary: `A Heat stack stays in progress for ${OPENSTACK_STACK_STUCK_MINUTES} minutes.`,
  description: `Alert when a stack stays in one of ${STACK_STUCK_STATUSES.join(", ")} for ${OPENSTACK_STACK_STUCK_MINUTES} minutes (openstack_heat_stack_status filtered to that status label, in every collection of the window). One incident per stack. Heat fails what passes its own timeout, an hour unless someone chose longer, so this is one with a longer timeout, or one whose engine stopped: on a real cloud, restarting the engine moved neither stack it had been working on. Check \`openstack stack show <stack>\` and \`openstack orchestration service list\`, then heat-engine's log.`,
  service: OpenStackServiceType.Orchestration,
  metricName: "openstack_heat_stack_status",
  statuses: STACK_STUCK_STATUSES,
  groupByAttributeKeys: STACK_GROUP,
  rollingTime: windowHolding(OPENSTACK_STACK_STUCK_MINUTES),
  incidentDescription: `This Heat stack has been in progress for ${OPENSTACK_STACK_STUCK_MINUTES} minutes, past the hour Heat gives a stack unless someone chose longer. Either someone did, or the engine working on it stopped, and a restarted engine does not pick it back up by itself. Check openstack stack show for the stack named above and openstack orchestration service list, then heat-engine's log. openstack stack cancel, or an update, is the usual way out once you know why it stopped. The incident resolves on its own once it reaches its next status or is deleted.`,
  criteriaName: `Stack Stuck In Progress - same status for ${OPENSTACK_STACK_STUCK_MINUTES} minutes`,
  criteriaDescription: `Triggers when a stack holds an in-progress status for the whole ${OPENSTACK_STACK_STUCK_MINUTES}-minute window.`,
});

const containerClusterFailedTemplate: OpenStackAlertTemplate =
  buildLifecycleTemplate({
    id: "openstack-container-cluster-failed",
    name: "Kubernetes Cluster Failed",
    summary: "A Magnum cluster is in a failed state.",
    description: `Alert when a Magnum cluster reads one of ${Array.from(OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES).join(", ")} for 15 minutes (openstack_container_infra_cluster_status filtered to that status label, in every collection of the window). One incident per cluster. A cluster that failed to build usually has its reason on its Heat stack, and its project's quota is still in use. Check \`openstack coe cluster show <cluster>\` and \`openstack stack failures list <stack_id>\`.`,
    service: OpenStackServiceType.ContainerInfra,
    metricName: "openstack_container_infra_cluster_status",
    statuses: Array.from(OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES),
    groupByAttributeKeys: CONTAINER_CLUSTER_GROUP,
    incidentDescription: `This Magnum cluster is in the failed state named above. Whoever asked for it does not have a working cluster, and what it built so far is still using its project's quota. Check openstack coe cluster show for the cluster named above, whose status_reason says which of its node groups failed, then openstack stack failures list on its stack_id, because Magnum builds a cluster with a Heat stack. The incident resolves on its own once it is updated or deleted.`,
    criteriaName:
      "Kubernetes Cluster Failed - a failed status for the whole window",
    criteriaDescription:
      "Triggers when a cluster holds a failed status for the whole window.",
  });

const containerClusterStuckTemplate: OpenStackAlertTemplate =
  buildLifecycleTemplate({
    id: "openstack-container-cluster-stuck",
    name: "Kubernetes Cluster Stuck",
    summary: `A Magnum cluster stays in progress for ${OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES} minutes.`,
    description: `Alert when a Magnum cluster stays in one of ${Array.from(OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES).join(", ")} for ${OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES} minutes (openstack_container_infra_cluster_status filtered to that status label, in every collection of the window). One incident per cluster. Magnum fails what passes the timeout it was created with, an hour unless someone chose longer, and only its conductor can notice: a stopped conductor leaves a cluster reading this for good. Check \`openstack coe service list\`, then \`openstack coe cluster show <cluster>\` and its stack.`,
    service: OpenStackServiceType.ContainerInfra,
    metricName: "openstack_container_infra_cluster_status",
    statuses: Array.from(OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES),
    groupByAttributeKeys: CONTAINER_CLUSTER_GROUP,
    rollingTime: windowHolding(OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES),
    incidentDescription: `This Magnum cluster has been in progress for ${OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES} minutes, past the hour Magnum gives a cluster unless someone chose longer. Either someone did, or its conductor has stopped noticing how its Heat stack is doing: only a conductor moves a cluster on. Check openstack coe service list, then openstack coe cluster show for the cluster named above, and its stack with openstack stack show. The incident resolves on its own once it reaches its next status or is deleted.`,
    criteriaName: `Kubernetes Cluster Stuck - same status for ${OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES} minutes`,
    criteriaDescription: `Triggers when a cluster holds an in-progress status for the whole ${OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES}-minute window.`,
  });

/*
 * Only a native read of these APIs lists their workers: the exporter has no series for them, so these
 * two can only be set up on a cloud a probe collects. No adminState filter on Heat's, because Heat has
 * no such thing, and every record of a host's engine is one series to a host and binary, by Min.
 */
const orchestrationEngineDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-orchestration-engine-down",
  name: "Heat Engine Down",
  summary: "A heat-engine is down, on a cloud a probe collects.",
  description:
    "Alert when Heat lists a heat-engine as down for 15 minutes (openstack_heat_agent_state below 1, which only a probe sends, because only a read of Heat's own API says so). One incident per host. Heat keeps a record per engine process, and the others carry on while any is left, which is why this is a Warning. With every engine stopped Heat's API can't answer at all, recorded, and Orchestration API Down fires instead. Check `openstack orchestration service list`, then heat-engine's service and logs on that host.",
  category: "Control Plane",
  severity: "Warning",
  forService: OpenStackServiceType.Orchestration,
  requiresProbe: true,
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Orchestration,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "heat_engine_up",
          metricName: "openstack_heat_agent_state",
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Heat Engine Down",
        incidentDescription: `Heat lists a heat-engine as down. The others carry on while any is left, though with less room, and a stack this engine was working on stays in progress until someone moves it. Check openstack orchestration service list, then heat-engine's service and logs on the host named above, and its route to RabbitMQ. The incident resolves on its own once it is up again, or Heat has dropped its record.`,
        criteriaName: "Heat Engine Down - heat-engine < 1",
        criteriaDescription:
          "Triggers when Heat lists a heat-engine as down for the whole window.",
      },
    });
  },
};

const containerInfraConductorDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-container-infra-conductor-down",
  name: "Magnum Conductor Down",
  summary: "A magnum-conductor is down, on a cloud a probe collects.",
  description:
    "Alert when an enabled magnum-conductor is down for 15 minutes (openstack_container_infra_agent_state below 1, filtered to adminState enabled, which only a probe sends, because only a read of Magnum's own API says so). One incident per host, and one someone disabled never fires. Magnum's API carries on answering without one, recorded, so nothing else says this: its clusters just stop moving. Check `openstack coe service list`, then magnum-conductor's service and logs on that host.",
  category: "Control Plane",
  severity: "Critical",
  forService: OpenStackServiceType.ContainerInfra,
  requiresProbe: true,
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.ContainerInfra,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "magnum_conductor_up",
          metricName: "openstack_container_infra_agent_state",
          aggregationType: MetricsAggregationType.Min,
          attributes: { adminState: "enabled" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Magnum Conductor Down",
        incidentDescription: `Magnum lists an enabled magnum-conductor as down. Its API carries on answering, so nothing else says this, but with none left no cluster can be created, resized or deleted, and clusters in progress stop moving. Check openstack coe service list, then magnum-conductor's service and logs on the host named above, and its route to RabbitMQ. The incident resolves on its own once it is up again, or disabled.`,
        criteriaName: "Magnum Conductor Down - enabled magnum-conductor < 1",
        criteriaDescription:
          "Triggers when Magnum lists an enabled magnum-conductor as down for the whole window.",
      },
    });
  },
};

// --- Bare Metal ---

const IRONIC_NODE: string = "openstack_ironic_node";

/*
 * A node in one of a set of provision states, on Ironic's own word: each is its own query, because
 * a monitor's attribute filter is equality. Per node, because it is a machine that is lost, and
 * grouped no finer, so a node that goes on to the next word or has its reason changed is the same
 * incident. The series only says a node is there, so its value is 1 and this reads whether it has
 * one at all. A node that moves on leaves the query and recovers by going away.
 */
function bareMetalStateQueries(data: {
  states: ReadonlySet<string>;
  attributes?: Record<string, string> | undefined;
}): Array<OpenStackQuery> {
  return Array.from(data.states).map((state: string): OpenStackQuery => {
    return {
      alias: statusAlias(state),
      metricName: IRONIC_NODE,
      aggregationType: MetricsAggregationType.Max,
      attributes: { provision_state: state, ...data.attributes },
    };
  });
}

const bareMetalNodeInErrorTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-node-in-error",
  name: "Bare Metal Node in Error",
  forService: OpenStackServiceType.BareMetal,
  summary: "A bare metal node stays in a failed provision state.",
  description: `Alert when a bare metal node stays in one of ${Array.from(OPENSTACK_BARE_METAL_ERROR_STATES).join(", ")} for 15 minutes (openstack_ironic_node filtered to that provision_state label, in every collection of the window). One incident per node, in maintenance or not, because Ironic does not always put a failed node in maintenance, and it stays failed until someone acts. Check the conductor's log as well as \`openstack baremetal node show <node> -c last_error\`: the exporter does not carry why, and Ironic can empty last_error within about a minute of a failure. A probe reads last_error, and keeps the last one it saw.`,
  category: "Bare Metal",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = bareMetalStateQueries({
      states: OPENSTACK_BARE_METAL_ERROR_STATES,
    });

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.BareMetal,
      groupByAttributeKeys: BARE_METAL_NODE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Bare Metal Node in Error",
        incidentDescription: `This node is in a failed provision state, so the machine is out of what the cloud can give until someone acts: Ironic retries none of these by itself. Check openstack baremetal node show for the node named above, and the conductor's log: Ironic can empty last_error within about a minute of a failure. Once it is fixed, move the node on with openstack baremetal node manage or provide. The incident resolves on its own once it has left the failed state.`,
        criteriaName: "Bare Metal Node in Error - failed provision state",
        criteriaDescription:
          "Triggers when a node holds a failed provision state for the whole window.",
      },
    });
  },
};

const bareMetalNodeStuckTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-node-stuck",
  name: "Bare Metal Node Stuck Transitioning",
  forService: OpenStackServiceType.BareMetal,
  summary: `A bare metal node stays in a passing state for ${OPENSTACK_BARE_METAL_STUCK_MINUTES / 60} hours.`,
  description: `Alert when a bare metal node stays in one of ${Array.from(OPENSTACK_BARE_METAL_TRANSITIONAL_STATES).join(", ")} for ${OPENSTACK_BARE_METAL_STUCK_MINUTES / 60} hours (openstack_ironic_node filtered to that provision_state label and maintenance false, in every collection of the window). One incident per node. Ironic gives up on a node waiting for its agent after 30 minutes by default, and the node then says it failed, so past this something else is holding it. A long disk erase can honestly take this long: the node's page reads Ironic's own time, which an erase's heartbeats keep moving, and an alert only reads the word. A node someone put in maintenance is left out. Check \`openstack baremetal node show <node>\` and the conductor's log.`,
  category: "Bare Metal",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = bareMetalStateQueries({
      states: OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
      attributes: { maintenance: "false" },
    });

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.BareMetal,
      rollingTime: windowHolding(OPENSTACK_BARE_METAL_STUCK_MINUTES),
      groupByAttributeKeys: BARE_METAL_NODE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Bare Metal Node Stuck Transitioning",
        incidentDescription: `This node has held one state on the way to another for ${OPENSTACK_BARE_METAL_STUCK_MINUTES / 60} hours, far past when Ironic gives up on waiting by default. Check openstack baremetal node show for the node named above and the conductor's log. A long disk erase can honestly take this long, and a node's page can tell, because an erase's heartbeats move Ironic's own time. The incident resolves on its own once it reaches its next state.`,
        criteriaName: `Bare Metal Node Stuck - same state for ${OPENSTACK_BARE_METAL_STUCK_MINUTES / 60} hours`,
        criteriaDescription: `Triggers when a node holds the state for the whole ${OPENSTACK_BARE_METAL_STUCK_MINUTES / 60}-hour window.`,
      },
    });
  },
};

const bareMetalNodeMaintenanceTooLongTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-node-maintenance-too-long",
  name: "Bare Metal Node in Maintenance Too Long",
  forService: OpenStackServiceType.BareMetal,
  summary: `A bare metal node stays in maintenance for ${OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS} days.`,
  description: `Alert when a bare metal node stays in maintenance for ${OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS} days (openstack_ironic_node filtered to maintenance true, in every collection of the window). A node someone put in maintenance is planned, like a service someone disabled, so nothing fires before that; past it, somebody has probably forgotten a machine the cloud has gone without all this time. One incident per node. This needs your metrics kept for at least that long. Check \`openstack baremetal node show <node> -c maintenance_reason\`, then \`openstack baremetal node maintenance unset <node>\`, or retire it.`,
  category: "Bare Metal",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "in_maintenance";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.BareMetal,
      rollingTime: windowHolding(
        OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS * 24 * 60,
      ),
      groupByAttributeKeys: BARE_METAL_NODE_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: IRONIC_NODE,
          aggregationType: MetricsAggregationType.Max,
          attributes: { maintenance: "true" },
        },
      ],
      aliases: [metricAlias],
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Bare Metal Node in Maintenance Too Long",
        incidentDescription: `This node has been in maintenance for ${OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS} days, and has been out of what the cloud can give all that time. Check openstack baremetal node show for the node named above and its maintenance reason, then finish the work and run openstack baremetal node maintenance unset, or retire it. The incident resolves on its own once it is out of maintenance.`,
        criteriaName: `Bare Metal Node in Maintenance - for ${OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS} days`,
        criteriaDescription: `Triggers when a node reads in maintenance for the whole ${OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS}-day window.`,
      },
    });
  },
};

const bareMetalPowerStateUnexpectedTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-power-state-unexpected",
  name: "Bare Metal Power State Unexpected",
  forService: OpenStackServiceType.BareMetal,
  summary: "A deployed bare metal node has its power off.",
  description: `Alert when a deployed bare metal node reads power off for 15 minutes (openstack_ironic_node filtered to provision_state active, power_state power off and maintenance false). One incident per node. Nothing else counts as unexpected: a failed deploy leaves a node on, a node between deploys may be on or off, and an empty power state is not known rather than wrong. An instance its owner stopped does this too, and this alert cannot tell, because it reads one series: the node's page can, and says so. Check \`openstack baremetal node show <node>\`, then \`openstack server show\` for the instance on it, and whether anyone meant it.`,
  category: "Bare Metal",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const metricAlias: string = "deployed_with_power_off";

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.BareMetal,
      groupByAttributeKeys: BARE_METAL_NODE_GROUP,
      queries: [
        {
          alias: metricAlias,
          metricName: IRONIC_NODE,
          aggregationType: MetricsAggregationType.Max,
          attributes: {
            provision_state: "active",
            power_state: "power off",
            maintenance: "false",
          },
        },
      ],
      aliases: [metricAlias],
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Bare Metal Power State Unexpected",
        incidentDescription: `This node is deployed and has its power off, so whatever runs on it has stopped. If its owner stopped the instance on it, that is planned, and this alert cannot tell: the node's page in OneUptime can. Check openstack server show for the instance on the node named above, then openstack baremetal node power on if nobody meant it. The incident resolves on its own once it is powered on, or no longer deployed.`,
        criteriaName: "Bare Metal Power State - deployed with its power off",
        criteriaDescription:
          "Triggers when a deployed node reads power off for the whole window.",
      },
    });
  },
};

/*
 * Only what Ironic says of itself, and never `up`, which reads 0 for this job on every cloud whenever
 * the exporter is down, with Ironic or without. So this speaks only where a read of Ironic gets far
 * enough to say 0: a probe, which reads the catalog first, and exporter 1.7.0. Stopped, the exporter
 * the agent runs answers an empty 200, the same as a cloud without Ironic (recorded:
 * services-ironic/api-down), so no alert can tell those apart from what it sends, and the pages say
 * only that it has gone quiet.
 */
const bareMetalApiDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-api-down",
  name: "Bare Metal API Down",
  forService: OpenStackServiceType.BareMetal,
  summary: "Ironic's API says it is not answering.",
  description:
    "Alert when Ironic's API reads as not answering for 15 minutes (openstack_ironic_up). One incident per region. This speaks where something can say so: a cloud a probe collects, or exporter 1.7.0. A stopped Ironic gives the exporter the OpenStack Agent runs nothing at all to read, which is what a cloud without Ironic looks like, so on an agent's cloud this stays quiet and the cloud's Bare Metal page says when it last heard from Ironic. Check `openstack baremetal node list` with a credential that may, then the ironic-api service's log.",
  category: "Bare Metal",
  severity: "Critical",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.BareMetal,
      hasOwnAnchor: true,
      groupByAttributeKeys: API_GROUP,
      queries: [
        {
          alias: "api_up",
          metricName:
            OPENSTACK_API_UP_METRIC_BY_SERVICE[OpenStackServiceType.BareMetal],
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Bare Metal API Down",
        incidentDescription:
          "Ironic's API is not answering in this region, so nobody can deploy, clean or manage a bare metal node there. What is already deployed keeps running. Check the ironic-api service and its log, then openstack baremetal node list with a credential that may. The incident resolves on its own once it answers again.",
        criteriaName: "Bare Metal API Down - not answering",
        criteriaDescription:
          "Triggers when Ironic's API does not answer for the whole window.",
      },
    });
  },
};

// --- Shared file systems ---

/*
 * A share holding one of a set of words for the whole window, one query per word, because a monitor's
 * attribute filter is equality. Per share rather than from the status counter: a count can't say which
 * share, or tell one stuck from a stream of them passing through. Read from _share_gb and not
 * _share_status, whose value is a code for the word, and creating's code is 0, recorded, so it would
 * never read as anything. A share's size is never 0. Its series goes away with the word, so a share
 * fixed, deleted or finished recovers by that.
 */
function shareStateQueries(
  statuses: ReadonlySet<string>,
): Array<OpenStackQuery> {
  return Array.from(statuses).map((status: string): OpenStackQuery => {
    return {
      alias: statusAlias(status),
      metricName: "openstack_sharev2_share_gb",
      aggregationType: MetricsAggregationType.Max,
      attributes: { status },
    };
  });
}

const shareInErrorTemplate: OpenStackAlertTemplate = {
  id: "openstack-share-in-error",
  name: "Share in Error",
  forService: OpenStackServiceType.SharedFileSystems,
  summary: "A Manila share is in an error state.",
  description: `Alert when a share stays in one of ${Array.from(OPENSTACK_SHARE_ERROR_STATUSES).join(", ")} for 15 minutes (openstack_sharev2_share_gb filtered to that status label, in every collection of the window). One incident per share, in a region. Manila retries none of these by itself, so one stays until someone deals with it, and recovers when it is fixed or deleted. Check \`openstack share show <share>\`, then \`openstack share message list --resource-id <share>\`.`,
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = shareStateQueries(
      OPENSTACK_SHARE_ERROR_STATUSES,
    );

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.SharedFileSystems,
      groupByAttributeKeys: SHARE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Share in Error",
        incidentDescription: `This share is in the error state named above, and whoever asked for it does not have what they asked for. Manila retries none of these by itself. Check openstack share show and openstack share message list for this share, then manila-share's log on its backend. A share that no backend could take has no zone, recorded, which is what a share type nothing matches looks like. The incident resolves on its own once it is fixed or deleted.`,
        criteriaName: "Share in Error - an error state for the whole window",
        criteriaDescription:
          "Triggers when a share holds an error state for the whole window.",
      },
    });
  },
};

const shareStuckTemplate: OpenStackAlertTemplate = {
  id: "openstack-share-stuck",
  name: "Share Stuck",
  forService: OpenStackServiceType.SharedFileSystems,
  summary: `A Manila share stays in a passing state for ${OPENSTACK_SHARE_STUCK_MINUTES} minutes.`,
  description: `Alert when a share stays in one of ${Array.from(OPENSTACK_SHARE_TRANSITIONAL_STATUSES).join(", ")} for ${OPENSTACK_SHARE_STUCK_MINUTES} minutes (openstack_sharev2_share_gb filtered to that status label, in every collection of the window). One incident per share, in a region. Manila has no timeout of its own for a slow backend, so a backend that hung reads the same as a slow one, and only time tells them apart. A share migrating or being backed up isn't watched: those last as long as its data takes to copy, because someone asked for that. Check \`openstack share service list\`, then manila-share's log on its backend.`,
  category: "Storage",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = shareStateQueries(
      OPENSTACK_SHARE_TRANSITIONAL_STATUSES,
    );

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.SharedFileSystems,
      rollingTime: windowHolding(OPENSTACK_SHARE_STUCK_MINUTES),
      groupByAttributeKeys: SHARE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Share Stuck",
        incidentDescription: `This share has held the status named above for ${OPENSTACK_SHARE_STUCK_MINUTES} minutes. Manila has no timeout of its own for this, so either its backend is very slow or nothing is working on it any more. Check openstack share service list, then manila-share's log on the backend that holds it. Only an admin can move it on, with openstack share set --status. The incident resolves on its own once it reaches its next status, or is deleted.`,
        criteriaName: `Share Stuck - same status for ${OPENSTACK_SHARE_STUCK_MINUTES} minutes`,
        criteriaDescription: `Triggers when a share holds a passing status for the whole ${OPENSTACK_SHARE_STUCK_MINUTES}-minute window.`,
      },
    });
  },
};

const sharedFileSystemsApiDownTemplate: OpenStackAlertTemplate =
  buildApiDownTemplate({
    id: "openstack-shared-file-systems-api-down",
    name: "Shared File Systems API Down",
    summary: "Manila's API does not answer for 15 minutes.",
    description:
      "Alert when Manila's API does not answer for 15 minutes: every call the exporter made failed (openstack_sharev2_up reads 0), or the exporter did not answer that collection (up reads 0). One incident per region. Recorded on a stopped API, and every credential that can log in reads 1, so this can't be a credential being refused. Shares already mounted carry on, because their data doesn't go through this API. Check the manila-api service and its log, then `openstack share list`.",
    service: OpenStackServiceType.SharedFileSystems,
    collectionMetricName: "up",
    incidentDescription: `Manila's API is not answering: every call the exporter made failed, or the exporter did not answer that collection. Shares already mounted carry on, but none can be created, resized or given new access. Check the manila-api service and its log, then openstack share list with a credential that works. The incident resolves on its own once it answers again.`,
  });

/*
 * Only a read of Manila's API lists its services: the exporter has no series for them, so this can
 * only be set up on a cloud a probe collects. Stopped and down both read below 1. Someone who stopped
 * one on purpose and means it to stay stopped has the cloud's maintenance windows for that.
 */
const shareServiceDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-share-service-down",
  name: "Manila Service Down",
  forService: OpenStackServiceType.SharedFileSystems,
  requiresProbe: true,
  summary: "A Manila service stops, on a cloud a probe collects.",
  description:
    "Alert when an enabled Manila service reads stopped or down for 15 minutes (openstack_sharev2_agent_state below 1, filtered to adminState enabled, which only a probe sends, because only a read of Manila's own API says so). One incident per host and service. Recorded: a service shut down cleanly reads stopped at once, and one that died reads down only once its heartbeat has grown old. Its API carries on answering either way, so nothing else says this, and without its scheduler Manila's pools read 500. Check `openstack share service list`, and the service's log on its host.",
  category: "Control Plane",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.SharedFileSystems,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "manila_service_up",
          metricName: "openstack_sharev2_agent_state",
          aggregationType: MetricsAggregationType.Min,
          attributes: { adminState: "enabled" },
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Manila Service Down",
        incidentDescription: `Manila lists this service as stopped or down. Shares already mounted carry on, because their data doesn't go through it, but none on its backend can be created, resized or deleted. Check openstack share service list and the service's log on the host named above. The incident resolves on its own once it reads up, or someone disables it.`,
        criteriaName: "Manila Service Down - enabled service < 1",
        criteriaDescription:
          "Triggers when Manila lists an enabled service as stopped or down for the whole window.",
      },
    });
  },
};

// --- Databases ---

/*
 * An instance holding one of a set of words for the whole window, one query per word. By a count of
 * its datapoints, because the series' value is a code for the word, and a code can be 0. Its series
 * goes away with the word, so an instance fixed, deleted or finished recovers by that.
 */
function databaseInstanceStateQueries(
  statuses: ReadonlySet<string>,
): Array<OpenStackQuery> {
  return Array.from(statuses).map((status: string): OpenStackQuery => {
    return {
      alias: statusAlias(status),
      metricName: "openstack_trove_instance_status",
      aggregationType: MetricsAggregationType.Count,
      attributes: { status },
    };
  });
}

const databaseInstanceInErrorTemplate: OpenStackAlertTemplate = {
  id: "openstack-database-instance-in-error",
  name: "Database Instance in Error",
  forService: OpenStackServiceType.Database,
  summary: "A Trove database instance is in an error state.",
  description: `Alert when a database instance reads one of ${Array.from(OPENSTACK_DATABASE_INSTANCE_ERROR_STATUSES).join(", ")} for 15 minutes (openstack_trove_instance_status filtered to that status label, in every collection of the window). One incident per instance, in a region. Trove retries none of these by itself, so one stays until someone deals with it, and recovers when it is fixed or deleted. Check \`openstack database instance show <instance>\`, whose fault says why.`,
  category: "Databases",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = databaseInstanceStateQueries(
      OPENSTACK_DATABASE_INSTANCE_ERROR_STATUSES,
    );

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Database,
      groupByAttributeKeys: DATABASE_INSTANCE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Database Instance in Error",
        incidentDescription: `This database instance is in the error state named above, and whoever asked for it does not have it. Check openstack database instance show for its fault, which says why Trove gave up: usually Nova refused its guest, or the guest never reported. The incident resolves on its own once it is fixed or deleted.`,
        criteriaName:
          "Database Instance in Error - an error state for the whole window",
        criteriaDescription:
          "Triggers when an instance holds an error state for the whole window.",
      },
    });
  },
};

const databaseInstanceStuckTemplate: OpenStackAlertTemplate = {
  id: "openstack-database-instance-stuck",
  name: "Database Instance Stuck",
  forService: OpenStackServiceType.Database,
  summary: `A Trove database instance stays on its way for ${OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES} minutes.`,
  description: `Alert when a database instance stays in one of ${Array.from(OPENSTACK_DATABASE_INSTANCE_TRANSITIONAL_STATUSES).join(", ")} for ${OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES} minutes (openstack_trove_instance_status filtered to that status label, in every collection of the window). One incident per instance, in a region. Trove has no list of its own workers, so a stopped trove-taskmanager shows up nowhere else: its lists keep answering without it, recorded, and what it was working on just stops moving. Check that trove-taskmanager is running, then \`openstack database instance show <instance>\`.`,
  category: "Databases",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    const queries: Array<OpenStackQuery> = databaseInstanceStateQueries(
      OPENSTACK_DATABASE_INSTANCE_TRANSITIONAL_STATUSES,
    );

    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Database,
      rollingTime: windowHolding(OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES),
      groupByAttributeKeys: DATABASE_INSTANCE_GROUP,
      queries,
      aliases: queries.map((query: OpenStackQuery): string => {
        return query.alias;
      }),
      value: 0,
      words: {
        incidentTitle: "[OpenStack] Database Instance Stuck",
        incidentDescription: `This database instance has held the status named above for ${OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES} minutes. Trove gives up on a guest by itself well before that, so nothing is working on it any more. Check that trove-taskmanager is running, then openstack database instance show. The incident resolves on its own once it reaches its next status, or is deleted.`,
        criteriaName: `Database Instance Stuck - same status for ${OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES} minutes`,
        criteriaDescription: `Triggers when an instance holds a passing status for the whole ${OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES}-minute window.`,
      },
    });
  },
};

/*
 * What its database has used of its volume, per instance. An instance that isn't running reads 0 used,
 * recorded, so a stopped one can't fire this. No recording has a running one: a runner can't get a
 * guest to ACTIVE, so the used side of this has only met made-up rows.
 */
const databaseVolumeNearlyFullTemplate: OpenStackAlertTemplate = {
  id: "openstack-database-volume-nearly-full",
  name: "Database Volume Nearly Full",
  forService: OpenStackServiceType.Database,
  summary: `A Trove database's volume is past ${OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT}% used.`,
  description: `Alert when a database instance has used ${OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT}% of its volume for 15 minutes (openstack_trove_instance_volume_used_gb over openstack_trove_instance_volume_size_gb). One incident per instance, in a region. A database that fills its volume stops taking writes, and resizing it is a change someone has to plan. It recovers when the volume is resized or the database shrinks. Check \`openstack database instance show <instance>\`, then \`openstack database instance resize volume\`.`,
  category: "Databases",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Database,
      groupByAttributeKeys: DATABASE_INSTANCE_GROUP,
      queries: [
        {
          alias: "used_gb",
          metricName: "openstack_trove_instance_volume_used_gb",
          aggregationType: MetricsAggregationType.Max,
        },
        {
          alias: "size_gb",
          metricName: "openstack_trove_instance_volume_size_gb",
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      formulas: [
        {
          alias: "volume_used_percent",
          legend: "Volume used (%)",
          legendUnit: "%",
          formula: "(used_gb / size_gb) * 100",
        },
      ],
      aliases: ["volume_used_percent"],
      filterType: FilterType.GreaterThanOrEqualTo,
      value: OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
      words: {
        incidentTitle: "[OpenStack] Database Volume Nearly Full",
        incidentDescription: `This database has used ${OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT}% or more of its volume, and it stops taking writes when that fills. Check openstack database instance show, then resize it with openstack database instance resize volume, or have whoever owns it clear out what it holds. The incident resolves on its own once it has room again.`,
        criteriaName: `Database Volume Nearly Full - used >= ${OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT}%`,
        criteriaDescription: `Triggers when a database has used ${OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT}% of its volume for the whole window.`,
      },
    });
  },
};

/*
 * A stopped conductor leaves Ironic's API answering and its nodes listed as they were, recorded on
 * DevStack, so only its own list says so. The exporter has no series for that, and Ironic refuses a
 * project's credential the list, so this speaks only for a probe on a cloud whose policy lets it read
 * them. Warning, as several conductors share the nodes between them.
 */
const bareMetalConductorDownTemplate: OpenStackAlertTemplate = {
  id: "openstack-bare-metal-conductor-down",
  name: "Bare Metal Conductor Down",
  summary: "An ironic-conductor is down, on a cloud a probe collects.",
  description:
    "Alert when Ironic lists a conductor as not alive for 15 minutes (openstack_ironic_agent_state below 1, which only a probe sends, and only where the cloud's policy lets its credential read Ironic's conductors: by default it refuses a project's). One incident per host. Ironic's API carries on answering with a conductor stopped, and every node reads as it did, recorded, so nothing else says this. Check `openstack baremetal conductor list`.",
  category: "Bare Metal",
  severity: "Warning",
  forService: OpenStackServiceType.BareMetal,
  requiresProbe: true,
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.BareMetal,
      groupByAttributeKeys: WORKER_GROUP,
      queries: [
        {
          alias: "ironic_conductor_up",
          metricName: "openstack_ironic_agent_state",
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Bare Metal Conductor Down",
        incidentDescription:
          "Ironic lists this conductor as not alive. Another takes its nodes where there is one. With none left, nodes read as they did and nothing can be deployed, cleaned or powered through Ironic. Check openstack baremetal conductor list, then ironic-conductor's service and logs on the host named above. The incident resolves on its own once Ironic lists it as alive again, or has dropped its record.",
        criteriaName: "Bare Metal Conductor Down - ironic-conductor < 1",
        criteriaDescription:
          "Triggers when Ironic lists a conductor as not alive for the whole window.",
      },
    });
  },
};

const databaseApiDownTemplate: OpenStackAlertTemplate = buildApiDownTemplate({
  id: "openstack-database-api-down",
  name: "Databases API Down",
  summary: "Trove's API does not answer for 15 minutes.",
  description:
    "Alert when the exporter's read of Trove fails for 15 minutes (openstack_trove_up reads 0), or the exporter does not answer that collection (up reads 0). One incident per region. The exporter reads Trove's mgmt API, which only an admin may, so a credential it refuses reads the same as a stopped API, recorded. A cloud whose credential has never read Trove isn't offered this. A stopped trove-taskmanager leaves this at 1: Database Instance Stuck is what says that. Check the trove-api service and its log, then `openstack database instance list --all-projects`.",
  service: OpenStackServiceType.Database,
  collectionMetricName: "up",
  incidentDescription: `The exporter's read of Trove is failing: its API stopped answering, or this credential is no longer allowed its mgmt API, which reads the same. Databases already running carry on, but none can be created, resized or backed up. Check the trove-api service and its log, then openstack database instance list --all-projects with this credential. The incident resolves on its own once it answers again.`,
});

// --- Projects ---

const projectQuotaNearlyReachedTemplate: OpenStackAlertTemplate = {
  id: "openstack-project-quota-nearly-reached",
  name: "Project Quota Nearly Reached",
  summary: `A project has used ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}% or more of a quota.`,
  description: `Alert when a project has used ${OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT}% or more of its vCPU, memory, instance or volume quota for 3 hours, which is three of the hourly readings these series have (openstack_nova_limits_* and openstack_cinder_limits_volume_*, used / max per project). One incident per project, and a project with no limit never fires. These series are off by default, because they cost API calls per project, so this template stays quiet until you turn them on: run the agent's install.sh again with OPENSTACK_COLLECT_QUOTAS=true, or on a cloud a probe reads, turn on Project limits. Check \`openstack limits show --absolute --project <project>\`, then raise the quota or ask its owner to free some.`,
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
      // Three of the agent's hourly readings, as every template reads three of its series'.
      rollingTime: RollingTime.Past3Hours,
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

// --- Checks from outside ---

/*
 * WHAT A PROBE FOUND FROM OUTSIDE THE CLOUD (Types/OpenStack/OpenStackCheck), BY THE SAME RULES.
 *
 * Each minute's API check says what it found and what the last lifecycle run found (see
 * OpenStackCheckMetrics for why), so all of these read series that arrive once a minute and hold
 * five collections in five minutes, as every other template holds at least three. A failed lifecycle
 * run opens its incident within minutes of failing and closes it within minutes of the next run that
 * passes, whatever the check's interval is, because what the alert reads is the last verdict.
 *
 * Their anchor is the check's own series, not a service's `_up`: these go on whichever way the cloud
 * is collected, and stop when the probe does. Silence still is not recovery, so a dead probe leaves
 * an open incident open.
 *
 * One incident per region: what a run met goes in the description, from what the run reported
 * (OpenStackAlertContext), so a boot that fails in a different way next time does not open another.
 */
const CHECK_WINDOW: RollingTime = RollingTime.Past5Minutes;
const REGION_GROUP: Array<string> = [REGION];

const TURN_ON_API_CHECKS: string =
  "Reads nothing until API checks are on, on the cloud's Checks page.";
const TURN_ON_LIFECYCLE: string =
  "Reads nothing until the lifecycle check is on, on the cloud's Checks page.";

const tokenIssueFailingTemplate: OpenStackAlertTemplate = {
  id: "openstack-token-issue-failing",
  name: "Token Issue Failing",
  summary: "Keystone issues a probe outside the cloud no token for 5 minutes.",
  description: `Alert when Keystone issues no token to the probe checking this cloud from outside, for 5 minutes: it answered with an error, refused the credential, or could not be reached. One incident per region. Nobody can start anything without a token, whatever the services themselves report. ${TURN_ON_API_CHECKS} Check keystone's service and logs, the load balancer in front of it and the database behind it, then run \`openstack token issue\`.`,
  category: "Availability",
  severity: "Critical",
  requiresCheck: "api",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Identity,
      hasOwnAnchor: true,
      rollingTime: CHECK_WINDOW,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        {
          alias: "token_issued",
          metricName: OpenStackCheckMetric.TokenSuccess,
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Token Issue Failing",
        incidentDescription: `A probe outside this cloud cannot get a token from Keystone, so nobody can start anything new here, whatever the services themselves report. Check keystone's service and logs on the controllers, the load balancer in front of it and the database behind it, then run openstack token issue. The incident resolves on its own once a token is issued again.`,
        criteriaName: "Token Issue Failing - no token issued",
        criteriaDescription:
          "Triggers when Keystone issues the check no token for the whole window.",
      },
    });
  },
};

const serviceApiCheckFailingTemplate: OpenStackAlertTemplate = {
  id: "openstack-service-api-check-failing",
  name: "Service API Check Failing",
  summary: "A service in the catalog does not answer a probe for 5 minutes.",
  description: `Alert when a service the catalog names does not answer a one-row read from a probe outside the cloud, for 5 minutes: it failed, timed out, could not be reached, or refused a token Keystone just issued. One incident per region and service, for every service in the catalog, with no list to keep. One that refuses this credential is answering, so it does not fire. ${TURN_ON_API_CHECKS} Check that service's API and the load balancer in front of it, then run \`openstack endpoint list --interface public\`.`,
  category: "Availability",
  severity: "Critical",
  requiresCheck: "api",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Compute,
      anchorMetricName: OpenStackCheckMetric.TokenSuccess,
      rollingTime: CHECK_WINDOW,
      groupByAttributeKeys: [REGION, "service_type"],
      queries: [
        {
          alias: "api_answered",
          metricName: OpenStackCheckMetric.ApiSuccess,
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Service API Check Failing",
        incidentDescription: `A service in this cloud's catalog is not answering a probe outside the cloud, as it would not answer anyone else. Check that service's API and logs, and the load balancer in front of it, then run openstack endpoint list --interface public to see where it should answer. The incident resolves on its own once it answers again.`,
        criteriaName: "Service API Check Failing - not answering",
        criteriaDescription:
          "Triggers when a service in the catalog does not answer the check for the whole window.",
      },
    });
  },
};

// Days left only go down, until someone renews it.
function buildCertificateExpiringTemplate(data: {
  id: string;
  days: number;
  severity: OpenStackAlertTemplateSeverity;
  checkNext: string;
}): OpenStackAlertTemplate {
  const name: string = `Public Certificate Expiring in ${data.days} Days`;

  return {
    id: data.id,
    name: name,
    summary: `A public endpoint's certificate expires in under ${data.days} days.`,
    description: `Alert when the certificate on an endpoint the catalog names expires in under ${data.days} days, as read by a probe outside the cloud off the connection it made. One incident per host and port, and it stays open past the expiry, when every user's connection starts failing. ${TURN_ON_API_CHECKS} Check \`openstack endpoint list --interface public\` for what is on that host, and ${data.checkNext}`,
    category: "Availability",
    severity: data.severity,
    requiresCheck: "api",
    getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
      return buildOpenStackMonitorStep({
        openstackMonitor: buildOpenStackSeriesConfig({
          cloudIdentifier: args.cloudIdentifier,
          queries: [
            {
              alias: "days_left",
              metricName: OpenStackCheckMetric.CertificateExpiry,
              aggregationType: MetricsAggregationType.Min,
            },
          ],
          rollingTime: CHECK_WINDOW,
          groupByAttributeKeys: [REGION, "host", "port"],
          anchorMetricName: OpenStackCheckMetric.TokenSuccess,
        }),
        offlineCriteriaInstance: buildOfflineCriteria({
          notification: {
            args,
            incidentTitle: `[OpenStack] ${name}`,
            incidentDescription: `The certificate on an endpoint this cloud's catalog names expires in under ${data.days} days. When it does, every connection to that API fails. Run openstack endpoint list --interface public to check what is on the host named above, and ${data.checkNext} The incident resolves on its own once the check sees a renewed one.`,
            criteriaName: `${name} - under ${data.days} days left`,
            criteriaDescription: `Triggers when the certificate on a public endpoint has under ${data.days} days left for the whole window.`,
          },
          metricAlias: "days_left",
          filterType: FilterType.LessThan,
          value: data.days,
        }),
        onlineCriteriaInstance: countGoneSeriesAsRecovered(
          buildHealthyCriteriaInstance({
            onlineMonitorStatusId: args.onlineMonitorStatusId,
            metricAlias: "days_left",
            filterType: FilterType.GreaterThanOrEqualTo,
            value: data.days,
            filterCondition: FilterCondition.All,
          }),
        ),
      });
    },
  };
}

const certificateExpiringIn30DaysTemplate: OpenStackAlertTemplate =
  buildCertificateExpiringTemplate({
    id: "openstack-public-certificate-expiring-30-days",
    days: OPENSTACK_CERTIFICATE_EXPIRY_WARNING_DAYS,
    severity: "Warning",
    checkNext: "renew it while there is time to.",
  });

const certificateExpiringIn7DaysTemplate: OpenStackAlertTemplate =
  buildCertificateExpiringTemplate({
    id: "openstack-public-certificate-expiring-7-days",
    days: OPENSTACK_CERTIFICATE_EXPIRY_CRITICAL_DAYS,
    severity: "Critical",
    checkNext: "renew it now.",
  });

// One part of the lifecycle check, in one region, as its last run left it.
function buildLifecyclePhaseFloorStep(data: {
  args: OpenStackAlertTemplateArgs;
  service: OpenStackServiceType;
  alias: string;
  phase: OpenStackLifecyclePhase;
  words: IncidentWords;
}): MonitorStep {
  return buildFloorStep({
    args: data.args,
    service: data.service,
    anchorMetricName: OpenStackCheckMetric.LifecycleSuccess,
    rollingTime: CHECK_WINDOW,
    groupByAttributeKeys: REGION_GROUP,
    queries: [
      {
        alias: data.alias,
        metricName: OpenStackCheckMetric.LifecyclePhaseSuccess,
        aggregationType: MetricsAggregationType.Min,
        attributes: { phase: data.phase },
      },
    ],
    words: data.words,
  });
}

const instanceBootFailingTemplate: OpenStackAlertTemplate = {
  id: "openstack-instance-boot-failing",
  name: "Instance Boot Failing",
  summary: "The last lifecycle run could not boot an instance in this region.",
  description: `Alert when the last lifecycle run in a region could not boot an instance: Nova refused it, its server went to ERROR, or it never reached ACTIVE. Opens within minutes of the run and closes within minutes of the next run that boots. One incident per region, and it says the step and the fault Nova gave. Every service can read healthy while this fires, which is what this is for. ${TURN_ON_LIFECYCLE} Check \`openstack compute service list\`, then the scheduler's and conductor's logs, and Placement.`,
  category: "Compute",
  severity: "Critical",
  requiresCheck: "lifecycle",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildLifecyclePhaseFloorStep({
      args,
      service: OpenStackServiceType.Compute,
      alias: "boot_passed",
      phase: OpenStackLifecyclePhase.Boot,
      words: {
        incidentTitle: "[OpenStack] Instance Boot Failing",
        incidentDescription: `A probe outside this cloud tried to do what a user does, and could not boot an instance. New instances are probably failing for your users too, whatever each service reports. Check openstack compute service list, then the logs of nova-scheduler and nova-conductor, and Placement. The step that failed and the fault Nova gave are below. The incident resolves on its own once a run boots an instance again.`,
        criteriaName: "Instance Boot Failing - the last run could not boot",
        criteriaDescription:
          "Triggers when the last lifecycle run in a region could not boot an instance.",
      },
    });
  },
};

const instanceBootSlowTemplate: OpenStackAlertTemplate = {
  id: "openstack-instance-boot-slow",
  name: "Instance Boot Slow",
  summary: `The last lifecycle run took over ${OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS / 60} minutes to reach ACTIVE.`,
  description: `Alert when the last lifecycle run in a region took over ${OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS} seconds to take a server from Nova accepting it to ACTIVE, which is how long OpenStack's own tests allow (Tempest's build_timeout). It boots the small flavor and image the check was given, so your own will take longer. One incident per region. With an OSProfiler key saved on the Checks page, the run has a trace. ${TURN_ON_LIFECYCLE} Check \`openstack compute service list\`, then what the image and the network are doing on the compute hosts.`,
  category: "Compute",
  severity: "Warning",
  requiresCheck: "lifecycle",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildCeilingStep({
      args,
      service: OpenStackServiceType.Compute,
      rollingTime: CHECK_WINDOW,
      anchorMetricName: OpenStackCheckMetric.LifecycleSuccess,
      groupByAttributeKeys: REGION_GROUP,
      queries: [
        {
          alias: "boot_seconds",
          metricName: OpenStackCheckMetric.LifecycleStepDuration,
          aggregationType: MetricsAggregationType.Max,
          attributes: { step: OpenStackLifecycleStep.ServerActive },
        },
      ],
      aliases: ["boot_seconds"],
      value: OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS,
      words: {
        incidentTitle: "[OpenStack] Instance Boot Slow",
        incidentDescription: `The last lifecycle run took over ${OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS} seconds to reach ACTIVE, with a small flavor and image, so your users' instances are probably slower still. Check openstack compute service list, then whether the compute hosts are copying images and how quickly ports are being wired. If an OSProfiler key is saved on the Checks page, the run below has a trace. The incident resolves on its own once a run boots faster.`,
        criteriaName: `Instance Boot Slow - over ${OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS} seconds`,
        criteriaDescription: `Triggers when the last lifecycle run took over ${OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS} seconds to reach ACTIVE.`,
      },
    });
  },
};

const volumeAttachFailingTemplate: OpenStackAlertTemplate = {
  id: "openstack-volume-attach-failing",
  name: "Volume Attach Failing",
  summary: "The last lifecycle run could not create or attach a volume.",
  description: `Alert when the last lifecycle run in a region could not create a volume or attach it to its server. One incident per region, and it says the step and what Cinder or Nova gave as the reason. ${TURN_ON_LIFECYCLE} It also needs the volume part of the check on. Check \`openstack volume service list\`, then cinder-volume's logs and the storage backend behind it.`,
  category: "Storage",
  severity: "Critical",
  requiresCheck: "lifecycle",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildLifecyclePhaseFloorStep({
      args,
      service: OpenStackServiceType.Volume,
      alias: "volume_passed",
      phase: OpenStackLifecyclePhase.Volume,
      words: {
        incidentTitle: "[OpenStack] Volume Attach Failing",
        incidentDescription: `A probe outside this cloud could not create a volume or attach it to a server it had just booted, so your users probably cannot either. Volumes already attached usually carry on. Check openstack volume service list, then cinder-volume's logs and the storage backend behind it. The step that failed and what the service gave as the reason are below. The incident resolves on its own once a run attaches a volume again.`,
        criteriaName: "Volume Attach Failing - the last run could not attach",
        criteriaDescription:
          "Triggers when the last lifecycle run in a region could not create or attach a volume.",
      },
    });
  },
};

const floatingIpUnreachableTemplate: OpenStackAlertTemplate = {
  id: "openstack-floating-ip-unreachable",
  name: "Floating IP Unreachable",
  summary: "The last lifecycle run could not reach its server's floating IP.",
  description: `Alert when the last lifecycle run in a region could not give its server a floating IP, or got no ping back from one. One incident per region, and it says the step and what Neutron gave as the reason. A probe with no route to the floating range reads the same, so run it from where your users are. ${TURN_ON_LIFECYCLE} It also needs the floating IP part of the check on. Check \`openstack network agent list\`, then the router and whatever carries the external network.`,
  category: "Network",
  severity: "Critical",
  requiresCheck: "lifecycle",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildLifecyclePhaseFloorStep({
      args,
      service: OpenStackServiceType.Network,
      alias: "floating_ip_passed",
      phase: OpenStackLifecyclePhase.FloatingIp,
      words: {
        incidentTitle: "[OpenStack] Floating IP Unreachable",
        incidentDescription: `A probe outside this cloud booted a server and could not reach it through a floating IP, so your users' new instances may be unreachable too. Addresses already in use may carry on. Check openstack network agent list, then the router and whatever carries the external network, and that the probe has a route to the floating range. The step that failed and what it met are below. The incident resolves on its own once a run reaches its server again.`,
        criteriaName: "Floating IP Unreachable - the last run got no reply",
        criteriaDescription:
          "Triggers when the last lifecycle run in a region could not reach its server through a floating IP.",
      },
    });
  },
};

// --- Capacity ---

/*
 * Whether a flavor fits, whether a zone can lose a host and when something fills up take every host
 * and flavor to work out, so OneUptime writes these series itself from each cloud's rows
 * (OpenStackCapacitySeries), every two minutes while it reports. Each is written only when it can
 * say something: a flavor no host could ever hold, one whose only room is on a host someone
 * disabled, a zone with a host someone disabled, and anything too new to forecast all have no
 * series, and so nothing to fire on. Allocation, not load: an idle instance holds all of it.
 */
const FLAVOR_GROUP: Array<string> = [REGION, "flavor_id", "flavor"];
const ZONE_GROUP: Array<string> = [REGION, "availability_zone"];
const CAPACITY_GROUP: Array<string> = [
  REGION,
  OPENSTACK_CAPACITY_SCOPE_LABEL,
  OPENSTACK_CAPACITY_NAME_LABEL,
  OPENSTACK_CAPACITY_RESOURCE_LABEL,
];

const flavorCannotBePlacedTemplate: OpenStackAlertTemplate = {
  id: "openstack-flavor-cannot-be-placed",
  name: "Flavor Can No Longer Be Placed",
  summary: "No host has room for one more of a flavor people can ask for.",
  description: `Alert when no host can take one more of a flavor for 10 minutes: booting one now fails with No valid host. Counted host by host, from openstack_capacity_flavor_fits, which a probe reads from Placement's own allocation candidates, so it respects traits, and which a cloud on the agent works out from inventories. One incident per flavor per region. Only flavors someone can ask for (public ones and private ones in use), and never one too large for every host, which was never going to fit, or one whose only room is on a host someone disabled, which is planned work. This is allocation, not load. On the cloud's Capacity page, the flavor's row says how many would fit if what is free were on one host, which tells a full cloud from a fragmented one. Check \`openstack allocation candidate list --resource VCPU=<vcpus> --resource MEMORY_MB=<ram> --resource DISK_GB=<disk>\`, then move instances to make a whole host's room, or add capacity.`,
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Placement,
      groupByAttributeKeys: FLAVOR_GROUP,
      queries: [
        {
          alias: "room_for",
          metricName: OPENSTACK_CAPACITY_FLAVOR_FITS_SERIES,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Flavor Can No Longer Be Placed",
        incidentDescription: `No host has room for one more of the flavor named above, so anyone booting one now is told No valid host. This is what has been promised, not what is busy. The cloud's Capacity page says whether the cloud is full or only fragmented: free capacity spread too thinly for one instance of this size. Check openstack allocation candidate list for the flavor's size, then live-migrate instances to make a whole host's room, or add capacity. The incident resolves on its own once a host has room.`,
        criteriaName: "Flavor Can No Longer Be Placed - room for < 1",
        criteriaDescription:
          "Triggers when no host has room for one more of a flavor for the whole window.",
      },
    });
  },
};

/*
 * How long until something is full, at its growth over the last week. Each thing that fills up is
 * one series, so this is one template: a zone's vCPUs, memory or disk, an external network's IPv4
 * addresses and a storage pool's bytes alike. It reads a number the worker worked out rather than
 * a forecast criteria's own fit, because a page and an alert that disagree about when something
 * fills up are how people stop trusting both: this number is what the Capacity page says.
 */
const capacityForecastUnderDaysTemplate: OpenStackAlertTemplate = {
  id: "openstack-capacity-forecast-under-days",
  name: `Capacity Forecast Under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} Days`,
  summary: `Something fills up in under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} days at its growth this week.`,
  description: `Alert when a zone's vCPUs, memory or disk, an external network's IPv4 addresses or a storage pool will be full in under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} days, for 10 minutes, at its growth over the last week. Reads openstack_capacity_days_until_full: a straight line through what was allocated, against what there is today. One incident per zone and resource class, network or pool. A new cloud stays quiet until it has a day of history, and something not growing has nothing to project. This is allocation, not load: it is how soon Placement runs out of things to promise. Check the cloud's Capacity page, which lists what fills up soonest first, and \`openstack server list --all-projects --long\` for what is growing, then add capacity or ask its owner.`,
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Placement,
      groupByAttributeKeys: CAPACITY_GROUP,
      queries: [
        {
          alias: "days_until_full",
          metricName: OPENSTACK_CAPACITY_DAYS_UNTIL_FULL_SERIES,
          aggregationType: MetricsAggregationType.Max,
        },
      ],
      value: OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
      words: {
        incidentTitle: `[OpenStack] Capacity Forecast Under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} Days`,
        incidentDescription: `What is named above will be full in under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} days at its growth over the last week. The cloud's Capacity page lists what fills up soonest first. Check openstack server list --all-projects for a zone, openstack floating ip list --network for an external network and openstack volume list --all-projects for a pool to find what is growing, then add capacity before it fills, or ask its owner. The incident resolves on its own once it has longer than that.`,
        criteriaName: `Capacity Forecast - days until full < ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS}`,
        criteriaDescription: `Triggers when something will be full in under ${OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS} days at its recent growth, for the whole window.`,
      },
    });
  },
};

/*
 * Whether a zone could lose its largest host and still fit what runs on it, as VMware's Host failure
 * asks of a cluster. Min across the classes, so any one of them short reads 0, and it is one
 * incident for the zone however many are.
 */
const reservedHeadroomGoneTemplate: OpenStackAlertTemplate = {
  id: "openstack-reserved-headroom-gone",
  name: "Reserved Headroom Gone",
  summary: "A zone can't lose its largest host and still fit what runs on it.",
  description: `Alert when a zone could not lose its largest host and still fit what runs on it, for 10 minutes: what is allocated, on any host in the zone, against what its other hosts could promise. Reads openstack_capacity_can_lose_a_host, one series per zone and resource class. One incident per zone. A zone with fewer than two hosts has nothing to say, and neither does one with a host someone disabled, because that is planned work and it says so on the Capacity page. It compares amounts rather than where each instance would land, so passing means an evacuation has room, not that every instance finds a host: the Capacity page's flavor table shows what is fragmented. This is allocation, not load. Check \`openstack hypervisor list --long\` for what each host holds, then add capacity, or move instances out of the zone.`,
  category: "Capacity",
  severity: "Warning",
  getMonitorStep: (args: OpenStackAlertTemplateArgs): MonitorStep => {
    return buildFloorStep({
      args,
      service: OpenStackServiceType.Placement,
      groupByAttributeKeys: ZONE_GROUP,
      queries: [
        {
          alias: "can_lose_a_host",
          metricName: OPENSTACK_CAPACITY_CAN_LOSE_A_HOST_SERIES,
          aggregationType: MetricsAggregationType.Min,
        },
      ],
      words: {
        incidentTitle: "[OpenStack] Reserved Headroom Gone",
        incidentDescription: `If this zone lost its largest host now, its other hosts could not fit what runs on it, so some instances would have nowhere to be evacuated to. Check openstack hypervisor list --long and the cloud's Capacity page, which says which resource is short and by how much, then add capacity, or move instances out of the zone. The incident resolves on its own once it could lose a host again.`,
        criteriaName: "Reserved Headroom Gone - can lose a host < 1",
        criteriaDescription:
          "Triggers when a zone could not lose its largest host and still fit what runs on it for the whole window.",
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
    tokenIssueFailingTemplate,
    serviceApiCheckFailingTemplate,
    certificateExpiringIn30DaysTemplate,
    certificateExpiringIn7DaysTemplate,
    instanceBootFailingTemplate,
    instanceBootSlowTemplate,
    volumeAttachFailingTemplate,
    floatingIpUnreachableTemplate,
    orchestrationApiDownTemplate,
    containerInfraApiDownTemplate,
    ratingApiDownTemplate,
    computeServiceDownTemplate,
    schedulerOrConductorDownTemplate,
    everySchedulerOrConductorDownTemplate,
    networkAgentDownTemplate,
    blockStorageServiceDownTemplate,
    orchestrationEngineDownTemplate,
    containerInfraConductorDownTemplate,
    ...getAllOpenStackControlPlaneAlertTemplates(),
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
    imageStuckTemplate,
    stackFailedTemplate,
    stackStuckTemplate,
    containerClusterFailedTemplate,
    containerClusterStuckTemplate,
    bareMetalApiDownTemplate,
    bareMetalConductorDownTemplate,
    sharedFileSystemsApiDownTemplate,
    shareServiceDownTemplate,
    shareInErrorTemplate,
    shareStuckTemplate,
    databaseApiDownTemplate,
    databaseInstanceInErrorTemplate,
    databaseInstanceStuckTemplate,
    databaseVolumeNearlyFullTemplate,
    bareMetalNodeInErrorTemplate,
    bareMetalNodeStuckTemplate,
    bareMetalNodeMaintenanceTooLongTemplate,
    bareMetalPowerStateUnexpectedTemplate,
    projectQuotaNearlyReachedTemplate,
    flavorCannotBePlacedTemplate,
    capacityForecastUnderDaysTemplate,
    reservedHeadroomGoneTemplate,
  ];
}

/*
 * What a cloud can be offered: every template, but for those that need what it doesn't have. Nothing
 * known about it is no grounds to offer more than every cloud has.
 */
export function getOpenStackAlertTemplatesForCloud(cloud: {
  services?: ReadonlyArray<string> | null | undefined;
  isCollectedByProbe?: boolean | null | undefined;
  isApiCheckOn?: boolean | null | undefined;
  isLifecycleCheckOn?: boolean | null | undefined;
}): Array<OpenStackAlertTemplate> {
  return getAllOpenStackAlertTemplates().filter(
    (template: OpenStackAlertTemplate): boolean => {
      if (template.requiresProbe && cloud.isCollectedByProbe !== true) {
        return false;
      }
      if (template.requiresCheck === "api" && cloud.isApiCheckOn !== true) {
        return false;
      }
      if (
        template.requiresCheck === "lifecycle" &&
        cloud.isLifecycleCheckOn !== true
      ) {
        return false;
      }
      return (
        !template.forService ||
        Boolean(cloud.services?.includes(template.forService))
      );
    },
  );
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
