import DatabaseService from "./DatabaseService";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import HostLabelRuleEngineService from "./HostLabelRuleEngineService";
import HostOwnerRuleEngineService from "./HostOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/Host";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import { canonicalizeEntityValue } from "../../Utils/Telemetry/EntityKey";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "host-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "host-labels-applied";
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
    const cacheKey: string = hostId.toString();
    const extrasFingerprint: string = this.fingerprintExtras(extra);
    let cached: string | null = null;
    try {
      cached = await GlobalCache.getString(LAST_SEEN_CACHE_NAMESPACE, cacheKey);
    } catch {
      /*
       * Cache unavailable — fail open and refresh lastSeenAt anyway. A
       * cache error must never skip the DB write below, otherwise the
       * resource is wrongly marked "disconnected" while telemetry is
       * still flowing. Mirrors shouldRunMaintenance's fail-open stance.
       */
      cached = null;
    }

    if (cached === extrasFingerprint) {
      return; // same data was written recently
    }

    try {
      await GlobalCache.setString(
        LAST_SEEN_CACHE_NAMESPACE,
        cacheKey,
        extrasFingerprint,
        { expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS },
      );
    } catch {
      // Best-effort throttle write; proceed with the DB update regardless.
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    if (extra?.osType) {
      data.osType = extra.osType;
    }
    if (extra?.osVersion) {
      data.osVersion = extra.osVersion;
    }
    if (extra?.hostId) {
      data.hostId = extra.hostId;
    }
    if (extra?.hostArch) {
      data.hostArch = extra.hostArch;
    }
    if (extra?.hostType) {
      data.hostType = extra.hostType;
    }
    if (extra?.hostIpAddresses) {
      data.hostIpAddresses = extra.hostIpAddresses;
    }
    if (extra?.cpuCores !== undefined) {
      data.cpuCores = extra.cpuCores;
    }
    if (extra?.totalMemoryBytes !== undefined) {
      data.totalMemoryBytes = extra.totalMemoryBytes;
    }
    if (extra?.processCount !== undefined) {
      data.processCount = extra.processCount;
    }
    if (extra?.containerRuntime) {
      data.containerRuntime = extra.containerRuntime;
    }
    if (extra?.dockerHostId) {
      data.dockerHostId = extra.dockerHostId;
    }
    if (extra?.kubernetesClusterId) {
      data.kubernetesClusterId = extra.kubernetesClusterId;
    }
    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }
    if (extra?.deploymentEnvironment) {
      data.deploymentEnvironment = extra.deploymentEnvironment;
    }
    if (extra?.runtimeName) {
      data.runtimeName = extra.runtimeName;
    }
    if (extra?.runtimeVersion) {
      data.runtimeVersion = extra.runtimeVersion;
    }
    if (extra?.cloudProvider) {
      data.cloudProvider = extra.cloudProvider;
    }
    if (extra?.cloudPlatform) {
      data.cloudPlatform = extra.cloudPlatform;
    }
    if (extra?.cloudRegion) {
      data.cloudRegion = extra.cloudRegion;
    }
    if (extra?.cloudAccountId) {
      data.cloudAccountId = extra.cloudAccountId;
    }

    /*
     * Heartbeat write: a single-statement UPDATE with no hooks and no
     * `version` bump, avoiding the hot-row Postgres lock convoy that the
     * full updateOneById pipeline causes. See ServiceService.updateLastSeen.
     */
    await this.updateColumnsByIdWithoutHooks({
      id: hostId,
      data: data,
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
      cpuCores: extra?.cpuCores ?? null,
      totalMemoryBytes: extra?.totalMemoryBytes ?? null,
      processCount: extra?.processCount ?? null,
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
  public async getLinkInDashboard(
    projectId: ObjectID,
    hostId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/host/${hostId.toString()}`,
    );
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
