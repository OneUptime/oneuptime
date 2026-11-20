import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  KubernetesVolumeClaimUsage,
  getKubernetesVolumeClaimKey,
  getKubernetesVolumeClaimUsage,
} from "./KubernetesVolumeUsage";

/*
 * A cluster's claims' latest usage, read from the inventory (the
 * KubernetesResource rows ingest keeps it on): for a claim's own page, and
 * for the Persistent Volumes list and a volume's page, which show the usage
 * of the claim bound to each volume.
 */

const CLAIM_USAGE_SELECT: Record<string, boolean> = {
  name: true,
  namespaceKey: true,
  status: true,
  spec: true,
  latestVolumeCapacityBytes: true,
  latestVolumeAvailableBytes: true,
  latestVolumeInodes: true,
  latestVolumeInodesFree: true,
  latestVolumeMeasuredAt: true,
  latestVolumeUsedBaselineBytes: true,
  latestVolumeUsedBaselineAt: true,
  metricsUpdatedAt: true,
};

export function getClaimUsageFromRow(
  row: KubernetesResourceModel,
): KubernetesVolumeClaimUsage {
  return getKubernetesVolumeClaimUsage({
    latestVolumeCapacityBytes: row.latestVolumeCapacityBytes,
    latestVolumeAvailableBytes: row.latestVolumeAvailableBytes,
    latestVolumeInodes: row.latestVolumeInodes,
    latestVolumeInodesFree: row.latestVolumeInodesFree,
    latestVolumeMeasuredAt: row.latestVolumeMeasuredAt,
    latestVolumeUsedBaselineBytes: row.latestVolumeUsedBaselineBytes,
    latestVolumeUsedBaselineAt: row.latestVolumeUsedBaselineAt,
    metricsUpdatedAt: row.metricsUpdatedAt,
    status: (row.status as JSONObject | undefined) || null,
    spec: (row.spec as JSONObject | undefined) || null,
  });
}

/*
 * One claim's usage, by its name and, where the page knows it, its
 * namespace (names repeat across namespaces). Null when the inventory has
 * no such claim.
 */
export async function fetchKubernetesVolumeClaimUsage(data: {
  kubernetesClusterId: ObjectID;
  name: string;
  namespace?: string | undefined;
}): Promise<KubernetesVolumeClaimUsage | null> {
  const query: Record<string, unknown> = {
    kubernetesClusterId: data.kubernetesClusterId,
    kind: "PersistentVolumeClaim",
    name: data.name,
  };

  if (data.namespace) {
    query["namespaceKey"] = data.namespace;
  }

  const result: ListResult<KubernetesResourceModel> =
    await ModelAPI.getList<KubernetesResourceModel>({
      modelType: KubernetesResourceModel,
      query: query,
      skip: 0,
      limit: 1,
      select: CLAIM_USAGE_SELECT,
      sort: {
        namespaceKey: SortOrder.Ascending,
      },
    });

  const row: KubernetesResourceModel | undefined = result.data[0];

  return row ? getClaimUsageFromRow(row) : null;
}

// Every claim's usage in a cluster, by "namespace/name".
export async function fetchKubernetesVolumeClaimUsages(data: {
  kubernetesClusterId: ObjectID;
}): Promise<Map<string, KubernetesVolumeClaimUsage>> {
  const result: ListResult<KubernetesResourceModel> =
    await ModelAPI.getList<KubernetesResourceModel>({
      modelType: KubernetesResourceModel,
      query: {
        kubernetesClusterId: data.kubernetesClusterId,
        kind: "PersistentVolumeClaim",
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: CLAIM_USAGE_SELECT,
      sort: {
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      },
    });

  const usages: Map<string, KubernetesVolumeClaimUsage> = new Map();

  for (const row of result.data) {
    if (!row.name) {
      continue;
    }
    usages.set(
      getKubernetesVolumeClaimKey(row.namespaceKey || "", row.name),
      getClaimUsageFromRow(row),
    );
  }

  return usages;
}
