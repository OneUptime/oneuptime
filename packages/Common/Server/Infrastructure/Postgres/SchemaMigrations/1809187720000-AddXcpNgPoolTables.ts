import { MigrationInterface, QueryRunner } from "typeorm";

export class AddXcpNgPoolTables1809187720000 implements MigrationInterface {
  public name = "AddXcpNgPoolTables1809187720000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "XcpNgPool" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "poolIdentifier" character varying(100) NOT NULL, "reportedName" character varying(100), "xenOrchestraName" character varying(100), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "agentLastSeenAt" TIMESTAMP WITH TIME ZONE, "hostCount" integer DEFAULT '0', "runningHostCount" integer DEFAULT '0', "disabledHostCount" integer DEFAULT '0', "vmCount" integer DEFAULT '0', "runningVmCount" integer DEFAULT '0', "storageRepositoryCount" integer DEFAULT '0', "vdiCount" integer DEFAULT '0', "storageCapacityBytes" bigint, "storageUsedBytes" bigint, "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, CONSTRAINT "PK_1ae95636e62f8f1af1601e83b2a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1afd6e851e572876c3c9f0814" ON "XcpNgPool" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a48de5e2bd9cc7b3aad829307" ON "XcpNgPool" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28a971cdf9e901231b5d3fa5fa" ON "XcpNgPool" ("poolIdentifier") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_xcp_ng_pool_slug" ON "XcpNgPool" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d5e1ea781cd60f4606d9a9cbb" ON "XcpNgPool" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c05a4252de6a9682cd9374dfe8" ON "XcpNgPool" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_367c1c6c77b2d00ec4fa8abd74" ON "XcpNgPool" ("projectId", "poolIdentifier") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, "createdByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_89fed7890d8f0d596b4d97020c5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46f31d5661066d7d4bc85b8d15" ON "XcpNgPoolOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ad3a651441524a83a88f0ba0e6" ON "XcpNgPoolOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a04c55b9d10342eb173584517" ON "XcpNgPoolOwnerTeam" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d7949ac45bbbd3587335326a3" ON "XcpNgPoolOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_19bb8407000a806a51e627d89a" ON "XcpNgPoolOwnerTeam" ("xcpNgPoolId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, "createdByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_8ffe2e513ea45618c7d6eb6993f" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_243096b92b0399eb1904dd4d80" ON "XcpNgPoolOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45a3c7e21009297a46bba5d8ee" ON "XcpNgPoolOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ad5964291f8d910e5cbf9e89e" ON "XcpNgPoolOwnerUser" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be6a038521a95261bbc59e2b97" ON "XcpNgPoolOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3270f76aa7696a27036a314d37" ON "XcpNgPoolOwnerUser" ("xcpNgPoolId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "powerState" character varying(100), "isUp" boolean, "isEnabled" boolean, "isControlDomain" boolean, "parentHostExternalId" character varying(100), "parentHostName" character varying(100), "storageRepositoryExternalId" character varying(100), "storageRepositoryName" character varying(100), "vmExternalId" character varying(100), "vmName" character varying(100), "uptimeSeconds" integer, "lastRunningAt" TIMESTAMP WITH TIME ZONE, "latestCpuPercent" numeric, "cpuCount" integer, "runningVcpuCount" integer, "loadAverage" numeric, "latestMemoryBytes" bigint, "maxMemoryBytes" bigint, "latestMemoryPercent" numeric, "latestDiskBytes" bigint, "maxDiskBytes" bigint, "latestDiskPercent" numeric, "virtualAllocationBytes" bigint, "srType" character varying(100), "contentType" character varying(100), "isShared" boolean, "powerWatts" numeric, "tags" character varying(500), "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, CONSTRAINT "PK_93bf3918a0c053e1d18ce0b9622" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_923a7fcd4e3f818309d1bbfeaf" ON "XcpNgResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6dae172e9da61680f2e37d343e" ON "XcpNgResource" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6bb0bcd78925d685855e9d9e6f" ON "XcpNgResource" ("projectId", "xcpNgPoolId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "criteria" jsonb, "emptiedLimits" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "xcpNgPoolNamePattern" character varying(500), "xcpNgPoolDescriptionPattern" character varying(500), "createdByUserId" uuid, CONSTRAINT "PK_6e30c213d17f4a77c0329e3530b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b0fe6787eed9dbeebf747120f" ON "XcpNgPoolOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d11d3018e67b58b6d62dc8f9a5" ON "XcpNgPoolOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_289d30040adf7e898ba9344af3" ON "XcpNgPoolOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "criteria" jsonb, "emptiedLimits" jsonb, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "xcpNgPoolNamePattern" character varying(500), "xcpNgPoolDescriptionPattern" character varying(500), "createdByUserId" uuid, CONSTRAINT "PK_40648d84d7f7b66c6742a6078f8" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fff93e2f42a61e59c42624c9b" ON "XcpNgPoolLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aabc9f4fae00a4db5b07d943ca" ON "XcpNgPoolLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c617efbb4705d98d750f75371" ON "XcpNgPoolLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, "createdByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "xcpNgPoolFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5ef6e3cd83b0f3fad1b379c8487" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_325709b32dbde80da86a0d6dc8" ON "XcpNgPoolFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab5b471a59190bae34a78e4900" ON "XcpNgPoolFeed" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe4900e838831acb96761cb4f3" ON "XcpNgPoolFeed" ("xcpNgPoolId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolLabel" ("xcpNgPoolId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_58f3b3d5fe9686af0592418986a" PRIMARY KEY ("xcpNgPoolId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6c407ad162786f7a8851593f57" ON "XcpNgPoolLabel" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce804b1ced1eb313fd224be038" ON "XcpNgPoolLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorXcpNgPool" ("monitorId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, CONSTRAINT "PK_a4423382b8f0c7a05feaf49a8b1" PRIMARY KEY ("monitorId", "xcpNgPoolId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8571d304e69e765d85c1652af6" ON "MonitorXcpNgPool" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96ce58e7a8e199efeb1c307cbc" ON "MonitorXcpNgPool" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentXcpNgPool" ("incidentId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, CONSTRAINT "PK_3206004912b07a80e91b7232abc" PRIMARY KEY ("incidentId", "xcpNgPoolId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_005e9c9f5acdbce3367993308f" ON "IncidentXcpNgPool" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5665900945e3833da61c8527c3" ON "IncidentXcpNgPool" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertXcpNgPool" ("alertId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, CONSTRAINT "PK_c287894624df548e7bedc5fb54a" PRIMARY KEY ("alertId", "xcpNgPoolId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1e8ec487cb231878bc38630e93" ON "AlertXcpNgPool" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4b9da87488d3312d769d9d1b1d" ON "AlertXcpNgPool" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceXcpNgPool" ("scheduledMaintenanceId" uuid NOT NULL, "xcpNgPoolId" uuid NOT NULL, CONSTRAINT "PK_fa00728c466fe0451cd72bcbac5" PRIMARY KEY ("scheduledMaintenanceId", "xcpNgPoolId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8a134f0b921f3cf3deb1146123" ON "ScheduledMaintenanceXcpNgPool" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd7e0e2dbd0389b782f256cdd2" ON "ScheduledMaintenanceXcpNgPool" ("xcpNgPoolId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel" ("xcpNgPoolOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_fada7bd46cb7b3d3e72750e4b93" PRIMARY KEY ("xcpNgPoolOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea1cd251a676b7fd9467020576" ON "XcpNgPoolOwnerRuleXcpNgPoolLabel" ("xcpNgPoolOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6314d42d6534cc1f3401c36d1" ON "XcpNgPoolOwnerRuleXcpNgPoolLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerRuleOwnerUser" ("xcpNgPoolOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_6c3307834cc70806755a50dbb16" PRIMARY KEY ("xcpNgPoolOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b29c2e0e197211e01dade02e18" ON "XcpNgPoolOwnerRuleOwnerUser" ("xcpNgPoolOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc2b374b4a209143f1b3d218d8" ON "XcpNgPoolOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolOwnerRuleOwnerTeam" ("xcpNgPoolOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_e6263ab8ab8935f3141128463a4" PRIMARY KEY ("xcpNgPoolOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86fb7146f79c0cb5fc237625a3" ON "XcpNgPoolOwnerRuleOwnerTeam" ("xcpNgPoolOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2983afccbbf507a3361fcde6d" ON "XcpNgPoolOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel" ("xcpNgPoolLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_5f7b89c4f903f5687df982bcffa" PRIMARY KEY ("xcpNgPoolLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ee86e7798f001b3fdcf05de9f" ON "XcpNgPoolLabelRuleXcpNgPoolLabel" ("xcpNgPoolLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_10686568f6aae008b6258366ee" ON "XcpNgPoolLabelRuleXcpNgPoolLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "XcpNgPoolLabelRuleLabelToAdd" ("xcpNgPoolLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2608d4ea0d0b2386fb12cf5500f" PRIMARY KEY ("xcpNgPoolLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d7cb2b1e4a73eee06627ba5217" ON "XcpNgPoolLabelRuleLabelToAdd" ("xcpNgPoolLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e5da35e01c29cf5fad5bbd748" ON "XcpNgPoolLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD CONSTRAINT "FK_d1afd6e851e572876c3c9f08148" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD CONSTRAINT "FK_ea70a3305eb6f98af781eef1862" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" ADD CONSTRAINT "FK_c2cf9cf6877b9532938339f2c48" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" ADD CONSTRAINT "FK_46f31d5661066d7d4bc85b8d156" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" ADD CONSTRAINT "FK_ad3a651441524a83a88f0ba0e60" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" ADD CONSTRAINT "FK_0a04c55b9d10342eb1735845174" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" ADD CONSTRAINT "FK_ba01cd085e2fb536181623d0bcb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" ADD CONSTRAINT "FK_243096b92b0399eb1904dd4d80c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" ADD CONSTRAINT "FK_45a3c7e21009297a46bba5d8ee2" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" ADD CONSTRAINT "FK_3ad5964291f8d910e5cbf9e89ea" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" ADD CONSTRAINT "FK_063684f840f9a0504fa35c22a61" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD CONSTRAINT "FK_923a7fcd4e3f818309d1bbfeaf7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD CONSTRAINT "FK_6dae172e9da61680f2e37d343e5" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" ADD CONSTRAINT "FK_21871e78112644b7c4c3ba942a8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRule" ADD CONSTRAINT "FK_8b0fe6787eed9dbeebf747120f0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRule" ADD CONSTRAINT "FK_e6ab1a3d4791222bfd453c1fe71" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRule" ADD CONSTRAINT "FK_8fff93e2f42a61e59c42624c9b7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRule" ADD CONSTRAINT "FK_083ed03c5356cd7e5a01c05fa8e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" ADD CONSTRAINT "FK_325709b32dbde80da86a0d6dc8f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" ADD CONSTRAINT "FK_ab5b471a59190bae34a78e49009" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" ADD CONSTRAINT "FK_e46891064219e7f855f82dbc3c8" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" ADD CONSTRAINT "FK_62a9556cabfdc593aaa69a6473e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabel" ADD CONSTRAINT "FK_6c407ad162786f7a8851593f57f" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabel" ADD CONSTRAINT "FK_ce804b1ced1eb313fd224be0385" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorXcpNgPool" ADD CONSTRAINT "FK_8571d304e69e765d85c1652af6d" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorXcpNgPool" ADD CONSTRAINT "FK_96ce58e7a8e199efeb1c307cbc3" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentXcpNgPool" ADD CONSTRAINT "FK_005e9c9f5acdbce3367993308fd" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentXcpNgPool" ADD CONSTRAINT "FK_5665900945e3833da61c8527c33" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertXcpNgPool" ADD CONSTRAINT "FK_1e8ec487cb231878bc38630e936" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertXcpNgPool" ADD CONSTRAINT "FK_4b9da87488d3312d769d9d1b1d5" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceXcpNgPool" ADD CONSTRAINT "FK_8a134f0b921f3cf3deb11461230" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceXcpNgPool" ADD CONSTRAINT "FK_bd7e0e2dbd0389b782f256cdd2d" FOREIGN KEY ("xcpNgPoolId") REFERENCES "XcpNgPool"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel" ADD CONSTRAINT "FK_ea1cd251a676b7fd94670205766" FOREIGN KEY ("xcpNgPoolOwnerRuleId") REFERENCES "XcpNgPoolOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel" ADD CONSTRAINT "FK_f6314d42d6534cc1f3401c36d10" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerUser" ADD CONSTRAINT "FK_b29c2e0e197211e01dade02e180" FOREIGN KEY ("xcpNgPoolOwnerRuleId") REFERENCES "XcpNgPoolOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerUser" ADD CONSTRAINT "FK_cc2b374b4a209143f1b3d218d83" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_86fb7146f79c0cb5fc237625a35" FOREIGN KEY ("xcpNgPoolOwnerRuleId") REFERENCES "XcpNgPoolOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_d2983afccbbf507a3361fcde6da" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel" ADD CONSTRAINT "FK_2ee86e7798f001b3fdcf05de9f3" FOREIGN KEY ("xcpNgPoolLabelRuleId") REFERENCES "XcpNgPoolLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel" ADD CONSTRAINT "FK_10686568f6aae008b6258366ee1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleLabelToAdd" ADD CONSTRAINT "FK_d7cb2b1e4a73eee06627ba52175" FOREIGN KEY ("xcpNgPoolLabelRuleId") REFERENCES "XcpNgPoolLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleLabelToAdd" ADD CONSTRAINT "FK_0e5da35e01c29cf5fad5bbd748a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleLabelToAdd" DROP CONSTRAINT "FK_0e5da35e01c29cf5fad5bbd748a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleLabelToAdd" DROP CONSTRAINT "FK_d7cb2b1e4a73eee06627ba52175"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel" DROP CONSTRAINT "FK_10686568f6aae008b6258366ee1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel" DROP CONSTRAINT "FK_2ee86e7798f001b3fdcf05de9f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_d2983afccbbf507a3361fcde6da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_86fb7146f79c0cb5fc237625a35"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerUser" DROP CONSTRAINT "FK_cc2b374b4a209143f1b3d218d83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleOwnerUser" DROP CONSTRAINT "FK_b29c2e0e197211e01dade02e180"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel" DROP CONSTRAINT "FK_f6314d42d6534cc1f3401c36d10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel" DROP CONSTRAINT "FK_ea1cd251a676b7fd94670205766"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceXcpNgPool" DROP CONSTRAINT "FK_bd7e0e2dbd0389b782f256cdd2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceXcpNgPool" DROP CONSTRAINT "FK_8a134f0b921f3cf3deb11461230"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertXcpNgPool" DROP CONSTRAINT "FK_4b9da87488d3312d769d9d1b1d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertXcpNgPool" DROP CONSTRAINT "FK_1e8ec487cb231878bc38630e936"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentXcpNgPool" DROP CONSTRAINT "FK_5665900945e3833da61c8527c33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentXcpNgPool" DROP CONSTRAINT "FK_005e9c9f5acdbce3367993308fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorXcpNgPool" DROP CONSTRAINT "FK_96ce58e7a8e199efeb1c307cbc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorXcpNgPool" DROP CONSTRAINT "FK_8571d304e69e765d85c1652af6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabel" DROP CONSTRAINT "FK_ce804b1ced1eb313fd224be0385"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabel" DROP CONSTRAINT "FK_6c407ad162786f7a8851593f57f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" DROP CONSTRAINT "FK_62a9556cabfdc593aaa69a6473e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" DROP CONSTRAINT "FK_e46891064219e7f855f82dbc3c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" DROP CONSTRAINT "FK_ab5b471a59190bae34a78e49009"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolFeed" DROP CONSTRAINT "FK_325709b32dbde80da86a0d6dc8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRule" DROP CONSTRAINT "FK_083ed03c5356cd7e5a01c05fa8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolLabelRule" DROP CONSTRAINT "FK_8fff93e2f42a61e59c42624c9b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRule" DROP CONSTRAINT "FK_e6ab1a3d4791222bfd453c1fe71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerRule" DROP CONSTRAINT "FK_8b0fe6787eed9dbeebf747120f0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP CONSTRAINT "FK_21871e78112644b7c4c3ba942a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP CONSTRAINT "FK_6dae172e9da61680f2e37d343e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgResource" DROP CONSTRAINT "FK_923a7fcd4e3f818309d1bbfeaf7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" DROP CONSTRAINT "FK_063684f840f9a0504fa35c22a61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" DROP CONSTRAINT "FK_3ad5964291f8d910e5cbf9e89ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" DROP CONSTRAINT "FK_45a3c7e21009297a46bba5d8ee2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerUser" DROP CONSTRAINT "FK_243096b92b0399eb1904dd4d80c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" DROP CONSTRAINT "FK_ba01cd085e2fb536181623d0bcb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" DROP CONSTRAINT "FK_0a04c55b9d10342eb1735845174"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" DROP CONSTRAINT "FK_ad3a651441524a83a88f0ba0e60"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPoolOwnerTeam" DROP CONSTRAINT "FK_46f31d5661066d7d4bc85b8d156"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP CONSTRAINT "FK_c2cf9cf6877b9532938339f2c48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP CONSTRAINT "FK_ea70a3305eb6f98af781eef1862"`,
    );
    await queryRunner.query(
      `ALTER TABLE "XcpNgPool" DROP CONSTRAINT "FK_d1afd6e851e572876c3c9f08148"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e5da35e01c29cf5fad5bbd748"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d7cb2b1e4a73eee06627ba5217"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_10686568f6aae008b6258366ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ee86e7798f001b3fdcf05de9f"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolLabelRuleXcpNgPoolLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2983afccbbf507a3361fcde6d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86fb7146f79c0cb5fc237625a3"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc2b374b4a209143f1b3d218d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b29c2e0e197211e01dade02e18"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6314d42d6534cc1f3401c36d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea1cd251a676b7fd9467020576"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerRuleXcpNgPoolLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd7e0e2dbd0389b782f256cdd2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a134f0b921f3cf3deb1146123"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceXcpNgPool"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b9da87488d3312d769d9d1b1d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1e8ec487cb231878bc38630e93"`,
    );
    await queryRunner.query(`DROP TABLE "AlertXcpNgPool"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5665900945e3833da61c8527c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_005e9c9f5acdbce3367993308f"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentXcpNgPool"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96ce58e7a8e199efeb1c307cbc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8571d304e69e765d85c1652af6"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorXcpNgPool"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce804b1ced1eb313fd224be038"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c407ad162786f7a8851593f57"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe4900e838831acb96761cb4f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab5b471a59190bae34a78e4900"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_325709b32dbde80da86a0d6dc8"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c617efbb4705d98d750f75371"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aabc9f4fae00a4db5b07d943ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fff93e2f42a61e59c42624c9b"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_289d30040adf7e898ba9344af3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d11d3018e67b58b6d62dc8f9a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b0fe6787eed9dbeebf747120f"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6bb0bcd78925d685855e9d9e6f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dae172e9da61680f2e37d343e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_923a7fcd4e3f818309d1bbfeaf"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3270f76aa7696a27036a314d37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be6a038521a95261bbc59e2b97"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ad5964291f8d910e5cbf9e89e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_45a3c7e21009297a46bba5d8ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_243096b92b0399eb1904dd4d80"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19bb8407000a806a51e627d89a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d7949ac45bbbd3587335326a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a04c55b9d10342eb173584517"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ad3a651441524a83a88f0ba0e6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46f31d5661066d7d4bc85b8d15"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPoolOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_367c1c6c77b2d00ec4fa8abd74"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c05a4252de6a9682cd9374dfe8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d5e1ea781cd60f4606d9a9cbb"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_xcp_ng_pool_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28a971cdf9e901231b5d3fa5fa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a48de5e2bd9cc7b3aad829307"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d1afd6e851e572876c3c9f0814"`,
    );
    await queryRunner.query(`DROP TABLE "XcpNgPool"`);
  }
}
