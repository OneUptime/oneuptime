import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data Security's names-and-addresses model (#10373):
 *
 *  - DataSecuritySetting.isModelScanEnabled: content scans read free text
 *    for people's names and street addresses with the model inside the
 *    scanner. On for every project, as the issue decided.
 *  - DataSecuritySetting.isTelemetryModelScanEnabled: the hourly telemetry
 *    scan does too. Off for every project until its cost allows more.
 *  - DataStoreFinding.isFoundByModel: a finding the model made, so the
 *    finding can say so.
 *
 * Columns with constant defaults: PostgreSQL 11 and later add them without
 * rewriting a row, so nothing is locked for longer than the catalog change.
 */
export class AddDataSecurityNamesAndAddressesModel1809187540373
  implements MigrationInterface
{
  public name: string = "AddDataSecurityNamesAndAddressesModel1809187540373";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "isFoundByModel" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD "isModelScanEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" ADD "isTelemetryModelScanEnabled" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP COLUMN "isTelemetryModelScanEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecuritySetting" DROP COLUMN "isModelScanEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "isFoundByModel"`,
    );
  }
}
