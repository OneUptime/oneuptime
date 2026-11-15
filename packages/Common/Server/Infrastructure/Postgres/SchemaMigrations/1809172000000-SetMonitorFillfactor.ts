import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written by hand (issue #8095): TypeORM does not model a table's storage
 * parameters, so there is nothing to generate, and nothing for the schema
 * drift check to compare.
 *
 * Keeps a tenth of every page of "Monitor" free when rows are placed on it,
 * so that the next update of a row finds room on the row's own page. Only
 * an update that stays on its page can be HOT: it writes no index entry,
 * and the next read of the page reclaims the old version instead of leaving
 * it for vacuum. Since MatchMonitorIndexesToTheirReads1809165000000 no index
 * names a column the busiest writes move - the telemetry sweep's stamps,
 * the incoming request and email heartbeats, each server report - so room
 * on the page is all those writes still need to be HOT.
 *
 * Measured on a seeded table of 60,000 monitors, a simulated minute of those
 * writes plus 0.2% of monitors changing status, VACUUM after each, minutes
 * 2 to 10: HOT updates went from 84.3% to 95.3% (the status changes, which
 * move the indexed currentMonitorStatusId, never can be), non-HOT updates
 * from 1,518 to 449 a minute, dead row versions from 1,708 to 1,043 a
 * minute, WAL from 18.5 to 17.2 MiB a minute; 8% more heap.
 *
 * SET (fillfactor) takes SHARE UPDATE EXCLUSIVE, which no read or write
 * waits for, and rewrites nothing: an update that does not fit on its page
 * moves its row to a page that keeps the room free, so the table settles
 * into it as it is updated.
 */
export class SetMonitorFillfactor1809172000000 implements MigrationInterface {
  public name: string = "SetMonitorFillfactor1809172000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Monitor" SET (fillfactor = 90)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Monitor" RESET (fillfactor)`);
  }
}
