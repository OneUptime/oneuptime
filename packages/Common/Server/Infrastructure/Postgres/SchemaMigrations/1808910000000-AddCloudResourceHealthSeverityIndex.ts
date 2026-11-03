import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddCloudCostsAndResourceHealth1808900000000, and moved into a migration
 * of its own: "CloudResource" holds every connected account's inventory,
 * which each cloud connection rewrites as it reads, so its new index is
 * built online, without blocking those writes. Safe to run again after a
 * stop part way: an index that is already there is left as it is.
 *
 *   - a partial index of the resources whose key metrics show something
 *     wrong, which the Cloud Overview and an account's Overview read every
 *     minute (Needs attention): it holds those few rows only.
 */
export class AddCloudResourceHealthSeverityIndex1808910000000
  implements MigrationInterface
{
  public name: string = "AddCloudResourceHealthSeverityIndex1808910000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_349ade4ce32be3110063cfd4a1" ON "CloudResource" ("projectId") WHERE "healthSeverity" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_349ade4ce32be3110063cfd4a1"`,
    );
  }
}
