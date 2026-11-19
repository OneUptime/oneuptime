import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Each Dataverse table's entity set name, kept with the table by its
 * collection (#9696): the name Power BI's OData connectors call it by
 * (accounts for account), so a report on a probe-collected environment is
 * matched as one on an environment OneUptime collects is.
 *
 * One nullable column with no default, as TypeORM generated it: adding it
 * rewrites no row, and holds the table's lock only while the catalog
 * changes.
 */
export class AddDataAssetEntitySetName1809186396960
  implements MigrationInterface
{
  public name = "AddDataAssetEntitySetName1809186396960";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "entitySetName" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP COLUMN "entitySetName"`,
    );
  }
}
