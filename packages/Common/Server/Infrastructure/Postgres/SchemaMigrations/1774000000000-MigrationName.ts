import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774000000000 implements MigrationInterface {
  public name = "MigrationName1774000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesCluster" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "clusterIdentifier" character varying(100) NOT NULL, "provider" character varying(100) DEFAULT 'unknown', "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "nodeCount" integer DEFAULT '0', "podCount" integer DEFAULT '0', "namespaceCount" integer DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_kubernetes_cluster_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kubernetes_cluster_projectId" ON "KubernetesCluster" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kubernetes_cluster_clusterIdentifier" ON "KubernetesCluster" ("clusterIdentifier")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_kubernetes_cluster_slug" ON "KubernetesCluster" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_kubernetes_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Label join table
    await queryRunner.query(
      `CREATE TABLE "KubernetesClusterLabel" ("kubernetesClusterId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_kubernetes_cluster_label" PRIMARY KEY ("kubernetesClusterId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kubernetes_cluster_label_clusterId" ON "KubernetesClusterLabel" ("kubernetesClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kubernetes_cluster_label_labelId" ON "KubernetesClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_kubernetes_cluster_label_clusterId" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabel" ADD CONSTRAINT "FK_kubernetes_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_kubernetes_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesClusterLabel" DROP CONSTRAINT "FK_kubernetes_cluster_label_clusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kubernetes_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kubernetes_cluster_label_clusterId"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesClusterLabel"`);
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_kubernetes_cluster_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kubernetes_cluster_slug"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kubernetes_cluster_clusterIdentifier"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_kubernetes_cluster_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesCluster"`);
  }
}
