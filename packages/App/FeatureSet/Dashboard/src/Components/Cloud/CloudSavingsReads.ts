import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CloudSavingKind } from "Common/Types/Cloud/CloudCost";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT THE CLOUD PAGES READ OF THE WAYS TO SPEND LESS.
 *
 * The recommendations (CloudCostRecommendation) are few - hundreds for a
 * large estate - so a page reads the ones it shows, the largest savings
 * first, and adds up what they save a month in the one currency the
 * project's costs are in.
 */

export interface CloudSavingsSummary {
  // What every recommendation of the currency saves a month.
  monthlySavings: number;
  count: number;
  // By kind: rightsize, idle, commitments...
  byKind: Map<CloudSavingKind, { count: number; monthlySavings: number }>;
  // The largest first, at most `top` of them.
  top: Array<CloudCostRecommendation>;
}

export function summarizeCloudSavings(data: {
  recommendations: Array<CloudCostRecommendation>;
  currency: string;
  top: number;
}): CloudSavingsSummary {
  const summary: CloudSavingsSummary = {
    monthlySavings: 0,
    count: 0,
    byKind: new Map(),
    top: [],
  };

  const inCurrency: Array<CloudCostRecommendation> = data.recommendations
    .filter((recommendation: CloudCostRecommendation): boolean => {
      return (
        (recommendation.currency || "USD").toUpperCase() ===
        data.currency.toUpperCase()
      );
    })
    .sort((a: CloudCostRecommendation, b: CloudCostRecommendation): number => {
      return (Number(b.monthlySavings) || 0) - (Number(a.monthlySavings) || 0);
    });

  for (const recommendation of inCurrency) {
    const saving: number = Number(recommendation.monthlySavings) || 0;
    const kind: CloudSavingKind =
      (recommendation.kind as CloudSavingKind) || CloudSavingKind.Other;
    const entry: { count: number; monthlySavings: number } = summary.byKind.get(
      kind,
    ) || { count: 0, monthlySavings: 0 };

    entry.count++;
    entry.monthlySavings += saving;
    summary.byKind.set(kind, entry);
    summary.count++;
    summary.monthlySavings += saving;
  }

  summary.monthlySavings = Math.round(summary.monthlySavings * 100) / 100;
  summary.top = inCurrency.slice(0, data.top);

  return summary;
}

export async function fetchCloudSavings(data: {
  query?: Query<CloudCostRecommendation> | undefined;
  projectId: ObjectID;
  // The largest this many: an Overview's few.
  limit?: number | undefined;
}): Promise<Array<CloudCostRecommendation>> {
  const result: ListResult<CloudCostRecommendation> =
    await ModelAPI.getList<CloudCostRecommendation>({
      modelType: CloudCostRecommendation,
      query: {
        projectId: data.projectId,
        ...(data.query || {}),
      } as Query<CloudCostRecommendation>,
      select: {
        _id: true,
        kind: true,
        action: true,
        resourceName: true,
        resourceType: true,
        resourceId: true,
        region: true,
        currentConfiguration: true,
        recommendedConfiguration: true,
        monthlySavings: true,
        currency: true,
        source: true,
        cloudAccountId: true,
        cloudResourceId: true,
        cloudAccount: { name: true },
        cloudResource: { name: true },
      },
      sort: { monthlySavings: SortOrder.Descending },
      skip: 0,
      limit: data.limit || LIMIT_PER_PROJECT,
    });

  return result.data;
}
