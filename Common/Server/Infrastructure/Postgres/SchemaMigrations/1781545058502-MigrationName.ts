import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1781545058502 implements MigrationInterface {
  public name = "MigrationName1781545058502";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_podman_host_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_podman_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_ceph_cluster_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_proxmox_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_proxmox_cluster_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_proxmox_cluster_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_proxmox_cluster_owner_team_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_proxmox_cluster_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_proxmox_cluster_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_proxmox_cluster_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_proxmox_cluster_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_proxmox_cluster_owner_user_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_proxmox_cluster_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_proxmox_cluster_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_proxmox_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_ceph_cluster_owner_team_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_ceph_cluster_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_ceph_cluster_owner_team_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_ceph_cluster_owner_team_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_ceph_cluster_owner_team_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ceph_cluster_owner_user_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ceph_cluster_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ceph_cluster_owner_user_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ceph_cluster_owner_user_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ceph_cluster_owner_user_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_ceph_resource_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_host_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_podman_host_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_podman_host_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_proxmox_cluster_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_proxmox_cluster_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_proxmox_cluster_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_proxmox_cluster_label_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_proxmox_cluster_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_proxmox_cluster_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_ceph_cluster_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_ceph_cluster_owner_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_ceph_cluster_owner_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_ceph_cluster_label_rule_projectId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_ceph_cluster_label_rule_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_ceph_cluster_label_rule_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_podmanHostId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_ceph_cluster_label_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_ceph_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_proxmox_cluster_label_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_proxmox_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_incident_podman_host_incident"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_incident_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" DROP CONSTRAINT "FK_incident_proxmox_cluster_incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" DROP CONSTRAINT "FK_incident_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" DROP CONSTRAINT "FK_incident_ceph_cluster_incidentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" DROP CONSTRAINT "FK_incident_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_incident_podman_resource_incident"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_incident_podman_resource_podmanResource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_alert_podman_host_alert"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_alert_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" DROP CONSTRAINT "FK_alert_proxmox_cluster_alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" DROP CONSTRAINT "FK_alert_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" DROP CONSTRAINT "FK_alert_ceph_cluster_alertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" DROP CONSTRAINT "FK_alert_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_alert_podman_resource_alert"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_alert_podman_resource_podmanResource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_scheduled_maintenance_podman_host_sm"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_scheduled_maintenance_podman_host_podmanHost"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" DROP CONSTRAINT "FK_sm_proxmox_cluster_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" DROP CONSTRAINT "FK_sm_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" DROP CONSTRAINT "FK_sm_ceph_cluster_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" DROP CONSTRAINT "FK_sm_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_owner_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_owner_rule_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_podman_host_owner_rule_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_podman_host_label_rule_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_podman_host_label_rule_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_podman_host_label_rule_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_pcor_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_pcor_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_pcor_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_pcor_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_pcor_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_pcor_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_pclr_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_pclr_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_pclr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_pclr_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" DROP CONSTRAINT "FK_ccor_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" DROP CONSTRAINT "FK_ccor_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_ccor_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_ccor_owner_user_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_ccor_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_ccor_owner_team_teamId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" DROP CONSTRAINT "FK_cclr_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" DROP CONSTRAINT "FK_cclr_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_cclr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_cclr_label_to_add_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_podman_host_projectId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_hostIdentifier"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_podman_host_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_resource_projectId_podmanHostId_kind_name"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_cluster_projectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_cluster_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_cluster_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_projectId_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_proxmox_cluster_name"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_proxmox_cluster_slug"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_projectId_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_team_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_user_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_resource_identity"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_team_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_team_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_team_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_user_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_user_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_user_isOwnerNotified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_resource_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_resource_cephClusterId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ceph_resource_identity"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_owner_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_rule_projectId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_rule_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_rule_isEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ceph_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_proxmox_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_host_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_proxmox_cluster_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_ceph_cluster_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_resource_incidentId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_podman_resource_podmanResourceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_host_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_proxmox_cluster_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_ceph_cluster_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_resource_alertId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_alert_podman_resource_podmanResourceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_podman_host_smId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_maintenance_podman_host_podmanHostId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_proxmox_cluster_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_proxmox_cluster_proxmoxClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_ceph_cluster_scheduledMaintenanceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sm_ceph_cluster_cephClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_user_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_user_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_team_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_owner_rule_owner_team_teamId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_podman_host_label_rule_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pcor_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pcor_cluster_label_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_pcor_owner_user_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_pcor_owner_user_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_pcor_owner_team_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_pcor_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pclr_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pclr_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pclr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pclr_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccor_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ccor_cluster_label_labelId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ccor_owner_user_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ccor_owner_user_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ccor_owner_team_ruleId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ccor_owner_team_teamId"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cclr_cluster_label_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cclr_cluster_label_labelId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cclr_label_to_add_ruleId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cclr_label_to_add_labelId"`,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentTemplatePodmanHost" ("incidentTemplateId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_7a529965548913ec1a47c66a83e" PRIMARY KEY ("incidentTemplateId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_684416928f6c99c022a9fcb956" ON "IncidentTemplatePodmanHost" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16a36a504da94535ccace7f3dd" ON "IncidentTemplatePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceTemplatePodmanHost" ("scheduledMaintenanceTemplateId" uuid NOT NULL, "podmanHostId" uuid NOT NULL, CONSTRAINT "PK_d47f2f3090b220630ed8fee7e3d" PRIMARY KEY ("scheduledMaintenanceTemplateId", "podmanHostId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c27b4872168d6e85283c622f77" ON "ScheduledMaintenanceTemplatePodmanHost" ("scheduledMaintenanceTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4d6ffbc8648a1c528163780df" ON "ScheduledMaintenanceTemplatePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_800ec09eb585cdb5e4c643ef51" ON "PodmanHost" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36e1b7bb9d9756649579d38eb5" ON "PodmanHost" ("hostIdentifier") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76c44007c314e08a38f281c2a2" ON "PodmanHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a26aefc1de15f94048ef3b45c" ON "PodmanHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9621e9bcc51de9020a80cbc2a3" ON "PodmanHostOwnerTeam" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1da42006705c332a4bcc96202" ON "PodmanHostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea369857823e55e8c21a27a3b7" ON "PodmanHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cecebbab6116b69a956486662" ON "PodmanHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6cd03329fe875288a708b233b4" ON "PodmanHostOwnerUser" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a737253768cdb2e73a9987ce3b" ON "PodmanHostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e634b27917c3b9e8097825843" ON "PodmanResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bed5c2772bfe0c0e830c3532b7" ON "PodmanResource" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_772c02b6419beb57fa47ccae1b" ON "PodmanResource" ("projectId", "podmanHostId", "kind", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_20216ec3277986d5ae08fd97bb" ON "CephCluster" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aafaa4bdec6d42b5770c41c61a" ON "CephCluster" ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6c21ee141871ea340e9fc64f1e" ON "CephCluster" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd63bd3b519ced2c486cf543e0" ON "ProxmoxCluster" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9de7a23debe809301538ef8368" ON "ProxmoxCluster" ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_56d036d93cc784c11884832364" ON "ProxmoxCluster" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_160397e8592834d4b98fc535f6" ON "ProxmoxClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca566ba685de7dd978b4baed08" ON "ProxmoxClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_491a7d288d0f1654c45bd3e6b4" ON "ProxmoxClusterOwnerTeam" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8c8fa15b899205a6b0ec6b59fc" ON "ProxmoxClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_21a264a4622ba591367825aa9e" ON "ProxmoxClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6bb75d46d3a511149a80b212b3" ON "ProxmoxClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_591eb5cdcff159dcb1a9114022" ON "ProxmoxClusterOwnerUser" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_201a165158883596a94abdaa8f" ON "ProxmoxClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46e791b3b6a3b0aa95d5ed6cc1" ON "ProxmoxResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25bbc77dc86c8c2de6ab1679e4" ON "ProxmoxResource" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_62a0ea57abd7d0da8b5284ab9e" ON "ProxmoxResource" ("projectId", "proxmoxClusterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e6608f1702b29208445ebedfe2" ON "CephClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4588e4038c85b41a6256e828d0" ON "CephClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f61243d7350fdf08ff36fa1e99" ON "CephClusterOwnerTeam" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_44bb972b76964d1270b61cefd9" ON "CephClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e73257d42affbb4b38f9188b9" ON "CephClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_29e85704dca21ea364785783fe" ON "CephClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cad804611b20c69d1f0a787712" ON "CephClusterOwnerUser" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66b88e08f836fcf752ddb1f8c3" ON "CephClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8be4ae9090dcd46257fb7f08c6" ON "CephResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cce1a652f3027d5fcfc1d73607" ON "CephResource" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_99d0abf478d3b07acf11e5d86b" ON "CephResource" ("projectId", "cephClusterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_93e77721dea2b48aa8343dcb1c" ON "PodmanHostOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35436c9438bca225598e8d3527" ON "PodmanHostOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15b1cd2e19609e816fe2a07fc6" ON "PodmanHostOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19e3a8fa3eb64d672086c0af8b" ON "PodmanHostLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a73a6f772ac704ec4ac7ad2c2f" ON "PodmanHostLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fbae97f871249243b0ff37d351" ON "PodmanHostLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd4333af455c31d4cded38ce98" ON "ProxmoxClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7807258051c6a7ed1f0a2d8192" ON "ProxmoxClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c5ac142817cff8d50fb900d674" ON "ProxmoxClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_edfb1d585dc24c8556d4e58cff" ON "ProxmoxClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c30ba63ee7922bb479dc102527" ON "ProxmoxClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5de020980441cfb158b38068da" ON "ProxmoxClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab0b9ae7420a3d2b9fab377aec" ON "CephClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de22ab53ad7d3b33e7191a6631" ON "CephClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ac11fdc69267ba6ba3cf18d1b6" ON "CephClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f83659d44dadb229a52c067d03" ON "CephClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba94a20640228182041a8bd943" ON "CephClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_172eae17e5baa493be1f1514ac" ON "CephClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_963be9e3b50017b2a557ca9e01" ON "PodmanHostLabel" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f020ddc2c90111560ca6c6c85" ON "PodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cdd58ac0c75e015836665ac34" ON "CephClusterLabel" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_193e7ab49242b2921fa74a376d" ON "CephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0dac439700a797d57a3e435250" ON "ProxmoxClusterLabel" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31b13695f386336f5931613add" ON "ProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9eb9f35b16317b0dfa52559fb7" ON "IncidentPodmanHost" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb62c596a88ac1fbecbf6e7b5e" ON "IncidentPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c785147c7c0f89c2d35f4b8e5" ON "IncidentProxmoxCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be19aae8dadb71f8ed1677dac3" ON "IncidentProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_860bf95d284d2576bfbf6b8282" ON "IncidentCephCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86dc37aa8f2fa9db0b80fa9ac0" ON "IncidentCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eaf5254c3134daa3a9b6b4a739" ON "IncidentPodmanResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0ec9d08d69cc9f2d471720f9e" ON "IncidentPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cda1d6f5a80bc5bdd5bca3acf" ON "AlertPodmanHost" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85a5c53459ff51c256023f2318" ON "AlertPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c83996a399a3fbff47cac5afb" ON "AlertProxmoxCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90e2c01e08dbe8d8f8ba2e71ab" ON "AlertProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_07f55cbd5789397c8f15b88084" ON "AlertCephCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aae64dd7cbf048a5d2dba1ae06" ON "AlertCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_376e4cea18a6af797b7ea7ccd0" ON "AlertPodmanResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05fbcff360b0be1652c8948b8a" ON "AlertPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_570b3e04f016052bf8ef7bf70a" ON "ScheduledMaintenancePodmanHost" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c12b4d3465796bbbabba37ffe6" ON "ScheduledMaintenancePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4909077e8ee1c8b44c4df81f5b" ON "ScheduledMaintenanceProxmoxCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82f74b0e34421ab57ba2fce187" ON "ScheduledMaintenanceProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de2d7f0647ea22ea71a0715777" ON "ScheduledMaintenanceCephCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3676443235656830b9606f218a" ON "ScheduledMaintenanceCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef545387a8be6a10b08ca00bbf" ON "PodmanHostOwnerRulePodmanHostLabel" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94afece69d250184817bf6a568" ON "PodmanHostOwnerRulePodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fa038c593b2c42c23bc65c73cf" ON "PodmanHostOwnerRuleOwnerUser" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f00a7bcddc0efb222d8fcb81d3" ON "PodmanHostOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e8445007db31ef701a2248961" ON "PodmanHostOwnerRuleOwnerTeam" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_405743c3dd0e0faa6f7e089bef" ON "PodmanHostOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b48a7966e476621a21da591998" ON "PodmanHostLabelRulePodmanHostLabel" ("podmanHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f630e2bab87bdcff1a441113b" ON "PodmanHostLabelRulePodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce2f37445d6b71cf493e26fcad" ON "PodmanHostLabelRuleLabelToAdd" ("podmanHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2af4c6a46729e35d643f4695f1" ON "PodmanHostLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9bbe37882540332ba4cbf3890d" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2c7c48a6d3692cfbee000f70a" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_068678ab2a3311f44da5473123" ON "ProxmoxClusterOwnerRuleOwnerUser" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_63be7205c7338bd554e3c4d876" ON "ProxmoxClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_590d66e6ab9c143812be3de8df" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6dfb944a71fec6548bd7b6b74c" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8efffa71d1874f710d30caeeac" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("proxmoxClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_282407ee16f1b9c739c6841e2b" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9875bc3bb7ebede405623b416" ON "ProxmoxClusterLabelRuleLabelToAdd" ("proxmoxClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7eb12459f56dcd7d94a289759" ON "ProxmoxClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b51e30fce3abd99edd751ea05" ON "CephClusterOwnerRuleCephClusterLabel" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_634d778c8d0c658b1cdc72ed93" ON "CephClusterOwnerRuleCephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d42f9b12b651c609cafca1f3c4" ON "CephClusterOwnerRuleOwnerUser" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d21c2166120cb4c0dca852627" ON "CephClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c8beb21b3a727c915bee26b3b0" ON "CephClusterOwnerRuleOwnerTeam" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb0b405cda0e7e57bba84e3835" ON "CephClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b92ce422f7d8739ca64309a148" ON "CephClusterLabelRuleCephClusterLabel" ("cephClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c5ffa49420aee93d38cd185cd" ON "CephClusterLabelRuleCephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e1f9045b0678004b38aadb209" ON "CephClusterLabelRuleLabelToAdd" ("cephClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b8b6bacc78025431f6947702fb" ON "CephClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_800ec09eb585cdb5e4c643ef51b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_226968cb67b75a269fd4afc8e21" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_d3489b9ce7bbc6d188532380465" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_76c44007c314e08a38f281c2a20" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_4a26aefc1de15f94048ef3b45cf" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_9621e9bcc51de9020a80cbc2a3a" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_4afb8e67cb5091d0516f5367838" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_60e39785a25e87094f3c26f1a31" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_ea369857823e55e8c21a27a3b7b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_2cecebbab6116b69a956486662e" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_6cd03329fe875288a708b233b47" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_71ebaf0b0f13eaa695364809620" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_1f25293571ef8e2463395752fd9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_7e634b27917c3b9e8097825843e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_bed5c2772bfe0c0e830c3532b72" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_455a9f7e73013478864ec09b245" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_ee3ba0f5cf06521b69737f557bd" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_20216ec3277986d5ae08fd97bbc" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_6ce38fbca245d24d9c9291bc0aa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_4ed976be4233caef7e2870809bf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_fd63bd3b519ced2c486cf543e07" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_f6adcec1177f99f7e1474d39102" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_024306bb97b69b0e2ce31e72af0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_5ea525bb98954059807e2d78188" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_160397e8592834d4b98fc535f6a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_ca566ba685de7dd978b4baed08b" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_491a7d288d0f1654c45bd3e6b4c" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_1ca2afe281a8321d013d28ef494" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_26cbfc7eba8141ece8c684c770b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_21a264a4622ba591367825aa9e1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_6bb75d46d3a511149a80b212b39" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_591eb5cdcff159dcb1a9114022f" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_15585b88e233fc149f706268b0f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_6a90d5141b0c9854c32a8ca4c8e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_46e791b3b6a3b0aa95d5ed6cc18" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_25bbc77dc86c8c2de6ab1679e43" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_73d0f066c4322a19cd3da9dd8f9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_9f5b91e77509f790c71888d73af" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_e6608f1702b29208445ebedfe25" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_4588e4038c85b41a6256e828d08" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_f61243d7350fdf08ff36fa1e99d" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_7884ae0bd6a8c0275bc22dc6bde" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_9db7fe4ecea9d899101e1a5c09b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_7e73257d42affbb4b38f9188b91" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_29e85704dca21ea364785783fe2" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_cad804611b20c69d1f0a7877126" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ecb1a61d6dabc7f348f9e15b82c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_1f6621f7b7c6fae18ca69412e31" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_8be4ae9090dcd46257fb7f08c66" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_cce1a652f3027d5fcfc1d736076" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_7efa5d5d3342549b926cb236524" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_3ef04d7364c547f9bdc63c84d79" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_1d1472a3626fabd92feeb1db9b1" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_93e77721dea2b48aa8343dcb1cf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_30ce3c714e334beed1bb626f501" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_2f1d57a0a6278c0c10dca051152" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_19e3a8fa3eb64d672086c0af8b3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_83cc82fa981ec2cd84029bbe609" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_53fcb8f37ffe0d9a33edec682c2" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_bd4333af455c31d4cded38ce981" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_4b7e6b09ea7040671e2a24b1197" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_dcdd2a2c789fdafe36c877b629b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_edfb1d585dc24c8556d4e58cff0" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_d9165315ae1e802ea4fbd45c362" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_e4e7baa610b7616a93afe2c9401" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ab0b9ae7420a3d2b9fab377aecf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_53b94ec0ab89b4d60e325cf07cb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_f8873726c7b8c24b7b86e61e719" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_f83659d44dadb229a52c067d036" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_2e7a1cac52b095d57cec0881ca5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_d6069d9e4e6288a42e2ae591ab4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_963be9e3b50017b2a557ca9e01b" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_2f020ddc2c90111560ca6c6c858" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_2cdd58ac0c75e015836665ac34a" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_193e7ab49242b2921fa74a376d8" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_0dac439700a797d57a3e4352507" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_31b13695f386336f5931613addb" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_9eb9f35b16317b0dfa52559fb7e" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_eb62c596a88ac1fbecbf6e7b5ef" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_5c785147c7c0f89c2d35f4b8e59" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_be19aae8dadb71f8ed1677dac39" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_860bf95d284d2576bfbf6b82825" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_86dc37aa8f2fa9db0b80fa9ac01" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_eaf5254c3134daa3a9b6b4a7393" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_b0ec9d08d69cc9f2d471720f9e8" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_4cda1d6f5a80bc5bdd5bca3acf8" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_85a5c53459ff51c256023f23184" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_9c83996a399a3fbff47cac5afbf" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_90e2c01e08dbe8d8f8ba2e71ab9" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_07f55cbd5789397c8f15b880840" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_aae64dd7cbf048a5d2dba1ae061" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_376e4cea18a6af797b7ea7ccd0a" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_05fbcff360b0be1652c8948b8a6" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_570b3e04f016052bf8ef7bf70a9" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_c12b4d3465796bbbabba37ffe6f" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_4909077e8ee1c8b44c4df81f5b7" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_82f74b0e34421ab57ba2fce1875" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_de2d7f0647ea22ea71a0715777f" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_3676443235656830b9606f218a1" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" ADD CONSTRAINT "FK_684416928f6c99c022a9fcb956c" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" ADD CONSTRAINT "FK_16a36a504da94535ccace7f3ddd" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" ADD CONSTRAINT "FK_c27b4872168d6e85283c622f77e" FOREIGN KEY ("scheduledMaintenanceTemplateId") REFERENCES "ScheduledMaintenanceTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" ADD CONSTRAINT "FK_b4d6ffbc8648a1c528163780df0" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_ef545387a8be6a10b08ca00bbf5" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_94afece69d250184817bf6a5686" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_fa038c593b2c42c23bc65c73cf0" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_f00a7bcddc0efb222d8fcb81d32" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6e8445007db31ef701a2248961b" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_405743c3dd0e0faa6f7e089bef4" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_b48a7966e476621a21da591998d" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_7f630e2bab87bdcff1a441113ba" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_ce2f37445d6b71cf493e26fcad3" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_2af4c6a46729e35d643f4695f16" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_9bbe37882540332ba4cbf3890df" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_e2c7c48a6d3692cfbee000f70a0" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_068678ab2a3311f44da54731235" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_63be7205c7338bd554e3c4d8760" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_590d66e6ab9c143812be3de8df6" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_6dfb944a71fec6548bd7b6b74cf" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_8efffa71d1874f710d30caeeac6" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_282407ee16f1b9c739c6841e2b4" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_b9875bc3bb7ebede405623b4169" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_b7eb12459f56dcd7d94a289759a" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_3b51e30fce3abd99edd751ea055" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_634d778c8d0c658b1cdc72ed932" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_d42f9b12b651c609cafca1f3c48" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_9d21c2166120cb4c0dca8526276" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_c8beb21b3a727c915bee26b3b09" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_cb0b405cda0e7e57bba84e3835e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_b92ce422f7d8739ca64309a148a" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_0c5ffa49420aee93d38cd185cde" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_8e1f9045b0678004b38aadb209d" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_b8b6bacc78025431f6947702fbe" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_b8b6bacc78025431f6947702fbe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_8e1f9045b0678004b38aadb209d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" DROP CONSTRAINT "FK_0c5ffa49420aee93d38cd185cde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" DROP CONSTRAINT "FK_b92ce422f7d8739ca64309a148a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_cb0b405cda0e7e57bba84e3835e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_c8beb21b3a727c915bee26b3b09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_9d21c2166120cb4c0dca8526276"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_d42f9b12b651c609cafca1f3c48"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" DROP CONSTRAINT "FK_634d778c8d0c658b1cdc72ed932"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" DROP CONSTRAINT "FK_3b51e30fce3abd99edd751ea055"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_b7eb12459f56dcd7d94a289759a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" DROP CONSTRAINT "FK_b9875bc3bb7ebede405623b4169"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_282407ee16f1b9c739c6841e2b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_8efffa71d1874f710d30caeeac6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6dfb944a71fec6548bd7b6b74cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_590d66e6ab9c143812be3de8df6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_63be7205c7338bd554e3c4d8760"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" DROP CONSTRAINT "FK_068678ab2a3311f44da54731235"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_e2c7c48a6d3692cfbee000f70a0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" DROP CONSTRAINT "FK_9bbe37882540332ba4cbf3890df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_2af4c6a46729e35d643f4695f16"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" DROP CONSTRAINT "FK_ce2f37445d6b71cf493e26fcad3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_7f630e2bab87bdcff1a441113ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" DROP CONSTRAINT "FK_b48a7966e476621a21da591998d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_405743c3dd0e0faa6f7e089bef4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" DROP CONSTRAINT "FK_6e8445007db31ef701a2248961b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_f00a7bcddc0efb222d8fcb81d32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" DROP CONSTRAINT "FK_fa038c593b2c42c23bc65c73cf0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_94afece69d250184817bf6a5686"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" DROP CONSTRAINT "FK_ef545387a8be6a10b08ca00bbf5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" DROP CONSTRAINT "FK_b4d6ffbc8648a1c528163780df0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceTemplatePodmanHost" DROP CONSTRAINT "FK_c27b4872168d6e85283c622f77e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" DROP CONSTRAINT "FK_16a36a504da94535ccace7f3ddd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplatePodmanHost" DROP CONSTRAINT "FK_684416928f6c99c022a9fcb956c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" DROP CONSTRAINT "FK_3676443235656830b9606f218a1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" DROP CONSTRAINT "FK_de2d7f0647ea22ea71a0715777f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" DROP CONSTRAINT "FK_82f74b0e34421ab57ba2fce1875"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" DROP CONSTRAINT "FK_4909077e8ee1c8b44c4df81f5b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_c12b4d3465796bbbabba37ffe6f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" DROP CONSTRAINT "FK_570b3e04f016052bf8ef7bf70a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_05fbcff360b0be1652c8948b8a6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" DROP CONSTRAINT "FK_376e4cea18a6af797b7ea7ccd0a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" DROP CONSTRAINT "FK_aae64dd7cbf048a5d2dba1ae061"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" DROP CONSTRAINT "FK_07f55cbd5789397c8f15b880840"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" DROP CONSTRAINT "FK_90e2c01e08dbe8d8f8ba2e71ab9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" DROP CONSTRAINT "FK_9c83996a399a3fbff47cac5afbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_85a5c53459ff51c256023f23184"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" DROP CONSTRAINT "FK_4cda1d6f5a80bc5bdd5bca3acf8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_b0ec9d08d69cc9f2d471720f9e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" DROP CONSTRAINT "FK_eaf5254c3134daa3a9b6b4a7393"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" DROP CONSTRAINT "FK_86dc37aa8f2fa9db0b80fa9ac01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" DROP CONSTRAINT "FK_860bf95d284d2576bfbf6b82825"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" DROP CONSTRAINT "FK_be19aae8dadb71f8ed1677dac39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" DROP CONSTRAINT "FK_5c785147c7c0f89c2d35f4b8e59"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_eb62c596a88ac1fbecbf6e7b5ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" DROP CONSTRAINT "FK_9eb9f35b16317b0dfa52559fb7e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_31b13695f386336f5931613addb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" DROP CONSTRAINT "FK_0dac439700a797d57a3e4352507"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_193e7ab49242b2921fa74a376d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" DROP CONSTRAINT "FK_2cdd58ac0c75e015836665ac34a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_2f020ddc2c90111560ca6c6c858"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" DROP CONSTRAINT "FK_963be9e3b50017b2a557ca9e01b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_d6069d9e4e6288a42e2ae591ab4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_2e7a1cac52b095d57cec0881ca5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" DROP CONSTRAINT "FK_f83659d44dadb229a52c067d036"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_f8873726c7b8c24b7b86e61e719"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_53b94ec0ab89b4d60e325cf07cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" DROP CONSTRAINT "FK_ab0b9ae7420a3d2b9fab377aecf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_e4e7baa610b7616a93afe2c9401"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_d9165315ae1e802ea4fbd45c362"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" DROP CONSTRAINT "FK_edfb1d585dc24c8556d4e58cff0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_dcdd2a2c789fdafe36c877b629b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_4b7e6b09ea7040671e2a24b1197"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" DROP CONSTRAINT "FK_bd4333af455c31d4cded38ce981"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_53fcb8f37ffe0d9a33edec682c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_83cc82fa981ec2cd84029bbe609"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" DROP CONSTRAINT "FK_19e3a8fa3eb64d672086c0af8b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_2f1d57a0a6278c0c10dca051152"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_30ce3c714e334beed1bb626f501"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" DROP CONSTRAINT "FK_93e77721dea2b48aa8343dcb1cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_1d1472a3626fabd92feeb1db9b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_3ef04d7364c547f9bdc63c84d79"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_7efa5d5d3342549b926cb236524"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_cce1a652f3027d5fcfc1d736076"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" DROP CONSTRAINT "FK_8be4ae9090dcd46257fb7f08c66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_1f6621f7b7c6fae18ca69412e31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_ecb1a61d6dabc7f348f9e15b82c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_cad804611b20c69d1f0a7877126"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_29e85704dca21ea364785783fe2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" DROP CONSTRAINT "FK_7e73257d42affbb4b38f9188b91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_9db7fe4ecea9d899101e1a5c09b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_7884ae0bd6a8c0275bc22dc6bde"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_f61243d7350fdf08ff36fa1e99d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_4588e4038c85b41a6256e828d08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" DROP CONSTRAINT "FK_e6608f1702b29208445ebedfe25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_9f5b91e77509f790c71888d73af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_73d0f066c4322a19cd3da9dd8f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_25bbc77dc86c8c2de6ab1679e43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP CONSTRAINT "FK_46e791b3b6a3b0aa95d5ed6cc18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_6a90d5141b0c9854c32a8ca4c8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_15585b88e233fc149f706268b0f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_591eb5cdcff159dcb1a9114022f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_6bb75d46d3a511149a80b212b39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" DROP CONSTRAINT "FK_21a264a4622ba591367825aa9e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_26cbfc7eba8141ece8c684c770b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_1ca2afe281a8321d013d28ef494"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_491a7d288d0f1654c45bd3e6b4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_ca566ba685de7dd978b4baed08b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" DROP CONSTRAINT "FK_160397e8592834d4b98fc535f6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_5ea525bb98954059807e2d78188"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_024306bb97b69b0e2ce31e72af0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_f6adcec1177f99f7e1474d39102"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP CONSTRAINT "FK_fd63bd3b519ced2c486cf543e07"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_4ed976be4233caef7e2870809bf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_6ce38fbca245d24d9c9291bc0aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP CONSTRAINT "FK_20216ec3277986d5ae08fd97bbc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_ee3ba0f5cf06521b69737f557bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_455a9f7e73013478864ec09b245"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_bed5c2772bfe0c0e830c3532b72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" DROP CONSTRAINT "FK_7e634b27917c3b9e8097825843e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_1f25293571ef8e2463395752fd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_71ebaf0b0f13eaa695364809620"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_6cd03329fe875288a708b233b47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_2cecebbab6116b69a956486662e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" DROP CONSTRAINT "FK_ea369857823e55e8c21a27a3b7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_60e39785a25e87094f3c26f1a31"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_4afb8e67cb5091d0516f5367838"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_9621e9bcc51de9020a80cbc2a3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_4a26aefc1de15f94048ef3b45cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" DROP CONSTRAINT "FK_76c44007c314e08a38f281c2a20"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_d3489b9ce7bbc6d188532380465"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_226968cb67b75a269fd4afc8e21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP CONSTRAINT "FK_800ec09eb585cdb5e4c643ef51b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8b6bacc78025431f6947702fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e1f9045b0678004b38aadb209"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c5ffa49420aee93d38cd185cd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b92ce422f7d8739ca64309a148"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb0b405cda0e7e57bba84e3835"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c8beb21b3a727c915bee26b3b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d21c2166120cb4c0dca852627"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d42f9b12b651c609cafca1f3c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_634d778c8d0c658b1cdc72ed93"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b51e30fce3abd99edd751ea05"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7eb12459f56dcd7d94a289759"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9875bc3bb7ebede405623b416"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_282407ee16f1b9c739c6841e2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8efffa71d1874f710d30caeeac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6dfb944a71fec6548bd7b6b74c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_590d66e6ab9c143812be3de8df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_63be7205c7338bd554e3c4d876"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_068678ab2a3311f44da5473123"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2c7c48a6d3692cfbee000f70a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9bbe37882540332ba4cbf3890d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2af4c6a46729e35d643f4695f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce2f37445d6b71cf493e26fcad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f630e2bab87bdcff1a441113b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b48a7966e476621a21da591998"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_405743c3dd0e0faa6f7e089bef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e8445007db31ef701a2248961"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f00a7bcddc0efb222d8fcb81d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa038c593b2c42c23bc65c73cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94afece69d250184817bf6a568"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef545387a8be6a10b08ca00bbf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3676443235656830b9606f218a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de2d7f0647ea22ea71a0715777"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82f74b0e34421ab57ba2fce187"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4909077e8ee1c8b44c4df81f5b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c12b4d3465796bbbabba37ffe6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_570b3e04f016052bf8ef7bf70a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05fbcff360b0be1652c8948b8a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_376e4cea18a6af797b7ea7ccd0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aae64dd7cbf048a5d2dba1ae06"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_07f55cbd5789397c8f15b88084"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90e2c01e08dbe8d8f8ba2e71ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c83996a399a3fbff47cac5afb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85a5c53459ff51c256023f2318"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cda1d6f5a80bc5bdd5bca3acf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0ec9d08d69cc9f2d471720f9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eaf5254c3134daa3a9b6b4a739"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_86dc37aa8f2fa9db0b80fa9ac0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_860bf95d284d2576bfbf6b8282"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be19aae8dadb71f8ed1677dac3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c785147c7c0f89c2d35f4b8e5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb62c596a88ac1fbecbf6e7b5e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9eb9f35b16317b0dfa52559fb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31b13695f386336f5931613add"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0dac439700a797d57a3e435250"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_193e7ab49242b2921fa74a376d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cdd58ac0c75e015836665ac34"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f020ddc2c90111560ca6c6c85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_963be9e3b50017b2a557ca9e01"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_172eae17e5baa493be1f1514ac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba94a20640228182041a8bd943"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f83659d44dadb229a52c067d03"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ac11fdc69267ba6ba3cf18d1b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de22ab53ad7d3b33e7191a6631"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab0b9ae7420a3d2b9fab377aec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5de020980441cfb158b38068da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c30ba63ee7922bb479dc102527"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_edfb1d585dc24c8556d4e58cff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5ac142817cff8d50fb900d674"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7807258051c6a7ed1f0a2d8192"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd4333af455c31d4cded38ce98"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fbae97f871249243b0ff37d351"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a73a6f772ac704ec4ac7ad2c2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_19e3a8fa3eb64d672086c0af8b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15b1cd2e19609e816fe2a07fc6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35436c9438bca225598e8d3527"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_93e77721dea2b48aa8343dcb1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99d0abf478d3b07acf11e5d86b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cce1a652f3027d5fcfc1d73607"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8be4ae9090dcd46257fb7f08c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66b88e08f836fcf752ddb1f8c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cad804611b20c69d1f0a787712"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_29e85704dca21ea364785783fe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e73257d42affbb4b38f9188b9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44bb972b76964d1270b61cefd9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f61243d7350fdf08ff36fa1e99"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4588e4038c85b41a6256e828d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6608f1702b29208445ebedfe2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62a0ea57abd7d0da8b5284ab9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25bbc77dc86c8c2de6ab1679e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46e791b3b6a3b0aa95d5ed6cc1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_201a165158883596a94abdaa8f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_591eb5cdcff159dcb1a9114022"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6bb75d46d3a511149a80b212b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21a264a4622ba591367825aa9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8c8fa15b899205a6b0ec6b59fc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_491a7d288d0f1654c45bd3e6b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ca566ba685de7dd978b4baed08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_160397e8592834d4b98fc535f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56d036d93cc784c11884832364"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9de7a23debe809301538ef8368"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd63bd3b519ced2c486cf543e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6c21ee141871ea340e9fc64f1e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aafaa4bdec6d42b5770c41c61a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20216ec3277986d5ae08fd97bb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_772c02b6419beb57fa47ccae1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bed5c2772bfe0c0e830c3532b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e634b27917c3b9e8097825843"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a737253768cdb2e73a9987ce3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6cd03329fe875288a708b233b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cecebbab6116b69a956486662"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea369857823e55e8c21a27a3b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1da42006705c332a4bcc96202"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9621e9bcc51de9020a80cbc2a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a26aefc1de15f94048ef3b45c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76c44007c314e08a38f281c2a2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36e1b7bb9d9756649579d38eb5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_800ec09eb585cdb5e4c643ef51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4d6ffbc8648a1c528163780df"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c27b4872168d6e85283c622f77"`,
    );
    await queryRunner.query(
      `DROP TABLE "ScheduledMaintenanceTemplatePodmanHost"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16a36a504da94535ccace7f3dd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_684416928f6c99c022a9fcb956"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentTemplatePodmanHost"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_label_to_add_labelId" ON "CephClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_label_to_add_ruleId" ON "CephClusterLabelRuleLabelToAdd" ("cephClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_cluster_label_labelId" ON "CephClusterLabelRuleCephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cclr_cluster_label_ruleId" ON "CephClusterLabelRuleCephClusterLabel" ("cephClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_team_teamId" ON "CephClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_team_ruleId" ON "CephClusterOwnerRuleOwnerTeam" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_user_userId" ON "CephClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_owner_user_ruleId" ON "CephClusterOwnerRuleOwnerUser" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_cluster_label_labelId" ON "CephClusterOwnerRuleCephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ccor_cluster_label_ruleId" ON "CephClusterOwnerRuleCephClusterLabel" ("cephClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_label_to_add_labelId" ON "ProxmoxClusterLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_label_to_add_ruleId" ON "ProxmoxClusterLabelRuleLabelToAdd" ("proxmoxClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_cluster_label_labelId" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pclr_cluster_label_ruleId" ON "ProxmoxClusterLabelRuleProxmoxClusterLabel" ("proxmoxClusterLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_team_teamId" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_team_ruleId" ON "ProxmoxClusterOwnerRuleOwnerTeam" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_user_userId" ON "ProxmoxClusterOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_owner_user_ruleId" ON "ProxmoxClusterOwnerRuleOwnerUser" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_cluster_label_labelId" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pcor_cluster_label_ruleId" ON "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ("proxmoxClusterOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_to_add_labelId" ON "PodmanHostLabelRuleLabelToAdd" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_to_add_ruleId" ON "PodmanHostLabelRuleLabelToAdd" ("podmanHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_labelId" ON "PodmanHostLabelRulePodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_label_ruleId" ON "PodmanHostLabelRulePodmanHostLabel" ("podmanHostLabelRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_team_teamId" ON "PodmanHostOwnerRuleOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_team_ruleId" ON "PodmanHostOwnerRuleOwnerTeam" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_user_userId" ON "PodmanHostOwnerRuleOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_owner_user_ruleId" ON "PodmanHostOwnerRuleOwnerUser" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_label_labelId" ON "PodmanHostOwnerRulePodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_label_ruleId" ON "PodmanHostOwnerRulePodmanHostLabel" ("podmanHostOwnerRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_ceph_cluster_cephClusterId" ON "ScheduledMaintenanceCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_ceph_cluster_scheduledMaintenanceId" ON "ScheduledMaintenanceCephCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_proxmox_cluster_proxmoxClusterId" ON "ScheduledMaintenanceProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sm_proxmox_cluster_scheduledMaintenanceId" ON "ScheduledMaintenanceProxmoxCluster" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_podman_host_podmanHostId" ON "ScheduledMaintenancePodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_maintenance_podman_host_smId" ON "ScheduledMaintenancePodmanHost" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_resource_podmanResourceId" ON "AlertPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_resource_alertId" ON "AlertPodmanResource" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_ceph_cluster_cephClusterId" ON "AlertCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_ceph_cluster_alertId" ON "AlertCephCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_proxmox_cluster_proxmoxClusterId" ON "AlertProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_proxmox_cluster_alertId" ON "AlertProxmoxCluster" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_host_podmanHostId" ON "AlertPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alert_podman_host_alertId" ON "AlertPodmanHost" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_resource_podmanResourceId" ON "IncidentPodmanResource" ("podmanResourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_resource_incidentId" ON "IncidentPodmanResource" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_ceph_cluster_cephClusterId" ON "IncidentCephCluster" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_ceph_cluster_incidentId" ON "IncidentCephCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_proxmox_cluster_proxmoxClusterId" ON "IncidentProxmoxCluster" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_proxmox_cluster_incidentId" ON "IncidentProxmoxCluster" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_host_podmanHostId" ON "IncidentPodmanHost" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_podman_host_incidentId" ON "IncidentPodmanHost" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_labelId" ON "ProxmoxClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_proxmoxClusterId" ON "ProxmoxClusterLabel" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_labelId" ON "CephClusterLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_cephClusterId" ON "CephClusterLabel" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_labelId" ON "PodmanHostLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_podmanHostId" ON "PodmanHostLabel" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_isEnabled" ON "CephClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_name" ON "CephClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_label_rule_projectId" ON "CephClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_isEnabled" ON "CephClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_name" ON "CephClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_rule_projectId" ON "CephClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_isEnabled" ON "ProxmoxClusterLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_name" ON "ProxmoxClusterLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_label_rule_projectId" ON "ProxmoxClusterLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_isEnabled" ON "ProxmoxClusterOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_name" ON "ProxmoxClusterOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_rule_projectId" ON "ProxmoxClusterOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_isEnabled" ON "PodmanHostLabelRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_name" ON "PodmanHostLabelRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_label_rule_projectId" ON "PodmanHostLabelRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_isEnabled" ON "PodmanHostOwnerRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_name" ON "PodmanHostOwnerRule" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_rule_projectId" ON "PodmanHostOwnerRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_resource_identity" ON "CephResource" ("projectId", "cephClusterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_resource_cephClusterId" ON "CephResource" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_resource_projectId" ON "CephResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_isOwnerNotified" ON "CephClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_cephClusterId" ON "CephClusterOwnerUser" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_userId" ON "CephClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_user_projectId" ON "CephClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_isOwnerNotified" ON "CephClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_cephClusterId" ON "CephClusterOwnerTeam" ("cephClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_teamId" ON "CephClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_owner_team_projectId" ON "CephClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_resource_identity" ON "ProxmoxResource" ("projectId", "proxmoxClusterId", "kind", "externalId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_resource_proxmoxClusterId" ON "ProxmoxResource" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_resource_projectId" ON "ProxmoxResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_isOwnerNotified" ON "ProxmoxClusterOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_proxmoxClusterId" ON "ProxmoxClusterOwnerUser" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_userId" ON "ProxmoxClusterOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_user_projectId" ON "ProxmoxClusterOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_isOwnerNotified" ON "ProxmoxClusterOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_proxmoxClusterId" ON "ProxmoxClusterOwnerTeam" ("proxmoxClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_teamId" ON "ProxmoxClusterOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_owner_team_projectId" ON "ProxmoxClusterOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_cluster_projectId_name" ON "ProxmoxCluster" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_proxmox_cluster_slug" ON "ProxmoxCluster" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_name" ON "ProxmoxCluster" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proxmox_cluster_projectId" ON "ProxmoxCluster" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_cluster_projectId_name" ON "CephCluster" ("projectId", "name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ceph_cluster_slug" ON "CephCluster" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_name" ON "CephCluster" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ceph_cluster_projectId" ON "CephCluster" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_podman_resource_projectId_podmanHostId_kind_name" ON "PodmanResource" ("projectId", "podmanHostId", "kind", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_resource_podmanHostId" ON "PodmanResource" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_resource_projectId" ON "PodmanResource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_isOwnerNotified" ON "PodmanHostOwnerUser" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_podmanHostId" ON "PodmanHostOwnerUser" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_userId" ON "PodmanHostOwnerUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_user_projectId" ON "PodmanHostOwnerUser" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_isOwnerNotified" ON "PodmanHostOwnerTeam" ("isOwnerNotified") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_podmanHostId" ON "PodmanHostOwnerTeam" ("podmanHostId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_teamId" ON "PodmanHostOwnerTeam" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_owner_team_projectId" ON "PodmanHostOwnerTeam" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_podman_host_slug" ON "PodmanHost" ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_hostIdentifier" ON "PodmanHost" ("hostIdentifier") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_podman_host_projectId" ON "PodmanHost" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_cclr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_cclr_label_to_add_ruleId" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_cclr_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRuleCephClusterLabel" ADD CONSTRAINT "FK_cclr_cluster_label_ruleId" FOREIGN KEY ("cephClusterLabelRuleId") REFERENCES "CephClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ccor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_ccor_owner_team_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ccor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_ccor_owner_user_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_ccor_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRuleCephClusterLabel" ADD CONSTRAINT "FK_ccor_cluster_label_ruleId" FOREIGN KEY ("cephClusterOwnerRuleId") REFERENCES "CephClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_pclr_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleLabelToAdd" ADD CONSTRAINT "FK_pclr_label_to_add_ruleId" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pclr_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pclr_cluster_label_ruleId" FOREIGN KEY ("proxmoxClusterLabelRuleId") REFERENCES "ProxmoxClusterLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_pcor_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_pcor_owner_team_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_pcor_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleOwnerUser" ADD CONSTRAINT "FK_pcor_owner_user_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pcor_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRuleProxmoxClusterLabel" ADD CONSTRAINT "FK_pcor_cluster_label_ruleId" FOREIGN KEY ("proxmoxClusterOwnerRuleId") REFERENCES "ProxmoxClusterOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_podman_host_label_rule_label_to_add_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRuleLabelToAdd" ADD CONSTRAINT "FK_podman_host_label_rule_label_to_add_ruleId" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_rule_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_rule_label_ruleId" FOREIGN KEY ("podmanHostLabelRuleId") REFERENCES "PodmanHostLabelRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_team_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRuleOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_rule_owner_user_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_owner_rule_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRulePodmanHostLabel" ADD CONSTRAINT "FK_podman_host_owner_rule_label_ruleId" FOREIGN KEY ("podmanHostOwnerRuleId") REFERENCES "PodmanHostOwnerRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_sm_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceCephCluster" ADD CONSTRAINT "FK_sm_ceph_cluster_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_sm_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceProxmoxCluster" ADD CONSTRAINT "FK_sm_proxmox_cluster_scheduledMaintenanceId" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_scheduled_maintenance_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePodmanHost" ADD CONSTRAINT "FK_scheduled_maintenance_podman_host_sm" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_alert_podman_resource_podmanResource" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanResource" ADD CONSTRAINT "FK_alert_podman_resource_alert" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_alert_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertCephCluster" ADD CONSTRAINT "FK_alert_ceph_cluster_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_alert_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertProxmoxCluster" ADD CONSTRAINT "FK_alert_proxmox_cluster_alertId" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_alert_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertPodmanHost" ADD CONSTRAINT "FK_alert_podman_host_alert" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_incident_podman_resource_podmanResource" FOREIGN KEY ("podmanResourceId") REFERENCES "PodmanResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanResource" ADD CONSTRAINT "FK_incident_podman_resource_incident" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_incident_ceph_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCephCluster" ADD CONSTRAINT "FK_incident_ceph_cluster_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_incident_proxmox_cluster_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentProxmoxCluster" ADD CONSTRAINT "FK_incident_proxmox_cluster_incidentId" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_incident_podman_host_podmanHost" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPodmanHost" ADD CONSTRAINT "FK_incident_podman_host_incident" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_proxmox_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabel" ADD CONSTRAINT "FK_proxmox_cluster_label_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_ceph_cluster_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabel" ADD CONSTRAINT "FK_ceph_cluster_label_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_labelId" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabel" ADD CONSTRAINT "FK_podman_host_label_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterLabelRule" ADD CONSTRAINT "FK_ceph_cluster_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerRule" ADD CONSTRAINT "FK_ceph_cluster_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterLabelRule" ADD CONSTRAINT "FK_proxmox_cluster_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerRule" ADD CONSTRAINT "FK_proxmox_cluster_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostLabelRule" ADD CONSTRAINT "FK_podman_host_label_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerRule" ADD CONSTRAINT "FK_podman_host_owner_rule_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_host_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephResource" ADD CONSTRAINT "FK_ceph_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerUser" ADD CONSTRAINT "FK_ceph_cluster_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephClusterOwnerTeam" ADD CONSTRAINT "FK_ceph_cluster_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD CONSTRAINT "FK_proxmox_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerUser" ADD CONSTRAINT "FK_proxmox_cluster_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_proxmoxClusterId" FOREIGN KEY ("proxmoxClusterId") REFERENCES "ProxmoxCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxClusterOwnerTeam" ADD CONSTRAINT "FK_proxmox_cluster_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_cephClusterId" FOREIGN KEY ("cephClusterId") REFERENCES "CephCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD CONSTRAINT "FK_proxmox_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD CONSTRAINT "FK_ceph_cluster_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ADD CONSTRAINT "FK_podman_resource_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_userId" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerUser" ADD CONSTRAINT "FK_podman_host_owner_user_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_podmanHostId" FOREIGN KEY ("podmanHostId") REFERENCES "PodmanHost"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_teamId" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHostOwnerTeam" ADD CONSTRAINT "FK_podman_host_owner_team_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD CONSTRAINT "FK_podman_host_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
