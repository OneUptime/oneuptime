import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Archive for the values records pick from: incident and alert states and
 * severities, monitor statuses, scheduled maintenance states, labels and
 * incident roles (Common/Utils/ArchivableValues). Each gets the three columns
 * every archivable resource already has: "isArchived" (NOT NULL DEFAULT
 * false, so every existing value stays live and nothing a record points at
 * changes), and "archivedAt" and "archivedByUserId" (stamped by the server
 * from the isArchived write, NULL while not archived).
 *
 * Adding a NOT NULL column with a constant default does not rewrite the table
 * on Postgres 11+, so this is cheap even on a project with many labels. The
 * foreign keys from "archivedByUserId" to "User" are added online, in
 * AddArchiveToValuesUserKeys1805770000000.
 */
export class AddArchiveToValues1805760000000 implements MigrationInterface {
  public name: string = "AddArchiveToValues1805760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "Label" ADD "archivedByUserId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" ADD "archivedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD "isArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD "archivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" ADD "archivedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "Label" DROP COLUMN "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "Label" DROP COLUMN "isArchived"`);
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP COLUMN "isArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP COLUMN "archivedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP COLUMN "archivedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP COLUMN "isArchived"`,
    );
  }
}
