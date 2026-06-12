import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchProxmoxInventoryResources,
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

const ProxmoxClusterGuests: FunctionComponent<
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
       * Postgres inventory read (ProxmoxResource, kind=Guest). VMID,
       * guest type and HA state ride additionalAttributes for the
       * custom columns below.
       */
      const guestList: Array<InfrastructureResource> =
        await fetchProxmoxInventoryResources({
          proxmoxClusterId: modelId,
          kind: "Guest",
        });

      setResources(guestList);
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
      title="Guests"
      description="QEMU VMs and LXC containers in this cluster with their current resource usage."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Node"
      tableIdPrefix="proxmox"
      emptyMessage="No guests reported yet. Make sure the Proxmox agent is sending metrics."
      columns={[
        {
          title: "VMID",
          key: "vmid",
        },
        {
          title: "Type",
          key: "guestType",
        },
        {
          title: "HA State",
          key: "haState",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["haState"] || "-";
          },
        },
      ]}
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
