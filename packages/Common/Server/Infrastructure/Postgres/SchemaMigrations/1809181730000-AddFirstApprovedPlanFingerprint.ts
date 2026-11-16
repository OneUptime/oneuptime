import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issues #6421 and
 * #6422) after AutoRemediationSuggestion gained firstApprovedPlanFingerprint:
 * what the first of two approvals approved - the fix's plan fingerprint
 * then (Types/AutoRemediation/RemediationPlanFingerprint). A second approval
 * runs a riskier fix only while it still runs exactly that
 * (AutoRemediationSuggestionService.attemptSecondApproval), so a first
 * approval is never carried over to a plan nobody approved.
 *
 * Nullable with no default: adding it rewrites no row. A first approval
 * given before it was kept has none, and counts for nothing: the next press
 * is the first approval of the fix as it is now. It is in no index.
 */
export class AddFirstApprovedPlanFingerprint1809181730000
  implements MigrationInterface
{
  public name: string = "AddFirstApprovedPlanFingerprint1809181730000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "firstApprovedPlanFingerprint" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "firstApprovedPlanFingerprint"`,
    );
  }
}
