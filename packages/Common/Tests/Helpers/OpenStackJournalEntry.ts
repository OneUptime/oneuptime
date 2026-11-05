import {
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "../../Utils/OpenStack/OpenStackLogs";

/*
 * One record of the journal, as the agent's collector hands it over. Apart from
 * OpenStackServiceLogs.ts, which reads a recording's files, because the page walks run this in a
 * browser (E2E/OpenStackPages/Fixture/ServiceLogs.js).
 */

// A record of the journal's, with what the agent's collector moves beside the line.
export interface RecordedJournalEntry {
  MESSAGE: string;
  _SYSTEMD_UNIT?: string;
  _HOSTNAME?: string;
  _PID?: string;
  PRIORITY?: string;
  __REALTIME_TIMESTAMP?: string;
  SYSLOG_IDENTIFIER?: string;
  LOGGER_NAME?: string;
  LOGGER_LEVEL?: string;
  REQUEST_ID?: string;
  GLOBAL_REQUEST_ID?: string;
  PROJECT_ID?: string;
  PROJECT_NAME?: string;
  USER_ID?: string;
  USER_NAME?: string;
  EXCEPTION_INFO?: string;
}

// As the agent's journal profile moves the journal's fields beside the line.
export function journalAttributesOf(
  entry: RecordedJournalEntry,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    "resource.openstack.cloud.name": "devstack",
  };
  const moved: Array<[keyof RecordedJournalEntry, string]> = [
    ["_SYSTEMD_UNIT", "journald.unit"],
    ["_HOSTNAME", "journald.hostname"],
    ["_PID", "process.pid"],
    ["SYSLOG_IDENTIFIER", "journald.identifier"],
    ["PRIORITY", "journald.priority"],
    ["LOGGER_NAME", "journald.logger_name"],
    ["LOGGER_LEVEL", "journald.logger_level"],
    ["REQUEST_ID", "journald.request_id"],
    ["GLOBAL_REQUEST_ID", "journald.global_request_id"],
    ["PROJECT_ID", "journald.project_id"],
    ["PROJECT_NAME", "journald.project_name"],
    ["USER_ID", "journald.user_id"],
    ["USER_NAME", "journald.user_name"],
    ["EXCEPTION_INFO", "journald.exception_info"],
  ];

  for (const [from, to] of moved) {
    if (entry[from] !== undefined) {
      attributes[to] = entry[from];
    }
  }

  return attributes;
}

export function stampJournalEntry(
  entry: RecordedJournalEntry,
): OpenStackLogStamp {
  return stampOpenStackLogRecord({
    attributes: journalAttributesOf(entry),
    body: entry.MESSAGE,
    severityNumber: 0,
  });
}

// When the journal says a line was written, in milliseconds.
export function journalTime(entry: RecordedJournalEntry): number {
  return Math.floor(Number(entry.__REALTIME_TIMESTAMP || 0) / 1000);
}

// As the ingest names a severity: see OtelLogsIngestService.getSeverityText.
export function severityTextOf(severityNumber: number | null): string {
  const number: number = severityNumber || 0;

  if (number >= 21) {
    return "Fatal";
  }

  if (number >= 17) {
    return "Error";
  }

  if (number >= 13) {
    return "Warning";
  }

  if (number >= 9) {
    return "Information";
  }

  if (number >= 5) {
    return "Debug";
  }

  return number >= 1 ? "Trace" : "Unspecified";
}

// A journal record, as the row the ingest writes.
export interface StoredLogRow {
  time: Date;
  severityText: string;
  severityNumber: number;
  body: string;
  attributes: Record<string, string>;
  stamp: OpenStackLogStamp;
}

export function storedRowOf(
  entry: RecordedJournalEntry,
  cloudName: string = "devstack",
): StoredLogRow {
  const attributes: Record<string, unknown> = {
    ...journalAttributesOf(entry),
    "resource.openstack.cloud.name": cloudName,
  };
  const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
    attributes,
    body: entry.MESSAGE,
    severityNumber: 0,
  });
  const stored: Record<string, unknown> = {
    ...attributes,
    ...stamp.attributes,
  };

  for (const removed of stamp.removedAttributes) {
    delete stored[removed];
  }

  return {
    // The journal's own time, as the collector hands it over with the record.
    time: new Date(journalTime(entry)),
    severityText: severityTextOf(stamp.severityNumber),
    severityNumber: stamp.severityNumber || 0,
    body: stamp.body,
    attributes: stored as Record<string, string>,
    stamp,
  };
}
