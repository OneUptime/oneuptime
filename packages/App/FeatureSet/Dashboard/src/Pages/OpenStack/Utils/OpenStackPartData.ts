import Host from "Common/Models/DatabaseModels/Host";
import Metric from "Common/Models/AnalyticsModels/Metric";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "Common/Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackCountBy,
  OpenStackCountRow,
} from "Common/Types/OpenStack/OpenStackCounts";
import { getOpenStackShortHostName } from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  OpenStackApiState,
  OpenStackForecast,
  OpenStackGrowthSample,
  OpenStackSubnetAddresses,
  getOpenStackForecast,
  getOpenStackNetworkSubnets,
} from "./OpenStackPartFacts";

/*
 * What a part's page reads. Every read here is bounded: one row, the few rows around a
 * part, a server-side count, or a page of a list. A cloud can hold hundreds of thousands
 * of instances, and nothing here ever asks for a kind whole, except the hypervisors and
 * services the needs-attention read brings, which stay few at any size.
 */

const CLOUD_ATTRIBUTE: string = "resource.openstack.cloud.name";
const REGION_ATTRIBUTE: string = "openstack.region.name";

// Everything a part's page shows of a row.
export const OPENSTACK_ROW_SELECT: Select<OpenStackResource> = {
  _id: true,
  kind: true,
  externalId: true,
  name: true,
  regionName: true,
  availabilityZone: true,
  hypervisorName: true,
  openStackProjectId: true,
  status: true,
  adminState: true,
  disabledReason: true,
  stateChangedAt: true,
  vcpuCapacity: true,
  vcpuAllocated: true,
  memoryCapacityBytes: true,
  memoryAllocatedBytes: true,
  diskCapacityBytes: true,
  diskAllocatedBytes: true,
  instanceCount: true,
  facts: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

// Null when it isn't in the inventory: which a page says, as apart from a failed read.
export async function fetchOpenStackRow(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  externalId: string;
}): Promise<OpenStackResource | null> {
  const rows: Array<OpenStackResource> = await fetchOpenStackRows({
    openStackCloudId: data.openStackCloudId,
    kind: data.kind,
    query: { externalId: data.externalId },
    limit: 1,
  });
  return rows[0] || null;
}

export async function fetchOpenStackRows(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  query?: Query<OpenStackResource> | undefined;
  limit: number;
}): Promise<Array<OpenStackResource>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: data.kind,
        ...(data.query || {}),
      },
      limit: data.limit,
      skip: 0,
      select: OPENSTACK_ROW_SELECT,
      sort: {},
    });
  return result.data;
}

// A server-side count: never rows, however many there are.
export async function countOpenStackRows(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  query?: Query<OpenStackResource> | undefined;
}): Promise<number> {
  return await ModelAPI.count<OpenStackResource>({
    modelType: OpenStackResource,
    query: {
      openStackCloudId: data.openStackCloudId,
      kind: data.kind,
      ...(data.query || {}),
    },
  });
}

/*
 * The names of a few parts of one kind, by their external ids: what a list needs to draw
 * "web-01" and not a UUID in a link. Asks for no more than it was given.
 */
export async function fetchOpenStackNames(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  externalIds: Array<string>;
}): Promise<Record<string, string>> {
  if (data.externalIds.length === 0) {
    return {};
  }
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: data.kind,
        externalId: new Includes(data.externalIds),
      },
      limit: data.externalIds.length,
      skip: 0,
      select: { name: true, externalId: true },
      sort: {},
    });
  const names: Record<string, string> = {};
  for (const row of result.data) {
    if (row.externalId && row.name) {
      names[row.externalId] = row.name;
    }
  }
  return names;
}

function toRows(rows: Array<JSONObject>): Array<OpenStackResource> {
  return rows.map((row: JSONObject): OpenStackResource => {
    const resource: OpenStackResource = new OpenStackResource();
    Object.assign(resource, row);
    return resource;
  });
}

async function postToCloud(data: {
  path: string;
  openStackCloudId: ObjectID;
  body?: JSONObject | undefined;
}): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(data.path)
        .addRoute(data.openStackCloudId.toString()),
      data: data.body || {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );
  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
  return response.data;
}

/*
 * Every hypervisor and service, and the instances, volumes and the rest that may need
 * someone, chosen by the rules' own lines. What a zone or an aggregate adds up from.
 */
export async function fetchOpenStackAttentionRows(
  openStackCloudId: ObjectID,
  regionName?: string | null | undefined,
): Promise<Array<OpenStackResource>> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/needs-attention/",
    openStackCloudId,
    ...(regionName ? { body: { regionName } } : {}),
  });
  return toRows((answer["rows"] as Array<JSONObject>) || []);
}

export async function fetchOpenStackBlastRadius(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  externalId: string;
}): Promise<OpenStackBlastRadius> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/blast-radius/",
    openStackCloudId: data.openStackCloudId,
    body: { kind: data.kind, externalId: data.externalId },
  });
  return {
    ...getEmptyOpenStackBlastRadius(),
    ...(answer as unknown as OpenStackBlastRadius),
  };
}

// How many of a kind there are by one of what they hold, counted on the server.
export async function fetchOpenStackCounts(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  by: OpenStackCountBy;
}): Promise<Array<OpenStackCountRow>> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/counts/",
    openStackCloudId: data.openStackCloudId,
    body: { kind: data.kind, by: data.by },
  });
  return ((answer["rows"] as unknown as Array<OpenStackCountRow>) || []).map(
    (row: OpenStackCountRow): OpenStackCountRow => {
      return {
        value: row.value,
        regionName: row.regionName,
        count: Number(row.count) || 0,
        sizeBytes: Number(row.sizeBytes) || 0,
      };
    },
  );
}

/*
 * Whether each service's API answers, by its type: what tells a list that a credential
 * can't list a kind from a cloud that hasn't reported. A service with an API down in one
 * region of several is down here, because that is the one that can leave a list empty.
 */
export async function fetchOpenStackApiStates(
  openStackCloudId: ObjectID,
): Promise<Record<string, OpenStackApiState>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Api,
      },
      limit: 200,
      skip: 0,
      select: { name: true, status: true },
      sort: {},
    });
  const states: Record<string, OpenStackApiState> = {};
  for (const row of result.data) {
    const name: string = row.name || "";
    if (name && states[name] !== "down") {
      states[name] = row.status === "down" ? "down" : "up";
    }
  }
  return states;
}

// The names of the cloud's network agents, which say which backend it runs.
export async function fetchOpenStackNetworkAgentNames(
  openStackCloudId: ObjectID,
): Promise<Array<string>> {
  const facts: JSONObject = { family: "network" };
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: OpenStackResourceKind.Service,
        facts: facts,
      },
      limit: 200,
      skip: 0,
      select: { name: true },
      sort: {},
    });
  return result.data.map((row: OpenStackResource): string => {
    return row.name || "";
  });
}

/*
 * The nova-compute on a hypervisor. Nova names a service by its short host name and a
 * hypervisor by its full one, so this asks for both.
 */
export async function fetchOpenStackComputeServiceOf(data: {
  openStackCloudId: ObjectID;
  hypervisorName: string;
  regionName?: string | undefined;
}): Promise<OpenStackResource | null> {
  const short: string = getOpenStackShortHostName(data.hypervisorName);
  const rows: Array<OpenStackResource> = await fetchOpenStackRows({
    openStackCloudId: data.openStackCloudId,
    kind: OpenStackResourceKind.Service,
    query: {
      name: "nova-compute",
      hypervisorName: new Includes(
        short === data.hypervisorName ? [short] : [short, data.hypervisorName],
      ),
    },
    limit: 8,
  });
  return (
    rows.find((row: OpenStackResource): boolean => {
      return !data.regionName || row.regionName === data.regionName;
    }) || null
  );
}

/*
 * The host running OneUptime's agent on this machine, when exactly one does. No link on a
 * guess, in either direction: a name two hosts could be links to neither, and neither does a
 * host two hypervisors could both be. That takes every host and hypervisor in the project to
 * say, so the server does, the same way it does for a blast radius.
 */
export async function fetchOpenStackHostOf(
  machineName: string,
): Promise<Host | null> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/host-of-machine",
    openStackCloudId: ProjectUtil.getCurrentProjectId()!,
    body: { machineName },
  });
  const found: JSONObject | null | undefined = answer["host"] as
    | JSONObject
    | null
    | undefined;
  return found ? Object.assign(new Host(), found) : null;
}

/*
 * ---------------------------------------------------------------------------
 * Numbers only the metric store holds
 * ---------------------------------------------------------------------------
 */
function metricQuery(data: {
  metricName: string;
  attributes: Dictionary<string | number | boolean>;
  startDate: Date;
  endDate: Date;
}): Query<Metric> {
  return {
    projectId: ProjectUtil.getCurrentProjectId()!,
    time: new InBetween<Date>(data.startDate, data.endDate),
    name: data.metricName,
    attributes: data.attributes,
  } as Query<Metric>;
}

function toSamples(result: AggregatedResult): Array<OpenStackGrowthSample> {
  const samples: Array<OpenStackGrowthSample> = [];
  for (const point of (result.data || []) as Array<AggregatedModel>) {
    const raw: unknown =
      point["timestamp"] !== undefined ? point["timestamp"] : point["time"];
    const time: number =
      raw instanceof Date ? raw.getTime() : new Date(raw as string).getTime();
    const used: number = Number(point["value"]);
    if (Number.isFinite(time) && Number.isFinite(used)) {
      samples.push({ time, used });
    }
  }
  return samples;
}

export const OPENSTACK_FORECAST_WINDOW_HOURS: number = 24;

/*
 * One series over the last day, one point per bucket, which a forecast fits a line
 * through. Best effort: a chart that can't be read leaves the forecast saying it can't
 * tell, and never says something is not growing.
 */
export async function fetchOpenStackMetricHistory(data: {
  cloudName: string;
  regionName?: string | null | undefined;
  metricName: string;
  attributes: Dictionary<string>;
}): Promise<Array<OpenStackGrowthSample>> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(
    endDate,
    -OPENSTACK_FORECAST_WINDOW_HOURS,
  );
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: metricQuery({
        metricName: data.metricName,
        attributes: {
          [CLOUD_ATTRIBUTE]: data.cloudName,
          ...(data.regionName ? { [REGION_ATTRIBUTE]: data.regionName } : {}),
          ...data.attributes,
        },
        startDate,
        endDate,
      }),
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    },
  });
  return toSamples(result);
}

/*
 * A subnet's addresses over the last day for each IPv4 subnet of a network, added up per
 * bucket. A subnet with no point in a bucket adds nothing, and a bucket only counts when
 * every subnet has one, so a subnet added this morning doesn't read as a jump.
 */
export function addOpenStackSubnetHistories(
  histories: Array<Array<OpenStackGrowthSample>>,
): Array<OpenStackGrowthSample> {
  if (histories.length === 0) {
    return [];
  }
  const buckets: Map<number, { used: number; seen: number }> = new Map();
  for (const history of histories) {
    for (const sample of history) {
      const bucket: { used: number; seen: number } = buckets.get(
        sample.time,
      ) || { used: 0, seen: 0 };
      bucket.used += sample.used;
      bucket.seen += 1;
      buckets.set(sample.time, bucket);
    }
  }
  const samples: Array<OpenStackGrowthSample> = [];
  for (const [time, bucket] of buckets.entries()) {
    if (bucket.seen === histories.length) {
      samples.push({ time, used: bucket.used });
    }
  }
  return samples;
}

/*
 * When a network runs out of addresses, from its IPv4 subnets' last day. IPv6 is left out,
 * as everywhere: nobody runs out of a /64.
 */
export async function fetchOpenStackNetworkForecast(data: {
  cloudName: string;
  network: OpenStackResource;
}): Promise<OpenStackForecast> {
  const subnets: Array<OpenStackSubnetAddresses> = getOpenStackNetworkSubnets(
    data.network,
  ).filter((subnet: OpenStackSubnetAddresses): boolean => {
    return subnet.ipVersion !== "6" && Boolean(subnet.cidr);
  });
  const histories: Array<Array<OpenStackGrowthSample>> = await Promise.all(
    subnets.map(
      (
        subnet: OpenStackSubnetAddresses,
      ): Promise<Array<OpenStackGrowthSample>> => {
        return fetchOpenStackMetricHistory({
          cloudName: data.cloudName,
          regionName: data.network.regionName,
          metricName: "openstack_neutron_network_ip_availabilities_used",
          attributes: {
            network_id: data.network.externalId || "",
            cidr: subnet.cidr,
          },
        });
      },
    ),
  );
  const total: number = subnets.reduce(
    (sum: number, subnet: OpenStackSubnetAddresses): number => {
      return sum + (subnet.total || 0);
    },
    0,
  );
  return getOpenStackForecast({
    samples: addOpenStackSubnetHistories(histories),
    capacity: total,
  });
}

/*
 * When a storage pool fills up, from what it has reported free over the last day. The
 * series says free, and a forecast reads used.
 */
export async function fetchOpenStackStoragePoolForecast(data: {
  cloudName: string;
  pool: OpenStackResource;
}): Promise<OpenStackForecast> {
  const capacity: number | undefined = data.pool.diskCapacityBytes;
  const samples: Array<OpenStackGrowthSample> =
    await fetchOpenStackMetricHistory({
      cloudName: data.cloudName,
      regionName: data.pool.regionName,
      metricName: "openstack_cinder_pool_capacity_free_gb",
      attributes: { name: data.pool.name || "" },
    });
  return getOpenStackForecast({
    samples: samples.map(
      (sample: OpenStackGrowthSample): OpenStackGrowthSample => {
        return {
          time: sample.time,
          used: (capacity || 0) - sample.used * 1024 * 1024 * 1024,
        };
      },
    ),
    capacity,
  });
}

export interface OpenStackLatestReading {
  // The value of the label the reading was grouped by: a region, or a project.
  group: string;
  value: number;
}

/*
 * A series' newest values, grouped by one of its labels: a count the exporter keeps per
 * region, or per project. Over the last quarter of an hour, because the slowest scrape is
 * five minutes and a quiet window would read as nothing there.
 */
export async function fetchOpenStackLatestByLabel(data: {
  cloudName: string;
  metricName: string;
  groupByLabel: string;
  attributes?: Dictionary<string> | undefined;
}): Promise<Array<OpenStackLatestReading>> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -15);
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: metricQuery({
        metricName: data.metricName,
        attributes: {
          [CLOUD_ATTRIBUTE]: data.cloudName,
          ...(data.attributes || {}),
        },
        startDate,
        endDate,
      }),
      aggregationType: AggregationType.Max,
      aggregationInterval: AggregationInterval.Total,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: 500,
      skip: 0,
      groupByAttributeKeys: [data.groupByLabel],
    },
  });
  const readings: Array<OpenStackLatestReading> = [];
  for (const point of (result.data || []) as Array<AggregatedModel>) {
    const attributes: Record<string, unknown> =
      (point["attributes"] as Record<string, unknown> | undefined) || {};
    const group: unknown = attributes[data.groupByLabel];
    const value: number = Number(point["value"]);
    if (Number.isFinite(value)) {
      readings.push({
        group: typeof group === "string" ? group : "",
        value,
      });
    }
  }
  return readings;
}

export interface OpenStackHostUsage {
  cpuPercent: number | null;
  memoryPercent: number | null;
}

/*
 * The host's own CPU and memory, as the Host product reads them: what a hypervisor is
 * really doing, as apart from what Nova has promised on it. The same two filters as the
 * Host page, for the same reason: averaged over every state a CPU reads about a third.
 */
export async function fetchOpenStackHostUsage(
  hostIdentifier: string,
): Promise<OpenStackHostUsage> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);

  const read: (
    metricName: string,
    state: string,
  ) => Promise<number | null> = async (
    metricName: string,
    state: string,
  ): Promise<number | null> => {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: {
        query: metricQuery({
          metricName,
          attributes: {
            "resource.host.name": hostIdentifier,
            state,
          },
          startDate,
          endDate,
        }),
        aggregationType: AggregationType.Avg,
        aggregationInterval: AggregationInterval.Total,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startDate,
        endTimestamp: endDate,
        limit: 1,
        skip: 0,
      },
    });
    const value: number = Number(
      ((result.data || [])[0] as AggregatedModel | undefined)?.["value"],
    );
    return Number.isFinite(value) ? value * 100 : null;
  };

  const [user, system, memory]: [number | null, number | null, number | null] =
    await Promise.all([
      read("system.cpu.utilization", "user"),
      read("system.cpu.utilization", "system"),
      read("system.memory.utilization", "used"),
    ]);

  return {
    cpuPercent:
      user === null && system === null ? null : (user || 0) + (system || 0),
    memoryPercent: memory,
  };
}
