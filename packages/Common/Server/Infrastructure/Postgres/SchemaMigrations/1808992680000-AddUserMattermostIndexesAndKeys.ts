import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Moved out of AddUserMattermost1808992670000. UserNotificationRule and
 * UserOnCallLogTimeline already exist and every page writes them, so the
 * indexes on their new "userMattermostId" columns are built online, and the
 * foreign keys to "UserMattermost" are added NOT VALID and then validated,
 * without blocking those writes. Every existing row's column is null, so the
 * validation finds nothing to refuse. Safe to run again after a stop part way:
 * an index or key that is already there is left as it is.
 */
export class AddUserMattermostIndexesAndKeys1808992680000
  implements MigrationInterface
{
  public name: string = "AddUserMattermostIndexesAndKeys1808992680000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_2415d97609d20ae4844eed7c23" ON "UserNotificationRule" ("userMattermostId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_5698ca2daa7c8900c6b2504ee4" ON "UserOnCallLogTimeline" ("userMattermostId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_2415d97609d20ae4844eed7c233" FOREIGN KEY ("userMattermostId") REFERENCES "UserMattermost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_5698ca2daa7c8900c6b2504ee4d" FOREIGN KEY ("userMattermostId") REFERENCES "UserMattermost"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_5698ca2daa7c8900c6b2504ee4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_2415d97609d20ae4844eed7c233"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_5698ca2daa7c8900c6b2504ee4"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2415d97609d20ae4844eed7c23"`,
    );
  }
}
