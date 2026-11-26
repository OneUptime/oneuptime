import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  CloudCostBreakdownReader,
  CloudCostBreakdownResult,
  CloudCostColumnDimension,
  CloudCostDimension,
  CloudCostPlatformLists,
  CloudCostPoint,
  CloudCostScope,
  CloudCostShare,
  readCloudCostBreakdown,
  readCloudCostRows,
  readCloudCostShares,
  readCloudCostTagRows,
  readCloudCostTrend,
  toCloudCostPlatformLists,
} from "Common/Types/Cloud/CloudCostBreakdowns";
import {
  CloudPlatformCostRow,
  CloudPlatformTaggedCostRow,
} from "Common/Types/Cloud/CloudPlatformCosts";
import { CloudCostAllocationResult } from "Common/Types/Cloud/CloudCostAllocation";
import { fetchCloudCostAllocation } from "./CostGroups/CloudCostAllocationReads";

/*
 * WHAT THE CLOUD PAGES READ OF THE COSTS THEMSELVES.
 *
 * The headline figures - this month, its projection, last month - are on
 * each account's summary (CloudAccount.costSummary). What a page draws over
 * time or breaks down - each day's spend, the services, Regions, accounts
 * and resources that cost the most - is summed from the cost rows
 * (CloudCost) through /aggregate, in the window the page shows and in one
 * currency (a company's accounts are billed in one; an account billed in
 * another is left out and said so).
 *
 * How each breakdown is worked out lives in Common
 * (Types/Cloud/CloudCostBreakdowns), so the API, the CLI, a scheduled
 * report and the Dashboards' Cloud Cost widget work it out the same way
 * (#11009). This file reads it as the person signed in: the costs through
 * /aggregate, a cost view's allocation through its route, and the
 * project's App Platforms environments and apps through the list API.
 */

export {
  CLOUD_COST_DIMENSIONS,
  buildCloudCostAggregateBy,
  fillCloudCostDays,
  isCloudCostColumnDimension,
  isCloudCostDimension,
  mergeCloudCostTagKeys,
  mergeCloudTopServices,
  sortCloudCostShares,
  toCloudCostShares,
} from "Common/Types/Cloud/CloudCostBreakdowns";

export type {
  CloudCostBreakdownResult,
  CloudCostColumnDimension,
  CloudCostDimension,
  CloudCostPlatformLists,
  CloudCostPoint,
  CloudCostRest,
  CloudCostRestKind,
  CloudCostScope,
  CloudCostShare,
} from "Common/Types/Cloud/CloudCostBreakdowns";

// The project's App Platforms environments and apps, as a breakdown names them.
export async function fetchCloudCostPlatformLists(): Promise<CloudCostPlatformLists> {
  const [environments, apps]: [
    ListResult<CloudResource>,
    ListResult<CloudApp>,
  ] = await Promise.all([
    ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: { cloudResourceKind: CloudResourceKind.Environment },
      select: {
        _id: true,
        name: true,
        cloudPlatform: true,
        cloudProvider: true,
        cloudAccountId: true,
        cloudRegion: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<CloudApp>({
      modelType: CloudApp,
      query: {},
      select: {
        _id: true,
        name: true,
        cloudResourceId: true,
        groupName: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
  ]);

  return toCloudCostPlatformLists({
    environments: environments.data,
    apps: apps.data,
  });
}

/*
 * The Dashboard's reader: as the person signed in, through the API. Each
 * call reads AnalyticsModelAPI and ModelAPI when it runs, so a page's tests
 * can stand in for them.
 */
export const DASHBOARD_CLOUD_COST_READER: CloudCostBreakdownReader = {
  aggregate: async (
    aggregateBy: AggregateBy<CloudCost>,
  ): Promise<AggregatedResult> => {
    return await AnalyticsModelAPI.aggregate<CloudCost>({
      modelType: CloudCost,
      aggregateBy,
    });
  },
  readAllocation: async (data: {
    viewId: ObjectID;
    startDate: Date;
    endDate: Date;
    currency: string;
    basis?: CloudCostScope["basis"];
    cloudAccountIds?: Array<ObjectID> | undefined;
  }): Promise<CloudCostAllocationResult> => {
    return await fetchCloudCostAllocation({
      viewId: data.viewId,
      ask: {
        startDate: data.startDate,
        endDate: data.endDate,
        currency: data.currency,
        basis: data.basis,
        cloudAccountIds: data.cloudAccountIds,
      },
    });
  },
  readPlatformLists: fetchCloudCostPlatformLists,
};

export async function fetchCloudCostTrend(
  scope: CloudCostScope,
): Promise<Array<CloudCostPoint>> {
  return await readCloudCostTrend(DASHBOARD_CLOUD_COST_READER, scope);
}

// The costs of a window summed by some of their columns, in one currency.
export async function fetchCloudCostRows(data: {
  scope: CloudCostScope;
  groupBy: Array<keyof CloudCost>;
  // Only these services' costs, when given.
  services?: ReadonlyArray<string> | undefined;
}): Promise<Array<CloudPlatformCostRow>> {
  return await readCloudCostRows(DASHBOARD_CLOUD_COST_READER, data);
}

/*
 * The costs of a window summed by one tag's value - "" for the costs
 * without it - and, when asked, by account and Region too.
 */
export async function fetchCloudCostTagRows(data: {
  scope: CloudCostScope;
  tagKey: string;
  byPlace?: boolean | undefined;
}): Promise<Array<CloudPlatformTaggedCostRow>> {
  return await readCloudCostTagRows(DASHBOARD_CLOUD_COST_READER, data);
}

/*
 * A window's spend broken down: by a column, by App Platforms environment
 * or app (with what no environment, or no one app, is billed), by a tag's
 * value (with the costs that do not carry it), or by a cost view's groups.
 * The shares and the rest add up to the period's spend. The card hands in
 * the environments and apps of the accounts it is over; a breakdown by
 * either without them finds none.
 */
export async function fetchCloudCostBreakdown(data: {
  scope: CloudCostScope;
  dimension: CloudCostDimension;
  // The tag, for a breakdown by tag.
  tagKey?: string | undefined;
  // The environments and apps, for a breakdown by either.
  lists?: CloudCostPlatformLists | undefined;
  // The cost view, for a breakdown by its groups.
  viewId?: ObjectID | undefined;
}): Promise<CloudCostBreakdownResult> {
  return await readCloudCostBreakdown(DASHBOARD_CLOUD_COST_READER, {
    ...data,
    lists: data.lists || { environments: [], apps: [] },
  });
}

export async function fetchCloudCostShares(data: {
  scope: CloudCostScope;
  dimension: CloudCostColumnDimension;
}): Promise<Array<CloudCostShare>> {
  return await readCloudCostShares(DASHBOARD_CLOUD_COST_READER, data);
}
