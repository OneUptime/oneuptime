import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Scrub rules that name the attributes they read, and carry the proof that
 * they hide what Data Security found (#10366):
 *
 *  - LogScrubRule.attributeKeys, TraceScrubRule.attributeKeys: the
 *    attributes a Named Attributes rule hides whole, or the only ones a
 *    pattern rule reads;
 *  - LogScrubRule.proof, TraceScrubRule.proof: how OneUptime proved the
 *    rule on the records a finding was seen in, written by OneUptime only;
 *  - DataSecurityIssueFeed.dataSecurityAiProposalId: the OneUptime AI
 *    proposal an issue's timeline entry is about, so a change made without
 *    asking offers its Undo on the entry.
 *
 * Nullable columns with no default and no index, so no row is rewritten,
 * nothing is locked for longer than the catalog change, and every rule
 * saved before keeps reading every attribute, as it did.
 */
export class AddScrubRuleNamedKeysAndProof1809187470400
  implements MigrationInterface
{
  public name: string = "AddScrubRuleNamedKeysAndProof1809187470400";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" ADD "dataSecurityAiProposalId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD "attributeKeys" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "LogScrubRule" ADD "proof" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ADD "attributeKeys" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "TraceScrubRule" ADD "proof" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TraceScrubRule" DROP COLUMN "proof"`);
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP COLUMN "attributeKeys"`,
    );
    await queryRunner.query(`ALTER TABLE "LogScrubRule" DROP COLUMN "proof"`);
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP COLUMN "attributeKeys"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityIssueFeed" DROP COLUMN "dataSecurityAiProposalId"`,
    );
  }
}
