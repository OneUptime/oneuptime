import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKubernetesResourceInventory1776700000000
  implements MigrationInterface
{
  name = "AddKubernetesResourceInventory1776700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesResource" (` +
        `"_id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"deletedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"version" integer NOT NULL, ` +
        `"projectId" uuid NOT NULL, ` +
        `"kubernetesClusterId" uuid NOT NULL, ` +
        `"kind" character varying(50) NOT NULL, ` +
        `"namespaceKey" character varying(255) NOT NULL DEFAULT '', ` +
        `"name" character varying(255) NOT NULL, ` +
        `"uid" character varying(100), ` +
        `"phase" character varying(50), ` +
        `"isReady" boolean, ` +
        `"hasMemoryPressure" boolean, ` +
        `"hasDiskPressure" boolean, ` +
        `"hasPidPressure" boolean, ` +
        `"labels" jsonb, ` +
        `"annotations" jsonb, ` +
        `"ownerReferences" jsonb, ` +
        `"spec" jsonb, ` +
        `"status" jsonb, ` +
        `"lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, ` +
        `"resourceCreationTimestamp" TIMESTAMP WITH TIME ZONE, ` +
        `"createdByUserId" uuid, ` +
        `"deletedByUserId" uuid, ` +
        `CONSTRAINT "PK_KubernetesResource_id" PRIMARY KEY ("_id"))`,
    );

    // Unique upsert key. namespaceKey is NOT NULL with default '' so
    // cluster-scoped resources (Node, Namespace, PV) participate cleanly.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_k8sres_unique" ON "KubernetesResource" ("projectId", "kubernetesClusterId", "kind", "namespaceKey", "name")`,
    );

    // For counts-by-kind on the overview page.
    await queryRunner.query(
      `CREATE INDEX "IDX_k8sres_cluster_kind" ON "KubernetesResource" ("projectId", "kubernetesClusterId", "kind")`,
    );

    // For the stale-entry cleanup worker.
    await queryRunner.query(
      `CREATE INDEX "IDX_k8sres_cluster_lastSeen" ON "KubernetesResource" ("kubernetesClusterId", "lastSeenAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_k8sres_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_k8sres_cluster" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_k8sres_createdByUser" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD CONSTRAINT "FK_k8sres_deletedByUser" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // JSONB compression: shrinks spec/status ~2-3x on PG14+.
    // Fails silently on older PG versions — acceptable because the table
    // still works, just with the default pglz compression.
    try {
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "spec" SET COMPRESSION lz4`,
      );
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "status" SET COMPRESSION lz4`,
      );
      await queryRunner.query(
        `ALTER TABLE "KubernetesResource" ALTER COLUMN "annotations" SET COMPRESSION lz4`,
      );
    } catch {
      // Postgres < 14 or lz4 not available; keep default compression.
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_k8sres_deletedByUser"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_k8sres_createdByUser"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_k8sres_cluster"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP CONSTRAINT "FK_k8sres_project"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_k8sres_cluster_lastSeen"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_k8sres_cluster_kind"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_k8sres_unique"`);
    await queryRunner.query(`DROP TABLE "KubernetesResource"`);
  }
}
