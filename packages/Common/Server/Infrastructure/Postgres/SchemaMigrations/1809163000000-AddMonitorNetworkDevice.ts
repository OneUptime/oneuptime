import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * MonitorNetworkDevice: which network devices each Network Device monitor's
 * steps name, so a device's poll and its traps find their monitors by the
 * device instead of reading the steps of every Network Device monitor in
 * the project (NetworkDeviceWalkUtil.findMonitorsWatchingDevices).
 *
 * The table and its keys are generated from the model. The rest is written
 * by hand: Postgres keeps the rows, so every write to a monitor keeps them
 * right - hooked or hook-free, a data migration's, or one from a server
 * still running the previous release while this one rolls out - in the
 * transaction that wrote the monitor:
 *
 *   - MONITOR_NETWORK_DEVICE_IDS_FUNCTION reads the device ids out of a
 *     monitor's steps, the shape MonitorSteps.toJSON writes
 *     ({ value: { monitorStepsInstanceArray: [{ value: {
 *     networkDeviceMonitor: { networkDeviceId } } }] } }). A value that is
 *     not a UUID is skipped, never cast, so no step can make a monitor's
 *     save fail.
 *   - SYNC_FUNCTION replaces a monitor's rows with what its steps name now,
 *     while it is a Network Device monitor that is not deleted; otherwise it
 *     leaves it none.
 *   - INSERT_TRIGGER runs it for a Network Device monitor created;
 *     UPDATE_TRIGGER for a monitor whose steps, type, project or deletion
 *     changed. An UPDATE that does not write one of those columns - every
 *     status, heartbeat and probe result write - does not fire it at all. A
 *     deleted monitor's rows go with it, by the foreign key.
 *
 * Every statement is quick: the table is new and empty. CREATE TRIGGER and
 * the foreign key to "Monitor" take SHARE ROW EXCLUSIVE on it, but only for
 * this short transaction. The rows of the monitors that already exist are
 * written by the next migration, BackfillMonitorNetworkDevice, in a
 * transaction of its own that holds nothing writers of "Monitor" wait for.
 */

export const MONITOR_NETWORK_DEVICE_IDS_FUNCTION: string =
  "monitor_network_device_ids_1809163000000";
export const SYNC_FUNCTION: string =
  "sync_monitor_network_device_1809163000000";
export const INSERT_TRIGGER: string =
  "TRG_sync_monitor_network_device_insert_1809163000000";
export const UPDATE_TRIGGER: string =
  "TRG_sync_monitor_network_device_update_1809163000000";

// The monitor type whose steps name devices (MonitorType.NetworkDevice).
export const NETWORK_DEVICE_MONITOR_TYPE: string = "Network Device";

export const CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION: string = `CREATE FUNCTION "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"(steps jsonb)
RETURNS SETOF uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT DISTINCT (device_id #>> '{}')::uuid
  FROM jsonb_path_query(
    COALESCE(steps, '{}'::jsonb),
    'lax $.value.monitorStepsInstanceArray[*].value.networkDeviceMonitor.networkDeviceId'
  ) AS device_id
  WHERE jsonb_typeof(device_id) = 'string'
    AND (device_id #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$`;

export const CREATE_SYNC_FUNCTION: string = `CREATE FUNCTION "${SYNC_FUNCTION}"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM "MonitorNetworkDevice" WHERE "monitorId" = OLD."_id";
  END IF;

  IF NEW."monitorType" = '${NETWORK_DEVICE_MONITOR_TYPE}'
    AND NEW."deletedAt" IS NULL
    AND NEW."projectId" IS NOT NULL THEN
    INSERT INTO "MonitorNetworkDevice" ("projectId", "monitorId", "networkDeviceId", "version")
    SELECT NEW."projectId", NEW."_id", device_id, 1
    FROM "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"(NEW."monitorSteps") AS device_id
    ON CONFLICT ("monitorId", "networkDeviceId") DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$`;

export const CREATE_INSERT_TRIGGER: string = `CREATE TRIGGER "${INSERT_TRIGGER}"
AFTER INSERT ON "Monitor"
FOR EACH ROW
WHEN (NEW."monitorType" = '${NETWORK_DEVICE_MONITOR_TYPE}')
EXECUTE FUNCTION "${SYNC_FUNCTION}"()`;

export const CREATE_UPDATE_TRIGGER: string = `CREATE TRIGGER "${UPDATE_TRIGGER}"
AFTER UPDATE OF "monitorSteps", "monitorType", "projectId", "deletedAt" ON "Monitor"
FOR EACH ROW
WHEN (
  (OLD."monitorType" = '${NETWORK_DEVICE_MONITOR_TYPE}' OR NEW."monitorType" = '${NETWORK_DEVICE_MONITOR_TYPE}')
  AND (
    OLD."monitorSteps" IS DISTINCT FROM NEW."monitorSteps"
    OR OLD."monitorType" IS DISTINCT FROM NEW."monitorType"
    OR OLD."projectId" IS DISTINCT FROM NEW."projectId"
    OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  )
)
EXECUTE FUNCTION "${SYNC_FUNCTION}"()`;

export class AddMonitorNetworkDevice1809163000000
  implements MigrationInterface
{
  public name: string = "AddMonitorNetworkDevice1809163000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorNetworkDevice" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "monitorId" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, CONSTRAINT "PK_978241967b5a40df5374d224f84" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_224f58178e3933863b4594fa6b" ON "MonitorNetworkDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dddc3cbdf08ded9f931a0517d3" ON "MonitorNetworkDevice" ("networkDeviceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9f91bdc2380ffcb8c06d065bee" ON "MonitorNetworkDevice" ("monitorId", "networkDeviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorNetworkDevice" ADD CONSTRAINT "FK_224f58178e3933863b4594fa6bc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorNetworkDevice" ADD CONSTRAINT "FK_bab7b8f800c896948214a3912b5" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION);
    await queryRunner.query(CREATE_SYNC_FUNCTION);
    await queryRunner.query(CREATE_INSERT_TRIGGER);
    await queryRunner.query(CREATE_UPDATE_TRIGGER);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "${UPDATE_TRIGGER}" ON "Monitor"`);
    await queryRunner.query(`DROP TRIGGER "${INSERT_TRIGGER}" ON "Monitor"`);
    await queryRunner.query(`DROP FUNCTION "${SYNC_FUNCTION}"()`);
    await queryRunner.query(
      `DROP FUNCTION "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"(jsonb)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorNetworkDevice" DROP CONSTRAINT "FK_bab7b8f800c896948214a3912b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorNetworkDevice" DROP CONSTRAINT "FK_224f58178e3933863b4594fa6bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f91bdc2380ffcb8c06d065bee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dddc3cbdf08ded9f931a0517d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_224f58178e3933863b4594fa6b"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorNetworkDevice"`);
  }
}
