import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * When a SCIM identity provider took a team as one of its groups
 * (OneUptime issue #9743, ee Identity/Utils/SCIMGroupMatch):
 *
 *   - Team.scimGroupLinkedAt: set when a pushed group makes or takes the
 *     team, or the provider reads or changes it by its id. A pushed group
 *     whose name reads like a team's, spelled another way, takes that team
 *     only while no provider holds it, so two groups of a provider are never
 *     made one team.
 *
 * Nullable, with no default: Postgres adds it without rewriting "Team", and
 * every existing team reads as one no provider has taken yet - each is
 * marked the next time its provider syncs it. Nothing here reads a row.
 *
 * Generated with npm run generate-postgres-migration.
 */
export class AddTeamScimGroupLinkedAt1809185400000
  implements MigrationInterface
{
  public name: string = "AddTeamScimGroupLinkedAt1809185400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Team" ADD "scimGroupLinkedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Team" DROP COLUMN "scimGroupLinkedAt"`,
    );
  }
}
