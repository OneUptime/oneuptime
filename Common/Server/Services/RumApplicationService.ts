import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumApplication";
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
import RumApplicationLabelRuleEngineService from "./RumApplicationLabelRuleEngineService";
import RumApplicationOwnerRuleEngineService from "./RumApplicationOwnerRuleEngineService";

const LAST_SEEN_CACHE_NAMESPACE: string = "rum-application-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "rum-application-labels-applied";
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
          await RumApplicationLabelRuleEngineService.applyRulesToRumApplication(
            createdItem,
          );
        })
        .then(async () => {
          await RumApplicationOwnerRuleEngineService.applyRulesToRumApplication(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying RUM application rules in RumApplicationService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              rumApplicationId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByAppIdentifier(data: {
    projectId: ObjectID;
    appIdentifier: string;
  }): Promise<Model> {
    const existingApp: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        appIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingApp) {
      return existingApp;
    }

    try {
      const newApp: Model = new Model();
      newApp.projectId = data.projectId;
      newApp.name = data.appIdentifier;
      newApp.appIdentifier = data.appIdentifier;
      newApp.otelCollectorStatus = "connected";
      newApp.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdApp: Model = await this.create({
        data: newApp,
        props: {
          isRoot: true,
        },
      });

      return createdApp;
    } catch {
      const reFetchedApp: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
        },
        select: {
          _id: true,
          projectId: true,
          appIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedApp) {
        return reFetchedApp;
      }

      throw new Error(
        "Failed to create or find RUM application: " + data.appIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    rumApplicationId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      clientType?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = rumApplicationId.toString();
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          clientType: extra?.clientType ?? null,
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
    if (extra?.clientType) {
      data.clientType = extra.clientType;
    }

    await this.updateOneById({
      id: rumApplicationId,
      data: data,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async attachLabels(data: {
    rumApplicationId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.rumApplicationId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const appIdStr: string = data.rumApplicationId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(appIdStr)
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
          .of(appIdStr)
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
        `RumApplicationService.attachLabels failed for application ${data.rumApplicationId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedApplications(): Promise<void> {
    const fiveMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );

    const connectedApps: Array<Model> = await this.findBy({
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

    for (const rumApplication of connectedApps) {
      if (rumApplication._id) {
        await this.updateOneById({
          id: new ObjectID(rumApplication._id.toString()),
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
