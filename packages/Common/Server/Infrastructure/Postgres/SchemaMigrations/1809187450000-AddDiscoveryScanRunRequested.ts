import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Who ran a discovery scan again on demand, and when (#10334): Run Again on
 * Network > Discovery puts the same scan back in its probe's queue, and the
 * scan keeps who asked and when for the run it is on now or ran last
 * (NetworkDeviceDiscoveryScan.runRequestedAt, runRequestedByUserId).
 *
 * The columns only, nullable with no default, so no row is rewritten: every
 * scan saved before reads as one whose run started by itself, which it did.
 * The foreign key generated with them points at "User", which every sign-in
 * writes, so it is added online, in
 * AddDiscoveryScanRunRequestedByUserKey1809187450010.
 */
export class AddDiscoveryScanRunRequested1809187450000
  implements MigrationInterface
{
  public name: string = "AddDiscoveryScanRunRequested1809187450000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "runRequestedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "runRequestedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "runRequestedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "runRequestedAt"`,
    );
  }
}
