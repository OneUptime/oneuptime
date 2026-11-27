import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { SummaryField } from "../../../Components/Infrastructure/ResourceOverviewTab";
import StorageArrayResourceDetail from "../../../Components/StorageArray/StorageArrayResourceDetail";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import {
  getStorageArrayBucketNoUsageText,
  getStorageArrayBucketUsage,
} from "../Utils/StorageArrayHealth";

/*
 * One FlashBlade S3 bucket. Its series carry the bucket's name in the
 * `name` label of its bucket series, which scopes the Metrics tab.
 */
const getSummaryFields: (row: StorageArrayResource) => Array<SummaryField> = (
  row: StorageArrayResource,
): Array<SummaryField> => {
  const objects: number | null = StorageArrayResourceUtils.getDetailNumber(
    row,
    "objectCount",
  );

  return [
    {
      title: "Bucket",
      value: StorageArrayResourceUtils.displayNameForResource(row),
    },
    {
      title: "Account",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketAccountColumn,
      value: row.groupName,
    },
    {
      title: "Quota",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketQuotaColumn,
      value: StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(row, row.capacityBytes),
      ),
    },
    {
      // The flash it takes after data reduction; its Storage card has the rest.
      title: "Physical",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.physicalColumn,
      value: StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(row, row.usedBytes),
      ),
    },
    {
      title: "Objects",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketObjectsColumn,
      value: StorageArrayResourceUtils.formatCount(objects),
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

const StorageArrayBucketDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Bucket}
      getSummaryFields={getSummaryFields}
      emptyMessageTemplate={translationKey(
        "Bucket {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the array.",
      )}
      metricsTitleTemplate={translationKey("Bucket Metrics: {{name}}")}
      description="Latency, space and object count of this bucket, as the array reports them."
      storage={{
        description:
          "What the bucket stores, before data reduction, against its quota.",
        getUsage: (row: StorageArrayResource) => {
          return getStorageArrayBucketUsage(row);
        },
        getNoUsageText: getStorageArrayBucketNoUsageText,
      }}
    />
  );
};

export default StorageArrayBucketDetail;
