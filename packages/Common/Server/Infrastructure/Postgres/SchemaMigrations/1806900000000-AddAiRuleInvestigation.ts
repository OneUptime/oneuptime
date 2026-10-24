import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Investigation rules and auto remediation rules become one: AI rules
 * (Types/AI/AiRule), in the table the auto remediation rules had. This adds
 * what a rule needs to say about investigating (generated with npm run
 * generate-postgres-migration):
 *
 *   - investigates: whether matching the rule puts an incident (or alert) in
 *     OneUptime AI's investigation scope. Off by default, so every rule that
 *     exists - each an auto remediation rule - keeps doing only what it did
 *     until MergeInvestigationRulesIntoAiRules (next) decides, and so a rule
 *     an older API or Terraform client creates never starts narrowing what
 *     is investigated.
 *   - onlyIfOpenAfterMinutes: the rule's wait before it investigates, as an
 *     investigation rule had it. Empty: right away.
 *   - fixes: whether the rule fixes what it matches. On by default: every
 *     auto remediation rule fixed.
 *
 * Constant defaults, so adding them rewrites no table; no index or key.
 */
export class AddAiRuleInvestigation1806900000000 implements MigrationInterface {
  public name: string = "AddAiRuleInvestigation1806900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "investigates" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "onlyIfOpenAfterMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "fixes" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "fixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "onlyIfOpenAfterMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "investigates"`,
    );
  }
}
