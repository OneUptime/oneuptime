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
 * One FlashBlade S3 bucket. Its series carry the bucket's name in the
 * `name` label (purefb_buckets_*), which scopes the Metrics tab.
 */
const getSummaryFields: (
  row: StorageArrayResource,
  storageArray: StorageArray,
) => Array<SummaryField> = (
  row: StorageArrayResource,
  storageArray: StorageArray,
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
    { title: "Storage Array", value: storageArray.name || "—" },
    {
      title: "Account",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketAccountColumn,
      value: row.groupName || "—",
    },
    {
      title: "Quota",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketQuotaColumn,
      value: StorageArrayResourceUtils.formatBytes(
        StorageArrayResourceUtils.freshMetricValue(row, row.capacityBytes),
      ),
    },
    {
      title: "Used",
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketUsedColumn,
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
      metricId: "purefb-bucket-read-latency",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
    {
      metricId: "purefb-bucket-physical",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
    {
      metricId: "purefb-bucket-object-count",
      arrayName: data.arrayName,
      objectFilters: objectFilters,
    },
  ]);
};

const StorageArrayBucketDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <StorageArrayResourceDetail
      kind={StorageArrayResourceKind.Bucket}
      getSummaryFields={getSummaryFields}
      getQueryConfigs={getQueryConfigs}
      emptyMessageTemplate={translationKey(
        "Bucket {{name}} is not in the inventory yet. It appears here a few minutes after the Storage Array Agent starts scraping the FlashBlade's object store.",
      )}
      metricsTitleTemplate={translationKey("Bucket Metrics: {{name}}")}
      description="Latency, space and object count of this bucket, as the FlashBlade reports them."
    />
  );
};

export default StorageArrayBucketDetail;
