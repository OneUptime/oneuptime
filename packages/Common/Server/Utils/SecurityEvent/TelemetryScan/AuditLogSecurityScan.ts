import { ResponseJSON } from "@clickhouse/client";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  AuditScanRecord,
  MASS_DELETE_MIN_DELETES,
  MassDeleteRow,
  buildAuditRecordEvent,
  buildMassDeleteEvent,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import AuditLogService from "../../../Services/AuditLogService";
import { Statement } from "../../AnalyticsDatabase/Statement";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  TelemetryScanWindow,
  buildAuditRecordsStatement,
  buildMassDeleteStatement,
} from "./TelemetryScanStatements";
import {
  readRowDate,
  readRowNumber,
  readRowText,
  readRowTextArray,
} from "./TelemetryScanRows";
import { TelemetryWindowRead } from "./TelemetryScanTypes";

/*
 * "Your OneUptime data" - the audit log: a window of the project's own
 * audit records read for the changes security cares for, a page at a time,
 * and - on the window's first page - summed per actor for mass deletes
 * (Utils/SecurityEvent/TelemetryScan/AuditLogSignals.ts).
 *
 * The audit log is written by OneUptime Enterprise for the projects that
 * turned it on. Without it there is nothing to read, and every window is
 * empty.
 */

// The most actors one window reports a mass delete for.
export const MAX_MASS_DELETE_ACTORS: number = 20;

export function toAuditScanRecord(row: JSONObject): AuditScanRecord {
  return {
    id: readRowText(row["_id"]),
    createdAt: readRowDate(row["createdAt"]) || new Date(0),
    resourceType: readRowText(row["resourceType"]),
    resourceId: readRowText(row["resourceId"]),
    resourceName: readRowText(row["resourceName"]),
    action: readRowText(row["action"]),
    userId: readRowText(row["userId"]),
    userName: readRowText(row["userName"]),
    userEmail: readRowText(row["userEmail"]),
    userType: readRowText(row["userType"]),
    apiKeyId: readRowText(row["apiKeyId"]),
    apiKeyName: readRowText(row["apiKeyName"]),
    mcpClientName: readRowText(row["mcpClientName"]),
    workflowName: readRowText(row["workflowName"]),
  };
}

export function toMassDeleteRow(row: JSONObject): MassDeleteRow {
  return {
    userId: readRowText(row["actorUserId"]),
    userName: readRowText(row["actorUserName"]),
    userEmail: readRowText(row["actorUserEmail"]),
    userType: readRowText(row["actorUserType"]),
    apiKeyId: readRowText(row["actorApiKeyId"]),
    apiKeyName: readRowText(row["actorApiKeyName"]),
    deletes: readRowNumber(row["deletes"]),
    sampleResourceTypes: readRowTextArray(row["sampleResourceTypes"]),
    firstAt: readRowDate(row["firstAt"]) || new Date(0),
    lastAt: readRowDate(row["lastAt"]) || new Date(0),
  };
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const result: Results = await AuditLogService.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

export default class AuditLogSecurityScan {
  @CaptureSpan()
  public static async readWindow(data: {
    window: TelemetryScanWindow;
    offset: number;
    pageSize: number;
  }): Promise<TelemetryWindowRead> {
    const rows: Array<JSONObject> = await readRows(
      buildAuditRecordsStatement({
        projectId: data.window.projectId,
        arrivedAfter: data.window.arrivedAfter,
        arrivedUntil: data.window.arrivedUntil,
        limit: data.pageSize,
        offset: data.offset,
      }),
    );

    const events: Array<NormalizedSecurityEvent> = [];

    for (const row of rows) {
      const event: NormalizedSecurityEvent | null = buildAuditRecordEvent(
        toAuditScanRecord(row),
      );

      if (event) {
        events.push(event);
      }
    }

    let recordsRead: number = rows.length;

    // Read once a window: a scan that resumes part way has read it already.
    if (data.offset === 0) {
      const deleteRows: Array<JSONObject> = await readRows(
        buildMassDeleteStatement({
          projectId: data.window.projectId,
          arrivedAfter: data.window.arrivedAfter,
          arrivedUntil: data.window.arrivedUntil,
          minDeletes: MASS_DELETE_MIN_DELETES,
          limit: MAX_MASS_DELETE_ACTORS,
        }),
      );

      recordsRead += deleteRows.length;

      for (const row of deleteRows) {
        const event: NormalizedSecurityEvent | null = buildMassDeleteEvent(
          toMassDeleteRow(row),
          data.window.arrivedAfter,
        );

        if (event) {
          events.push(event);
        }
      }
    }

    return {
      events,
      recordsRead,
      pageRows: rows.length,
      hasMore: rows.length >= data.pageSize,
    };
  }
}
