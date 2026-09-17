import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Detection rules gain correlation semantics (issue #3398):
 * distinctCountField switches what a rule counts — unique values of a
 * field (distinct usernames, distinct source IPs) instead of raw matching
 * events — and matchCountThreshold holds a rule back until a group
 * reaches N in one evaluation window. Threshold defaults to 1 so every
 * existing rule keeps its fire-on-any-match behavior.
 */
export class AddDetectionRuleDistinctCountColumns1789512000000
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleDistinctCountColumns1789512000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "distinctCountField" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "matchCountThreshold" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "matchCountThreshold"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "distinctCountField"`,
    );
  }
}
