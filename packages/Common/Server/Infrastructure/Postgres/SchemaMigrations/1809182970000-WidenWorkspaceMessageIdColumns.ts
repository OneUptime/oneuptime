import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Where a Slack or Microsoft Teams message is - its channel or chat, team,
 * message and thread ids - is stored whole, in columns that hold any id the
 * workspaces give.
 *
 * "WorkspaceLiveMessage" (the messages OneUptime keeps up to date in place)
 * and "WorkspaceNotificationLog" (Notification Logs) kept them in
 * varchar(100), and the code that wrote them cut each to 100 characters. A
 * Microsoft Teams personal chat's id ("a:1...") is 130 characters and more,
 * so it was stored as its first 100: another id, of no chat. Paging from a
 * personal chat kept the chat that way (WorkspacePage.keepPlace), and every
 * update of the page posted there failed with "This chat is not connected to
 * OneUptime" (issue #9284); an edit of a message kept in such a chat failed
 * the same way, and the logs' cut ids matched nothing that read them back (a
 * reaction's note, the project of a message to the bot). An id cut to fit is
 * another id, so the columns are LongText now, varchar(500), as
 * "WorkspacePublicNoteApprovalMessage" keeps the same ids.
 *
 * TypeORM generates each change as DROP COLUMN + ADD, which drops every kept
 * message and every log's channel, and fails outright on a NOT NULL column of
 * a table holding a row. ALTER COLUMN ... TYPE reaches the same schema and
 * keeps every value. Widening a varchar is binary-coercible: Postgres
 * rewrites no row, and the index on "WorkspaceLiveMessage"."channelId" is
 * kept as it is (the same type and collation sort the same), so each table is
 * locked only for its catalog change. Same shape as
 * WidenGitBranchNameColumns1808995180000.
 *
 * The ids already cut are put back by the RestoreCutMicrosoftTeamsChatIds
 * data migration, which runs after this one.
 */
export class WidenWorkspaceMessageIdColumns1809182970000
  implements MigrationInterface
{
  public name: string = "WidenWorkspaceMessageIdColumns1809182970000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelId" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "teamId" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "messageId" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelId" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "threadId" TYPE character varying(500)`,
    );
  }

  /*
   * Narrowing back to 100 fails on any value written longer since. An id is
   * never cut to fit, since a cut id is another id: a log's is emptied, which
   * reads as unknown, and a kept message whose channel, team or message id
   * is longer is forgotten - the next change about it posts a new message
   * instead of editing that one, as for any message OneUptime no longer
   * remembers. A name is only shown, and is cut.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "WorkspaceNotificationLog" SET "threadId" = NULL WHERE LENGTH("threadId") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "threadId" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "WorkspaceNotificationLog" SET "channelName" = LEFT("channelName", 100) WHERE LENGTH("channelName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "WorkspaceNotificationLog" SET "channelId" = NULL WHERE LENGTH("channelId") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelId" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `DELETE FROM "WorkspaceLiveMessage" WHERE LENGTH("channelId") > 100 OR LENGTH("teamId") > 100 OR LENGTH("messageId") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "messageId" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "teamId" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `UPDATE "WorkspaceLiveMessage" SET "channelName" = LEFT("channelName", 100) WHERE LENGTH("channelName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelId" TYPE character varying(100)`,
    );
  }
}
