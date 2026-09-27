import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscordResourceThread1795400000000
  implements MigrationInterface
{
  public name: string = "AddDiscordResourceThread1795400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DiscordResourceThread" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "resourceType" character varying(100) NOT NULL, "resourceId" uuid NOT NULL, "notificationRuleId" uuid, "installationId" uuid NOT NULL, "installationVersion" integer NOT NULL, "guildId" character varying(100) NOT NULL, "parentChannelId" character varying(100) NOT NULL, "threadId" character varying(100), "threadName" character varying(100), "isPrivate" boolean NOT NULL DEFAULT false, "state" character varying(100) NOT NULL, "operationKey" character varying(100) NOT NULL, "claimedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "remoteCompletedAt" TIMESTAMP WITH TIME ZONE, "lastVerifiedAt" TIMESTAMP WITH TIME ZONE, "failureReason" character varying(500), CONSTRAINT "PK_8b72bf84cf641973cbc15210810" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4e1b7383d5458cf083ba713b86" ON "DiscordResourceThread" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2db2bce92ec6b2e4bac8703c5d" ON "DiscordResourceThread" ("resourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9c75d76356ce998ec9fbe909f" ON "DiscordResourceThread" ("threadId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca44ccf1d619329b2d2935257d" ON "DiscordResourceThread" ("state") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_42c5b23b251e0c5dc7c22f01e6" ON "DiscordResourceThread" ("projectId", "threadId") WHERE "threadId" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ef49538d1fa5424f0cc733c675" ON "DiscordResourceThread" ("projectId", "resourceType", "resourceId", "notificationRuleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" ADD CONSTRAINT "FK_4e1b7383d5458cf083ba713b868" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" ADD CONSTRAINT "FK_2139650ab709654277510b65842" FOREIGN KEY ("notificationRuleId") REFERENCES "WorkspaceNotificationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" DROP CONSTRAINT "FK_2139650ab709654277510b65842"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DiscordResourceThread" DROP CONSTRAINT "FK_4e1b7383d5458cf083ba713b868"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef49538d1fa5424f0cc733c675"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42c5b23b251e0c5dc7c22f01e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca44ccf1d619329b2d2935257d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9c75d76356ce998ec9fbe909f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2db2bce92ec6b2e4bac8703c5d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4e1b7383d5458cf083ba713b86"`,
    );
    await queryRunner.query(`DROP TABLE "DiscordResourceThread"`);
  }
}
