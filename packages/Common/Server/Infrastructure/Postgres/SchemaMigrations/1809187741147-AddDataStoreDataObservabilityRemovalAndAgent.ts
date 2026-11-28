import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration. Three columns of a
 * data store, each null on every row there is:
 *
 *   - tableHealthRemovedAt: when someone removed the database from Data
 *     Observability (#11147). Data Observability stops reading and listing
 *     it; Data Security keeps the store, its connection and what its scans
 *     found.
 *   - tableHealthDatabaseServerId and tableHealthDatabaseName: the database
 *     server whose Database Agent reads the database for Data Observability,
 *     and which of its databases (#11148).
 *
 * Adding a nullable column with no default rewrites nothing. The index and
 * the foreign key of tableHealthDatabaseServerId are built online, in
 * AddDataStoreDatabaseAgentIndexAndKey1809187741148.
 */
export class AddDataStoreDataObservabilityRemovalAndAgent1809187741147
  implements MigrationInterface
{
  public name: string =
    "AddDataStoreDataObservabilityRemovalAndAgent1809187741147";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthRemovedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthDatabaseServerId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "tableHealthDatabaseName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthDatabaseName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthDatabaseServerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "tableHealthRemovedAt"`,
    );
  }
}
