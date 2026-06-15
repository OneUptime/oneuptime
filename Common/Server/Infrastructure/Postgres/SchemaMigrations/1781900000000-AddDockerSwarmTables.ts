import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AddDockerSwarmTables
 *
 * Creates the Docker Swarm product tables: the cluster, the wide
 * inventory resource table (Node/Service/Task/Stack/Network/Secret/
 * Config/Volume), the owner/label rules + their join tables, the
 * cluster<->Label join, and the activity join tables that attach a
 * Docker Swarm cluster to Incidents / Alerts / Scheduled Maintenance.
 *
 * DDL captured from the TypeORM generator (entity-accurate column
 * definitions); only the DockerSwarm statements are kept. FK / index
 * names are the generator's deterministic hashes — functionally
 * identical to the readable names other products use.
 */
export class AddDockerSwarmTables1781900000000 implements MigrationInterface {
  public name = "AddDockerSwarmTables1781900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmCluster" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "dockerVersion" character varying(500), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "nodeCount" integer DEFAULT '0', "readyNodeCount" integer DEFAULT '0', "managerNodeCount" integer DEFAULT '0', "serviceCount" integer DEFAULT '0', "taskCount" integer DEFAULT '0', "runningTaskCount" integer DEFAULT '0', "stackCount" integer DEFAULT '0', "networkCount" integer DEFAULT '0', "swarmId" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, CONSTRAINT "PK_46c01b63f84079cb867f7a3f130" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da881ec7c4c22ca15813941e8d" ON "DockerSwarmCluster" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_558572dac77c260fbd488d683e" ON "DockerSwarmCluster" ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_40b32e922dac4f79635e71494e" ON "DockerSwarmCluster" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a54a9b08b8729d643ba27e0fd64" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c8715c9bbe097fae9d47f84f6" ON "DockerSwarmClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_881424e5f7f5b7b585ee857177" ON "DockerSwarmClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e57b7bc99f03f67c8ad7a1eec2" ON "DockerSwarmClusterOwnerTeam" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d24613f10be9188592dc931fd4" ON "DockerSwarmClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a2da68ae687577f0219296d60ff" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_970fff1275934e2f74f5e1b5d8" ON "DockerSwarmClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f46e9f5be673995c7fdf4392a2" ON "DockerSwarmClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3979506b4c309d926591592b4d" ON "DockerSwarmClusterOwnerUser" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7959b1c3201bfd8dc0910e729e" ON "DockerSwarmClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "state" character varying(100), "role" character varying(100), "serviceMode" character varying(100), "desiredReplicas" integer, "runningReplicas" integer, "image" character varying(500), "stackName" character varying(100), "serviceName" character varying(100), "nodeHostname" character varying(100), "driver" character varying(100), "isReady" boolean, "attributes" jsonb, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "maxMemoryBytes" bigint, "latestMemoryPercent" numeric, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_549bdf71cd43a4cd973ab1fe1f0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fcc617a6fc021aa036f629d09" ON "DockerSwarmResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ed38fa32b40829634bd9d5358" ON "DockerSwarmResource" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b2cae687bd4b70342147c6b1ba" ON "DockerSwarmResource" ("projectId", "dockerSwarmClusterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "dockerSwarmClusterNamePattern" character varying(500), "dockerSwarmClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_4bcfba7102096a3495b964118af" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8121caf22dfcca8a881b226e2e" ON "DockerSwarmClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f372c0441e5e03dc9e495e550" ON "DockerSwarmClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4d68d4f323704f9f71a82a1f4" ON "DockerSwarmClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "dockerSwarmClusterNamePattern" character varying(500), "dockerSwarmClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c9ae11cf994606d2ac6187665e1" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47befb0affc3555f9ffb0a24f5" ON "DockerSwarmClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_911a6c47b2f1917db47ea720e4" ON "DockerSwarmClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_464846b44ced3658bb6e10b0e5" ON "DockerSwarmClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterLabel" ("dockerSwarmClusterId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_db7e67f70b7f9e3bce8d7be1e0b" PRIMARY KEY ("dockerSwarmClusterId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7997e08a5243861e8fcf92736" ON "DockerSwarmClusterLabel" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd74d53e6b4444fbea902289b8" ON "DockerSwarmClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentDockerSwarmCluster" ("incidentId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, CONSTRAINT "PK_4b2ce1381454a41e2f4cf15e3c9" PRIMARY KEY ("incidentId", "dockerSwarmClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35e52af3b3b4a92ef493108eab" ON "IncidentDockerSwarmCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97f9afdbe158e3f5374b781207" ON "IncidentDockerSwarmCluster" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertDockerSwarmCluster" ("alertId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, CONSTRAINT "PK_1354ecf035aecd0f2c51b14b1e8" PRIMARY KEY ("alertId", "dockerSwarmClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_748fededf06332f3f6df0c466d" ON "AlertDockerSwarmCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_779405e1f328c3d75bcf517938" ON "AlertDockerSwarmCluster" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceDockerSwarmCluster" ("scheduledMaintenanceId" uuid NOT NULL, "dockerSwarmClusterId" uuid NOT NULL, CONSTRAINT "PK_c3471dfe221eb87fe6e79b3647d" PRIMARY KEY ("scheduledMaintenanceId", "dockerSwarmClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c0abc005361dfa415d0d065fd" ON "ScheduledMaintenanceDockerSwarmCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1f193f2ad985e7548ff4dc135a" ON "ScheduledMaintenanceDockerSwarmCluster" ("dockerSwarmClusterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel" ("dockerSwarmClusterOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cb3483b7e0192815d2816eb4307" PRIMARY KEY ("dockerSwarmClusterOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b669ac4df3047328cc45537aa4" ON "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel" ("dockerSwarmClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc7cbff2b12d67ab7ffead983c" ON "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerRuleOwnerUser" ("dockerSwarmClusterOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_cba7211f600fa3da773f8d2a4d2" PRIMARY KEY ("dockerSwarmClusterOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_958ff23ca1e0eec6bf6a3cd232" ON "DockerSwarmClusterOwnerRuleOwnerUser" ("dockerSwarmClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0f400a618723e79a45150d353" ON "DockerSwarmClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterOwnerRuleOwnerTeam" ("dockerSwarmClusterOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_1cad2354aa5eb57e5eef862792c" PRIMARY KEY ("dockerSwarmClusterOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aad5be7d54f997354c62f42f5e" ON "DockerSwarmClusterOwnerRuleOwnerTeam" ("dockerSwarmClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e3a5a7a9c2551330e01a39ee50" ON "DockerSwarmClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel" ("dockerSwarmClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_5fa85b9e2ae9483963d2adc7f69" PRIMARY KEY ("dockerSwarmClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad36a264745163d6cc2443d7d1" ON "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel" ("dockerSwarmClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_954aa7dad00610dd61808d2158" ON "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DockerSwarmClusterLabelRuleLabelToAdd" ("dockerSwarmClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_e2e3ee802bc5ca006b02da5afe7" PRIMARY KEY ("dockerSwarmClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73e41be2a180b4b7cd62acade9" ON "DockerSwarmClusterLabelRuleLabelToAdd" ("dockerSwarmClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a82d8ac4bda5274e0114c23afe" ON "DockerSwarmClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD CONSTRAINT "FK_da881ec7c4c22ca15813941e8dc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD CONSTRAINT "FK_8b49a7928b1e024a95b5d867f2d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD CONSTRAINT "FK_b0b79b94e54b04805af8215e781" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerTeam" ADD CONSTRAINT "FK_5c8715c9bbe097fae9d47f84f6f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerTeam" ADD CONSTRAINT "FK_881424e5f7f5b7b585ee8571770" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerTeam" ADD CONSTRAINT "FK_e57b7bc99f03f67c8ad7a1eec2b" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerTeam" ADD CONSTRAINT "FK_505c1de8cb3863f2d8e49986349" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerTeam" ADD CONSTRAINT "FK_3e5dc2c6bde8e7edc53ebd68e1e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerUser" ADD CONSTRAINT "FK_970fff1275934e2f74f5e1b5d85" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerUser" ADD CONSTRAINT "FK_f46e9f5be673995c7fdf4392a2d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerUser" ADD CONSTRAINT "FK_3979506b4c309d926591592b4d7" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerUser" ADD CONSTRAINT "FK_da5d8aba1298eb2ae1df3c89744" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerUser" ADD CONSTRAINT "FK_fc398d618da640affc0b5bc2067" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmResource" ADD CONSTRAINT "FK_8fcc617a6fc021aa036f629d096" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmResource" ADD CONSTRAINT "FK_2ed38fa32b40829634bd9d5358c" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmResource" ADD CONSTRAINT "FK_3c1e1d255dbe7567ab54443e004" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmResource" ADD CONSTRAINT "FK_480af1c3b24d7a06c857460cec3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" ADD CONSTRAINT "FK_8121caf22dfcca8a881b226e2e5" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" ADD CONSTRAINT "FK_25ca09d7c8f677e1e2e13643cea" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRule" ADD CONSTRAINT "FK_7e805f0febacc2caf7095d38d27" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" ADD CONSTRAINT "FK_47befb0affc3555f9ffb0a24f5e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" ADD CONSTRAINT "FK_2bd80c032859ea0647c9765b04d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRule" ADD CONSTRAINT "FK_8a0e7ea04b63d004707fb57a5d9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabel" ADD CONSTRAINT "FK_b7997e08a5243861e8fcf92736e" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabel" ADD CONSTRAINT "FK_bd74d53e6b4444fbea902289b80" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerSwarmCluster" ADD CONSTRAINT "FK_35e52af3b3b4a92ef493108eab0" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDockerSwarmCluster" ADD CONSTRAINT "FK_97f9afdbe158e3f5374b781207b" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerSwarmCluster" ADD CONSTRAINT "FK_748fededf06332f3f6df0c466d1" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDockerSwarmCluster" ADD CONSTRAINT "FK_779405e1f328c3d75bcf5179386" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerSwarmCluster" ADD CONSTRAINT "FK_5c0abc005361dfa415d0d065fdc" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDockerSwarmCluster" ADD CONSTRAINT "FK_1f193f2ad985e7548ff4dc135a7" FOREIGN KEY ("dockerSwarmClusterId") REFERENCES "DockerSwarmCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel" ADD CONSTRAINT "FK_b669ac4df3047328cc45537aa40" FOREIGN KEY ("dockerSwarmClusterOwnerRuleId") REFERENCES "DockerSwarmClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel" ADD CONSTRAINT "FK_bc7cbff2b12d67ab7ffead983c6" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_958ff23ca1e0eec6bf6a3cd232d" FOREIGN KEY ("dockerSwarmClusterOwnerRuleId") REFERENCES "DockerSwarmClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_f0f400a618723e79a45150d3535" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_aad5be7d54f997354c62f42f5e9" FOREIGN KEY ("dockerSwarmClusterOwnerRuleId") REFERENCES "DockerSwarmClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_e3a5a7a9c2551330e01a39ee506" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel" ADD CONSTRAINT "FK_ad36a264745163d6cc2443d7d1a" FOREIGN KEY ("dockerSwarmClusterLabelRuleId") REFERENCES "DockerSwarmClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel" ADD CONSTRAINT "FK_954aa7dad00610dd61808d21584" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_73e41be2a180b4b7cd62acade94" FOREIGN KEY ("dockerSwarmClusterLabelRuleId") REFERENCES "DockerSwarmClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_a82d8ac4bda5274e0114c23afe0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "DockerSwarmClusterLabelRuleLabelToAdd"`,
    );
    await queryRunner.query(
      `DROP TABLE "DockerSwarmClusterLabelRuleDockerSwarmClusterLabel"`,
    );
    await queryRunner.query(
      `DROP TABLE "DockerSwarmClusterOwnerRuleOwnerTeam"`,
    );
    await queryRunner.query(
      `DROP TABLE "DockerSwarmClusterOwnerRuleOwnerUser"`,
    );
    await queryRunner.query(
      `DROP TABLE "DockerSwarmClusterOwnerRuleDockerSwarmClusterLabel"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceDockerSwarmCluster"`,
    );
    await queryRunner.query(`DROP TABLE "AlertDockerSwarmCluster"`);
    await queryRunner.query(`DROP TABLE "IncidentDockerSwarmCluster"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterLabel"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterLabelRule"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterOwnerRule"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmResource"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterOwnerUser"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmClusterOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "DockerSwarmCluster"`);
  }
}
