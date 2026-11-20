import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The index Connected Signals finds a cloud resource by its own ID with
 * (#10034, #10033): the cloud resource a security event names - an ARN, an
 * Azure resource ID, a Google Cloud full resource name - and the one whose
 * own logs an event was read from (oneuptime.log.cloud.resource_id).
 *
 * WHAT IT SERVES
 *
 * SecurityConnectedRecords looks each ID up as
 *
 *   WHERE "projectId" = $1 AND LOWER("providerResourceId") IN (...)
 *
 * (QueryHelper.findWithSameTextAnyOf): an Azure resource ID matches
 * whatever case its writer chose - Azure compares IDs without case - and
 * the rows it returns are then held to each cloud's own rule in
 * SecurityConnectionMatch.matchResourceId, so an ARN or a Google Cloud name
 * of another case is no match. Without an index on the expression, each
 * lookup read every cloud resource of the project and lowered its ID: only
 * the projectId index applied, and a project's cloud accounts can list tens
 * of thousands of resources.
 *
 * WHY A HASH INDEX ON THE EXPRESSION
 *
 *   - LOWER(...): what the lookup compares, so the planner can use it.
 *   - USING hash: the lookup only ever asks for equality (= ANY), which a
 *     hash index answers, and a hash index stores a hash of each ID, never
 *     the ID itself: providerResourceId is unbounded text, and a b-tree
 *     entry past about 2,700 bytes fails the insert that makes it - ingest
 *     writes these rows. The rows it finds are filtered by project.
 *
 * WHY HAND-WRITTEN
 *
 * @Index() cannot express LOWER() or USING hash, so the generator can
 * neither write nor round-trip this index (as with the Service LOWER(name)
 * index, 1786100000000). CloudResource declares it by name with
 * synchronize: false (UnsynchronizedIndex), so the schema builder never
 * drops it and never tries to create it: the drift check finds nothing.
 *
 * ONLINE
 *
 * CloudResource already holds data, and ingest writes it all the time
 * (each resource's sighting, each inventory listing), so the index is built
 * CONCURRENTLY (OnlineDdl, Docs/migrations/README.md), blocking no read or
 * write, outside a transaction. Safe to run again after a stop part way:
 * OnlineDdl rebuilds an index a stopped build left INVALID. An update that
 * leaves providerResourceId as it is - a sighting's lastSeenAt - can still
 * be HOT.
 */
export class AddCloudResourceProviderResourceIdIndex1809186900000
  implements MigrationInterface
{
  public name: string = "AddCloudResourceProviderResourceIdIndex1809186900000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_CLOUD_RESOURCE_LOWER_PROVIDER_RESOURCE_ID" ON "CloudResource" USING hash (LOWER("providerResourceId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_CLOUD_RESOURCE_LOWER_PROVIDER_RESOURCE_ID"`,
    );
  }
}
