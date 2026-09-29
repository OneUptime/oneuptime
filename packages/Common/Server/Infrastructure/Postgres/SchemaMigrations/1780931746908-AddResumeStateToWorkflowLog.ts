import { MigrationInterface, QueryRunner } from "typeorm";

export class AddResumeStateToWorkflowLog1780931746908
  implements MigrationInterface
{
  public name = "AddResumeStateToWorkflowLog1780931746908";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" ADD "resumeAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "WorkflowLog" ADD "resumeData" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "resumeData"`,
    );
    await queryRunner.query(`ALTER TABLE "WorkflowLog" DROP COLUMN "resumeAt"`);
  }
}
