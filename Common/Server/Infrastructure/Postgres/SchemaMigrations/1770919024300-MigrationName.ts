import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1770919024300 implements MigrationInterface {
  public name = "MigrationName1770919024300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" ADD "workspaceProjectAuthTokenId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" ADD "workspaceProjectId" character varying(500)`,
    );

    await queryRunner.query(
      `WITH latest_auth AS (
        SELECT DISTINCT ON ("projectId", "workspaceType")
          "_id",
          "projectId",
          "workspaceType",
          "workspaceProjectId"
        FROM "WorkspaceProjectAuthToken"
        ORDER BY "projectId", "workspaceType", "createdAt" DESC
      )
      UPDATE "WorkspaceNotificationRule" AS r
      SET "workspaceProjectAuthTokenId" = latest_auth."_id"
      FROM latest_auth
      WHERE r."projectId" = latest_auth."projectId"
        AND r."workspaceType" = latest_auth."workspaceType"`,
    );

    await queryRunner.query(
      `WITH latest_auth AS (
        SELECT DISTINCT ON ("projectId", "workspaceType")
          "projectId",
          "workspaceType",
          "workspaceProjectId"
        FROM "WorkspaceProjectAuthToken"
        ORDER BY "projectId", "workspaceType", "createdAt" DESC
      )
      UPDATE "WorkspaceUserAuthToken" AS u
      SET "workspaceProjectId" = latest_auth."workspaceProjectId"
      FROM latest_auth
      WHERE u."projectId" = latest_auth."projectId"
        AND u."workspaceType" = latest_auth."workspaceType"`,
    );

    await queryRunner.query(
      `DELETE FROM "WorkspaceNotificationRule" WHERE "workspaceProjectAuthTokenId" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" ALTER COLUMN "workspaceProjectAuthTokenId" SET NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_notification_rule_workspace_project_auth_token_id" ON "WorkspaceNotificationRule" ("workspaceProjectAuthTokenId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_workspace_user_auth_token_workspace_project_id" ON "WorkspaceUserAuthToken" ("workspaceProjectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_workspace_user_auth_token_workspace_project_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_workspace_notification_rule_workspace_project_auth_token_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationRule" DROP COLUMN "workspaceProjectAuthTokenId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceUserAuthToken" DROP COLUMN "workspaceProjectId"`,
    );
  }
}
