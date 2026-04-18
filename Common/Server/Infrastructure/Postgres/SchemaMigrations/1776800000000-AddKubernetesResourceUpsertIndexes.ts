import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The KubernetesResource table itself is created by the auto-generated
 * MigrationName1776455442241. This follow-up adds what that migration
 * doesn't cover but the inventory ingest pipeline depends on:
 *
 *   1. UNIQUE composite index (projectId, kubernetesClusterId, kind,
 *      namespaceKey, name) — required by bulkUpsert's ON CONFLICT.
 *   2. Composite index on (projectId, kubernetesClusterId, kind) for
 *      the overview summary's GROUP BY kind.
 *   3. Composite index on (kubernetesClusterId, lastSeenAt) for the
 *      cleanup worker's stale-row scan.
 *   4. LZ4 compression on the large JSONB columns to keep storage
 *      reasonable for clusters with many pods.
 */
export class AddKubernetesResourceUpsertIndexes1776800000000
  implements MigrationInterface
{
  public name = "AddKubernetesResourceUpsertIndexes1776800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_k8sres_unique" ON "KubernetesResource" ("projectId", "kubernetesClusterId", "kind", "namespaceKey", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_k8sres_cluster_kind" ON "KubernetesResource" ("projectId", "kubernetesClusterId", "kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_k8sres_cluster_lastSeen" ON "KubernetesResource" ("kubernetesClusterId", "lastSeenAt")`,
    );

    /*
     * JSONB compression (Postgres 14+ with lz4 build). Swallow per-column
     * failures so older PG builds keep the default pglz compression.
     */
    try {
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "spec" SET COMPRESSION lz4`,
      );
    } catch {
      /* compression not supported — table still works */
    }
    try {
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "status" SET COMPRESSION lz4`,
      );
    } catch {
      /* compression not supported */
    }
    try {
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "annotations" SET COMPRESSION lz4`,
      );
    } catch {
      /* compression not supported */
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_k8sres_cluster_lastSeen"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_k8sres_cluster_kind"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_k8sres_unique"`);
    // Compression settings remain — no-op on down.
  }
}
