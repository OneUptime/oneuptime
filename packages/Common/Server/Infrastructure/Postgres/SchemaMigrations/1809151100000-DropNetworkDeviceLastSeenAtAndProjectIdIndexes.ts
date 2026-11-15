import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #7921) after
 * the NetworkDevice model's Status index lost "lastSeenAt" and its bare
 * "projectId" index went.
 *
 * Every poll that reaches a device moves its "lastSeenAt", and an update
 * that changes a column any index names cannot be HOT: it writes an entry
 * into every index on the table and leaves a dead one in each for vacuum.
 * ("projectId", "isArchived", "isReachable", "lastSeenAt") made every
 * reachable poll's verdict such an update. ("projectId", "isArchived",
 * "isReachable") still serves the Status facet and the summary strip's
 * counts, and the Overview's longest-out-of-contact list sorts the
 * project's down devices instead of reading them in index order. The bare
 * ("projectId") repeated the leading column of five composites, which
 * serve every read by it and the ON DELETE CASCADE of a project.
 *
 * Online, outside a transaction: probes claim and write devices all the
 * time. The new index is built before the old one goes, so the Status
 * reads always have one. Safe to run again after a stop part way.
 */
export class DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000
  implements MigrationInterface
{
  public name: string =
    "DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_2eb97a5af768174a679a32b011" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_87566f1ca6cc63ee3afd3aeaff"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_013b5e41b9038b20bb5d5eb419"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are plain ones. The old indexes come back before the new one
   * goes. The generator wrote the old Status index's columns in the table's
   * order; this is the order the index had (AddNetworkScaleIndexes).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_013b5e41b9038b20bb5d5eb419" ON "NetworkDevice" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87566f1ca6cc63ee3afd3aeaff" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "lastSeenAt") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2eb97a5af768174a679a32b011"`,
    );
  }
}
