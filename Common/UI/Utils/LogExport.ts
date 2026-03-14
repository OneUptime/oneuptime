import Log from "../../Models/AnalyticsModels/Log";
import { JSONObject } from "../../Types/JSON";
import {
  isLogsAttributeColumnId,
  getLogsAttributeKeyFromColumnId,
} from "../Components/LogsViewer/types";

export enum LogExportFormat {
  CSV = "csv",
  JSON = "json",
}

function escapeCsvValue(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getLogFieldValue(log: Log, columnId: string): string {
  if (isLogsAttributeColumnId(columnId)) {
    const attrKey: string | null = getLogsAttributeKeyFromColumnId(columnId);
    if (attrKey && log.attributes) {
      const val: unknown = (log.attributes as Record<string, unknown>)[attrKey];
      if (val === undefined || val === null) {
        return "";
      }
      if (typeof val === "object") {
        return JSON.stringify(val);
      }
      return String(val);
    }
    return "";
  }

  switch (columnId) {
    case "time":
      return log.time ? new Date(log.time).toISOString() : "";
    case "service":
      return log.serviceId?.toString() || "";
    case "severity":
      return log.severityText?.toString() || "";
    case "message":
      return log.body || "";
    case "traceId":
      return log.traceId || "";
    case "spanId":
      return log.spanId || "";
    default:
      return "";
  }
}

function getColumnLabel(columnId: string): string {
  if (isLogsAttributeColumnId(columnId)) {
    return getLogsAttributeKeyFromColumnId(columnId) || columnId;
  }

  switch (columnId) {
    case "time":
      return "Time";
    case "service":
      return "Service ID";
    case "severity":
      return "Severity";
    case "message":
      return "Message";
    case "traceId":
      return "Trace ID";
    case "spanId":
      return "Span ID";
    default:
      return columnId;
  }
}

export function exportLogsToCSV(
  logs: Array<Log>,
  columns: Array<string>,
): string {
  const header: string = columns
    .map((col: string) => {
      return escapeCsvValue(getColumnLabel(col));
    })
    .join(",");

  const rows: Array<string> = logs.map((log: Log) => {
    return columns
      .map((col: string) => {
        return escapeCsvValue(getLogFieldValue(log, col));
      })
      .join(",");
  });

  return [header, ...rows].join("\n");
}

export function exportLogsToJSON(logs: Array<Log>): string {
  const data: Array<JSONObject> = logs.map((log: Log) => {
    const obj: JSONObject = {};
    obj["time"] = log.time ? new Date(log.time).toISOString() : null;
    obj["serviceId"] = log.serviceId?.toString() || null;
    obj["severity"] = log.severityText?.toString() || null;
    obj["severityNumber"] = log.severityNumber || null;
    obj["body"] = log.body || null;
    obj["traceId"] = log.traceId || null;
    obj["spanId"] = log.spanId || null;
    obj["attributes"] = (log.attributes as JSONObject) || {};
    return obj;
  });

  return JSON.stringify(data, null, 2);
}

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob: Blob = new Blob([content], { type: mimeType });
  const url: string = window.URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function getTimestampFilename(format: LogExportFormat): string {
  const now: string = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `logs-${now}.${format}`;
}

export function exportLogs(
  logs: Array<Log>,
  format: LogExportFormat,
  columns: Array<string>,
): void {
  if (format === LogExportFormat.CSV) {
    const csv: string = exportLogsToCSV(logs, columns);
    downloadFile(csv, getTimestampFilename(format), "text/csv;charset=utf-8;");
  } else {
    const json: string = exportLogsToJSON(logs);
    downloadFile(
      json,
      getTimestampFilename(format),
      "application/json;charset=utf-8;",
    );
  }
}
