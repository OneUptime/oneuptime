import Metric from "Common/Models/AnalyticsModels/Metric";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
  OpenStackInstanceMetricsOptions,
  OpenStackInstanceUsageReading,
  getDefaultOpenStackInstanceMetricsOptions,
  mergeOpenStackInstanceUsage,
  normalizeOpenStackInstanceMetricsOptions,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackStoragePoolCephLink,
  getEmptyOpenStackReachAcrossProducts,
} from "Common/Types/OpenStack/OpenStackLinks";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  OpenStackCounterPoint,
  OpenStackHostThroughput,
  getOpenStackHostThroughput,
} from "./OpenStackUsage";

/*
 * What is really busy, as apart from what is promised, and what in the rest of OneUptime is
 * which part of a cloud. Every read here is one bounded question: a few series over a quarter
 * of an hour, or one of the server's joins.
 */

const CLOUD_ATTRIBUTE: string = "resource.openstack.cloud.name";

/*
 * A quarter of an hour, because that holds three of Ceilometer's polling cycles, and a reading
 * here says what an instance is doing now rather than what it did at one moment.
 */
export const OPENSTACK_USAGE_WINDOW_MINUTES: number = 15;
// The same as a host's other readings on a hypervisor's page, which are of right now.
export const OPENSTACK_HOST_THROUGHPUT_WINDOW_MINUTES: number = 5;

async function readAverageByLabel(data: {
  metricName: string;
  groupByLabels: Array<string>;
  attributes: Dictionary<string>;
}): Promise<Array<{ labels: Record<string, unknown>; value: number }>> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(
    endDate,
    -OPENSTACK_USAGE_WINDOW_MINUTES,
  );
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        time: new InBetween<Date>(startDate, endDate),
        name: data.metricName,
        attributes: data.attributes,
      } as Query<Metric>,
      aggregationType: AggregationType.Avg,
      aggregationInterval: AggregationInterval.Total,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: 1000,
      skip: 0,
      groupByAttributeKeys: data.groupByLabels,
    },
  });
  const readings: Array<{ labels: Record<string, unknown>; value: number }> =
    [];
  for (const point of (result.data || []) as Array<AggregatedModel>) {
    const value: number = Number(point["value"]);
    if (Number.isFinite(value)) {
      readings.push({
        labels:
          (point["attributes"] as Record<string, unknown> | undefined) || {},
        value,
      });
    }
  }
  return readings;
}

function firstOf(
  readings: Array<{ value: number }>,
): number | null {
  return readings[0]?.value ?? null;
}

function sourcesOf(
  readings: Array<{ labels: Record<string, unknown> }>,
): Array<OpenStackInstanceMetricSource> {
  const sources: Set<OpenStackInstanceMetricSource> = new Set();
  for (const reading of readings) {
    const source: unknown = reading.labels[OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE];
    if (typeof source === "string" && source) {
      sources.add(source as OpenStackInstanceMetricSource);
    }
  }
  return Array.from(sources);
}

export interface OpenStackInstanceUsage {
  cpuCores: number | null;
  cpuPercent: number | null;
  contentionPercent: number | null;
  memoryUsageBytes: number | null;
  memoryResidentBytes: number | null;
  sources: Array<OpenStackInstanceMetricSource>;
}

export async function fetchOpenStackInstanceUsage(data: {
  cloudName: string;
  instanceId: string;
}): Promise<OpenStackInstanceUsage> {
  const read: (metricName: OpenStackInstanceMetric) => Promise<
    Array<{ labels: Record<string, unknown>; value: number }>
  > = (
    metricName: OpenStackInstanceMetric,
  ): Promise<Array<{ labels: Record<string, unknown>; value: number }>> => {
    return readAverageByLabel({
      metricName,
      groupByLabels: [OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE],
      attributes: {
        [CLOUD_ATTRIBUTE]: data.cloudName,
        [OPENSTACK_INSTANCE_ID_ATTRIBUTE]: data.instanceId,
      },
    });
  };
  const [cpuCores, cpuPercent, contention, memoryUsage, memoryResident]: Array<
    Array<{ labels: Record<string, unknown>; value: number }>
  > = await Promise.all([
    read(OpenStackInstanceMetric.CpuUsage),
    read(OpenStackInstanceMetric.CpuUtilization),
    read(OpenStackInstanceMetric.CpuContention),
    read(OpenStackInstanceMetric.MemoryUsage),
    read(OpenStackInstanceMetric.MemoryResident),
  ]) as Array<Array<{ labels: Record<string, unknown>; value: number }>>;

  return {
    cpuCores: firstOf(cpuCores!),
    cpuPercent: firstOf(cpuPercent!),
    contentionPercent: firstOf(contention!),
    memoryUsageBytes: firstOf(memoryUsage!),
    memoryResidentBytes: firstOf(memoryResident!),
    sources: sourcesOf([...cpuCores!, ...memoryResident!]),
  };
}

export interface OpenStackHypervisorUsage {
  // What its instances use between them, from its exporter's totals.
  cpuCores: number | null;
  memoryResidentBytes: number | null;
  reporting: number | null;
  sources: Array<OpenStackInstanceMetricSource>;
  instances: Array<OpenStackInstanceUsageReading>;
}

export async function fetchOpenStackHypervisorUsage(data: {
  cloudName: string;
  hypervisorName: string;
}): Promise<OpenStackHypervisorUsage> {
  const attributes: Dictionary<string> = {
    [CLOUD_ATTRIBUTE]: data.cloudName,
    [OPENSTACK_HYPERVISOR_ATTRIBUTE]: data.hypervisorName,
  };
  const total: (metricName: OpenStackHypervisorMetric) => Promise<
    Array<{ labels: Record<string, unknown>; value: number }>
  > = (
    metricName: OpenStackHypervisorMetric,
  ): Promise<Array<{ labels: Record<string, unknown>; value: number }>> => {
    return readAverageByLabel({
      metricName,
      groupByLabels: [OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE],
      attributes,
    });
  };
  const perInstance: (
    metricName: OpenStackInstanceMetric,
  ) => Promise<Map<string, number>> = async (
    metricName: OpenStackInstanceMetric,
  ): Promise<Map<string, number>> => {
    const readings: Array<{ labels: Record<string, unknown>; value: number }> =
      await readAverageByLabel({
        metricName,
        groupByLabels: [OPENSTACK_INSTANCE_ID_ATTRIBUTE],
        attributes,
      });
    const values: Map<string, number> = new Map();
    for (const reading of readings) {
      const id: unknown = reading.labels[OPENSTACK_INSTANCE_ID_ATTRIBUTE];
      if (typeof id === "string" && id) {
        values.set(id, reading.value);
      }
    }
    return values;
  };

  const [cores, memory, reporting, cpuCores, cpuPercent, contention, resident]: [
    Array<{ labels: Record<string, unknown>; value: number }>,
    Array<{ labels: Record<string, unknown>; value: number }>,
    Array<{ labels: Record<string, unknown>; value: number }>,
    Map<string, number>,
    Map<string, number>,
    Map<string, number>,
    Map<string, number>,
  ] = await Promise.all([
    total(OpenStackHypervisorMetric.InstancesCpuUsage),
    total(OpenStackHypervisorMetric.InstancesMemoryResident),
    total(OpenStackHypervisorMetric.InstancesReporting),
    perInstance(OpenStackInstanceMetric.CpuUsage),
    perInstance(OpenStackInstanceMetric.CpuUtilization),
    perInstance(OpenStackInstanceMetric.CpuContention),
    perInstance(OpenStackInstanceMetric.MemoryResident),
  ]);

  return {
    cpuCores: firstOf(cores),
    memoryResidentBytes: firstOf(memory),
    reporting: firstOf(reporting),
    sources: sourcesOf([...cores, ...memory]),
    instances: mergeOpenStackInstanceUsage({
      cpuCores,
      cpuPercent,
      contentionPercent: contention,
      memoryResidentBytes: resident,
    }),
  };
}

/*
 * One of a host's byte counters, minute by minute, per device and direction. A hypervisor has an
 * interface per instance on it, which LIMIT_PER_PROJECT is far enough above to hold every
 * reading of the few minutes this asks about.
 */
async function readHostCounter(data: {
  metricName: string;
  hostIdentifier: string;
}): Promise<Array<OpenStackCounterPoint>> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(
    endDate,
    -OPENSTACK_HOST_THROUGHPUT_WINDOW_MINUTES,
  );
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        time: new InBetween<Date>(startDate, endDate),
        name: data.metricName,
        attributes: { "resource.host.name": data.hostIdentifier },
      } as Query<Metric>,
      aggregationType: AggregationType.Max,
      aggregationInterval: AggregationInterval.Minute,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      groupByAttributeKeys: ["device", "direction"],
    },
  });
  const points: Array<OpenStackCounterPoint> = [];
  for (const row of (result.data || []) as Array<AggregatedModel>) {
    const labels: Record<string, unknown> =
      (row["attributes"] as Record<string, unknown> | undefined) || {};
    const value: number = Number(row["value"]);
    const raw: unknown =
      row["timestamp"] !== undefined ? row["timestamp"] : row["time"];
    const timeMs: number =
      raw instanceof Date ? raw.getTime() : new Date(raw as string).getTime();
    if (
      typeof labels["device"] === "string" &&
      typeof labels["direction"] === "string" &&
      Number.isFinite(value) &&
      Number.isFinite(timeMs)
    ) {
      points.push({
        device: labels["device"],
        direction: labels["direction"],
        timeMs,
        value,
      });
    }
  }
  return points;
}

export async function fetchOpenStackHostThroughput(
  hostIdentifier: string,
): Promise<OpenStackHostThroughput> {
  const [disk, network]: [
    Array<OpenStackCounterPoint>,
    Array<OpenStackCounterPoint>,
  ] = await Promise.all([
    readHostCounter({ metricName: "system.disk.io", hostIdentifier }),
    readHostCounter({ metricName: "system.network.io", hostIdentifier }),
  ]);
  return getOpenStackHostThroughput({ disk, network });
}

export interface OpenStackInstanceMetricsChoice {
  options: OpenStackInstanceMetricsOptions;
  instanceCount: number;
}

// What the cloud chose to keep. A value that can't be read means the defaults.
export async function fetchOpenStackInstanceMetricsChoice(
  openStackCloudId: ObjectID,
): Promise<OpenStackInstanceMetricsChoice> {
  const cloud: OpenStackCloud | null = await ModelAPI.getItem<OpenStackCloud>({
    modelType: OpenStackCloud,
    id: openStackCloudId,
    select: { instanceMetricsOptions: true, instanceCount: true },
  });
  return {
    options:
      normalizeOpenStackInstanceMetricsOptions(cloud?.instanceMetricsOptions)
        .options || getDefaultOpenStackInstanceMetricsOptions(),
    instanceCount: cloud?.instanceCount || 0,
  };
}

async function post(path: string, id: ObjectID, body?: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(`/openstack-resource/${path}/`)
        .addRoute(id.toString()),
      data: body || {},
      headers: { ...ModelAPI.getCommonHeaders() },
    },
  );
  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
  return response.data;
}

export async function fetchOpenStackPlacementOfHost(
  hostId: ObjectID,
): Promise<OpenStackPlacement | null> {
  const answer: JSONObject = await post("placement-of-host", hostId);
  return (answer["placement"] as unknown as OpenStackPlacement) || null;
}

export async function fetchOpenStackPlacementOfKubernetesNode(data: {
  clusterId: ObjectID;
  nodeName: string;
}): Promise<OpenStackPlacement | null> {
  const answer: JSONObject = await post(
    "placement-of-kubernetes-node",
    data.clusterId,
    { nodeName: data.nodeName },
  );
  return (answer["placement"] as unknown as OpenStackPlacement) || null;
}

export interface OpenStackServicePlacement {
  hostName: string;
  hostId: string | null;
  placement: OpenStackPlacement;
}

export async function fetchOpenStackPlacementsOfService(
  serviceId: ObjectID,
): Promise<Array<OpenStackServicePlacement>> {
  const answer: JSONObject = await post("placement-of-service", serviceId);
  return (
    (answer["placements"] as unknown as Array<OpenStackServicePlacement>) || []
  );
}

export async function fetchOpenStackReachOfInstance(data: {
  openStackCloudId: ObjectID;
  instanceId: string;
}): Promise<OpenStackReachAcrossProducts> {
  const answer: JSONObject = await post(
    "reach-of-instance",
    data.openStackCloudId,
    { instanceId: data.instanceId },
  );
  return {
    ...getEmptyOpenStackReachAcrossProducts(),
    ...(answer as unknown as OpenStackReachAcrossProducts),
  };
}

export interface OpenStackStoragePoolCephRead {
  link: OpenStackStoragePoolCephLink;
  clusters: Array<{ id: string; name: string }>;
  health: number | null;
  capacityUsedPercent: number | null;
}

export async function fetchOpenStackStoragePoolCeph(data: {
  openStackCloudId: ObjectID;
  externalId: string;
}): Promise<OpenStackStoragePoolCephRead> {
  return (await post("storage-pool-ceph", data.openStackCloudId, {
    externalId: data.externalId,
  })) as unknown as OpenStackStoragePoolCephRead;
}

export async function confirmOpenStackStoragePoolCeph(data: {
  openStackCloudId: ObjectID;
  externalId: string;
  cephClusterId?: string | undefined;
  isNotCeph?: boolean | undefined;
}): Promise<void> {
  await post("storage-pool-ceph-confirm", data.openStackCloudId, {
    externalId: data.externalId,
    ...(data.cephClusterId ? { cephClusterId: data.cephClusterId } : {}),
    ...(data.isNotCeph ? { isNotCeph: true } : {}),
  });
}
