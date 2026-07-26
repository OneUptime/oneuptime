import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Indexes for two classes of repeated full-table scan:
 *
 * 1. Worker sweep predicates. These jobs run every minute against columns
 *    with no supporting index, so each tick is a sequential scan plus a
 *    top-N heapsort (DatabaseService._findBy injects ORDER BY "createdAt"
 *    DESC when the caller passes no sort).
 *
 * 2. Retention scans. HardDelete:HardDeleteOlderItemsInDatabase runs
 *    `WHERE "createdAt" < $cutoff ORDER BY "createdAt" DESC LIMIT 10000` in
 *    a loop for every service that configured hardDeleteItemsOlderThanInDays.
 *    No table had a leading-"createdAt" index — the eight that mention
 *    createdAt all carry it as the second column, which cannot serve this.
 *    Only the short-retention tables are indexed here; the 3-year ones are a
 *    no-op on any install under three years old.
 *
 *    This also fixes a silent-failure mode: statement_timeout (30s) aborts a
 *    slow retention scan and HardDeleteItemsInDatabase swallows the error, so
 *    a table whose scan outgrows the timeout stops being purged permanently.
 *
 * Plain CREATE INDEX, not CONCURRENTLY: DataSourceOptions does not set
 * migrationsTransactionMode, so TypeORM's default of "all" wraps every
 * pending migration in one transaction and CONCURRENTLY would throw there.
 */
export class AddCronSweepAndRetentionIndexes1785093542859
  implements MigrationInterface
{
  public name = "AddCronSweepAndRetentionIndexes1785093542859";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Worker sweep predicates.
    await queryRunner.query(
      `CREATE INDEX "IDX_52f8f551a9796060489ebaf31c" ON "NetworkDevice" ("probeId", "nextPollAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_827de62fb06ab804fecbf4912d" ON "NetworkDeviceDiscoveryScan" ("isRecurring", "nextScanAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e25e4f3ea70f94488e9679623" ON "OnCallDutyPolicyExecutionLog" ("status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_718982a53686ac0baabeb57c98" ON "WorkflowLog" ("workflowStatus", "resumeAt") `,
    );

    /*
     * Telemetry ingest catalog lookup. MetricType had only two separate
     * single-column indexes ("projectId", "name"); the ingest path always
     * queries on both together.
     */
    await queryRunner.query(
      `CREATE INDEX "IDX_ec9ab273ef86103f8d59c2aad7" ON "MetricType" ("projectId", "name") `,
    );

    // Retention scans.
    await queryRunner.query(
      `CREATE INDEX "IDX_1d38d4d8bd49564b6f89457932" ON "CallLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46bdb2ac59f546d0f73bc0a17e" ON "EmailLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a225577a6564c9635996a08dbb" ON "SmsLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c83938593ab6a8e63e760d57a8" ON "WhatsAppLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b54ec0fb9790fb43b323e9d7ca" ON "TelegramLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d38b2aa9fb47e96db02d70d00e" ON "WebhookLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4329e373b22084adb61c5776c" ON "PushNotificationLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_642853aa3757718b77cef41bf3" ON "WorkspaceNotificationLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_91e6c10a6c605c06d85e247373" ON "LlmLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1955a0bcef6051943ff75a838e" ON "OnCallDutyPolicyExecutionLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a704a9600ea32e878e9cc6802" ON "OnCallDutyPolicyFeed" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb894bcfebcc7d49919947f026" ON "UserOnCallLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f14c690c8b084ecea9e7a10f1" ON "WorkflowLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_413a3c6535eebd9eb51d265215" ON "ShortLink" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_65044cce68a3b3ae8361458014" ON "MonitorTest" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_229a2aaa9b4df04bfa5551b455" ON "TelemetryUsageBilling" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_300280a74f6469c33e92d2725b" ON "ProjectSCIMLog" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33a86075bc18670d70962a6310" ON "StatusPageSCIMLog" ("createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33a86075bc18670d70962a6310"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_300280a74f6469c33e92d2725b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_229a2aaa9b4df04bfa5551b455"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_65044cce68a3b3ae8361458014"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_413a3c6535eebd9eb51d265215"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f14c690c8b084ecea9e7a10f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb894bcfebcc7d49919947f026"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a704a9600ea32e878e9cc6802"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1955a0bcef6051943ff75a838e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_91e6c10a6c605c06d85e247373"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_642853aa3757718b77cef41bf3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4329e373b22084adb61c5776c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d38b2aa9fb47e96db02d70d00e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b54ec0fb9790fb43b323e9d7ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c83938593ab6a8e63e760d57a8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a225577a6564c9635996a08dbb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_46bdb2ac59f546d0f73bc0a17e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d38d4d8bd49564b6f89457932"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ec9ab273ef86103f8d59c2aad7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_718982a53686ac0baabeb57c98"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e25e4f3ea70f94488e9679623"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_827de62fb06ab804fecbf4912d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52f8f551a9796060489ebaf31c"`,
    );
  }
}
