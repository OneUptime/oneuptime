import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * Why a block or a cloud WAF is not enforced, in the reader's language
 * (#10629), for Azure WAF (#10348) and Cloud Armor (#10349): a block's
 * enforcement row keeps its destination's reason as a sentence and its
 * values (errorReason), and a cloud WAF keeps why it is not enforcing the
 * same way (statusReason). The Dashboard words both where it draws them.
 * OneUptime writes them; nobody writes them through a plain update.
 *
 * Nullable columns with no default: adding them rewrites no row of either
 * table and holds its lock for an instant (Docs/migrations/README.md).
 */
export class AddCloudWafAndEnforcementReasons1809187455000
  implements MigrationInterface
{
  public name: string = "AddCloudWafAndEnforcementReasons1809187455000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" ADD "errorReason" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" ADD "statusReason" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" DROP COLUMN "statusReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockEnforcement" DROP COLUMN "errorReason"`,
    );
  }
}
