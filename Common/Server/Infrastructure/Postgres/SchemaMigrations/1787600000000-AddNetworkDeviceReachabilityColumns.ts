import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Reachability becomes the OUTCOME of the last poll instead of the age of
 * the last success.
 *
 * "lastSeenAt within 15 minutes = up" could not tell "the device did not
 * answer" apart from "the probe has not asked recently", so any fleet whose
 * real poll cadence exceeded 15 minutes — and any device configured with a
 * polling interval of 15 minutes or more — read as permanently down while
 * its own interface inventory, written by those same successful walks, read
 * as up.
 *
 * lastPolledAt records every ATTEMPT and isReachable records its result;
 * lastSeenAt keeps its existing meaning (last successful walk).
 *
 * Backfill: an existing row with a lastSeenAt did answer the last walk we
 * have any record of — there is no record of a failure — so it is seeded
 * reachable, with that timestamp as its last attempt. Rows that were never
 * seen stay NULL and read as Pending, exactly as they did before.
 */
export class AddNetworkDeviceReachabilityColumns1787600000000
  implements MigrationInterface
{
  public name = "AddNetworkDeviceReachabilityColumns1787600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "lastPolledAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "isReachable" boolean`,
    );
    await queryRunner.query(
      `UPDATE "NetworkDevice" SET "lastPolledAt" = "lastSeenAt", "isReachable" = true WHERE "lastSeenAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "isReachable"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lastPolledAt"`,
    );
  }
}
