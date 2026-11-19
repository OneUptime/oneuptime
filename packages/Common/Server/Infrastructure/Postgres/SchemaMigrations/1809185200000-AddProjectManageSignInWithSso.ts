import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Project.manageSignInWithSso (#9763): whether a project that requires SSO
 * also manages its people's sign-in with it. Off for every project, so
 * nothing changes until a project turns it on.
 */
export class AddProjectManageSignInWithSso1809185200000
  implements MigrationInterface
{
  public name = "AddProjectManageSignInWithSso1809185200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "manageSignInWithSso" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "manageSignInWithSso"`,
    );
  }
}
