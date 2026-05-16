import { MigrationInterface, QueryRunner } from "typeorm";

export class SwitchRunbookAgentTagsToAgentId1778834788959
  implements MigrationInterface
{
  public name: string = "SwitchRunbookAgentTagsToAgentId1778834788959";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Switch Runbook Agent routing from "step picks a tag, any agent with the
     * tag claims it" to "step picks the agent directly".
     *
     *  - Drop the now-unused `tags` column on RunbookAgent.
     *  - Replace RunbookAgentJob.requiredTag (text) with targetAgentId (uuid
     *    FK to RunbookAgent). The old varchar values are not portable to
     *    UUIDs, so existing rows lose their routing target — any in-flight
     *    job from before this migration becomes unclaimable and will time
     *    out cleanly.
     *  - The pre-existing assignedAgentId FK was removed alongside the
     *    @ManyToOne decorator on the model; we drop its constraint here.
     */
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP CONSTRAINT "FK_eec146ac21d97c2731c73ae9410"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6791164943615abf539651d14e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP COLUMN "requiredTag"`,
    );
    await queryRunner.query(`ALTER TABLE "RunbookAgent" DROP COLUMN "tags"`);
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD "targetAgentId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c9d1810e0fda27177cd41ea73" ON "RunbookAgentJob" ("targetAgentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD CONSTRAINT "FK_5c9d1810e0fda27177cd41ea738" FOREIGN KEY ("targetAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP CONSTRAINT "FK_5c9d1810e0fda27177cd41ea738"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c9d1810e0fda27177cd41ea73"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP COLUMN "targetAgentId"`,
    );
    await queryRunner.query(`ALTER TABLE "RunbookAgent" ADD "tags" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD "requiredTag" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6791164943615abf539651d14e" ON "RunbookAgentJob" ("requiredTag") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD CONSTRAINT "FK_eec146ac21d97c2731c73ae9410" FOREIGN KEY ("assignedAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
