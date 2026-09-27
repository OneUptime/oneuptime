import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserDiscord1795300000000 implements MigrationInterface {
  public name: string = "AddUserDiscord1795300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserDiscord" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "discordUserId" character varying(100), "discordUserName" character varying(100), "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, "isVerified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_d3f1987d57aaee486b5e07708fc" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e00c753819665c839d8e95418" ON "UserDiscord" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3a9594323bf0003f67d333486" ON "UserDiscord" ("discordUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3dde842c059350a814a9ffe42" ON "UserDiscord" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD "userDiscordId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "userDiscordId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" ADD "alertByDiscord" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e16ac6a370ab4e8984e02960e" ON "UserNotificationRule" ("userDiscordId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2917dd792fd9a1c79694f27622" ON "UserOnCallLogTimeline" ("userDiscordId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" ADD CONSTRAINT "FK_1e00c753819665c839d8e954181" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" ADD CONSTRAINT "FK_b3dde842c059350a814a9ffe42d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" ADD CONSTRAINT "FK_b8508ec717f477bf52d644cbbd0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" ADD CONSTRAINT "FK_bc69c228e0941402a0b4cdda84f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_3e16ac6a370ab4e8984e02960ea" FOREIGN KEY ("userDiscordId") REFERENCES "UserDiscord"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_2917dd792fd9a1c79694f27622b" FOREIGN KEY ("userDiscordId") REFERENCES "UserDiscord"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_2917dd792fd9a1c79694f27622b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_3e16ac6a370ab4e8984e02960ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" DROP CONSTRAINT "FK_bc69c228e0941402a0b4cdda84f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" DROP CONSTRAINT "FK_b8508ec717f477bf52d644cbbd0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" DROP CONSTRAINT "FK_b3dde842c059350a814a9ffe42d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserDiscord" DROP CONSTRAINT "FK_1e00c753819665c839d8e954181"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2917dd792fd9a1c79694f27622"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e16ac6a370ab4e8984e02960e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByDiscord"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "userDiscordId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "userDiscordId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3dde842c059350a814a9ffe42"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3a9594323bf0003f67d333486"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e00c753819665c839d8e95418"`,
    );
    await queryRunner.query(`DROP TABLE "UserDiscord"`);
  }
}
