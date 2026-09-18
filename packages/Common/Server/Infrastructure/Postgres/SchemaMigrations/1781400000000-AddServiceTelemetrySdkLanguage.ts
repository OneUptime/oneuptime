import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Adds Service.telemetrySdkLanguage (the telemetry.sdk.language resource
 * attribute, e.g. java / dotnet / nodejs / python / go). Stamped at ingest
 * alongside the other system-managed resource-attribute columns and used
 * to pick technology-specific golden metrics on the service overview page.
 */
export class AddServiceTelemetrySdkLanguage1781400000000
  implements MigrationInterface
{
  public name = "AddServiceTelemetrySdkLanguage1781400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "telemetrySdkLanguage" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "telemetrySdkLanguage"`,
    );
  }
}
