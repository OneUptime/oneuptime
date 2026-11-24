import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its indexes and foreign keys are built
 * online by AddTelemetryExceptionFormerFingerprintAndSplitFromIndexesAndKeys
 * 1809187520628.
 *
 *   - "TelemetryException"."formerFingerprintOfTelemetryExceptionId": set on
 *     a row that only keeps the fingerprint an exception had before
 *     OneUptime moved it to a private one, because a scrub rule hid part of
 *     what the old one was an unkeyed hash of (#10619,
 *     TelemetryExceptionRekey).
 *   - "TelemetryException"."splitFromTelemetryExceptionId": the exception a
 *     scrub rule split this one from before #10434, which ingest records
 *     once it sees the pair, so the page can offer to merge them (#10618).
 *
 * Two nullable columns with no default: adding them rewrites nothing.
 */
export class AddTelemetryExceptionFormerFingerprintAndSplitFrom1809187520618
  implements MigrationInterface
{
  public name: string =
    "AddTelemetryExceptionFormerFingerprintAndSplitFrom1809187520618";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "formerFingerprintOfTelemetryExceptionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD "splitFromTelemetryExceptionId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "splitFromTelemetryExceptionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN "formerFingerprintOfTelemetryExceptionId"`,
    );
  }
}
