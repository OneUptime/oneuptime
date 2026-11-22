import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * One active block per value and reach (#10346): the unique index that
 * answers two blocks made at once with "already blocked", now by where a
 * block is enforced too, so an address can be blocked at the edge and, on
 * its own, everywhere.
 *
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityBlockReachAndWiderValue1809187436400, which drops the index by
 * value alone, and moved into a migration of its own: "SecurityBlock"
 * already exists, so the index is built online, without blocking the
 * table's writes. Every block made before is at the edge and was one per
 * value, so none is a duplicate here. Safe to run again after a stop part
 * way: an index that is already there is left as it is.
 */
export class AddSecurityBlockValueReachIndex1809187436410
  implements MigrationInterface
{
  public name: string = "AddSecurityBlockValueReachIndex1809187436410";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE UNIQUE INDEX "IDX_ac2da67eb841306d277e0aeb47" ON "SecurityBlock" ("projectId", "value", "reach") WHERE "state" = 'Active' AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_ac2da67eb841306d277e0aeb47"`,
    );
  }
}
