import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Require unique names (#10761): Project "requireUniqueNames", the switch
 * that holds a monitor's, a template's or a connection's name - every kind a
 * model marks @UniqueNameWhenRequired - to one record of its kind in the
 * project (Server/Utils/Database/RequiredUniqueNames).
 *
 * Off here for every project that exists: an upgrade must not start
 * refusing the creates and renames of API clients and Terraform
 * configurations that rely on names repeating. Names a project already holds
 * twice stay as they are either way; Project Settings > Project lists them,
 * for whoever turns the switch on. New projects start with it on
 * (ProjectService.applyNewProjectNameDefaults), never by this default. The
 * column with a constant default is added without rewriting a row.
 */
export class AddProjectRequireUniqueNames1809187550000
  implements MigrationInterface
{
  public name: string = "AddProjectRequireUniqueNames1809187550000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireUniqueNames" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireUniqueNames"`,
    );
  }
}
