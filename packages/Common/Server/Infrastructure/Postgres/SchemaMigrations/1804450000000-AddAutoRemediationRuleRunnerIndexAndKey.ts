import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddAutoRemediationRuleRunner1804400000000, and moved into a migration of
 * its own: projects already have rules in "AutoRemediationRule", so the
 * index on its new "runnerId" column is built online, and the foreign key
 * to "Runner" is added NOT VALID and then validated, without blocking the
 * rule engine's reads and the writes a rule gets meanwhile. The carry-over
 * gave a rule only a Runner of its own project that exists, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way.
 */
export class AddAutoRemediationRuleRunnerIndexAndKey1804450000000
  implements MigrationInterface
{
  public name: string = "AddAutoRemediationRuleRunnerIndexAndKey1804450000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_338f34b0d3cbf32aa45e778ade" ON "AutoRemediationRule" ("runnerId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationRule" ADD CONSTRAINT "FK_338f34b0d3cbf32aa45e778ade1" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP CONSTRAINT "FK_338f34b0d3cbf32aa45e778ade1"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_338f34b0d3cbf32aa45e778ade"`,
    );
  }
}
