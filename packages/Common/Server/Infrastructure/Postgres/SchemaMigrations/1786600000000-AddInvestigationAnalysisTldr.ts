import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with `npm run generate-postgres-migration` after adding
 * AIRun.analysisTldr — the AI-written one or two sentence summary of a
 * completed investigation's posted report. Nullable: legacy runs, runs that
 * published no report, and runs whose bounded TL;DR call failed simply have
 * none, and the panel omits the TL;DR block for them.
 */
export class AddInvestigationAnalysisTldr1786600000000
  implements MigrationInterface
{
  public name = "AddInvestigationAnalysisTldr1786600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "analysisTldr" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "analysisTldr"`);
  }
}
