import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * The addresses on a probe's own network interfaces, as it lists them when
 * it checks in (#10429): Probe.interfaceIpAddresses, comma-separated.
 * Security Events knows the probe's own polls, discovery sweeps and port
 * checks in the project's network flows by them, and the blocklist never
 * blocks them.
 *
 * A nullable column with no default: adding it rewrites no row of "Probe"
 * and holds its lock for an instant (Docs/migrations/README.md).
 */
export class AddProbeInterfaceIpAddresses1809187429000
  implements MigrationInterface
{
  public name: string = "AddProbeInterfaceIpAddresses1809187429000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" ADD "interfaceIpAddresses" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Probe" DROP COLUMN "interfaceIpAddresses"`,
    );
  }
}
