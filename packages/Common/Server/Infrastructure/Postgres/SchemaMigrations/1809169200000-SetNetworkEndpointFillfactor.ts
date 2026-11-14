import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written by hand: TypeORM does not model a table's storage parameters, so
 * there is nothing to generate, and nothing for the schema drift check to
 * compare (Docs/migrations/README.md, "Storage parameters").
 *
 * Keeps a fifth of every page of "NetworkEndpoint" free when rows are placed
 * on it, so that the next update of an endpoint finds room on its own page.
 * Only an update that stays on its page can be HOT: it writes no index
 * entry, and the next read of the page reclaims the old version instead of
 * leaving it for vacuum.
 *
 * A walk's refresh of an endpoint it sees unchanged writes lastSeenAt,
 * updatedAt and the values the row already holds - and, about once a day,
 * coarseLastSeenAt. Since SwapNetworkEndpointLastSeenIndexes1809169100000
 * lastSeenAt is in no index, so every other refresh can be HOT, when its
 * page has room. At the default fillfactor of 100 a page has none: a walk
 * inserts a device's endpoints together, packed full. A walk refreshes an
 * unchanged endpoint once in fifteen minutes, on a clock offset by its MAC -
 * a third of a switch's endpoints on each five-minute poll
 * (EndpointAttachmentUtil.endpointRefreshSlot) - and a third of a page's
 * rows need a quarter of the page: a fifth, and the room their dead versions
 * leave, is enough.
 *
 * Measured in NetworkEndpointWritesPostgres: see the numbers there.
 *
 * SET (fillfactor) takes SHARE UPDATE EXCLUSIVE, which no read or write
 * waits for, and rewrites nothing: an update that does not fit on its page
 * moves its row to a page that keeps the room free, so the table settles
 * into it as walks write it.
 */
export class SetNetworkEndpointFillfactor1809169200000
  implements MigrationInterface
{
  public name: string = "SetNetworkEndpointFillfactor1809169200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" SET (fillfactor = 80)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "NetworkEndpoint" RESET (fillfactor)`);
  }
}
