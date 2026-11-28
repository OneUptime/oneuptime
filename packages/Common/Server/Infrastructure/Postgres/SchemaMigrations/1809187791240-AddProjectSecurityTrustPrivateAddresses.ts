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
 * On for every project that is already here - the column's default, as the
 * model declares it - so none behind an ordinary HTTP proxy starts naming
 * that proxy as the attacker without having been asked. A new project
 * starts with it off: ProjectService.onBeforeCreate sets it when the create
 * request leaves it unset. A boolean with a constant default: Postgres adds
 * it without rewriting a row of "Project", so the lock lasts an instant
 * (Docs/migrations/README.md).
 */
export class AddProjectSecurityTrustPrivateAddresses1809187791240
  implements MigrationInterface
{
  public name: string = "AddProjectSecurityTrustPrivateAddresses1809187791240";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityTrustPrivateAddresses" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityTrustPrivateAddresses"`,
    );
  }
}
