import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddTelemetryExceptionMerge1808620000000, and moved into a migration of its
 * own: "TelemetryException" already exists, and is written by every
 * telemetry batch that holds an exception, so its new indexes are built
 * online and its foreign keys added NOT VALID and then validated, without
 * blocking the ingest upsert. Every existing row's new columns are null, so
 * the validation finds nothing to refuse. Safe to run again after a stop
 * part way: an index or key that is already there is left as it is.
 *
 *   - the exceptions merged into one, by its id (its page, the stats);
 *   - a partial index of the merged exceptions by project and fingerprint,
 *     which ingest looks a batch's fingerprints up in: it holds the merged
 *     rows only.
 */
export class AddTelemetryExceptionMergeIndexesAndKeys1808630000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionMergeIndexesAndKeys1808630000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_a2809261499d370b7fdfb68d05" ON "TelemetryException" ("mergedIntoTelemetryExceptionId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_188e30739d51035fa0266ed9c6" ON "TelemetryException" ("projectId", "fingerprint") WHERE "mergedIntoTelemetryExceptionId" IS NOT NULL`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_a2809261499d370b7fdfb68d055" FOREIGN KEY ("mergedIntoTelemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_5180c2dd43f2046f3fc3d97dc9b" FOREIGN KEY ("mergedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_5180c2dd43f2046f3fc3d97dc9b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_a2809261499d370b7fdfb68d055"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_188e30739d51035fa0266ed9c6"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a2809261499d370b7fdfb68d05"`,
    );
  }
}
