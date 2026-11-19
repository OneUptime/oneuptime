import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  KubernetesCostEngineInfo,
  readKubernetesCostEngineInfo,
} from "Common/Types/Kubernetes/KubernetesCostPricing";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * WHICH ENGINE PRICED A CLUSTER'S COST, AND WHERE ITS PRICES CAME FROM
 * (#9633, #9634).
 *
 * Every cost row says how it was priced (the cost agent says so with each
 * shipment, and ingest stamps it on the rows), so this reads the newest row
 * of the window the page shows: the pricing behind the figures beside it.
 * Null for a window with no rows, or only rows from an agent older than
 * #9634, which says nothing - the pages then say nothing either, rather
 * than guess.
 */

export const toKubernetesCostEngine: (
  row: KubernetesCostAllocation | undefined,
) => KubernetesCostEngineInfo | null = (
  row: KubernetesCostAllocation | undefined,
): KubernetesCostEngineInfo | null => {
  if (!row || !row.pricingSource) {
    return null;
  }

  const unused: unknown = row.bundledEngineUnused;

  return readKubernetesCostEngineInfo({
    engine: row.costEngine,
    service: row.costEngineService,
    // A Bool column can come back as 1 from some ClickHouse formats.
    bundledEngineUnused: unused === true || unused === 1 || unused === "true",
    pricingSource: row.pricingSource,
    pricingProvider: row.pricingProvider,
  });
};

export const fetchKubernetesCostEngine: (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}) => Promise<KubernetesCostEngineInfo | null> = async (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}): Promise<KubernetesCostEngineInfo | null> => {
  try {
    const result: AnalyticsListResult<KubernetesCostAllocation> =
      await AnalyticsModelAPI.getList<KubernetesCostAllocation>({
        modelType: KubernetesCostAllocation,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          kubernetesClusterId: data.kubernetesClusterId.toString(),
          windowStart: new InBetween<Date>(data.startDate, data.endDate),
        } as unknown as Query<KubernetesCostAllocation>,
        select: {
          windowStart: true,
          costEngine: true,
          costEngineService: true,
          bundledEngineUnused: true,
          pricingSource: true,
          pricingProvider: true,
        },
        sort: { windowStart: SortOrder.Descending },
        limit: 1,
        skip: 0,
      });

    return toKubernetesCostEngine(result.data[0]);
  } catch {
    /*
     * The line is an extra beside the figures: a read that fails leaves it
     * out rather than failing the card or the page.
     */
    return null;
  }
};
