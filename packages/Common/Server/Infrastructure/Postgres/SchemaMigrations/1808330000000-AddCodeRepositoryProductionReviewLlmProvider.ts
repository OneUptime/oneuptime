import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A repository in Code may pick the LLM provider OneUptime AI reads its
 * pull requests with in production reviews: "CodeRepository"
 * "productionReviewLlmProviderId", one of the project's providers or a
 * global one (Common/Types/AI/LlmProviderChoice).
 *
 * Nothing to backfill: every repository there is picks none, which is the
 * project's default provider, else the global one - what every review used
 * before. A nullable column with no default is added without rewriting a
 * row.
 *
 * Its index and its foreign key to "LlmProvider" (ON DELETE SET NULL:
 * deleting a provider leaves its repositories picking none) are built
 * online, without blocking the table's writes, by
 * AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000.
 */
export class AddCodeRepositoryProductionReviewLlmProvider1808330000000
  implements MigrationInterface
{
  public name: string =
    "AddCodeRepositoryProductionReviewLlmProvider1808330000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "productionReviewLlmProviderId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "productionReviewLlmProviderId"`,
    );
  }
}
