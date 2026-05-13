import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "k8s-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "k8s-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findOrCreateByClusterIdentifier(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<Model> {
    // Try to find existing cluster
    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        clusterIdentifier: data.clusterIdentifier,
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCluster) {
      return existingCluster;
    }

    try {
      // Create new cluster
      const newCluster: Model = new Model();
      newCluster.projectId = data.projectId;
      newCluster.name = data.clusterIdentifier;
      newCluster.clusterIdentifier = data.clusterIdentifier;
      newCluster.otelCollectorStatus = "connected";
      newCluster.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdCluster: Model = await this.create({
        data: newCluster,
        props: {
          isRoot: true,
        },
      });

      return createdCluster;
    } catch {
      /*
       * Race condition: another request created the cluster concurrently.
       * Re-fetch the existing cluster.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          clusterIdentifier: data.clusterIdentifier,
        },
        select: {
          _id: true,
          projectId: true,
          clusterIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error(
        "Failed to create or find cluster: " + data.clusterIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(clusterId: ObjectID): Promise<void> {
    const cacheKey: string = clusterId.toString();

    const cached: string | null = await GlobalCache.getString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
    );

    if (cached) {
      return; // another pod already updated recently
    }

    await GlobalCache.setString(LAST_SEEN_CACHE_NAMESPACE, cacheKey, "1", {
      expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS,
    });

    await this.updateOneById({
      id: clusterId,
      data: {
        lastSeenAt: OneUptimeDate.getCurrentDate(),
        otelCollectorStatus: "connected",
      },
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Additively attach labels to a Kubernetes cluster. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for 60s
   * so the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    kubernetesClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.kubernetesClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const clusterIdStr: string = data.kubernetesClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(clusterIdStr)
        .loadMany();

      const existingIds: Set<string> = new Set();
      for (const lbl of existingLabels) {
        const idStr: string | undefined = lbl._id?.toString();
        if (idStr) {
          existingIds.add(idStr);
        }
      }

      const toAddIds: Array<string> = [];
      const seen: Set<string> = new Set();
      for (const id of data.labelIds) {
        const idStr: string = id.toString();
        if (existingIds.has(idStr) || seen.has(idStr)) {
          continue;
        }
        seen.add(idStr);
        toAddIds.push(idStr);
      }

      if (toAddIds.length > 0) {
        await this.getRepository()
          .createQueryBuilder()
          .relation(Model, "labels")
          .of(clusterIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `KubernetesClusterService.attachLabels failed for cluster ${data.kubernetesClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedClusters(): Promise<void> {
    const fiveMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fiveMinutesAgo),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const cluster of connectedClusters) {
      if (cluster._id) {
        await this.updateOneById({
          id: new ObjectID(cluster._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

export default new Service();
