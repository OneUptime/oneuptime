import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddRuleLlmProviders1805980000000, and moved into a migration of its own:
 * AutoRemediationRule, AIInvestigationRule and AIPostmortemRule already
 * exist and are written while incidents and alerts are created, so each
 * index on its new "llmProviderId" column is built online, and each foreign
 * key to "LlmProvider" is added NOT VALID and then validated, without
 * blocking the tables' writes. Every existing rule's column is null, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way: an index or key that is already there is left as it is.
 */
export class AddRuleLlmProviderIndexesAndKeys1805990000000
  implements MigrationInterface
{
  public name: string = "AddRuleLlmProviderIndexesAndKeys1805990000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_1da91a0497a685dcc14535aa68" ON "AutoRemediationRule" ("llmProviderId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_42204354d038fc00dc63646b72" ON "AIInvestigationRule" ("llmProviderId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_57fa7734d3e32175d6100fb8d0" ON "AIPostmortemRule" ("llmProviderId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_1da91a0497a685dcc14535aa681" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AIInvestigationRule" ADD CONSTRAINT "FK_42204354d038fc00dc63646b72b" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AIPostmortemRule" ADD CONSTRAINT "FK_57fa7734d3e32175d6100fb8d00" FOREIGN KEY ("llmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIPostmortemRule" DROP CONSTRAINT "FK_57fa7734d3e32175d6100fb8d00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRule" DROP CONSTRAINT "FK_42204354d038fc00dc63646b72b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_1da91a0497a685dcc14535aa681"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_57fa7734d3e32175d6100fb8d0"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_42204354d038fc00dc63646b72"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1da91a0497a685dcc14535aa68"`,
    );
  }
}
