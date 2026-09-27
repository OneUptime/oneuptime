import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDiscordReactionObservation1795700000000
  implements MigrationInterface
{
  public name = "CreateDiscordReactionObservation1795700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DiscordReactionObservation" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "claimKey" character varying(500) NOT NULL, "source" character varying(50) NOT NULL, "observationState" character varying(50) NOT NULL DEFAULT 'Pending', CONSTRAINT "PK_dd8f455af030f036c8c4ba50551" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42b1f641cd756ea164a8fcd25c" ON "DiscordReactionObservation" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_discordreaction_project_claimkey" ON "DiscordReactionObservation" ("projectId", "claimKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DiscordReactionObservation" ADD CONSTRAINT "FK_42b1f641cd756ea164a8fcd25c8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordReactionObservation" DROP CONSTRAINT "FK_42b1f641cd756ea164a8fcd25c8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_discordreaction_project_claimkey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42b1f641cd756ea164a8fcd25c"`,
    );
    await queryRunner.query(`DROP TABLE "DiscordReactionObservation"`);
  }
}
