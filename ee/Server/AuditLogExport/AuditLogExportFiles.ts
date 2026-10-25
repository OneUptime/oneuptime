import { gzipSync } from "zlib";
import {
  AuditLogExportRecord,
  serializeAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { AuditLogExportBatch } from "./Destinations/Types";

/*
 * What a file destination writes: one gzip-compressed NDJSON file per batch
 * (one entry per line), filed by the hour its first entry was recorded in:
 *
 *   <folder>2026/10/24/09/20261024T091503Z_<first entry id>.ndjson.gz
 *
 * The name comes from the batch's first entry alone, so reading the same
 * entries again - after a restart, on another worker, after a delivery that
 * succeeded but could not be recorded - writes the same object again rather
 * than a second copy. Names sort in the order entries were recorded, and the
 * year/month/day/hour folders are what an Athena or BigQuery table
 * partitions by.
 *
 * A test from the form is written to one fixed name in the folder,
 * overwritten by every test, so testing never piles up files.
 */

export const AUDIT_LOG_EXPORT_FILE_EXTENSION: string = ".ndjson.gz";

export const AUDIT_LOG_EXPORT_FILE_CONTENT_TYPE: string = "application/gzip";

export const AUDIT_LOG_EXPORT_TEST_FILE_NAME: string =
  "oneuptime-audit-log-export-test.ndjson.gz";

function pad(value: number, length: number = 2): string {
  return String(value).padStart(length, "0");
}

// 20261024T091503Z: the batch's first entry's time, as the file name starts.
export function toCompactUtcTimestamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds(),
  )}Z`;
}

/*
 * The object key of a batch's file under a folder (which ends with "/"): a
 * test's fixed name, or the dated path of a batch of entries.
 */
export function getAuditLogExportObjectKey(data: {
  folder: string;
  batch: AuditLogExportBatch;
}): string {
  if (data.batch.isTest) {
    return `${data.folder}${AUDIT_LOG_EXPORT_TEST_FILE_NAME}`;
  }

  const date: Date = data.batch.firstCreatedAt;

  return `${data.folder}${date.getUTCFullYear()}/${pad(
    date.getUTCMonth() + 1,
  )}/${pad(date.getUTCDate())}/${pad(date.getUTCHours())}/${toCompactUtcTimestamp(
    date,
  )}_${data.batch.id}${AUDIT_LOG_EXPORT_FILE_EXTENSION}`;
}

// The batch as NDJSON: one entry per line, each line ending in a line break.
export function toNdjson(records: Array<AuditLogExportRecord>): string {
  return records
    .map((record: AuditLogExportRecord): string => {
      return `${serializeAuditLogExportRecord(record)}\n`;
    })
    .join("");
}

// The file a batch is written as: its NDJSON, gzip-compressed.
export function toAuditLogExportFile(batch: AuditLogExportBatch): Buffer {
  return gzipSync(Buffer.from(toNdjson(batch.records), "utf8"));
}
