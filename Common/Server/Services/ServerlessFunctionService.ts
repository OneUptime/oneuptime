import attachTelemetryLabels from "../Utils/Telemetry/TelemetryAutoLabels";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServerlessFunction";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate } from "../Types/Database/Hooks";
import ServerlessFunctionLabelRuleEngineService from "./ServerlessFunctionLabelRuleEngineService";
import ServerlessFunctionOwnerRuleEngineService from "./ServerlessFunctionOwnerRuleEngineService";

const LAST_SEEN_CACHE_NAMESPACE: string = "serverless-function-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

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
          await ServerlessFunctionLabelRuleEngineService.applyRulesToServerlessFunction(
            createdItem,
          );
        })
        .then(async () => {
          await ServerlessFunctionOwnerRuleEngineService.applyRulesToServerlessFunction(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying serverless function rules in ServerlessFunctionService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              serverlessFunctionId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByFunctionIdentifier(data: {
    projectId: ObjectID;
    functionIdentifier: string;
  }): Promise<Model> {
    /*
     * Look up case-insensitively. The unique guard on name/functionIdentifier
     * (checkUniqueColumnBy -> findWithSameText) compares case-insensitively,
     * so a case-sensitive lookup would miss an existing row on casing drift
     * (faas.name), then fail to create it ("ServerlessFunction with the same
     * name already exists") and wedge ingest. We keep the stored casing as-is
     * so it stays in sync with the raw-cased resource.faas.name attribute the
     * detail page filters on.
     */
    const existingFunction: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        functionIdentifier: QueryHelper.findWithSameText(
          data.functionIdentifier,
        ),
      },
      select: {
        _id: true,
        projectId: true,
        functionIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingFunction) {
      return existingFunction;
    }

    try {
      const newFunction: Model = new Model();
      newFunction.projectId = data.projectId;
      newFunction.name = data.functionIdentifier;
      newFunction.functionIdentifier = data.functionIdentifier;
      newFunction.otelCollectorStatus = "connected";
      newFunction.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdFunction: Model = await this.create({
        data: newFunction,
        props: {
          isRoot: true,
        },
      });

      return createdFunction;
    } catch {
      /*
       * Race condition: another request created the function concurrently.
       * Re-fetch the existing row.
       */
      const reFetchedFunction: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          functionIdentifier: QueryHelper.findWithSameText(
            data.functionIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          functionIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedFunction) {
        return reFetchedFunction;
      }

      throw new Error(
        "Failed to create or find serverless function: " +
          data.functionIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    serverlessFunctionId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudProvider?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
      functionVersion?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = serverlessFunctionId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          cloudPlatform: extra?.cloudPlatform ?? null,
          cloudProvider: extra?.cloudProvider ?? null,
          cloudRegion: extra?.cloudRegion ?? null,
          cloudAccountId: extra?.cloudAccountId ?? null,
          functionVersion: extra?.functionVersion ?? null,
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
    if (extra?.functionVersion) {
      data.functionVersion = extra.functionVersion;
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
      id: serverlessFunctionId,
      data: data,
    });
  }

  /**
   * Additively attach the labels telemetry declares for this resource.
   * Ingest applies each declared label once and records it, so a label a
   * user removes is not re-attached by the next batch. Labels are never
   * removed here - manual labels set via the UI survive ingest.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    serverlessFunctionId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    await attachTelemetryLabels<Model>({
      service: this,
      modelType: Model,
      resourceId: data.serverlessFunctionId,
      labelIds: data.labelIds,
    });
  }

  @CaptureSpan()
  public async markDisconnectedFunctions(): Promise<void> {
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

    const connectedFunctions: Array<Model> = await this.findBy({
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

    for (const serverlessFunction of connectedFunctions) {
      if (serverlessFunction._id) {
        await this.updateOneById({
          id: new ObjectID(serverlessFunction._id.toString()),
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

export default new Service();
