import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  KubernetesCostEngineInfo,
  KubernetesCostPricingSource,
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
 *
 * A Kubecost that reads the cloud's bill reconciles each hour with it about
 * two days on, and the cost agent brings the reconciled figures in then, as
 * rows of their own (isCostAdjustment, #9969). The newest of those says how
 * far the window's figures are reconciled.
 */

/*
 * The engine behind a window's figures, and, for a Kubecost that reads the
 * cloud's bill, how far they are reconciled with it.
 */
export interface KubernetesCostEngineView extends KubernetesCostEngineInfo {
  /*
   * The end of the newest hour of the window a reconciliation corrected, or
   * null when none did (yet). Absent where it is not read.
   */
  reconciledThrough?: Date | null | undefined;
  // The end of the window's newest hour.
  pricedThrough?: Date | null | undefined;
}

// A row's window end as a date, whatever the API handed back.
const dateOf: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const date: Date = OneUptimeDate.fromString(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
};

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
    memoryPeaksFrom: row.memoryPeaksFrom,
  });
};

/*
 * The newest hour of the window a reconciliation corrected (#9969): the end
 * of the newest correction row's window. Null when there is none, or when
 * it cannot be read: the line then says what it says before any.
 */
const fetchReconciledThrough: (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}) => Promise<Date | null> = async (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}): Promise<Date | null> => {
  try {
    const result: AnalyticsListResult<KubernetesCostAllocation> =
      await AnalyticsModelAPI.getList<KubernetesCostAllocation>({
        modelType: KubernetesCostAllocation,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          kubernetesClusterId: data.kubernetesClusterId.toString(),
          windowStart: new InBetween<Date>(data.startDate, data.endDate),
          isCostAdjustment: true,
        } as unknown as Query<KubernetesCostAllocation>,
        select: {
          windowStart: true,
          windowEnd: true,
        },
        sort: { windowStart: SortOrder.Descending },
        limit: 1,
        skip: 0,
      });

    return dateOf(result.data[0]?.windowEnd);
  } catch {
    return null;
  }
};

export const fetchKubernetesCostEngine: (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}) => Promise<KubernetesCostEngineView | null> = async (data: {
  kubernetesClusterId: ObjectID;
  startDate: Date;
  endDate: Date;
}): Promise<KubernetesCostEngineView | null> => {
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
          windowEnd: true,
          costEngine: true,
          costEngineService: true,
          bundledEngineUnused: true,
          pricingSource: true,
          pricingProvider: true,
          memoryPeaksFrom: true,
        },
        sort: { windowStart: SortOrder.Descending },
        limit: 1,
        skip: 0,
      });

    const newest: KubernetesCostAllocation | undefined = result.data[0];
    const engine: KubernetesCostEngineInfo | null =
      toKubernetesCostEngine(newest);

    if (!engine) {
      return null;
    }

    // Only a Kubecost that reads the bill has reconciled figures to say of.
    if (
      engine.pricingSource !== KubernetesCostPricingSource.BillingIntegration
    ) {
      return engine;
    }

    return {
      ...engine,
      reconciledThrough: await fetchReconciledThrough(data),
      pricedThrough: dateOf(newest?.windowEnd),
    };
  } catch {
    /*
     * The line is an extra beside the figures: a read that fails leaves it
     * out rather than failing the card or the page.
     */
    return null;
  }
};
