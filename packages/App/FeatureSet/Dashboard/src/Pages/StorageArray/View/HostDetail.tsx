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
 * One host defined on an array. Its Metrics tab charts what the array's
 * platform charts for a host (StorageArrayPlatform.kindPages, #11122): a
 * FlashArray names one by its `host` label.
 */
const getSummaryFields: (row: StorageArrayResource) => Array<SummaryField> = (
  row: StorageArrayResource,
): Array<SummaryField> => {
  return [
    {
      title: "Host",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    {
      title: "Host Group",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostGroupColumn,
      value: row.groupName,
    },
    {
      title: "Connected Volumes",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostVolumesColumn,
      value:
        row.connectionCount === null || row.connectionCount === undefined
          ? undefined
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
  ];
};

const StorageArrayHostDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Host}
      getSummaryFields={getSummaryFields}
      emptyMessageTemplate={translationKey(
        "Host {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array.",
      )}
      metricsTitleTemplate={translationKey("Host Metrics: {{name}}")}
      description="Latency, IOPS and connectivity of this host, as the array sees them."
    />
  );
};

export default StorageArrayHostDetail;
