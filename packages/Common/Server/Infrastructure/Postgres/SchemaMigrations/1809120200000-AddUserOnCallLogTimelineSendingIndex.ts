import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #6873).
 * "UserOnCallLogTimeline" keeps every notification ever sent to anybody on
 * call, so the index is built online, without blocking the notifications
 * written meanwhile. It is partial - only the notifications that still say
 * Sending, a handful at any moment - and serves the stuck check's read
 * every five minutes of the ones still Sending past the limit, oldest first
 * (OnCallStuckNotifications). Safe to run again after a stop part way.
 */
export class AddUserOnCallLogTimelineSendingIndex1809120200000
  implements MigrationInterface
{
  public name: string = "AddUserOnCallLogTimelineSendingIndex1809120200000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_81e54f86fd5162924492fa5919" ON "UserOnCallLogTimeline" ("createdAt") WHERE "status" = 'Sending' AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_81e54f86fd5162924492fa5919"`,
    );
  }
}
