import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRunbookAgentJobStepType1778784000000
  implements MigrationInterface
{
  public name: string = "AddRunbookAgentJobStepType1778784000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Add `stepType` so the agent knows whether to run the script as bash or
     * JavaScript. Default existing rows to 'Bash' since that is the only
     * step type the prior schema supported, then drop the default so future
     * inserts must specify it explicitly.
     */
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ADD "stepType" character varying(100) NOT NULL DEFAULT 'Bash'`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" ALTER COLUMN "stepType" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookAgentJob" DROP COLUMN "stepType"`,
    );
  }
}
