import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  VMwareResourceKind,
  fetchVMwareInventoryResources,
  formatPercent,
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

const VMwareVCenterVirtualMachines: FunctionComponent<
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
       * Postgres inventory read (VMwareResource, kind=VirtualMachine —
       * templates included, flagged by the Power State column). Power
       * state, resource pool and CPU readiness ride additionalAttributes
       * for the custom columns below.
       */
      const vmList: Array<InfrastructureResource> =
        await fetchVMwareInventoryResources({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.VirtualMachine,
        });

      setResources(vmList);
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
      title="Virtual Machines"
      description="Virtual machines (and VM templates) in this vCenter with their current resource usage. CPU metrics are only reported for powered-on VMs."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Host"
      tableIdPrefix="vmware"
      emptyMessage="No virtual machines reported yet. Make sure the VMware agent is sending metrics and that its read-only role is propagated to child objects."
      columns={[
        {
          /*
           * Inferred per collection: the receiver emits vcenter.vm.cpu.*
           * only for powered-on VMs. Unset means the VM has not been
           * seen in a scrape yet — render "-" rather than guessing.
           */
          title: "Power State",
          key: "powerState",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["powerState"] || "-";
          },
        },
        {
          title: "Cluster",
          key: "clusterName",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["clusterName"] || "-";
          },
        },
        {
          title: "Resource Pool",
          key: "resourcePoolName",
          getValue: (resource: InfrastructureResource): string => {
            return (
              resource.additionalAttributes["resourcePoolName"] ||
              resource.additionalAttributes["virtualAppName"] ||
              "-"
            );
          },
        },
        {
          /*
           * vcenter.vm.cpu.readiness — % of time the VM was ready to run
           * but waited for a physical CPU. The single best signal for
           * CPU contention on the host; anything past ~10% hurts.
           */
          title: "CPU Ready",
          key: "cpuReadinessPercent",
          getValue: (resource: InfrastructureResource): string => {
            const raw: string =
              resource.additionalAttributes["cpuReadinessPercent"] || "";
            return raw ? formatPercent(Number(raw)) : "-";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL] as Route,
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

export default VMwareVCenterVirtualMachines;
