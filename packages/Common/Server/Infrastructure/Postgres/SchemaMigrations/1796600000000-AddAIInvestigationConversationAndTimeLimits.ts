import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - AIConversation.incidentId / alertId: the one shared conversation in an
 *     incident's or alert's AI investigation box, where every responder asks
 *     OneUptime AI questions and asks it to act. Indexed (the box looks its
 *     thread up by subject) and deleted with its incident or alert. Nullable,
 *     so every existing (personal) conversation is untouched.
 *   - Project.incidentAiInvestigationTimeLimitInMinutes /
 *     alertAiInvestigationTimeLimitInMinutes: an optional time limit per
 *     lane. Nullable with no default: investigations have no time limit
 *     unless a project sets one.
 */

export class AddAIInvestigationConversationAndTimeLimits1796600000000
  implements MigrationInterface
{
  public name: string =
    "AddAIInvestigationConversationAndTimeLimits1796600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "incidentAiInvestigationTimeLimitInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "alertAiInvestigationTimeLimitInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD "incidentId" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "AIConversation" ADD "alertId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_3e33d202ee06482ea5bdfae6ec" ON "AIConversation" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_def9bb6def011eb0e7790cd91e" ON "AIConversation" ("alertId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD CONSTRAINT "FK_3e33d202ee06482ea5bdfae6ec8" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" ADD CONSTRAINT "FK_def9bb6def011eb0e7790cd91e3" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP CONSTRAINT "FK_def9bb6def011eb0e7790cd91e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP CONSTRAINT "FK_3e33d202ee06482ea5bdfae6ec8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_def9bb6def011eb0e7790cd91e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3e33d202ee06482ea5bdfae6ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP COLUMN "alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIConversation" DROP COLUMN "incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "alertAiInvestigationTimeLimitInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "incidentAiInvestigationTimeLimitInMinutes"`,
    );
  }
}
