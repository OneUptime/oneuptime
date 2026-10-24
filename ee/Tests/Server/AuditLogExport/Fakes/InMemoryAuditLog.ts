import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { AuditLogExportEntryReader } from "../../../../Server/AuditLogExport/AuditLogExporter";
import { auditLogRow } from "../AuditLogExportTestData";

/*
 * The audit log as the exporter reads it - AuditLogService.findEntriesForExport
 * - in memory, with the semantics of the ClickHouse read it stands for
 * (Tests/Telemetry/AuditLogExportReadClickhouse in App runs that read on a
 * real server): entries from startsAt to until, after the cursor
 * (createdAt, then _id), one project's or every project's, oldest first,
 * then by id, at most `limit`; createdAt in whole seconds.
 *
 * Entries can be added while an export runs, as recording goes on. Not a
 * test file itself.
 */

export interface InMemoryAuditLog {
  reader: AuditLogExportEntryReader;
  add: (data: Parameters<typeof auditLogRow>[0]) => JSONObject;
  // Every read the exporter made, with what it asked.
  reads: Array<{
    projectId: string | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  }>;
}

function toSeconds(value: string | Date): number {
  const date: Date =
    value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);

  return Math.floor(date.getTime() / 1000);
}

export function createInMemoryAuditLog(): InMemoryAuditLog {
  const rows: Array<JSONObject> = [];
  const reads: InMemoryAuditLog["reads"] = [];

  return {
    reads,
    add: (data: Parameters<typeof auditLogRow>[0]): JSONObject => {
      const row: JSONObject = auditLogRow(data);
      rows.push(row);
      return row;
    },
    reader: {
      findEntriesForExport: async (data: {
        projectId: ObjectID | null;
        startsAt: Date;
        until: Date;
        after: { createdAt: Date; id: ObjectID } | null;
        limit: number;
      }): Promise<Array<JSONObject>> => {
        reads.push({
          projectId: data.projectId ? data.projectId.toString() : null,
          startsAt: data.startsAt,
          until: data.until,
          after: data.after
            ? { createdAt: data.after.createdAt, id: data.after.id.toString() }
            : null,
          limit: data.limit,
        });

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
              toSeconds(String(a["createdAt"])) -
              toSeconds(String(b["createdAt"]));

            if (byTime !== 0) {
              return byTime;
            }

            return String(a["_id"]) < String(b["_id"]) ? -1 : 1;
          })
          .slice(0, Math.max(1, Math.trunc(data.limit)));
      },
    },
  };
}
