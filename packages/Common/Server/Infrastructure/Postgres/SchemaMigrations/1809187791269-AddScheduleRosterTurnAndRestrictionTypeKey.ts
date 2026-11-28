import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * OnCallDutyPolicySchedule.rosterTurnKey (#11270): the rotation turn a
 * schedule's roster is in, kept between the windows of a layer's active
 * hours, so the person whose turn it is hears "You are now on-call" when it
 * starts and "You are no longer on-call" when it ends, not at every window.
 * The server's alone; empty for every schedule until its roster next moves.
 *
 * And the default restriction times of a new on-call schedule layer, with
 * the restriction type under its name, restrictionType, as every layer's
 * is stored from now on (#11269). The older spelling, restictionType, is
 * still read.
 *
 * A nullable column with no default, and a column default changed: neither
 * rewrites a row, and each holds its table's lock for an instant
 * (Docs/migrations/README.md).
 */
export class AddScheduleRosterTurnAndRestrictionTypeKey1809187791269
  implements MigrationInterface
{
  public name: string =
    "AddScheduleRosterTurnAndRestrictionTypeKey1809187791269";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "rosterTurnKey" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restrictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "rosterTurnKey"`,
    );
  }
}
