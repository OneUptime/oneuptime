import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Every OneUptime AI rule may pick the LLM provider its work uses
 * (Common/Types/AI/LlmProviderChoice): an investigation rule, an auto
 * remediation rule and a postmortem rule each get "llmProviderId", one of
 * the project's providers or a global one. A run records the pick of the
 * rule that started it, AIRun "llmProviderId", so a run queued before its
 * provider was deleted still knows it had one and says why it used another.
 *
 * Nothing to backfill: every rule there is picks none, which is the
 * project's default provider, else the global one - what every rule's work
 * used before. A nullable column with no default is added without
 * rewriting a row.
 *
 * The rules' indexes on "llmProviderId" and their foreign keys to
 * "LlmProvider" (ON DELETE SET NULL: deleting a provider leaves its rules
 * picking none) are built online, without blocking the tables' writes, by
 * AddRuleLlmProviderIndexesAndKeys1805930000000. AIRun's column has none:
 * a run remembers its pick after the provider is gone.
 */
export class AddRuleLlmProviders1805920000000 implements MigrationInterface {
  public name: string = "AddRuleLlmProviders1805920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" ADD "llmProviderId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "llmProviderId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" ADD "llmProviderId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" ADD "llmProviderId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP COLUMN "llmProviderId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP COLUMN "llmProviderId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "llmProviderId"`,
    );
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "llmProviderId"`);
  }
}
