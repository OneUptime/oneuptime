import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. The index and the foreign key it generated
 * with these are built online in AddOnCallFireDrillResultsIndexAndKey
 * 1809183110000.
 *
 * A monitor's fire drill keeps its results (#9386, Types/OnCallDutyPolicy/
 * OnCallFireDrill): each policy's test it starts says which drill
 * (testPageFireDrillId, the same on every test it started), the monitor
 * whose failure it rehearsed (testPageFireDrillMonitorId) and that failure
 * as the drill's dialog named it (testPageFireDrillFailure). The monitor's
 * When this goes down card reads its last drill from them, and the run's row
 * in the policy's execution logs says it was part of one.
 *
 * Three nullable columns on an existing table, with no default: adding
 * them rewrites nothing and blocks nothing, and every run that exists was
 * no fire drill's. A server of the release before ignores them, and one of
 * this release reads a run without them as a test of its own.
 */
export class AddOnCallFireDrillResults1809183100000
  implements MigrationInterface
{
  public name: string = "AddOnCallFireDrillResults1809183100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "testPageFireDrillId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "testPageFireDrillMonitorId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "testPageFireDrillFailure" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "testPageFireDrillFailure"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "testPageFireDrillMonitorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "testPageFireDrillId"`,
    );
  }
}
