import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Mattermost as a user notification method: the per-user method table
 * (UserMattermost, a pointer at the member's connected Mattermost account,
 * created verified) and the notification-rule and on-call timeline columns that
 * let rules route pages to it. The new columns' indexes and foreign keys are
 * built online, in AddUserMattermostIndexesAndKeys1808992620000, because those
 * two tables already exist and are written all the time.
 */
export class AddUserMattermost1808992610000 implements MigrationInterface {
  public name: string = "AddUserMattermost1808992610000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserMattermost" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "mattermostUserId" character varying(100), "mattermostUserName" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1e8151282332b6828bdca0370a0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15b9d575af7c825484703e97a1" ON "UserMattermost" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b717ab7e9a709fde4bd3527bc" ON "UserMattermost" ("mattermostUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49af970cef1347096b25c80088" ON "UserMattermost" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userMattermostId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userMattermostId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" ADD CONSTRAINT "FK_15b9d575af7c825484703e97a16" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" ADD CONSTRAINT "FK_49af970cef1347096b25c80088e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" ADD CONSTRAINT "FK_0916c40b56539f984bbb6c2fe40" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" ADD CONSTRAINT "FK_a60fea37fdabb0b046474735183" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" DROP CONSTRAINT "FK_a60fea37fdabb0b046474735183"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" DROP CONSTRAINT "FK_0916c40b56539f984bbb6c2fe40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" DROP CONSTRAINT "FK_49af970cef1347096b25c80088e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMattermost" DROP CONSTRAINT "FK_15b9d575af7c825484703e97a16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userMattermostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userMattermostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49af970cef1347096b25c80088"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b717ab7e9a709fde4bd3527bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15b9d575af7c825484703e97a1"`,
    );
    await queryRunner.query(`DROP TABLE "UserMattermost"`);
  }
}
