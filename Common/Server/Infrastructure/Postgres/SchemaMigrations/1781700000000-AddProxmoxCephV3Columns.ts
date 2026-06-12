import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Proxmox + Ceph V3 (Internal/Roadmap/ProxmoxCephProductsV3.md):
 *
 * 1. WI-24 backup coverage — ProxmoxCluster.guestsWithoutBackupCount
 *    (written from pve_not_backed_up_total on the WI-3 extras path) and
 *    ProxmoxResource.isBackedUp (per-guest flag derived from
 *    pve_not_backed_up_info presence: an info series carrying the
 *    guest's id means NOT covered by any backup job). Both nullable —
 *    NULL means the exporter's cluster-level backup-info collector has
 *    not reported, which is distinct from "0 uncovered guests".
 *
 * 2. WI-28 hyperconverged cross-link — nullable
 *    ProxmoxCluster.cephClusterId FK (SET NULL on delete), manually
 *    linked via the cluster's Settings page. No auto-link heuristic:
 *    pve-exporter exposes no fsid, so there is no honest join signal
 *    (contrast WI-17's Host link, which had name equality). Mirrors
 *    Host.proxmoxClusterId: SET NULL, no index.
 *
 * Columns/FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/{ProxmoxCluster,ProxmoxResource}.ts.
 */
export class AddProxmoxCephV3Columns1781700000000
  implements MigrationInterface
{
  public name = "AddProxmoxCephV3Columns1781700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // WI-24: backup coverage snapshot columns.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "guestsWithoutBackupCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "isBackedUp" boolean`,
    );

    // WI-28: ProxmoxCluster -> CephCluster cross-link (manual only).
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "cephClusterId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // WI-28: Ceph cross-link.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "cephClusterId"`,
    );

    // WI-24: backup coverage snapshot columns.
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "isBackedUp"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "guestsWithoutBackupCount"`,
    );
  }
}
