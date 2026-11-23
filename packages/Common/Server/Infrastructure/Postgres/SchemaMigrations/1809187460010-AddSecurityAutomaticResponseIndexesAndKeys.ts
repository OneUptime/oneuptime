import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityAutomaticResponse1809187460000, and moved into a migration of
 * its own: the blocklist's reconciler reads "SecurityBlock" every minute
 * and every block, lift and expiry writes it, and "SecurityPlaybookRun" is
 * written as cases open. So the index on the new
 * "securityAutomaticResponsePolicyId" column of "SecurityBlock" is built
 * online, and each key to "SecurityAutomaticResponsePolicy" is added NOT
 * VALID and then validated, without blocking those reads and writes
 * meanwhile. Every existing row's column is null, so the validation finds
 * nothing to refuse. Index and key names are TypeORM's own, so the schema
 * drift check finds nothing to change.
 *
 * A key sets a block's and a run's policy to null when the policy is
 * deleted (ON DELETE SET NULL): the block and the run are kept, as the
 * record of what was done.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddSecurityAutomaticResponseIndexesAndKeys1809187460010
  implements MigrationInterface
{
  public name: string =
    "AddSecurityAutomaticResponseIndexesAndKeys1809187460010";

  // CREATE INDEX CONCURRENTLY and the validations run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d24ca1b0b0120b5e39280ac55f" ON "SecurityBlock" ("securityAutomaticResponsePolicyId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "SecurityPlaybookRun" ADD CONSTRAINT "FK_2a9fe8a92a9161177deb0af6ae1" FOREIGN KEY ("securityAutomaticResponsePolicyId") REFERENCES "SecurityAutomaticResponsePolicy"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "SecurityBlock" ADD CONSTRAINT "FK_d24ca1b0b0120b5e39280ac55fc" FOREIGN KEY ("securityAutomaticResponsePolicyId") REFERENCES "SecurityAutomaticResponsePolicy"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" DROP CONSTRAINT "FK_d24ca1b0b0120b5e39280ac55fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybookRun" DROP CONSTRAINT "FK_2a9fe8a92a9161177deb0af6ae1"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d24ca1b0b0120b5e39280ac55f"`,
    );
  }
}
