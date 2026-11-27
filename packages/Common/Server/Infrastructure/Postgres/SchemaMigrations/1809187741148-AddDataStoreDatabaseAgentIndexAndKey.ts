import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDataStoreDataObservabilityRemovalAndAgent1809187741147, and moved into
 * a migration of its own: "DataStore" is written by every collection, scan
 * and discovery, and "DatabaseServer" by every heartbeat of a Database
 * Agent. So the index a Database Agent's claim reads (its server's due
 * databases, oldest first) is built online, and the key to
 * "DatabaseServer" is added NOT VALID and then validated, without blocking
 * those reads and writes meanwhile. Every existing row's column is null,
 * so the validation finds nothing to refuse. Index and key names are
 * TypeORM's own, so the schema drift check finds nothing to change.
 *
 * The key empties a store's Database Agent server when the server is
 * deleted (ON DELETE SET NULL): the store is kept, and its page says it has
 * no way in until someone chooses another.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddDataStoreDatabaseAgentIndexAndKey1809187741148
  implements MigrationInterface
{
  public name: string = "AddDataStoreDatabaseAgentIndexAndKey1809187741148";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_c06700be47142edd2d06f386cd" ON "DataStore" ("tableHealthDatabaseServerId", "nextTableHealthCollectionAt") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "DataStore" ADD CONSTRAINT "FK_049eac00517139a4d8d43319a91" FOREIGN KEY ("tableHealthDatabaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP CONSTRAINT "FK_049eac00517139a4d8d43319a91"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c06700be47142edd2d06f386cd"`,
    );
  }
}
