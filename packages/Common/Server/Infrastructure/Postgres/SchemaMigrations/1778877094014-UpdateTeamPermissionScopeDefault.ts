import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTeamPermissionScopeDefault1778877094014
  implements MigrationInterface
{
  public name: string = "UpdateTeamPermissionScopeDefault1778877094014";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ALTER COLUMN "scope" SET DEFAULT 'All'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TeamPermission" ALTER COLUMN "scope" SET DEFAULT 'Labels'`,
    );
  }
}
