import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SummaryField } from "../../../Components/Infrastructure/ResourceOverviewTab";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceUtils, {
  getFileSystemProtocols,
  getFileSystemProvisionedBytes,
} from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * One FlashBlade file system. Its series carry the file system's name in
 * the `name` label (purefb_file_systems_*), which scopes the Metrics tab.
 */
const getSummaryFields: (
  row: StorageArrayResource,
  storageArray: StorageArray,
) => Array<SummaryField> = (
  row: StorageArrayResource,
  storageArray: StorageArray,
): Array<SummaryField> => {
  return [
    {
      title: "File System",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    { title: "Storage Array", value: storageArray.name || "—" },
    {
      title: "Protocols",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemProtocolsColumn,
      value: getFileSystemProtocols(row).join(", ") || "—",
    },
    {
      title: "Provisioned",
      description:
        STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemProvisionedColumn,
      value: StorageArrayResourceUtils.formatBytes(
        getFileSystemProvisionedBytes(row),
      ),
    },
    {
      title: "Physical",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.physicalColumn,
      value: StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(row, row.usedBytes),
      ),
    },
    {
      title: "Data Reduction",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.dataReductionColumn,
      value: StorageArrayResourceUtils.formatRatio(
        StorageArrayResourceUtils.freshMetricValue(row, row.dataReductionRatio),
      ),
    },
    {
      title: "Read Latency",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readLatencyColumn,
      value: StorageArrayResourceUtils.formatLatencyUsec(
        StorageArrayResourceUtils.freshMetricValue(row, row.readLatencyUsec),
      ),
    },
    {
      title: "Write Latency",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeLatencyColumn,
      value: StorageArrayResourceUtils.formatLatencyUsec(
        StorageArrayResourceUtils.freshMetricValue(row, row.writeLatencyUsec),
      ),
    },
    {
      title: "Read IOPS",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readIopsColumn,
      value: StorageArrayResourceUtils.formatIops(
        StorageArrayResourceUtils.freshMetricValue(row, row.readIops),
      ),
    },
    {
      title: "Write IOPS",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeIopsColumn,
      value: StorageArrayResourceUtils.formatIops(
        StorageArrayResourceUtils.freshMetricValue(row, row.writeIops),
      ),
    },
    {
      title: "Last Seen",
      value: StorageArrayResourceUtils.formatLastSeen(row.lastSeenAt),
    },
  ];
};

const getQueryConfigs: (data: {
  arrayName: string;
  externalId: string;
}) => Array<MetricQueryConfigData> = (data: {
  arrayName: string;
  externalId: string;
}): Array<MetricQueryConfigData> => {
  const objectFilters: Record<string, string> = { name: data.externalId };

  return StorageArrayResourceUtils.buildCatalogQueries([
    {
      metricId: "purefb-fs-read-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefb-fs-write-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefb-fs-physical",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
    {
      metricId: "purefb-fs-available-ratio",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
  ]);
};

const StorageArrayFileSystemDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.FileSystem}
      getSummaryFields={getSummaryFields}
      getQueryConfigs={getQueryConfigs}
      emptyMessageTemplate={translationKey(
        "File system {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the FlashBlade.",
      )}
      metricsTitleTemplate={translationKey("File System Metrics: {{name}}")}
      description="Latency and space of this file system, as the FlashBlade reports them."
    />
  );
};

export default StorageArrayFileSystemDetail;
