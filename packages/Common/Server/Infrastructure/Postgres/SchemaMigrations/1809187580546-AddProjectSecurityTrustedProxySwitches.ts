import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * The two switches of Security Events' Trusted Proxies:
 *
 *   - Project.securityTrustOwnLoadBalancers (#10546): whether the public
 *     addresses of the project's own application load balancers are
 *     trusted as proxies. On for every project, those from before included.
 *   - Project.securityReadAccessLogForwardedFor (#10548): whether the
 *     project's access logs end with X-Forwarded-For, so a combined log
 *     line's last field is read as the one its trusted proxy forwarded. Off
 *     for every project until it says so.
 *
 * Each a boolean with a constant default: Postgres keeps the default in the
 * catalog and rewrites no row of "Project", so the lock lasts an instant
 * (Docs/migrations/README.md).
 */
export class AddProjectSecurityTrustedProxySwitches1809187580546
  implements MigrationInterface
{
  public name: string = "AddProjectSecurityTrustedProxySwitches1809187580546";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityTrustOwnLoadBalancers" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityReadAccessLogForwardedFor" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityReadAccessLogForwardedFor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityTrustOwnLoadBalancers"`,
    );
  }
}
