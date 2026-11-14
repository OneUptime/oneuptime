import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #7921) after
 * the bare @Index() on MonitorProbe.probeId and MonitorProbe.monitorId came
 * off the model. Every probe claim moves a monitor probe's "nextPingAt",
 * which is indexed, so every claim writes a new entry into every index on
 * the table. These two repeated the leading column of another index -
 * ("probeId", "isEnabled", "nextPingAt"), and ("monitorId", "probeId") /
 * ("monitorId", "projectId") - which serve every read by that column and
 * the ON DELETE CASCADE of a monitor or a probe just as well, so they cost
 * every claim two of its seven index writes for nothing.
 *
 * Dropped online (DROP INDEX CONCURRENTLY), outside a transaction: probes
 * claim and store results on "MonitorProbe" all the time, and a plain DROP
 * INDEX would queue every one of them behind it. Safe to run again after a
 * stop part way: an index already gone is left gone.
 */
export class DropRedundantMonitorProbeIndexes1809151000000
  implements MigrationInterface
{
  public name: string = "DropRedundantMonitorProbeIndexes1809151000000";

  // DROP INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2d50a0e0e624369e7f90a62e8d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a540272f483ef1de68f7e64748"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are the generated ones.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_a540272f483ef1de68f7e64748" ON "MonitorProbe" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d50a0e0e624369e7f90a62e8d" ON "MonitorProbe" ("probeId") `,
    );
  }
}
