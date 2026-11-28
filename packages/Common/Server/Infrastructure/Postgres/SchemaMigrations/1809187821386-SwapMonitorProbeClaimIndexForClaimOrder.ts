import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #11386) after
 * the MonitorProbe model's scheduler index gained "lastPingAt".
 *
 * A probe's claim (MonitorProbeService.claimMonitorProbesForProbing) hands
 * out the rows due at the same moment by when each was last handed out,
 * oldest first, so a busy probe hands out its monitors in the same order
 * every minute and the ones it reached after the minute go first next time.
 * It reads them from ("probeId", "isEnabled", "nextPingAt", "lastPingAt")
 * in that order, so it still sorts nothing; ("probeId", "isEnabled",
 * "nextPingAt") leads with the same columns and serves nothing the new one
 * does not, so it goes. Every claim writes both columns already, so no
 * write that was HOT stops being HOT.
 *
 * Online, outside a transaction: every probe's claims write the table all
 * the time. The new index is built before the old one goes, so the claim
 * always has one. Safe to run again after a stop part way.
 */
export class SwapMonitorProbeClaimIndexForClaimOrder1809187821386
  implements MigrationInterface
{
  public name: string = "SwapMonitorProbeClaimIndexForClaimOrder1809187821386";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d9a0169b03234c77c5c66d0217" ON "MonitorProbe" ("probeId", "isEnabled", "nextPingAt", "lastPingAt") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4bf4109d325af5e5b5a5665bc7"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the build
   * is a plain one, with the old index's columns in its own order (the
   * generator writes them in the table's: "probeId", "nextPingAt",
   * "isEnabled"). The old index comes back before the new one goes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_4bf4109d325af5e5b5a5665bc7" ON "MonitorProbe" ("probeId", "isEnabled", "nextPingAt") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d9a0169b03234c77c5c66d0217"`,
    );
  }
}
