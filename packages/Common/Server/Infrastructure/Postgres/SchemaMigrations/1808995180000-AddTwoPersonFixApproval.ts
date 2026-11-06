import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its foreign key is in a migration of its
 * own, AddFirstApprovedByUserForeignKey1808995190000, built online.
 *
 * Two people approve a riskier fix (#6148's follow-up):
 *
 *   - "Project"."requireTwoApprovalsForRiskierFixes": whether the project
 *     asks two people to approve a fix OneUptime AI proposes that holds a
 *     riskier change. NOT NULL DEFAULT false, so every project keeps one
 *     approval until someone turns it on; a constant default is added
 *     without rewriting the table.
 *   - "AutoRemediationSuggestion"."firstApprovedByUserId", "firstApprovedAt"
 *     and "firstApprovedFrom": the first of the two approvals - who gave it,
 *     when, and where (the AI card, Slack or Microsoft Teams). Nullable with
 *     no default: every fix there is had one approval or none.
 *
 * No index or foreign key is added here, so nothing scans, locks or
 * rewrites either table.
 */
export class AddTwoPersonFixApproval1808995180000 implements MigrationInterface {
  public name: string = "AddTwoPersonFixApproval1808995180000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireTwoApprovalsForRiskierFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "firstApprovedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "firstApprovedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "firstApprovedFrom" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "firstApprovedFrom"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "firstApprovedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "firstApprovedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireTwoApprovalsForRiskierFixes"`,
    );
  }
}
