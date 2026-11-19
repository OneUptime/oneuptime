import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddWorkflowRunAsApiKey1809185400000, and moved into a migration of its
 * own: the key checks every workflow, so it goes through
 * OnlineDdl.addForeignKey - added NOT VALID, then validated without
 * blocking the writes to "Workflow" (Docs/migrations/README.md). Every
 * existing row names no key, so the validation finds nothing to refuse.
 *
 *   - Workflow.runAsGivenByApiKeyId -> ApiKey, ON DELETE SET NULL: a
 *     workflow whose key is deleted (revoked) runs nothing raised until
 *     someone gives it its permissions again (WorkflowRunAsAuthority).
 *
 * The name is the generated one, so the drift check finds nothing to
 * change. Safe to run again after a stop part way: OnlineDdl validates a
 * key an earlier run left unvalidated.
 */
export class AddWorkflowRunAsApiKeyKey1809185400100
  implements MigrationInterface
{
  public name: string = "AddWorkflowRunAsApiKeyKey1809185400100";

  // OnlineDdl.addForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_656f7b719b389da279b104f681d" FOREIGN KEY ("runAsGivenByApiKeyId") REFERENCES "ApiKey"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_656f7b719b389da279b104f681d"`,
    );
  }
}
