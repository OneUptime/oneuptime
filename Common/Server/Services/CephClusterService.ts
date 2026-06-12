import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CephCluster";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "ceph-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "ceph-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findOrCreateByName(data: {
    projectId: ObjectID;
    name: string;
  }): Promise<Model> {
    /*
     * A Ceph cluster is keyed by the `ceph.cluster.name` OTel resource
     * attribute, which the user configures on the agent. Look it up
     * case-insensitively: the unique guard (checkUniqueColumnBy ->
     * findWithSameText) compares case-insensitively, so a case-sensitive
     * lookup would miss an existing row that differs only by case, then
     * fail to create it — wedging ingest for that cluster. Unlike
     * DockerHost.hostIdentifier (host.name casing is unstable on Windows)
     * the configured cluster name's casing is stable, so we preserve the
     * user's casing on create instead of canonicalizing to lowercase.
     */
    const name: string = data.name.trim();

    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(name),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
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
      newCluster.name = name;
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
       * Either two ingest workers raced to create the same cluster, or a
       * cluster with this name in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameText(name),
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error("Failed to create or find Ceph cluster: " + name);
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      cephVersion?: string | undefined;
      fsid?: string | undefined;
      agentVersion?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = clusterId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          cephVersion: extra?.cephVersion ?? null,
          fsid: extra?.fsid ?? null,
          agentVersion: extra?.agentVersion ?? null,
        }),
      )
      .digest("hex");

    const cached: string | null = await GlobalCache.getString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
    );

    if (cached === extrasFingerprint) {
      return; // same data was written recently
    }

    await GlobalCache.setString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
      extrasFingerprint,
      { expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    if (extra?.cephVersion) {
      data.cephVersion = extra.cephVersion;
    }
    if (extra?.fsid) {
      data.fsid = extra.fsid;
    }
    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }

    await this.updateOneById({
      id: clusterId,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Additively attach labels to a Ceph cluster. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    cephClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.cephClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const cephClusterIdStr: string = data.cephClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(cephClusterIdStr)
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
          .of(cephClusterIdStr)
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
        `CephClusterService.attachLabels failed for ceph cluster ${data.cephClusterId.toString()}: ${
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
