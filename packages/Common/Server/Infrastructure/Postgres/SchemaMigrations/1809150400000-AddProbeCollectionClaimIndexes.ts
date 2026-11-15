import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated for the models (TypeORM's migration:generate statements): the
 * indexes the probes' OpenStack check and data store claims read in order
 * (OneUptime issue #7919).
 *
 * A probe claims its due OpenStack checks of each kind every ten seconds,
 * and its data stores' table collections and content scans every five
 * minutes, oldest first: `due <= now ORDER BY due LIMIT n`. Each is a range
 * of one of these, which stops at the claim's limit. OpenStackCloudCheck
 * had a single-column index on probeId, and DataStore single-column ones on
 * scanProbeId and each due column, so every claim read and sorted all of a
 * probe's due rows - and the OpenStack check claim, which matched its probe
 * with a COALESCE across two tables, every check of every project.
 *
 * Both tables already hold data, so the indexes are built online
 * (Docs/migrations/README.md): CONCURRENTLY, blocking no read or write.
 * Names and definitions are the generated ones, so the drift check still
 * matches.
 */
export class AddProbeCollectionClaimIndexes1809150400000
  implements MigrationInterface
{
  public name: string = "AddProbeCollectionClaimIndexes1809150400000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_7e8835d5f6bcdd48650485e16d" ON "OpenStackCloudCheck" ("probeId", "nextLifecycleCheckAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_2642d786f1ea9e8c99548d14de" ON "OpenStackCloudCheck" ("probeId", "nextApiCheckAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d16db6fe6b4a4248de1516669f" ON "DataStore" ("scanProbeId", "nextContentScanAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_80db6f55b33c8a5f4d6c05b5ac" ON "DataStore" ("scanProbeId", "nextTableHealthCollectionAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_80db6f55b33c8a5f4d6c05b5ac"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d16db6fe6b4a4248de1516669f"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2642d786f1ea9e8c99548d14de"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_7e8835d5f6bcdd48650485e16d"`,
    );
  }
}
