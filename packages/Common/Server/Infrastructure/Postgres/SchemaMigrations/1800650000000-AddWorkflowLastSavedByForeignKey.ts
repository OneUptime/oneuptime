import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddWorkflowLastSavedBy1800600000000, and moved into a migration of its
 * own: the foreign key of Workflow.lastSavedByUserId checks every workflow,
 * so it goes through OnlineDdl.addForeignKey - added NOT VALID, then
 * validated without blocking the table's writers. Safe to run again after a
 * stop part way: OnlineDdl validates a constraint an earlier run left
 * unvalidated.
 */
export class AddWorkflowLastSavedByForeignKey1800650000000
  implements MigrationInterface
{
  public name: string = "AddWorkflowLastSavedByForeignKey1800650000000";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b" FOREIGN KEY ("lastSavedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_cfb3d733c4f4b78897f3339187b"`,
    );
  }
}
