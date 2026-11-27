import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When OneUptime added a detection rule itself (#11037): a new recommended
 * rule it turned on, on upgrade, in a project that had every other
 * recommended rule on - so the Overview can say so. A nullable column with
 * no default rewrites nothing: every rule that exists was added by someone
 * else, and reads empty.
 */
export class AddDetectionRuleAddedByOneUptimeAt1809187781037
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleAddedByOneUptimeAt1809187781037";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "addedByOneUptimeAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "addedByOneUptimeAt"`,
    );
  }
}
