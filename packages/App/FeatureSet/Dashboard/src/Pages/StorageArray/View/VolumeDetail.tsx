import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SummaryField } from "../../../Components/Infrastructure/ResourceOverviewTab";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * One volume of an array. Its Metrics tab charts what the array's platform
 * charts for a volume, scoped by the labels it names one by
 * (StorageArrayPlatform.kindPages, #11122): a FlashArray volume by its
 * `name`, an ONTAP volume by its `volume` in its `svm`. These facts are a
 * FlashArray volume's; a platform that lists its own draws those.
 */
const getSummaryFields: (row: StorageArrayResource) => Array<SummaryField> = (
  row: StorageArrayResource,
): Array<SummaryField> => {
  const fields: Array<SummaryField> = [
    {
      title: "Volume",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    {
      title: "Pod / Group",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumeGroupColumn,
      value: row.groupName,
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
          ? undefined
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

  return fields;
};

const StorageArrayVolumeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Volume}
      getSummaryFields={getSummaryFields}
      emptyMessageTemplate={translationKey(
        "Volume {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array.",
      )}
      metricsTitleTemplate={translationKey("Volume Metrics: {{name}}")}
      description="Latency, IOPS, bandwidth and space of this volume, as the array reports them."
    />
  );
};

export default StorageArrayVolumeDetail;
