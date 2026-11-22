import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A log or trace scrub rule may name the service whose telemetry it scrubs
 * (#10433): Scrub It makes its rule for the service a finding was seen in,
 * so the rule hides data in that service's logs or spans and changes no
 * other service's - nor breaks the monitors and recording rules that read
 * them (LogScrubRule.serviceId, TraceScrubRule.serviceId).
 *
 * The columns only, nullable with no default, so no row is rewritten and
 * every rule saved before keeps scrubbing every service, as it did. The
 * indexes and foreign keys generated with them are built online, in
 * AddScrubRuleServiceIndexesAndKeys1809187433010: ingest reads these
 * tables for every project that sends telemetry, and the keys point at
 * "Service", which ingest writes too.
 */
export class AddScrubRuleService1809187433000 implements MigrationInterface {
  public name: string = "AddScrubRuleService1809187433000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "LogScrubRule" ADD "serviceId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" ADD "serviceId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TraceScrubRule" DROP COLUMN "serviceId"`,
    );
    await queryRunner.query(`ALTER TABLE "LogScrubRule" DROP COLUMN "serviceId"`);
  }
}
