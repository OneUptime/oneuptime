import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddKubernetesResourceHealthSeverity1808780000000, and moved into a
 * migration of its own: "KubernetesResource" already holds every cluster's
 * inventory, and the agent rewrites it every five minutes, so its new index
 * is built online, without blocking those writes. Safe to run again after a
 * stop part way: an index that is already there is left as it is.
 *
 *   - a partial index of the objects that need attention, which a cluster's
 *     Overview reads every time it refreshes (getNeedsAttention): it holds
 *     those few rows only.
 */
export class AddKubernetesResourceHealthSeverityIndex1808790000000
  implements MigrationInterface
{
  public name: string = "AddKubernetesResourceHealthSeverityIndex1808790000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f66e3c6498c4e546755c7cc6ed" ON "KubernetesResource" ("kubernetesClusterId") WHERE "healthSeverity" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f66e3c6498c4e546755c7cc6ed"`,
    );
  }
}
