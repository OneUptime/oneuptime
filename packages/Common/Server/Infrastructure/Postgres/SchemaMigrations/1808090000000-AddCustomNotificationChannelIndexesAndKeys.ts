import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCustomNotificationChannels1808080000000, and moved into a migration of
 * its own: "UserNotificationRule" and "UserOnCallLogTimeline" already exist,
 * so the indexes on their new "customNotificationChannelId" columns are
 * built online, and the foreign keys to "CustomNotificationChannel" are
 * added NOT VALID and then validated, without blocking either table's
 * writes. Every existing row's column is null, so the validation finds
 * nothing to refuse. Safe to run again after a stop part way: an index or
 * key that is already there is left as it is.
 */
export class AddCustomNotificationChannelIndexesAndKeys1808090000000
  implements MigrationInterface
{
  public name: string =
    "AddCustomNotificationChannelIndexesAndKeys1808090000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_9007ed46795bf227769761ea87" ON "UserNotificationRule" ("customNotificationChannelId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_89ba6c7d5c32a8bf1f1c8ade98" ON "UserOnCallLogTimeline" ("customNotificationChannelId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_9007ed46795bf227769761ea871" FOREIGN KEY ("customNotificationChannelId") REFERENCES "CustomNotificationChannel"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_89ba6c7d5c32a8bf1f1c8ade98e" FOREIGN KEY ("customNotificationChannelId") REFERENCES "CustomNotificationChannel"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_89ba6c7d5c32a8bf1f1c8ade98e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_9007ed46795bf227769761ea871"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_89ba6c7d5c32a8bf1f1c8ade98"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_9007ed46795bf227769761ea87"`,
    );
  }
}
