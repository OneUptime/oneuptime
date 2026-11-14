import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * ProxmoxCluster.agentLastSeenAt: when the OneUptime Proxmox agent last sent
 * anything for the cluster, whether or not it could read the Proxmox VE API
 * (OneUptime issue #7439). lastSeenAt now says when the cluster was last READ,
 * so an agent whose node went down, or whose token was revoked, no longer
 * keeps its cluster Connected with its own scrape metrics; this column is
 * what still says the agent is running, so the Overview can tell "the agent
 * cannot read the Proxmox VE API" from "the agent stopped".
 *
 * Nullable, with no default, so adding it does not rewrite the table. NULL
 * means the agent has not reported since the column was added, and its next
 * batch writes one.
 */
export class AddProxmoxClusterAgentLastSeenAt1809123900000
  implements MigrationInterface
{
  public name: string = "AddProxmoxClusterAgentLastSeenAt1809123900000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "agentLastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "agentLastSeenAt"`,
    );
  }
}
