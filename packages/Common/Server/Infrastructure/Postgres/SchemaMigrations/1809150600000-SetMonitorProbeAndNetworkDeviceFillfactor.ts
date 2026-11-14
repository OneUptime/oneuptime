import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written by hand (issue #7921): TypeORM does not model a table's storage
 * parameters, so there is nothing to generate, and nothing for the schema
 * drift check to compare.
 *
 * Keeps a tenth of every page of "MonitorProbe" and "NetworkDevice" free
 * when rows are placed on it, so that the next update of a row finds room
 * on the row's own page. Only an update that stays on its page can be HOT:
 * it writes no index entry, and the next read of the page reclaims the old
 * version instead of leaving it for vacuum. Both tables are rewritten all
 * day - each monitor probe's result is stored over it every minute, each
 * poll writes a device's verdict and rate baseline - and at the default
 * fillfactor of 100 a page often has no room left for that.
 *
 * Measured on seeded tables, a minute of probing at a time: at 90 every
 * probe result stored over a MonitorProbe row was HOT (49.9% of the
 * table's updates, against 44.2% at 100; the claims, the other half, never
 * can be), and NetworkDevice's HOT updates went from 50.7% to 55.2%. That
 * is about 10% fewer index entries written on each table, for 6-12% more
 * heap.
 *
 * SET (fillfactor) takes SHARE UPDATE EXCLUSIVE, which no read or write
 * waits for, and rewrites nothing: an update that does not fit on its page
 * moves its row to a page that keeps the tenth free, so the tables settle
 * into it as they are updated.
 */
export class SetMonitorProbeAndNetworkDeviceFillfactor1809150600000
  implements MigrationInterface
{
  public name: string =
    "SetMonitorProbeAndNetworkDeviceFillfactor1809150600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "MonitorProbe" SET (fillfactor = 90)`);
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" SET (fillfactor = 90)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "NetworkDevice" RESET (fillfactor)`);
    await queryRunner.query(`ALTER TABLE "MonitorProbe" RESET (fillfactor)`);
  }
}
