import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * The proxies a project's apps sit behind (#10416):
 * Project.securityTrustedProxies, one IP address or range a line. Security
 * Events trusts the client address one of them forwards, and blames an
 * attack on an address only when its sender could not have written it.
 *
 * A nullable column with no default: adding it rewrites no row of
 * "Project" and holds its lock for an instant (Docs/migrations/README.md).
 */
export class AddProjectSecurityTrustedProxies1809187364416
  implements MigrationInterface
{
  public name: string = "AddProjectSecurityTrustedProxies1809187364416";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityTrustedProxies" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityTrustedProxies"`,
    );
  }
}
