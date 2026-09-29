import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOAuth2WorkflowVariables1794300000000
  implements MigrationInterface
{
  public name: string = "AddOAuth2WorkflowVariables1794300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "variableType" character varying(100) NOT NULL DEFAULT 'Static'`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthGrantType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthTokenUrl" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthClientId" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthClientSecret" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthRefreshToken" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthScope" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthAdditionalParameters" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthClientAuthenticationMethod" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthAccessToken" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthAccessTokenExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthLastRefreshedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthLastRefreshError" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" ADD "oauthLastRefreshErrorAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthLastRefreshErrorAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthLastRefreshError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthLastRefreshedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthAccessTokenExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthAccessToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthClientAuthenticationMethod"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthAdditionalParameters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthScope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthRefreshToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthClientSecret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthClientId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthTokenUrl"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "oauthGrantType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkflowVariable" DROP COLUMN "variableType"`,
    );
  }
}
