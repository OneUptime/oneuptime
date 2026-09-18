import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchProxmoxInventoryResources,
  formatBytes,
  routeParamFromExternalId,
} from "../Utils/ProxmoxResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

const ProxmoxClusterStorage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (ProxmoxResource, kind=Storage). Disk
       * used/total ride additionalAttributes (diskBytes/maxDiskBytes)
       * for the custom column below; CPU/memory columns are hidden —
       * storage volumes have neither.
       */
      const storageList: Array<InfrastructureResource> =
        await fetchProxmoxInventoryResources({
          proxmoxClusterId: modelId,
          kind: "Storage",
        });

      setResources(storageList);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Storage"
      description="Storage volumes in this cluster with their current usage."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Node"
      showResourceMetrics={false}
      tableIdPrefix="proxmox"
      emptyMessage="No storage volumes reported yet. Make sure the Proxmox agent is sending metrics."
      columns={[
        {
          title: "Used / Total",
          key: "diskBytes",
          getValue: (resource: InfrastructureResource): string => {
            const usedRaw: string =
              resource.additionalAttributes["diskBytes"] || "";
            const totalRaw: string =
              resource.additionalAttributes["maxDiskBytes"] || "";
            if (!usedRaw || !totalRaw) {
              return "N/A";
            }
            const used: number = Number(usedRaw);
            const total: number = Number(totalRaw);
            if (
              !Number.isFinite(used) ||
              !Number.isFinite(total) ||
              total <= 0
            ) {
              return "N/A";
            }
            const pct: number = (used / total) * 100;
            return `${formatBytes(used)} / ${formatBytes(total)} (${pct.toFixed(1)}%)`;
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: routeParamFromExternalId(
              resource.additionalAttributes["externalId"] || "",
            ),
          },
        );
      }}
    />
  );
};

export default ProxmoxClusterStorage;
