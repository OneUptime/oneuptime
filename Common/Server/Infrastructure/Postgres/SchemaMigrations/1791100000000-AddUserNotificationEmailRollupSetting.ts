import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The per-user escape hatch from owner email burst rollup: one row per
 * (user, project) saying whether that person's notification emails may be
 * coalesced during a burst.
 *
 * Two decisions here that a regeneration would silently reverse.
 *
 * isEnabled is NOT NULL DEFAULT TRUE, and the table starts empty. Rollup is on
 * by default and there is no backfill, so almost nobody will ever have a row;
 * the read path treats an absent row and isEnabled = true identically, which
 * is what lets this ship without writing a row for a single existing member.
 * Flip the default to false and every project member silently opts out of a
 * feature they were never asked about.
 *
 * Both foreign keys are ON DELETE CASCADE. A preference about a deleted
 * project, held by a deleted user, has nothing left to express - and the
 * tenant column is NOT NULL, so SET NULL could not be satisfied anyway.
 *
 * There is deliberately no UNIQUE index on (projectId, userId), even though
 * the service treats the pair as unique. The dashboard creates the row lazily
 * on the first toggle and the service's check-then-create narrows the race;
 * adding the constraint would be a correctness improvement but it would turn
 * the losing side of that race from a harmless duplicate into a 500 on a
 * settings page, and both rows say the same thing in every flow the UI can
 * produce. Worth revisiting if the row ever carries more than one field.
 */
export class AddUserNotificationEmailRollupSetting1791100000000
  implements MigrationInterface
{
  public name: string = "AddUserNotificationEmailRollupSetting1791100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserNotificationEmailRollupSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_2d06015d532e73decda61f6c729" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fc43fd93f6c9b84517ec70a756" ON "UserNotificationEmailRollupSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eb2b532417a885a83ef3a246c" ON "UserNotificationEmailRollupSetting" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" ADD CONSTRAINT "FK_fc43fd93f6c9b84517ec70a756e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" ADD CONSTRAINT "FK_0eb2b532417a885a83ef3a246cf" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" ADD CONSTRAINT "FK_b3e85e262ece458665f3b67ec9c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" ADD CONSTRAINT "FK_4f8b04650019cb0b9e4cee5f561" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" DROP CONSTRAINT "FK_4f8b04650019cb0b9e4cee5f561"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" DROP CONSTRAINT "FK_b3e85e262ece458665f3b67ec9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" DROP CONSTRAINT "FK_0eb2b532417a885a83ef3a246cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationEmailRollupSetting" DROP CONSTRAINT "FK_fc43fd93f6c9b84517ec70a756e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eb2b532417a885a83ef3a246c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fc43fd93f6c9b84517ec70a756"`,
    );
    await queryRunner.query(`DROP TABLE "UserNotificationEmailRollupSetting"`);
  }
}
