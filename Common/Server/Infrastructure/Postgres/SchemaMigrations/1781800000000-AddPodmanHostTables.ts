import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Podman Hosts monitoring product: a faithful parallel of the DockerHost
 * product. A row per monitored Podman host, auto-discovered at OTel ingest
 * from the `host.name` resource attribute (carried via the
 * `oneuptime.podman.*` attribute namespace) or manually registered. Columns,
 * indexes and FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/PodmanHost.ts, PodmanResource.ts,
 * PodmanHostOwnerTeam.ts, PodmanHostOwnerUser.ts, PodmanHostOwnerRule.ts and
 * PodmanHostLabelRule.ts. The later DockerHost column-add migrations
 * (agentVersion, retainTelemetryDataForDays, telemetryRetentionConfig) are
 * folded into the PodmanHost create. Constraint/index names use readable
 * `*_podman_*` identifiers so they stay globally unique (never reuse Docker's
 * hashes).
 */
export class AddPodmanHostTables1781800000000 implements MigrationInterface {
  public name = "AddPodmanHostTables1781800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Podman host table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHost" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "hostIdentifier" character varying(100) NOT NULL, "otelCollectorStatus" character varying(100) DEFAULT 'disconnected', "agentVersion" character varying(100), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "containersRunning" integer DEFAULT '0', "containersStopped" integer DEFAULT '0', "containersPaused" integer DEFAULT '0', "osType" character varying(100), "osVersion" character varying(500), "retainTelemetryDataForDays" integer, "telemetryRetentionConfig" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_podman_host_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_projectId" ON "PodmanHost" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_hostIdentifier" ON "PodmanHost" ("hostIdentifier")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_podman_host_slug" ON "PodmanHost" ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Podman host label join table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostLabel" ("podmanHostId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_podman_host_label" PRIMARY KEY ("podmanHostId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_podmanHostId" ON "PodmanHostLabel" ("podmanHostId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_labelId" ON "PodmanHostLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Podman resource (container/image/network/volume inventory) table.
    await queryRunner.query(
      `CREATE TABLE "PodmanResource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "name" character varying(100) NOT NULL, "containerId" character varying(100), "imageName" character varying(100), "state" character varying(100), "labels" jsonb, "latestCpuPercent" numeric, "latestMemoryBytes" bigint, "metricsUpdatedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "resourceCreationTimestamp" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_podman_resource_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_resource_projectId" ON "PodmanResource" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_resource_podmanHostId" ON "PodmanResource" ("podmanHostId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_podman_resource_projectId_podmanHostId_kind_name" ON "PodmanResource" ("projectId", "podmanHostId", "kind", "name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // Podman host owner team table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_podman_host_owner_team_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_projectId" ON "PodmanHostOwnerTeam" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_teamId" ON "PodmanHostOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_podmanHostId" ON "PodmanHostOwnerTeam" ("podmanHostId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_isOwnerNotified" ON "PodmanHostOwnerTeam" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // Podman host owner user table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_podman_host_owner_user_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_projectId" ON "PodmanHostOwnerUser" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_userId" ON "PodmanHostOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_podmanHostId" ON "PodmanHostOwnerUser" ("podmanHostId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_isOwnerNotified" ON "PodmanHostOwnerUser" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // Podman host owner rule table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "podmanHostNamePattern" character varying(500), "podmanHostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_podman_host_owner_rule_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_projectId" ON "PodmanHostOwnerRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_name" ON "PodmanHostOwnerRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_isEnabled" ON "PodmanHostOwnerRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // Podman host owner rule -> podman host label junction.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerRulePodmanHostLabel" ("podmanHostOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_podman_host_owner_rule_label" PRIMARY KEY ("podmanHostOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_label_ruleId" ON "PodmanHostOwnerRulePodmanHostLabel" ("podmanHostOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_label_labelId" ON "PodmanHostOwnerRulePodmanHostLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_owner_rule_label_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_owner_rule_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Podman host owner rule -> owner user junction.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerRuleOwnerUser" ("podmanHostOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_podman_host_owner_rule_owner_user" PRIMARY KEY ("podmanHostOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_user_ruleId" ON "PodmanHostOwnerRuleOwnerUser" ("podmanHostOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_user_userId" ON "PodmanHostOwnerRuleOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_user_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Podman host owner rule -> owner team junction.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostOwnerRuleOwnerTeam" ("podmanHostOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_podman_host_owner_rule_owner_team" PRIMARY KEY ("podmanHostOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_team_ruleId" ON "PodmanHostOwnerRuleOwnerTeam" ("podmanHostOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_team_teamId" ON "PodmanHostOwnerRuleOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_team_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Podman host label rule table.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "podmanHostNamePattern" character varying(500), "podmanHostDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_podman_host_label_rule_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_projectId" ON "PodmanHostLabelRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_name" ON "PodmanHostLabelRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_isEnabled" ON "PodmanHostLabelRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );

    // Podman host label rule -> podman host label junction.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostLabelRulePodmanHostLabel" ("podmanHostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_podman_host_label_rule_label" PRIMARY KEY ("podmanHostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_ruleId" ON "PodmanHostLabelRulePodmanHostLabel" ("podmanHostLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_labelId" ON "PodmanHostLabelRulePodmanHostLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_rule_label_ruleId" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_rule_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // Podman host label rule -> labels-to-add junction.
    await queryRunner.query(
      `CREATE TABLE "PodmanHostLabelRuleLabelToAdd" ("podmanHostLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_podman_host_label_rule_label_to_add" PRIMARY KEY ("podmanHostLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_to_add_ruleId" ON "PodmanHostLabelRuleLabelToAdd" ("podmanHostLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_to_add_labelId" ON "PodmanHostLabelRuleLabelToAdd" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_podman_host_label_rule_label_to_add_ruleId" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_podman_host_label_rule_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Podman host label rule -> labels-to-add junction.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_podman_host_label_rule_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_podman_host_label_rule_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_to_add_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostLabelRuleLabelToAdd"`);

    // Podman host label rule -> podman host label junction.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_rule_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostLabelRulePodmanHostLabel"`);

    // Podman host label rule table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostLabelRule"`);

    // Podman host owner rule -> owner team junction.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_team_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerRuleOwnerTeam"`);

    // Podman host owner rule -> owner user junction.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_user_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerRuleOwnerUser"`);

    // Podman host owner rule -> podman host label junction.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_owner_rule_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_owner_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_label_ruleId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerRulePodmanHostLabel"`);

    // Podman host owner rule table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerRule"`);

    // Podman host owner user table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerUser"`);

    // Podman host owner team table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostOwnerTeam"`);

    // Podman resource table.
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_projectId_podmanHostId_kind_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanResource"`);

    // Podman host label join table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_podmanHostId"`,
    );
    await queryRunner.query(`DROP TABLE "PodmanHostLabel"`);

    // Podman host table.
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_podman_host_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_hostIdentifier"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_podman_host_projectId"`);
    await queryRunner.query(`DROP TABLE "PodmanHost"`);
  }
}
