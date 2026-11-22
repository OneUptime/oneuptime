import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddScrubRuleService1809187433000, and moved into a migration of its own:
 * ingest reads "LogScrubRule" and "TraceScrubRule" for every project that
 * sends telemetry, and the foreign keys point at "Service", which ingest
 * writes as services appear. So each index on the new "serviceId" columns
 * is built online, and each key is added NOT VALID and then validated,
 * without blocking those reads and writes meanwhile. Every existing rule's
 * column is null, so the validation finds nothing to refuse. Index and key
 * names are TypeORM's own, so the schema drift check finds nothing to
 * change.
 *
 * A key deletes a rule with its service (ON DELETE CASCADE), as a metric
 * pipeline rule for a service goes with it: no telemetry of that service is
 * left to scrub. The index keeps that delete from reading every rule.
 *
 * Safe to run again after a stop part way: an index or key that is already
 * there is left as it is.
 */
export class AddScrubRuleServiceIndexesAndKeys1809187433010
  implements MigrationInterface
{
  public name: string = "AddScrubRuleServiceIndexesAndKeys1809187433010";

  // CREATE INDEX CONCURRENTLY and the validations run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e21d8142d41e585ea419860bb5" ON "LogScrubRule" ("serviceId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d8851036215e003ce8d6a5a7f1" ON "TraceScrubRule" ("serviceId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_e21d8142d41e585ea419860bb56" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TraceScrubRule" ADD CONSTRAINT "FK_d8851036215e003ce8d6a5a7f1f" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP CONSTRAINT "FK_d8851036215e003ce8d6a5a7f1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_e21d8142d41e585ea419860bb56"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d8851036215e003ce8d6a5a7f1"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e21d8142d41e585ea419860bb5"`,
    );
  }
}
