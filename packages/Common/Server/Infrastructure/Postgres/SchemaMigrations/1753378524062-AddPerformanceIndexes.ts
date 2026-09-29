import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPerformanceIndexes1753378524062 implements MigrationInterface {
  public name = "AddPerformanceIndexes1753378524062";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3c2f8998deba67cedb958fc08f" ON "IncidentSeverity" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2283c2d1aab23419b784db0d84" ON "IncidentState" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ed23cf5e6614ee930972ab6b5" ON "IncidentState" ("projectId", "isResolvedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b231eb3cdc945e53947495cf76" ON "IncidentState" ("projectId", "isCreatedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c9760b0f7df9fe68efd52151d" ON "MonitorStatus" ("projectId", "isOfflineState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c64d2b5df8c5cac0ece90d899" ON "MonitorStatus" ("projectId", "isOperationalState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4490b10d3394a9be5f27f8fc3b" ON "IncidentOwnerTeam" ("incidentId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d8d2229e31e4ec13ec99c79ae" ON "IncidentOwnerUser" ("incidentId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7b7272644aab237d503ed3429a" ON "MonitorOwnerTeam" ("monitorId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f6246149ab744fd62ada06ee5" ON "MonitorOwnerUser" ("monitorId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c98e7e9e31d674cf5c47b15f36" ON "AlertSeverity" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3bb6dc217814170a3b37e21bf5" ON "AlertState" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b20be7b2ca1a6dc602da305f8a" ON "AlertState" ("projectId", "isAcknowledgedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae2854ea86740fdd56eaf2fea9" ON "AlertState" ("projectId", "isResolvedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_91ad158d170a9b51a2046fcc87" ON "AlertState" ("projectId", "isCreatedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d640454e87b3dd4f24f9c527d2" ON "AlertStateTimeline" ("alertId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfbcaebaa02d06a556fd2e155c" ON "AlertOwnerTeam" ("alertId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_042a7841d65141fb940de9d881" ON "AlertOwnerUser" ("alertId", "userId", "projectId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_042a7841d65141fb940de9d881"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfbcaebaa02d06a556fd2e155c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d640454e87b3dd4f24f9c527d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91ad158d170a9b51a2046fcc87"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae2854ea86740fdd56eaf2fea9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b20be7b2ca1a6dc602da305f8a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3bb6dc217814170a3b37e21bf5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c98e7e9e31d674cf5c47b15f36"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f6246149ab744fd62ada06ee5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b7272644aab237d503ed3429a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d8d2229e31e4ec13ec99c79ae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4490b10d3394a9be5f27f8fc3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c64d2b5df8c5cac0ece90d899"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c9760b0f7df9fe68efd52151d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b231eb3cdc945e53947495cf76"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ed23cf5e6614ee930972ab6b5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2283c2d1aab23419b784db0d84"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3c2f8998deba67cedb958fc08f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
  }
}
