import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesResourceChangeEvent";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";

/*
 * ------------------------------------------------------------------
 * KubernetesResourceChangeEventService
 *
 * Append-only writes for the workload timeline table. Rows are
 * inserted by the telemetry ingest path when a resource's spec hash
 * changes between snapshots or a resource disappears from the
 * inventory, and pruned by age from the cleanup worker.
 *
 * Callers:
 *   - OtelLogsIngestService              -> bulkInsert
 *   - Cleanup worker                     -> deleteOlderThan
 *   - BaseAPI (dashboard timeline reads) -> inherited CRUD
 * ------------------------------------------------------------------
 */

export interface ParsedKubernetesResourceChangeEvent {
  kind: string;
  namespaceKey: string;
  name: string;
  changeType: string;
  oldSpec: JSONObject | null;
  newSpec: JSONObject | null;
  specHash: string | null;
  occurredAt: Date;
}

const INSERT_BATCH_SIZE: number = 500;

/*
 * Column order used by both bulkInsert() and its generated parameter
 * tuples. Keep this and the INSERT column list in perfect sync.
 */
const INSERT_COLUMNS: Array<string> = [
  "projectId",
  "kubernetesClusterId",
  "kind",
  "namespaceKey",
  "name",
  "changeType",
  "oldSpec",
  "newSpec",
  "specHash",
  "occurredAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Insert a batch of change events for a single (project, cluster)
   * pair. Plain INSERT — the table is append-only, so there is no
   * conflict target to upsert on.
   */
  @CaptureSpan()
  public async bulkInsert(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    events: Array<ParsedKubernetesResourceChangeEvent>;
  }): Promise<void> {
    if (data.events.length === 0) {
      return;
    }

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < data.events.length; i += INSERT_BATCH_SIZE) {
      const chunk: Array<ParsedKubernetesResourceChangeEvent> =
        data.events.slice(i, i + INSERT_BATCH_SIZE);

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const e of chunk) {
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < INSERT_COLUMNS.length; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          e.kind,
          e.namespaceKey,
          e.name,
          e.changeType,
          e.oldSpec ? JSON.stringify(e.oldSpec) : null,
          e.newSpec ? JSON.stringify(e.newSpec) : null,
          e.specHash,
          e.occurredAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "KubernetesResourceChangeEvent" (
          "projectId", "kubernetesClusterId",
          "kind", "namespaceKey", "name",
          "changeType", "oldSpec", "newSpec", "specHash",
          "occurredAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all change events that occurred before olderThan,
   * across all projects and clusters. Returns the number of deleted
   * rows.
   */
  @CaptureSpan()
  public async deleteOlderThan(data: { olderThan: Date }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "KubernetesResourceChangeEvent" WHERE "occurredAt" < $1`,
        [data.olderThan],
      );

    // Postgres driver returns [rows, affected] for DELETE — normalize.
    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }

    return affected;
  }

  /**
   * Helper for the cleanup worker: age cutoff for change-event
   * retention. Tune via K8S_CHANGE_EVENT_RETENTION_DAYS.
   */
  public getRetentionCutoffDate(nowOverride?: Date): Date {
    const days: number = this.getRetentionDays();
    return OneUptimeDate.addRemoveDays(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -days,
    );
  }

  public getRetentionDays(): number {
    const raw: string | undefined =
      process.env["K8S_CHANGE_EVENT_RETENTION_DAYS"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        return parsed;
      }
    }
    return 30;
  }
}

export default new Service();
