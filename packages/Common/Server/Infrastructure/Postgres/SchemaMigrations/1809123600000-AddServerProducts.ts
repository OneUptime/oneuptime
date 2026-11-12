import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The statements TypeORM's migration:generate writes for a nullable JSON
 * column of GlobalConfig (as AddServerSetupChoices1809110968240's), numbered
 * after the last registered migration.
 *
 * The products a server switches off for every project (issue #6815):
 * GlobalConfig.serverProducts - the products switched off, who switched
 * them off and when (Types/Product/ServerProducts). Nullable: nothing is
 * saved on a new server, or on one that upgrades, and every product stays
 * on until an admin (or SERVER_PRODUCTS) says otherwise.
 */
export class AddServerProducts1809123600000 implements MigrationInterface {
  public name: string = "AddServerProducts1809123600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "serverProducts" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "serverProducts"`,
    );
  }
}
