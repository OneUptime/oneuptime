import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A detection rule whose scheduled runs keep failing backs off (#10490):
 * DetectionRule.lastFailedAt says when its last run failed, and a failing
 * rule is tried again at its next interval, or within the hour when its
 * interval is longer, instead of every minute. Its place stays where its
 * last good run left it, so the run that works reads everything it missed.
 *
 * One nullable column added to an existing table: no rewrite, no scan, no
 * default to fill. Every rule starts as one whose last run worked.
 */
export class AddDetectionRuleLastFailedAt1809187220000
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleLastFailedAt1809187220000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "lastFailedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "lastFailedAt"`,
    );
  }
}
