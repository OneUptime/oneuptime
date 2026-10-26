import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A monitor template's description is optional (MonitorTemplate
 * .templateDescription): the name usually says what a template is for, and
 * the create form asked for a description every time. Dropping NOT NULL
 * rewrites no row, and every template keeps the description it has.
 */
export class MakeMonitorTemplateDescriptionOptional1807820000000
  implements MigrationInterface
{
  public name: string = "MakeMonitorTemplateDescriptionOptional1807820000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "templateDescription" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "templateDescription" SET NOT NULL`,
    );
  }
}
