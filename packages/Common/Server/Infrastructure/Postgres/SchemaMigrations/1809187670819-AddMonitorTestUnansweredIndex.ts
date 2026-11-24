import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #10819). Every
 * replica of every probe claims its Test Monitor runs every ten seconds,
 * and the claim read every test of the probe to find the few not yet
 * answered: answered tests are kept two days, so they are almost all of a
 * probe's rows - 2,501 pages read for 3 tests among 20,000 answered ones.
 * The index holds only the unanswered tests, by probe, oldest first, as the
 * claim reads them. "MonitorTest" holds rows, so it is built online, without
 * blocking the tests written meanwhile. Safe to run again after a stop part
 * way.
 */
export class AddMonitorTestUnansweredIndex1809187670819
  implements MigrationInterface
{
  public name: string = "AddMonitorTestUnansweredIndex1809187670819";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_3757a5e288a418e78a71a91316" ON "MonitorTest" ("probeId", "createdAt") WHERE "monitorStepProbeResponse" IS NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_3757a5e288a418e78a71a91316"`,
    );
  }
}
