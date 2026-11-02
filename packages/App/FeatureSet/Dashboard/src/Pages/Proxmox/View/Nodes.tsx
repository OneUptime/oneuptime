import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchProxmoxInventoryRows,
  routeParamFromExternalId,
} from "../Utils/ProxmoxResourceUtils";
import {
  getProxmoxNodeColumns,
  toProxmoxListResource,
} from "../../../Components/Proxmox/ProxmoxResourceColumns";
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
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const ProxmoxClusterNodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // The whole inventory: the nodes, and the guests each one runs.
  const [rows, setRows] = useState<Array<ProxmoxResourceModel>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (ProxmoxResource) — the same rows behind
       * the sidebar badge counts. No ClickHouse group-by; latest CPU and
       * memory ride the inventory row, and each node's guests are counted
       * from the same read.
       */
      const inventory: Array<ProxmoxResourceModel> =
        await fetchProxmoxInventoryRows({
          proxmoxClusterId: modelId,
        });

      setRows(inventory);
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

  const resources: Array<InfrastructureResource> = rows
    .filter((row: ProxmoxResourceModel): boolean => {
      return row.kind === "Node";
    })
    .map(toProxmoxListResource);

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Nodes"
      description="All nodes in this Proxmox cluster with their current resource usage and the guests they run."
      resources={resources}
      showGroupColumn={false}
      builtInColumnDescriptions={{
        status: PROXMOX_METRIC_DESCRIPTIONS.nodesTableStatus,
        cpu: PROXMOX_METRIC_DESCRIPTIONS.nodesTableCpu,
        memory: PROXMOX_METRIC_DESCRIPTIONS.nodesTableMemory,
        age: PROXMOX_METRIC_DESCRIPTIONS.nodesTableUptime,
      }}
      tableIdPrefix="proxmox"
      emptyMessage="No nodes reported yet. Make sure the Proxmox agent is sending metrics."
      columns={getProxmoxNodeColumns({ rows: rows, translator: translator })}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL] as Route,
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

export default ProxmoxClusterNodes;
