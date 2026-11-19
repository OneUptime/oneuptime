import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The master admins' switch that lets anyone who may invite people to a
 * project find every account on the server in the invite forms' email box
 * (#9744): GlobalConfig.suggestServerAccountsWhenInviting, false - only
 * master admins are offered the server's other accounts - for the server
 * that exists too. A nullable column with a constant default is added
 * without rewriting the table.
 */
export class AddSuggestServerAccountsWhenInviting1809185347450
  implements MigrationInterface
{
  public name: string = "AddSuggestServerAccountsWhenInviting1809185347450";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "suggestServerAccountsWhenInviting" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "suggestServerAccountsWhenInviting"`,
    );
  }
}
