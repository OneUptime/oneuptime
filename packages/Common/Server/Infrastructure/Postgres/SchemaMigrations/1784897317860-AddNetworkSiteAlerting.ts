import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Site-level alerting: a NetworkSite can open an Alert when its health
 * rollup transitions to a non-operational status and auto-resolve it on
 * recovery. shouldAlertWhenUnhealthy arms it, alertSeverityId picks the
 * severity (project's most severe when NULL), and currentActiveAlertId is
 * the rollup engine's bookkeeping of the open alert.
 *
 * Generated via `npm run generate-postgres-migration`, then pruned to the
 * NetworkSite statements only — the generator also emitted unrelated
 * dev-database drift (a destructive rebuild of the discovery-scan SNMP key
 * columns and OnCallDutyPolicyScheduleLayer default churn) that must not
 * ship.
 */
export class AddNetworkSiteAlerting1784897317860 implements MigrationInterface {
  public name = "AddNetworkSiteAlerting1784897317860";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "shouldAlertWhenUnhealthy" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "alertSeverityId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "currentActiveAlertId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD CONSTRAINT "FK_345025b259450cca066b9f5b43d" FOREIGN KEY ("alertSeverityId") REFERENCES "AlertSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP CONSTRAINT "FK_345025b259450cca066b9f5b43d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "currentActiveAlertId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "alertSeverityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "shouldAlertWhenUnhealthy"`,
    );
  }
}
