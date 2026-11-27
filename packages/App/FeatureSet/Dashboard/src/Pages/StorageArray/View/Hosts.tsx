import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { StorageArrayKindPage } from "Common/Types/StorageArray/StorageArrayPlatform";
import {
  StorageArrayPlatformState,
  getKindPageFor,
  useStorageArrayPlatform,
} from "../Utils/UseStorageArrayPlatform";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
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
 * The hosts defined on a FlashArray (kind=Host): connectivity as the array
 * sees it (its connectivity series), the volumes connected to each (its
 * connections series) and the performance the host gets.
 */

// What the list says on a platform that says nothing of the kind.
const HOSTS_DESCRIPTION: string = translationKey(
  "The hosts defined on this array: whether the array sees them on all their paths, the volumes connected to them and the performance they get.",
);
const HOSTS_NO_ITEMS: string = translationKey(
  "No hosts in the inventory yet. Hosts appear here a few minutes after the Storage Array Agent starts scraping the array.",
);

const StorageArrayHosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const kindPage: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    StorageArrayResourceKind.Host,
  );

  return (
    <StorageArrayResourceTable
      storageArrayId={modelId}
      kind={StorageArrayResourceKind.Host}
      tableId="storage-array-hosts-table"
      name="Storage Array Hosts"
      singularName="Host"
      pluralName="Hosts"
      title="Hosts"
      description={kindPage?.description || HOSTS_DESCRIPTION}
      noItemsMessage={kindPage?.noItemsMessage || HOSTS_NO_ITEMS}
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
        // By the rules: Lost redundant paths in amber, with why under it.
        StorageArrayResourceColumns.getRulesStatusColumn({
          title: "Connectivity",
          description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn,
          field: "status",
        }),
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
