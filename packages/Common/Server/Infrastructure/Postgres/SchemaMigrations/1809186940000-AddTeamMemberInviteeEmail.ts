import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * TeamMember.inviteeEmail (#10175): the address a project invited, which it
 * sees of the person until they accept, in place of the address their
 * account may have moved to since. Generated; BackfillTeamMemberInviteeEmail
 * fills it in for the invitations made before it.
 */
export class AddTeamMemberInviteeEmail1809186940000
  implements MigrationInterface
{
  public name: string = "AddTeamMemberInviteeEmail1809186940000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamMember" ADD "inviteeEmail" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamMember" DROP COLUMN "inviteeEmail"`,
    );
  }
}
