import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1753383711511 implements MigrationInterface {
  public name = "MigrationName1753383711511";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b03e14b5a5fc9f5b8603283c88" ON "OnCallDutyPolicyExecutionLogTimeline" ("alertSentToUserId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_114e3f761691867aa919ab6b6e" ON "OnCallDutyPolicyExecutionLogTimeline" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f34e1244e487f705e7c6b25831" ON "OnCallDutyPolicyExecutionLogTimeline" ("onCallDutyPolicyExecutionLogId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_34f21c8ae164fb90be806818a8" ON "OnCallDutyPolicyOwnerTeam" ("onCallDutyPolicyId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1539db4bbd6ada58abb940b058" ON "OnCallDutyPolicyOwnerUser" ("onCallDutyPolicyId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_00439dd14338c3ee4e81d0714a" ON "ScheduledMaintenanceState" ("projectId", "isEndedState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7addde4d27f13be56651000df9" ON "ScheduledMaintenanceState" ("projectId", "isOngoingState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e84431ba010571147933477cff" ON "ScheduledMaintenanceState" ("projectId", "order") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b737666365dbea2e4c914fc6d3" ON "ScheduledMaintenanceOwnerTeam" ("scheduledMaintenanceId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a4621b7155a01292b92569549f" ON "ScheduledMaintenanceOwnerUser" ("scheduledMaintenanceId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4ac940ddb05242a166567edbb" ON "ScheduledMaintenanceStateTimeline" ("scheduledMaintenanceId", "startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4873976169085f14bdc39e168d" ON "StatusPageOwnerTeam" ("statusPageId", "teamId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9f80dc4f648f0957ce695dc61" ON "StatusPageOwnerUser" ("statusPageId", "userId", "projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33ba145fe2826bb953e2ce9d3d" ON "UserOnCallLogTimeline" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90363cc35c22e377df8fdc5dfb" ON "UserOnCallLogTimeline" ("onCallDutyPolicyExecutionLogId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89cccd6782b1ee84d20e9690d0" ON "UserOnCallLogTimeline" ("userId", "createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89cccd6782b1ee84d20e9690d0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90363cc35c22e377df8fdc5dfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33ba145fe2826bb953e2ce9d3d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a9f80dc4f648f0957ce695dc61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4873976169085f14bdc39e168d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4ac940ddb05242a166567edbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4621b7155a01292b92569549f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b737666365dbea2e4c914fc6d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e84431ba010571147933477cff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7addde4d27f13be56651000df9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_00439dd14338c3ee4e81d0714a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1539db4bbd6ada58abb940b058"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_34f21c8ae164fb90be806818a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f34e1244e487f705e7c6b25831"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_114e3f761691867aa919ab6b6e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b03e14b5a5fc9f5b8603283c88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
  }
}
