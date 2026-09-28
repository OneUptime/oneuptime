import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The Kubernetes AI agent, and AI on by default.
 *
 * Schema (generated):
 *   - KubernetesAiAgent: one row per cluster for the slim in-cluster kubectl
 *     executor the kubernetes-agent chart now installs (its own identity,
 *     never a Runner). Unique per cluster; cascades with its project and
 *     cluster.
 *   - RunnerJob.targetKubernetesAiAgentId: the agent an AI kubectl job is
 *     targeted at (SET NULL when the agent row goes).
 *   - Project.enableAutomaticPostmortemDraft: drafting a postmortem on
 *     resolve, split off enableAutomaticIncidentInvestigation.
 *   - KubernetesCluster.isAiInvestigationEnabled now defaults to true.
 *
 * Data (hand-added after the DDL, in this order):
 *   1. Postmortem drafts keep working exactly where they worked: the new
 *      flag is copied from the investigation flag it used to ride on. The
 *      column was just added as NOT NULL DEFAULT false, so setting it to true
 *      where investigation is on is the whole copy, and it rewrites only
 *      those rows.
 *   2. Clusters nobody ever configured AI access for (aiAccessConfiguredAt
 *      IS NULL) get investigation on, like a new cluster. A cluster an
 *      operator configured keeps its switch, whatever it is.
 *   3. Revocations carry over. Before the AI agent, unbinding or deleting a
 *      cluster's Runner was the off switch: the cluster has no Runner now
 *      but one was bound once, or AI already ran (or failed to run) kubectl
 *      on it. The agent must not quietly switch AI back on there, so
 *      investigation goes off and remediation goes to Disabled. Runs after
 *      2, so a revocation always wins.
 *   4. No unattended surprise. Cluster rounds through the in-cluster agent
 *      no longer need the project's "Enable AI command execution" opt-in, so
 *      a cluster left in Automatic or Bypass approval in a project that never
 *      opted in would start changing the cluster without a human on upgrade.
 *      Those clusters drop to RequireApproval: fixes are proposed, a human
 *      approves each.
 *
 * down() reverts the defaults and the schema only. The data updates are not
 * reverted: afterwards those rows are indistinguishable from choices an
 * operator made, and flipping them back could switch AI on or off for
 * somebody who chose it.
 */
export class AddKubernetesAiAgentAndAiDefaults1796100000000
  implements MigrationInterface
{
  public name: string = "AddKubernetesAiAgentAndAiDefaults1796100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesAiAgent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "keyHash" character varying(100), "agentVersion" character varying(100), "posture" jsonb, "lastAliveAt" TIMESTAMP WITH TIME ZONE, "connectionStatus" character varying(100) NOT NULL DEFAULT 'disconnected', "lastRegisteredAt" TIMESTAMP WITH TIME ZONE, "registeredWithIngestionKeyId" uuid, "lastRefusedRegistrationAt" TIMESTAMP WITH TIME ZONE, "lastRefusedRegistrationReason" character varying(100), CONSTRAINT "PK_7d9287fc069699b2f22ad4f88ee" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33622e9406d3bffee1ca9c3a6a" ON "KubernetesAiAgent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_KubernetesAiAgent_kubernetesClusterId" ON "KubernetesAiAgent" ("kubernetesClusterId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticPostmortemDraft" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "targetKubernetesAiAgentId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df20ccc2683c9be5fbc8399e09" ON "RunnerJob" ("targetKubernetesAiAgentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesAiAgent" ADD CONSTRAINT "FK_33622e9406d3bffee1ca9c3a6a9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesAiAgent" ADD CONSTRAINT "FK_d6ed70c680c438a5ea3080071ca" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_df20ccc2683c9be5fbc8399e098" FOREIGN KEY ("targetKubernetesAiAgentId") REFERENCES "KubernetesAiAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // 1. Postmortem drafts stay on wherever investigations were on.
    await queryRunner.query(
      `UPDATE "Project" SET "enableAutomaticPostmortemDraft" = true WHERE "enableAutomaticIncidentInvestigation" = true`,
    );

    // 2. Never-configured clusters investigate, like a new cluster.
    await queryRunner.query(
      `UPDATE "KubernetesCluster" SET "isAiInvestigationEnabled" = true WHERE "aiAccessConfiguredAt" IS NULL`,
    );

    /*
     * 3. A cluster whose Runner was unbound or deleted stays off. It is also
     * marked configured, so the Kubernetes AI agent's first-connection
     * defaults (which only touch never-configured clusters) can never switch
     * a revoked cluster back on.
     */
    await queryRunner.query(
      `UPDATE "KubernetesCluster" SET "isAiInvestigationEnabled" = false, "aiRemediationMode" = 'Disabled', "aiAccessConfiguredAt" = COALESCE("aiAccessConfiguredAt", NOW()) WHERE "aiAccessRunnerId" IS NULL AND ("aiAccessRunnerBoundAt" IS NOT NULL OR "aiAccessLastVerifiedAt" IS NOT NULL OR "aiAccessLastError" IS NOT NULL)`,
    );

    // 4. No unattended mode goes live without the project's opt-in.
    await queryRunner.query(
      `UPDATE "KubernetesCluster" c SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p WHERE c."projectId" = p."_id" AND p."enableAiCommandExecution" IS NOT TRUE AND c."aiRemediationMode" IN ('Automatic','BypassApproval')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_df20ccc2683c9be5fbc8399e098"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesAiAgent" DROP CONSTRAINT "FK_d6ed70c680c438a5ea3080071ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesAiAgent" DROP CONSTRAINT "FK_33622e9406d3bffee1ca9c3a6a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df20ccc2683c9be5fbc8399e09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "targetKubernetesAiAgentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticPostmortemDraft"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_KubernetesAiAgent_kubernetesClusterId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33622e9406d3bffee1ca9c3a6a"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesAiAgent"`);
  }
}
