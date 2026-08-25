import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An optional operator-supplied name on a discovery scan (issue #3391), so the
 * Discovery Scans list can be read by purpose — "Router Discovery — Region
 * 1100" — instead of only by the raw address range it sweeps.
 *
 * Nullable with no default and no backfill: every scan that already exists
 * stays unnamed, and every surface that renders the name falls back to the
 * scan target exactly as it did before this column existed.
 */
export class AddNameToNetworkDeviceDiscoveryScan1789400000000
  implements MigrationInterface
{
  public name: string = "AddNameToNetworkDeviceDiscoveryScan1789400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "name" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "name"`,
    );
  }
}
