import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Attach Podman hosts and Podman resources to Incident, Alert and
 * ScheduledMaintenance (a faithful parallel of the DockerHost equivalents in
 * migrations 1779302536475 and 1779653508434). Creates the five many-to-many
 * join tables backing the `podmanHosts`/`podmanResources` relations on those
 * models, and adds the `inheritLabelsFromPodmanHosts` /
 * `inheritOwnersFromPodmanHosts` boolean columns to the label-rule and
 * owner-rule tables so rule engines can inherit labels/owners from affected
 * Podman hosts. ScheduledMaintenance gets a PodmanHost relation only (no
 * PodmanResource), matching Docker. Constraint/index names use readable
 * `*_podman_*` identifiers so they stay globally unique (never reuse Docker's
 * hashes).
 */
export class AttachPodmanToIncidentAlertScheduledMaintenance1781800000001
  implements MigrationInterface
{
  public name =
    "AttachPodmanToIncidentAlertScheduledMaintenance1781800000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IncidentPodmanHost
    await queryRunner.query(
      `CREATE TABLE "IncidentPodmanHost" ("incidentId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_incident_podman_host" PRIMARY KEY ("incidentId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_host_incidentId" ON "IncidentPodmanHost" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_host_podmanHostId" ON "IncidentPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_incident_podman_host_incident" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_incident_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentPodmanResource
    await queryRunner.query(
      `CREATE TABLE "IncidentPodmanResource" ("incidentId" uuid NOT NULL, "podmanResourceId" uuid NOT NULL, CONSTRAINT "PK_incident_podman_resource" PRIMARY KEY ("incidentId", "podmanResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_resource_incidentId" ON "IncidentPodmanResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_resource_podmanResourceId" ON "IncidentPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_incident_podman_resource_incident" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_incident_podman_resource_podmanResource" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertPodmanHost
    await queryRunner.query(
      `CREATE TABLE "AlertPodmanHost" ("alertId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_alert_podman_host" PRIMARY KEY ("alertId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_host_alertId" ON "AlertPodmanHost" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_host_podmanHostId" ON "AlertPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_alert_podman_host_alert" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_alert_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertPodmanResource
    await queryRunner.query(
      `CREATE TABLE "AlertPodmanResource" ("alertId" uuid NOT NULL, "podmanResourceId" uuid NOT NULL, CONSTRAINT "PK_alert_podman_resource" PRIMARY KEY ("alertId", "podmanResourceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_resource_alertId" ON "AlertPodmanResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_resource_podmanResourceId" ON "AlertPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_alert_podman_resource_alert" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_alert_podman_resource_podmanResource" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ScheduledMaintenancePodmanHost
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenancePodmanHost" ("scheduledMaintenanceId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_scheduled_maintenance_podman_host" PRIMARY KEY ("scheduledMaintenanceId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_podman_host_smId" ON "ScheduledMaintenancePodmanHost" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_podman_host_podmanHostId" ON "ScheduledMaintenancePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_scheduled_maintenance_podman_host_sm" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_scheduled_maintenance_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentTemplatePodmanHost
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplatePodmanHost" ("incidentTemplateId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_incident_template_podman_host" PRIMARY KEY ("incidentTemplateId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_template_podman_host_templateId" ON "IncidentTemplatePodmanHost" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_template_podman_host_podmanHostId" ON "IncidentTemplatePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" ADD CONSTRAINT "FK_incident_template_podman_host_template" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" ADD CONSTRAINT "FK_incident_template_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ScheduledMaintenanceTemplatePodmanHost
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplatePodmanHost" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_sm_template_podman_host" PRIMARY KEY ("scheduledMaintenanceTemplateId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_template_podman_host_templateId" ON "ScheduledMaintenanceTemplatePodmanHost" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_template_podman_host_podmanHostId" ON "ScheduledMaintenanceTemplatePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" ADD CONSTRAINT "FK_sm_template_podman_host_template" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" ADD CONSTRAINT "FK_sm_template_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Label-rule inheritance columns.
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "inheritLabelsFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "inheritLabelsFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "inheritLabelsFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );

    // Owner-rule inheritance columns.
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" ADD "inheritOwnersFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" ADD "inheritOwnersFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" ADD "inheritOwnersFromPodmanHosts" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Owner-rule inheritance columns.
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceOwnerRule" DROP COLUMN "inheritOwnersFromPodmanHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertOwnerRule" DROP COLUMN "inheritOwnersFromPodmanHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentOwnerRule" DROP COLUMN "inheritOwnersFromPodmanHosts"`,
    );

    // Label-rule inheritance columns.
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "inheritLabelsFromPodmanHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "inheritLabelsFromPodmanHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "inheritLabelsFromPodmanHosts"`,
    );

    // ScheduledMaintenanceTemplatePodmanHost
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" DROP CONSTRAINT "FK_sm_template_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" DROP CONSTRAINT "FK_sm_template_podman_host_template"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_template_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_template_podman_host_templateId"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplatePodmanHost"`,
    );

    // IncidentTemplatePodmanHost
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" DROP CONSTRAINT "FK_incident_template_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" DROP CONSTRAINT "FK_incident_template_podman_host_template"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_template_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_template_podman_host_templateId"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplatePodmanHost"`);

    // ScheduledMaintenancePodmanHost
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_scheduled_maintenance_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_scheduled_maintenance_podman_host_sm"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_podman_host_smId"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenancePodmanHost"`);

    // AlertPodmanResource
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_alert_podman_resource_podmanResource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_alert_podman_resource_alert"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_resource_podmanResourceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_resource_alertId"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPodmanResource"`);

    // AlertPodmanHost
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_alert_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_alert_podman_host_alert"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_host_alertId"`,
    );
    await queryRunner.query(`DROP TABLE "AlertPodmanHost"`);

    // IncidentPodmanResource
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_incident_podman_resource_podmanResource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_incident_podman_resource_incident"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_resource_podmanResourceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_resource_incidentId"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPodmanResource"`);

    // IncidentPodmanHost
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_incident_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_incident_podman_host_incident"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_host_incidentId"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPodmanHost"`);
  }
}
