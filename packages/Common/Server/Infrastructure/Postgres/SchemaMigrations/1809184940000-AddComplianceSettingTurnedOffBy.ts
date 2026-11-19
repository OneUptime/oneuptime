import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Who last turned a compliance framework or requirement off for a resource,
 * and when (#9629): DataSecurityComplianceSetting.turnedOffByUserId and
 * turnedOffAt, which OneUptime writes whenever a setting goes from on to
 * off, and clears when it is turned on again. A setting is made the first
 * time it is turned off and only changed after that, so who made it may not
 * be who turned it off last.
 *
 * Generated with npm run generate-postgres-migration. Two nullable columns
 * with no default: adding them rewrites nothing and reads no row. The key
 * from turnedOffByUserId to the user is added online, apart, in
 * AddComplianceSettingTurnedOffByKey1809184940100 (Docs/migrations/README.md).
 */
export class AddComplianceSettingTurnedOffBy1809184940000
  implements MigrationInterface
{
  public name: string = "AddComplianceSettingTurnedOffBy1809184940000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "turnedOffByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "turnedOffAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "turnedOffAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "turnedOffByUserId"`,
    );
  }
}
