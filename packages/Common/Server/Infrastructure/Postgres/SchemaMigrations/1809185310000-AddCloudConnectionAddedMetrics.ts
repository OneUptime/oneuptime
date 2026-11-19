import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration: the metrics people add
 * to what a cloud connection reads, beyond each resource type's key metrics
 * (CloudConnection.addedMetrics, CloudAddedMetrics, #9563). A nullable
 * column with no default, so adding it rewrites nothing.
 */
export class AddCloudConnectionAddedMetrics1809185310000
  implements MigrationInterface
{
  public name: string = "AddCloudConnectionAddedMetrics1809185310000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD "addedMetrics" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP COLUMN "addedMetrics"`,
    );
  }
}
