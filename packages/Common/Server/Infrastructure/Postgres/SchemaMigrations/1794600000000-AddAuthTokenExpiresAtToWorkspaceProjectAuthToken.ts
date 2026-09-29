import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuthTokenExpiresAtToWorkspaceProjectAuthToken1794600000000
  implements MigrationInterface
{
  public name: string =
    "AddAuthTokenExpiresAtToWorkspaceProjectAuthToken1794600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" ADD "authTokenExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceProjectAuthToken" DROP COLUMN "authTokenExpiresAt"`,
    );
  }
}
