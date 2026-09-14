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

/*
 * Resource pools are list-only (no detail page): the receiver reports a
 * handful of usage gauges per pool and nothing that warrants its own
 * overview. Pool-level charts live on the Insights page.
 */
const VMwareVCenterResourcePools: FunctionComponent<
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
       * Postgres inventory read (VMwareResource, kind=ResourcePool). The
       * group column carries the owning cluster (or the ESXi host for a
       * pool on a standalone host).
       */
      const poolList: Array<InfrastructureResource> =
        await fetchVMwareInventoryResources({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.ResourcePool,
        });

      setResources(poolList);
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

  const readNumber: (
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
      title="Resource Pools"
      description="Resource pools in this vCenter with their current CPU and memory consumption. Every cluster and standalone host has at least a root pool."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Cluster / Host"
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="vmware"
      emptyMessage="No resource pools reported yet. Make sure the VMware agent is sending metrics."
      columns={[
        {
          title: "Inventory Path",
          key: "resourcePoolPath",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["resourcePoolPath"] || "-";
          },
        },
        {
          title: "CPU Usage",
          key: "cpuMhz",
          getValue: (resource: InfrastructureResource): string => {
            const n: number | null = readNumber(resource, "cpuMhz");
            return n === null ? "N/A" : formatMhz(n);
          },
        },
        {
          title: "Memory Usage",
          key: "memoryUsageBytes",
          getValue: (resource: InfrastructureResource): string => {
            return resource.memoryUsageBytes === null
              ? "N/A"
              : formatBytes(resource.memoryUsageBytes);
          },
        },
        {
          /*
           * Ballooning / swapping inside a pool means the pool's VMs are
           * being reclaimed from — an early memory-pressure signal.
           */
          title: "Ballooned / Swapped",
          key: "memoryBalloonedBytes",
          getValue: (resource: InfrastructureResource): string => {
            const ballooned: number | null = readNumber(
              resource,
              "memoryBalloonedBytes",
            );
            const swapped: number | null = readNumber(
              resource,
              "memorySwappedBytes",
            );
            if (ballooned === null && swapped === null) {
              return "-";
            }
            return `${formatBytes(ballooned ?? 0)} / ${formatBytes(swapped ?? 0)}`;
          },
        },
      ]}
    />
  );
};

export default VMwareVCenterResourcePools;
