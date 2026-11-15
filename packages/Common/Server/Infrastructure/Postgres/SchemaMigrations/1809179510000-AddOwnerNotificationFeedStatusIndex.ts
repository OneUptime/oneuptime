import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddOwnerNotificationFeedStatus1809179500000, and moved into a migration of
 * its own: "OwnerNotificationDelivery" already holds rows, so the index is
 * built online, without blocking the owner notifications written meanwhile.
 * It is partial - only the notifications whose feed item is still to write,
 * the few between their first owner told and their feed item - so it stays
 * as small as what it finds: the read of the feed items a stopped run left
 * unwritten (issue #8510). Safe to run again after a stop part way.
 */
export class AddOwnerNotificationFeedStatusIndex1809179510000
  implements MigrationInterface
{
  public name: string = "AddOwnerNotificationFeedStatusIndex1809179510000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_6949512eb6ccac3f68f3d589a4" ON "OwnerNotificationDelivery" ("kind", "attemptedAt") WHERE "feedStatus" = 'Pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_6949512eb6ccac3f68f3d589a4"`,
    );
  }
}
