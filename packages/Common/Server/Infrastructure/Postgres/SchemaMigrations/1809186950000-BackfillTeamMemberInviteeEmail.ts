import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix (#10175): every invitation still waiting for its person - a
 * membership not accepted and not deleted - made before
 * TeamMember.inviteeEmail (AddTeamMemberInviteeEmail1809186940000) keeps the
 * address its project invited.
 *
 * Why. Until someone accepts, their project sees only what it invited: the
 * address, and the name typed for them (#9823). A membership kept no address
 * of its own, so every list read the account's current one through the
 * relation, and someone invited who changed their account's address before
 * accepting showed every project that had invited them their new address.
 * Now the invitation keeps the address it was sent to, and a pending person
 * is shown by it (PendingInviteeProfiles).
 *
 * What. The address the account has now: an invitation made before this
 * kept none, and that is the address its project has been shown all along -
 * so nothing the project sees changes on the upgrade, and a change of
 * address from now on no longer shows. Accepted memberships keep none: the
 * project sees a member's own address.
 *
 * Written out rather than generated (nothing in the schema changes), and run
 * with the schema migrations, right after the column, so pending people are
 * shown by the address they were invited at before any server of the
 * release answers - as a data migration of the Workers it would run once the
 * servers were up, and a list read in between would show the account's
 * address. It reads and writes few rows: the invitations still waiting.
 *
 * Running it again changes nothing: a membership that keeps an address is
 * left alone. down() removes nothing: an address it wrote cannot be told
 * from one an invitation wrote since, and reverting
 * AddTeamMemberInviteeEmail drops the column anyway.
 */
export const BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT: string = `UPDATE "TeamMember" AS "invitation"
SET "inviteeEmail" = "account"."email"
FROM "User" AS "account"
WHERE "invitation"."userId" = "account"."_id"
  AND "invitation"."hasAcceptedInvitation" = false
  AND "invitation"."deletedAt" IS NULL
  AND "invitation"."inviteeEmail" IS NULL
  AND "account"."email" IS NOT NULL`;

export class BackfillTeamMemberInviteeEmail1809186950000
  implements MigrationInterface
{
  public name: string = "BackfillTeamMemberInviteeEmail1809186950000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT);
  }

  public async down(): Promise<void> {
    // Nothing to remove: see above.
  }
}
