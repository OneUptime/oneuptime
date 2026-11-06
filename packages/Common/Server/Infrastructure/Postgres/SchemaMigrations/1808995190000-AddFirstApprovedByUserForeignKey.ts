import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddTwoPersonFixApproval1808995185000, and moved into a migration of its
 * own: the foreign key of AutoRemediationSuggestion.firstApprovedByUserId
 * checks every suggestion, so it goes through OnlineDdl.addForeignKey -
 * added NOT VALID, then validated without blocking the table's writers.
 * Every existing suggestion's column is null, so the validation finds
 * nothing to refuse. Safe to run again after a stop part way: OnlineDdl
 * validates a constraint an earlier run left unvalidated.
 */
export class AddFirstApprovedByUserForeignKey1808995190000
  implements MigrationInterface
{
  public name: string = "AddFirstApprovedByUserForeignKey1808995190000";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_a9cc7b1abe27dd67f3e18a31919" FOREIGN KEY ("firstApprovedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_a9cc7b1abe27dd67f3e18a31919"`,
    );
  }
}
