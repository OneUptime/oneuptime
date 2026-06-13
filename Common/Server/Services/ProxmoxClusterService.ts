import DatabaseService from "./DatabaseService";
import ProxmoxClusterLabelRuleEngineService from "./ProxmoxClusterLabelRuleEngineService";
import ProxmoxClusterOwnerRuleEngineService from "./ProxmoxClusterOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/ProxmoxCluster";
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

const LAST_SEEN_CACHE_NAMESPACE: string = "proxmox-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "proxmox-cluster-labels-applied";
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
          await ProxmoxClusterLabelRuleEngineService.applyRulesToProxmoxCluster(
            createdItem,
          );
        })
        .then(async () => {
          await ProxmoxClusterOwnerRuleEngineService.applyRulesToProxmoxCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying proxmox cluster rules in ProxmoxClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              proxmoxClusterId: createdItem.id?.toString(),
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
     * A Proxmox cluster is keyed by the `proxmox.cluster.name` OTel resource
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

      throw new Error("Failed to create or find Proxmox cluster: " + name);
    }
  }

  /*
   * Refresh lastSeenAt / connection status and (optionally) the
   * snapshot columns the list page renders. Count columns ride this
   * extras path with COALESCE-per-column semantics: a key that is
   * undefined is simply not written, so a partial batch (one that
   * lacked the matching *_info series) never zeroes a count. The
   * 60-second extras fingerprint cache is the write throttle — the
   * steady state (identical snapshot every scrape) costs one Redis
   * read per batch and at most one Postgres UPDATE per minute.
   *
   * Two callers share this throttle with DISJOINT extras shapes: the
   * metrics snapshot flush (pveVersion + counts, every batch) and the
   * fenced autoDiscoverProxmoxCluster maintenance path (agentVersion
   * only — and usually an all-null fingerprint, since the shipped
   * agent config does not stamp oneuptime.agent.version). The single
   * fingerprint covers the whole extras object, so each alternation
   * between the two shapes busts the throttle: at most one extra
   * Postgres UPDATE per maintenance-fence window (~5 min), which is
   * accepted. Do NOT key the cache per-caller — that would let two
   * callers each refresh lastSeenAt under their own throttle and is
   * not worth the complexity for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      pveVersion?: string | undefined;
      agentVersion?: string | undefined;
      nodeCount?: number | undefined;
      onlineNodeCount?: number | undefined;
      guestCount?: number | undefined;
      storageCount?: number | undefined;
      guestsWithoutBackupCount?: number | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = clusterId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          pveVersion: extra?.pveVersion ?? null,
          agentVersion: extra?.agentVersion ?? null,
          nodeCount: extra?.nodeCount ?? null,
          onlineNodeCount: extra?.onlineNodeCount ?? null,
          guestCount: extra?.guestCount ?? null,
          storageCount: extra?.storageCount ?? null,
          guestsWithoutBackupCount: extra?.guestsWithoutBackupCount ?? null,
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

    if (extra?.pveVersion) {
      data.pveVersion = extra.pveVersion;
    }
    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }
    // Counts: 0 is a legitimate value — gate on undefined, not falsiness.
    if (extra?.nodeCount !== undefined) {
      data.nodeCount = extra.nodeCount;
    }
    if (extra?.onlineNodeCount !== undefined) {
      data.onlineNodeCount = extra.onlineNodeCount;
    }
    if (extra?.guestCount !== undefined) {
      data.guestCount = extra.guestCount;
    }
    if (extra?.storageCount !== undefined) {
      data.storageCount = extra.storageCount;
    }
    if (extra?.guestsWithoutBackupCount !== undefined) {
      data.guestsWithoutBackupCount = extra.guestsWithoutBackupCount;
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
   * Additively attach labels to a Proxmox cluster. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    proxmoxClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.proxmoxClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const proxmoxClusterIdStr: string = data.proxmoxClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(proxmoxClusterIdStr)
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
          .of(proxmoxClusterIdStr)
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
        `ProxmoxClusterService.attachLabels failed for proxmox cluster ${data.proxmoxClusterId.toString()}: ${
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
