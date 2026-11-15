import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration and built online:
 * "DataStore" already holds rows, and discovery, the scans and the claims
 * write it all the time. OneUptime's workers claim the due stores no probe
 * scans, of the kinds they sample, every five minutes
 * (DataSecurityWorkerClaim): with this index the claim reads each such
 * kind's due rows, and none of the rest of the table - most of which is
 * telemetry and the cloud kinds no worker samples (OneUptime issue #8450).
 * Partial on "scanProbeId" IS NULL, which no switch moves a store in or out
 * of. Safe to run again after a stop part way.
 */
export class AddDataStoreWorkerContentScanIndex1809179800000
  implements MigrationInterface
{
  public name: string = "AddDataStoreWorkerContentScanIndex1809179800000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_b16e7b0369be808323916d80a7" ON "DataStore" ("kind", "nextContentScanAt") WHERE "scanProbeId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_b16e7b0369be808323916d80a7"`,
    );
  }
}
