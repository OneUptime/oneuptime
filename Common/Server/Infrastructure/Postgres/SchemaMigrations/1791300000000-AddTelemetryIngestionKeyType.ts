import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Splits TelemetryIngestionKey into two credential classes - Server (what
 * every existing key is) and Browser (a public, write-only key that is safe to
 * paste into a web page) - and adds the controls a public key needs to be
 * safe: an origin allowlist, a pinned service.name, a rate limit, an expiry, a
 * kill switch, and last-used visibility.
 *
 * Every column here is chosen so that this migration is a NO-OP for behaviour
 * on existing rows, which matters because these keys are live credentials in
 * customer infrastructure and a schema change must never be the reason a
 * production collector stops shipping telemetry:
 *
 * - "keyType" is NOT NULL DEFAULT 'Server', so the ADD COLUMN backfills every
 *   existing row to exactly what it already is. Nullable would have been worse
 *   than useless: the ingest guard would then have to decide what NULL means,
 *   and every wrong guess there is either "break every existing key" or
 *   "treat an unknown key as the permissive class".
 * - "isEnabled" is NOT NULL DEFAULT true - a key that worked yesterday keeps
 *   working.
 * - "allowedOrigins" is NOT NULL DEFAULT '[]' and is ignored for Server keys,
 *   so the backfilled empty list changes nothing. It only becomes a strict
 *   allowlist on Browser keys, which cannot exist before this migration runs.
 * - the remaining four are nullable with no default, and NULL means "no
 *   expiry", "no pinned service name", "never seen used", "no explicit rate
 *   limit" respectively - each the pre-existing behaviour.
 *
 * SQL types mirror what the ORM emits for the corresponding ColumnType
 * elsewhere in this directory: ShortText -> character varying(100),
 * JSON -> jsonb, Boolean -> boolean, Date -> TIMESTAMP WITH TIME ZONE,
 * Number -> integer.
 */
export class AddTelemetryIngestionKeyType1791300000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryIngestionKeyType1791300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "keyType" character varying(100) NOT NULL DEFAULT 'Server'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "allowedOrigins" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "pinnedServiceName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "isEnabled" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "lastUsedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "requestsPerMinuteLimit" integer`,
    );
  }

  /*
   * Drops exactly the seven columns this migration added, in reverse order.
   * No data is restored on the way down because none was rewritten on the way
   * up - this migration only ever added columns.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "requestsPerMinuteLimit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "lastUsedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "isEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "pinnedServiceName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "allowedOrigins"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "keyType"`,
    );
  }
}
