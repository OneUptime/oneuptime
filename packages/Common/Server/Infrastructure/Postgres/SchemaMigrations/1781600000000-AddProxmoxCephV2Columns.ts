import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Proxmox + Ceph V2 (Internal/Roadmap/ProxmoxCephProductsV2.md):
 *
 * 1. WI-3 snapshot columns — ProxmoxCluster.onlineNodeCount and
 *    CephCluster.healthStatus (0 = OK / 1 = WARN / 2 = ERR), osdUpCount,
 *    osdInCount, capacityUsedPercent. Written by the metrics-ingest
 *    snapshot scan via updateLastSeen extras so list pages never hit
 *    ClickHouse.
 *
 * 2. WI-2 race defense — DB-level unique indexes on (projectId, name)
 *    for both cluster tables. The v1 migration (1781500000000) only
 *    created the app-level @UniqueColumnBy check plus a non-unique name
 *    index; without the DB index, concurrent find-or-create at ingest
 *    (multiple agent pods) can insert duplicate rows — the exact bug the
 *    KubernetesCluster dedupe migration (1776881254913) had to clean up.
 *    Both migrations ship in the same release and the v1 tables cannot
 *    have accumulated duplicates between them, so no dedupe step is
 *    needed here.
 *
 * 3. WI-6 child-resource inventory tables — ProxmoxResource and
 *    CephResource, cloned from the KubernetesResource shape (unique
 *    identity index, denormalized latest-metric columns, not
 *    user-writable). externalId is the pve `id` label (node/pve1,
 *    qemu/100, storage/local) or the ceph_daemon / pool_id label.
 *
 * 4. WI-17 — nullable Host.proxmoxClusterId FK (SET NULL), the
 *    guest-VM → Host cross-link, cloned from Host.kubernetesClusterId.
 *
 * Columns/indexes/FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/{ProxmoxCluster,CephCluster,
 * ProxmoxResource,CephResource,Host}.ts.
 */
export class AddProxmoxCephV2Columns1781600000000
  implements MigrationInterface
{
  public name = "AddProxmoxCephV2Columns1781600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // WI-3: snapshot columns on the cluster tables.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "onlineNodeCount" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "osdUpCount" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "osdInCount" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "healthStatus" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "capacityUsedPercent" numeric`,
    );

    /*
     * WI-2: DB-level unique indexes (the concurrent find-or-create race
     * defense — see file comment).
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_cluster_projectId_name" ON "ProxmoxCluster" ("projectId", "name")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_cluster_projectId_name" ON "CephCluster" ("projectId", "name")`,
    );

    // WI-6: Proxmox resource inventory table.
    await queryRunner.query(
      `CREATE TABLE "ProxmoxResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "vmid" integer, "guestType" character varying(100), "parentNodeName" character varying(100), "isUp" boolean, "haState" character varying(100), "onboot" boolean, "uptimeSeconds" integer, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "maxMemoryBytes" bigint, "latestMemoryPercent" numeric, "latestDiskBytes" bigint, "maxDiskBytes" bigint, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_proxmox_resource_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_resource_projectId" ON "ProxmoxResource" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_resource_proxmoxClusterId" ON "ProxmoxResource" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_resource_identity" ON "ProxmoxResource" ("projectId", "proxmoxClusterId", "kind", "externalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // WI-6: Ceph resource inventory table.
    await queryRunner.query(
      `CREATE TABLE "CephResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "hostname" character varying(100), "daemonVersion" character varying(100), "deviceClass" character varying(100), "isUp" boolean, "isIn" boolean, "inQuorum" boolean, "statBytes" bigint, "statBytesUsed" bigint, "applyLatencyMs" numeric, "commitLatencyMs" numeric, "pgCount" integer, "storedBytes" bigint, "maxAvailBytes" bigint, "objects" bigint, "readOpsCounter" bigint, "writeOpsCounter" bigint, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ceph_resource_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_resource_projectId" ON "CephResource" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_resource_cephClusterId" ON "CephResource" ("cephClusterId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_resource_identity" ON "CephResource" ("projectId", "cephClusterId", "kind", "externalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /*
     * WI-17: optional Host -> ProxmoxCluster cross-link (guest VMs running
     * the host agent). Mirrors Host.kubernetesClusterId: SET NULL, no index.
     */
    await queryRunner.query(`ALTER TABLE "Host" ADD "proxmoxClusterId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_host_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // WI-17: Host cross-link.
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_host_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "proxmoxClusterId"`,
    );

    // WI-6: Ceph resource inventory table.
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_resource_identity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_resource_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_resource_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "CephResource"`);

    // WI-6: Proxmox resource inventory table.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_identity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxResource"`);

    // WI-2: unique indexes.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_projectId_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_projectId_name"`,
    );

    // WI-3: snapshot columns.
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "capacityUsedPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "healthStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "osdInCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "osdUpCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "onlineNodeCount"`,
    );
  }
}
