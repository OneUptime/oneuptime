import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddDiscoveredDeviceRetention1809080363890, and moved into a migration of
 * its own: "NetworkEndpoint" holds every device a project's switches,
 * routers and network controllers have seen, and their walks write to it
 * every few minutes, so its new index is built online, without blocking
 * those writes. Safe to run again after a stop part way: an index that is
 * already there is left as it is.
 *
 *   - a project's live devices by when they were last seen, which the job
 *     that removes the devices no longer seen reads (DiscoveredDeviceAgeOut):
 *     whether a project has any due, the oldest first, and the switches that
 *     saw anything lately.
 */
export class AddNetworkEndpointLastSeenIndex1809080363891
  implements MigrationInterface
{
  public name: string = "AddNetworkEndpointLastSeenIndex1809080363891";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_aabb790d91b44c32192ba02414" ON "NetworkEndpoint" ("projectId", "lastSeenAt") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_aabb790d91b44c32192ba02414"`,
    );
  }
}
