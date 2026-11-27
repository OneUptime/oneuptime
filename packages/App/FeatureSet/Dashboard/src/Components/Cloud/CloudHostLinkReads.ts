import Metric from "Common/Models/AnalyticsModels/Metric";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { addUtcDays } from "Common/Types/Cloud/CloudCost";
import {
  CloudHostMachineJSON,
  CloudVmHostJSON,
  HOST_CLOUD_MACHINE_ROUTE,
  HOST_OF_CLOUD_RESOURCE_ROUTE,
} from "Common/Types/Cloud/CloudHostLink";
import {
  CLOUD_HOST_MEMORY_METRIC,
  CLOUD_HOST_MEMORY_STATE_ATTRIBUTE,
  CLOUD_HOST_MEMORY_STATE_USED,
  CLOUD_HOST_MEMORY_TO_PERCENT,
  CLOUD_HOST_NAME_ATTRIBUTE,
  CLOUD_RIGHT_SIZING_WINDOW_DAYS,
  CloudMemoryReading,
  CloudMemorySource,
} from "Common/Types/Cloud/CloudRightSizing";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHICH HOST A CLOUD VM IS, AND WHICH VM A HOST IS, AS THE PAGES READ IT
 * (#11013): the server's two reads (HostAPI, CloudHostLinks), each as the
 * reader, and the host's memory over right-sizing's window, as the server
 * reads it for the VM's right-sizing (CloudRightSizingWriter). A VM's page
 * asks for its host twice - its host card and its right-sizing - so a
 * read is shared for a few seconds. React-free: App tests read it too.
 */

const HOUR_MS: number = 60 * 60 * 1000;

// How long a read of a VM's host is shared by the cards of its page.
export const HOST_LINK_SHARED_FOR_MS: number = 10 * 1000;

interface SharedRead<T> {
  at: number;
  promise: Promise<T>;
}

const hostsOfVms: Map<string, SharedRead<CloudVmHostJSON | null>> = new Map();

async function postForJson(route: string): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The server's answer of a VM's host, read with care: null for anything else.
export function readCloudVmHost(value: unknown): CloudVmHostJSON | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const hostId: string = readText(record["hostId"]);

  if (!hostId) {
    return null;
  }

  return {
    hostId,
    name: readText(record["name"]),
    hostIdentifier: readText(record["hostIdentifier"]),
  };
}

// The server's answer of a host's VM, read with care: null for anything else.
export function readCloudHostMachine(
  value: unknown,
): CloudHostMachineJSON | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const cloudResourceId: string = readText(record["cloudResourceId"]);
  const instanceId: string = readText(record["instanceId"]);

  if (!cloudResourceId || !instanceId) {
    return null;
  }

  return {
    cloudResourceId,
    name: readText(record["name"]),
    provider: readText(record["provider"]),
    type: readText(record["type"]),
    accountId: readText(record["accountId"]),
    region: readText(record["region"]),
    instanceId,
  };
}

// The host a cloud VM is, or null: shared for a few seconds by the page's cards.
export function fetchHostOfCloudResource(
  cloudResourceId: ObjectID,
  now: number = Date.now(),
): Promise<CloudVmHostJSON | null> {
  const key: string = cloudResourceId.toString();
  const shared: SharedRead<CloudVmHostJSON | null> | undefined =
    hostsOfVms.get(key);

  if (shared && now - shared.at < HOST_LINK_SHARED_FOR_MS) {
    return shared.promise;
  }

  const promise: Promise<CloudVmHostJSON | null> = postForJson(
    `/host/${HOST_OF_CLOUD_RESOURCE_ROUTE}/${key}`,
  ).then((json: JSONObject): CloudVmHostJSON | null => {
    return readCloudVmHost(json["host"]);
  });

  hostsOfVms.set(key, { at: now, promise });

  // A read that failed is not shared: the next card asks again.
  promise.catch((): void => {
    hostsOfVms.delete(key);
  });

  return promise;
}

// The cloud VM a host is, or null.
export async function fetchCloudMachineOfHost(
  hostId: ObjectID,
): Promise<CloudHostMachineJSON | null> {
  const json: JSONObject = await postForJson(
    `/host/${hostId.toString()}/${HOST_CLOUD_MACHINE_ROUTE}`,
  );

  return readCloudHostMachine(json["machine"]);
}

async function readHostMemoryTotal(data: {
  projectId: ObjectID;
  hostIdentifier: string;
  aggregationType: AggregationType;
  start: Date;
  end: Date;
}): Promise<AggregatedModel | null> {
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: data.projectId,
        name: CLOUD_HOST_MEMORY_METRIC,
        time: new InBetween<Date>(data.start, data.end),
        attributes: {
          [CLOUD_HOST_MEMORY_STATE_ATTRIBUTE]: CLOUD_HOST_MEMORY_STATE_USED,
          [CLOUD_HOST_NAME_ATTRIBUTE]: data.hostIdentifier,
        },
      } as never,
      aggregationType: data.aggregationType,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      aggregationInterval: AggregationInterval.Total,
      startTimestamp: data.start,
      endTimestamp: data.end,
      limit: 1,
      skip: 0,
    },
  });

  return (result.data && result.data[0]) || null;
}

/*
 * What the host a VM is read of its memory over right-sizing's window: its
 * highest share used, how many readings and since when - the same reading
 * the server sizes the VM by. Null when none came in.
 */
export async function fetchHostMemoryReading(data: {
  projectId: ObjectID;
  host: CloudVmHostJSON;
  now: Date;
}): Promise<CloudMemoryReading | null> {
  const hostIdentifier: string = data.host.hostIdentifier.trim();

  if (!hostIdentifier) {
    return null;
  }

  const end: Date = data.now;
  const start: Date = addUtcDays(end, -CLOUD_RIGHT_SIZING_WINDOW_DAYS);
  const [max, count]: [AggregatedModel | null, AggregatedModel | null] =
    await Promise.all([
      readHostMemoryTotal({
        projectId: data.projectId,
        hostIdentifier,
        aggregationType: AggregationType.Max,
        start,
        end,
      }),
      readHostMemoryTotal({
        projectId: data.projectId,
        hostIdentifier,
        aggregationType: AggregationType.Count,
        start,
        end,
      }),
    ]);
  const peak: number = Number(max?.value);

  if (!max || !Number.isFinite(peak)) {
    return null;
  }

  const first: number = new Date(max.timestamp).getTime();
  const samples: number = Number(count?.value);

  return {
    source: CloudMemorySource.Host,
    peakPercent: Math.max(0, peak * CLOUD_HOST_MEMORY_TO_PERCENT),
    samples: Number.isFinite(samples) ? Math.max(0, Math.round(samples)) : 0,
    observedHours: Number.isFinite(first)
      ? Math.max(0, (end.getTime() - first) / HOUR_MS)
      : 0,
    host: {
      id: data.host.hostId,
      name: data.host.name || hostIdentifier,
    },
  };
}
