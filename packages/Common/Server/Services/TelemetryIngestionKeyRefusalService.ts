import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The counts behind "what was refused, and when" (issue #6378): one row per
 * ingestion key, reason and surface, which TelemetryIngestRefusalRecorder
 * adds a batch of refusals to.
 */

// Postgres `integer` upper bound: the count stops there rather than failing.
export const MAX_TELEMETRY_INGEST_REFUSED_COUNT: number = 2147483647;

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

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Add a batch of refusals to its row, in ONE statement: insert the row,
   * or - when the key already has one for that reason and surface - add the
   * count, keep the earliest first and the latest last.
   *
   * Raw SQL rather than findOneBy + update/create: two ingest pods flushing
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
  public async addRefusals(batch: TelemetryIngestRefusalBatch): Promise<void> {
    const count: number = Math.min(
      Math.max(1, Math.floor(batch.count)),
      MAX_TELEMETRY_INGEST_REFUSED_COUNT,
    );

    await this.getRepository().manager.query(
      `INSERT INTO "TelemetryIngestionKeyRefusal" ("projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt", "version")
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 1)
       ON CONFLICT ("telemetryIngestionKeyId", "reason", "surface") DO UPDATE SET
         "refusedCount" = LEAST("TelemetryIngestionKeyRefusal"."refusedCount"::bigint + EXCLUDED."refusedCount", ${MAX_TELEMETRY_INGEST_REFUSED_COUNT}),
         "firstRefusedAt" = LEAST("TelemetryIngestionKeyRefusal"."firstRefusedAt", EXCLUDED."firstRefusedAt"),
         "lastRefusedAt" = GREATEST("TelemetryIngestionKeyRefusal"."lastRefusedAt", EXCLUDED."lastRefusedAt"),
         "updatedAt" = now()`,
      [
        batch.projectId.toString(),
        batch.telemetryIngestionKeyId.toString(),
        batch.reason,
        batch.surface,
        count,
        batch.firstRefusedAt,
        batch.lastRefusedAt,
      ],
    );
  }
}

export default new Service();
