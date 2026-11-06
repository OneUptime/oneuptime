import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataObservability1808910000000, and moved into a migration of its own:
 * "DataStore" already exists and Data Security writes it all the time, so
 * the index on its new "nextTableHealthCollectionAt" column - which the
 * table-health schedule reads every five minutes to find the stores that
 * are due - is built online, without blocking those writes. Safe to run
 * again after a stop part way: an index that is already there is left as it
 * is.
 */
export class AddDataObservabilityStoreIndex1808910100000
  implements MigrationInterface
{
  public name: string = "AddDataObservabilityStoreIndex1808910100000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_a880c33bb18a82a7d23b4b30af" ON "DataStore" ("nextTableHealthCollectionAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a880c33bb18a82a7d23b4b30af"`,
    );
  }
}
