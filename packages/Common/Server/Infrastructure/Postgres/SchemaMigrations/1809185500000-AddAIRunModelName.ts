import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What an AI run ran on (OneUptime issue #7762):
 *
 *   - AIRun.modelName: the model that wrote the run's answer, as its LLM
 *     provider named it, recorded when the run completes;
 *   - AIRun.llmProviderType: that provider's type (LlmType).
 *
 * AI Results counts investigations, and the fixes that came from them, by
 * the model that wrote the investigation's answer. Nullable, with no
 * default, so Postgres adds them without rewriting "AIRun": every run that
 * completed before has none, and AI Results shows it as a model not
 * recorded. Nothing is backfilled.
 *
 * Generated with npm run generate-postgres-migration.
 */
export class AddAIRunModelName1809185500000 implements MigrationInterface {
  public name: string = "AddAIRunModelName1809185500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "modelName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "llmProviderType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "llmProviderType"`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "modelName"`);
  }
}
