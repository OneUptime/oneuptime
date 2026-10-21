import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Enable AI is the project's only AI switch.
 *
 * Schema (generated): Project.enableAutoRemediation (a kill switch, default
 * on) and Project.enableAiCommandExecution (an opt-in, default off) are
 * dropped. Auto-remediation and AI commands on Runners now run exactly when
 * Project.enableAi is on.
 *
 * Data (hand-added, before the drops, which they read): no unattended
 * surprise. Where one of the two switches was holding remediation back, a
 * rule, cluster or resource set to run without a human would start changing
 * systems unattended the moment its switch disappeared. Those drop to asking
 * first, as the AI agent migration (1796100000000) did when cluster rounds
 * stopped needing the opt-in: fixes are proposed and a human approves each.
 * Nothing else changes, and nothing is switched off.
 *
 *   1. Auto-remediation was off for the project (enableAutoRemediation =
 *      false): its Full Auto rules go to Suggest, and its clusters and
 *      resources in Automatic or Bypass approval go to Ask for approval.
 *   2. The project never opted into AI command execution
 *      (enableAiCommandExecution not true): its Full Auto rules that compose
 *      commands go to Suggest, and so do clusters in Automatic or Bypass
 *      approval that AI reaches through a Runner an operator bound (with a
 *      Kubernetes credential). Those were the only rounds the opt-in held
 *      back; a cluster reached through its Kubernetes AI agent, or the
 *      chart's in-cluster Runner, never needed it, so it keeps its mode. A
 *      Runner counts as the chart's by the same markers as
 *      RunnerService.isKubernetesAgentRunnerRow: its kubernetes-agent/ name,
 *      or an in-cluster posture that names a cluster.
 *
 * down() puts the two columns back with their old defaults. The data
 * updates are not reverted: afterwards those rows are indistinguishable from
 * choices an operator made.
 */

/*
 * RunnerService.isKubernetesAgentRunnerRow in SQL, over a Runner aliased
 * `runner`: the kubernetes-agent/ name marker (case-insensitive, leading
 * whitespace ignored), or a posture under hostInfo.kubernetes that says
 * inCluster and names a cluster. Never NULL.
 */
export const IS_KUBERNETES_AGENT_RUNNER_SQL: string = [
  `(lower(regexp_replace(COALESCE(runner."name", ''), '^\\s+', '')) LIKE 'kubernetes-agent/%'`,
  `OR COALESCE(jsonb_typeof(runner."hostInfo" -> 'kubernetes') = 'object'`,
  `AND runner."hostInfo" -> 'kubernetes' -> 'inCluster' = 'true'::jsonb`,
  `AND regexp_replace(COALESCE(runner."hostInfo" -> 'kubernetes' ->> 'clusterIdentifier', ''), '^\\s+|\\s+$', '', 'g') <> '', false))`,
].join(" ");

export const TABLES_WITH_AI_REMEDIATION_MODE: Array<string> = [
  "KubernetesCluster",
  "Host",
  "DockerHost",
  "PodmanHost",
  "DockerSwarmCluster",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DatabaseServer",
];

export class FoldAiSwitchesIntoEnableAi1796800000000
  implements MigrationInterface
{
  public name: string = "FoldAiSwitchesIntoEnableAi1796800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Auto-remediation was off: nothing starts without a human.
    await queryRunner.query(
      `UPDATE "AutoRemediationRule" r SET "executionMode" = 'Suggest' FROM "Project" p WHERE r."projectId" = p."_id" AND p."enableAutoRemediation" = false AND r."executionMode" = 'FullAuto'`,
    );

    for (const table of TABLES_WITH_AI_REMEDIATION_MODE) {
      await queryRunner.query(
        `UPDATE "${table}" t SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p WHERE t."projectId" = p."_id" AND p."enableAutoRemediation" = false AND t."aiRemediationMode" IN ('Automatic','BypassApproval')`,
      );
    }

    // 2. Never opted into AI command execution: its rounds ask first.
    await queryRunner.query(
      `UPDATE "AutoRemediationRule" r SET "executionMode" = 'Suggest' FROM "Project" p WHERE r."projectId" = p."_id" AND p."enableAiCommandExecution" IS NOT TRUE AND r."aiComposesCommands" = true AND r."executionMode" = 'FullAuto'`,
    );

    await queryRunner.query(
      `UPDATE "KubernetesCluster" c SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p, "Runner" runner WHERE c."projectId" = p."_id" AND runner."_id" = c."aiAccessRunnerId" AND p."enableAiCommandExecution" IS NOT TRUE AND c."aiRemediationMode" IN ('Automatic','BypassApproval') AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL}`,
    );

    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutoRemediation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAiCommandExecution"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAiCommandExecution" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutoRemediation" boolean NOT NULL DEFAULT true`,
    );
  }
}
