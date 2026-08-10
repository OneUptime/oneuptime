import DatabaseService from "./DatabaseService";
import HostLabelRuleEngineService from "./HostLabelRuleEngineService";
import HostOwnerRuleEngineService from "./HostOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/Host";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import InProcessMemo from "../Utils/InProcessMemo";
import logger, { LogAttributes } from "../Utils/Logger";
import { canonicalizeEntityValue } from "../../Utils/Telemetry/EntityKey";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "host-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "host-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * What `findOrCreateByHostIdentifier` memoizes: the resolved row's id plus
 * the identifier it converged to. A flat shape rather than the Model itself
 * so a memo hit hands every caller a FRESH Model instance — the resolving
 * call and a memoed call must not share one mutable entity object.
 */
interface HostResolution {
  hostIdStr: string;
  hostIdentifier: string;
}

/*
 * Per-process memo for `(projectId, canonical hostIdentifier) -> Host`.
 *
 * `findOrCreateByHostIdentifier` ran an unconditional Postgres SELECT per
 * call, and the metrics ingest path calls it once per unique host per job
 * (the host-enrichment aggregation loop) on top of `autoDiscoverHost`'s
 * Redis-cache misses — for a fleet of workers chewing hostmetrics batches
 * that is a steady stream of identical case-insensitive lookups for rows
 * that change never. Same L1 shape as the service-resolution memo in
 * OpenTelemetryIngestService: 60-second TTL, bounded because host
 * identifiers arrive from collector-controlled resource attributes.
 *
 * ONLY positive resolutions (the host exists / was just created) are
 * memoized, and only on success. There is deliberately no negative
 * caching: the miss path must keep falling through to the create, so a
 * create that loses a concurrent race still throws its unique-violation
 * into the existing catch-and-refetch handling unchanged. Staleness is a
 * non-issue for the id itself (ids are immutable); a deleted host keeps
 * resolving for up to the TTL, which the 24-hour host-id Redis cache in
 * OtelIngestBaseService already dwarfs.
 */
const HOST_RESOLUTION_MEMO_TTL_IN_MS: number = 60 * 1000;
const HOST_RESOLUTION_MEMO_MAX_ENTRIES: number = 10_000;
const hostResolutionInProcessMemo: InProcessMemo<HostResolution> =
  new InProcessMemo<HostResolution>({
    ttlInMs: HOST_RESOLUTION_MEMO_TTL_IN_MS,
    maxEntries: HOST_RESOLUTION_MEMO_MAX_ENTRIES,
  });

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await HostLabelRuleEngineService.applyRulesToHost(createdItem);
        })
        .then(async () => {
          await HostOwnerRuleEngineService.applyRulesToHost(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying host rules in HostService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              hostId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByHostIdentifier(data: {
    projectId: ObjectID;
    hostIdentifier: string;
  }): Promise<Model> {
    /*
     * Canonicalize the identifier (trim + lowercase, matching
     * QueryHelper.findWithSameText). Host identity comes from the OTel
     * `host.name` resource attribute, whose casing is not stable across
     * batches — Windows in particular surfaces the hostname uppercased
     * (`COMPUTERNAME`-style, e.g. PRIMARY01) from some resource detectors
     * and lowercased from others, so the same physical host arrives as
     * both `PRIMARY01` and `primary01`. Ingest already canonicalizes
     * host.name (OtelIngestBaseService.normalizeHostNameAttributesInPlace);
     * we repeat it here so the method is correct for any caller.
     */
    const hostIdentifier: string = canonicalizeEntityValue(data.hostIdentifier);

    /*
     * L1: in-process memo. The canonical identifier is the memo key, so
     * every casing of one host collapses onto the entry the previous batch
     * wrote — the same folding the SQL predicate below performs. A hit
     * skips the SELECT (and the already-converged identifier write) that
     * the resolving call performed within the last minute.
     */
    const memoKey: string = `${data.projectId.toString()}:${hostIdentifier}`;
    const memoedResolution: HostResolution | undefined =
      hostResolutionInProcessMemo.get(memoKey);
    if (memoedResolution) {
      const memoedHost: Model = new Model();
      memoedHost._id = memoedResolution.hostIdStr;
      memoedHost.projectId = data.projectId;
      memoedHost.hostIdentifier = memoedResolution.hostIdentifier;
      return memoedHost;
    }

    /*
     * Look up case-insensitively. The unique guard on name/hostIdentifier
     * (DatabaseService.checkUniqueColumnBy -> QueryHelper.findWithSameText)
     * already compares case-insensitively, so a case-sensitive lookup here
     * would miss an existing row, then fail to create it ("Host with the
     * same name already exists"), and permanently wedge ingest for that
     * host. Mirrors LabelService.findOrCreateLabelByName.
     */
    const existingHost: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        hostIdentifier: QueryHelper.findWithSameText(hostIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        hostIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingHost) {
      /*
       * Converge a legacy mixed-case identifier onto the canonical form so
       * the stored resource.host.name (also canonicalized at ingest) keeps
       * matching the host-detail page filter. Best-effort — never block
       * ingest on it. Updates don't re-run the unique guard, so writing the
       * host's own canonical identifier cannot collide.
       */
      if (
        existingHost._id &&
        existingHost.hostIdentifier &&
        existingHost.hostIdentifier !== hostIdentifier
      ) {
        try {
          await this.updateOneById({
            id: new ObjectID(existingHost._id.toString()),
            data: {
              hostIdentifier: hostIdentifier,
            },
            props: {
              isRoot: true,
            },
          });
          existingHost.hostIdentifier = hostIdentifier;
        } catch (err) {
          logger.warn(
            `HostService: failed to canonicalize hostIdentifier for host ${existingHost._id.toString()}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      /*
       * Memoize the identifier the row ACTUALLY holds (post-convergence,
       * or the legacy casing when the best-effort update failed) so a memo
       * hit returns exactly what a repeated lookup would have.
       */
      if (existingHost._id) {
        hostResolutionInProcessMemo.set(memoKey, {
          hostIdStr: existingHost._id.toString(),
          hostIdentifier: existingHost.hostIdentifier || hostIdentifier,
        });
      }

      return existingHost;
    }

    try {
      const newHost: Model = new Model();
      newHost.projectId = data.projectId;
      newHost.name = hostIdentifier;
      newHost.hostIdentifier = hostIdentifier;
      newHost.otelCollectorStatus = "connected";
      newHost.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdHost: Model = await this.create({
        data: newHost,
        props: {
          isRoot: true,
        },
      });

      if (createdHost._id) {
        hostResolutionInProcessMemo.set(memoKey, {
          hostIdStr: createdHost._id.toString(),
          hostIdentifier: hostIdentifier,
        });
      }

      return createdHost;
    } catch {
      /*
       * Either two ingest workers raced to create the same host, or a
       * host with this identifier in a different case already existed and
       * the unique guard rejected the insert. Re-resolve case-insensitively
       * so the caller still gets the existing row instead of throwing.
       */
      const reFetchedHost: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.findWithSameText(hostIdentifier),
        },
        select: {
          _id: true,
          projectId: true,
          hostIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedHost) {
        /*
         * The refetch after a lost create race emits the same SELECT as
         * the cold lookup, and a first-contact stampede on a brand-new
         * host is exactly when this branch runs hot — memoize it like the
         * other two resolution paths (mirrors the service-resolution
         * cache's create-race handling).
         */
        if (reFetchedHost._id) {
          hostResolutionInProcessMemo.set(memoKey, {
            hostIdStr: reFetchedHost._id.toString(),
            hostIdentifier: reFetchedHost.hostIdentifier || hostIdentifier,
          });
        }

        return reFetchedHost;
      }

      throw new Error("Failed to create or find host: " + hostIdentifier);
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    hostId: ObjectID,
    extra?: {
      osType?: string | undefined;
      osVersion?: string | undefined;
      hostId?: string | undefined;
      hostArch?: string | undefined;
      hostType?: string | undefined;
      hostIpAddresses?: string | undefined;
      cpuCores?: number | undefined;
      totalMemoryBytes?: number | undefined;
      processCount?: number | undefined;
      containerRuntime?: string | undefined;
      dockerHostId?: ObjectID | undefined;
      kubernetesClusterId?: ObjectID | undefined;
      agentVersion?: string | undefined;
      deploymentEnvironment?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
      cloudProvider?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
    },
  ): Promise<void> {
    /*
     * Throttle: the same telemetry batch repeats every metric/log/trace
     * push and re-sends identical host metadata. Skip the DB write when
     * we recently wrote the exact same values; only refresh `lastSeenAt`
     * once per throttle window. If any extra value changed (e.g. cpuCores
     * updated, IP address changed), bust the cache and write immediately.
     */
    const extrasFingerprint: string = this.fingerprintExtras(extra);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    if (extra?.osType) {
      metadata.osType = extra.osType;
    }
    if (extra?.osVersion) {
      metadata.osVersion = extra.osVersion;
    }
    if (extra?.hostId) {
      metadata.hostId = extra.hostId;
    }
    if (extra?.hostArch) {
      metadata.hostArch = extra.hostArch;
    }
    if (extra?.hostType) {
      metadata.hostType = extra.hostType;
    }
    if (extra?.hostIpAddresses) {
      metadata.hostIpAddresses = extra.hostIpAddresses;
    }
    if (extra?.cpuCores !== undefined) {
      metadata.cpuCores = extra.cpuCores;
    }
    if (extra?.totalMemoryBytes !== undefined) {
      metadata.totalMemoryBytes = extra.totalMemoryBytes;
    }
    if (extra?.processCount !== undefined) {
      metadata.processCount = extra.processCount;
    }
    if (extra?.containerRuntime) {
      metadata.containerRuntime = extra.containerRuntime;
    }
    if (extra?.dockerHostId) {
      metadata.dockerHostId = extra.dockerHostId;
    }
    if (extra?.kubernetesClusterId) {
      metadata.kubernetesClusterId = extra.kubernetesClusterId;
    }
    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }
    if (extra?.deploymentEnvironment) {
      metadata.deploymentEnvironment = extra.deploymentEnvironment;
    }
    if (extra?.runtimeName) {
      metadata.runtimeName = extra.runtimeName;
    }
    if (extra?.runtimeVersion) {
      metadata.runtimeVersion = extra.runtimeVersion;
    }
    if (extra?.cloudProvider) {
      metadata.cloudProvider = extra.cloudProvider;
    }
    if (extra?.cloudPlatform) {
      metadata.cloudPlatform = extra.cloudPlatform;
    }
    if (extra?.cloudRegion) {
      metadata.cloudRegion = extra.cloudRegion;
    }
    if (extra?.cloudAccountId) {
      metadata.cloudAccountId = extra.cloudAccountId;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: hostId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `host ${hostId.toString()}`,
    });
  }

  private fingerprintExtras(extra?: {
    osType?: string | undefined;
    osVersion?: string | undefined;
    hostId?: string | undefined;
    hostArch?: string | undefined;
    hostType?: string | undefined;
    hostIpAddresses?: string | undefined;
    cpuCores?: number | undefined;
    totalMemoryBytes?: number | undefined;
    processCount?: number | undefined;
    containerRuntime?: string | undefined;
    dockerHostId?: ObjectID | undefined;
    kubernetesClusterId?: ObjectID | undefined;
    agentVersion?: string | undefined;
    deploymentEnvironment?: string | undefined;
    runtimeName?: string | undefined;
    runtimeVersion?: string | undefined;
    cloudProvider?: string | undefined;
    cloudPlatform?: string | undefined;
    cloudRegion?: string | undefined;
    cloudAccountId?: string | undefined;
  }): string {
    const normalized: Record<string, string | number | null> = {
      osType: extra?.osType ?? null,
      osVersion: extra?.osVersion ?? null,
      hostId: extra?.hostId ?? null,
      hostArch: extra?.hostArch ?? null,
      hostType: extra?.hostType ?? null,
      hostIpAddresses: extra?.hostIpAddresses ?? null,
      /*
       * cpuCores / totalMemoryBytes / processCount are DELIBERATELY not
       * hashed. They are per-scrape gauges, and `system.processes.count` in
       * particular is partitioned by process.status and summed, so it changes
       * on essentially every scrape. Hashing them made the throttle key differ
       * every time and the 60s window never engaged — for exactly the hosts
       * producing the most batches, which is the worst possible place to lose
       * a throttle. The columns are still written; they simply ride along on
       * whatever write the throttle admits rather than forcing one.
       */
      containerRuntime: extra?.containerRuntime ?? null,
      dockerHostId: extra?.dockerHostId?.toString() ?? null,
      kubernetesClusterId: extra?.kubernetesClusterId?.toString() ?? null,
      agentVersion: extra?.agentVersion ?? null,
      deploymentEnvironment: extra?.deploymentEnvironment ?? null,
      runtimeName: extra?.runtimeName ?? null,
      runtimeVersion: extra?.runtimeVersion ?? null,
      cloudProvider: extra?.cloudProvider ?? null,
      cloudPlatform: extra?.cloudPlatform ?? null,
      cloudRegion: extra?.cloudRegion ?? null,
      cloudAccountId: extra?.cloudAccountId ?? null,
    };

    return crypto
      .createHash("sha1")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  /**
   * Additively attach labels to a host. Existing labels are never
   * removed — manual labels set via the UI survive ingest. The set
   * of labelIds passed in is fingerprinted and cached for 60s so the
   * common case (steady-state collector pushing the same label set
   * every batch) costs one in-memory lookup, not a join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    hostId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.hostId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const hostIdStr: string = data.hostId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(hostIdStr)
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
          .of(hostIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      /*
       * A concurrent ingest worker may have inserted the same join
       * row between our loadMany and add. Best-effort — surface as
       * a warning so chronic failures show up in logs without
       * breaking ingest.
       */
      logger.warn(
        `HostService.attachLabels failed for host ${data.hostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedHosts(): Promise<void> {
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

    const connectedHosts: Array<Model> = await this.findBy({
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

    for (const host of connectedHosts) {
      if (host._id) {
        await this.updateOneById({
          id: new ObjectID(host._id.toString()),
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

  @CaptureSpan()
  public async getExpectedHostIdentifiers(data: {
    projectId: ObjectID;
    seenWithinMinutes: number;
  }): Promise<Array<string>> {
    /*
     * "Expected" hosts for per-host down-detection: non-archived hosts in
     * the project that reported within the recency window. Their canonical
     * hostIdentifier equals the metric's `resource.host.name` value (both
     * canonicalized at ingest), so the telemetry monitor can diff this set
     * against the hosts present in the current evaluation window and
     * synthesize a "no data" series for any that have gone silent — a
     * group-by-host query returns no row for a silent host, so absence is
     * otherwise invisible. See HostAbsenceSeries and
     * MonitorTelemetryMonitor.injectExpectedAbsentHostSeries.
     */
    const cutoff: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -Math.abs(data.seenWithinMinutes),
    );

    const hosts: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        lastSeenAt: QueryHelper.greaterThanEqualTo(cutoff),
      },
      select: {
        hostIdentifier: true,
        isArchived: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const identifiers: Array<string> = [];
    for (const host of hosts) {
      // isArchived is nullable; treat null/undefined as not archived.
      if (host.isArchived) {
        continue;
      }
      if (host.hostIdentifier) {
        identifiers.push(canonicalizeEntityValue(host.hostIdentifier));
      }
    }
    return identifiers;
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
