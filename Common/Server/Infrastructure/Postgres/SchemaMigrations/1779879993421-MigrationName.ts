import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1779879993421 implements MigrationInterface {
  public name = "MigrationName1779879993421";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_telemetry_exception_project_service_fingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    /*
     * Remove pre-existing duplicates so the unique index below can be created.
     * Done as: one cheap GROUP BY to find duplicate keys, then a small DELETE
     * per key — keeps every individual statement well under the 30s
     * statement/query timeout that applies to the migration connection.
     */
    const duplicateKeys: Array<{
      projectId: string;
      serviceId: string;
      fingerprint: string;
    }> = await queryRunner.query(
      `SELECT "projectId", "serviceId", "fingerprint"
       FROM "TelemetryException"
       GROUP BY "projectId", "serviceId", "fingerprint"
       HAVING COUNT(*) > 1`,
    );
    for (const key of duplicateKeys) {
      await queryRunner.query(
        `DELETE FROM "TelemetryException"
         WHERE "projectId" = $1
           AND "serviceId" = $2
           AND "fingerprint" = $3
           AND "_id" <> (
             SELECT "_id" FROM "TelemetryException"
             WHERE "projectId" = $1
               AND "serviceId" = $2
               AND "fingerprint" = $3
             ORDER BY "lastSeenAt" DESC NULLS LAST, "_id" DESC
             LIMIT 1
           )`,
        [key.projectId, key.serviceId, key.fingerprint],
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_1f55d43a0b73e883bb226158c7" ON "TelemetryException" ("projectId", "serviceId", "fingerprint") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_1f55d43a0b73e883bb226158c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_telemetry_exception_project_service_fingerprint" ON "TelemetryException" ("projectId", "serviceId", "fingerprint") `,
    );
  }
}
