import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Numbered after the last registered migration.
 *
 * Project.securityTrustPrivateAddresses (#11389): whether Security Events
 * trusts private, loopback and link-local addresses as proxies without
 * their being listed. A TCP-level proxy at a private address passes on the
 * X-Forwarded-For a client wrote, so trusting every private address let a
 * client choose the address an attack is blamed on.
 *
 * Off for a new project: the model's default, and what the generator writes
 * (`ADD ... boolean NOT NULL DEFAULT false`). On for every project that is
 * already here, so none behind an ordinary HTTP proxy starts naming that
 * proxy as the attacker without having been asked: the column is added
 * with DEFAULT true, which fills every row there is, and its default is
 * then set to false for the rows to come. Both are catalog changes -
 * Postgres keeps a constant default without rewriting "Project" - so the
 * lock lasts an instant (Docs/migrations/README.md), and the column ends as
 * the model declares it, so the drift check finds nothing to add.
 */
export class AddProjectSecurityTrustPrivateAddresses1809187791240
  implements MigrationInterface
{
  public name: string = "AddProjectSecurityTrustPrivateAddresses1809187791240";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityTrustPrivateAddresses" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ALTER COLUMN "securityTrustPrivateAddresses" SET DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityTrustPrivateAddresses"`,
    );
  }
}
