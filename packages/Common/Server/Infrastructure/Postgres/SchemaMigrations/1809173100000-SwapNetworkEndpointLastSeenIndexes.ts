import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #8092) after
 * the NetworkEndpoint model's age-out index moved from lastSeenAt to
 * coarseLastSeenAt and lastSeenAt lost its own index.
 *
 * A walk refreshes the lastSeenAt of every endpoint it still sees, and an
 * update that changes a column any index names cannot be HOT: it writes an
 * entry into every index on the table - nine here - and leaves a dead one in
 * each for vacuum. lastSeenAt was the only indexed column such a refresh
 * moved, in two indexes:
 *
 *   - ("lastSeenAt"), the column's own, which no read uses: every read of
 *     lastSeenAt names a project;
 *   - ("projectId", "lastSeenAt") of live rows, the age-out's
 *     (DiscoveredDeviceAgeOut, #6389), which needs no more than the day:
 *     ("projectId", "coarseLastSeenAt") of live rows takes its place, and
 *     coarseLastSeenAt moves about once a day an endpoint.
 *
 * Online, outside a transaction: walks write endpoints all the time. The
 * new index is built before the old ones go, so the age-out always has one.
 * Safe to run again after a stop part way.
 */
export class SwapNetworkEndpointLastSeenIndexes1809173100000
  implements MigrationInterface
{
  public name: string = "SwapNetworkEndpointLastSeenIndexes1809173100000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_77cdf39f743efdfd5bcf4288de" ON "NetworkEndpoint" ("projectId", "coarseLastSeenAt") WHERE "deletedAt" IS NULL`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_aabb790d91b44c32192ba02414"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_7c40f683dcf5ec9bb68ffe32e1"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are plain ones. The old indexes come back before the new one
   * goes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_7c40f683dcf5ec9bb68ffe32e1" ON "NetworkEndpoint" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aabb790d91b44c32192ba02414" ON "NetworkEndpoint" ("projectId", "lastSeenAt") WHERE ("deletedAt" IS NULL)`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_77cdf39f743efdfd5bcf4288de"`,
    );
  }
}
