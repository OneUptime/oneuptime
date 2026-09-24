import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDatabaseServerTables1795000000000
  implements MigrationInterface
{
  public name: string = "AddDatabaseServerTables1795000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DatabaseServer" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "databaseIdentifier" character varying(500) NOT NULL, "workloadIdentifier" character varying(500), "dbSystem" character varying(100) NOT NULL, "serverAddress" character varying(500), "serverPort" integer, "dbVersion" character varying(100), "discoverySource" character varying(100), "kubernetesClusterId" uuid, "kubernetesNamespace" character varying(100), "workloadKind" character varying(100), "workloadName" character varying(500), "dockerHostId" uuid, "podmanHostId" uuid, "memberEntityKeys" jsonb, "instanceCount" integer DEFAULT '0', "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "collectorLastSeenAt" TIMESTAMP WITH TIME ZONE, "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "autoArchivedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "deletedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, CONSTRAINT "PK_3444222b397d7d4649e226fa798" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3571be7455fdedb73e9f506bc5" ON "DatabaseServer" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c1d92cec98c35f847ce142327f" ON "DatabaseServer" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_efd2ac8a4b71a04785b8ef6f0c" ON "DatabaseServer" ("databaseIdentifier") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a403156c9375238ab9b91be373" ON "DatabaseServer" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_database_server_workload" ON "DatabaseServer" ("projectId", "workloadIdentifier") WHERE "workloadIdentifier" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_database_server_slug" ON "DatabaseServer" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38236dc7583de0584e85b5123a" ON "DatabaseServer" ("projectId", "dbSystem") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c5a1d497ae4f34b3b224cf7e5" ON "DatabaseServer" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_206fcf9475116b185f2f264def" ON "DatabaseServer" ("projectId", "databaseIdentifier") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerEndpoint" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, "endpoint" character varying(500) NOT NULL, "isPrimary" boolean NOT NULL DEFAULT false, "source" character varying(100), "lastMatchedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b6af1529e0c496c834768800b43" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd424d8c3f20608b2f26de6b49" ON "DatabaseServerEndpoint" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_57583ea9e507b4d35697829710" ON "DatabaseServerEndpoint" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6d8320bd97bf498266b29f1d0a" ON "DatabaseServerEndpoint" ("projectId", "endpoint") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "databaseServerFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9a8d17ead6fecf0f446aad525b8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b997a0c2b785f0c32dfd9171ca" ON "DatabaseServerFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cb4090e0213fc3ff03d146c06" ON "DatabaseServerFeed" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5485508997d8b40a126cc3239b" ON "DatabaseServerFeed" ("databaseServerId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ecca1970df9d7da20b991799858" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4a77a4dad67389ae14511532d" ON "DatabaseServerOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_61fc7c2eefc30f98402c484db4" ON "DatabaseServerOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1501f8e5250b307428b4c04b2b" ON "DatabaseServerOwnerTeam" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dadc312b1e6e515e4cde989ca6" ON "DatabaseServerOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0b8d87e9fe7021678088dea400" ON "DatabaseServerOwnerTeam" ("databaseServerId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_5d88d4c32621d440bd6a67d6faa" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13a68df95e86cf01a0543b09ab" ON "DatabaseServerOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4103cadfa492a65cf4dd651d46" ON "DatabaseServerOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b728d6bd1261520f23327aa5ec" ON "DatabaseServerOwnerUser" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb6de4c05a052cd686d1542402" ON "DatabaseServerOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4f2b5d9f56d5b49fb3ff486c52" ON "DatabaseServerOwnerUser" ("databaseServerId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "databaseServerNamePattern" character varying(500), "databaseServerDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f95a731afe6bc319837aacd1c59" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_468793c3a7ed4ce86323f981e8" ON "DatabaseServerLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6a95fb09f694f7062cd677cbe" ON "DatabaseServerLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9ed348022cc23949734a52d4b" ON "DatabaseServerLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "criteria" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "databaseServerNamePattern" character varying(500), "databaseServerDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_0b50d5db76626e5b2c4659c59d6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1540a57f3aed4af132c61dd834" ON "DatabaseServerOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae563ff4904869112bd9159db0" ON "DatabaseServerOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb02e46579dcdee598841b31fc" ON "DatabaseServerOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerLabel" ("databaseServerId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2f72283904a4db49aefad93e651" PRIMARY KEY ("databaseServerId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f25bafd56f046d72ba7e7c30a9" ON "DatabaseServerLabel" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25c7832e27613c8e9b006ff85a" ON "DatabaseServerLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerLabelRuleDatabaseServerLabel" ("databaseServerLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_929f191894ab2d152fe6ad38829" PRIMARY KEY ("databaseServerLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c28b71826d46667f398c380be" ON "DatabaseServerLabelRuleDatabaseServerLabel" ("databaseServerLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a51bf14ce4ffb6ba5f9341c4c" ON "DatabaseServerLabelRuleDatabaseServerLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerLabelRuleLabelToAdd" ("databaseServerLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fbf2d685bb0ab0e4aa77a3e179a" PRIMARY KEY ("databaseServerLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c64cc9c0dabd9ebd7d8c712669" ON "DatabaseServerLabelRuleLabelToAdd" ("databaseServerLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93f623ff6cde45c7081618e4ff" ON "DatabaseServerLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerRuleDatabaseServerLabel" ("databaseServerOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_3ee84c85b4a5cf01bef7d1a9737" PRIMARY KEY ("databaseServerOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46a291cff46f7d22515cb1dead" ON "DatabaseServerOwnerRuleDatabaseServerLabel" ("databaseServerOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a97e1aea86af417e48ed027da8" ON "DatabaseServerOwnerRuleDatabaseServerLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerRuleOwnerUser" ("databaseServerOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_6ab6155f2ac5f6f13a3a7874402" PRIMARY KEY ("databaseServerOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4db8158969f274c0c5fe69c41" ON "DatabaseServerOwnerRuleOwnerUser" ("databaseServerOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e9fda6202e484aa398f309b83" ON "DatabaseServerOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "DatabaseServerOwnerRuleOwnerTeam" ("databaseServerOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_384e69415772aed4f226380653d" PRIMARY KEY ("databaseServerOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92aa230b9507748306317b795f" ON "DatabaseServerOwnerRuleOwnerTeam" ("databaseServerOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9964e60fbe0423c979f28349b6" ON "DatabaseServerOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentDatabaseServer" ("incidentId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, CONSTRAINT "PK_c887998809df0e8b5bc1362c780" PRIMARY KEY ("incidentId", "databaseServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f93d44f5ac3c7a1b29206065a8" ON "IncidentDatabaseServer" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f4f922d916e86b46f44672b91" ON "IncidentDatabaseServer" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertDatabaseServer" ("alertId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, CONSTRAINT "PK_8f5eb056ca4e140833ff410f529" PRIMARY KEY ("alertId", "databaseServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df8b8a7d519969ccc95b461a97" ON "AlertDatabaseServer" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac16037f48fedd399cd2528374" ON "AlertDatabaseServer" ("databaseServerId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceDatabaseServer" ("scheduledMaintenanceId" uuid NOT NULL, "databaseServerId" uuid NOT NULL, CONSTRAINT "PK_94505183f1f54d598a75dd43cdb" PRIMARY KEY ("scheduledMaintenanceId", "databaseServerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4f2f615e5dcd677f2ce3c7954" ON "ScheduledMaintenanceDatabaseServer" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60f85f3d7233fa4d8382cef5da" ON "ScheduledMaintenanceDatabaseServer" ("databaseServerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_3571be7455fdedb73e9f506bc55" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_a403156c9375238ab9b91be373a" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_0c801f6f3d6f57cc44c8284e287" FOREIGN KEY ("dockerHostId") REFERENCES "DockerHost"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_d82be97d6523d403cf157ab95ca" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_b73d1498c30b7ca7a161949e593" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_9570842e7f33469d6fdb54accab" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD CONSTRAINT "FK_eb94a05dcea748c2e20bd5764d5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" ADD CONSTRAINT "FK_bd424d8c3f20608b2f26de6b490" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" ADD CONSTRAINT "FK_57583ea9e507b4d356978297103" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" ADD CONSTRAINT "FK_c3614c80541a406a86fe1ace810" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" ADD CONSTRAINT "FK_9ddde92b69c65f4342415a0e69b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" ADD CONSTRAINT "FK_b997a0c2b785f0c32dfd9171cab" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" ADD CONSTRAINT "FK_2cb4090e0213fc3ff03d146c066" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" ADD CONSTRAINT "FK_8aabfa28eb7310bcfdf2beb2a45" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" ADD CONSTRAINT "FK_9a15ce20b4003b823a174a75132" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" ADD CONSTRAINT "FK_c47c87625b82632f90a424e790d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" ADD CONSTRAINT "FK_a4a77a4dad67389ae14511532d8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" ADD CONSTRAINT "FK_61fc7c2eefc30f98402c484db46" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" ADD CONSTRAINT "FK_1501f8e5250b307428b4c04b2b8" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" ADD CONSTRAINT "FK_9ad1d47464baccc88104ccd5f72" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" ADD CONSTRAINT "FK_3485d4eb03b07d39ef7a6c414d9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" ADD CONSTRAINT "FK_13a68df95e86cf01a0543b09ab4" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" ADD CONSTRAINT "FK_4103cadfa492a65cf4dd651d462" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" ADD CONSTRAINT "FK_b728d6bd1261520f23327aa5ec6" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" ADD CONSTRAINT "FK_e6a4ca53c766bfab1109f3c5036" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" ADD CONSTRAINT "FK_e6ea9fd3cefc6eea34819d4ad63" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" ADD CONSTRAINT "FK_468793c3a7ed4ce86323f981e8b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" ADD CONSTRAINT "FK_0bc35577caabd3a897e51553024" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" ADD CONSTRAINT "FK_8cb7d5d9c495497b098c9701543" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" ADD CONSTRAINT "FK_1540a57f3aed4af132c61dd834e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" ADD CONSTRAINT "FK_8cdc61d93bb119d9e18df3fa441" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" ADD CONSTRAINT "FK_2cce4f244875df37236c0e6982f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabel" ADD CONSTRAINT "FK_f25bafd56f046d72ba7e7c30a98" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabel" ADD CONSTRAINT "FK_25c7832e27613c8e9b006ff85ac" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleDatabaseServerLabel" ADD CONSTRAINT "FK_0c28b71826d46667f398c380bef" FOREIGN KEY ("databaseServerLabelRuleId") REFERENCES "DatabaseServerLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleDatabaseServerLabel" ADD CONSTRAINT "FK_6a51bf14ce4ffb6ba5f9341c4c3" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleLabelToAdd" ADD CONSTRAINT "FK_c64cc9c0dabd9ebd7d8c712669d" FOREIGN KEY ("databaseServerLabelRuleId") REFERENCES "DatabaseServerLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleLabelToAdd" ADD CONSTRAINT "FK_93f623ff6cde45c7081618e4ff0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleDatabaseServerLabel" ADD CONSTRAINT "FK_46a291cff46f7d22515cb1dead6" FOREIGN KEY ("databaseServerOwnerRuleId") REFERENCES "DatabaseServerOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleDatabaseServerLabel" ADD CONSTRAINT "FK_a97e1aea86af417e48ed027da83" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerUser" ADD CONSTRAINT "FK_b4db8158969f274c0c5fe69c41b" FOREIGN KEY ("databaseServerOwnerRuleId") REFERENCES "DatabaseServerOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerUser" ADD CONSTRAINT "FK_1e9fda6202e484aa398f309b835" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_92aa230b9507748306317b795fc" FOREIGN KEY ("databaseServerOwnerRuleId") REFERENCES "DatabaseServerOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_9964e60fbe0423c979f28349b63" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDatabaseServer" ADD CONSTRAINT "FK_f93d44f5ac3c7a1b29206065a8f" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDatabaseServer" ADD CONSTRAINT "FK_7f4f922d916e86b46f44672b917" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDatabaseServer" ADD CONSTRAINT "FK_df8b8a7d519969ccc95b461a979" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDatabaseServer" ADD CONSTRAINT "FK_ac16037f48fedd399cd25283743" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDatabaseServer" ADD CONSTRAINT "FK_d4f2f615e5dcd677f2ce3c7954b" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDatabaseServer" ADD CONSTRAINT "FK_60f85f3d7233fa4d8382cef5dac" FOREIGN KEY ("databaseServerId") REFERENCES "DatabaseServer"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDatabaseServer" DROP CONSTRAINT "FK_60f85f3d7233fa4d8382cef5dac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceDatabaseServer" DROP CONSTRAINT "FK_d4f2f615e5dcd677f2ce3c7954b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDatabaseServer" DROP CONSTRAINT "FK_ac16037f48fedd399cd25283743"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertDatabaseServer" DROP CONSTRAINT "FK_df8b8a7d519969ccc95b461a979"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDatabaseServer" DROP CONSTRAINT "FK_7f4f922d916e86b46f44672b917"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentDatabaseServer" DROP CONSTRAINT "FK_f93d44f5ac3c7a1b29206065a8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_9964e60fbe0423c979f28349b63"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_92aa230b9507748306317b795fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerUser" DROP CONSTRAINT "FK_1e9fda6202e484aa398f309b835"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleOwnerUser" DROP CONSTRAINT "FK_b4db8158969f274c0c5fe69c41b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleDatabaseServerLabel" DROP CONSTRAINT "FK_a97e1aea86af417e48ed027da83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRuleDatabaseServerLabel" DROP CONSTRAINT "FK_46a291cff46f7d22515cb1dead6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleLabelToAdd" DROP CONSTRAINT "FK_93f623ff6cde45c7081618e4ff0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleLabelToAdd" DROP CONSTRAINT "FK_c64cc9c0dabd9ebd7d8c712669d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleDatabaseServerLabel" DROP CONSTRAINT "FK_6a51bf14ce4ffb6ba5f9341c4c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRuleDatabaseServerLabel" DROP CONSTRAINT "FK_0c28b71826d46667f398c380bef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabel" DROP CONSTRAINT "FK_25c7832e27613c8e9b006ff85ac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabel" DROP CONSTRAINT "FK_f25bafd56f046d72ba7e7c30a98"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" DROP CONSTRAINT "FK_2cce4f244875df37236c0e6982f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" DROP CONSTRAINT "FK_8cdc61d93bb119d9e18df3fa441"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerRule" DROP CONSTRAINT "FK_1540a57f3aed4af132c61dd834e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" DROP CONSTRAINT "FK_8cb7d5d9c495497b098c9701543"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" DROP CONSTRAINT "FK_0bc35577caabd3a897e51553024"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerLabelRule" DROP CONSTRAINT "FK_468793c3a7ed4ce86323f981e8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" DROP CONSTRAINT "FK_e6ea9fd3cefc6eea34819d4ad63"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" DROP CONSTRAINT "FK_e6a4ca53c766bfab1109f3c5036"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" DROP CONSTRAINT "FK_b728d6bd1261520f23327aa5ec6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" DROP CONSTRAINT "FK_4103cadfa492a65cf4dd651d462"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerUser" DROP CONSTRAINT "FK_13a68df95e86cf01a0543b09ab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" DROP CONSTRAINT "FK_3485d4eb03b07d39ef7a6c414d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" DROP CONSTRAINT "FK_9ad1d47464baccc88104ccd5f72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" DROP CONSTRAINT "FK_1501f8e5250b307428b4c04b2b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" DROP CONSTRAINT "FK_61fc7c2eefc30f98402c484db46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerOwnerTeam" DROP CONSTRAINT "FK_a4a77a4dad67389ae14511532d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" DROP CONSTRAINT "FK_c47c87625b82632f90a424e790d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" DROP CONSTRAINT "FK_9a15ce20b4003b823a174a75132"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" DROP CONSTRAINT "FK_8aabfa28eb7310bcfdf2beb2a45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" DROP CONSTRAINT "FK_2cb4090e0213fc3ff03d146c066"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerFeed" DROP CONSTRAINT "FK_b997a0c2b785f0c32dfd9171cab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" DROP CONSTRAINT "FK_9ddde92b69c65f4342415a0e69b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" DROP CONSTRAINT "FK_c3614c80541a406a86fe1ace810"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" DROP CONSTRAINT "FK_57583ea9e507b4d356978297103"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServerEndpoint" DROP CONSTRAINT "FK_bd424d8c3f20608b2f26de6b490"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_eb94a05dcea748c2e20bd5764d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_9570842e7f33469d6fdb54accab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_b73d1498c30b7ca7a161949e593"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_d82be97d6523d403cf157ab95ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_0c801f6f3d6f57cc44c8284e287"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_a403156c9375238ab9b91be373a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP CONSTRAINT "FK_3571be7455fdedb73e9f506bc55"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_60f85f3d7233fa4d8382cef5da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4f2f615e5dcd677f2ce3c7954"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceDatabaseServer"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac16037f48fedd399cd2528374"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df8b8a7d519969ccc95b461a97"`,
    );
    await queryRunner.query(`DROP TABLE "AlertDatabaseServer"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f4f922d916e86b46f44672b91"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f93d44f5ac3c7a1b29206065a8"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentDatabaseServer"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9964e60fbe0423c979f28349b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92aa230b9507748306317b795f"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e9fda6202e484aa398f309b83"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4db8158969f274c0c5fe69c41"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a97e1aea86af417e48ed027da8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46a291cff46f7d22515cb1dead"`,
    );
    await queryRunner.query(
      `DROP TABLE "DatabaseServerOwnerRuleDatabaseServerLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_93f623ff6cde45c7081618e4ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c64cc9c0dabd9ebd7d8c712669"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a51bf14ce4ffb6ba5f9341c4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c28b71826d46667f398c380be"`,
    );
    await queryRunner.query(
      `DROP TABLE "DatabaseServerLabelRuleDatabaseServerLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25c7832e27613c8e9b006ff85a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f25bafd56f046d72ba7e7c30a9"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb02e46579dcdee598841b31fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae563ff4904869112bd9159db0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1540a57f3aed4af132c61dd834"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9ed348022cc23949734a52d4b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6a95fb09f694f7062cd677cbe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_468793c3a7ed4ce86323f981e8"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f2b5d9f56d5b49fb3ff486c52"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb6de4c05a052cd686d1542402"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b728d6bd1261520f23327aa5ec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4103cadfa492a65cf4dd651d46"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13a68df95e86cf01a0543b09ab"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b8d87e9fe7021678088dea400"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dadc312b1e6e515e4cde989ca6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1501f8e5250b307428b4c04b2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_61fc7c2eefc30f98402c484db4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4a77a4dad67389ae14511532d"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5485508997d8b40a126cc3239b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cb4090e0213fc3ff03d146c06"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b997a0c2b785f0c32dfd9171ca"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d8320bd97bf498266b29f1d0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_57583ea9e507b4d35697829710"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd424d8c3f20608b2f26de6b49"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServerEndpoint"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_206fcf9475116b185f2f264def"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c5a1d497ae4f34b3b224cf7e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38236dc7583de0584e85b5123a"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_database_server_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_database_server_workload"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a403156c9375238ab9b91be373"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_efd2ac8a4b71a04785b8ef6f0c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1d92cec98c35f847ce142327f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3571be7455fdedb73e9f506bc5"`,
    );
    await queryRunner.query(`DROP TABLE "DatabaseServer"`);
  }
}
