import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  VMwareResourceKind,
  fetchVMwareInventoryResources,
  formatMhz,
  routeParamFromExternalId,
} from "../Utils/VMwareResourceUtils";
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

const VMwareVCenterHosts: FunctionComponent<
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
       * Postgres inventory read (VMwareResource, kind=Host) — the same
       * rows behind the sidebar badge counts. No ClickHouse group-by;
       * latest CPU % (vcenter.host.cpu.utilization) and memory usage
       * (vcenter.host.memory.usage) ride the inventory row.
       */
      const hostList: Array<InfrastructureResource> =
        await fetchVMwareInventoryResources({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Host,
        });

      setResources(hostList);
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
      title="Hosts"
      description="ESXi hosts managed by this vCenter with their current CPU and memory usage."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Datacenter"
      /*
       * The vcenter receiver emits no per-host power or connection state
       * (host health only surfaces as datacenter/cluster count metrics),
       * so there is no honest status pill to render.
       */
      showStatus={false}
      tableIdPrefix="vmware"
      emptyMessage="No ESXi hosts reported yet. Make sure the VMware agent is sending metrics and that its read-only user can see the hosts."
      columns={[
        {
          title: "Cluster",
          key: "clusterName",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["clusterName"] || "Standalone";
          },
        },
        {
          title: "CPU Capacity",
          key: "cpuCapacityMhz",
          getValue: (resource: InfrastructureResource): string => {
            const raw: string =
              resource.additionalAttributes["cpuCapacityMhz"] || "";
            return raw ? formatMhz(Number(raw)) : "N/A";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL] as Route,
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

export default VMwareVCenterHosts;
