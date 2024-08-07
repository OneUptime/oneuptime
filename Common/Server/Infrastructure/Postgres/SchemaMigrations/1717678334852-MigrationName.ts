import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";

export class MigrationName1717678334852 implements MigrationInterface {
  public name: string = "MigrationName1717678334852";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // check if the column exists

    const apiKeyPermissionTable: Table | undefined =
      await queryRunner.getTable("ApiKeyPermission");

    if (apiKeyPermissionTable) {
      const isBlockPermissionColumn: TableColumn | undefined =
        apiKeyPermissionTable.columns.find((column: TableColumn) => {
          return column.name === "isBlockPermission";
        });

      if (!isBlockPermissionColumn) {
        await queryRunner.query(
          `ALTER TABLE "ApiKeyPermission" ADD "isBlockPermission" boolean NOT NULL DEFAULT false`,
        );
      }
    }

    // check if the column exists

    const teamPermissionTable: Table | undefined =
      await queryRunner.getTable("TeamPermission");

    if (teamPermissionTable) {
      const isBlockPermissionColumn: TableColumn | undefined =
        teamPermissionTable.columns.find((column: TableColumn) => {
          return column.name === "isBlockPermission";
        });

      if (!isBlockPermissionColumn) {
        await queryRunner.query(
          `ALTER TABLE "TeamPermission" ADD "isBlockPermission" boolean NOT NULL DEFAULT false`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" DROP COLUMN "isBlockPermission"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ApiKeyPermission" DROP COLUMN "isBlockPermission"`,
    );
  }
}
