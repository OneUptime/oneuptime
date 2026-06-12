import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Proxmox + Ceph monitoring products (Internal/Roadmap/ProxmoxCephProducts.md):
 * one table per product, cloned from the DockerHost shape. A row per
 * monitored cluster, auto-discovered at OTel ingest from the
 * `proxmox.cluster.name` / `ceph.cluster.name` resource attributes (the
 * `name` column is the join key — unlike DockerHost there is no separate
 * identifier column) or manually registered. Columns/indexes/FKs are derived
 * from the model decorators in Common/Models/DatabaseModels/ProxmoxCluster.ts
 * and CephCluster.ts.
 */
export class AddProxmoxAndCephClusterTables1781500000000
  implements MigrationInterface
{
  public name = "AddProxmoxAndCephClusterTables1781500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Proxmox cluster table.
    await queryRunner.query(
      `CREATE TABLE "ProxmoxCluster" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "pveVersion" character varying(500), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "nodeCount" integer DEFAULT '0', "guestCount" integer DEFAULT '0', "storageCount" integer DEFAULT '0', "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_proxmox_cluster_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_projectId" ON "ProxmoxCluster" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_name" ON "ProxmoxCluster" ("name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_cluster_slug" ON "ProxmoxCluster" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Proxmox cluster label join table.
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterLabel" ("proxmoxClusterId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_proxmox_cluster_label" PRIMARY KEY ("proxmoxClusterId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_proxmoxClusterId" ON "ProxmoxClusterLabel" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_labelId" ON "ProxmoxClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_proxmox_cluster_label_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_proxmox_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Ceph cluster table.
    await queryRunner.query(
      `CREATE TABLE "CephCluster" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "fsid" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "cephVersion" character varying(500), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "monCount" integer DEFAULT '0', "osdCount" integer DEFAULT '0', "poolCount" integer DEFAULT '0', "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ceph_cluster_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_projectId" ON "CephCluster" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_name" ON "CephCluster" ("name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_cluster_slug" ON "CephCluster" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Ceph cluster label join table.
    await queryRunner.query(
      `CREATE TABLE "CephClusterLabel" ("cephClusterId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ceph_cluster_label" PRIMARY KEY ("cephClusterId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_cephClusterId" ON "CephClusterLabel" ("cephClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_labelId" ON "CephClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_ceph_cluster_label_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_ceph_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ceph cluster label join table.
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_ceph_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_ceph_cluster_label_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_cephClusterId"`,
    );
    await queryRunner.query(`DROP TABLE "CephClusterLabel"`);

    // Ceph cluster table.
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_cluster_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_cluster_name"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "CephCluster"`);

    // Proxmox cluster label join table.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_proxmox_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_proxmox_cluster_label_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_proxmoxClusterId"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxClusterLabel"`);

    // Proxmox cluster table.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_proxmox_cluster_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_proxmox_cluster_name"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxCluster"`);
  }
}
