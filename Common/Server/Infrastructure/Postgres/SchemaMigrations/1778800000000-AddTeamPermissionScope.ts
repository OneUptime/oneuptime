import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTeamPermissionScope1778800000000 implements MigrationInterface {
  public name: string = "AddTeamPermissionScope1778800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ADD "scope" character varying(100) NOT NULL DEFAULT 'All'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TeamPermission" DROP COLUMN "scope"`);
  }
}
