import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1765540549739 implements MigrationInterface {
    name = 'MigrationName1765540549739'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Delete all Copilot and CodeRepository related tables
        // Drop tables in correct order respecting foreign key constraints
        
        // First drop CopilotActionTypePriority (depends on CopilotCodeRepository)
        await queryRunner.query(`DROP TABLE IF EXISTS "CopilotActionTypePriority" CASCADE`);
        
        // Drop CopilotPullRequest (depends on CopilotCodeRepository, ServiceCopilotCodeRepository)
        await queryRunner.query(`DROP TABLE IF EXISTS "CopilotPullRequest" CASCADE`);
        
        // Drop CopilotAction (depends on CodeRepository, ServiceRepository)
        await queryRunner.query(`DROP TABLE IF EXISTS "CopilotAction" CASCADE`);
        
        // Drop ServiceCopilotCodeRepository (depends on CopilotCodeRepository)
        await queryRunner.query(`DROP TABLE IF EXISTS "ServiceCopilotCodeRepository" CASCADE`);
        
        // Drop CopilotCodeRepositoryLabel (junction table)
        await queryRunner.query(`DROP TABLE IF EXISTS "CopilotCodeRepositoryLabel" CASCADE`);
        
        // Drop CopilotCodeRepository
        await queryRunner.query(`DROP TABLE IF EXISTS "CopilotCodeRepository" CASCADE`);
        
        // Drop ServiceRepository (depends on CodeRepository)
        await queryRunner.query(`DROP TABLE IF EXISTS "ServiceRepository" CASCADE`);
        
        // Drop CodeRepositoryLabel (junction table)
        await queryRunner.query(`DROP TABLE IF EXISTS "CodeRepositoryLabel" CASCADE`);
        
        // Drop CodeRepository
        await queryRunner.query(`DROP TABLE IF EXISTS "CodeRepository" CASCADE`);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Note: The down migration does not recreate the Copilot and CodeRepository tables
        // as they are being permanently removed from the system.
        // If you need to restore these tables, you would need to run the original migrations
        // that created them (1717955235341, 1718037833516, 1718124277321, 1718879960254, 
        // 1720532068612, 1720785305192, 1725291476867).
    }

}
