import {
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../Billing/PayAsYouGoPricing";
import {
  OpenStackInstanceMetricsMode,
  OpenStackInstanceMetricsOptions,
} from "./OpenStackInstanceMetrics";
import { OpenStackServiceType } from "./OpenStackResourceKind";

/*
 * WHAT A CLOUD OF ANY SIZE COSTS, BEFORE ANYTHING IS INSTALLED.
 *
 * Two numbers a reviewer wants first: how hard monitoring leans on the control plane, and how
 * much data it sends. Both follow from a cloud's counts, so both are worked out here, in one
 * place the docs, the guide's calculator and the tests read.
 *
 * Neither is a guess. OpenStackScaleBudget.test.ts runs the real collector against a mock API
 * of each size and holds what it really asked for, and what it really sent, to these numbers
 * exactly. A request count does not depend on the machine it was counted on.
 *
 * Pure, so the pages, the probe and the server all read it.
 */

export interface OpenStackCloudCounts {
  regions: number;
  hypervisors: number;
  instances: number;
  projects: number;
  domains: number;
  volumes: number;
  snapshots: number;
  backups: number;
  networks: number;
  subnets: number;
  routers: number;
  floatingIps: number;
  securityGroups: number;
  images: number;
  flavors: number;
  // Nova's own workers beside its nova-computes: schedulers and conductors.
  novaControlServices: number;
  // Neutron's agents, however many a hypervisor runs.
  networkAgents: number;
  cinderServices: number;
  storagePools: number;
}

/*
 * The sizes the product is tested at. Only the first three numbers of each come from the issue:
 * what a cloud holds besides is an assumption, stated here and in the docs, and a real cloud's
 * own counts go in the calculator.
 */
export function getOpenStackCountsOfSize(data: {
  hypervisors: number;
  instances: number;
  projects: number;
  regions?: number | undefined;
}): OpenStackCloudCounts {
  const volumes: number = Math.ceil(data.instances / 2);

  return {
    regions: data.regions ?? 1,
    hypervisors: data.hypervisors,
    instances: data.instances,
    projects: data.projects,
    domains: 1,
    volumes: volumes,
    snapshots: Math.ceil(volumes / 10),
    backups: Math.ceil(volumes / 10),
    // One each per project, and the external network everyone shares.
    networks: data.projects + 1,
    subnets: data.projects + 1,
    routers: data.projects,
    floatingIps: Math.ceil(data.instances / 10),
    securityGroups: data.projects,
    images: Math.min(1000, Math.max(10, Math.ceil(data.projects / 10))),
    flavors: 40,
    novaControlServices: 6,
    // OVN's controller and metadata agent on every hypervisor.
    networkAgents: data.hypervisors * 2,
    cinderServices: 6,
    storagePools: Math.max(1, Math.ceil(data.hypervisors / 250)),
  };
}

export const OPENSTACK_SMALL_CLOUD: OpenStackCloudCounts =
  getOpenStackCountsOfSize({ hypervisors: 10, instances: 100, projects: 20 });
export const OPENSTACK_MEDIUM_CLOUD: OpenStackCloudCounts =
  getOpenStackCountsOfSize({
    hypervisors: 500,
    instances: 20000,
    projects: 1000,
  });
export const OPENSTACK_LARGE_CLOUD: OpenStackCloudCounts =
  getOpenStackCountsOfSize({
    hypervisors: 5000,
    instances: 200000,
    projects: 10000,
  });

/*
 * ---------------------------------------------------------------------------
 * Summary mode
 * ---------------------------------------------------------------------------
 *
 * Past this many instances a cloud keeps counts and rows, and no series per instance or per
 * volume. Where it sits: a cloud this size sends about 14 GB a day of per-instance series and
 * about 7 GB a day of everything else (getOpenStackSeriesCounts, at the bill's row size), so from
 * here those series are most of the bill, and they say what the rows and the counts already say.
 * Far below it they cost less than the cloud's other parts do.
 */
export const OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT: number = 5000;

// One series per instance or instance's allocation, or per volume. The rows are read from these.
export const OPENSTACK_SUMMARY_MODE_SERIES: ReadonlySet<string> = new Set([
  "openstack_nova_server_status",
  "openstack_nova_server_local_gb",
  "openstack_placement_resource_provider_allocations",
  "openstack_cinder_volume_gb",
  "openstack_cinder_volume_status",
]);

/*
 * The statuses that say nothing is wrong. Everything else is a state the alert templates watch
 * (ERROR, or stuck in BUILD, RESIZE, attaching and the like), and a series that goes away reads
 * as recovered, so a part in one of those keeps its series in summary mode too.
 */
const SETTLED_STATUSES: Readonly<Record<string, ReadonlySet<string>>> = {
  openstack_nova_server_status: new Set([
    "ACTIVE",
    "SHUTOFF",
    "SUSPENDED",
    "PAUSED",
    "SHELVED",
    "SHELVED_OFFLOADED",
  ]),
  openstack_cinder_volume_gb: new Set(["available", "in-use"]),
  openstack_cinder_volume_status: new Set(["available", "in-use"]),
};

export function isOpenStackSummaryMode(data: {
  options: Pick<OpenStackInstanceMetricsOptions, "mode">;
  instanceCount: number | null | undefined;
}): boolean {
  return (
    data.options.mode !== OpenStackInstanceMetricsMode.All &&
    (data.instanceCount || 0) > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT
  );
}

/*
 * Whether a datapoint of one of these series is kept in summary mode. A part in a project someone
 * chose keeps its series: that is what the choice is for. So does one in a state an alert is
 * watching. Anything that is not one of these series is no business of summary mode.
 */
export function isOpenStackSeriesKeptInSummaryMode(data: {
  metricName: string;
  status: string | null | undefined;
  projectId: string | null | undefined;
  keptProjectIds: ReadonlySet<string>;
}): boolean {
  if (!OPENSTACK_SUMMARY_MODE_SERIES.has(data.metricName)) {
    return true;
  }

  const settled: ReadonlySet<string> | undefined =
    SETTLED_STATUSES[data.metricName];

  // An allocation names neither a project nor a state, and no page or alert reads one.
  if (!settled) {
    return false;
  }

  if (data.projectId && data.keptProjectIds.has(data.projectId)) {
    return true;
  }

  return !settled.has(data.status || "");
}

/*
 * What a probe sends of a large cloud's parts each collection: what changed, and a turn's share of
 * the rest (OpenStackRollingSend), sized so a collection's upload stays about this large however
 * large the cloud, within a stated time for a row to come round.
 */
export const OPENSTACK_ROLLING_TARGET_BYTES_PER_COLLECTION: number =
  24 * 1024 * 1024;
export const OPENSTACK_MAX_ROLLING_TURNS: number = 30;

/*
 * About what one such datapoint comes to as JSON, measured on the mock at each size: an instance's
 * is about 1,300 bytes and a floating IP's about 550. It only sizes the turns.
 */
export const OPENSTACK_ROLLING_BYTES_PER_DATAPOINT: number = 1100;

export function getOpenStackRollingTurns(rollingDatapoints: number): number {
  return Math.min(
    OPENSTACK_MAX_ROLLING_TURNS,
    Math.max(
      1,
      Math.ceil(
        (rollingDatapoints * OPENSTACK_ROLLING_BYTES_PER_DATAPOINT) /
          OPENSTACK_ROLLING_TARGET_BYTES_PER_COLLECTION,
      ),
    ),
  );
}

// The datapoints sent in turns, per region: the same series OPENSTACK_ROLLING_SERIES names.
export function getOpenStackRollingDatapoints(
  counts: OpenStackCloudCounts,
): number {
  return (
    counts.instances +
    counts.volumes * 2 +
    counts.snapshots +
    counts.backups +
    counts.networks +
    counts.subnets +
    counts.routers +
    counts.floatingIps +
    counts.images * 2 +
    counts.projects
  );
}

// What summary mode leaves in place of the series: per status and per project, in each region.
export const OPENSTACK_INSTANCES_BY_STATUS_SERIES: string =
  "openstack_nova_instances_by_status";
export const OPENSTACK_INSTANCES_BY_PROJECT_SERIES: string =
  "openstack_nova_instances_by_project";

/*
 * ---------------------------------------------------------------------------
 * The database exporter
 * ---------------------------------------------------------------------------
 *
 * Offered past these. The exporter of OpenStack's APIs reads Placement one call at a time, three
 * calls per hypervisor, and a scrape has 110 seconds: at a brisk 20 ms a call that is about 1,800
 * hypervisors. It reads /servers/detail a thousand at a time: at a second a page, about 110,000
 * instances. Below these the APIs answer well enough, and the database path gives things up.
 */
export const OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT: number = 1500;
export const OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT: number = 100000;

export function isOpenStackDatabasePathOffered(
  counts: Pick<OpenStackCloudCounts, "hypervisors" | "instances">,
): boolean {
  return (
    counts.hypervisors > OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT ||
    counts.instances > OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT
  );
}

/*
 * ---------------------------------------------------------------------------
 * The load on the control plane
 * ---------------------------------------------------------------------------
 */

// What the probe's own constants are, so a change to any of them moves the docs' numbers.
export const OPENSTACK_LIST_PAGE_SIZE: number = 1000;
export const OPENSTACK_FULL_INSTANCE_READ_EVERY_MINUTES: number = 30;
export const OPENSTACK_TOKEN_LIFE_IN_MINUTES: number = 60;
export const OPENSTACK_TOKEN_MARGIN_IN_MINUTES: number = 5;
export const OPENSTACK_NEUTRON_EXTENSIONS_EVERY_MINUTES: number = 60;

/*
 * The most calls a collection makes that are one call per thing: a hypervisor's usages, a
 * router's agents, a project's quotas. Past this a cloud's lists are read in turns rather than
 * all at once. What was not read this time is sent as last read, so no series has a gap, and the
 * load stays where it is however many more of them the cloud grows: only how fresh they are
 * moves. At a thousand a minute this is about 3 calls a second on each of those services.
 */
export const OPENSTACK_PER_PART_READS_PER_COLLECTION: number = 2000;

// A project's quotas are four calls, and change on a person's timescale.
export const OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION: number = 250;

export type OpenStackNetworkBackend = "ovn" | "ovs";

export interface OpenStackProbeLoadOptions {
  collectionIntervalInMinutes?: number | undefined;
  networkBackend?: OpenStackNetworkBackend | undefined;
  isSummaryMode?: boolean | undefined;
  // The answer to changes-since on a collection between full reads, how many instances changed.
  instancesChangedPerCollection?: number | undefined;
  // Providers whose generation moved since the last collection: their inventories are read again.
  providersChangedPerCollection?: number | undefined;
  collectProjectLimits?: boolean | undefined;
}

export type OpenStackRequestsByService = Record<OpenStackServiceType, number>;

function noRequests(): OpenStackRequestsByService {
  return {
    [OpenStackServiceType.Identity]: 0,
    [OpenStackServiceType.Compute]: 0,
    [OpenStackServiceType.Placement]: 0,
    [OpenStackServiceType.Network]: 0,
    [OpenStackServiceType.Volume]: 0,
    [OpenStackServiceType.Image]: 0,
  };
}

/*
 * How many requests a list of this many takes, a thousand at a time. A page that comes back full
 * offers another, so a list of exactly a thousand takes a second request, for nothing.
 */
export function getOpenStackListRequests(
  rows: number,
  pageSize: number = OPENSTACK_LIST_PAGE_SIZE,
): number {
  return Math.floor(rows / pageSize) + 1;
}

export function getOpenStackSlowServiceEveryMinutes(
  collectionIntervalInMinutes: number,
): number {
  const minutes: number = Math.max(collectionIntervalInMinutes, 1);

  return Math.max(Math.floor(5 / minutes), 1) * minutes;
}

/*
 * The requests the probe makes over a stretch of time, per region: it walks the same schedule
 * the collector keeps, collection by collection, starting cold at minute zero. So the first hour
 * includes what only a first collection reads, and an hour later on does not.
 */
export function simulateOpenStackProbeRequests(data: {
  counts: OpenStackCloudCounts;
  fromMinute: number;
  toMinute: number;
  options?: OpenStackProbeLoadOptions | undefined;
}): OpenStackRequestsByService {
  const { counts } = data;
  const options: OpenStackProbeLoadOptions = data.options || {};
  const interval: number = options.collectionIntervalInMinutes ?? 2;
  const isOvs: boolean = options.networkBackend === "ovs";
  const isSummary: boolean =
    options.isSummaryMode ??
    counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT;
  const changed: number = options.instancesChangedPerCollection ?? 0;
  const slowEvery: number = getOpenStackSlowServiceEveryMinutes(interval);

  const fullEvery: number =
    Math.ceil(OPENSTACK_FULL_INSTANCE_READ_EVERY_MINUTES / interval) * interval;

  const requests: OpenStackRequestsByService = noRequests();
  const add: (service: OpenStackServiceType, count: number) => void = (
    service: OpenStackServiceType,
    count: number,
  ): void => {
    requests[service] += count;
  };

  let tokenValidUntil: number = -1;
  let extensionsReadAt: number = -Infinity;

  for (let minute: number = 0; minute < data.toMinute; minute += interval) {
    const isCounted: boolean = minute >= data.fromMinute;
    const count: (service: OpenStackServiceType, value: number) => void = (
      service: OpenStackServiceType,
      value: number,
    ): void => {
      if (isCounted) {
        add(service, value);
      }
    };

    if (minute >= tokenValidUntil) {
      tokenValidUntil =
        minute +
        OPENSTACK_TOKEN_LIFE_IN_MINUTES -
        OPENSTACK_TOKEN_MARGIN_IN_MINUTES;
      count(OpenStackServiceType.Identity, 1);
    }

    if (minute % slowEvery === 0) {
      // Domains, projects, regions, users and groups: Keystone pages none of them.
      count(OpenStackServiceType.Identity, 5);
      count(OpenStackServiceType.Image, getOpenStackListRequests(counts.images));
    }

    const isFullRead: boolean = minute % fullEvery === 0;

    // Its versions, services, aggregates and zones, then the lists.
    count(
      OpenStackServiceType.Compute,
      4 +
        getOpenStackListRequests(counts.hypervisors) +
        getOpenStackListRequests(counts.flavors) +
        getOpenStackListRequests(isFullRead ? counts.instances : changed),
    );

    const perPartReads: number = Math.min(
      counts.hypervisors,
      OPENSTACK_PER_PART_READS_PER_COLLECTION,
    );

    /*
     * A list of providers, and each one's usages. Its inventories only the first time, because
     * Placement moves a provider's generation whenever they change. Allocations are one more
     * call per provider, which summary mode has no use for. A first collection reads every
     * provider there is, whatever the size, and cannot know yet that the cloud is past the
     * summary size, so it reads a turn's worth of allocations.
     */
    count(
      OpenStackServiceType.Placement,
      minute === 0
        ? 1 + counts.hypervisors * 2 + perPartReads
        : 1 +
            perPartReads +
            (isSummary ? 0 : perPartReads) +
            Math.min(
              options.providersChangedPerCollection ?? 0,
              OPENSTACK_PER_PART_READS_PER_COLLECTION,
            ),
    );

    // Agents, networks, subnets, routers, floating IPs, address pools and security groups.
    let network: number =
      getOpenStackListRequests(counts.networkAgents) +
      getOpenStackListRequests(counts.networks) +
      getOpenStackListRequests(counts.subnets) +
      getOpenStackListRequests(counts.routers) +
      getOpenStackListRequests(counts.floatingIps) +
      getOpenStackListRequests(counts.networks) +
      getOpenStackListRequests(counts.securityGroups);

    if (
      minute - extensionsReadAt >
      OPENSTACK_NEUTRON_EXTENSIONS_EVERY_MINUTES
    ) {
      extensionsReadAt = minute;
      network += 1;
    }

    if (isOvs) {
      network += Math.min(
        counts.routers,
        OPENSTACK_PER_PART_READS_PER_COLLECTION,
      );
    }

    count(OpenStackServiceType.Network, network);

    // Services and pools, then the lists.
    count(
      OpenStackServiceType.Volume,
      2 +
        getOpenStackListRequests(counts.volumes) +
        getOpenStackListRequests(counts.snapshots) +
        getOpenStackListRequests(counts.backups),
    );

    if (options.collectProjectLimits) {
      const projects: number = Math.min(
        counts.projects,
        OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
      );

      count(OpenStackServiceType.Compute, projects * 2);
      count(OpenStackServiceType.Network, projects);
      count(OpenStackServiceType.Volume, projects);
    }
  }

  for (const service of Object.keys(requests) as Array<OpenStackServiceType>) {
    requests[service] *= service === OpenStackServiceType.Identity ? 1 : counts.regions;
  }

  return requests;
}

// An hour once a collection has settled: what the docs state.
export function getOpenStackProbeRequestsPerMinute(
  counts: OpenStackCloudCounts,
  options?: OpenStackProbeLoadOptions,
): OpenStackRequestsByService {
  const hour: OpenStackRequestsByService = simulateOpenStackProbeRequests({
    counts: counts,
    fromMinute: 120,
    toMinute: 180,
    options: options,
  });
  const perMinute: OpenStackRequestsByService = noRequests();

  for (const service of Object.keys(hour) as Array<OpenStackServiceType>) {
    perMinute[service] = hour[service] / 60;
  }

  return perMinute;
}

/*
 * What the agent's exporter asks for on one scrape of a service, per region, counted from its
 * source rather than measured: the exporter is not in these tests, and its own numbers wait for
 * the rig. Every scrape logs in again. It never reads what changed: every list is read whole.
 * Placement is three calls per hypervisor, one at a time.
 */
export function getOpenStackExporterRequestsPerScrape(
  counts: OpenStackCloudCounts,
): OpenStackRequestsByService {
  const requests: OpenStackRequestsByService = noRequests();

  requests[OpenStackServiceType.Identity] = 1 + 5;
  requests[OpenStackServiceType.Compute] =
    1 +
    // Its services, its aggregates and its zones.
    3 +
    getOpenStackListRequests(counts.hypervisors) +
    getOpenStackListRequests(counts.flavors) +
    getOpenStackListRequests(counts.instances);
  requests[OpenStackServiceType.Placement] = 1 + 1 + counts.hypervisors * 3;
  requests[OpenStackServiceType.Network] =
    1 +
    getOpenStackListRequests(counts.networkAgents) +
    getOpenStackListRequests(counts.networks) +
    getOpenStackListRequests(counts.subnets) +
    getOpenStackListRequests(counts.routers) +
    getOpenStackListRequests(counts.floatingIps) +
    getOpenStackListRequests(counts.networks) +
    getOpenStackListRequests(counts.securityGroups);
  requests[OpenStackServiceType.Volume] =
    1 +
    2 +
    getOpenStackListRequests(counts.volumes) +
    getOpenStackListRequests(counts.snapshots);
  requests[OpenStackServiceType.Image] =
    1 + getOpenStackListRequests(counts.images);

  return requests;
}

/*
 * ---------------------------------------------------------------------------
 * The volume of data
 * ---------------------------------------------------------------------------
 */

/*
 * What TelemetryUsageBillingService bills a metric row as when ClickHouse has no size for it
 * (AVERAGE_METRIC_ROW_SIZE_IN_BYTES, whose default this is). The bill itself reads byteSize(*)
 * of the real rows, so this is an estimate: a series with many labels, such as an instance's,
 * costs more than this, and one with none costs less.
 */
export const OPENSTACK_AVERAGE_METRIC_ROW_SIZE_IN_BYTES: number = 1024;

// A real cloud usually holds instances in about this many statuses at once.
const STATUSES_USUALLY_PRESENT: number = 6;

export const OPENSTACK_AGENT_FAST_SCRAPES_PER_DAY: number = 720;
export const OPENSTACK_AGENT_SLOW_SCRAPES_PER_DAY: number = 288;

const SCRAPE_SERIES_PER_READING: number = 3;
const BYTES_PER_GIB: number = 1024 * 1024 * 1024;

export interface OpenStackSeriesCounts {
  // Read every collection: Nova, Placement, Neutron and Cinder.
  fast: number;
  // Read about every five minutes: Keystone and Glance.
  slow: number;
  // What goes away in summary mode: an instance's status and three allocations, a volume's two.
  perInstance: number;
}

/*
 * How many series a cloud sends, per service. Exact for the series a default collection writes:
 * OpenStackScaleBudget.test.ts holds this to what the collector really sent at each size, so a
 * series added to the collector fails there until it is counted here.
 */
export function getOpenStackSeriesCounts(data: {
  counts: OpenStackCloudCounts;
  isSummaryMode?: boolean | undefined;
  // In summary mode, the series that stay: chosen projects, and any part in a bad state.
  keptInstances?: number | undefined;
  isOvs?: boolean | undefined;
}): OpenStackSeriesCounts {
  const { counts } = data;
  const isSummary: boolean = Boolean(data.isSummaryMode);
  const perInstance: number = isSummary
    ? data.keptInstances || 0
    : counts.instances * 4 + counts.volumes * 2;

  const compute: number =
    // Nine series a hypervisor.
    counts.hypervisors * 9 +
    // A worker's state, one per nova-compute and one per control service.
    counts.hypervisors +
    counts.novaControlServices +
    counts.flavors +
    // How many flavors, zones and instances, and whether the API is up.
    4 +
    SCRAPE_SERIES_PER_READING;

  // Four series for each of three resource classes, and three usages.
  const placement: number =
    counts.hypervisors * 15 + 1 + SCRAPE_SERIES_PER_READING;

  const network: number =
    counts.networkAgents +
    counts.networks +
    counts.subnets +
    counts.routers +
    counts.floatingIps +
    // Used and total per subnet.
    counts.subnets * 2 +
    (data.isOvs ? counts.routers : 0) +
    // How many networks, subnets, routers (and how many not active), floating IPs (and how many
    // associated and not active), security groups, and whether the API is up.
    8 +
    SCRAPE_SERIES_PER_READING;

  const volume: number =
    counts.cinderServices +
    counts.storagePools * 2 +
    counts.snapshots +
    counts.backups +
    // One per status it knows, however few hold any, and how many volumes and snapshots.
    20 +
    2 +
    1 +
    SCRAPE_SERIES_PER_READING;

  const identity: number =
    counts.projects +
    counts.domains +
    // How many domains, projects, regions, users and groups, and whether the API is up.
    6 +
    SCRAPE_SERIES_PER_READING;

  const image: number =
    counts.images * 2 + 1 + 1 + SCRAPE_SERIES_PER_READING;

  const summaryCounts: number = isSummary
    ? STATUSES_USUALLY_PRESENT + counts.projects
    : 0;

  return {
    fast:
      (compute + placement + network + volume) * counts.regions +
      perInstance +
      summaryCounts * counts.regions,
    slow: identity * counts.regions + image * counts.regions,
    perInstance: perInstance,
  };
}

export interface OpenStackVolumeEstimate {
  series: number;
  datapointsPerDay: number;
  bytesPerDay: number;
  gigabytesPerDay: number;
  // At the retention given, and what TelemetryUsageBillingService charges for a GB kept that long.
  costInUSDPerMonth: number;
  // How much of the datapoints are series per instance.
  perInstanceShare: number;
}

export function estimateOpenStackVolume(data: {
  counts: OpenStackCloudCounts;
  isSummaryMode?: boolean | undefined;
  keptInstances?: number | undefined;
  isOvs?: boolean | undefined;
  retentionInDays?: number | undefined;
  fastCollectionsPerDay?: number | undefined;
  slowCollectionsPerDay?: number | undefined;
  averageRowSizeInBytes?: number | undefined;
}): OpenStackVolumeEstimate {
  const series: OpenStackSeriesCounts = getOpenStackSeriesCounts(data);
  const fastPerDay: number =
    data.fastCollectionsPerDay ?? OPENSTACK_AGENT_FAST_SCRAPES_PER_DAY;
  const slowPerDay: number =
    data.slowCollectionsPerDay ?? OPENSTACK_AGENT_SLOW_SCRAPES_PER_DAY;
  const rowSize: number =
    data.averageRowSizeInBytes ?? OPENSTACK_AVERAGE_METRIC_ROW_SIZE_IN_BYTES;
  const retention: number = data.retentionInDays ?? 15;

  const datapointsPerDay: number =
    series.fast * fastPerDay + series.slow * slowPerDay;
  const bytesPerDay: number = datapointsPerDay * rowSize;
  const gigabytesPerDay: number = bytesPerDay / BYTES_PER_GIB;

  /*
   * TelemetryMeteredPlan.getTotalCostInUSD: a GB times the days it is kept, billed for at least
   * the minimum, at the advertised price for fifteen days.
   */
  const costPerDay: number =
    gigabytesPerDay *
    Math.max(retention, TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS) *
    (TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS);

  return {
    series: series.fast + series.slow,
    datapointsPerDay: datapointsPerDay,
    bytesPerDay: bytesPerDay,
    gigabytesPerDay: gigabytesPerDay,
    costInUSDPerMonth: costPerDay * 30,
    perInstanceShare:
      datapointsPerDay === 0
        ? 0
        : (series.perInstance * fastPerDay) / datapointsPerDay,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Sharding
 * ---------------------------------------------------------------------------
 *
 * One agent or probe per region, or per service for the largest clouds. A pair of a region and
 * a service belongs to one collector: two would send every one of its series twice, and a chart
 * or a bill would read double. Keystone is one whichever region asks, so it belongs to one
 * collector for the whole cloud. Pure, so the guide and a test can both ask.
 */
export interface OpenStackCollectorShard {
  name: string;
  regions: ReadonlyArray<string>;
  services: ReadonlyArray<OpenStackServiceType>;
}

export interface OpenStackShardPlanProblem {
  regionName: string;
  service: OpenStackServiceType;
  // No collector reads it, or more than one does.
  problem: "missing" | "doubled";
  collectors: Array<string>;
}

export function getOpenStackShardPlanProblems(data: {
  regions: ReadonlyArray<string>;
  services: ReadonlyArray<OpenStackServiceType>;
  shards: ReadonlyArray<OpenStackCollectorShard>;
}): Array<OpenStackShardPlanProblem> {
  const problems: Array<OpenStackShardPlanProblem> = [];

  for (const service of data.services) {
    if (service === OpenStackServiceType.Identity) {
      // Keystone answers for every region: each shard that reads it reads the same thing.
      const collectors: Array<string> = data.shards
        .filter((shard: OpenStackCollectorShard): boolean => {
          return shard.services.includes(service);
        })
        .map((shard: OpenStackCollectorShard): string => {
          return shard.name;
        });

      if (collectors.length !== 1) {
        problems.push({
          regionName: "*",
          service: service,
          problem: collectors.length === 0 ? "missing" : "doubled",
          collectors: collectors,
        });
      }

      continue;
    }

    for (const regionName of data.regions) {
      const collectors: Array<string> = data.shards
        .filter((shard: OpenStackCollectorShard): boolean => {
          return (
            shard.services.includes(service) &&
            shard.regions.includes(regionName)
          );
        })
        .map((shard: OpenStackCollectorShard): string => {
          return shard.name;
        });

      if (collectors.length !== 1) {
        problems.push({
          regionName: regionName,
          service: service,
          problem: collectors.length === 0 ? "missing" : "doubled",
          collectors: collectors,
        });
      }
    }
  }

  return problems;
}
