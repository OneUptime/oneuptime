import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SummaryField } from "../../../Components/Infrastructure/ResourceOverviewTab";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceStatusBadge from "../../../Components/StorageArray/StorageArrayResourceStatusBadge";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * One host defined on a FlashArray. Its series carry the host's name in
 * the `host` label (purefa_host_*), which scopes the Metrics tab.
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
      title: "Host",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    { title: "Storage Array", value: storageArray.name || "—" },
    {
      title: "Connectivity",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn,
      value: (
        <div className="flex items-center gap-2">
          <StorageArrayResourceStatusBadge status={row.status} />
          {row.statusDetail ? (
            <span className="text-xs text-gray-500">{row.statusDetail}</span>
          ) : (
            <></>
          )}
        </div>
      ),
    },
    {
      title: "Host Group",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostGroupColumn,
      value: row.groupName || "—",
    },
    {
      title: "Connected Volumes",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostVolumesColumn,
      value:
        row.connectionCount === null || row.connectionCount === undefined
          ? "—"
          : String(row.connectionCount),
    },
    {
      title: "Provisioned",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostProvisionedColumn,
      value: StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(row, row.capacityBytes),
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
  const objectFilters: Record<string, string> = { host: data.externalId };

  return StorageArrayResourceUtils.buildCatalogQueries([
    {
      metricId: "purefa-host-read-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefa-host-write-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefa-host-iops",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefa-host-write-iops",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefa-host-connectivity",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
  ]);
};

const StorageArrayHostDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Host}
      getSummaryFields={getSummaryFields}
      getQueryConfigs={getQueryConfigs}
      emptyMessageTemplate={translationKey(
        "Host {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array.",
      )}
      metricsTitleTemplate={translationKey("Host Metrics: {{name}}")}
      description="Latency, IOPS and connectivity of this host, as the FlashArray sees them."
    />
  );
};

export default StorageArrayHostDetail;
