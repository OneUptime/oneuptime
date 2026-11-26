import React, { ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import Column from "Common/UI/Components/ModelTable/Column";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { JSONValue } from "Common/Types/JSON";
import {
  StorageArrayKindColumn,
  StorageArrayKindColumnFormat,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import {
  StorageUsage,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import StorageArrayResourceUtils from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import StorageArrayResourceColumns from "./StorageArrayResourceColumns";

/*
 * The columns of the list of a kind a platform has of its own, as the
 * platform declares them (StorageArrayKindDefinition.listColumns): which of
 * the row's fields each shows, or which of its details, in the platform's
 * words - a PowerScale node's health, model, OneFS version, CPU and
 * throughput; a quota's kind, how much of its limit it uses and its limits.
 * Titles and descriptions are translation keys, drawn in the reader's
 * language by the table.
 */

const YES: string = translationKey("Yes");
const NO: string = translationKey("No");
// A usage bar's row with no size to measure against (a quota with no limit).
const NO_LIMIT: string = translationKey("No limit");
const NOT_REPORTED: string = translationKey("Not reported");

function valueCell(text: string): ReactElement {
  if (!text || text === "—") {
    return <TableEmptyValue />;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}

// A detail of the row, as its column says it reads.
export function formatKindDetail(
  item: StorageArrayResource,
  detail: string,
  format: StorageArrayKindColumnFormat,
): string {
  const value: JSONValue | undefined = StorageArrayResourceUtils.getDetail(
    item,
    detail,
  );
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (format === "yesNo") {
    return value === true ? YES : value === false ? NO : "";
  }
  if (format === "text") {
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : "";
  }
  const number: number | null = StorageArrayResourceUtils.getDetailNumber(
    item,
    detail,
  );
  if (number === null) {
    return "";
  }
  switch (format) {
    case "bytes":
      return StorageArrayResourceUtils.formatBytes(number);
    case "percent":
      // A reading: a dash once the row has fallen off the polls.
      return StorageArrayResourceUtils.formatPercent(
        StorageArrayResourceUtils.freshMetricValue(item, number),
      );
    case "seconds":
      return StorageArrayResourceUtils.formatDurationMs(number * 1000);
    case "number":
    default:
      return StorageArrayResourceUtils.formatCount(number);
  }
}

// How much of its size a row uses, for a usage column.
export function getKindUsage(
  item: StorageArrayResource,
  column: StorageArrayKindColumn,
): StorageUsage | null {
  return getStorageUsage(
    { capacity: item.capacityBytes, used: item.usedBytes },
    {
      warningPercent: column.warningPercent ?? 80,
      criticalPercent: column.criticalPercent ?? 90,
    },
  );
}

function getColumn(
  column: StorageArrayKindColumn,
): Column<StorageArrayResource> {
  const title: string = column.title || "";
  const description: string | undefined = column.description;
  switch (column.shows) {
    case "status":
      return StorageArrayResourceColumns.getStatusColumn({
        title,
        description,
      });
    case "type":
      return {
        field: { componentType: true },
        title,
        headerTooltip: description,
        type: FieldType.Element,
        hideOnMobile: true,
        isHiddenByDefault: column.hiddenByDefault,
        getElement: (item: StorageArrayResource): ReactElement => {
          return valueCell(
            StorageArrayResourceUtils.formatStatusLabel(item.componentType),
          );
        },
      };
    case "model":
      return StorageArrayResourceColumns.getTextColumn({
        field: "model",
        title,
        description,
        isHiddenByDefault: column.hiddenByDefault,
      });
    case "version":
      return StorageArrayResourceColumns.getTextColumn({
        field: "firmwareVersion",
        title,
        description,
        isHiddenByDefault: column.hiddenByDefault,
      });
    case "group":
      return StorageArrayResourceColumns.getTextColumn({
        field: "groupName",
        title,
        description,
        isHiddenByDefault: column.hiddenByDefault,
      });
    case "capacity":
      return {
        ...StorageArrayResourceColumns.getProvisionedColumn({
          title,
          description,
        }),
        isHiddenByDefault: column.hiddenByDefault,
      };
    case "used":
      return {
        ...StorageArrayResourceColumns.getPhysicalColumn({
          title,
          description,
        }),
        isHiddenByDefault: column.hiddenByDefault,
      };
    case "usage":
      return StorageArrayResourceColumns.getUsageColumn({
        title,
        description: description || "",
        getUsage: (item: StorageArrayResource): StorageUsage | null => {
          return getKindUsage(item, column);
        },
        getNoUsageText: (item: StorageArrayResource): string => {
          return item.usedBytes !== null && item.usedBytes !== undefined
            ? NO_LIMIT
            : NOT_REPORTED;
        },
      });
    case "readBandwidth":
    case "writeBandwidth": {
      const field: "readBytesPerSec" | "writeBytesPerSec" =
        column.shows === "readBandwidth"
          ? "readBytesPerSec"
          : "writeBytesPerSec";
      return {
        field: { [field]: true },
        title,
        headerTooltip: description,
        type: FieldType.Element,
        hideOnMobile: true,
        isHiddenByDefault: column.hiddenByDefault,
        getElement: (item: StorageArrayResource): ReactElement => {
          return valueCell(
            StorageArrayResourceUtils.formatBytesPerSec(
              StorageArrayResourceUtils.freshMetricValue(item, item[field]),
            ),
          );
        },
      };
    }
    case "temperature":
      return {
        field: { temperatureCelsius: true },
        title,
        headerTooltip: description,
        type: FieldType.Element,
        hideOnMobile: true,
        isHiddenByDefault: column.hiddenByDefault,
        getElement: (item: StorageArrayResource): ReactElement => {
          const temperature: number | null =
            StorageArrayResourceUtils.freshMetricValue(
              item,
              item.temperatureCelsius,
            );
          return valueCell(
            temperature === null
              ? ""
              : StorageArrayResourceUtils.formatTemperature(temperature),
          );
        },
      };
    case "detail":
      return {
        field: { details: true },
        id: `detail-${column.detail}`,
        title,
        headerTooltip: description,
        type: FieldType.Element,
        // What it would sort by is the whole of the row's details.
        disableSort: true,
        hideOnMobile: true,
        isHiddenByDefault: column.hiddenByDefault,
        getElement: (item: StorageArrayResource): ReactElement => {
          return valueCell(
            formatKindDetail(
              item,
              column.detail || "",
              column.format || "text",
            ),
          );
        },
      };
    case "lastSeen":
    default:
      return StorageArrayResourceColumns.getLastSeenColumn();
  }
}

export function getStorageArrayKindColumns(
  columns: ReadonlyArray<StorageArrayKindColumn>,
): Columns<StorageArrayResource> {
  return columns.map(getColumn);
}

export default getStorageArrayKindColumns;
