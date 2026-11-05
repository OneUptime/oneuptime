import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackRegionSummary,
  OpenStackRowsLeftOut,
  OpenStackTopConsumer,
  OpenStackTopConsumers,
} from "Common/Types/OpenStack/OpenStackOverview";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { OPENSTACK_ROW_SELECT } from "./OpenStackPartData";

/*
 * What a cloud's Overview and Services pages read that a list does not: each is one or a
 * few indexed reads on the server, however large the cloud (OpenStackResourceService).
 * Each throws what the server answered when it fails, so each card can say so in its own
 * frame, with the words the server used.
 */

export interface OpenStackAttentionAnswer {
  rows: Array<OpenStackResource>;
  // How many of each kind may need someone, which the rows can be fewer than.
  totalsByKind: Record<string, number>;
  // On a very large cloud, the hosts and workers that were counted and not read.
  leftOut: Array<OpenStackRowsLeftOut>;
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

function toNumber(value: JSONValue | undefined): number {
  const parsed: number =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: JSONValue | undefined): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date: Date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

// A row as a hand-written read answers it: its dates are text until something reads them.
export function toOpenStackAttentionRow(row: JSONObject): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();
  Object.assign(resource, row, {
    stateChangedAt: toDate(row["stateChangedAt"]),
    lastSeenAt: toDate(row["lastSeenAt"]),
  });
  return resource;
}

export async function fetchOpenStackAttention(data: {
  openStackCloudId: ObjectID;
  regionName?: string | null | undefined;
}): Promise<OpenStackAttentionAnswer> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/needs-attention/",
    openStackCloudId: data.openStackCloudId,
    body: data.regionName ? { regionName: data.regionName } : {},
  });
  const totals: JSONObject = (answer["totalsByKind"] as JSONObject) || {};
  const totalsByKind: Record<string, number> = {};
  for (const kind of Object.keys(totals)) {
    totalsByKind[kind] = toNumber(totals[kind]);
  }
  return {
    rows: ((answer["rows"] as Array<JSONObject>) || []).map(
      toOpenStackAttentionRow,
    ),
    totalsByKind,
    leftOut: (answer["leftOut"] as unknown as Array<OpenStackRowsLeftOut>) || [],
  };
}

/*
 * Several regions' answers as one. A project belongs to no region, so every region's
 * answer holds it: it is counted once, and each kind's total is the regions' together.
 */
export function mergeOpenStackAttention(
  answers: Array<OpenStackAttentionAnswer>,
): OpenStackAttentionAnswer {
  const seen: Set<string> = new Set<string>();
  const merged: OpenStackAttentionAnswer = {
    rows: [],
    totalsByKind: {},
    leftOut: [],
  };

  for (const answer of answers) {
    // Each region's own, and a project is no host or worker, so nothing here is counted twice.
    merged.leftOut.push(...answer.leftOut);

    for (const row of answer.rows) {
      const key: string = `${row.kind}/${row.externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.rows.push(row);
      }
    }
    for (const kind of Object.keys(answer.totalsByKind)) {
      const total: number = answer.totalsByKind[kind] || 0;
      merged.totalsByKind[kind] =
        kind === OpenStackResourceKind.Project
          ? Math.max(merged.totalsByKind[kind] || 0, total)
          : (merged.totalsByKind[kind] || 0) + total;
    }
  }

  return merged;
}

export async function fetchOpenStackRegionSummaries(
  openStackCloudId: ObjectID,
): Promise<Array<OpenStackRegionSummary>> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/region-summaries/",
    openStackCloudId,
  });
  return (answer["regions"] as unknown as Array<OpenStackRegionSummary>) || [];
}

export async function fetchOpenStackTopConsumers(data: {
  openStackCloudId: ObjectID;
  regionName?: string | null | undefined;
}): Promise<OpenStackTopConsumers> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/top-consumers/",
    openStackCloudId: data.openStackCloudId,
    body: data.regionName ? { regionName: data.regionName } : {},
  });
  return {
    projectsByInstances:
      (answer[
        "projectsByInstances"
      ] as unknown as Array<OpenStackTopConsumer>) || [],
    projectsByVolumeBytes:
      (answer[
        "projectsByVolumeBytes"
      ] as unknown as Array<OpenStackTopConsumer>) || [],
  };
}

/*
 * The APIs and the workers: what `openstack compute service list`, `network agent list`,
 * `volume service list` and `endpoint list` answer between them. There are few of them
 * even on a large cloud, and grouping them and putting what needs someone first takes
 * all of them at once. A cloud with more than one read holds says so (isTruncated)
 * rather than reading as though that was all.
 */
// Past this a cloud's workers are read the way a very large cloud's are.
const OPENSTACK_WORKERS_READ_WHOLE: number = 1000;

export interface OpenStackServiceRows {
  apis: Array<OpenStackResource>;
  // All of them, or on a very large cloud those that may need someone.
  workers: Array<OpenStackResource>;
  // The workers that were counted and not read.
  leftOut: Array<OpenStackRowsLeftOut>;
}

/*
 * What a very large cloud's read could not bring: only the workers that may need someone, and how
 * many others there are. A search asks for what it finds, wherever that is.
 */
export async function fetchOpenStackWorkersOfLargeCloud(data: {
  openStackCloudId: ObjectID;
  search?: string | undefined;
}): Promise<{
  workers: Array<OpenStackResource>;
  leftOut: Array<OpenStackRowsLeftOut>;
}> {
  const answer: JSONObject = await postToCloud({
    path: "/openstack-resource/services/",
    openStackCloudId: data.openStackCloudId,
    body: data.search ? { search: data.search } : {},
  });

  return {
    workers: ((answer["workers"] as Array<JSONObject>) || []).map(
      toOpenStackAttentionRow,
    ),
    leftOut: (answer["leftOut"] as unknown as Array<OpenStackRowsLeftOut>) || [],
  };
}

export async function fetchOpenStackServiceRows(
  openStackCloudId: ObjectID,
): Promise<OpenStackServiceRows> {
  const read: (
    kind: OpenStackResourceKind,
  ) => Promise<ListResult<OpenStackResource>> = (
    kind: OpenStackResourceKind,
  ): Promise<ListResult<OpenStackResource>> => {
    return ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: { openStackCloudId: openStackCloudId, kind: kind },
      limit: OPENSTACK_WORKERS_READ_WHOLE,
      skip: 0,
      select: OPENSTACK_ROW_SELECT,
      sort: {},
    });
  };
  const [apis, workers]: [
    ListResult<OpenStackResource>,
    ListResult<OpenStackResource>,
  ] = await Promise.all([
    read(OpenStackResourceKind.Api),
    read(OpenStackResourceKind.Service),
  ]);

  if (workers.count <= workers.data.length) {
    return { apis: apis.data, workers: workers.data, leftOut: [] };
  }

  return {
    apis: apis.data,
    ...(await fetchOpenStackWorkersOfLargeCloud({ openStackCloudId })),
  };
}
