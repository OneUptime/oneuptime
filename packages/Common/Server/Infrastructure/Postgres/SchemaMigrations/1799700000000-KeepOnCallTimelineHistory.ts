import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The on-call history (UserOnCallLogTimeline) stays when a notification rule
 * or method it went through is removed.
 *
 * Each history row points at the person's own rule and method a page went
 * out through. Those references deleted the history row with the rule or
 * method (ON DELETE CASCADE): removing an old phone number removed the record
 * of every page sent to it, and so did a person's leaving the project, which
 * removes their rules and methods there (ProjectLeaveNotificationCleanup).
 * Now the database clears the reference instead (ON DELETE SET NULL) and the
 * row stays: who was paged, when, and how it went.
 *
 * Generated as a DROP and an ADD of the same ten constraints. The ADD checks
 * every history row, so each goes through OnlineDdl.addForeignKey: added NOT
 * VALID, then validated without blocking the table's writers. Safe to run
 * again after a stop part way: a constraint already replaced (it sets null
 * on delete) is not dropped again, and OnlineDdl validates one an earlier run
 * left unvalidated.
 */
export class KeepOnCallTimelineHistory1799700000000
  implements MigrationInterface
{
  public name: string = "KeepOnCallTimelineHistory1799700000000";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.dropUnlessReplaced(queryRunner, "FK_06a427cdcbae1ddcb1301b860f2");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_06a427cdcbae1ddcb1301b860f2" FOREIGN KEY ("userNotificationRuleId") REFERENCES "UserNotificationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_d5c3df01bbb2a9ce168b36b5234");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d5c3df01bbb2a9ce168b36b5234" FOREIGN KEY ("userCallId") REFERENCES "UserCall"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_12ef8407b6359205df8339f8494");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_12ef8407b6359205df8339f8494" FOREIGN KEY ("userSmsId") REFERENCES "UserSMS"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_0a67c82e4e093ae5c89d2d76bdf");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_a61a74c006b54967cdba5e4f280");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a61a74c006b54967cdba5e4f280" FOREIGN KEY ("userTelegramId") REFERENCES "UserTelegram"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_d51ef7b2a8b813d37e94890ff77");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d51ef7b2a8b813d37e94890ff77" FOREIGN KEY ("userSlackId") REFERENCES "UserSlack"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_a7206c19df5cdfe02cf3215a64c");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a7206c19df5cdfe02cf3215a64c" FOREIGN KEY ("userMicrosoftTeamsId") REFERENCES "UserMicrosoftTeams"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_de891557845d64087311a45478d");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_de891557845d64087311a45478d" FOREIGN KEY ("userWebhookId") REFERENCES "UserWebhook"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_815c728d905c44bc440ec91308b");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_815c728d905c44bc440ec91308b" FOREIGN KEY ("userEmailId") REFERENCES "UserEmail"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await this.dropUnlessReplaced(queryRunner, "FK_d3e187a7828a990cdf6429a692f");
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d3e187a7828a990cdf6429a692f" FOREIGN KEY ("userPushId") REFERENCES "UserPush"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_d3e187a7828a990cdf6429a692f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_815c728d905c44bc440ec91308b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_de891557845d64087311a45478d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a7206c19df5cdfe02cf3215a64c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_d51ef7b2a8b813d37e94890ff77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a61a74c006b54967cdba5e4f280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_12ef8407b6359205df8339f8494"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_d5c3df01bbb2a9ce168b36b5234"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_06a427cdcbae1ddcb1301b860f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a7206c19df5cdfe02cf3215a64c" FOREIGN KEY ("userMicrosoftTeamsId") REFERENCES "UserMicrosoftTeams"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d51ef7b2a8b813d37e94890ff77" FOREIGN KEY ("userSlackId") REFERENCES "UserSlack"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_de891557845d64087311a45478d" FOREIGN KEY ("userWebhookId") REFERENCES "UserWebhook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a61a74c006b54967cdba5e4f280" FOREIGN KEY ("userTelegramId") REFERENCES "UserTelegram"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_0a67c82e4e093ae5c89d2d76bdf" FOREIGN KEY ("userWhatsAppId") REFERENCES "UserWhatsApp"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d3e187a7828a990cdf6429a692f" FOREIGN KEY ("userPushId") REFERENCES "UserPush"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_815c728d905c44bc440ec91308b" FOREIGN KEY ("userEmailId") REFERENCES "UserEmail"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_12ef8407b6359205df8339f8494" FOREIGN KEY ("userSmsId") REFERENCES "UserSMS"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d5c3df01bbb2a9ce168b36b5234" FOREIGN KEY ("userCallId") REFERENCES "UserCall"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_06a427cdcbae1ddcb1301b860f2" FOREIGN KEY ("userNotificationRuleId") REFERENCES "UserNotificationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /*
   * Drops the constraint as generated, unless an earlier run that stopped
   * part way has already put its SET NULL replacement in (confdeltype 'n').
   * The DROP holds ACCESS EXCLUSIVE on the two tables for an instant; the
   * wait for it is bounded by the migration's lock_timeout.
   */
  private async dropUnlessReplaced(
    queryRunner: QueryRunner,
    constraintName: string,
  ): Promise<void> {
    const rows: Array<{ onDelete: string }> = await queryRunner.query(
      `SELECT constraint_row.confdeltype AS "onDelete"
         FROM pg_constraint constraint_row
        WHERE constraint_row.conname = $1
          AND constraint_row.conrelid = to_regclass('"UserOnCallLogTimeline"')`,
      [constraintName],
    );

    if (rows[0]?.onDelete === "n") {
      return;
    }

    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
    );
  }
}
