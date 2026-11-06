import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import { DataObservabilityAiAppTable } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import DataAssetUsageService from "../../Services/DataAssetUsageService";

/*
 * THE STALE TABLES BEHIND AN AI APP'S ANSWERS.
 *
 * An AI app that retrieves from a table gives worse answers when that table
 * stops changing, and nothing in its own traces says so: the model answered,
 * quickly, from old data. A service seen both calling a model and reading a table
 * (TableUsageDiscovery) is that table's AI consumer, and this names the tables
 * that have gone late under one, for the AI product's page.
 */

const MAX_USAGES_READ: number = 500;
const MAX_LISTED: number = 20;

export default class DataAiAppTables {
  public static async readLate(
    projectId: ObjectID,
    now: Date,
  ): Promise<Array<DataObservabilityAiAppTable>> {
    const usages: Array<DataAssetUsage> = await DataAssetUsageService.findBy({
      query: {
        projectId,
        isAiApp: true,
        accessKind: DataAssetAccessKind.Read,
      },
      select: {
        serviceName: true,
        dataAssetId: true,
        dataAsset: {
          name: true,
          schemaName: true,
          assetKind: true,
          lastChangedAt: true,
          updateIntervalInSeconds: true,
          isDropped: true,
        },
      },
      limit: MAX_USAGES_READ,
      skip: 0,
      props: { isRoot: true },
    });

    return usages
      .flatMap((usage: DataAssetUsage): Array<DataObservabilityAiAppTable> => {
        const asset: DataAsset | undefined = usage.dataAsset;

        if (!asset || asset.isDropped || !usage.dataAssetId) {
          return [];
        }

        const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
          kind: asset.assetKind,
          lastChangedAt: asset.lastChangedAt,
          updateIntervalInSeconds: asset.updateIntervalInSeconds,
          now,
        });

        if (freshness.freshness !== DataAssetFreshness.Late) {
          return [];
        }

        return [
          {
            dataAssetId: usage.dataAssetId.toString(),
            table: asset.schemaName
              ? `${asset.schemaName}.${asset.name || ""}`
              : asset.name || "",
            serviceName: usage.serviceName || "",
            lastChangedAt: asset.lastChangedAt
              ? new Date(asset.lastChangedAt).toISOString()
              : null,
          },
        ];
      })
      .slice(0, MAX_LISTED);
  }
}
