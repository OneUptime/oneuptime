import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * FlashArray volumes, read from the StorageArrayResource inventory
 * (kind=Volume). The detail route param is the volume's name on the
 * array, percent-encoded (StorageArrayResourceUtils.routeParamFromExternalId).
 */
const StorageArrayVolumes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Volume}
      tableId="storage-array-volumes-table"
      name="Storage Array Volumes"
      singularName="Volume"
      pluralName="Volumes"
      title="Volumes"
      description="Block volumes on this FlashArray with their size, the flash they use and their latest performance. Sort by latency to find the volume hosts are waiting on."
      noItemsMessage="No volumes found in the inventory yet. Volumes appear here a few minutes after the Storage Array Agent starts scraping the array."
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
      columns={[
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
      ]}
    />
  );
};

export default StorageArrayVolumes;
