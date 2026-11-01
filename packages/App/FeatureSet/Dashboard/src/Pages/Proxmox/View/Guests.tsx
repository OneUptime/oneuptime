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
import { sortProxmoxGuests } from "../Utils/ProxmoxPartFacts";
import {
  getProxmoxGuestColumns,
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
import OneUptimeDate from "Common/Types/Date";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const ProxmoxClusterGuests: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rows, setRows] = useState<Array<ProxmoxResourceModel>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (ProxmoxResource, kind=Guest), in VMID
       * order as people number their guests.
       */
      const guestRows: Array<ProxmoxResourceModel> =
        await fetchProxmoxInventoryRows({
          proxmoxClusterId: modelId,
          kind: "Guest",
        });

      setRows(sortProxmoxGuests(guestRows));
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

  const resources: Array<InfrastructureResource> = rows.map(
    toProxmoxListResource,
  );

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Guests"
      description="The VMs, containers and templates in this cluster, with their current resource usage and last backup."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Node"
      builtInColumnDescriptions={{
        status: PROXMOX_METRIC_DESCRIPTIONS.guestsTableStatus,
        cpu: PROXMOX_METRIC_DESCRIPTIONS.guestsTableCpu,
        memory: PROXMOX_METRIC_DESCRIPTIONS.guestsTableMemory,
        age: PROXMOX_METRIC_DESCRIPTIONS.guestsTableUptime,
      }}
      tableIdPrefix="proxmox"
      emptyMessage="No guests reported yet. Make sure the Proxmox agent is sending metrics."
      columns={getProxmoxGuestColumns({
        rows: rows,
        resources: resources,
        translator: translator,
        now: OneUptimeDate.getCurrentDate(),
      })}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL] as Route,
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

export default ProxmoxClusterGuests;
