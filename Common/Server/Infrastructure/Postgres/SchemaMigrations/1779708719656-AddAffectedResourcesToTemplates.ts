import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAffectedResourcesToTemplates1779708719656
  implements MigrationInterface
{
  public name = "AddAffectedResourcesToTemplates1779708719656";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplateHost" ("incidentTemplateId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_a09ffd1532de0b8ac62f0da158f" PRIMARY KEY ("incidentTemplateId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e0ed6c1215420a0df3f3989110" ON "IncidentTemplateHost" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16d1932f441acd23b552fac1b4" ON "IncidentTemplateHost" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplateKubernetesCluster" ("incidentTemplateId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_87003641007036d0571452da0c4" PRIMARY KEY ("incidentTemplateId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_724d178e8bc779c2812a8387dc" ON "IncidentTemplateKubernetesCluster" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9f5fa87fc7d91f773b3b1cf57b" ON "IncidentTemplateKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplateDockerHost" ("incidentTemplateId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_916cda583a4d2ea9c43f3859a3e" PRIMARY KEY ("incidentTemplateId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e9836de076e5cc1bcffbc42fa" ON "IncidentTemplateDockerHost" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5f8effc30ed401129e500a337" ON "IncidentTemplateDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateHost" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "hostId" uuid NOT NULL, CONSTRAINT "PK_ef91c0875d72c2b7fd7deeba9f8" PRIMARY KEY ("scheduledMaintenanceTemplateId", "hostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_431ac695e4669acd3b4fa1c2ca" ON "ScheduledMaintenanceTemplateHost" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3eeedb30c7d4a9da1cdb22fc74" ON "ScheduledMaintenanceTemplateHost" ("hostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateKubernetesCluster" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, CONSTRAINT "PK_947ade55ac0be5edc5646ac282a" PRIMARY KEY ("scheduledMaintenanceTemplateId", "kubernetesClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15e0668b1f3c69b7754925f69f" ON "ScheduledMaintenanceTemplateKubernetesCluster" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7aae1e7e14ef99a84979ae1c5d" ON "ScheduledMaintenanceTemplateKubernetesCluster" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplateDockerHost" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "dockerHostId" uuid NOT NULL, CONSTRAINT "PK_bbf4d6cbf96a9bab4241a0632cc" PRIMARY KEY ("scheduledMaintenanceTemplateId", "dockerHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_787050b28cf3c56407863ec97a" ON "ScheduledMaintenanceTemplateDockerHost" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_191b79bdbffa0070b751dba255" ON "ScheduledMaintenanceTemplateDockerHost" ("dockerHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateHost" ADD CONSTRAINT "FK_e0ed6c1215420a0df3f39891102" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateHost" ADD CONSTRAINT "FK_16d1932f441acd23b552fac1b4d" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateKubernetesCluster" ADD CONSTRAINT "FK_724d178e8bc779c2812a8387dc6" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateKubernetesCluster" ADD CONSTRAINT "FK_9f5fa87fc7d91f773b3b1cf57bd" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateDockerHost" ADD CONSTRAINT "FK_6e9836de076e5cc1bcffbc42fab" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateDockerHost" ADD CONSTRAINT "FK_d5f8effc30ed401129e500a3374" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateHost" ADD CONSTRAINT "FK_431ac695e4669acd3b4fa1c2ca8" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateHost" ADD CONSTRAINT "FK_3eeedb30c7d4a9da1cdb22fc74f" FOREIGN KEY ("hostId") REFERENCES "Host"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateKubernetesCluster" ADD CONSTRAINT "FK_15e0668b1f3c69b7754925f69fd" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateKubernetesCluster" ADD CONSTRAINT "FK_7aae1e7e14ef99a84979ae1c5dc" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateDockerHost" ADD CONSTRAINT "FK_787050b28cf3c56407863ec97a5" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateDockerHost" ADD CONSTRAINT "FK_191b79bdbffa0070b751dba255f" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateDockerHost" DROP CONSTRAINT "FK_191b79bdbffa0070b751dba255f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateDockerHost" DROP CONSTRAINT "FK_787050b28cf3c56407863ec97a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateKubernetesCluster" DROP CONSTRAINT "FK_7aae1e7e14ef99a84979ae1c5dc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateKubernetesCluster" DROP CONSTRAINT "FK_15e0668b1f3c69b7754925f69fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateHost" DROP CONSTRAINT "FK_3eeedb30c7d4a9da1cdb22fc74f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplateHost" DROP CONSTRAINT "FK_431ac695e4669acd3b4fa1c2ca8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateDockerHost" DROP CONSTRAINT "FK_d5f8effc30ed401129e500a3374"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateDockerHost" DROP CONSTRAINT "FK_6e9836de076e5cc1bcffbc42fab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateKubernetesCluster" DROP CONSTRAINT "FK_9f5fa87fc7d91f773b3b1cf57bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateKubernetesCluster" DROP CONSTRAINT "FK_724d178e8bc779c2812a8387dc6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateHost" DROP CONSTRAINT "FK_16d1932f441acd23b552fac1b4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplateHost" DROP CONSTRAINT "FK_e0ed6c1215420a0df3f39891102"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_191b79bdbffa0070b751dba255"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_787050b28cf3c56407863ec97a"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplateDockerHost"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7aae1e7e14ef99a84979ae1c5d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15e0668b1f3c69b7754925f69f"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplateKubernetesCluster"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3eeedb30c7d4a9da1cdb22fc74"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_431ac695e4669acd3b4fa1c2ca"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceTemplateHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5f8effc30ed401129e500a337"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e9836de076e5cc1bcffbc42fa"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplateDockerHost"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9f5fa87fc7d91f773b3b1cf57b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_724d178e8bc779c2812a8387dc"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplateKubernetesCluster"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16d1932f441acd23b552fac1b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e0ed6c1215420a0df3f3989110"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplateHost"`);
  }
}
