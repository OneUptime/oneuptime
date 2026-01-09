import { MigrationInterface, QueryRunner } from "typeorm";

// Data migration: Move data from TelemetryService to Service table
export class MigrationName1767979448479 implements MigrationInterface {
    public name = 'MigrationName1767979448479'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if TelemetryService table exists before migrating data
        const telemetryServiceTableExists = await queryRunner.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'TelemetryService'
            )
        `);

        if (!telemetryServiceTableExists[0]?.exists) {
            // TelemetryService table doesn't exist, nothing to migrate
            return;
        }

        // Step 1: Copy TelemetryService data to Service table
        // Insert TelemetryService records into Service, preserving the same _id
        // This ensures existing FK references in TelemetryException, TelemetryUsageBilling remain valid
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

        // Step 2: Copy TelemetryServiceLabel data to ServiceLabel
        // Check if TelemetryServiceLabel table exists
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

        // Step 3: Copy MetricTypeTelemetryService data to MetricTypeService
        // Check if MetricTypeTelemetryService table exists
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
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Data migration rollback is not straightforward
        // The original TelemetryService data is still intact in the TelemetryService table
        // We would need to delete the copied records from Service table
        // but this could be dangerous as new Service records may have been created
        // For safety, we don't delete any data in the down migration
    }

}
