import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written by hand: TypeORM does not model a table's storage parameters, so
 * there is nothing to generate, and nothing for the schema drift check to
 * compare (Docs/migrations/README.md, "Storage parameters").
 *
 * Keeps a fifth of every page of "NetworkInterface" free when rows are
 * placed on it, so that the next update of an interface finds room on its
 * own page. Only an update that stays on its page can be HOT: it writes no
 * index entry, and the next read of the page reclaims the old version
 * instead of leaving it for vacuum.
 *
 * A device walk writes an interface's name, alias, MAC, type, states, speed,
 * rates and lastSeenAt - none of them in an index on the table, nor in the
 * unique index's predicate ("deletedAt") - so every walk's update can be
 * HOT, when its page has room. At the default fillfactor of 100 a page has
 * none: the walk inserts a device's interfaces together, packed full. A
 * walk now writes an interface only when it changed, or once in fifteen
 * minutes - a third of a switch's ports on each five-minute poll
 * (InterfaceInventoryUtil.needsWrite) - and those writes are the table's
 * whole update load. A third of a page's rows need a quarter of the page:
 * a fifth, and the room their dead versions leave, is enough.
 *
 * Measured on a seeded table (100 switches of 48 ports, three hours of
 * five-minute polls, a VACUUM after each): 99.6% of the walks' updates
 * HOT at 80, 92.2% at the default of 100, 98.9% at 75 and 99.9% at 70 for
 * a larger heap; WAL and heap stayed as they were at 80. Writing every port
 * on every poll at 100, as walks did, 12.1% were.
 *
 * SET (fillfactor) takes SHARE UPDATE EXCLUSIVE, which no read or write
 * waits for, and rewrites nothing: an update that does not fit on its page
 * moves its row to a page that keeps the room free, so the table settles
 * into it as walks write it.
 */
export class SetNetworkInterfaceFillfactor1809164000000
  implements MigrationInterface
{
  public name: string = "SetNetworkInterfaceFillfactor1809164000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" SET (fillfactor = 80)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkInterface" RESET (fillfactor)`,
    );
  }
}
