import { getAuditLogRetentionDate } from "Common/Types/AuditLog/AuditLogRetention";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { AuditLogExportEntryReader } from "../../../../Server/AuditLogExport/AuditLogExporter";
import { auditLogRow } from "../AuditLogExportTestData";

/*
 * The audit log as the exporter reads it - AuditLogService.findEntriesForExport
 * and findSoonestRetentionDateForExport - in memory, with the semantics of
 * the ClickHouse reads they stand for (Tests/Telemetry/AuditLogExportReadClickhouse
 * in App runs both on a real server): entries from startsAt to until, after
 * the cursor (createdAt, then _id), one project's or every project's, oldest
 * first, then by id, at most `limit`; createdAt in whole seconds.
 *
 * Each entry also carries the retentionDate the recorder stamps on it when
 * it records it - the day the audit log deletes it - from the retention its
 * project had then: 7 days unless the test says otherwise. As in the real
 * table it is never part of a row the export reads, only of the soonest
 * stamp among the entries waiting.
 *
 * Entries can be added while an export runs, as recording goes on. Not a
 * test file itself.
 */

export type InMemoryAuditLogEntry = Parameters<typeof auditLogRow>[0] & {
  // The retention its project had when it was recorded (the recorder's rule: 7 for none).
  retentionInDays?: number | undefined;
  // Or the stamp itself, for a stamp no retention gives.
  retentionDate?: Date | undefined;
};

export interface InMemoryAuditLogWindow {
  projectId: string | null;
  startsAt: Date;
  until: Date;
  after: { createdAt: Date; id: string } | null;
}

export interface InMemoryAuditLog {
  reader: AuditLogExportEntryReader;
  add: (data: InMemoryAuditLogEntry) => JSONObject;
  // The retentionDate stamped on an entry, by its id.
  stampOf: (id: string) => Date;
  // Every read of entries the exporter made, with what it asked.
  reads: Array<InMemoryAuditLogWindow & { limit: number }>;
  // Every read of the soonest stamp the exporter made, with what it asked.
  soonestReads: Array<InMemoryAuditLogWindow>;
}

function toSeconds(value: string | Date): number {
  const date: Date =
    value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);

  return Math.floor(date.getTime() / 1000);
}

type ReadWindow = {
  projectId: ObjectID | null;
  startsAt: Date;
  until: Date;
  after: { createdAt: Date; id: ObjectID } | null;
};

function asked(data: ReadWindow): InMemoryAuditLogWindow {
  return {
    projectId: data.projectId ? data.projectId.toString() : null,
    startsAt: data.startsAt,
    until: data.until,
    after: data.after
      ? { createdAt: data.after.createdAt, id: data.after.id.toString() }
      : null,
  };
}

export function createInMemoryAuditLog(): InMemoryAuditLog {
  const rows: Array<JSONObject> = [];
  const stamps: Map<string, Date> = new Map<string, Date>();
  const reads: InMemoryAuditLog["reads"] = [];
  const soonestReads: InMemoryAuditLog["soonestReads"] = [];

  // The entries a read of this window waits for, oldest first, then by id.
  const waiting: (data: ReadWindow) => Array<JSONObject> = (
    data: ReadWindow,
  ): Array<JSONObject> => {
    const startsAt: number = toSeconds(data.startsAt);
    const until: number = toSeconds(data.until);

    return rows
      .filter((row: JSONObject): boolean => {
        const createdAt: number = toSeconds(String(row["createdAt"]));

        if (createdAt < startsAt || createdAt > until) {
          return false;
        }

        if (
          data.projectId &&
          String(row["projectId"]) !== data.projectId.toString()
        ) {
          return false;
        }

        if (data.after) {
          const cursorAt: number = toSeconds(data.after.createdAt);

          return (
            createdAt > cursorAt ||
            (createdAt === cursorAt &&
              String(row["_id"]) > data.after.id.toString())
          );
        }

        return true;
      })
      .sort((a: JSONObject, b: JSONObject): number => {
        const byTime: number =
          toSeconds(String(a["createdAt"])) - toSeconds(String(b["createdAt"]));

        if (byTime !== 0) {
          return byTime;
        }

        return String(a["_id"]) < String(b["_id"]) ? -1 : 1;
      });
  };

  return {
    reads,
    soonestReads,
    add: (data: InMemoryAuditLogEntry): JSONObject => {
      const row: JSONObject = auditLogRow(data);
      // Stamped from when it was recorded, in whole seconds, as the table keeps both.
      const recordedAt: Date = new Date(
        toSeconds(String(row["createdAt"])) * 1000,
      );

      rows.push(row);
      stamps.set(
        String(row["_id"]),
        data.retentionDate ||
          getAuditLogRetentionDate({
            recordedAt,
            retentionInDays: data.retentionInDays,
          }),
      );

      return row;
    },
    stampOf: (id: string): Date => {
      const stamp: Date | undefined = stamps.get(id);

      if (!stamp) {
        throw new Error(`No entry ${id} in the in-memory audit log.`);
      }

      return stamp;
    },
    reader: {
      findEntriesForExport: async (
        data: ReadWindow & { limit: number },
      ): Promise<Array<JSONObject>> => {
        reads.push({ ...asked(data), limit: data.limit });

        return waiting(data).slice(0, Math.max(1, Math.trunc(data.limit)));
      },
      findSoonestRetentionDateForExport: async (
        data: ReadWindow,
      ): Promise<Date | null> => {
        soonestReads.push(asked(data));

        // Whole seconds, as the read answers them (toUnixTimestamp).
        const soonest: number = Math.min(
          ...waiting(data).map((row: JSONObject): number => {
            return toSeconds(stamps.get(String(row["_id"]))!);
          }),
        );

        return Number.isFinite(soonest) ? new Date(soonest * 1000) : null;
      },
    },
  };
}
