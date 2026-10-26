import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration; its two indexes are built online by
 * AddEpisodeMemberFirstMembershipIndexes1807810000000 (next).
 *
 * A project can allow an incident (or an alert) in only one episode
 * (EpisodeSingleMembership), and two adds of one that is in no episode yet,
 * at the same moment, both passed the check. Each episode member now says
 * whether it was its incident's (or alert's) first membership -
 * "isFirstMembership" - and a partial unique index takes one first
 * membership per record, so the add that loses the race is refused by the
 * database and checked again (the member services' create).
 *
 * NOT NULL DEFAULT false: every member made before is no record's first,
 * so the indexes are built over no rows, and nothing already stored is
 * judged.
 */
export class AddEpisodeMemberFirstMembership1807800000000
  implements MigrationInterface
{
  public name: string = "AddEpisodeMemberFirstMembership1807800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" ADD "isFirstMembership" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeMember" ADD "isFirstMembership" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodeMember" DROP COLUMN "isFirstMembership"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertEpisodeMember" DROP COLUMN "isFirstMembership"`,
    );
  }
}
