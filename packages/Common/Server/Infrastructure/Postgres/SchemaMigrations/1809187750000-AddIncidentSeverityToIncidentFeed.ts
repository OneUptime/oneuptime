import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncidentSeverityToIncidentFeed1809187750000
  implements MigrationInterface
{
  public name = "AddIncidentSeverityToIncidentFeed1809187750000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD "incidentSeverityChangedFromName" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD "incidentSeverityChangedToName" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "incidentSeverityChangedToName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "incidentSeverityChangedFromName"`,
    );
  }
}
