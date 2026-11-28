import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ObjectID from "../../Types/ObjectID";
import {
  QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS,
  TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS,
  TelemetryIngestRefusalReason,
} from "../../Types/Telemetry/TelemetryIngestRefusal";
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

// Whether a reason's refusals are told apart by stretch (#11440).
export function isTelemetryIngestRefusalCountedByStretch(
  reason: string,
): boolean {
  return QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS.has(
    reason as TelemetryIngestRefusalReason,
  );
}

/*
 * One batch per (key, reason, surface): Postgres refuses a statement whose
 * ON CONFLICT would update the same row twice, so batches that share a row
 * are added together first - their counts summed, the earliest first and
 * the latest last kept. For a reason counted by stretch, a batch that
 * begins more than the gap after another ends is a later stretch, which
 * the row keeps instead of the earlier one, as the statement does.
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

    if (isTelemetryIngestRefusalCountedByStretch(batch.reason)) {
      if (
        batch.firstRefusedAt.getTime() - existing.lastRefusedAt.getTime() >
        TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS
      ) {
        // A later stretch: it replaces the one before.
        merged.set(id, {
          ...batch,
          count: toTelemetryIngestRefusedCount(batch.count),
        });
        continue;
      }

      if (
        existing.firstRefusedAt.getTime() - batch.lastRefusedAt.getTime() >
        TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS
      ) {
        // An earlier stretch, which the later one already replaced.
        continue;
      }
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
 * The reasons counted by stretch, as SQL string literals. Each is checked
 * to be a plain slug, so nothing but the enum's own values is ever put in
 * the statement's text.
 */
const REFUSAL_REASON_SLUG: RegExp = /^[a-z-]+$/;

const getStretchReasonsSql: () => string = (): string => {
  return Array.from(QUEUE_TELEMETRY_INGEST_REFUSAL_REASONS)
    .map((reason: string): string => {
      if (!REFUSAL_REASON_SLUG.test(reason)) {
        throw new Error(`Not a refusal reason: ${reason}`);
      }

      return `'${reason}'`;
    })
    .join(", ");
};

/*
 * ONE statement that adds every batch to its row: inserts the row, or -
 * when the key already has one for that reason and surface - adds the
 * count, keeps the earliest first and the latest last.
 *
 * A reason the telemetry queue refuses for comes and goes (#11440): a batch
 * that begins more than TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS after the
 * row's latest refusal begins a new stretch, so its count and first
 * refusal replace the row's. Every expression of the SET reads the row as
 * it was before the statement, so the stretch is decided by the row's
 * latest refusal before this batch, whatever order the columns are set in.
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

  // Whether the batch begins a new stretch of a reason counted by stretch.
  const newStretch: string = `(EXCLUDED."reason" IN (${getStretchReasonsSql()}) AND "TelemetryIngestionKeyRefusal"."lastRefusedAt" < EXCLUDED."firstRefusedAt" - (${TELEMETRY_INGEST_REFUSAL_STRETCH_GAP_MS} * interval '1 millisecond'))`;

  const query: string = `INSERT INTO "TelemetryIngestionKeyRefusal" ("projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt", "version")
     SELECT refused."projectId", refused."telemetryIngestionKeyId", refused."reason", refused."surface", refused."refusedCount", refused."firstRefusedAt", refused."lastRefusedAt", 1
     FROM (VALUES ${values.join(", ")}) AS refused ("projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt")
     WHERE EXISTS (SELECT 1 FROM "TelemetryIngestionKey" AS ingestionKey WHERE ingestionKey."_id" = refused."telemetryIngestionKeyId" AND ingestionKey."projectId" = refused."projectId")
     ON CONFLICT ("telemetryIngestionKeyId", "reason", "surface") DO UPDATE SET
       "refusedCount" = CASE WHEN ${newStretch} THEN EXCLUDED."refusedCount" ELSE LEAST("TelemetryIngestionKeyRefusal"."refusedCount"::bigint + EXCLUDED."refusedCount", ${MAX_TELEMETRY_INGEST_REFUSED_COUNT}) END,
       "firstRefusedAt" = CASE WHEN ${newStretch} THEN EXCLUDED."firstRefusedAt" ELSE LEAST("TelemetryIngestionKeyRefusal"."firstRefusedAt", EXCLUDED."firstRefusedAt") END,
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
