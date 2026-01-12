import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOAuthProviderType1768217403078 implements MigrationInterface {
    name = 'AddOAuthProviderType1768217403078'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add oauthProviderType column to ProjectSMTPConfig table
        // Values: 'Client Credentials' (for Microsoft 365, etc.) or 'JWT Bearer' (for Google Workspace)
        await queryRunner.query(`ALTER TABLE "ProjectSMTPConfig" ADD "oauthProviderType" character varying(100)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ProjectSMTPConfig" DROP COLUMN "oauthProviderType"`);
    }

}
