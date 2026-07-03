import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IoT device lifecycle states (Online -> Offline -> Stale -> Retired)
 * plus silence-based offline detection config:
 *
 *   - IoTDevice.state / stateChangedAt — lifecycle state machine that
 *     replaces the old hard-delete-on-staleness behavior.
 *   - IoTDevice.expectedCheckinIntervalSeconds — per-device override
 *     for silence-based offline detection.
 *   - IoTDevice.isArchived — user-curated hide flag.
 *   - IoTFleet.expectedDeviceCheckinIntervalSeconds — fleet-wide
 *     default check-in interval (null = detection off).
 *
 * The backfill derives state from the last reported isUp: ADD COLUMN
 * with a DEFAULT fills every existing row with 'Online', so rows whose
 * last report was down are corrected to 'Offline' right after, and
 * stateChangedAt seeds from lastSeenAt.
 */
export class AddIoTDeviceLifecycleColumns1783087273439
  implements MigrationInterface
{
  public name = "AddIoTDeviceLifecycleColumns1783087273439";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD "expectedDeviceCheckinIntervalSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD "state" character varying(100) DEFAULT 'Online'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD "stateChangedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD "expectedCheckinIntervalSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" ADD "isArchived" boolean DEFAULT false`,
    );

    // Backfill: devices whose last report was down start as Offline.
    await queryRunner.query(
      `UPDATE "IoTDevice" SET "state" = 'Offline' WHERE "isUp" IS FALSE`,
    );
    await queryRunner.query(
      `UPDATE "IoTDevice" SET "stateChangedAt" = "lastSeenAt" WHERE "stateChangedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "IoTDevice" DROP COLUMN "isArchived"`);
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP COLUMN "expectedCheckinIntervalSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTDevice" DROP COLUMN "stateChangedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "IoTDevice" DROP COLUMN "state"`);
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP COLUMN "expectedDeviceCheckinIntervalSeconds"`,
    );
  }
}
