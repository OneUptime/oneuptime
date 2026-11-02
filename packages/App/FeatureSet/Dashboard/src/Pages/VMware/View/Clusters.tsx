import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import OneUptimeDate from "Common/Types/Date";
import {
  VMwareResourceKind,
  fetchVMwareInventoryRows,
  formatBytes,
  routeParamFromExternalId,
} from "../Utils/VMwareResourceUtils";
import {
  VMWARE_USAGE_BAR_THRESHOLDS,
  getVMwareClusterHostsTone,
  toVMwareListResources,
} from "../../../Components/VMware/VMwareResourceColumns";
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
import { VMWARE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/VMwareMetricDescriptions";

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
       * Postgres inventory reads (VMwareResource): the clusters, with their
       * host and VM counts, and their hosts and datacenters - a cluster's
       * status reads its hosts (one vCenter cannot reach makes it
       * Unhealthy) and their datacenters' counts (VMwareHealth), and its
       * CPU and Memory are what its running hosts use of what it can give
       * its VMs (VMwareResourceColumns).
       */
      const [clusterRows, hostRows, datacenterRows]: [
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
      ] = await Promise.all([
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Cluster,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Host,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datacenter,
        }),
      ]);

      setResources(
        toVMwareListResources(clusterRows, {
          datacenters: datacenterRows,
          hosts: hostRows,
          now: OneUptimeDate.getCurrentDate(),
        }),
      );
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
      description="vSphere compute clusters in this vCenter, whether each one needs attention, its host and VM counts and how much of its effective capacity its hosts use. A standalone ESXi host has no cluster."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Datacenter"
      groupColumnFoldInto="name"
      showAge={false}
      formatMemory={formatBytes}
      builtInColumnDescriptions={{
        status: VMWARE_METRIC_DESCRIPTIONS.clusterListStatus,
        cpu: VMWARE_METRIC_DESCRIPTIONS.clusterCpuInUse,
        memory: VMWARE_METRIC_DESCRIPTIONS.clusterMemoryInUse,
      }}
      metricThresholds={{
        cpu: VMWARE_USAGE_BAR_THRESHOLDS,
        memory: VMWARE_USAGE_BAR_THRESHOLDS,
      }}
      tableIdPrefix="vmware"
      emptyMessage="No clusters reported yet. Standalone ESXi hosts have no cluster object; otherwise make sure the VMware agent is sending metrics."
      columns={[
        {
          /*
           * vcenter.cluster.host.count{effective}: an "effective" host is
           * one DRS/HA can schedule on — a host in maintenance mode or
           * disconnected is counted but not effective.
           */
          /*
           * "3 / 4": effective out of all, as the cluster page's Effective
           * hosts tile says it (its (i) says which is which).
           */
          title: "Hosts",
          key: "hostCount",
          description: VMWARE_METRIC_DESCRIPTIONS.clusterListHosts,
          getTone: getVMwareClusterHostsTone,
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
          // "9 / 10": powered on out of all.
          title: "VMs",
          key: "vmCount",
          description: VMWARE_METRIC_DESCRIPTIONS.clusterListVirtualMachines,
          getValue: (resource: InfrastructureResource): string => {
            const total: number | null = readCount(resource, "vmCount");
            const on: number | null = readCount(resource, "poweredOnVmCount");
            if (total === null) {
              return "-";
            }
            return on === null ? String(total) : `${on} / ${total}`;
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
