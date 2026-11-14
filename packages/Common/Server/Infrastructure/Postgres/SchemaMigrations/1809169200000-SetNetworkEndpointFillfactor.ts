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
 * Measured (NetworkEndpointWritesPostgres: 16 switches of 48 endpoints, two
 * hours of five-minute polls, a VACUUM after each): of the walks' refreshes,
 * 99.9% were HOT in the second hour at 80 (96.6% in the first, as the table
 * settled into its room), 99.7% at 90 (85.1%) and 93.6% at the default of
 * 100 (67.4%). The indexes did not grow, and an hour wrote 0.8 MiB of WAL.
 * As the walk wrote them before - every endpoint of a switch every other
 * poll, with lastSeenAt indexed, at 100 - none was, the indexes grew by 91%
 * in the hour, and it wrote 4.6 MiB.
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
