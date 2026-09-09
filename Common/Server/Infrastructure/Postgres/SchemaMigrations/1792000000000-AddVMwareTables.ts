import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * VMware product tables (generated with `npm run generate-postgres-migration`
 * against a fully migrated database, then renamed — the DDL is untouched).
 *
 * Creates the vCenter parent table (VMwareVCenter: auto-registered at OTel
 * ingest from the agent-stamped `vmware.vcenter.name` resource attribute,
 * with snapshot counters, archive columns, labels and retention overrides),
 * the VMwareResource inventory table (one row per datacenter / cluster /
 * ESXi host / virtual machine / datastore / resource pool, upserted from the
 * OTel Collector vcenter receiver's metrics), the activity feed, the owner
 * user / team tables, the owner and label rule engines with their join
 * tables, the vCenter<->Label join table, and the affected-resource join
 * tables on Incident / Alert / ScheduledMaintenance.
 *
 * The partial UNIQUE slug index (IDX_vmware_vcenter_slug) and the
 * UNIQUE (projectId, name) index are created here from the start so the
 * ingest-time find-or-create has a DB-level guard against concurrent
 * registration of the same vCenter.
 */
export class AddVMwareTables1792000000000 implements MigrationInterface {
  public name: string = "AddVMwareTables1792000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenter" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "datacenterCount" integer DEFAULT '0', "clusterCount" integer DEFAULT '0', "hostCount" integer DEFAULT '0', "vmCount" integer DEFAULT '0', "poweredOnVmCount" integer DEFAULT '0', "datastoreCount" integer DEFAULT '0', "resourcePoolCount" integer DEFAULT '0', "datastoreCapacityBytes" bigint, "datastoreUsedBytes" bigint, "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "archivedByUserId" uuid, "deletedByUserId" uuid, "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, CONSTRAINT "PK_a45c37d66c8725f0db108c4fd28" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ebde3cca51a976cf8f2945f587" ON "VMwareVCenter" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25441f5256aa58b0fb0d6575e3" ON "VMwareVCenter" ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_vmware_vcenter_slug" ON "VMwareVCenter" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e610ff2dac4b0c65d03421c9af" ON "VMwareVCenter" ("projectId", "isArchived") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_43a576c6d8eefe69073e4f7c57" ON "VMwareVCenter" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_7d40ccc6169d860892dfc4d3f2e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_68a1c15ddbb43c745bfa6980e0" ON "VMwareVCenterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fcf691b188bf760cd1b9a0c2b" ON "VMwareVCenterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3acf46cc10b9ad9b765096cc72" ON "VMwareVCenterOwnerTeam" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_70038764753e4dcc6710390cea" ON "VMwareVCenterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_9dd99632feccffdd1ea2406213e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_481bf735b91f03e4ffee94590e" ON "VMwareVCenterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5182227d21467991855a65352b" ON "VMwareVCenterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3304f6727fda9ac02b1cf2bf85" ON "VMwareVCenterOwnerUser" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee69c39f09218e7b1ee19bded2" ON "VMwareVCenterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "externalId" character varying(100) NOT NULL, "name" character varying(100), "datacenterName" character varying(100), "clusterName" character varying(100), "hostName" character varying(100), "resourcePoolName" character varying(100), "resourcePoolPath" character varying(500), "virtualAppName" character varying(100), "vmInstanceUuid" character varying(100), "isTemplate" boolean, "isPoweredOn" boolean, "latestCpuPercent" numeric, "latestCpuMhz" integer, "cpuCapacityMhz" integer, "cpuEffectiveMhz" integer, "latestMemoryBytes" bigint, "maxMemoryBytes" bigint, "memoryEffectiveBytes" bigint, "latestMemoryPercent" numeric, "latestDiskBytes" bigint, "maxDiskBytes" bigint, "latestDiskPercent" numeric, "cpuReadinessPercent" numeric, "memoryBalloonedBytes" bigint, "memorySwappedBytes" bigint, "hostCount" integer, "effectiveHostCount" integer, "poweredOnHostCount" integer, "vmCount" integer, "poweredOnVmCount" integer, "vmTemplateCount" integer, "datastoreCount" integer, "clusterCount" integer, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_18fe1ee9fb3c4349b3e58578ad0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fee43e1ac4ff94f40b34e3e57c" ON "VMwareResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c5e31c3cc9d53680b66c11c43" ON "VMwareResource" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_47d6d793575d081c7ea23e8ba5" ON "VMwareResource" ("projectId", "vmwareVCenterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "vmwareVCenterNamePattern" character varying(500), "vmwareVCenterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_e2c147f1f63c82765d95e13c31e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f4bd37ae1c8aa3d567f768ee7" ON "VMwareVCenterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd20ac50d453f6fc2fc863c008" ON "VMwareVCenterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1993170bc5f4f30774879bc3e" ON "VMwareVCenterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "vmwareVCenterNamePattern" character varying(500), "vmwareVCenterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_7285b14131a3fda82362360b372" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb71bee62ec437d4e5da8605d1" ON "VMwareVCenterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_efdaa99d77ff81c6a597ba27eb" ON "VMwareVCenterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_718c9a8bacba4eb306f6d144c1" ON "VMwareVCenterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "feedInfoInMarkdown" text NOT NULL, "moreInformationInMarkdown" text, "vmwareVCenterFeedEventType" character varying NOT NULL, "displayColor" character varying(10) NOT NULL, "userId" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3ca5df5d16ac85925437a901cef" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b00c3813c1ab83b5aa34e9ff7" ON "VMwareVCenterFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6225a18334f70b2ce9683ad8e3" ON "VMwareVCenterFeed" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4036a6241e3fdf8a9bcb972120" ON "VMwareVCenterFeed" ("vmwareVCenterId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterLabel" ("vmwareVCenterId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_9b241d78f128b45e434d912efcb" PRIMARY KEY ("vmwareVCenterId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_614230d30da73ac922c82c3911" ON "VMwareVCenterLabel" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb729334d594c756fbf7e83668" ON "VMwareVCenterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentVMwareVCenter" ("incidentId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, CONSTRAINT "PK_48ebdc56e14b4271a02e2b4bc8c" PRIMARY KEY ("incidentId", "vmwareVCenterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b72488863c2d20aa20cef3fddd" ON "IncidentVMwareVCenter" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7624d4afb8835886d2ceef6496" ON "IncidentVMwareVCenter" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AlertVMwareVCenter" ("alertId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, CONSTRAINT "PK_2a52e89ee5c0936fef38dd7130d" PRIMARY KEY ("alertId", "vmwareVCenterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a89c6401d1435a472a2beb5964" ON "AlertVMwareVCenter" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfd6b07252f7c367e5fae791cf" ON "AlertVMwareVCenter" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceVMwareVCenter" ("scheduledMaintenanceId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, CONSTRAINT "PK_0aefe26d2acb0ecd7248e2d936e" PRIMARY KEY ("scheduledMaintenanceId", "vmwareVCenterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d174c3e986ac59bd589b608a08" ON "ScheduledMaintenanceVMwareVCenter" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dabdf6d24d4009a535eca7d9b9" ON "ScheduledMaintenanceVMwareVCenter" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel" ("vmwareVCenterOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_265b424fb6ed23f5317fd1090d1" PRIMARY KEY ("vmwareVCenterOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_214c2210650d7f16b6b81a58e9" ON "VMwareVCenterOwnerRuleVMwareVCenterLabel" ("vmwareVCenterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2caf4ef259dc77f6c5ece71bc" ON "VMwareVCenterOwnerRuleVMwareVCenterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerRuleOwnerUser" ("vmwareVCenterOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_36c4b790a133f65912d02db4de6" PRIMARY KEY ("vmwareVCenterOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bc9288e4b14a86cfc85319a695" ON "VMwareVCenterOwnerRuleOwnerUser" ("vmwareVCenterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_067d77eb69b92c5203088c6259" ON "VMwareVCenterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterOwnerRuleOwnerTeam" ("vmwareVCenterOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_e556f09b44b539041efcfb8d8d1" PRIMARY KEY ("vmwareVCenterOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aee374a9155e5fede8adacef17" ON "VMwareVCenterOwnerRuleOwnerTeam" ("vmwareVCenterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1596bdc00617e67e455aa4d8ce" ON "VMwareVCenterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel" ("vmwareVCenterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_2336dd37552e305f87b63da0f10" PRIMARY KEY ("vmwareVCenterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dc28c62e3b91981f8438884860" ON "VMwareVCenterLabelRuleVMwareVCenterLabel" ("vmwareVCenterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ac2dddaebcc0a4881cbd47597" ON "VMwareVCenterLabelRuleVMwareVCenterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "VMwareVCenterLabelRuleLabelToAdd" ("vmwareVCenterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_6b6162af2bb86c01b472d8e2bd0" PRIMARY KEY ("vmwareVCenterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_137001fb6ddb16551535494a56" ON "VMwareVCenterLabelRuleLabelToAdd" ("vmwareVCenterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a7700a926c3d0cf32d1d38c81" ON "VMwareVCenterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD CONSTRAINT "FK_ebde3cca51a976cf8f2945f587f" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD CONSTRAINT "FK_6447bf354373d4bc93ad97096ee" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD CONSTRAINT "FK_2579451ec1a164e0a0e72f49b8c" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD CONSTRAINT "FK_d131b6ffe4448dbfdab9132a0f3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" ADD CONSTRAINT "FK_68a1c15ddbb43c745bfa6980e00" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" ADD CONSTRAINT "FK_4fcf691b188bf760cd1b9a0c2b7" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" ADD CONSTRAINT "FK_3acf46cc10b9ad9b765096cc72c" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" ADD CONSTRAINT "FK_19f919c2517f9b8fdc5142e04d9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" ADD CONSTRAINT "FK_391feff77ffeb24d2a56c67d94f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" ADD CONSTRAINT "FK_481bf735b91f03e4ffee94590eb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" ADD CONSTRAINT "FK_5182227d21467991855a65352b3" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" ADD CONSTRAINT "FK_3304f6727fda9ac02b1cf2bf85a" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" ADD CONSTRAINT "FK_5dc8f7325fa7de7edbeef98b175" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" ADD CONSTRAINT "FK_753270bf2caf7598eee9b883556" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_fee43e1ac4ff94f40b34e3e57ce" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_0c5e31c3cc9d53680b66c11c436" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_2c1d8565561a1a421fcb41ab849" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD CONSTRAINT "FK_9f014fc5335e861cd69d8008201" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" ADD CONSTRAINT "FK_4f4bd37ae1c8aa3d567f768ee77" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" ADD CONSTRAINT "FK_f2086e1b5342bb2fe731ffc356b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" ADD CONSTRAINT "FK_df0a3a3826c13ed4a346544a901" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" ADD CONSTRAINT "FK_cb71bee62ec437d4e5da8605d16" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" ADD CONSTRAINT "FK_d6f446503d11600573a07020c13" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" ADD CONSTRAINT "FK_020e1c7fc7547a87b60554351f3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" ADD CONSTRAINT "FK_7b00c3813c1ab83b5aa34e9ff71" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" ADD CONSTRAINT "FK_6225a18334f70b2ce9683ad8e30" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" ADD CONSTRAINT "FK_268ab8a94ea1845ca51686f2f3f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" ADD CONSTRAINT "FK_2f5b4ee977f72fdc819935bebc5" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" ADD CONSTRAINT "FK_db3722c108b8ec6e8b6a6683b95" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabel" ADD CONSTRAINT "FK_614230d30da73ac922c82c39114" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabel" ADD CONSTRAINT "FK_bb729334d594c756fbf7e83668c" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVMwareVCenter" ADD CONSTRAINT "FK_b72488863c2d20aa20cef3fddd5" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVMwareVCenter" ADD CONSTRAINT "FK_7624d4afb8835886d2ceef64960" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVMwareVCenter" ADD CONSTRAINT "FK_a89c6401d1435a472a2beb59649" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVMwareVCenter" ADD CONSTRAINT "FK_dfd6b07252f7c367e5fae791cf9" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceVMwareVCenter" ADD CONSTRAINT "FK_d174c3e986ac59bd589b608a08d" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceVMwareVCenter" ADD CONSTRAINT "FK_dabdf6d24d4009a535eca7d9b9d" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel" ADD CONSTRAINT "FK_214c2210650d7f16b6b81a58e95" FOREIGN KEY ("vmwareVCenterOwnerRuleId") REFERENCES "VMwareVCenterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel" ADD CONSTRAINT "FK_d2caf4ef259dc77f6c5ece71bc1" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_bc9288e4b14a86cfc85319a695b" FOREIGN KEY ("vmwareVCenterOwnerRuleId") REFERENCES "VMwareVCenterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_067d77eb69b92c5203088c6259c" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_aee374a9155e5fede8adacef177" FOREIGN KEY ("vmwareVCenterOwnerRuleId") REFERENCES "VMwareVCenterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_1596bdc00617e67e455aa4d8ce2" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel" ADD CONSTRAINT "FK_dc28c62e3b91981f84388848603" FOREIGN KEY ("vmwareVCenterLabelRuleId") REFERENCES "VMwareVCenterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel" ADD CONSTRAINT "FK_9ac2dddaebcc0a4881cbd475972" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_137001fb6ddb16551535494a56f" FOREIGN KEY ("vmwareVCenterLabelRuleId") REFERENCES "VMwareVCenterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_4a7700a926c3d0cf32d1d38c816" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_4a7700a926c3d0cf32d1d38c816"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_137001fb6ddb16551535494a56f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel" DROP CONSTRAINT "FK_9ac2dddaebcc0a4881cbd475972"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel" DROP CONSTRAINT "FK_dc28c62e3b91981f84388848603"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_1596bdc00617e67e455aa4d8ce2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_aee374a9155e5fede8adacef177"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_067d77eb69b92c5203088c6259c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_bc9288e4b14a86cfc85319a695b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel" DROP CONSTRAINT "FK_d2caf4ef259dc77f6c5ece71bc1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel" DROP CONSTRAINT "FK_214c2210650d7f16b6b81a58e95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceVMwareVCenter" DROP CONSTRAINT "FK_dabdf6d24d4009a535eca7d9b9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceVMwareVCenter" DROP CONSTRAINT "FK_d174c3e986ac59bd589b608a08d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVMwareVCenter" DROP CONSTRAINT "FK_dfd6b07252f7c367e5fae791cf9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertVMwareVCenter" DROP CONSTRAINT "FK_a89c6401d1435a472a2beb59649"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVMwareVCenter" DROP CONSTRAINT "FK_7624d4afb8835886d2ceef64960"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVMwareVCenter" DROP CONSTRAINT "FK_b72488863c2d20aa20cef3fddd5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabel" DROP CONSTRAINT "FK_bb729334d594c756fbf7e83668c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabel" DROP CONSTRAINT "FK_614230d30da73ac922c82c39114"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" DROP CONSTRAINT "FK_db3722c108b8ec6e8b6a6683b95"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" DROP CONSTRAINT "FK_2f5b4ee977f72fdc819935bebc5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" DROP CONSTRAINT "FK_268ab8a94ea1845ca51686f2f3f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" DROP CONSTRAINT "FK_6225a18334f70b2ce9683ad8e30"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterFeed" DROP CONSTRAINT "FK_7b00c3813c1ab83b5aa34e9ff71"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" DROP CONSTRAINT "FK_020e1c7fc7547a87b60554351f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" DROP CONSTRAINT "FK_d6f446503d11600573a07020c13"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterLabelRule" DROP CONSTRAINT "FK_cb71bee62ec437d4e5da8605d16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" DROP CONSTRAINT "FK_df0a3a3826c13ed4a346544a901"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" DROP CONSTRAINT "FK_f2086e1b5342bb2fe731ffc356b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerRule" DROP CONSTRAINT "FK_4f4bd37ae1c8aa3d567f768ee77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_9f014fc5335e861cd69d8008201"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_2c1d8565561a1a421fcb41ab849"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_0c5e31c3cc9d53680b66c11c436"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP CONSTRAINT "FK_fee43e1ac4ff94f40b34e3e57ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" DROP CONSTRAINT "FK_753270bf2caf7598eee9b883556"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" DROP CONSTRAINT "FK_5dc8f7325fa7de7edbeef98b175"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" DROP CONSTRAINT "FK_3304f6727fda9ac02b1cf2bf85a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" DROP CONSTRAINT "FK_5182227d21467991855a65352b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerUser" DROP CONSTRAINT "FK_481bf735b91f03e4ffee94590eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" DROP CONSTRAINT "FK_391feff77ffeb24d2a56c67d94f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" DROP CONSTRAINT "FK_19f919c2517f9b8fdc5142e04d9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" DROP CONSTRAINT "FK_3acf46cc10b9ad9b765096cc72c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" DROP CONSTRAINT "FK_4fcf691b188bf760cd1b9a0c2b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenterOwnerTeam" DROP CONSTRAINT "FK_68a1c15ddbb43c745bfa6980e00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP CONSTRAINT "FK_d131b6ffe4448dbfdab9132a0f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP CONSTRAINT "FK_2579451ec1a164e0a0e72f49b8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP CONSTRAINT "FK_6447bf354373d4bc93ad97096ee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP CONSTRAINT "FK_ebde3cca51a976cf8f2945f587f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a7700a926c3d0cf32d1d38c81"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_137001fb6ddb16551535494a56"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ac2dddaebcc0a4881cbd47597"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dc28c62e3b91981f8438884860"`,
    );
    await queryRunner.query(
      `DROP TABLE "VMwareVCenterLabelRuleVMwareVCenterLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1596bdc00617e67e455aa4d8ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aee374a9155e5fede8adacef17"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterOwnerRuleOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_067d77eb69b92c5203088c6259"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bc9288e4b14a86cfc85319a695"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2caf4ef259dc77f6c5ece71bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_214c2210650d7f16b6b81a58e9"`,
    );
    await queryRunner.query(
      `DROP TABLE "VMwareVCenterOwnerRuleVMwareVCenterLabel"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dabdf6d24d4009a535eca7d9b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d174c3e986ac59bd589b608a08"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceVMwareVCenter"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfd6b07252f7c367e5fae791cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a89c6401d1435a472a2beb5964"`,
    );
    await queryRunner.query(`DROP TABLE "AlertVMwareVCenter"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7624d4afb8835886d2ceef6496"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b72488863c2d20aa20cef3fddd"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentVMwareVCenter"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb729334d594c756fbf7e83668"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_614230d30da73ac922c82c3911"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4036a6241e3fdf8a9bcb972120"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6225a18334f70b2ce9683ad8e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b00c3813c1ab83b5aa34e9ff7"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterFeed"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_718c9a8bacba4eb306f6d144c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_efdaa99d77ff81c6a597ba27eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb71bee62ec437d4e5da8605d1"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterLabelRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1993170bc5f4f30774879bc3e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd20ac50d453f6fc2fc863c008"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f4bd37ae1c8aa3d567f768ee7"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterOwnerRule"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47d6d793575d081c7ea23e8ba5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c5e31c3cc9d53680b66c11c43"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fee43e1ac4ff94f40b34e3e57c"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareResource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee69c39f09218e7b1ee19bded2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3304f6727fda9ac02b1cf2bf85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5182227d21467991855a65352b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_481bf735b91f03e4ffee94590e"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterOwnerUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_70038764753e4dcc6710390cea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3acf46cc10b9ad9b765096cc72"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fcf691b188bf760cd1b9a0c2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_68a1c15ddbb43c745bfa6980e0"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenterOwnerTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43a576c6d8eefe69073e4f7c57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e610ff2dac4b0c65d03421c9af"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_vmware_vcenter_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25441f5256aa58b0fb0d6575e3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ebde3cca51a976cf8f2945f587"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareVCenter"`);
  }
}
