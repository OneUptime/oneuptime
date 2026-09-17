import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. Replace TypeORM's
 * DROP/ADD pairs with equivalent in-place type changes to preserve existing
 * descriptions. Rollback refuses values over 500 characters instead of
 * silently truncating them.
 */
export class RemoveMonitorDescriptionLengthLimit1793600000000
  implements MigrationInterface
{
  public name: string = "RemoveMonitorDescriptionLengthLimit1793600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "monitorDescription" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ALTER COLUMN "description" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ALTER COLUMN "description" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "monitorDescription" TYPE character varying(500)`,
    );
  }
}
