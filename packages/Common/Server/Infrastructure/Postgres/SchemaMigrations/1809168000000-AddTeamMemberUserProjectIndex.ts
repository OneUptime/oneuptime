import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated for the model (TypeORM's migration:generate statement): a
 * person's memberships, by person and project.
 *
 * "TeamMember" had indexes on teamId and projectId only, so every read of
 * one person's memberships read the whole table: every sign-in
 * (AccessTokenService.refreshUserAllPermissions reads all of them), every
 * permission set rebuilt and every Owned-scope check of a request in a
 * project (`userId = $1 AND projectId = $2`, getTeamIdsForUser), and the
 * dashboard header's count of the person's pending invitations, on every
 * page (`userId = $1 AND hasAcceptedInvitation = false`). Each is now a
 * range of this.
 *
 * TeamMember already holds data, so the index is built online
 * (Docs/migrations/README.md): CONCURRENTLY, blocking no read or write. The
 * name and definition are the generated ones, so the drift check still
 * matches.
 */
export class AddTeamMemberUserProjectIndex1809168000000
  implements MigrationInterface
{
  public name: string = "AddTeamMemberUserProjectIndex1809168000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_2b0c3c8c89e21cadd48af0c979" ON "TeamMember" ("userId", "projectId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2b0c3c8c89e21cadd48af0c979"`,
    );
  }
}
