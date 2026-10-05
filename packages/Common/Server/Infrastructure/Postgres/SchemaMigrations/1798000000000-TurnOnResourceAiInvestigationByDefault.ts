import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * AI investigation on by default for every resource a resource AI agent
 * serves — Docker, Podman and Docker Swarm hosts, Proxmox and Ceph clusters,
 * VMware vCenters, database servers and hosts — as it already is for a
 * Kubernetes cluster (AddKubernetesAiAgentAndAiDefaults1796100000000).
 *
 * Schema (generated with npm run generate-postgres-migration, then renumbered
 * after the last registered migration): isAiInvestigationEnabled now
 * defaults to true on the eight resource tables. SET DEFAULT is a catalog
 * change; it rewrites no rows.
 *
 * Data (hand-added after the DDL): resources nobody ever configured AI access
 * for (aiAccessConfiguredAt IS NULL) get investigation on, like a new
 * resource. An operator's save of any AI setting stamps aiAccessConfiguredAt,
 * so a resource someone configured keeps its switch, whatever it is. For the
 * rows this touches nothing changes in what AI runs: a resource without a
 * connected agent runs no command either way, and its agent's first
 * connection turned investigation on for exactly these resources already
 * (ResourceAiAgentService.applyFirstConnectionDefaults). The dashboard now
 * says "On" for them before the agent connects, as it does for a new one.
 * Remediation is untouched: fixes stay off until someone turns them on.
 *
 * down() reverts the defaults only. The data update is not reverted:
 * afterwards those rows are indistinguishable from choices an operator made.
 */
const RESOURCE_TABLES: ReadonlyArray<string> = [
  "DockerHost",
  "PodmanHost",
  "CephCluster",
  "ProxmoxCluster",
  "DockerSwarmCluster",
  "VMwareVCenter",
  "Host",
  "DatabaseServer",
];

export class TurnOnResourceAiInvestigationByDefault1798000000000
  implements MigrationInterface
{
  public name: string = "TurnOnResourceAiInvestigationByDefault1798000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT true`,
    );

    // Never-configured resources investigate, like a new resource.
    for (const table of RESOURCE_TABLES) {
      await queryRunner.query(
        `UPDATE "${table}" SET "isAiInvestigationEnabled" = true WHERE "aiAccessConfiguredAt" IS NULL AND "isAiInvestigationEnabled" = false`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ALTER COLUMN "isAiInvestigationEnabled" SET DEFAULT false`,
    );
  }
}
