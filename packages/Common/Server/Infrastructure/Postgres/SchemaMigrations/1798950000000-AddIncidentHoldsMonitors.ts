import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Incident.holdsMonitors records whether an incident holds its monitors -
 * keeps them in its monitor status, or their monitoring paused - so that
 * resolving it gives back only what it holds. An incident declared open
 * holds them; one declared already resolved never does, so resolving it
 * again after a reopen no longer flips monitors it never touched back to
 * operational.
 *
 * Nullable with no default: every incident already stored has none, and
 * reads as "not known" - its next resolve gives its monitors back as it
 * always did, and records that it holds nothing from then on. Nothing is
 * backfilled: the timeline alone cannot tell which of them held their
 * monitors.
 */
export class AddIncidentHoldsMonitors1798950000000
  implements MigrationInterface
{
  public name: string = "AddIncidentHoldsMonitors1798950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "holdsMonitors" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "holdsMonitors"`,
    );
  }
}
