import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCodeRepositoryProductionReviewLlmProvider1808330000000, and moved into
 * a migration of its own: projects already have repositories in
 * "CodeRepository", so the index on its new "productionReviewLlmProviderId"
 * column is built online, and the foreign key to "LlmProvider" is added NOT
 * VALID and then validated, without blocking the writes a repository gets
 * while AI works in it. Every repository's column is null, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way: an index or key that is already there is left as it is.
 */
export class AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000
  implements MigrationInterface
{
  public name: string =
    "AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0d6102e35d45ec40768554266e" ON "CodeRepository" ("productionReviewLlmProviderId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "CodeRepository" ADD CONSTRAINT "FK_0d6102e35d45ec40768554266e0" FOREIGN KEY ("productionReviewLlmProviderId") REFERENCES "LlmProvider"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP CONSTRAINT "FK_0d6102e35d45ec40768554266e0"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0d6102e35d45ec40768554266e"`,
    );
  }
}
