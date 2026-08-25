import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Vendor health template auto-apply (issue #3378, phase 3): a per-device
 * opt-in that lets the inventory poll merge the matching vendor OID template
 * into an empty Health OIDs list once the device's sysObjectID is known.
 * Defaults false everywhere — existing devices keep the manual banner flow;
 * the auto-import engine turns it on for the devices it creates.
 */
export class AddAutoApplyVendorHealthTemplate1789300000000
  implements MigrationInterface
{
  public name: string = "AddAutoApplyVendorHealthTemplate1789300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "autoApplyVendorHealthTemplate" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "autoApplyVendorHealthTemplate"`,
    );
  }
}
