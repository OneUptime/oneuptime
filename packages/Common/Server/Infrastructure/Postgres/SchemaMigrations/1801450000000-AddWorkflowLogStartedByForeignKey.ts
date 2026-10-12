import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddWorkflowLogTestRun1801400000000, and moved into a migration of its own:
 * the foreign key of WorkflowLog.startedByUserId checks every run of every
 * workflow, kept for 30 days, so it goes through OnlineDdl.addForeignKey -
 * added NOT VALID, then validated without blocking the runner's writes to
 * the table. Every existing row names nobody, so the validation finds
 * nothing to refuse. Safe to run again after a stop part way: OnlineDdl
 * validates a constraint an earlier run left unvalidated.
 */
export class AddWorkflowLogStartedByForeignKey1801450000000
  implements MigrationInterface
{
  public name: string = "AddWorkflowLogStartedByForeignKey1801450000000";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_5ec2cc2bd5a20e34795ebf4bb89" FOREIGN KEY ("startedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_5ec2cc2bd5a20e34795ebf4bb89"`,
    );
  }
}
