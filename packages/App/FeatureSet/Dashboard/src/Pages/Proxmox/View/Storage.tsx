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
  getProxmoxStorageColumns,
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

const ProxmoxClusterStorage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (ProxmoxResource, kind=Storage). Disk
       * used/total, the storage's type, whether it is shared and what it
       * holds ride additionalAttributes for the columns below; CPU and
       * memory columns are hidden — storage volumes have neither.
       */
      const storageRows: Array<ProxmoxResourceModel> =
        await fetchProxmoxInventoryRows({
          proxmoxClusterId: modelId,
          kind: "Storage",
        });

      setResources(storageRows.map(toProxmoxListResource));
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
      description="Storage volumes in this cluster with their type and current usage."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Node"
      showResourceMetrics={false}
      builtInColumnDescriptions={{
        status: PROXMOX_METRIC_DESCRIPTIONS.storageTableStatus,
        age: PROXMOX_METRIC_DESCRIPTIONS.storageTableAge,
      }}
      tableIdPrefix="proxmox"
      emptyMessage="No storage volumes reported yet. Make sure the Proxmox agent is sending metrics."
      columns={getProxmoxStorageColumns({
        resources: resources,
        translator: translator,
      })}
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
