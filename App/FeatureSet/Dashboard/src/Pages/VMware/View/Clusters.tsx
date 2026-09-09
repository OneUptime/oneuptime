import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  VMwareResourceKind,
  fetchVMwareInventoryResources,
  formatBytes,
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

const VMwareVCenterClusters: FunctionComponent<
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
       * Postgres inventory read (VMwareResource, kind=Cluster). Host /
       * VM counts and effective capacity ride additionalAttributes; a
       * compute cluster has no CPU % or memory usage of its own (those
       * live on its hosts), so the resource-metric columns are hidden.
       */
      const clusterList: Array<InfrastructureResource> =
        await fetchVMwareInventoryResources({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Cluster,
        });

      setResources(clusterList);
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

  const readCount: (
    resource: InfrastructureResource,
    key: string,
  ) => number | null = (
    resource: InfrastructureResource,
    key: string,
  ): number | null => {
    const raw: string = resource.additionalAttributes[key] || "";
    if (!raw) {
      return null;
    }
    const n: number = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Clusters"
      description="vSphere compute clusters in this vCenter with their host and VM counts and effective capacity. A standalone ESXi host has no cluster."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Datacenter"
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="vmware"
      emptyMessage="No clusters reported yet. Standalone ESXi hosts have no cluster object; otherwise make sure the VMware agent is sending metrics."
      columns={[
        {
          /*
           * vcenter.cluster.host.count{effective}: an "effective" host is
           * one DRS/HA can schedule on — a host in maintenance mode or
           * disconnected is counted but not effective.
           */
          title: "Hosts (effective / total)",
          key: "hostCount",
          getValue: (resource: InfrastructureResource): string => {
            const total: number | null = readCount(resource, "hostCount");
            const effective: number | null = readCount(
              resource,
              "effectiveHostCount",
            );
            if (total === null) {
              return "-";
            }
            return effective === null
              ? String(total)
              : `${effective} / ${total}`;
          },
        },
        {
          title: "VMs (powered on / total)",
          key: "vmCount",
          getValue: (resource: InfrastructureResource): string => {
            const total: number | null = readCount(resource, "vmCount");
            const on: number | null = readCount(resource, "poweredOnVmCount");
            if (total === null) {
              return "-";
            }
            return on === null ? String(total) : `${on} / ${total}`;
          },
        },
        {
          title: "Templates",
          key: "vmTemplateCount",
          getValue: (resource: InfrastructureResource): string => {
            const n: number | null = readCount(resource, "vmTemplateCount");
            return n === null ? "-" : String(n);
          },
        },
        {
          title: "Effective CPU",
          key: "cpuEffectiveMhz",
          getValue: (resource: InfrastructureResource): string => {
            const n: number | null = readCount(resource, "cpuEffectiveMhz");
            const limit: number | null = readCount(resource, "cpuCapacityMhz");
            if (n === null) {
              return "-";
            }
            return limit === null
              ? formatMhz(n)
              : `${formatMhz(n)} of ${formatMhz(limit)}`;
          },
        },
        {
          title: "Effective Memory",
          key: "memoryEffectiveBytes",
          getValue: (resource: InfrastructureResource): string => {
            const n: number | null = readCount(
              resource,
              "memoryEffectiveBytes",
            );
            if (n === null) {
              return "-";
            }
            const limit: number | null = resource.memoryLimitBytes;
            return limit === null
              ? formatBytes(n)
              : `${formatBytes(n)} of ${formatBytes(limit)}`;
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL] as Route,
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

export default VMwareVCenterClusters;
