import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFacetsToTableView1779536271671 implements MigrationInterface {
  public name: string = "AddFacetsToTableView1779536271671";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TableView" ADD "facets" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TableView" DROP COLUMN "facets"`);
  }
}
