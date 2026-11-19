import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The name an inviter typed for the person they invited, kept on the
 * membership (OneUptime issue #9823): TeamMember.inviteeName.
 *
 * Until someone accepts an invitation, the project that invited them sees
 * what it invited - the address, and this name if one was typed - and never
 * the profile of an account the address may already have
 * (PendingInviteeProfiles).
 *
 * Nullable, with no default, so Postgres adds it without rewriting
 * "TeamMember": an invitation made before this has no name here, and shows
 * the address it was sent to until it is accepted. Nothing is backfilled:
 * the names typed before were written to the accounts, and copying an
 * account's name onto its membership would show exactly what this hides.
 *
 * Generated with npm run generate-postgres-migration.
 */
export class AddTeamMemberInviteeName1809186200000
  implements MigrationInterface
{
  public name: string = "AddTeamMemberInviteeName1809186200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD "inviteeName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP COLUMN "inviteeName"`,
    );
  }
}
