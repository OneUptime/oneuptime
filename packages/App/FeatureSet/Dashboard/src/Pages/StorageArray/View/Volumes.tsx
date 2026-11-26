import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { StorageArrayKindPage } from "Common/Types/StorageArray/StorageArrayPlatform";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import { getStorageArrayKindColumns } from "../../../Components/StorageArray/StorageArrayKindView";
import StorageArrayResourceUtils, {
  INVENTORY_SELECT,
} from "../Utils/StorageArrayResourceUtils";
import Select from "Common/Types/BaseDatabase/Select";
import {
  StorageArrayPlatformState,
  getKindPageFor,
  useStorageArrayPlatform,
} from "../Utils/UseStorageArrayPlatform";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * An array's volumes, read from the StorageArrayResource inventory
 * (kind=Volume). What the list says, and its columns where the platform
 * draws its volumes itself (an ONTAP volume's SVM and aggregate), are the
 * array's platform's (StorageArrayPlatform.kindPages, #11122); these
 * columns are the ones a FlashArray's volumes have. The detail route param
 * is the volume's externalId, percent-encoded
 * (StorageArrayResourceUtils.routeParamFromExternalId).
 */

// What the list says on a platform that says nothing of its volumes.
const VOLUMES_DESCRIPTION: string = translationKey(
  "The volumes of this array with their size, the space they use and their latest performance. Sort by latency to find the volume hosts are waiting on.",
);
const VOLUMES_NO_ITEMS: string = translationKey(
  "No volumes in the inventory yet. Volumes appear here a few minutes after the Storage Array Agent starts scraping the array.",
);

const StorageArrayVolumes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const page: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    StorageArrayResourceKind.Volume,
  );

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Volume}
      tableId="storage-array-volumes-table"
      name="Storage Array Volumes"
      singularName="Volume"
      pluralName="Volumes"
      title="Volumes"
      description={page?.description || VOLUMES_DESCRIPTION}
      noItemsMessage={page?.noItemsMessage || VOLUMES_NO_ITEMS}
      // What the platform's columns read is any of the row's values.
      {...(page?.columns
        ? {
            selectMoreFields:
              INVENTORY_SELECT as Select<StorageArrayResource>,
          }
        : {})}
      getDetailRoute={(item: StorageArrayResource): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: StorageArrayResourceUtils.routeParamFromExternalId(
              item.externalId || "",
            ),
          },
        );
      }}
      columns={
        page?.columns
          ? getStorageArrayKindColumns(page.columns)
          : [
              StorageArrayResourceColumns.getTextColumn({
                field: "groupName",
                title: "Pod / Group",
                description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumeGroupColumn,
              }),
              StorageArrayResourceColumns.getProvisionedColumn(),
              StorageArrayResourceColumns.getPhysicalColumn(),
              StorageArrayResourceColumns.getDataReductionColumn(),
              ...StorageArrayResourceColumns.getPerformanceColumns(),
              StorageArrayResourceColumns.getTextColumn({
                field: "connectionCount",
                title: "Hosts",
                description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumeHostsColumn,
              }),
              StorageArrayResourceColumns.getLastSeenColumn(),
            ]
      }
    />
  );
};

export default StorageArrayVolumes;
