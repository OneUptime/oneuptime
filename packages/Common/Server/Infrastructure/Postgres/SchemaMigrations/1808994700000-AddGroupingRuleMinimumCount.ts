import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Grouping rules can wait for more incidents (or alerts) before they open an
 * episode (issue #5374): "only open an episode once N matching incidents are
 * ongoing".
 *
 *   - IncidentGroupingRule.enableMinimumIncidentCount / minimumIncidentCount
 *     and AlertGroupingRule.enableMinimumAlertCount / minimumAlertCount - the
 *     rule's switch and its count. The switch is off on every existing rule,
 *     which waits for nothing: every rule keeps opening an episode for its
 *     first matching record, as it did.
 *   - Incident / Alert.groupingWaitKey - while a rule holds a record back
 *     until enough of its group are ongoing, the rule and group it waits in.
 *     Empty on every existing record.
 *
 * Generated with npm run generate-postgres-migration. The switches and counts
 * have constant defaults and the marks are nullable with none, so each is
 * added without rewriting its table; nothing is backfilled. The marks'
 * indexes are on tables projects already have rows in, so they are built
 * online, in the migration registered right after this one:
 * AddGroupingWaitKeyIndexes1808994710000.
 */
export class AddGroupingRuleMinimumCount1808994700000
  implements MigrationInterface
{
  public name: string = "AddGroupingRuleMinimumCount1808994700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "enableMinimumIncidentCount" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "minimumIncidentCount" integer NOT NULL DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "groupingWaitKey" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "enableMinimumAlertCount" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "minimumAlertCount" integer NOT NULL DEFAULT '3'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "groupingWaitKey" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Alert" DROP COLUMN "groupingWaitKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "minimumAlertCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "enableMinimumAlertCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "groupingWaitKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "minimumIncidentCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "enableMinimumIncidentCount"`,
    );
  }
}
