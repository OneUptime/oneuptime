import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A change of many monitors' template can be one for a network alert policy
 * or an auto import rule (issues #11452, #11451):
 *
 *   - "networkAlertPolicyId" / "networkAlertPolicyName": the policy whose
 *     monitors the change moves to the template the policy was pointed at,
 *     run as OneUptime, every monitor staying the policy's;
 *   - "networkDeviceAutoImportRuleId" / "networkDeviceAutoImportRuleName":
 *     the rule whose devices' monitors the change moves, pointing the rule
 *     at the template once they are all on it.
 *
 * Nullable columns with no default: added without rewriting a row, and
 * empty on every change made before them, as a person's change is.
 */
export class AddMonitorTemplateChangePolicyAndRule1809187801500
  implements MigrationInterface
{
  public name: string = "AddMonitorTemplateChangePolicyAndRule1809187801500";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD "networkAlertPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD "networkAlertPolicyName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD "networkDeviceAutoImportRuleId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD "networkDeviceAutoImportRuleName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP COLUMN "networkDeviceAutoImportRuleName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP COLUMN "networkDeviceAutoImportRuleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP COLUMN "networkAlertPolicyName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP COLUMN "networkAlertPolicyId"`,
    );
  }
}
