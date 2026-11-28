import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * The format a project's web servers write their access logs in (#11048):
 * Project.securityAccessLogFormat, an nginx log_format. Security Events
 * reads each line in it field by field, X-Forwarded-For from wherever the
 * format puts it. Unset for every project until it gives one.
 *
 * A nullable column with no default: adding it rewrites no row of
 * "Project" and holds its lock for an instant (Docs/migrations/README.md).
 */
export class AddProjectSecurityAccessLogFormat1809187791129
  implements MigrationInterface
{
  public name: string = "AddProjectSecurityAccessLogFormat1809187791129";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityAccessLogFormat" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityAccessLogFormat"`,
    );
  }
}
