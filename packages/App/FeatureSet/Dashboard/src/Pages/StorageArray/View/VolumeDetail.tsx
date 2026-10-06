import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SummaryField } from "../../../Components/Infrastructure/ResourceOverviewTab";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * One FlashArray volume. Its series carry the volume's name in the `name`
 * label (purefa_volume_*), which scopes the Metrics tab.
 */
const getSummaryFields: (
  row: StorageArrayResource,
  storageArray: StorageArray,
) => Array<SummaryField> = (
  row: StorageArrayResource,
  storageArray: StorageArray,
): Array<SummaryField> => {
  const fields: Array<SummaryField> = [
    {
      title: "Volume",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    { title: "Storage Array", value: storageArray.name || "—" },
    {
      title: "Pod / Group",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumeGroupColumn,
      value: row.groupName || "—",
    },
    {
      title: "Provisioned",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.provisionedColumn,
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
      title: "Read Bandwidth",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.readBandwidthColumn,
      value: StorageArrayResourceUtils.formatBytesPerSec(
        StorageArrayResourceUtils.freshMetricValue(row, row.readBytesPerSec),
      ),
    },
    {
      title: "Write Bandwidth",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.writeBandwidthColumn,
      value: StorageArrayResourceUtils.formatBytesPerSec(
        StorageArrayResourceUtils.freshMetricValue(row, row.writeBytesPerSec),
      ),
    },
    {
      title: "Connected Hosts",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumeHostsColumn,
      value:
        row.connectionCount === null || row.connectionCount === undefined
          ? "—"
          : String(row.connectionCount),
    },
  ];

  const naaId: string = StorageArrayResourceUtils.getDetailString(row, "naaId");
  if (naaId) {
    fields.push({ title: "NAA ID", value: naaId });
  }

  const qosIopsLimit: number | null = StorageArrayResourceUtils.getDetailNumber(
    row,
    "qosIopsLimit",
  );
  if (qosIopsLimit !== null && qosIopsLimit > 0) {
    fields.push({
      title: "QoS IOPS Limit",
      value: StorageArrayResourceUtils.formatIops(qosIopsLimit),
    });
  }

  const qosBandwidthLimit: number | null =
    StorageArrayResourceUtils.getDetailNumber(
      row,
      "qosBandwidthBytesPerSecLimit",
    );
  if (qosBandwidthLimit !== null && qosBandwidthLimit > 0) {
    fields.push({
      title: "QoS Bandwidth Limit",
      value: StorageArrayResourceUtils.formatBytesPerSec(qosBandwidthLimit),
    });
  }

  fields.push({
    title: "Last Seen",
    value: StorageArrayResourceUtils.formatLastSeen(row.lastSeenAt),
  });

  return fields;
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
      metricId: "purefa-volume-read-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefa-volume-write-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefa-volume-read-iops",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefa-volume-write-iops",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefa-volume-read-bandwidth",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Read",
    },
    {
      metricId: "purefa-volume-write-bandwidth",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: "purefa-volume-physical",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
    {
      metricId: "purefa-volume-data-reduction",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
  ]);
};

const StorageArrayVolumeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Volume}
      getSummaryFields={getSummaryFields}
      getQueryConfigs={getQueryConfigs}
      emptyMessageTemplate={translationKey(
        "Volume {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array.",
      )}
      metricsTitleTemplate={translationKey("Volume Metrics: {{name}}")}
      description="Latency, IOPS, bandwidth and space of this volume, as the FlashArray reports them."
    />
  );
};

export default StorageArrayVolumeDetail;
