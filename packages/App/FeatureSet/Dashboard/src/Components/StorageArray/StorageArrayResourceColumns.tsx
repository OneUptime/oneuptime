import React, { ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import Column from "Common/UI/Components/ModelTable/Column";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayResourceUtils from "../../Pages/StorageArray/Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../MetricDescriptions/StorageArrayMetricDescriptions";
import StorageArrayResourceStatusBadge from "./StorageArrayResourceStatusBadge";
import ResourceStatusCell from "../Infrastructure/ResourceStatusCell";
import { InfrastructureResource } from "../Infrastructure/ResourceTable";
import {
  StorageArrayAssessment,
  StorageArrayPartReadings,
  assessStorageArrayPart,
} from "../../Pages/StorageArray/Utils/StorageArrayHealth";

/*
 * The columns the Storage Array inventory tables share. Every value is the
 * latest gauge the array reported for the row — read through
 * freshMetricValue, so a row that has fallen off the scrape shows a dash
 * rather than numbers that stopped being true — and every column sorts on
 * its own field server-side, which is what finds the slow volume among
 * thousands.
 */

type ValueRenderer = (item: StorageArrayResource) => string;

function valueCell(text: string): ReactElement {
  if (!text || text === "—") {
    return <span className="text-gray-400">—</span>;
  }
  return <span className="text-sm text-gray-700">{text}</span>;
}

function metricColumn(data: {
  field: keyof StorageArrayResource;
  title: string;
  description: string;
  render: ValueRenderer;
  isHiddenByDefault?: boolean | undefined;
}): Column<StorageArrayResource> {
  return {
    field: { [data.field]: true },
    title: data.title,
    headerTooltip: data.description,
    type: FieldType.Element,
    hideOnMobile: true,
    isHiddenByDefault: data.isHiddenByDefault,
    getElement: (item: StorageArrayResource): ReactElement => {
      return valueCell(data.render(item));
    },
  };
}

/*
 * capacityBytes: a volume's or host's provisioned size, a drive's raw
 * capacity, a bucket's quota. Pages whose objects call it something else
 * pass their own title and description.
 */
export function getProvisionedColumn(options?: {
  title?: string | undefined;
  description?: string | undefined;
}): Column<StorageArrayResource> {
  return metricColumn({
    field: "capacityBytes",
    title: options?.title || "Provisioned",
    description:
      options?.description ||
      STORAGE_ARRAY_METRIC_DESCRIPTIONS.provisionedColumn,
    render: (item: StorageArrayResource): string => {
      return StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(item, item.capacityBytes),
      );
    },
  });
}

// usedBytes: the flash an object uses after data reduction.
export function getPhysicalColumn(options?: {
  title?: string | undefined;
  description?: string | undefined;
}): Column<StorageArrayResource> {
  return metricColumn({
    field: "usedBytes",
    title: options?.title || "Physical",
    description:
      options?.description || STORAGE_ARRAY_METRIC_DESCRIPTIONS.physicalColumn,
    render: (item: StorageArrayResource): string => {
      return StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(item, item.usedBytes),
      );
    },
  });
}

export function getDataReductionColumn(): Column<StorageArrayResource> {
  return metricColumn({
    field: "dataReductionRatio",
    title: "Data Reduction",
    description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.dataReductionColumn,
    render: (item: StorageArrayResource): string => {
      return StorageArrayResourceUtils.formatRatio(
        StorageArrayResourceUtils.freshMetricValue(
          item,
          item.dataReductionRatio,
        ),
      );
    },
  });
}

export function getLatencyColumns(): Columns<StorageArrayResource> {
  return [
    metricColumn({
      field: "readLatencyUsec",
      title: "Read Latency",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readLatencyColumn,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatLatencyUsec(
          StorageArrayResourceUtils.freshMetricValue(
            item,
            item.readLatencyUsec,
          ),
        );
      },
    }),
    metricColumn({
      field: "writeLatencyUsec",
      title: "Write Latency",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeLatencyColumn,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatLatencyUsec(
          StorageArrayResourceUtils.freshMetricValue(
            item,
            item.writeLatencyUsec,
          ),
        );
      },
    }),
  ];
}

export function getIopsColumns(): Columns<StorageArrayResource> {
  return [
    metricColumn({
      field: "readIops",
      title: "Read IOPS",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readIopsColumn,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatIops(
          StorageArrayResourceUtils.freshMetricValue(item, item.readIops),
        );
      },
    }),
    metricColumn({
      field: "writeIops",
      title: "Write IOPS",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeIopsColumn,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatIops(
          StorageArrayResourceUtils.freshMetricValue(item, item.writeIops),
        );
      },
    }),
  ];
}

/*
 * Bandwidth starts hidden: with latency and IOPS beside it the table no
 * longer fits a laptop screen, and the column picker offers it.
 */
export function getBandwidthColumns(): Columns<StorageArrayResource> {
  return [
    metricColumn({
      field: "readBytesPerSec",
      title: "Read Bandwidth",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readBandwidthColumn,
      isHiddenByDefault: true,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatBytesPerSec(
          StorageArrayResourceUtils.freshMetricValue(
            item,
            item.readBytesPerSec,
          ),
        );
      },
    }),
    metricColumn({
      field: "writeBytesPerSec",
      title: "Write Bandwidth",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeBandwidthColumn,
      isHiddenByDefault: true,
      render: (item: StorageArrayResource): string => {
        return StorageArrayResourceUtils.formatBytesPerSec(
          StorageArrayResourceUtils.freshMetricValue(
            item,
            item.writeBytesPerSec,
          ),
        );
      },
    }),
  ];
}

// The latency, IOPS and bandwidth columns every performance table shows.
export function getPerformanceColumns(): Columns<StorageArrayResource> {
  return [
    ...getLatencyColumns(),
    ...getIopsColumns(),
    ...getBandwidthColumns(),
  ];
}

/*
 * A part's state by the rules (StorageArrayHealth): its word coloured at
 * its alert's line, and why under it - what the Overview's Needs attention
 * and the part's own page say about the same part. readingsFor gives what
 * the inventory has no column for (a file system's available share).
 */
export function toStorageArrayStatusCell(
  assessment: StorageArrayAssessment,
): Pick<
  InfrastructureResource,
  "status" | "statusTone" | "statusText" | "statusReasons"
> {
  return {
    status: assessment.status.label,
    statusTone: assessment.status.tone,
    statusText: assessment.status.values
      ? { text: assessment.status.label, values: assessment.status.values }
      : { text: assessment.status.label },
    statusReasons: assessment.reasons,
  };
}

export function getRulesStatusColumn(data: {
  title: string;
  description: string;
  // The column the rules read first; sorting by it groups the problems.
  field: keyof StorageArrayResource;
  readingsFor?:
    | ((item: StorageArrayResource) => StorageArrayPartReadings)
    | undefined;
  // A state worked out from a reading the table cannot sort by.
  disableSort?: boolean | undefined;
}): Column<StorageArrayResource> {
  return {
    field: { [data.field]: true },
    title: data.title,
    headerTooltip: data.description,
    type: FieldType.Element,
    ...(data.disableSort ? { disableSort: true } : {}),
    getElement: (item: StorageArrayResource): ReactElement => {
      return (
        <ResourceStatusCell
          resource={toStorageArrayStatusCell(
            assessStorageArrayPart(
              item,
              data.readingsFor ? data.readingsFor(item) : {},
            ),
          )}
        />
      );
    },
  };
}

export function getStatusColumn(data: {
  title: string;
  description: string;
}): Column<StorageArrayResource> {
  return {
    field: { status: true },
    title: data.title,
    headerTooltip: data.description,
    type: FieldType.Element,
    getElement: (item: StorageArrayResource): ReactElement => {
      return <StorageArrayResourceStatusBadge status={item.status} />;
    },
  };
}

// A plain text column with a dash for an empty value.
export function getTextColumn(data: {
  field: keyof StorageArrayResource;
  title: string;
  description?: string | undefined;
  isHiddenByDefault?: boolean | undefined;
}): Column<StorageArrayResource> {
  return {
    field: { [data.field]: true },
    title: data.title,
    headerTooltip: data.description,
    type: FieldType.Element,
    hideOnMobile: true,
    isHiddenByDefault: data.isHiddenByDefault,
    getElement: (item: StorageArrayResource): ReactElement => {
      const value: unknown = item[data.field];
      return valueCell(
        value === null || value === undefined || value === ""
          ? ""
          : String(value),
      );
    },
  };
}

export function getLastSeenColumn(): Column<StorageArrayResource> {
  return {
    field: { lastSeenAt: true },
    title: "Last Seen",
    type: FieldType.DateTime,
    hideOnMobile: true,
    isHiddenByDefault: true,
  };
}

export default {
  getProvisionedColumn,
  getPhysicalColumn,
  getDataReductionColumn,
  getLatencyColumns,
  getIopsColumns,
  getBandwidthColumns,
  getPerformanceColumns,
  getStatusColumn,
  getRulesStatusColumn,
  getTextColumn,
  getLastSeenColumn,
};
