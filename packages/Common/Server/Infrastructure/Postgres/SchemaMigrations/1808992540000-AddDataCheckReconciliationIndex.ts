import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataReconciliations1808992200000, and moved into a migration of its
 * own: DataCheck already exists - a row per check, every dbt test of a
 * project's artifacts among them - and every collection writes each check's
 * last run to it, so the index on its new "dataReconciliationId" column is
 * built online, without blocking the table's writes. Safe to run again after
 * a stop part way, and on a database that ran the first version of
 * AddDataReconciliations1808992200000, which built it in place: an index
 * that is already there is left as it is.
 */
export class AddDataCheckReconciliationIndex1808992540000
  implements MigrationInterface
{
  public name: string = "AddDataCheckReconciliationIndex1808992540000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e4cb27aa7170e1f4419363439e" ON "DataCheck" ("dataReconciliationId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e4cb27aa7170e1f4419363439e"`,
    );
  }
}
