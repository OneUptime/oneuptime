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
import StorageArrayResourceStatusBadge from "../../../Components/StorageArray/StorageArrayResourceStatusBadge";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";

/*
 * The hosts defined on a FlashArray (kind=Host): connectivity as the array
 * sees it (purefa_host_connectivity_info), the volumes connected to each
 * (purefa_host_connections_info) and the performance the host gets.
 */
const StorageArrayHosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Host}
      tableId="storage-array-hosts-table"
      name="Storage Array Hosts"
      singularName="Host"
      pluralName="Hosts"
      title="Hosts"
      description="The hosts defined on this FlashArray: whether the array sees them on all their paths, the volumes connected to them and the performance they get."
      noItemsMessage="No hosts found in the inventory yet. Hosts appear here a few minutes after the Storage Array Agent starts scraping the array."
      getDetailRoute={(item: StorageArrayResource): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: StorageArrayResourceUtils.routeParamFromExternalId(
              item.externalId || "",
            ),
          },
        );
      }}
      columns={[
        {
          field: {
            status: true,
          },
          title: "Connectivity",
          headerTooltip:
            STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn,
          type: FieldType.Element,
          getElement: (item: StorageArrayResource): ReactElement => {
            return (
              <div className="flex items-center gap-2">
                <StorageArrayResourceStatusBadge status={item.status} />
                {item.statusDetail ? (
                  <span className="text-xs text-gray-500">
                    {item.statusDetail}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            );
          },
        },
        StorageArrayResourceColumns.getTextColumn({
          field: "groupName",
          title: "Host Group",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostGroupColumn,
        }),
        StorageArrayResourceColumns.getTextColumn({
          field: "connectionCount",
          title: "Volumes",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostVolumesColumn,
        }),
        StorageArrayResourceColumns.getProvisionedColumn({
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostProvisionedColumn,
        }),
        StorageArrayResourceColumns.getPhysicalColumn(),
        StorageArrayResourceColumns.getDataReductionColumn(),
        ...StorageArrayResourceColumns.getPerformanceColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayHosts;
