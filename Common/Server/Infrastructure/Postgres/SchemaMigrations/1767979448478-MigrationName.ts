import { MigrationInterface, QueryRunner } from "typeorm";

// Schema + Data migration: Move TelemetryService to Service table
export class MigrationName1767979448478 implements MigrationInterface {
  public name = "MigrationName1767979448478";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Drop old FK constraints (pointing to TelemetryService)
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT IF EXISTS "FK_6470c69cb5f53c5899c0483df5f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT IF EXISTS "FK_91333210492e5d2f334231468a7"`,
    );

    // Step 2: Drop old indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_6470c69cb5f53c5899c0483df5"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_91333210492e5d2f334231468a"`,
    );

    // Step 3: Add retainTelemetryDataForDays column to Service (needed before data migration)
    await queryRunner.query(
      `ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "retainTelemetryDataForDays" integer DEFAULT '15'`,
    );

    /*
     * Step 4: Migrate TelemetryService data to Service table (BEFORE renaming columns and adding FK)
     * Preserve the same _id so existing references remain valid
     */
    const telemetryServiceTableExists = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'TelemetryService'
            )
        `);

    if (telemetryServiceTableExists[0]?.exists) {
      await queryRunner.query(`
                INSERT INTO "Service" (
                    "_id",
                    "createdAt",
                    "updatedAt",
                    "deletedAt",
                    "version",
                    "projectId",
                    "name",
                    "slug",
                    "description",
                    "createdByUserId",
                    "deletedByUserId",
                    "serviceColor",
                    "retainTelemetryDataForDays"
                )
                SELECT
                    "_id",
                    "createdAt",
                    "updatedAt",
                    "deletedAt",
                    "version",
                    "projectId",
                    "name",
                    "slug",
                    "description",
                    "createdByUserId",
                    "deletedByUserId",
                    "serviceColor",
                    "retainTelemetryDataForDays"
                FROM "TelemetryService"
                ON CONFLICT ("_id") DO NOTHING
            `);
    }

    // Step 5: Migrate TelemetryServiceLabel to ServiceLabel
    const telemetryServiceLabelExists = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'TelemetryServiceLabel'
            )
        `);

    if (telemetryServiceLabelExists[0]?.exists) {
      await queryRunner.query(`
                INSERT INTO "ServiceLabel" ("serviceId", "labelId")
                SELECT "telemetryServiceId", "labelId"
                FROM "TelemetryServiceLabel"
                ON CONFLICT DO NOTHING
            `);
    }

    // Step 6: Rename columns (telemetryServiceId -> serviceId)
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "telemetryServiceId" TO "serviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "telemetryServiceId" TO "serviceId"`,
    );

    // Step 7: Create MetricTypeService table
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "MetricTypeService" ("metricTypeId" uuid NOT NULL, "serviceId" uuid NOT NULL, CONSTRAINT "PK_21b7a84eea5b71922ac5ccc92e9" PRIMARY KEY ("metricTypeId", "serviceId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e6b6e365ad502b487cb63d2891" ON "MetricTypeService" ("metricTypeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c67839207ff53f33eb22648b56" ON "MetricTypeService" ("serviceId") `,
    );

    // Step 8: Migrate MetricTypeTelemetryService to MetricTypeService
    const metricTypeTelemetryServiceExists = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'MetricTypeTelemetryService'
            )
        `);

    if (metricTypeTelemetryServiceExists[0]?.exists) {
      await queryRunner.query(`
                INSERT INTO "MetricTypeService" ("metricTypeId", "serviceId")
                SELECT "metricTypeId", "telemetryServiceId"
                FROM "MetricTypeTelemetryService"
                ON CONFLICT DO NOTHING
            `);
    }

    // Step 10: Create new indexes
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_08a0cfa9f184257b1e57da4cf5" ON "TelemetryException" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_b9f49cd8318a35757fc843ee90" ON "TelemetryUsageBilling" ("serviceId") `,
    );

    // Step 11: Add new FK constraints (NOW safe because Service table has the migrated data)
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_08a0cfa9f184257b1e57da4cf50" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_b9f49cd8318a35757fc843ee900" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeService" ADD CONSTRAINT "FK_e6b6e365ad502b487cb63d28913" FOREIGN KEY ("metricTypeId") REFERENCES "MetricType"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeService" ADD CONSTRAINT "FK_c67839207ff53f33eb22648b567" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new FK constraints
    await queryRunner.query(
      `ALTER TABLE "MetricTypeService" DROP CONSTRAINT "FK_c67839207ff53f33eb22648b567"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MetricTypeService" DROP CONSTRAINT "FK_e6b6e365ad502b487cb63d28913"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP CONSTRAINT "FK_b9f49cd8318a35757fc843ee900"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT "FK_08a0cfa9f184257b1e57da4cf50"`,
    );

    // Drop new indexes
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9f49cd8318a35757fc843ee90"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08a0cfa9f184257b1e57da4cf5"`,
    );

    // Drop retainTelemetryDataForDays column
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "retainTelemetryDataForDays"`,
    );

    // Drop MetricTypeService table and indexes
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c67839207ff53f33eb22648b56"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e6b6e365ad502b487cb63d2891"`,
    );
    await queryRunner.query(`DROP TABLE "MetricTypeService"`);

    // Rename columns back
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "serviceId" TO "telemetryServiceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "serviceId" TO "telemetryServiceId"`,
    );

    // Recreate old indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_91333210492e5d2f334231468a" ON "TelemetryUsageBilling" ("telemetryServiceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6470c69cb5f53c5899c0483df5" ON "TelemetryException" ("telemetryServiceId") `,
    );

    // Restore old FK constraints (pointing back to TelemetryService)
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD CONSTRAINT "FK_91333210492e5d2f334231468a7" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_6470c69cb5f53c5899c0483df5f" FOREIGN KEY ("telemetryServiceId") REFERENCES "TelemetryService"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /*
     * Note: We don't delete the migrated data from Service table in down migration
     * as it could be dangerous if new Service records were created
     */
  }
}
