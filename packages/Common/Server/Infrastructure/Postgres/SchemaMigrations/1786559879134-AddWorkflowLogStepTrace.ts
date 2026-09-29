import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkflowLogStepTrace1786559879134
  implements MigrationInterface
{
  public name: string = "AddWorkflowLogStepTrace1786559879134";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "WorkflowLog" ADD "stepTrace" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP COLUMN "stepTrace"`,
    );
  }
}
