import React, { ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { JSONValue } from "Common/Types/JSON";
import {
  StorageArrayKindColumn,
  StorageArrayKindField,
  StorageArrayKindPart,
  StorageArrayPartChart,
  StorageArrayPartLabel,
  StorageArrayRowColumn,
  StorageArrayRowValue,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import {
  getStorageUsage,
  StorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import StorageArrayResourceUtils, {
  getMetricStaleMs,
} from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS,
  getStorageArrayPartLabelValue,
} from "../../Pages/StorageArray/Utils/StorageArrayHealth";
import { SummaryField } from "../Infrastructure/ResourceOverviewTab";
import StorageArrayResourceColumns from "./StorageArrayResourceColumns";
import StorageArrayResourceStatusBadge from "./StorageArrayResourceStatusBadge";

/*
 * A KIND'S PAGES AS ITS PLATFORM DECLARES THEM (#11122).
 *
 * A platform that draws a kind itself (StorageArrayPlatform.kindPages: a
 * NetApp volume, aggregate, SVM, LUN or SnapMirror relationship) declares
 * its list's columns, its part page's facts and its charts as data
 * (StorageArrayKindColumn, StorageArrayKindField, StorageArrayPartChart).
 * This module draws them with the same columns, formatters and freshness
 * rules the shared pages use, so an ONTAP aggregate's Used bar and a
 * FlashBlade bucket's read alike.
 */

// The row columns that hold a reading, and go stale with the row's metrics.
const METRIC_COLUMNS: ReadonlyArray<StorageArrayRowColumn> = [
  "capacityBytes",
  "usedBytes",
  "dataReductionRatio",
  "readLatencyUsec",
  "writeLatencyUsec",
  "readIops",
  "writeIops",
  "readBytesPerSec",
  "writeBytesPerSec",
  "temperatureCelsius",
  "replicationLagMs",
];

/*
 * The raw value of a row behind a StorageArrayRowValue: a metric column
 * once fresh (freshMetricValue), a details value while the row itself is
 * (its last report within the kind's stale window), any other column as
 * stored.
 */
export function readStorageArrayRowValue(
  row: StorageArrayResource,
  value: StorageArrayRowValue,
): JSONValue | null {
  if (value.column) {
    const raw: unknown = (row as unknown as Record<string, unknown>)[
      value.column
    ];
    if (METRIC_COLUMNS.includes(value.column)) {
      return StorageArrayResourceUtils.freshMetricValue(
        row,
        raw as number | null | undefined,
      );
    }
    if (raw === null || raw === undefined || raw === "") {
      return null;
    }
    return raw as JSONValue;
  }
  if (value.detail) {
    if (!isRowFresh(row)) {
      return null;
    }
    const raw: JSONValue | undefined = StorageArrayResourceUtils.getDetail(
      row,
      value.detail,
    );
    return raw === undefined || raw === "" ? null : raw;
  }
  return null;
}

// Whether the row's last report is recent enough for its details to stand.
function isRowFresh(row: StorageArrayResource): boolean {
  if (!row.lastSeenAt) {
    return true;
  }
  const ageMs: number = Date.now() - new Date(row.lastSeenAt as Date).getTime();
  return ageMs <= getMetricStaleMs(row.kind);
}

function toNumber(value: JSONValue | null): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/*
 * A value as the pages write it, in the reader's digits; "" for a value
 * the array never sent (the dash is drawn by the caller).
 */
export function formatStorageArrayRowValue(
  row: StorageArrayResource,
  value: StorageArrayRowValue,
  translator: Translator = getGlobalTranslator(),
): string {
  const raw: JSONValue | null = readStorageArrayRowValue(row, value);
  if (raw === null) {
    return "";
  }
  const number: number | null = toNumber(raw);
  let text: string = "";
  switch (value.format) {
    case "bytes":
      text = StorageArrayResourceUtils.formatBytes(number, translator);
      break;
    case "bytesPerSec":
      text = StorageArrayResourceUtils.formatBytesPerSec(number, translator);
      break;
    case "percent":
      text = StorageArrayResourceUtils.formatPercent(number, translator);
      break;
    case "ratio":
      text = StorageArrayResourceUtils.formatRatio(number, translator);
      break;
    case "latencyUsec":
      text = StorageArrayResourceUtils.formatLatencyUsec(number, translator);
      break;
    case "iops":
      text = StorageArrayResourceUtils.formatIops(number, translator);
      break;
    case "perSec":
      text =
        number === null
          ? ""
          : `${StorageArrayResourceUtils.formatCount(number, translator)}/s`;
      break;
    case "durationMs":
      text = StorageArrayResourceUtils.formatDurationMs(number);
      break;
    case "durationSeconds":
      text =
        number === null
          ? ""
          : StorageArrayResourceUtils.formatDurationMs(number * 1000);
      break;
    case "count":
      text = StorageArrayResourceUtils.formatCount(number, translator);
      break;
    case "celsius":
      text = StorageArrayResourceUtils.formatTemperature(number, translator);
      break;
    case "speedMbps":
      text =
        number === null
          ? ""
          : StorageArrayResourceUtils.formatBytesPerSec(
              (number * 1000 * 1000) / 8,
              translator,
            );
      break;
    case "boolean":
      text =
        raw === true || raw === "true"
          ? translator.translateText("Yes") || "Yes"
          : raw === false || raw === "false"
            ? translator.translateText("No") || "No"
            : "";
      break;
    case "status":
      text = StorageArrayResourceUtils.formatStatusLabel(String(raw));
      break;
    default:
      text = String(raw);
      break;
  }
  return text === "—" ? "" : text;
}

function valueCell(text: string): ReactElement {
  if (!text) {
    return <TableEmptyValue />;
  }
  return (
    <span className="text-sm text-gray-700">{getValueOrQuietDash(text)}</span>
  );
}

// How full a row is, from its size and what it uses.
export function getStorageArrayRowUsage(
  row: StorageArrayResource,
  thresholds?: {
    warningPercent?: number | undefined;
    criticalPercent?: number | undefined;
  },
): StorageUsage | null {
  const capacity: number | null = StorageArrayResourceUtils.freshMetricValue(
    row,
    row.capacityBytes,
  );
  const used: number | null = StorageArrayResourceUtils.freshMetricValue(
    row,
    row.usedBytes,
  );
  if (capacity === null || capacity <= 0 || used === null) {
    return null;
  }
  return getStorageUsage(
    { capacity: capacity, used: used },
    {
      ...STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS,
      ...(thresholds?.warningPercent !== undefined
        ? { warningPercent: thresholds.warningPercent }
        : {}),
      ...(thresholds?.criticalPercent !== undefined
        ? { criticalPercent: thresholds.criticalPercent }
        : {}),
    },
  );
}

// The words a list says while a row has no size or use yet.
const USAGE_NOT_REPORTED: string = translationKey("Not reported");

function valueColumn(
  column: Extract<StorageArrayKindColumn, { type: "value" }>,
): Column<StorageArrayResource> {
  const value: StorageArrayRowValue = column.value;
  const sortable: boolean = Boolean(value.column);
  return {
    field: value.column
      ? ({ [value.column]: true } as Column<StorageArrayResource>["field"])
      : { details: true },
    id: column.id,
    title: column.title,
    headerTooltip: column.description,
    type: FieldType.Element,
    hideOnMobile: true,
    isHiddenByDefault: column.hiddenByDefault,
    ...(sortable ? {} : { disableSort: true }),
    getElement: (item: StorageArrayResource): ReactElement => {
      if (value.format === "status") {
        const raw: JSONValue | null = readStorageArrayRowValue(item, value);
        return (
          <StorageArrayResourceStatusBadge
            status={raw === null ? null : String(raw)}
          />
        );
      }
      return valueCell(formatStorageArrayRowValue(item, value));
    },
  };
}

function lagColumn(
  column: Extract<StorageArrayKindColumn, { type: "lag" }>,
): Column<StorageArrayResource> {
  return {
    field: { replicationLagMs: true },
    title: column.title,
    headerTooltip: column.description,
    type: FieldType.Element,
    getElement: (item: StorageArrayResource): ReactElement => {
      const lag: number | null = StorageArrayResourceUtils.freshMetricValue(
        item,
        item.replicationLagMs,
      );
      if (lag === null) {
        return valueCell("");
      }
      return valueCell(StorageArrayResourceUtils.formatDurationMs(lag));
    },
  };
}

/*
 * The columns of a list a platform draws itself, after the name every
 * list starts with.
 */
export function getStorageArrayKindColumns(
  columns: ReadonlyArray<StorageArrayKindColumn>,
): Columns<StorageArrayResource> {
  const result: Columns<StorageArrayResource> = [];
  for (const column of columns) {
    switch (column.type) {
      case "status":
        result.push(
          StorageArrayResourceColumns.getRulesStatusColumn({
            title: column.title,
            description: column.description || "",
            field: "status",
          }),
        );
        break;
      case "usage":
        result.push(
          StorageArrayResourceColumns.getUsageColumn({
            title: column.title,
            description: column.description,
            getUsage: (item: StorageArrayResource): StorageUsage | null => {
              return getStorageArrayRowUsage(item, column);
            },
            getNoUsageText: (): string => {
              return USAGE_NOT_REPORTED;
            },
          }),
        );
        break;
      case "lag":
        result.push(lagColumn(column));
        break;
      case "latency":
        result.push(...StorageArrayResourceColumns.getLatencyColumns());
        break;
      case "iops":
        result.push(...StorageArrayResourceColumns.getIopsColumns());
        break;
      case "bandwidth":
        result.push(...StorageArrayResourceColumns.getBandwidthColumns());
        break;
      case "performance":
        result.push(...StorageArrayResourceColumns.getPerformanceColumns());
        break;
      case "value":
        result.push(valueColumn(column));
        break;
      case "lastSeen":
        result.push(StorageArrayResourceColumns.getLastSeenColumn());
        break;
      default:
        break;
    }
  }
  return result;
}

/*
 * A part page's facts, as its Details card lists them: each title over
 * its value in the reader's words, a status as a pill.
 */
export function getStorageArrayKindSummaryFields(
  fields: ReadonlyArray<StorageArrayKindField>,
  row: StorageArrayResource,
): Array<SummaryField> {
  return fields.map((field: StorageArrayKindField): SummaryField => {
    if (field.value.format === "status") {
      const raw: JSONValue | null = readStorageArrayRowValue(row, field.value);
      return {
        title: field.title,
        description: field.description,
        value:
          raw === null ? undefined : (
            <StorageArrayResourceStatusBadge status={String(raw)} />
          ),
      };
    }
    const text: string = formatStorageArrayRowValue(row, field.value);
    return {
      title: field.title,
      description: field.description,
      value: text || undefined,
    };
  });
}

/*
 * The label filters that scope a part page's charts to the part: each
 * label the platform names it by, with the part's own value of it. Before
 * the inventory has the part, its route's externalId stands for the first.
 */
export function getStorageArrayPartObjectFilters(
  labels: ReadonlyArray<StorageArrayPartLabel>,
  data: { externalId: string; row: StorageArrayResource | null },
): Record<string, string> {
  const filters: Record<string, string> = {};
  labels.forEach((label: StorageArrayPartLabel, index: number): void => {
    const value: string = data.row
      ? getStorageArrayPartLabelValue(data.row, label.from)
      : index === 0
        ? data.externalId
        : "";
    if (value) {
      filters[label.label] = value;
    }
  });
  return filters;
}

// A part page's charts: its platform's, scoped to the part.
export function getStorageArrayPartQueries(
  part: StorageArrayKindPart,
  data: {
    arrayName: string;
    externalId: string;
    row: StorageArrayResource | null;
  },
): Array<MetricQueryConfigData> {
  const objectFilters: Record<string, string> =
    getStorageArrayPartObjectFilters(part.labels, data);
  return StorageArrayResourceUtils.buildCatalogQueries(
    part.charts.map((chart: StorageArrayPartChart) => {
      return {
        metricId: chart.metricId,
        arrayName: data.arrayName,
        objectFilters: objectFilters,
        ...(chart.legend ? { legend: chart.legend } : {}),
        ...(chart.overlayWithPreviousQuery
          ? { overlayWithPreviousQuery: true }
          : {}),
      };
    }),
  );
}
