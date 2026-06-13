import DatabaseService from "./DatabaseService";
import CephClusterLabelRuleEngineService from "./CephClusterLabelRuleEngineService";
import CephClusterOwnerRuleEngineService from "./CephClusterOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/CephCluster";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
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
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Rules run once, on creation only — exact parity with
     * KubernetesClusterService. Label engine first: it syncs the
     * in-memory labels so the owner engine can match rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await CephClusterLabelRuleEngineService.applyRulesToCephCluster(
            createdItem,
          );
        })
        .then(async () => {
          await CephClusterOwnerRuleEngineService.applyRulesToCephCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying ceph cluster rules in CephClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              cephClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
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

  /*
   * Refresh lastSeenAt / connection status and (optionally) the
   * snapshot columns the list page renders. Count/health columns ride
   * this extras path with COALESCE-per-column semantics: a key that is
   * undefined is simply not written, so a partial batch (one that
   * lacked the matching *_metadata series) never zeroes a count. The
   * 60-second extras fingerprint cache is the write throttle — the
   * steady state (identical snapshot every scrape) costs one Redis
   * read per batch and at most one Postgres UPDATE per minute.
   *
   * Two callers share this throttle with DISJOINT extras shapes: the
   * metrics snapshot flush (version + counts/health, every batch) and
   * the fenced autoDiscoverCephCluster maintenance path (agentVersion
   * + optional fsid only — and usually an all-null fingerprint, since
   * the shipped agent config stamps neither oneuptime.agent.version
   * nor ceph.cluster.fsid by default). The single fingerprint covers
   * the whole extras object, so each alternation between the two
   * shapes busts the throttle: at most one extra Postgres UPDATE per
   * maintenance-fence window (~5 min), which is accepted. Do NOT key
   * the cache per-caller — that would let two callers each refresh
   * lastSeenAt under their own throttle and is not worth the
   * complexity for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      cephVersion?: string | undefined;
      fsid?: string | undefined;
      agentVersion?: string | undefined;
      monCount?: number | undefined;
      osdCount?: number | undefined;
      osdUpCount?: number | undefined;
      osdInCount?: number | undefined;
      poolCount?: number | undefined;
      healthStatus?: number | undefined;
      capacityUsedPercent?: number | undefined;
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
          monCount: extra?.monCount ?? null,
          osdCount: extra?.osdCount ?? null,
          osdUpCount: extra?.osdUpCount ?? null,
          osdInCount: extra?.osdInCount ?? null,
          poolCount: extra?.poolCount ?? null,
          healthStatus: extra?.healthStatus ?? null,
          capacityUsedPercent: extra?.capacityUsedPercent ?? null,
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
    /*
     * Counts and health: 0 is a legitimate value (healthStatus 0 = OK,
     * osdUpCount 0 = every OSD down) — gate on undefined, not falsiness.
     */
    if (extra?.monCount !== undefined) {
      data.monCount = extra.monCount;
    }
    if (extra?.osdCount !== undefined) {
      data.osdCount = extra.osdCount;
    }
    if (extra?.osdUpCount !== undefined) {
      data.osdUpCount = extra.osdUpCount;
    }
    if (extra?.osdInCount !== undefined) {
      data.osdInCount = extra.osdInCount;
    }
    if (extra?.poolCount !== undefined) {
      data.poolCount = extra.poolCount;
    }
    if (extra?.healthStatus !== undefined) {
      data.healthStatus = extra.healthStatus;
    }
    if (extra?.capacityUsedPercent !== undefined) {
      data.capacityUsedPercent = extra.capacityUsedPercent;
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
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fifteenMinutesAgo),
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
