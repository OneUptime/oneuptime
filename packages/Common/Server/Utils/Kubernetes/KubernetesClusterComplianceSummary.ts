import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { KubernetesComplianceResponse } from "../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceSummary,
  isKubernetesComplianceSummaryDue,
  summarizeKubernetesCompliance,
} from "../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import KubernetesClusterCompliance from "./KubernetesClusterCompliance";

/*
 * EACH CLUSTER'S COMPLIANCE SUMMARY, KEPT FRESH (#9876).
 *
 * Kubernetes' Compliance page compares every cluster's hardening from the
 * summary on each cluster's record (KubernetesComplianceSummary), so no
 * visit scores a cluster. A summary is worked out from the very answer the
 * cluster's own Compliance page draws, and written:
 *
 *   - when that page is read: the answer is at hand, so the summary of a
 *     cluster someone just changed a switch on, or accepted a finding of,
 *     is that change's at once (KubernetesResourceAPI.getCompliance);
 *   - by the Kubernetes:RefreshComplianceSummaries job, every five minutes,
 *     for each cluster that is due: never scored, its agent reporting and
 *     scored over KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES ago - its
 *     snapshots, pulled every five minutes, have landed since - or scored
 *     over KUBERNETES_COMPLIANCE_SUMMARY_MAX_AGE_MINUTES ago whatever its
 *     agent does, so a setting changed through the API, or an accepted
 *     finding that expired, shows within the hour.
 *
 * Written as OneUptime's own bookkeeping, in one statement and without the
 * update path's hooks (updateColumnsByIdWithoutHooks): nobody changed the
 * cluster, so nothing is audited, no workflow runs, and updatedAt stays.
 */

// The most clusters one run of the job scores; the rest are next.
export const MAX_SUMMARIES_PER_RUN: number = 100;

export interface ComplianceSummaryCluster {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  provider: string | null;
}

export interface ComplianceSummaryRefreshResult {
  refreshed: number;
  failed: number;
  // Due but left for the next run: the run's cap or its deadline.
  left: number;
}

export default class KubernetesClusterComplianceSummary {
  // A cluster's answer, as its summary keeps it, written on its record.
  @CaptureSpan()
  public static async store(data: {
    clusterId: ObjectID;
    compliance: KubernetesComplianceResponse;
    refreshedAt: Date;
  }): Promise<KubernetesComplianceSummary> {
    const summary: KubernetesComplianceSummary = summarizeKubernetesCompliance(
      data.compliance,
      data.refreshedAt,
    );

    await KubernetesClusterService.updateColumnsByIdWithoutHooks({
      id: data.clusterId,
      data: {
        complianceSummary: summary,
        complianceSummaryRefreshedAt: data.refreshedAt,
      },
      skipUpdateDateColumn: true,
    });

    return summary;
  }

  /*
   * The summary of an answer just worked out for a person, kept on the
   * cluster. A failure is logged, never handed on: the person asked for
   * the answer, which they get either way.
   */
  public static async storeQuietly(data: {
    clusterId: ObjectID;
    compliance: KubernetesComplianceResponse;
    refreshedAt: Date;
  }): Promise<void> {
    try {
      await this.store(data);
    } catch (err) {
      logger.error(
        `Kubernetes compliance summary of cluster ${data.clusterId.toString()} was not stored: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // One cluster scored now, and its summary kept.
  @CaptureSpan()
  public static async refresh(
    cluster: ComplianceSummaryCluster,
    now: Date,
  ): Promise<KubernetesComplianceSummary> {
    const compliance: KubernetesComplianceResponse =
      await KubernetesClusterCompliance.readCompliance({
        projectId: cluster.projectId,
        cluster: {
          id: cluster.id,
          name: cluster.name,
          provider: cluster.provider,
        },
        now,
      });

    return await this.store({
      clusterId: cluster.id,
      compliance,
      refreshedAt: now,
    });
  }

  /*
   * The clusters due, oldest summary first - one never scored before any -
   * at most `limit` of them. Archived clusters are left alone: no list
   * shows them.
   */
  @CaptureSpan()
  public static async findDueClusters(data: {
    now: Date;
    limit: number;
  }): Promise<{ due: Array<ComplianceSummaryCluster>; dueCount: number }> {
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: { isArchived: false },
        select: {
          _id: true,
          projectId: true,
          name: true,
          clusterIdentifier: true,
          provider: true,
          otelCollectorStatus: true,
          complianceSummaryRefreshedAt: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const due: Array<KubernetesCluster> = clusters
      .filter((cluster: KubernetesCluster): boolean => {
        return (
          Boolean(cluster._id && cluster.projectId) &&
          isKubernetesComplianceSummaryDue({
            refreshedAt: cluster.complianceSummaryRefreshedAt,
            isConnected: cluster.otelCollectorStatus === "connected",
            now: data.now,
          })
        );
      })
      .sort((a: KubernetesCluster, b: KubernetesCluster): number => {
        return (
          (a.complianceSummaryRefreshedAt
            ? new Date(a.complianceSummaryRefreshedAt).getTime()
            : 0) -
          (b.complianceSummaryRefreshedAt
            ? new Date(b.complianceSummaryRefreshedAt).getTime()
            : 0)
        );
      });

    return {
      dueCount: due.length,
      due: due
        .slice(0, data.limit)
        .map((cluster: KubernetesCluster): ComplianceSummaryCluster => {
          return {
            id: new ObjectID(cluster._id!.toString()),
            projectId: new ObjectID(cluster.projectId!.toString()),
            name:
              cluster.name?.toString() ||
              cluster.clusterIdentifier?.toString() ||
              cluster._id!.toString(),
            provider: cluster.provider || null,
          };
        }),
    };
  }

  /*
   * What the job does each run: score each cluster that is due, until the
   * cap or the run's deadline. One that fails is logged and left due, so the
   * next run tries it again; the others are scored all the same.
   */
  @CaptureSpan()
  public static async refreshDueClusters(data: {
    now: Date;
    limit?: number | undefined;
    deadline?: JobDeadline | undefined;
  }): Promise<ComplianceSummaryRefreshResult> {
    const { due, dueCount } = await this.findDueClusters({
      now: data.now,
      limit: data.limit || MAX_SUMMARIES_PER_RUN,
    });
    const result: ComplianceSummaryRefreshResult = {
      refreshed: 0,
      failed: 0,
      left: dueCount - due.length,
    };

    for (let index: number = 0; index < due.length; index++) {
      if (data.deadline?.hasPassed()) {
        result.left += due.length - index;
        break;
      }

      const cluster: ComplianceSummaryCluster = due[index]!;

      try {
        await this.refresh(cluster, data.now);
        result.refreshed += 1;
      } catch (err) {
        result.failed += 1;
        logger.error(
          `Kubernetes compliance summary of cluster ${cluster.id.toString()} could not be worked out: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }
}
