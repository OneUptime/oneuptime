import { MigrationInterface, QueryRunner } from "typeorm";

export class AddColumnsToTableView1785241000000 implements MigrationInterface {
  public name: string = "AddColumnsToTableView1785241000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TableView" ADD "columns" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TableView" DROP COLUMN "columns"`);
  }
}
