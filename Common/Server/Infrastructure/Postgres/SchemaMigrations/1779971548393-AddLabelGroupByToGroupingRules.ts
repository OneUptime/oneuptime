import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLabelGroupByToGroupingRules1779971548393
  implements MigrationInterface
{
  public name: string = "AddLabelGroupByToGroupingRules1779971548393";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "groupByIncidentLabels" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" ADD "groupByMonitorLabels" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "groupByAlertLabels" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" ADD "groupByMonitorLabels" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByMonitorLabels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertGroupingRule" DROP COLUMN "groupByAlertLabels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "groupByMonitorLabels"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentGroupingRule" DROP COLUMN "groupByIncidentLabels"`,
    );
  }
}
