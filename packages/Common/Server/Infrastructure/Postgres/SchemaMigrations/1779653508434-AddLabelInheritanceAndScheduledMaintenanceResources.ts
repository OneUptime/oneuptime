import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLabelInheritanceAndScheduledMaintenanceResources1779653508434
  implements MigrationInterface
{
  public name =
    "AddLabelInheritanceAndScheduledMaintenanceResources1779653508434";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceHost" ("scheduledMaintenanceId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_b2b1f12cd31c8f5fd8401b98573" PRIMARY KEY ("scheduledMaintenanceId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0baad25219fc2a901598d5eab7" ON "ScheduledMaintenanceHost" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d75e7c0730657de2e42b1a36e" ON "ScheduledMaintenanceHost" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceKubernetesCluster" ("scheduledMaintenanceId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_0240058eae7fcc55378b7331064" PRIMARY KEY ("scheduledMaintenanceId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15d5f15b92222716261dd515b6" ON "ScheduledMaintenanceKubernetesCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb171fb41f3f3694b254ac401f" ON "ScheduledMaintenanceKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceDockerHost" ("scheduledMaintenanceId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_4c10f5b6cdead6d26e655ade5b0" PRIMARY KEY ("scheduledMaintenanceId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_398ae6ccf101951715fb786513" ON "ScheduledMaintenanceDockerHost" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9e88fe5212059e2f9a7dd6030" ON "ScheduledMaintenanceDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "inheritLabelsFromHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "inheritLabelsFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" ADD "inheritLabelsFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "inheritLabelsFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" ADD "inheritLabelsFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "inheritLabelsFromHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "inheritLabelsFromKubernetesClusters" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" ADD "inheritLabelsFromDockerHosts" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceHost" ADD CONSTRAINT "FK_0baad25219fc2a901598d5eab7e" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceHost" ADD CONSTRAINT "FK_8d75e7c0730657de2e42b1a36ec" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceKubernetesCluster" ADD CONSTRAINT "FK_15d5f15b92222716261dd515b6d" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceKubernetesCluster" ADD CONSTRAINT "FK_eb171fb41f3f3694b254ac401f3" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerHost" ADD CONSTRAINT "FK_398ae6ccf101951715fb7865133" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerHost" ADD CONSTRAINT "FK_e9e88fe5212059e2f9a7dd60306" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerHost" DROP CONSTRAINT "FK_e9e88fe5212059e2f9a7dd60306"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerHost" DROP CONSTRAINT "FK_398ae6ccf101951715fb7865133"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceKubernetesCluster" DROP CONSTRAINT "FK_eb171fb41f3f3694b254ac401f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceKubernetesCluster" DROP CONSTRAINT "FK_15d5f15b92222716261dd515b6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceHost" DROP CONSTRAINT "FK_8d75e7c0730657de2e42b1a36ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceHost" DROP CONSTRAINT "FK_0baad25219fc2a901598d5eab7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "inheritLabelsFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "inheritLabelsFromKubernetesClusters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLabelRule" DROP COLUMN "inheritLabelsFromHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "inheritLabelsFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentLabelRule" DROP COLUMN "inheritLabelsFromKubernetesClusters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "inheritLabelsFromDockerHosts"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "inheritLabelsFromKubernetesClusters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertLabelRule" DROP COLUMN "inheritLabelsFromHosts"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9e88fe5212059e2f9a7dd6030"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_398ae6ccf101951715fb786513"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceDockerHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb171fb41f3f3694b254ac401f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15d5f15b92222716261dd515b6"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceKubernetesCluster"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d75e7c0730657de2e42b1a36e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0baad25219fc2a901598d5eab7"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceHost"`);
  }
}
