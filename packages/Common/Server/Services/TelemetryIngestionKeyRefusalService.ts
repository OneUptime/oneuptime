import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The counts behind "what was refused, and when" (issue #6378): one row per
 * ingestion key, reason and surface, which TelemetryIngestRefusalRecorder
 * adds its batches of refusals to.
 */

// Postgres `integer` upper bound: the count stops there rather than failing.
export const MAX_TELEMETRY_INGEST_REFUSED_COUNT: number = 2147483647;

/*
 * Rows one statement adds to. A bigger write goes as several statements, one
 * after another: 7 parameters a row keeps each one far below Postgres's
 * 65,535, and a statement that fails loses those rows, not all of them.
 */
export const MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT: number = 500;

export interface TelemetryIngestRefusalBatch {
  projectId: ObjectID;
  telemetryIngestionKeyId: ObjectID;
  reason: string;
  surface: string;
  // How many requests were refused in this batch, at least 1.
  count: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
}

export interface TelemetryIngestRefusalUpsert {
  query: string;
  parameters: Array<string | number | Date>;
}

// A whole number of refused requests a row can hold: 1 up to the column's bound.
export function toTelemetryIngestRefusedCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.min(
    Math.max(1, Math.floor(count)),
    MAX_TELEMETRY_INGEST_REFUSED_COUNT,
  );
}

/*
 * One batch per (key, reason, surface): Postgres refuses a statement whose
 * ON CONFLICT would update the same row twice, so batches that share a row
 * are added together first - their counts summed, the earliest first and
 * the latest last kept.
 */
export function mergeTelemetryIngestRefusalBatches(
  batches: Array<TelemetryIngestRefusalBatch>,
): Array<TelemetryIngestRefusalBatch> {
  const merged: Map<string, TelemetryIngestRefusalBatch> = new Map();

  for (const batch of batches) {
    const id: string = `${batch.telemetryIngestionKeyId.toString()}|${batch.reason}|${batch.surface}`;
    const existing: TelemetryIngestRefusalBatch | undefined = merged.get(id);

    if (!existing) {
      merged.set(id, {
        ...batch,
        count: toTelemetryIngestRefusedCount(batch.count),
      });
      continue;
    }

    existing.count = toTelemetryIngestRefusedCount(
      existing.count + toTelemetryIngestRefusedCount(batch.count),
    );

    if (batch.firstRefusedAt.getTime() < existing.firstRefusedAt.getTime()) {
      existing.firstRefusedAt = batch.firstRefusedAt;
    }

    if (batch.lastRefusedAt.getTime() > existing.lastRefusedAt.getTime()) {
      existing.lastRefusedAt = batch.lastRefusedAt;
    }
  }

  return Array.from(merged.values());
}

/*
 * ONE statement that adds every batch to its row: inserts the row, or -
 * when the key already has one for that reason and surface - adds the
 * count, keeps the earliest first and the latest last.
 *
 * A batch whose key is gone (deleted while its refusals waited, or a key of
 * another project) is skipped rather than failing the statement on the
 * foreign key and losing every other batch in it.
 */
export function buildTelemetryIngestRefusalUpsert(
  batches: Array<TelemetryIngestRefusalBatch>,
): TelemetryIngestRefusalUpsert {
  const parameters: Array<string | number | Date> = [];

  const values: Array<string> = batches.map(
    (batch: TelemetryIngestRefusalBatch): string => {
      const at: number = parameters.length;

      parameters.push(
        batch.projectId.toString(),
        batch.telemetryIngestionKeyId.toString(),
        batch.reason,
        batch.surface,
        toTelemetryIngestRefusedCount(batch.count),
        batch.firstRefusedAt,
        batch.lastRefusedAt,
      );

      return `($${at + 1}::uuid, $${at + 2}::uuid, $${at + 3}::varchar, $${at + 4}::varchar, $${at + 5}::integer, $${at + 6}::timestamptz, $${at + 7}::timestamptz)`;
    },
  );

  const query: string = `INSERT INTO "TelemetryIngestionKeyRefusal" ("projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt", "version")
     SELECT refused."projectId", refused."telemetryIngestionKeyId", refused."reason", refused."surface", refused."refusedCount", refused."firstRefusedAt", refused."lastRefusedAt", 1
     FROM (VALUES ${values.join(", ")}) AS refused ("projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt")
     WHERE EXISTS (SELECT 1 FROM "TelemetryIngestionKey" AS ingestionKey WHERE ingestionKey."_id" = refused."telemetryIngestionKeyId" AND ingestionKey."projectId" = refused."projectId")
     ON CONFLICT ("telemetryIngestionKeyId", "reason", "surface") DO UPDATE SET
       "refusedCount" = LEAST("TelemetryIngestionKeyRefusal"."refusedCount"::bigint + EXCLUDED."refusedCount", ${MAX_TELEMETRY_INGEST_REFUSED_COUNT}),
       "firstRefusedAt" = LEAST("TelemetryIngestionKeyRefusal"."firstRefusedAt", EXCLUDED."firstRefusedAt"),
       "lastRefusedAt" = GREATEST("TelemetryIngestionKeyRefusal"."lastRefusedAt", EXCLUDED."lastRefusedAt"),
       "updatedAt" = now()`;

  return { query, parameters };
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Add batches of refusals to their rows, MAX_..._ROWS_PER_STATEMENT rows a
   * statement, one statement after another (a failure stops the rest: the
   * database is most likely unwell, and more statements only add to that).
   *
   * Raw SQL rather than findOneBy + update/create: two ingest pods writing
   * the same key at once would both find no row and one create would fail
   * on the unique index, and a read before every write doubles the round
   * trips of a path that exists to stay cheap. ON CONFLICT makes the
   * concurrent case one well-defined statement.
   *
   * No hooks run, on purpose: the rows are counts the ingest endpoints
   * report (AuditLogExemptionKind.Reported), and nothing listens for them.
   * The key's row is untouched, so its cached policy stays cached.
   */
  @CaptureSpan()
  public async addRefusals(
    batches: Array<TelemetryIngestRefusalBatch>,
  ): Promise<void> {
    const rows: Array<TelemetryIngestRefusalBatch> =
      mergeTelemetryIngestRefusalBatches(batches);

    for (
      let start: number = 0;
      start < rows.length;
      start += MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT
    ) {
      const upsert: TelemetryIngestRefusalUpsert =
        buildTelemetryIngestRefusalUpsert(
          rows.slice(
            start,
            start + MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT,
          ),
        );

      await this.getRepository().manager.query(upsert.query, upsert.parameters);
    }
  }
}

export default new Service();
