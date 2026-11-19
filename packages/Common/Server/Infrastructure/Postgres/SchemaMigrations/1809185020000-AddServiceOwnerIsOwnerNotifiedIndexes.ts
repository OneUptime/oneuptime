import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddServiceOwnerIsOwnerNotified1809185000000, and moved into a migration of
 * its own so each index is built online, without blocking the service owner
 * tables' readers or writers (Docs/migrations/README.md): the indexes the
 * Workers' ServiceOwners job finds the rows not told yet by, as every other
 * record's owner-added job does (#9700).
 *
 * The names are the generated ones, so the drift check finds nothing to
 * change. Built after MarkOwnersAddedBeforeNotificationsAsTold1809185010000
 * marked the waiting rows told, so they are built once, over the values
 * they keep. Safe to run again after a stop part way.
 */
export class AddServiceOwnerIsOwnerNotifiedIndexes1809185020000
  implements MigrationInterface
{
  public name: string = "AddServiceOwnerIsOwnerNotifiedIndexes1809185020000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_a74b37f8142004dcdd4584c4fe" ON "ServiceOwnerTeam" ("isOwnerNotified") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_bafacc1ebabdeea91791639fb0" ON "ServiceOwnerUser" ("isOwnerNotified") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_bafacc1ebabdeea91791639fb0"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a74b37f8142004dcdd4584c4fe"`,
    );
  }
}
