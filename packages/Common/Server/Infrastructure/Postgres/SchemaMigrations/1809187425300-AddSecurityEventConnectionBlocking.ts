import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * Blocking addresses at Cloudflare (#10343): a security connection keeps
 * whether OneUptime enforces the blocklist through it, and in which zones
 * (blockingSettings), and what OneUptime last found of its lists and rules
 * at the provider (blockingStatus). OneUptime writes both; nobody writes
 * them through a plain update.
 *
 * Nullable columns with no default: adding them rewrites no row of
 * "SecurityEventConnection" and holds its lock for an instant
 * (Docs/migrations/README.md).
 */
export class AddSecurityEventConnectionBlocking1809187425300
  implements MigrationInterface
{
  public name: string = "AddSecurityEventConnectionBlocking1809187425300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD "blockingSettings" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" ADD "blockingStatus" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP COLUMN "blockingStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventConnection" DROP COLUMN "blockingSettings"`,
    );
  }
}
