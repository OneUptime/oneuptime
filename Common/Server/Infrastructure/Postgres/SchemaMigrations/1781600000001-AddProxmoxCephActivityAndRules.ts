import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Proxmox + Ceph V2 (Internal/Roadmap/ProxmoxCephProductsV2.md):
 *
 * 1. WI-11 activity wiring — proxmoxClusters / cephClusters ManyToMany
 *    join tables on Alert, Incident and ScheduledMaintenance (cloned
 *    from the AlertKubernetesCluster / IncidentDockerHost shape in
 *    1779302536475-AttachKubernetesAndDockerToIncidentAndAlert).
 *
 * 2. WI-12 owner/label rule engines — ProxmoxClusterOwnerRule,
 *    ProxmoxClusterLabelRule, CephClusterOwnerRule, CephClusterLabelRule
 *    plus their matcher/action join tables (cloned from the
 *    KubernetesCluster rule tables in 1778784396629), and the owner join
 *    models ProxmoxClusterOwnerUser/OwnerTeam, CephClusterOwnerUser/
 *    OwnerTeam (cloned from KubernetesClusterOwnerUser/OwnerTeam in
 *    1776504277320).
 *
 * Columns/indexes/FKs are derived from the model decorators in
 * Common/Models/DatabaseModels/.
 */
export class AddProxmoxCephActivityAndRules1781600000001
  implements MigrationInterface
{
  public name = "AddProxmoxCephActivityAndRules1781600000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * ------------------------------------------------------------------
     * WI-11: activity ManyToMany join tables.
     * ------------------------------------------------------------------
     */

    // AlertProxmoxCluster
    await queryRunner.query(
      `CREATE TABLE "AlertProxmoxCluster" ("alertId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, CONSTRAINT "PK_alert_proxmox_cluster" PRIMARY KEY ("alertId", "proxmoxClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_proxmox_cluster_alertId" ON "AlertProxmoxCluster" ("alertId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_proxmox_cluster_proxmoxClusterId" ON "AlertProxmoxCluster" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_alert_proxmox_cluster_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_alert_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // AlertCephCluster
    await queryRunner.query(
      `CREATE TABLE "AlertCephCluster" ("alertId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, CONSTRAINT "PK_alert_ceph_cluster" PRIMARY KEY ("alertId", "cephClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_ceph_cluster_alertId" ON "AlertCephCluster" ("alertId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_ceph_cluster_cephClusterId" ON "AlertCephCluster" ("cephClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_alert_ceph_cluster_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_alert_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentProxmoxCluster
    await queryRunner.query(
      `CREATE TABLE "IncidentProxmoxCluster" ("incidentId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, CONSTRAINT "PK_incident_proxmox_cluster" PRIMARY KEY ("incidentId", "proxmoxClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_proxmox_cluster_incidentId" ON "IncidentProxmoxCluster" ("incidentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_proxmox_cluster_proxmoxClusterId" ON "IncidentProxmoxCluster" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_incident_proxmox_cluster_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_incident_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // IncidentCephCluster
    await queryRunner.query(
      `CREATE TABLE "IncidentCephCluster" ("incidentId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, CONSTRAINT "PK_incident_ceph_cluster" PRIMARY KEY ("incidentId", "cephClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_ceph_cluster_incidentId" ON "IncidentCephCluster" ("incidentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_ceph_cluster_cephClusterId" ON "IncidentCephCluster" ("cephClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_incident_ceph_cluster_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_incident_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ScheduledMaintenanceProxmoxCluster
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceProxmoxCluster" ("scheduledMaintenanceId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, CONSTRAINT "PK_sm_proxmox_cluster" PRIMARY KEY ("scheduledMaintenanceId", "proxmoxClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_proxmox_cluster_scheduledMaintenanceId" ON "ScheduledMaintenanceProxmoxCluster" ("scheduledMaintenanceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_proxmox_cluster_proxmoxClusterId" ON "ScheduledMaintenanceProxmoxCluster" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_sm_proxmox_cluster_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_sm_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ScheduledMaintenanceCephCluster
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceCephCluster" ("scheduledMaintenanceId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, CONSTRAINT "PK_sm_ceph_cluster" PRIMARY KEY ("scheduledMaintenanceId", "cephClusterId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_ceph_cluster_scheduledMaintenanceId" ON "ScheduledMaintenanceCephCluster" ("scheduledMaintenanceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_ceph_cluster_cephClusterId" ON "ScheduledMaintenanceCephCluster" ("cephClusterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_sm_ceph_cluster_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_sm_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * ------------------------------------------------------------------
     * WI-12: rule tables.
     * ------------------------------------------------------------------
     */

    // ProxmoxClusterOwnerRule
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "proxmoxClusterNamePattern" character varying(500), "proxmoxClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_proxmox_cluster_owner_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_projectId" ON "ProxmoxClusterOwnerRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_name" ON "ProxmoxClusterOwnerRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_isEnabled" ON "ProxmoxClusterOwnerRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ProxmoxClusterLabelRule
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "proxmoxClusterNamePattern" character varying(500), "proxmoxClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_proxmox_cluster_label_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_projectId" ON "ProxmoxClusterLabelRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_name" ON "ProxmoxClusterLabelRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_isEnabled" ON "ProxmoxClusterLabelRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // CephClusterOwnerRule
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "notifyOwners" boolean NOT NULL DEFAULT true, "cephClusterNamePattern" character varying(500), "cephClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ceph_cluster_owner_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_projectId" ON "CephClusterOwnerRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_name" ON "CephClusterOwnerRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_isEnabled" ON "CephClusterOwnerRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // CephClusterLabelRule
    await queryRunner.query(
      `CREATE TABLE "CephClusterLabelRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "isEnabled" boolean NOT NULL DEFAULT true, "cephClusterNamePattern" character varying(500), "cephClusterDescriptionPattern" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ceph_cluster_label_rule" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_projectId" ON "CephClusterLabelRule" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_name" ON "CephClusterLabelRule" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_isEnabled" ON "CephClusterLabelRule" ("isEnabled")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    /*
     * ------------------------------------------------------------------
     * WI-12: rule matcher/action join tables.
     * Abbreviations to stay under Postgres's 63-char identifier limit:
     * pcor = ProxmoxClusterOwnerRule, pclr = ProxmoxClusterLabelRule,
     * ccor = CephClusterOwnerRule,    cclr = CephClusterLabelRule.
     * ------------------------------------------------------------------
     */

    // ProxmoxClusterOwnerRuleProxmoxClusterLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("proxmoxClusterOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_pcor_cluster_label" PRIMARY KEY ("proxmoxClusterOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_cluster_label_ruleId" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("proxmoxClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_cluster_label_labelId" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pcor_cluster_label_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pcor_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ProxmoxClusterOwnerRuleOwnerUser
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerRuleOwnerUser" ("proxmoxClusterOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_pcor_owner_user" PRIMARY KEY ("proxmoxClusterOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_user_ruleId" ON "ProxmoxClusterOwnerRuleOwnerUser" ("proxmoxClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_user_userId" ON "ProxmoxClusterOwnerRuleOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_pcor_owner_user_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_pcor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ProxmoxClusterOwnerRuleOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ("proxmoxClusterOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_pcor_owner_team" PRIMARY KEY ("proxmoxClusterOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_team_ruleId" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("proxmoxClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_team_teamId" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_pcor_owner_team_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_pcor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ProxmoxClusterLabelRuleProxmoxClusterLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("proxmoxClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_pclr_cluster_label" PRIMARY KEY ("proxmoxClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_cluster_label_ruleId" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("proxmoxClusterLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_cluster_label_labelId" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pclr_cluster_label_ruleId" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pclr_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // ProxmoxClusterLabelRuleLabelToAdd (action labels)
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterLabelRuleLabelToAdd" ("proxmoxClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_pclr_label_to_add" PRIMARY KEY ("proxmoxClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_label_to_add_ruleId" ON "ProxmoxClusterLabelRuleLabelToAdd" ("proxmoxClusterLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_label_to_add_labelId" ON "ProxmoxClusterLabelRuleLabelToAdd" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_pclr_label_to_add_ruleId" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_pclr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // CephClusterOwnerRuleCephClusterLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerRuleCephClusterLabel" ("cephClusterOwnerRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_ccor_cluster_label" PRIMARY KEY ("cephClusterOwnerRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_cluster_label_ruleId" ON "CephClusterOwnerRuleCephClusterLabel" ("cephClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_cluster_label_labelId" ON "CephClusterOwnerRuleCephClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_ccor_cluster_label_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_ccor_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // CephClusterOwnerRuleOwnerUser
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerRuleOwnerUser" ("cephClusterOwnerRuleId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_ccor_owner_user" PRIMARY KEY ("cephClusterOwnerRuleId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_user_ruleId" ON "CephClusterOwnerRuleOwnerUser" ("cephClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_user_userId" ON "CephClusterOwnerRuleOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ccor_owner_user_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ccor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // CephClusterOwnerRuleOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerRuleOwnerTeam" ("cephClusterOwnerRuleId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_ccor_owner_team" PRIMARY KEY ("cephClusterOwnerRuleId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_team_ruleId" ON "CephClusterOwnerRuleOwnerTeam" ("cephClusterOwnerRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_team_teamId" ON "CephClusterOwnerRuleOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ccor_owner_team_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ccor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // CephClusterLabelRuleCephClusterLabel (matcher labels)
    await queryRunner.query(
      `CREATE TABLE "CephClusterLabelRuleCephClusterLabel" ("cephClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cclr_cluster_label" PRIMARY KEY ("cephClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_cluster_label_ruleId" ON "CephClusterLabelRuleCephClusterLabel" ("cephClusterLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_cluster_label_labelId" ON "CephClusterLabelRuleCephClusterLabel" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_cclr_cluster_label_ruleId" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_cclr_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    // CephClusterLabelRuleLabelToAdd (action labels)
    await queryRunner.query(
      `CREATE TABLE "CephClusterLabelRuleLabelToAdd" ("cephClusterLabelRuleId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cclr_label_to_add" PRIMARY KEY ("cephClusterLabelRuleId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_label_to_add_ruleId" ON "CephClusterLabelRuleLabelToAdd" ("cephClusterLabelRuleId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_label_to_add_labelId" ON "CephClusterLabelRuleLabelToAdd" ("labelId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_cclr_label_to_add_ruleId" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_cclr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    /*
     * ------------------------------------------------------------------
     * WI-12: owner join models (also the prerequisite for the Owners page
     * and useResourceOwners facets).
     * ------------------------------------------------------------------
     */

    // ProxmoxClusterOwnerUser
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_proxmox_cluster_owner_user" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_projectId" ON "ProxmoxClusterOwnerUser" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_userId" ON "ProxmoxClusterOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_proxmoxClusterId" ON "ProxmoxClusterOwnerUser" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_isOwnerNotified" ON "ProxmoxClusterOwnerUser" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ProxmoxClusterOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "ProxmoxClusterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "proxmoxClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_proxmox_cluster_owner_team" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_projectId" ON "ProxmoxClusterOwnerTeam" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_teamId" ON "ProxmoxClusterOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_proxmoxClusterId" ON "ProxmoxClusterOwnerTeam" ("proxmoxClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_isOwnerNotified" ON "ProxmoxClusterOwnerTeam" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // CephClusterOwnerUser
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerUser" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ceph_cluster_owner_user" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_projectId" ON "CephClusterOwnerUser" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_userId" ON "CephClusterOwnerUser" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_cephClusterId" ON "CephClusterOwnerUser" ("cephClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_isOwnerNotified" ON "CephClusterOwnerUser" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // CephClusterOwnerTeam
    await queryRunner.query(
      `CREATE TABLE "CephClusterOwnerTeam" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid NOT NULL, "cephClusterId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "isOwnerNotified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_ceph_cluster_owner_team" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_projectId" ON "CephClusterOwnerTeam" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_teamId" ON "CephClusterOwnerTeam" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_cephClusterId" ON "CephClusterOwnerTeam" ("cephClusterId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_isOwnerNotified" ON "CephClusterOwnerTeam" ("isOwnerNotified")`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Owner join models.
    await queryRunner.query(`DROP TABLE "CephClusterOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "CephClusterOwnerUser"`);
    await queryRunner.query(`DROP TABLE "ProxmoxClusterOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "ProxmoxClusterOwnerUser"`);

    // Rule matcher/action join tables.
    await queryRunner.query(`DROP TABLE "CephClusterLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP TABLE "CephClusterLabelRuleCephClusterLabel"`,
    );
    await queryRunner.query(`DROP TABLE "CephClusterOwnerRuleOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "CephClusterOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP TABLE "CephClusterOwnerRuleCephClusterLabel"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxClusterLabelRuleLabelToAdd"`);
    await queryRunner.query(
      `DROP TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel"`,
    );
    await queryRunner.query(`DROP TABLE "ProxmoxClusterOwnerRuleOwnerTeam"`);
    await queryRunner.query(`DROP TABLE "ProxmoxClusterOwnerRuleOwnerUser"`);
    await queryRunner.query(
      `DROP TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel"`,
    );

    // Rule tables.
    await queryRunner.query(`DROP TABLE "CephClusterLabelRule"`);
    await queryRunner.query(`DROP TABLE "CephClusterOwnerRule"`);
    await queryRunner.query(`DROP TABLE "ProxmoxClusterLabelRule"`);
    await queryRunner.query(`DROP TABLE "ProxmoxClusterOwnerRule"`);

    // Activity ManyToMany join tables.
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceCephCluster"`);
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceProxmoxCluster"`);
    await queryRunner.query(`DROP TABLE "IncidentCephCluster"`);
    await queryRunner.query(`DROP TABLE "IncidentProxmoxCluster"`);
    await queryRunner.query(`DROP TABLE "AlertCephCluster"`);
    await queryRunner.query(`DROP TABLE "AlertProxmoxCluster"`);
  }
}
