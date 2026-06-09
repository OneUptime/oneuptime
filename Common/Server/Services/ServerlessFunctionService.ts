import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServerlessFunction";
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
import ServerlessFunctionLabelRuleEngineService from "./ServerlessFunctionLabelRuleEngineService";
import ServerlessFunctionOwnerRuleEngineService from "./ServerlessFunctionOwnerRuleEngineService";

const LAST_SEEN_CACHE_NAMESPACE: string = "serverless-function-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string =
  "serverless-function-labels-applied";
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

    await this.updateOneById({
      id: serverlessFunctionId,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Additively attach labels to a serverless function. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The set of
   * labelIds is fingerprinted and cached for 60s so steady-state ingest with
   * an unchanged label set costs one in-memory lookup.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    serverlessFunctionId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.serverlessFunctionId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const functionIdStr: string = data.serverlessFunctionId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(functionIdStr)
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
          .of(functionIdStr)
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
        `ServerlessFunctionService.attachLabels failed for function ${data.serverlessFunctionId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedFunctions(): Promise<void> {
    const fiveMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );

    const connectedFunctions: Array<Model> = await this.findBy({
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

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

export default new Service();
