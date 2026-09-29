import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Resource AI agents: OneUptime AI access to Docker and Podman hosts, Docker
 * Swarm, Proxmox and Ceph clusters, VMware vCenters, database servers and
 * hosts, through the AI agent installed next to each one — the same
 * strategy as the Kubernetes AI agent, whose tables this does not touch.
 *
 * Schema only (generated):
 *   - ResourceAiAgent: one row per resource for its AI agent (its own
 *     identity, never a Runner). Polymorphic: keyed by (resourceType,
 *     resourceId) with NO foreign key on resourceId, which points into a
 *     different table for every resource type; unique per live resource;
 *     cascades with its project.
 *   - RunnerJob.targetResourceAiAgentId: the agent an AI resource command
 *     (step type ResourceCommand) is targeted at (SET NULL when the agent
 *     row goes), and RunnerJob.resourceType / resourceId: the resource it
 *     ran against, for the resource's AI page.
 *   - AutoRemediationSuggestion.resourceType / resourceId: the resource
 *     whose AI remediation mode produced a suggestion (no rule).
 *   - The AI access columns of DockerHost, PodmanHost, CephCluster,
 *     ProxmoxCluster, DockerSwarmCluster, VMwareVCenter, Host and
 *     DatabaseServer: isAiInvestigationEnabled (default false),
 *     aiRemediationMode (default Disabled), aiCommandAllowlist and the
 *     server-written aiAccessLastVerifiedAt, aiAccessLastError and
 *     aiAccessConfiguredAt.
 *
 * No data is rewritten: every existing resource starts with AI switched
 * off, exactly like a new one. down() reverses the schema.
 */
export class AddResourceAiAgents1796200000000 implements MigrationInterface {
  public name: string = "AddResourceAiAgents1796200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ResourceAiAgent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "resourceType" character varying(100) NOT NULL, "resourceId" uuid NOT NULL, "resourceIdentifier" character varying(500), "keyHash" character varying(100), "agentVersion" character varying(100), "posture" jsonb, "lastAliveAt" TIMESTAMP WITH TIME ZONE, "connectionStatus" character varying(100) NOT NULL DEFAULT 'disconnected', "lastRegisteredAt" TIMESTAMP WITH TIME ZONE, "registeredWithIngestionKeyId" uuid, "lastRefusedRegistrationAt" TIMESTAMP WITH TIME ZONE, "lastRefusedRegistrationReason" character varying(100), CONSTRAINT "PK_b24310cc7f12a4385d678d49eea" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e61bd0e258b87311cc21cbaa95" ON "ResourceAiAgent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_06d7eb39aceb586c3c5565882b" ON "ResourceAiAgent" ("resourceType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5a1c152c918d42ef96c6a9a1c" ON "ResourceAiAgent" ("resourceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ResourceAiAgent_projectId_resourceType_resourceId" ON "ResourceAiAgent" ("projectId", "resourceType", "resourceId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "resourceType" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "RunnerJob" ADD "resourceId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "targetResourceAiAgentId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "resourceType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "resourceId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78a02785a95c03f9c7d542f21d" ON "RunnerJob" ("resourceType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_223854e59d60c3d9ece3cce60a" ON "RunnerJob" ("resourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82b8db95070bbd7b3bbe3fb850" ON "RunnerJob" ("targetResourceAiAgentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ebdb04eb0e2b9cbdc7d0b664ff" ON "AutoRemediationSuggestion" ("resourceType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ecbd56658be5035f3bdfe6937" ON "AutoRemediationSuggestion" ("resourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ResourceAiAgent" ADD CONSTRAINT "FK_e61bd0e258b87311cc21cbaa95b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_82b8db95070bbd7b3bbe3fb8509" FOREIGN KEY ("targetResourceAiAgentId") REFERENCES "ResourceAiAgent"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_82b8db95070bbd7b3bbe3fb8509"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ResourceAiAgent" DROP CONSTRAINT "FK_e61bd0e258b87311cc21cbaa95b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ecbd56658be5035f3bdfe6937"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ebdb04eb0e2b9cbdc7d0b664ff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82b8db95070bbd7b3bbe3fb850"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_223854e59d60c3d9ece3cce60a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_78a02785a95c03f9c7d542f21d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "resourceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "resourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "targetResourceAiAgentId"`,
    );
    await queryRunner.query(`ALTER TABLE "RunnerJob" DROP COLUMN "resourceId"`);
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "resourceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ResourceAiAgent_projectId_resourceType_resourceId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5a1c152c918d42ef96c6a9a1c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_06d7eb39aceb586c3c5565882b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e61bd0e258b87311cc21cbaa95"`,
    );
    await queryRunner.query(`DROP TABLE "ResourceAiAgent"`);
  }
}
