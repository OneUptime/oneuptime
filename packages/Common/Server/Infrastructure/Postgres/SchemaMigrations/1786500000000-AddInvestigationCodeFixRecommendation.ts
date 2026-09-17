import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with `npm run generate-postgres-migration` after adding
 * AIRun.codeFixRecommendation. Existing rows fail closed as NotRecommended;
 * incident/alert investigations move to Pending only in their atomic
 * Completed transition, then settle through structured post-analysis
 * classification.
 */
export class AddInvestigationCodeFixRecommendation1786500000000
  implements MigrationInterface
{
  public name = "AddInvestigationCodeFixRecommendation1786500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "codeFixRecommendation" character varying(100) NOT NULL DEFAULT 'NotRecommended'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" DROP COLUMN "codeFixRecommendation"`,
    );
  }
}
