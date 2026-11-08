import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * When a resource's AI agent was last reset (aiAgentResetAt, issue #6302),
 * on every resource an AI agent works for: a host, a Docker or Podman host,
 * a Docker Swarm, Proxmox or Ceph cluster, a vCenter, a database, a cloud
 * account, an OpenStack cloud and a Kubernetes cluster. Reset agent stamps
 * it, and the reset's audit log entry names it. Each column is nullable
 * with no default, so Postgres adds it without rewriting or scanning the
 * table, and every resource reads as never reset until someone resets its
 * agent.
 */
export class AddAiAgentResetAt1808996200000 implements MigrationInterface {
  public name: string = "AddAiAgentResetAt1808996200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DatabaseServer" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareVCenter" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "aiAgentResetAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAgentResetAt"`,
    );
  }
}
