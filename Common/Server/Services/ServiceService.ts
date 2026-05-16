import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import ServiceLabelRuleEngineService from "./ServiceLabelRuleEngineService";
import ServiceOwnerRuleEngineService from "./ServiceOwnerRuleEngineService";
import ArrayUtil from "../../Utils/Array";
import { BrightColors } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/Service";
import Label from "../../Models/DatabaseModels/Label";
import Project from "../../Models/DatabaseModels/Project";
import GlobalCache from "../Infrastructure/GlobalCache";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const DEFAULT_TELEMETRY_RETENTION_IN_DAYS: number = 15;

const LAST_SEEN_CACHE_NAMESPACE: string = "service-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "service-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.
    createBy.data.serviceColor = ArrayUtil.selectItemByRandom(BrightColors);

    return {
      carryForward: null,
      createBy: createBy,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await ServiceLabelRuleEngineService.applyRulesToService(createdItem);
        })
        .then(async () => {
          await ServiceOwnerRuleEngineService.applyRulesToService(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying service rules in ServiceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              serviceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async getTelemetryDataRetentionInDays(
    serviceId: ObjectID,
  ): Promise<number> {
    const service: Model | null = await this.findOneById({
      id: serviceId,
      select: {
        projectId: true,
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!service) {
      throw new BadDataException("Service not found");
    }

    if (service.retainTelemetryDataForDays) {
      return service.retainTelemetryDataForDays;
    }

    // Fall back to project-level default.
    if (service.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: service.projectId,
        select: {
          defaultTelemetryRetentionInDays: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (project?.defaultTelemetryRetentionInDays) {
        return project.defaultTelemetryRetentionInDays;
      }
    }

    return DEFAULT_TELEMETRY_RETENTION_IN_DAYS;
  }

  /*
   * Refresh `lastSeenAt` for a service. Throttled per-service so the
   * steady-state telemetry firehose (every metric/log/trace batch
   * re-resolves the same serviceId) costs one in-memory cache lookup
   * per batch instead of a DB write.
   */
  @CaptureSpan()
  public async updateLastSeen(serviceId: ObjectID): Promise<void> {
    const cacheKey: string = serviceId.toString();
    const cached: string | null = await GlobalCache.getString(
      LAST_SEEN_CACHE_NAMESPACE,
      cacheKey,
    );

    if (cached) {
      return;
    }

    await GlobalCache.setString(LAST_SEEN_CACHE_NAMESPACE, cacheKey, "1", {
      expiresInSeconds: LAST_SEEN_THROTTLE_SECONDS,
    });

    await this.updateOneById({
      id: serviceId,
      data: {
        lastSeenAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Additively attach labels to a telemetry service. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for
   * 60s so the steady-state OTel collector pushing the same labels
   * every batch costs one in-memory lookup, not a join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    serviceId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.serviceId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const serviceIdStr: string = data.serviceId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(serviceIdStr)
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
          .of(serviceIdStr)
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
        `ServiceService.attachLabels failed for service ${data.serviceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
