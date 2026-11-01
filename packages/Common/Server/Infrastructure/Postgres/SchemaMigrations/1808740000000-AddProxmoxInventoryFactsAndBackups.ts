import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What a Proxmox admin reads on a cluster's, node's, guest's and storage's
 * page, beyond a name and a status:
 *   - "ProxmoxCluster": whether the cluster reports quorum, and when Proxmox
 *     VE last sent one of its own notifications (backups, replication,
 *     fencing, updates) to OneUptime;
 *   - "ProxmoxResource": whether a guest is a template, its tags, the lock
 *     Proxmox holds on it, its vCPUs (a node's cores), a storage's type,
 *     content and whether it is shared, a node's subscription level, and a
 *     guest's last backup as the cluster's backup notifications report it.
 *
 * Every column is new and nullable, with no default: adding one only changes
 * the catalogue, never rewrites a row or holds a long lock. Null means "not
 * reported yet", which the pages draw as unknown.
 */
export class AddProxmoxInventoryFactsAndBackups1808740000000
  implements MigrationInterface
{
  public name: string = "AddProxmoxInventoryFactsAndBackups1808740000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "isQuorate" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "lastNotificationAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "isTemplate" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "tags" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lockState" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "cpuCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "storageType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "storageContent" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "isShared" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "subscriptionLevel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastBackupAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastBackupStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastSuccessfulBackupAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastBackupBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastBackupDurationSeconds" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastBackupDurationSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastBackupBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastSuccessfulBackupAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastBackupStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastBackupAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "subscriptionLevel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "isShared"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "storageContent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "storageType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "cpuCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lockState"`,
    );
    await queryRunner.query(`ALTER TABLE "ProxmoxResource" DROP COLUMN "tags"`);
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "isTemplate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "lastNotificationAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "isQuorate"`,
    );
  }
}
