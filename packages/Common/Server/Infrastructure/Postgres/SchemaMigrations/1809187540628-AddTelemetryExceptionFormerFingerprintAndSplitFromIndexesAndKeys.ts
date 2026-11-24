import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddTelemetryExceptionFormerFingerprintAndSplitFrom1809187540618, and moved
 * into a migration of its own: "TelemetryException" already exists, and is
 * written by every telemetry batch that holds an exception, so its new
 * indexes are built online and its foreign keys added NOT VALID and then
 * validated, without blocking the ingest upsert. Every existing row's new
 * columns are null, so the validation finds nothing to refuse. Safe to run
 * again after a stop part way: an index or key that is already there is left
 * as it is.
 *
 *   - partial indexes of the rows that keep an exception's former
 *     fingerprint, and of the exceptions a scrub rule split from another,
 *     each by that exception's id: what deleting it reads for its keys, and
 *     what an unmerge brings back with it. Each holds those few rows only.
 *   - a former fingerprint goes with its exception (ON DELETE CASCADE); a
 *     split exception forgets the one it was split from when that one goes
 *     (ON DELETE SET NULL).
 */
export class AddTelemetryExceptionFormerFingerprintAndSplitFromIndexesAndKeys1809187540628
  implements MigrationInterface
{
  public name: string =
    "AddTelemetryExceptionFormerFingerprintAndSplitFromIndexesAndKeys1809187540628";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e66b59655ac7515737a94cc259" ON "TelemetryException" ("splitFromTelemetryExceptionId") WHERE "splitFromTelemetryExceptionId" IS NOT NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_37504c1a78d085b028b101eef6" ON "TelemetryException" ("formerFingerprintOfTelemetryExceptionId") WHERE "formerFingerprintOfTelemetryExceptionId" IS NOT NULL`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_6c924476b1a72cfc97edfe8c897" FOREIGN KEY ("formerFingerprintOfTelemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_145a40e0aed4f0b1ee5739dcf24" FOREIGN KEY ("splitFromTelemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_145a40e0aed4f0b1ee5739dcf24"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_6c924476b1a72cfc97edfe8c897"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_37504c1a78d085b028b101eef6"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e66b59655ac7515737a94cc259"`,
    );
  }
}
