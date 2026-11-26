import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
} from "Common/Types/Cloud/CloudCostAllocation";
import {
  CloudCostRule,
  readCloudCostRules,
} from "Common/Types/Cloud/CloudCostRules";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT THE COST GROUP PAGES READ.
 *
 * What a view allocates is read in one request
 * (POST /cloud-cost-view/:id/allocation): each group's spend bucket by
 * bucket, against the period before, and what the unallocated spend is
 * made of. A group's own page reads POST /cloud-cost-group/:id/spend,
 * which answers with that group alone. Both are read as the person may
 * read the costs; the server sorts them (CloudCostAllocation).
 */

export interface CloudCostAllocationAsk {
  startDate: Date;
  endDate: Date;
  interval?: CloudCostAllocationInterval | undefined;
  currency?: string | undefined;
  cloudAccountIds?: Array<ObjectID> | undefined;
}

export interface CloudCostGroupSpend {
  viewId: string;
  viewName: string;
  currency: string;
  interval: CloudCostAllocationInterval;
  start: string;
  lastDay: string;
  previousStart?: string | null;
  previousLastDay?: string | null;
  buckets: Array<string>;
  readAt: string;
  group: CloudCostAllocationGroupResult;
}

function toBody(ask: CloudCostAllocationAsk): JSONObject {
  const body: JSONObject = {
    startDate: ask.startDate.toISOString(),
    endDate: ask.endDate.toISOString(),
  };

  if (ask.interval) {
    body["interval"] = ask.interval;
  }

  if (ask.currency) {
    body["currency"] = ask.currency;
  }

  if (ask.cloudAccountIds && ask.cloudAccountIds.length > 0) {
    body["cloudAccountIds"] = ask.cloudAccountIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );
  }

  return body;
}

async function post<T>(route: string, data: JSONObject): Promise<T> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as unknown as T;
}

export async function fetchCloudCostAllocation(data: {
  viewId: ObjectID;
  ask: CloudCostAllocationAsk;
}): Promise<CloudCostAllocationResult> {
  return await post<CloudCostAllocationResult>(
    `/cloud-cost-view/${data.viewId.toString()}/allocation`,
    toBody(data.ask),
  );
}

export async function fetchCloudCostGroupSpend(data: {
  groupId: ObjectID;
  ask: CloudCostAllocationAsk;
}): Promise<CloudCostGroupSpend> {
  return await post<CloudCostGroupSpend>(
    `/cloud-cost-group/${data.groupId.toString()}/spend`,
    toBody(data.ask),
  );
}

// Makes a view's missing groups now; how many it made.
export async function makeCloudCostGroups(viewId: ObjectID): Promise<number> {
  const answer: { made?: number } = await post<{ made?: number }>(
    `/cloud-cost-view/${viewId.toString()}/make-groups`,
    {},
  );

  return Number(answer.made) || 0;
}

// The project's cost views, by name.
export async function fetchCloudCostViews(): Promise<Array<CloudCostView>> {
  const views: ListResult<CloudCostView> =
    await ModelAPI.getList<CloudCostView>({
      modelType: CloudCostView,
      query: {},
      select: { _id: true, name: true, grouping: true, tagKey: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return views.data;
}

// A view's groups in their order, rules read.
export async function fetchCloudCostGroups(
  viewId: ObjectID,
): Promise<Array<CloudCostGroup>> {
  const groups: ListResult<CloudCostGroup> =
    await ModelAPI.getList<CloudCostGroup>({
      modelType: CloudCostGroup,
      query: { cloudCostViewId: viewId },
      select: {
        _id: true,
        name: true,
        order: true,
        rules: true,
        isShared: true,
        automaticKey: true,
        teamId: true,
      },
      sort: { order: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return groups.data;
}

// A group's rules as they read, or none when they do not.
export function readGroupRules(group: CloudCostGroup): Array<CloudCostRule> {
  try {
    return readCloudCostRules(group.rules);
  } catch {
    return [];
  }
}

/*
 * The names the rule editor and a rule's sentence show for the records a
 * rule names, by their IDs in lower case.
 */
export interface CloudCostRecordNames {
  teams: Map<string, string>;
  labels: Map<string, string>;
  clusters: Map<string, string>;
}

export async function fetchCloudCostRecordNames(): Promise<CloudCostRecordNames> {
  const [teams, labels, clusters]: [
    ListResult<Team>,
    ListResult<Label>,
    ListResult<KubernetesCluster>,
  ] = await Promise.all([
    ModelAPI.getList<Team>({
      modelType: Team,
      query: {},
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<Label>({
      modelType: Label,
      query: {},
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<KubernetesCluster>({
      modelType: KubernetesCluster,
      query: {},
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }).catch((): ListResult<KubernetesCluster> => {
      // A person who may not read clusters still edits the rest.
      return {
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
      } as ListResult<KubernetesCluster>;
    }),
  ]);

  const byId: <
    T extends { _id?: string | undefined; name?: string | undefined },
  >(
    rows: Array<T>,
  ) => Map<string, string> = <
    T extends { _id?: string | undefined; name?: string | undefined },
  >(
    rows: Array<T>,
  ): Map<string, string> => {
    return new Map(
      rows
        .filter((row: T): boolean => {
          return Boolean(row._id);
        })
        .map((row: T): [string, string] => {
          return [String(row._id).toLowerCase(), row.name || ""];
        }),
    );
  };

  return {
    teams: byId(
      teams.data as unknown as Array<{ _id?: string; name?: string }>,
    ),
    labels: byId(
      labels.data as unknown as Array<{ _id?: string; name?: string }>,
    ),
    clusters: byId(
      clusters.data as unknown as Array<{ _id?: string; name?: string }>,
    ),
  };
}
