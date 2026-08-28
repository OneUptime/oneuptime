import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Network site health rollup policy + scheduled maintenance (issue #3431).
 *
 * `healthRollupPolicy` defaults to WorstStatus and `offlineThresholdPercent`
 * to 50, so every existing site keeps rolling up exactly as it did — the
 * threshold column is inert until a site opts into the percentage policy.
 *
 * `ScheduledMaintenanceNetworkSite` is the join table that lets a
 * maintenance window cover a site (and, by hierarchy, everything under it).
 */

export class AddNetworkSiteRollupPolicyAndMaintenance1787870907338
  implements MigrationInterface
{
  public name: string = "AddNetworkSiteRollupPolicyAndMaintenance1787870907338";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceNetworkSite" ("scheduledMaintenanceId" uuid NOT NULL, "networkSiteId" uuid NOT NULL, CONSTRAINT "PK_a681f30c9cb03c3bfa93d6d5037" PRIMARY KEY ("scheduledMaintenanceId", "networkSiteId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8b7cce916b128ceda5e9f8e273" ON "ScheduledMaintenanceNetworkSite" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_872ce07950223aab717f5b063f" ON "ScheduledMaintenanceNetworkSite" ("networkSiteId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "healthRollupPolicy" character varying(100) NOT NULL DEFAULT 'WorstStatus'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" ADD "offlineThresholdPercent" integer NOT NULL DEFAULT '50'`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNetworkSite" ADD CONSTRAINT "FK_8b7cce916b128ceda5e9f8e273c" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNetworkSite" ADD CONSTRAINT "FK_872ce07950223aab717f5b063f1" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNetworkSite" DROP CONSTRAINT "FK_872ce07950223aab717f5b063f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceNetworkSite" DROP CONSTRAINT "FK_8b7cce916b128ceda5e9f8e273c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "offlineThresholdPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkSite" DROP COLUMN "healthRollupPolicy"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_872ce07950223aab717f5b063f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8b7cce916b128ceda5e9f8e273"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceNetworkSite"`);
  }
}
