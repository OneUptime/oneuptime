import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Runbook credentials (Runbooks > Runners > AI Access) are removed: hosts and
 * Kubernetes clusters have AI agents of their own, and runbook steps sign in
 * with runbook variables.
 *
 * - KubernetesCluster.aiAccessCredentialId, the Kubernetes credential a
 *   Runner outside a cluster reached it with, is dropped with its foreign
 *   key (generated). The Runner binding stays: it is what the cluster's
 *   previous in-cluster Runner binds itself to. The data migration
 *   RemoveRunbookCredentials clears the bindings to a Runner outside a
 *   cluster afterwards (schema migrations run first).
 * - The four Runbook Credential permissions grant nothing any more, so the
 *   rows that hold them - a team's, an API key's, a custom role's - are
 *   deleted. Every other permission of the same team, key or role stays.
 *
 * The credentials themselves are left for the data migration: the runbook
 * steps that still name one are moved to variables first, which reads them
 * (RunbookCredentialsRemoval). Their tables stay, emptied, as the runbook
 * secrets' do.
 */
const REMOVED_PERMISSIONS: Array<string> = [
  "CreateRunbookCredential",
  "EditRunbookCredential",
  "DeleteRunbookCredential",
  "ReadRunbookCredential",
];

const PERMISSION_TABLES: Array<string> = [
  "TeamPermission",
  "ApiKeyPermission",
  "CustomRolePermission",
];

export class RemoveRunbookCredentials1805750000000
  implements MigrationInterface
{
  public name: string = "RemoveRunbookCredentials1805750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessCredentialId"`,
    );

    for (const table of PERMISSION_TABLES) {
      await queryRunner.query(
        `DELETE FROM "${table}" WHERE "permission" = ANY($1::text[])`,
        [REMOVED_PERMISSIONS],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The permission rows deleted above are not put back: they granted nothing.
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessCredentialId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e" FOREIGN KEY ("aiAccessCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
