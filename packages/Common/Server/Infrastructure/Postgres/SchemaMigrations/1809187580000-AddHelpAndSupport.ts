import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The statements TypeORM's migration:generate writes for a nullable JSON
 * column of GlobalConfig (as AddServerProducts1809123600000's), numbered
 * after the last registered migration.
 *
 * Where a server sends its people for help (issues #10864, #10865,
 * #10866): GlobalConfig.helpAndSupport - its own support address, chat,
 * help page, mobile app page and sign-in message, or OneUptime's
 * (Types/HelpAndSupport/HelpAndSupport). Nullable, with no default: adding
 * it rewrites no row, and a server that upgrades keeps showing exactly what
 * it showed before until an admin saves Admin Dashboard > Settings > Help
 * and Support.
 */
export class AddHelpAndSupport1809187580000 implements MigrationInterface {
  public name: string = "AddHelpAndSupport1809187580000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "helpAndSupport" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "helpAndSupport"`,
    );
  }
}
