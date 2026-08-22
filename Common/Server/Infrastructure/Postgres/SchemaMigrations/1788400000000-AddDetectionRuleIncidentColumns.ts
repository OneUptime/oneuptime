import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Detection rules gain an incident option: shouldCreateIncident (default
 * FALSE, unlike shouldCreateAlert's default true — incidents drive on-call,
 * SLAs and status pages, so a rule must opt in) and an optional per-rule
 * IncidentSeverity override, mirroring the alertSeverityId column. SET NULL
 * on severity delete matches the alert pair: losing a severity should
 * degrade the rule to level-based mapping, not delete it.
 */
export class AddDetectionRuleIncidentColumns1788400000000
  implements MigrationInterface
{
  public name: string = "AddDetectionRuleIncidentColumns1788400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "shouldCreateIncident" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "incidentSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD CONSTRAINT "FK_b1cda3642956897cd47dec5fcf8" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP CONSTRAINT "FK_b1cda3642956897cd47dec5fcf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "incidentSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "shouldCreateIncident"`,
    );
  }
}
