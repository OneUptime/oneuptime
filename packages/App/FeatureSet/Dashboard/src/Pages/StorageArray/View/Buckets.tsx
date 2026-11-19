import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import FieldType from "Common/UI/Components/Types/FieldType";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";
import {
  getStorageArrayBucketNoUsageText,
  getStorageArrayBucketUsage,
} from "../Utils/StorageArrayHealth";

/*
 * FlashBlade S3 buckets (kind=Bucket), from purefb_buckets_* via the
 * inventory: the account a bucket belongs to (groupName), how full it is
 * against its quota (what it stores before data reduction, of capacityBytes;
 * #9647), its quota, the flash it uses (usedBytes) and its object count.
 */
const StorageArrayBuckets: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Bucket}
      tableId="storage-array-buckets-table"
      name="Storage Array Buckets"
      singularName="Bucket"
      pluralName="Buckets"
      title="Buckets"
      description="S3 buckets on this FlashBlade with their account, quota, the flash they use, how many objects they hold and their latest performance."
      noItemsMessage="No buckets in the inventory yet. Buckets appear here a few minutes after the Storage Array Agent starts scraping the FlashBlade's object store."
      getDetailRoute={(item: StorageArrayResource): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: StorageArrayResourceUtils.routeParamFromExternalId(
              item.externalId || "",
            ),
          },
        );
      }}
      columns={[
        StorageArrayResourceColumns.getTextColumn({
          field: "groupName",
          title: "Account",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketAccountColumn,
        }),
        StorageArrayResourceColumns.getUsageColumn({
          title: "Used",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketUsedColumn,
          getUsage: getStorageArrayBucketUsage,
          getNoUsageText: getStorageArrayBucketNoUsageText,
        }),
        StorageArrayResourceColumns.getProvisionedColumn({
          title: "Quota",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketQuotaColumn,
        }),
        StorageArrayResourceColumns.getPhysicalColumn(),
        {
          field: {
            details: true,
          },
          id: "objects",
          title: "Objects",
          headerTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.bucketObjectsColumn,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: StorageArrayResource): ReactElement => {
            const objects: number | null =
              StorageArrayResourceUtils.getDetailNumber(item, "objectCount");
            if (objects === null) {
              return <TableEmptyValue />;
            }
            return (
              <span className="text-sm text-gray-700">
                {getValueOrQuietDash(
                  StorageArrayResourceUtils.formatCount(objects),
                )}
              </span>
            );
          },
        },
        StorageArrayResourceColumns.getDataReductionColumn(),
        ...StorageArrayResourceColumns.getPerformanceColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayBuckets;
