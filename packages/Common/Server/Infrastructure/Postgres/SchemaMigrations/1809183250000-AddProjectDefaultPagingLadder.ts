import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * A project's default ladder (#7449, Types/NotificationRule/
 * PagingLadderDefault): Project.defaultPagingLadder, how a member is paged
 * once they verify a way to be reached, by channel; and
 * Project.requirePhoneMethodForOnCall, whether On-Call Readiness and Setup
 * health name the people on a policy who have no verified phone method.
 *
 * Two nullable columns on an existing table, with no index and no key. The
 * jsonb column has no default, and the boolean's is a constant, which
 * Postgres keeps in the catalog: adding them rewrites nothing and blocks
 * nothing. Every existing project reads as having no default and asking
 * for no phone, which is what it had before.
 */
export class AddProjectDefaultPagingLadder1809183250000
  implements MigrationInterface
{
  public name: string = "AddProjectDefaultPagingLadder1809183250000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "defaultPagingLadder" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requirePhoneMethodForOnCall" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requirePhoneMethodForOnCall"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "defaultPagingLadder"`,
    );
  }
}
