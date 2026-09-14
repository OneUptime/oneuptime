import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudResourceInstance";
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
   * Upsert a cloud-resource instance / task (service.instance.id) from ingest.
   * Refreshes lastSeenAt (and cpu/mem when provided) if it already exists.
   */
  @CaptureSpan()
  public async recordInstance(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    instanceName: string;
    cpuPercent?: number | undefined;
    memoryBytes?: number | undefined;
  }): Promise<void> {
    try {
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: data.cloudResourceId,
          instanceName: data.instanceName,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: any = { lastSeenAt: OneUptimeDate.getCurrentDate() };
      if (data.cpuPercent !== undefined) {
        fields.latestCpuPercent = data.cpuPercent;
      }
      if (data.memoryBytes !== undefined) {
        fields.latestMemoryBytes = data.memoryBytes;
      }

      if (existing && existing._id) {
        await this.updateOneById({
          id: new ObjectID(existing._id.toString()),
          data: fields,
          props: { isRoot: true },
        });
        return;
      }

      const item: Model = new Model();
      item.projectId = data.projectId;
      item.cloudResourceId = data.cloudResourceId;
      item.instanceName = data.instanceName;
      item.lastSeenAt = OneUptimeDate.getCurrentDate();
      if (data.cpuPercent !== undefined) {
        item.latestCpuPercent = data.cpuPercent;
      }
      if (data.memoryBytes !== undefined) {
        item.latestMemoryBytes = data.memoryBytes;
      }
      await this.create({ data: item, props: { isRoot: true } });
    } catch (err) {
      logger.warn(
        `CloudResourceInstanceService.recordInstance failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Hard-delete every instance / task of one cloud environment whose
   * lastSeenAt is older than olderThan. Returns the number of rows
   * removed.
   *
   * The instance table is a projection of what is actively reporting:
   * ECS tasks, Cloud Run instances and App Service workers churn on
   * every deploy and scale event, and nothing ever tells us a task is
   * gone — it simply stops sending. Without this sweep the Instances
   * tab and the overview's "running tasks" count grow forever. Called
   * only by the Cloud:CleanupStaleResources worker, which anchors
   * olderThan to the parent environment's own lastSeenAt (see the job
   * header for why wall-clock now is the wrong anchor).
   */
  @CaptureSpan()
  public async deleteStaleForResource(data: {
    cloudResourceId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    return await this.deleteBy({
      query: {
        cloudResourceId: data.cloudResourceId,
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
   * CLOUD_INSTANCE_STALE_MINUTES (min 10).
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
   * recordInstance sits behind that fence per (environment, instance),
   * so a live task's lastSeenAt is legitimately up to ~5 minutes stale
   * during continuous telemetry; a threshold at or below the fence
   * would prune live tasks between refreshes. 15 minutes gives 3x
   * headroom and matches CloudResourceService.markDisconnectedResources.
   * The floor is 10 minutes, not the fence's nominal 5: the fence key is
   * armed with jitter (300-375 s) behind a 30-second negative memo, so a
   * live row's lastSeenAt can legitimately be close to 7 minutes old. A
   * floor at the nominal TTL would let an override prune live rows.
   * Anything unparseable falls back to the default.
   */
  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["CLOUD_INSTANCE_STALE_MINUTES"];
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
