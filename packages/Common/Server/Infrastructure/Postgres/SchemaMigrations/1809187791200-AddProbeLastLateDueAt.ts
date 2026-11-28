import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written to match what TypeORM's migration:generate writes for the model
 * (AddProbeDevicePollsLate1809183760000 is its output for columns of the
 * same type), and numbered after the last registered migration; the
 * Postgres Schema Drift check holds it to the model.
 *
 * Saying how far behind a probe is ("Behind by 15 minutes",
 * Types/Probe/ProbeBehind), not only since when: when its longest-waiting
 * monitor check, and network device poll, was due at the latest reading
 * that found one late, beside the times those readings keep. Two nullable
 * columns on Probe, no default, no index, nothing backfilled: a server of
 * the release before ignores them, and one of this release reads null as
 * "behind, by how much not known yet" until the probe's next reading.
 */
export class AddProbeLastLateDueAt1809187791200 implements MigrationInterface {
  public name: string = "AddProbeLastLateDueAt1809187791200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "checksLastLateDueAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "devicePollsLastLateDueAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "devicePollsLastLateDueAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "checksLastLateDueAt"`,
    );
  }
}
