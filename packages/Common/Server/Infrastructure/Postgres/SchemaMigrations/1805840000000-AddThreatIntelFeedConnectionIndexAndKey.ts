import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddThreatIntelFeedSources1805820000000, and moved into a migration of its
 * own: ThreatIntelFeed already exists and every feed's poller writes to it,
 * so the index on its new "securityEventConnectionId" column is built
 * online, and the foreign key to "SecurityEventConnection" is added NOT
 * VALID and then validated, without blocking either table's writes. Every
 * existing feed's column is null, so the validation finds nothing to refuse.
 * Safe to run again after a stop part way, and on a database that ran the
 * first version of AddThreatIntelFeedSources1805820000000, which built both
 * in place: an index or key that is already there is left as it is.
 */
export class AddThreatIntelFeedConnectionIndexAndKey1805840000000
  implements MigrationInterface
{
  public name: string = "AddThreatIntelFeedConnectionIndexAndKey1805840000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4ceb7e2ec44885a5152983a2aa" ON "ThreatIntelFeed" ("securityEventConnectionId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "ThreatIntelFeed" ADD CONSTRAINT "FK_4ceb7e2ec44885a5152983a2aa2" FOREIGN KEY ("securityEventConnectionId") REFERENCES "SecurityEventConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ThreatIntelFeed" DROP CONSTRAINT "FK_4ceb7e2ec44885a5152983a2aa2"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4ceb7e2ec44885a5152983a2aa"`,
    );
  }
}
