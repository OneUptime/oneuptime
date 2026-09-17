import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The two tables behind owner email burst coalescing: a queue of notifications
 * that is simultaneously the product's first per-recipient email volume record,
 * and a ledger of the flushes that drained it.
 *
 * Regenerating this migration would silently reverse four decisions, so each is
 * written down here rather than left to be rediscovered.
 *
 * The UNIQUE index on UserNotificationEmailRollupBatch (projectId, userId,
 * toEmail, claimEpochStartsAt) IS the exactly-once mechanism across worker
 * replicas, not an integrity nicety. A conditional UPDATE cannot substitute for
 * it: DatabaseService._updateBy resolves its predicate in a separate _findBy and
 * then writes per row by _id, never re-checking the predicate at write time, so
 * "update the row if nobody has claimed it" is a check-then-act race. An INSERT
 * under this index is atomic in Postgres, and the loser's unique violation is
 * how the second replica learns to stand down. Because claimEpochStartsAt is a
 * five-minute wall-clock bucket, the same index also hard-caps a recipient at
 * twelve rollup emails an hour.
 *
 * All four projectId / userId foreign keys are ON DELETE CASCADE. Queued mail
 * about a deleted project, addressed to a deleted user, must go with them; there
 * is nothing to preserve and nothing sensible to send.
 *
 * rollupBatchId deliberately carries NO foreign key. A CASCADE would delete
 * items when their batch is pruned at thirty days while the items themselves are
 * kept for seven, and a SET NULL would un-stamp already-sent items and re-send a
 * month-old rollup. The column is a stamp, not a relation.
 *
 * sentAt is nullable with no default because NULL means "still pending", which
 * is exactly true of every row that will ever exist. That is what removes the
 * need for any data migration or backfill: both tables start empty, which is the
 * correct state on every install, new or upgraded.
 *
 * eventType is character varying(500), not (100) like most short text in this
 * schema. The stored NotificationSettingEventType values are English prose
 * sentences - the longest today is 92 characters - and
 * DatabaseService.checkMaxLengthOfFields throws on overflow, which on this code
 * path would route every notification through the write path's fail-open catch.
 */
export class AddUserNotificationEmailRollup1791000000000
  implements MigrationInterface
{
  public name: string = "AddUserNotificationEmailRollup1791000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserNotificationEmailRollupItem" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "toEmail" character varying(100) NOT NULL, "eventType" character varying(500) NOT NULL, "rollupCategory" character varying(100) NOT NULL, "subject" character varying(500) NOT NULL, "viewLink" text, "sentAt" TIMESTAMP WITH TIME ZONE, "rollupBatchId" uuid, CONSTRAINT "PK_7a4125bfac97ef5ab00115dda89" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a801450828b245c04caa1903bb" ON "UserNotificationEmailRollupItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45ee190ea4724e6795ff3d0402" ON "UserNotificationEmailRollupItem" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_519a1a3aba8c1de67d63137e30" ON "UserNotificationEmailRollupItem" ("rollupBatchId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_103a2b3c5914ddfd4088942798" ON "UserNotificationEmailRollupItem" ("sentAt", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ed339bd9a070c8299e9ba0a4ad" ON "UserNotificationEmailRollupItem" ("projectId", "userId", "toEmail", "rollupCategory", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserNotificationEmailRollupBatch" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "toEmail" character varying(100) NOT NULL, "claimEpochStartsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "claimedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "sentAt" TIMESTAMP WITH TIME ZONE, "itemCount" integer, "status" character varying(100) NOT NULL, "statusMessage" character varying(500), CONSTRAINT "PK_b4fdcbba719e877a310525c134f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ae4bc5b89abee188172985d93" ON "UserNotificationEmailRollupBatch" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6d5acfdf3f3781427a5ff8349" ON "UserNotificationEmailRollupBatch" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6f9067198db90df3e5e4c1d2a2" ON "UserNotificationEmailRollupBatch" ("projectId", "userId", "toEmail", "claimEpochStartsAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD CONSTRAINT "FK_a801450828b245c04caa1903bb7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" ADD CONSTRAINT "FK_45ee190ea4724e6795ff3d04027" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupBatch" ADD CONSTRAINT "FK_2ae4bc5b89abee188172985d93a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupBatch" ADD CONSTRAINT "FK_c6d5acfdf3f3781427a5ff83498" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupBatch" DROP CONSTRAINT "FK_c6d5acfdf3f3781427a5ff83498"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupBatch" DROP CONSTRAINT "FK_2ae4bc5b89abee188172985d93a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP CONSTRAINT "FK_45ee190ea4724e6795ff3d04027"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupItem" DROP CONSTRAINT "FK_a801450828b245c04caa1903bb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f9067198db90df3e5e4c1d2a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6d5acfdf3f3781427a5ff8349"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ae4bc5b89abee188172985d93"`,
    );
    await queryRunner.query(`DROP TABLE "UserNotificationEmailRollupBatch"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ed339bd9a070c8299e9ba0a4ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_103a2b3c5914ddfd4088942798"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_519a1a3aba8c1de67d63137e30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45ee190ea4724e6795ff3d0402"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a801450828b245c04caa1903bb"`,
    );
    await queryRunner.query(`DROP TABLE "UserNotificationEmailRollupItem"`);
  }
}
