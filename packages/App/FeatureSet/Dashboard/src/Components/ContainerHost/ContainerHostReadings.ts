import DockerResource from "Common/Models/DatabaseModels/DockerResource";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { CONTAINER_CLASSIFIER_LABEL_KEYS } from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  CONTAINER_RESTART_WINDOW_MINUTES,
  ContainerHostContainer,
  getContainerHostLatestReadingAt,
} from "./ContainerHostHealth";
import { ContainerHostRuntime } from "./ContainerHostRuntime";

/*
 * EVERY CONTAINER OF A DOCKER OR PODMAN HOST, WITH ITS LATEST READINGS.
 *
 * Three reads, joined by the container's name:
 *
 *   - its latest readings: the newest point of each metric in the last 5
 *     minutes before now (CPU, memory in use and its percent, the network
 *     totals), newest first, 500 points a metric - which holds every
 *     container's newest point, since each sends one every 30 seconds;
 *   - its restarts: container.restarts.increase added up over the last 15
 *     minutes, one total a container (the Container Restart Loop alert's
 *     window). An agent older than that count sends none, and then no
 *     container has a count rather than every container a zero;
 *   - its inventory row (DockerResource / PodmanResource), which ingest
 *     keeps from the same readings: when its current run started, its
 *     labels, and a container that stopped - its row outlives its last
 *     reading by 15 minutes, so it is listed, as not reporting, after it
 *     drops out of the 5-minute window. A role that may not read the
 *     inventory still gets the readings, and the labels the agent copies
 *     onto each reading (Compose project and service).
 *
 * The restarts and the inventory are supplements: when either read fails
 * the containers still come with their readings. Only a failed readings
 * read fails the whole.
 *
 * React-free beyond the data layer it calls, so App tests can read it.
 */

export const CONTAINER_READINGS_WINDOW_MINUTES: number = 5;

// Points a metric read holds; newest first, so every container's newest.
export const CONTAINER_READINGS_LIMIT: number = 500;

export const CONTAINER_RESTARTS_METRIC: string = "container.restarts.increase";

export const CONTAINER_NAME_ATTRIBUTE: string = "resource.container.name";
const CONTAINER_ID_ATTRIBUTE: string = "resource.container.id";
const CONTAINER_IMAGE_ATTRIBUTE: string = "resource.container.image.name";

/*
 * The metrics of a container's latest readings, and the reading each one
 * fills: the Containers list's columns.
 */
export const CONTAINER_READING_METRICS: Array<{
  metricName: string;
  field: keyof Pick<
    ContainerHostContainer,
    | "cpuPercent"
    | "memoryBytes"
    | "memoryPercent"
    | "networkRxBytes"
    | "networkTxBytes"
  >;
}> = [
  { metricName: "container.cpu.utilization", field: "cpuPercent" },
  { metricName: "container.memory.usage.total", field: "memoryBytes" },
  { metricName: "container.memory.percent", field: "memoryPercent" },
  {
    metricName: "container.network.io.usage.rx_bytes",
    field: "networkRxBytes",
  },
  {
    metricName: "container.network.io.usage.tx_bytes",
    field: "networkTxBytes",
  },
];

export interface ContainerHostReadings {
  // By name, as people read numbers in names (web-2 before web-10).
  containers: Array<ContainerHostContainer>;
  // The newest reading of any container: the host still reports.
  hostLatestReadingAt: Date | null;
  // Whether the agent sends the restarts count (an older one does not).
  hasRestartCounts: boolean;
  /*
   * Whether the inventory was read: without it, a container that stopped
   * more than 5 minutes ago is not listed.
   */
  hasInventory: boolean;
  readAt: Date;
}

// The part of an inventory row the pages read, for either runtime.
export interface ContainerHostInventoryRow {
  kind?: string | undefined;
  name?: string | undefined;
  containerId?: string | undefined;
  imageName?: string | undefined;
  labels?: JSONObject | undefined;
  metricsUpdatedAt?: Date | string | undefined;
  lastSeenAt?: Date | string | undefined;
  resourceCreationTimestamp?: Date | string | undefined;
}

// A metric point as a read returns it.
export interface ContainerHostMetricPoint {
  time?: Date | string | undefined;
  value?: unknown;
  attributes?: unknown;
}

export function toContainerDate(
  value: Date | string | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function readString(
  attributes: Record<string, unknown>,
  key: string,
): string | null {
  const value: unknown = attributes[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emptyContainer(name: string): ContainerHostContainer {
  return {
    name: name,
    containerId: null,
    image: null,
    cpuPercent: null,
    memoryBytes: null,
    memoryPercent: null,
    networkRxBytes: null,
    networkTxBytes: null,
    restarts: null,
    startedAt: null,
    lastReadingAt: null,
    labels: null,
  };
}

function later(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return b.getTime() > a.getTime() ? b : a;
}

/*
 * The container labels the agent copies onto a reading, as resource
 * attributes of the same name (CONTAINER_CLASSIFIER_LABEL_KEYS): the Compose
 * project and service among them. Null when the reading carries none.
 */
export function readContainerLabelsFromAttributes(
  attributes: Record<string, unknown>,
): JSONObject | null {
  const labels: JSONObject = {};
  for (const key of CONTAINER_CLASSIFIER_LABEL_KEYS) {
    const value: string | null = readString(attributes, `resource.${key}`);
    if (value !== null) {
      labels[key] = value;
    }
  }
  return Object.keys(labels).length > 0 ? labels : null;
}

function isPlainObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * Joins the three reads into one container a name. Pure, so a test can
 * hand it any reads: `metricPoints` per metric name (newest first, as
 * read), `restartTotals` per container name (null: the agent sends none),
 * and the inventory rows (null: they could not be read).
 */
export function joinContainerHostReadings(data: {
  metricPoints: Record<string, Array<ContainerHostMetricPoint>>;
  restartTotals: Map<string, number> | null;
  inventoryRows: Array<ContainerHostInventoryRow> | null;
  readAt: Date;
}): ContainerHostReadings {
  const byName: Map<string, ContainerHostContainer> = new Map();

  const containerOf: (name: string) => ContainerHostContainer = (
    name: string,
  ): ContainerHostContainer => {
    let container: ContainerHostContainer | undefined = byName.get(name);
    if (!container) {
      container = emptyContainer(name);
      byName.set(name, container);
    }
    return container;
  };

  for (const metric of CONTAINER_READING_METRICS) {
    const seen: Set<string> = new Set();
    for (const point of data.metricPoints[metric.metricName] || []) {
      const attributes: Record<string, unknown> = isPlainObject(
        point.attributes,
      )
        ? (point.attributes as Record<string, unknown>)
        : {};
      const name: string | null = readString(
        attributes,
        CONTAINER_NAME_ATTRIBUTE,
      );
      // Newest first: a container's first point is its latest reading.
      if (!name || seen.has(name)) {
        continue;
      }
      if (point.value === undefined || point.value === null) {
        continue;
      }
      const value: number = Number(point.value);
      if (!Number.isFinite(value)) {
        continue;
      }
      seen.add(name);

      const container: ContainerHostContainer = containerOf(name);
      container[metric.field] = value;
      container.lastReadingAt = later(
        container.lastReadingAt,
        toContainerDate(point.time),
      );
      container.containerId =
        container.containerId || readString(attributes, CONTAINER_ID_ATTRIBUTE);
      container.image =
        container.image || readString(attributes, CONTAINER_IMAGE_ATTRIBUTE);
      container.labels =
        container.labels || readContainerLabelsFromAttributes(attributes);
    }
  }

  for (const row of data.inventoryRows || []) {
    if (row.kind && row.kind !== "Container") {
      continue;
    }
    const name: string = (row.name || "").trim();
    if (!name) {
      continue;
    }
    const container: ContainerHostContainer = containerOf(name);
    container.containerId =
      container.containerId || (row.containerId || "").trim() || null;
    container.image = container.image || row.imageName || null;
    // The row holds every label the agent copied, merged across readings.
    if (isPlainObject(row.labels) && Object.keys(row.labels).length > 0) {
      container.labels = { ...(container.labels || {}), ...row.labels };
    }
    container.startedAt = toContainerDate(row.resourceCreationTimestamp);
    container.lastReadingAt = later(
      container.lastReadingAt,
      toContainerDate(row.metricsUpdatedAt) || toContainerDate(row.lastSeenAt),
    );
  }

  if (data.restartTotals) {
    for (const container of byName.values()) {
      container.restarts = data.restartTotals.get(container.name) ?? 0;
    }
  }

  const containers: Array<ContainerHostContainer> = Array.from(
    byName.values(),
  ).sort((a: ContainerHostContainer, b: ContainerHostContainer): number => {
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return {
    containers: containers,
    hostLatestReadingAt: getContainerHostLatestReadingAt(containers),
    hasRestartCounts: data.restartTotals !== null,
    hasInventory: data.inventoryRows !== null,
    readAt: data.readAt,
  };
}

// Each container's restarts in an aggregate grouped by its name; null: none.
export function getContainerRestartTotals(
  result: AggregatedResult | null | undefined,
): Map<string, number> | null {
  const rows: Array<AggregatedModel> = (result?.data ||
    []) as Array<AggregatedModel>;
  if (rows.length === 0) {
    return null;
  }
  const totals: Map<string, number> = new Map();
  for (const row of rows) {
    const attributes: Record<string, unknown> = isPlainObject(row["attributes"])
      ? (row["attributes"] as Record<string, unknown>)
      : {};
    const name: string | null = readString(
      attributes,
      CONTAINER_NAME_ATTRIBUTE,
    );
    const value: number = Number(row["value"]);
    if (!name || !Number.isFinite(value)) {
      continue;
    }
    totals.set(name, (totals.get(name) || 0) + value);
  }
  return totals;
}

const INVENTORY_SELECT: Record<string, true> = {
  kind: true,
  name: true,
  containerId: true,
  imageName: true,
  labels: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
  resourceCreationTimestamp: true,
};

async function readInventory(data: {
  runtime: ContainerHostRuntime;
  hostId: ObjectID;
}): Promise<Array<ContainerHostInventoryRow> | null> {
  try {
    if (data.runtime.runtime === "docker") {
      const result: ListResult<DockerResource> =
        await ModelAPI.getList<DockerResource>({
          modelType: DockerResource,
          query: { dockerHostId: data.hostId, kind: "Container" },
          select: INVENTORY_SELECT,
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });
      return (result?.data || []) as Array<ContainerHostInventoryRow>;
    }

    const result: ListResult<PodmanResource> =
      await ModelAPI.getList<PodmanResource>({
        modelType: PodmanResource,
        query: { podmanHostId: data.hostId, kind: "Container" },
        select: INVENTORY_SELECT,
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });
    return (result?.data || []) as Array<ContainerHostInventoryRow>;
  } catch {
    // A role without access to the inventory still gets the readings.
    return null;
  }
}

async function readRestartTotals(data: {
  projectId: string;
  attributes: Record<string, string>;
  start: Date;
  end: Date;
}): Promise<Map<string, number> | null> {
  try {
    const request: AggregateBy<Metric> = {
      query: {
        projectId: data.projectId,
        time: new InBetween<Date>(data.start, data.end),
        name: CONTAINER_RESTARTS_METRIC,
        attributes: data.attributes,
      } as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      aggregationInterval: AggregationInterval.Total,
      groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
      startTimestamp: data.start,
      endTimestamp: data.end,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { time: SortOrder.Descending },
    };
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: request,
    });
    return getContainerRestartTotals(result);
  } catch {
    // Restarts are a supplement: the readings still say the rest.
    return null;
  }
}

export async function loadContainerHostReadings(data: {
  runtime: ContainerHostRuntime;
  hostId: ObjectID;
  // The host's host.name, which the agent stamps on every reading.
  hostIdentifier: string;
}): Promise<ContainerHostReadings> {
  const readAt: Date = OneUptimeDate.getCurrentDate();
  const readingsStart: Date = OneUptimeDate.addRemoveMinutes(
    readAt,
    -CONTAINER_READINGS_WINDOW_MINUTES,
  );
  const restartsStart: Date = OneUptimeDate.addRemoveMinutes(
    readAt,
    -CONTAINER_RESTART_WINDOW_MINUTES,
  );
  const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();
  const attributes: Record<string, string> = {
    "resource.host.name": data.hostIdentifier,
    "resource.container.runtime": data.runtime.runtime,
  };

  const metricReads: Array<Promise<AnalyticsListResult<Metric>>> =
    CONTAINER_READING_METRICS.map(
      (metric: {
        metricName: string;
      }): Promise<AnalyticsListResult<Metric>> => {
        /*
         * `any`-typed, as the pages' own reads: the attributes filter with
         * the generic select is a TS2589 deep instantiation otherwise.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request: any = {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metric.metricName,
            time: new InBetween<Date>(readingsStart, readAt),
            attributes: attributes,
          },
          limit: CONTAINER_READINGS_LIMIT,
          skip: 0,
          select: { time: true, value: true, attributes: true },
          sort: { time: SortOrder.Descending },
          requestOptions: {},
        };
        return AnalyticsModelAPI.getList<Metric>(request);
      },
    );

  const [metricResults, restartTotals, inventoryRows]: [
    Array<AnalyticsListResult<Metric>>,
    Map<string, number> | null,
    Array<ContainerHostInventoryRow> | null,
  ] = await Promise.all([
    Promise.all(metricReads),
    readRestartTotals({
      projectId: projectId,
      attributes: attributes,
      start: restartsStart,
      end: readAt,
    }),
    readInventory({ runtime: data.runtime, hostId: data.hostId }),
  ]);

  const metricPoints: Record<string, Array<ContainerHostMetricPoint>> = {};
  CONTAINER_READING_METRICS.forEach(
    (metric: { metricName: string }, index: number): void => {
      metricPoints[metric.metricName] = (metricResults[index]?.data ||
        []) as Array<ContainerHostMetricPoint>;
    },
  );

  return joinContainerHostReadings({
    metricPoints: metricPoints,
    restartTotals: restartTotals,
    inventoryRows: inventoryRows,
    readAt: readAt,
  });
}
