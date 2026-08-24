import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Scrub monitor ingest keys out of payloads that were already persisted.
 *
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * An Incoming Email monitor's `incomingEmailSecretKey` IS its inbound address:
 * `SendGridInboundProvider.generateMonitorEmailAddress` builds
 * `monitor-{secretKey}@{inboundDomain}`, and `extractSecretKeyFromEmail` reads
 * the key straight back out. Every stored copy of the recipient was therefore a
 * stored copy of a live bearer credential — `emailTo`, the `To:` header, and
 * the `Received:` / `Delivered-To:` headers added in transit.
 *
 * `ProcessProbeIngest.processIncomingEmailFromQueue` now masks the key at the
 * ingest boundary, so nothing written from here on carries it. That fixes the
 * flow and not the stock: rows written before this deploy still hold the key in
 * plaintext, in columns a `Permission.Viewer` can select. Narrowing a read ACL
 * would not have helped either — the same snapshot is copied onto incidents and
 * alerts, which are gated on their own permissions.
 *
 * The four Postgres sinks, all of them jsonb:
 *
 *   - `Monitor.incomingEmailMonitorRequest`  (the reported leak)
 *   - `Monitor.incomingMonitorRequest`       (same shape, `incomingRequestSecretKey`)
 *   - `Incident.monitorSummary`              (via MonitorSummaryCapture)
 *   - `Alert.monitorSummary`                 (via MonitorSummaryCapture)
 *
 * `MonitorLog.logBody` is the fifth sink and is deliberately not touched here:
 * it lives in ClickHouse, not Postgres, and every row carries a `retentionDate`
 * with a `retentionDate DELETE` TTL, so historical rows age out on their own.
 *
 * Matching is case-insensitive (`gi`). A uuid renders lowercase in Postgres,
 * but the key reaches these payloads through relay headers that preserve
 * whatever case the sender used. A uuid is made of hex digits and hyphens, so
 * it needs no regex escaping, and the replacement text contains no backslash,
 * so it needs none either.
 */
export class RedactStoredMonitorIngestSecrets1788900000000
  implements MigrationInterface
{
  public name: string = "RedactStoredMonitorIngestSecrets1788900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * The monitor's own row: the key and the payload quoting it are on the
     * same row, so this needs no join.
     */
    await queryRunner.query(
      `UPDATE "Monitor"
          SET "incomingEmailMonitorRequest" = regexp_replace(
                "incomingEmailMonitorRequest"::text,
                "incomingEmailSecretKey"::text,
                '[REDACTED]',
                'gi'
              )::jsonb
        WHERE "incomingEmailSecretKey" IS NOT NULL
          AND "incomingEmailMonitorRequest" IS NOT NULL
          AND "incomingEmailMonitorRequest"::text ILIKE '%' || "incomingEmailSecretKey"::text || '%'`,
    );

    await queryRunner.query(
      `UPDATE "Monitor"
          SET "incomingMonitorRequest" = regexp_replace(
                "incomingMonitorRequest"::text,
                "incomingRequestSecretKey"::text,
                '[REDACTED]',
                'gi'
              )::jsonb
        WHERE "incomingRequestSecretKey" IS NOT NULL
          AND "incomingMonitorRequest" IS NOT NULL
          AND "incomingMonitorRequest"::text ILIKE '%' || "incomingRequestSecretKey"::text || '%'`,
    );

    /*
     * Incident and Alert keep a copy of the snapshot the monitor was evaluated
     * from. The key is not on those rows, so join back to the monitor. The
     * `projectId` equality keeps the join from degenerating into a cross
     * product; the ILIKE is what actually selects the affected rows, and a
     * snapshot describes exactly one monitor, so at most one monitor row can
     * match a given summary.
     */
    for (const table of ["Incident", "Alert"]) {
      for (const secretColumn of [
        "incomingEmailSecretKey",
        "incomingRequestSecretKey",
      ]) {
        await queryRunner.query(
          `UPDATE "${table}" AS t
              SET "monitorSummary" = regexp_replace(
                    t."monitorSummary"::text,
                    m."${secretColumn}"::text,
                    '[REDACTED]',
                    'gi'
                  )::jsonb
             FROM "Monitor" AS m
            WHERE m."${secretColumn}" IS NOT NULL
              AND m."projectId" = t."projectId"
              AND t."monitorSummary" IS NOT NULL
              AND t."monitorSummary"::text ILIKE '%' || m."${secretColumn}"::text || '%'`,
        );
      }
    }
  }

  public async down(): Promise<void> {
    /*
     * Deliberately empty. The whole point of the up migration is that these
     * values are gone; the original text is not recoverable from anything else
     * in the schema, and recovering it would mean re-publishing the leak.
     *
     * Nothing depends on the redacted text either: `IncomingEmailCriteria`
     * re-evaluates against live mail, and the summary cards render whatever
     * string is stored. Rolling the schema back therefore needs no data change.
     */
  }
}
