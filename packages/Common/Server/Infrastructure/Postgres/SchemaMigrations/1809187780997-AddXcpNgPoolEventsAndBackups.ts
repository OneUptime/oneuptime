import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * numbered after the last registered migration.
 *
 * What a probe reads of an XCP-ng pool beyond its metrics (#10997):
 *   - "XcpNgPool": HA on or off, its plan (straight from XAPI), the master,
 *     when alarms, backups and patches were last read and what could not be,
 *     each backup job's last runs for the pool, and - never served - where
 *     reading stands (the watermarks and the messages whose alerts are open);
 *   - "XcpNgResource": a VM's last backup and how often its jobs run, and a
 *     host's missing patches.
 *
 * Every column is new and nullable, with no default: adding one only changes
 * the catalogue, never rewrites a row or holds a long lock. Null means "not
 * read", which the pages draw as unknown.
 */
export class AddXcpNgPoolEventsAndBackups1809187780997
  implements MigrationInterface
{
  public name: string = "AddXcpNgPoolEventsAndBackups1809187780997";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "isHaEnabled" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "haHostFailuresToTolerate" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "haPlanExistsFor" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "isHaOvercommitted" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "masterHostExternalId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "eventsReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "backupsReadAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "patchesCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD "eventReadStatus" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "XcpNgPool" ADD "backupJobs" jsonb`);
    await queryRunner.query(`ALTER TABLE "XcpNgPool" ADD "eventState" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastBackupAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastBackupStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastSuccessfulBackupAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastBackupJobName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastBackupError" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "lastBackupBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "backupIntervalSeconds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "missingPatchCount" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD "missingPatches" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "missingPatches"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "missingPatchCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "backupIntervalSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastBackupBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastBackupError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastBackupJobName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastSuccessfulBackupAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastBackupStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP COLUMN "lastBackupAt"`,
    );
    await queryRunner.query(`ALTER TABLE "XcpNgPool" DROP COLUMN "eventState"`);
    await queryRunner.query(`ALTER TABLE "XcpNgPool" DROP COLUMN "backupJobs"`);
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "eventReadStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "patchesCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "backupsReadAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "eventsReadAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "masterHostExternalId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "isHaOvercommitted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "haPlanExistsFor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "haHostFailuresToTolerate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP COLUMN "isHaEnabled"`,
    );
  }
}
