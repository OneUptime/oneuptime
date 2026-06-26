import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudResource";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate } from "../Types/Database/Hooks";
import CloudResourceLabelRuleEngineService from "./CloudResourceLabelRuleEngineService";
import CloudResourceOwnerRuleEngineService from "./CloudResourceOwnerRuleEngineService";

const LAST_SEEN_CACHE_NAMESPACE: string = "cloud-resource-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "cloud-resource-labels-applied";
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
      Promise.resolve()
        .then(async () => {
          await CloudResourceLabelRuleEngineService.applyRulesToCloudResource(
            createdItem,
          );
        })
        .then(async () => {
          await CloudResourceOwnerRuleEngineService.applyRulesToCloudResource(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying cloud resource rules in CloudResourceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              cloudResourceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByResourceIdentifier(data: {
    projectId: ObjectID;
    resourceIdentifier: string;
    name?: string | undefined;
    cloudPlatform?: string | undefined;
    cloudProvider?: string | undefined;
    cloudRegion?: string | undefined;
    cloudAccountId?: string | undefined;
  }): Promise<Model> {
    const existingResource: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        resourceIdentifier: QueryHelper.findWithSameText(
          data.resourceIdentifier,
        ),
      },
      select: {
        _id: true,
        projectId: true,
        resourceIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingResource) {
      return existingResource;
    }

    try {
      const newResource: Model = new Model();
      newResource.projectId = data.projectId;
      newResource.name = data.name || data.resourceIdentifier;
      newResource.resourceIdentifier = data.resourceIdentifier;
      newResource.otelCollectorStatus = "connected";
      newResource.lastSeenAt = OneUptimeDate.getCurrentDate();
      if (data.cloudPlatform) {
        newResource.cloudPlatform = data.cloudPlatform;
      }
      if (data.cloudProvider) {
        newResource.cloudProvider = data.cloudProvider;
      }
      if (data.cloudRegion) {
        newResource.cloudRegion = data.cloudRegion;
      }
      if (data.cloudAccountId) {
        newResource.cloudAccountId = data.cloudAccountId;
      }

      const createdResource: Model = await this.create({
        data: newResource,
        props: {
          isRoot: true,
        },
      });

      return createdResource;
    } catch {
      const reFetchedResource: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          resourceIdentifier: QueryHelper.findWithSameText(
            data.resourceIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          resourceIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedResource) {
        return reFetchedResource;
      }

      throw new Error(
        "Failed to create or find cloud resource: " + data.resourceIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    cloudResourceId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudProvider?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = cloudResourceId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          cloudPlatform: extra?.cloudPlatform ?? null,
          cloudProvider: extra?.cloudProvider ?? null,
          cloudRegion: extra?.cloudRegion ?? null,
          cloudAccountId: extra?.cloudAccountId ?? null,
          runtimeName: extra?.runtimeName ?? null,
          runtimeVersion: extra?.runtimeVersion ?? null,
        }),
      )
      .digest("hex");

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

    if (extra?.agentVersion) {
      data.agentVersion = extra.agentVersion;
    }
    if (extra?.cloudPlatform) {
      data.cloudPlatform = extra.cloudPlatform;
    }
    if (extra?.cloudProvider) {
      data.cloudProvider = extra.cloudProvider;
    }
    if (extra?.cloudRegion) {
      data.cloudRegion = extra.cloudRegion;
    }
    if (extra?.cloudAccountId) {
      data.cloudAccountId = extra.cloudAccountId;
    }
    if (extra?.runtimeName) {
      data.runtimeName = extra.runtimeName;
    }
    if (extra?.runtimeVersion) {
      data.runtimeVersion = extra.runtimeVersion;
    }

    /*
     * Heartbeat write: a single-statement UPDATE with no hooks and no
     * `version` bump, avoiding the hot-row Postgres lock convoy that the
     * full updateOneById pipeline causes. See ServiceService.updateLastSeen.
     */
    await this.updateColumnsByIdWithoutHooks({
      id: cloudResourceId,
      data: data,
    });
  }

  @CaptureSpan()
  public async attachLabels(data: {
    cloudResourceId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.cloudResourceId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const resourceIdStr: string = data.cloudResourceId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(resourceIdStr)
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
          .of(resourceIdStr)
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
        `CloudResourceService.attachLabels failed for resource ${data.cloudResourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedResources(): Promise<void> {
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

    const connectedResources: Array<Model> = await this.findBy({
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

    for (const cloudResource of connectedResources) {
      if (cloudResource._id) {
        await this.updateOneById({
          id: new ObjectID(cloudResource._id.toString()),
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
