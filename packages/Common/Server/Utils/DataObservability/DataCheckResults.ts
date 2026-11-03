import {
  DataCheckType,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import { MAX_SEGMENT_VALUE_LENGTH } from "../../../Types/DataObservability/DataCheckMetric";

/*
 * WHAT ONE RUN OF A CHECK READ.
 *
 * A check's statement hands back one row (its value) or one row per segment
 * (the segment, then its value). Custom SQL hands back whatever its query
 * selects: the first column that holds a number is the value, and with a
 * segment, the first column is the segment and the second the value. Only
 * these numbers travel - from a probe too - so the reading is strict: a
 * value that is not a finite number is no value.
 */

export interface DataCheckSegmentValue {
  // The segment column's value as text; null for an unsegmented check.
  segment: string | null;
  value: number;
}

// One check to run at a collection: its statement, built by the server (DataCheckPlanner).
export interface PlannedDataCheck {
  checkId: string;
  type: DataCheckType;
  isSegmented: boolean;
  sql: string;
  params: Array<string>;
}

// What the probe or the worker sends back for one check.
export interface DataCheckRunResult {
  checkId: string;
  values: Array<DataCheckSegmentValue>;
  // Why the check could not run - sanitized, never a credential.
  error: string | null;
}

// The segment a NULL segment value is reported as.
export const EMPTY_SEGMENT: string = "(empty)";

// The longest error kept for one check.
export const MAX_CHECK_ERROR_LENGTH: number = 500;

export function readNumber(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : NaN;

  return Number.isFinite(number) ? number : null;
}

export function readSegment(value: unknown): string {
  if (value === null || value === undefined) {
    return EMPTY_SEGMENT;
  }

  const text: string = (
    value instanceof Date ? value.toISOString() : String(value)
  ).trim();

  return (text || EMPTY_SEGMENT).slice(0, MAX_SEGMENT_VALUE_LENGTH);
}

// The values in the rows a check's statement returned.
export function readCheckRows(data: {
  type: DataCheckType;
  isSegmented: boolean;
  rows: Array<Record<string, unknown>>;
}): Array<DataCheckSegmentValue> {
  const rows: Array<Record<string, unknown>> = data.rows.slice(
    0,
    MAX_SEGMENTS_PER_CHECK,
  );

  if (data.type === DataCheckType.CustomSql) {
    if (data.isSegmented) {
      return rows.flatMap((row: Record<string, unknown>) => {
        const cells: Array<unknown> = Object.values(row);
        const value: number | null = readNumber(cells[1]);

        return value === null
          ? []
          : [{ segment: readSegment(cells[0]), value }];
      });
    }

    for (const cell of Object.values(rows[0] || {})) {
      const value: number | null = readNumber(cell);

      if (value !== null) {
        return [{ segment: null, value }];
      }
    }

    return [];
  }

  if (data.isSegmented) {
    return rows.flatMap((row: Record<string, unknown>) => {
      const value: number | null = readNumber(row["value"]);

      return value === null
        ? []
        : [{ segment: readSegment(row["segment"]), value }];
    });
  }

  // A percentage of no rows is NULL: nothing to report, not 0.
  const value: number | null = readNumber(rows[0]?.["value"]);

  return value === null ? [] : [{ segment: null, value }];
}
