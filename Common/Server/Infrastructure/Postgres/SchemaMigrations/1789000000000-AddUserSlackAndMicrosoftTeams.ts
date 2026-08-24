import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Slack and Microsoft Teams as user notification methods.
 *
 * Two new per-user method tables (UserSlack / UserMicrosoftTeams — pointers at
 * the user's OAuth workspace link, created verified), the notification-rule
 * and on-call timeline foreign keys that let rules route pages to them, and
 * the two per-event toggles on UserNotificationSetting.
 */
export class AddUserSlackAndMicrosoftTeams1789000000000
  implements MigrationInterface
{
  public name = "AddUserSlackAndMicrosoftTeams1789000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserSlack" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "slackUserId" character varying(100), "slackUserName" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_86de4cd76b41a08811fc403e23a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5dd2503bf422c6a19946216e1" ON "UserSlack" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_abe4265455b18cd43a94bb84ed" ON "UserSlack" ("slackUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c8fa391e949f53f670dabe222" ON "UserSlack" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "UserMicrosoftTeams" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "microsoftTeamsUserId" character varying(100), "microsoftTeamsUserName" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_9e2c27aadbc24a991c68e55c130" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cebf1edfa5f30a7e597633bddf" ON "UserMicrosoftTeams" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a746ef4fd29b03ac5abe8f4e4c" ON "UserMicrosoftTeams" ("microsoftTeamsUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4405f9dacd3d1e3c363e8dbd3" ON "UserMicrosoftTeams" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userSlackId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userMicrosoftTeamsId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userSlackId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userMicrosoftTeamsId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertBySlack" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByMicrosoftTeams" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c24badba9b152d08700f7d8aa" ON "UserNotificationRule" ("userSlackId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3dc4e1c367eab9fd36b7983e44" ON "UserNotificationRule" ("userMicrosoftTeamsId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d51ef7b2a8b813d37e94890ff7" ON "UserOnCallLogTimeline" ("userSlackId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a7206c19df5cdfe02cf3215a64" ON "UserOnCallLogTimeline" ("userMicrosoftTeamsId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" ADD CONSTRAINT "FK_d5dd2503bf422c6a19946216e19" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" ADD CONSTRAINT "FK_9c8fa391e949f53f670dabe2220" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" ADD CONSTRAINT "FK_fd38a9ee050702437ed323f21fb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" ADD CONSTRAINT "FK_2f058862227400121f90925d65e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" ADD CONSTRAINT "FK_cebf1edfa5f30a7e597633bddf9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" ADD CONSTRAINT "FK_e4405f9dacd3d1e3c363e8dbd30" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" ADD CONSTRAINT "FK_81443b1ab79d63b7700f3d16c84" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" ADD CONSTRAINT "FK_1d7cfdf5a4e314cf4b4cc7873e0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_0c24badba9b152d08700f7d8aa8" FOREIGN KEY ("userSlackId") REFERENCES "UserSlack"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_3dc4e1c367eab9fd36b7983e444" FOREIGN KEY ("userMicrosoftTeamsId") REFERENCES "UserMicrosoftTeams"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_d51ef7b2a8b813d37e94890ff77" FOREIGN KEY ("userSlackId") REFERENCES "UserSlack"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_a7206c19df5cdfe02cf3215a64c" FOREIGN KEY ("userMicrosoftTeamsId") REFERENCES "UserMicrosoftTeams"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_a7206c19df5cdfe02cf3215a64c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_d51ef7b2a8b813d37e94890ff77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_3dc4e1c367eab9fd36b7983e444"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_0c24badba9b152d08700f7d8aa8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" DROP CONSTRAINT "FK_1d7cfdf5a4e314cf4b4cc7873e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" DROP CONSTRAINT "FK_81443b1ab79d63b7700f3d16c84"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" DROP CONSTRAINT "FK_e4405f9dacd3d1e3c363e8dbd30"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserMicrosoftTeams" DROP CONSTRAINT "FK_cebf1edfa5f30a7e597633bddf9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" DROP CONSTRAINT "FK_2f058862227400121f90925d65e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" DROP CONSTRAINT "FK_fd38a9ee050702437ed323f21fb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" DROP CONSTRAINT "FK_9c8fa391e949f53f670dabe2220"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserSlack" DROP CONSTRAINT "FK_d5dd2503bf422c6a19946216e19"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a7206c19df5cdfe02cf3215a64"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d51ef7b2a8b813d37e94890ff7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3dc4e1c367eab9fd36b7983e44"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c24badba9b152d08700f7d8aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByMicrosoftTeams"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertBySlack"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userMicrosoftTeamsId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userSlackId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userMicrosoftTeamsId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userSlackId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4405f9dacd3d1e3c363e8dbd3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a746ef4fd29b03ac5abe8f4e4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cebf1edfa5f30a7e597633bddf"`,
    );
    await queryRunner.query(`DROP TABLE "UserMicrosoftTeams"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c8fa391e949f53f670dabe222"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abe4265455b18cd43a94bb84ed"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5dd2503bf422c6a19946216e1"`,
    );
    await queryRunner.query(`DROP TABLE "UserSlack"`);
  }
}
