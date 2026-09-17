import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServerlessFunctionInstance";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a serverless function instance (faas.instance) from ingest.
   * Refreshes lastSeenAt if the instance already exists.
   */
  @CaptureSpan()
  public async recordInstance(data: {
    projectId: ObjectID;
    serverlessFunctionId: ObjectID;
    instanceName: string;
  }): Promise<void> {
    try {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          serverlessFunctionId: data.serverlessFunctionId,
          instanceName: data.instanceName,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (existing && existing._id) {
        await this.updateOneById({
          id: new ObjectID(existing._id.toString()),
          data: { lastSeenAt: OneUptimeDate.getCurrentDate() },
          props: { isRoot: true },
        });
        return;
      }

      const item: Model = new Model();
      item.projectId = data.projectId;
      item.serverlessFunctionId = data.serverlessFunctionId;
      item.instanceName = data.instanceName;
      item.lastSeenAt = OneUptimeDate.getCurrentDate();
      await this.create({ data: item, props: { isRoot: true } });
    } catch (err) {
      /*
       * Inventory is best-effort — a unique-violation race or transient error
       * must never fail ingest.
       */
      logger.warn(
        `ServerlessFunctionInstanceService.recordInstance failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Hard-delete every instance of one serverless function whose
   * lastSeenAt is older than olderThan. Returns the number of rows
   * removed.
   *
   * faas.instance identifies a warm execution environment, and FaaS
   * platforms recycle those constantly — every cold start mints a new
   * one and nothing ever reports the old one as retired; it simply
   * stops sending. Without this sweep the Instances tab counts every
   * environment that ever ran the function. Called only by the
   * Serverless:CleanupStaleResources worker, which anchors olderThan
   * to the parent function's own lastSeenAt (see the job header for
   * why wall-clock now is the wrong anchor).
   */
  @CaptureSpan()
  public async deleteStaleForFunction(data: {
    serverlessFunctionId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    return await this.deleteBy({
      query: {
        serverlessFunctionId: data.serverlessFunctionId,
        lastSeenAt: QueryHelper.lessThan(data.olderThan),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /**
   * Helper for the cleanup worker: ingest-cadence aware cutoff.
   * 3x the 5-minute OTel ingest maintenance fence by default. Tune via
   * SERVERLESS_INSTANCE_STALE_MINUTES (min 10).
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  /*
   * Threshold must stay well above the 5-minute OTel ingest maintenance
   * fence (MAINTENANCE_FENCE_TTL_SECONDS in OtelIngestBaseService).
   * recordInstance sits behind that fence per (function, instance), so
   * a live instance's lastSeenAt is legitimately up to ~5 minutes stale
   * during continuous telemetry; a threshold at or below the fence
   * would prune live instances between refreshes. 15 minutes gives 3x
   * headroom and matches ServerlessFunctionService.markDisconnectedFunctions.
   * The floor is 10 minutes, not the fence's nominal 5: the fence key is
   * armed with jitter (300-375 s) behind a 30-second negative memo, so a
   * live row's lastSeenAt can legitimately be close to 7 minutes old. A
   * floor at the nominal TTL would let an override prune live rows.
   * Anything unparseable falls back to the default.
   */
  public getStaleThresholdMinutes(): number {
    const raw: string | undefined =
      process.env["SERVERLESS_INSTANCE_STALE_MINUTES"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 10) {
        return parsed;
      }
    }
    return 15;
  }
}

export default new Service();
