import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDiscordInteractionReceipt1795600000000
  implements MigrationInterface
{
  public name = "AddDiscordInteractionReceipt1795600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DiscordInteractionReceipt" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "applicationId" character varying(100) NOT NULL, "interactionId" character varying(100) NOT NULL, "guildId" character varying(100) NOT NULL, "discordUserId" character varying(100) NOT NULL, "projectId" uuid, "userId" uuid, "status" character varying(100) NOT NULL, "replayResponse" jsonb, "completedAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_13f274b3345369c49daff1d7c55" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3aa7aeee1bbd90d37c1b286ef8" ON "DiscordInteractionReceipt" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_bc76dd327a2b488acb31b3c897" ON "DiscordInteractionReceipt" ("applicationId", "interactionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc76dd327a2b488acb31b3c897"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3aa7aeee1bbd90d37c1b286ef8"`,
    );
    await queryRunner.query(`DROP TABLE "DiscordInteractionReceipt"`);
  }
}
