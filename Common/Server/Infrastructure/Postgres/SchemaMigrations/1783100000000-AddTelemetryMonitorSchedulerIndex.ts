import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/**
 * Telemetry-monitor scale-out, Phase 0.
 *
 * Composite index for the slim scheduler's keyset scan of due telemetry
 * monitors: `WHERE telemetryMonitorNextMonitorAt <= now AND _id > :lastId
 * ORDER BY _id`. Keeps the due-monitor page scan index-only and selective at
 * 100k-1M rows, instead of loading the full result set into the worker. Mirrors
 * the MonitorProbe scheduler index. Created IF NOT EXISTS so it is idempotent
 * with the @Index(["telemetryMonitorNextMonitorAt", "_id"]) decorator on the
 * Monitor model and safe to re-run.
 */
export class AddTelemetryMonitorSchedulerIndex1783100000000
  implements MigrationInterface
{
  public name = "AddTelemetryMonitorSchedulerIndex1783100000000";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_monitor_telemetry_next_id" ON "Monitor" ("telemetryMonitorNextMonitorAt", "_id")`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_monitor_telemetry_next_id"`,
    );
  }
}
