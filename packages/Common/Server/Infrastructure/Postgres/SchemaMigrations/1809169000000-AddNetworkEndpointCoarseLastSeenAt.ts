import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #8092) after
 * NetworkEndpoint gained coarseLastSeenAt: lastSeenAt a day at a time, which
 * the age-out of discovered devices finds its candidates by, so that
 * lastSeenAt can leave every index and a walk's refresh of it can be a HOT
 * update. The index statements went to
 * SwapNetworkEndpointLastSeenIndexes1809169100000, which builds and drops
 * them online.
 *
 * Nullable, with no default: adding it rewrites nothing. A walk writes it
 * from an endpoint's next refresh on, and the data migration
 * BackfillNetworkEndpointCoarseLastSeenAt copies lastSeenAt into it for the
 * rest.
 */
export class AddNetworkEndpointCoarseLastSeenAt1809169000000
  implements MigrationInterface
{
  public name: string = "AddNetworkEndpointCoarseLastSeenAt1809169000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "coarseLastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "coarseLastSeenAt"`,
    );
  }
}
