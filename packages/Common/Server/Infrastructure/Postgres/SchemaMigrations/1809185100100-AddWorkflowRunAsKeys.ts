import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddWorkflowRunAs1809185100000, and moved into a migration of its own: the
 * key of WorkflowLog.runAsGivenByUserId checks every run of every workflow,
 * kept for 30 days, and the Workflow keys check every workflow, so each goes
 * through OnlineDdl.addForeignKey - added NOT VALID, then validated without
 * blocking the runner's writes (Docs/migrations/README.md). Every existing
 * row names nobody, so the validation finds nothing to refuse.
 *
 *   - Workflow.runAsCustomRoleId -> CustomRole, ON DELETE SET NULL: a
 *     workflow whose role is deleted keeps its graph, and runs nothing
 *     until someone chooses what it runs as (WorkflowRunAsAuthority).
 *   - Workflow.runAsGivenByUserId -> User, ON DELETE SET NULL: a workflow
 *     whose person is deleted runs nothing raised until someone gives it
 *     its permissions again.
 *   - WorkflowLog.runAsGivenByUserId -> User, ON DELETE SET NULL: a run
 *     keeps what it ran as.
 *
 * The names are the generated ones, so the drift check finds nothing to
 * change. Safe to run again after a stop part way: OnlineDdl validates a
 * key an earlier run left unvalidated.
 */
export class AddWorkflowRunAsKeys1809185100100 implements MigrationInterface {
  public name: string = "AddWorkflowRunAsKeys1809185100100";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_b820857aa10fda7eb16f788f221" FOREIGN KEY ("runAsCustomRoleId") REFERENCES "CustomRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_8f14f215221edcbbf0f4504ab21" FOREIGN KEY ("runAsGivenByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_536db0d5c3930fb89a4499d92b9" FOREIGN KEY ("runAsGivenByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_536db0d5c3930fb89a4499d92b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_8f14f215221edcbbf0f4504ab21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_b820857aa10fda7eb16f788f221"`,
    );
  }
}
