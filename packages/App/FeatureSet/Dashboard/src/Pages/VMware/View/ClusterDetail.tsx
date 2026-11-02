import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import Route from "Common/Types/API/Route";
import {
  VMwareResourceKind,
  externalIdFromRouteParam,
  fetchVMwareInventoryRow,
  fetchVMwareInventoryRows,
  fetchVMwareVirtualMachinesThatMayNeedAttention,
  formatBytes,
  formatMhz,
  displayNameForResource,
  identityAttributesForResource,
} from "../Utils/VMwareResourceUtils";
import OneUptimeDate from "Common/Types/Date";
import ValueFormatter from "Common/Utils/ValueFormatter";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  VMWARE_CPU_READY_WARNING_PERCENT,
  getVMwareHostsOfCluster,
} from "../Utils/VMwareHealth";
import { summarizeVMwareHostVirtualMachines } from "../Utils/VMwareHostData";
import VMwarePartHero from "../../../Components/VMware/Part/VMwarePartHero";
import VMwareClusterOverview from "../../../Components/VMware/Part/VMwareClusterOverview";
import {
  VMwarePartRoutes,
  getVMwarePartRoutes,
} from "../../../Components/VMware/Part/VMwarePartRoutes";
import {
  VMwareHostsTable,
  VMwareVirtualMachinesTable,
} from "../../../Components/VMware/VMwareResourceTables";

export const VMWARE_CLUSTER_TAB_OVERVIEW: string = "Overview";
export const VMWARE_CLUSTER_TAB_HOSTS: string = "ESXi Hosts";
export const VMWARE_CLUSTER_TAB_VIRTUAL_MACHINES: string = "Virtual Machines";
export const VMWARE_CLUSTER_TAB_METRICS: string = "Metrics";

const VMwareVCenterClusterDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // The charts draw their titles and legends as given: hand them the reader's words.
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  /*
   * Route shape: .../vmware/:modelId/clusters/:subModelId — subModelId
   * is the percent-encoded inventory externalId
   * ("cluster/<dc>/<cluster>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [row, setRow] = useState<VMwareResourceModel | null>(null);
  // Its hosts, the vCenter's datacenters and the VMs in it that may need a look.
  const [hostRows, setHostRows] = useState<Array<VMwareResourceModel>>([]);
  const [datacenterRows, setDatacenterRows] = useState<
    Array<VMwareResourceModel>
  >([]);
  const [attentionVmRows, setAttentionVmRows] = useState<
    Array<VMwareResourceModel>
  >([]);
  /*
   * The cluster's VMs, read when its Virtual Machines tab first opens: a
   * cluster can run thousands, and the Overview needs only the ones that
   * may need attention.
   */
  const [vmRows, setVmRows] = useState<Array<VMwareResourceModel> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // "View all hosts" opens the hosts tab: Tabs keeps its own selection.
  const [tabsKey, setTabsKey] = useState<number>(0);
  const [initialTabName, setInitialTabName] = useState<string>(
    VMWARE_CLUSTER_TAB_OVERVIEW,
  );

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
        },
      });
      setVCenter(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    try {
      const inventoryRow: VMwareResourceModel | null =
        await fetchVMwareInventoryRow({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Cluster,
          externalId: externalId,
        });
      const name: string = inventoryRow
        ? inventoryRow.clusterName || displayNameForResource(inventoryRow)
        : externalId.substring(externalId.lastIndexOf("/") + 1);
      const datacenterName: string | undefined =
        inventoryRow?.datacenterName || undefined;

      const [hosts, datacenters, attentionVms]: [
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
      ] = await Promise.all([
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Host,
          clusterName: name,
          datacenterName: datacenterName,
        }),
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datacenter,
        }),
        fetchVMwareVirtualMachinesThatMayNeedAttention({
          vmwareVCenterId: modelId,
          now: OneUptimeDate.getCurrentDate(),
          clusterName: name,
          datacenterName: datacenterName,
          cpuReadyWarningPercent: VMWARE_CPU_READY_WARNING_PERCENT,
        }),
      ]);
      setRow(inventoryRow);
      setHostRows(hosts);
      setDatacenterRows(datacenters);
      setAttentionVmRows(attentionVms);
    } catch {
      // Graceful degradation — overview tab shows its empty state.
    }
    setIsLoadingRow(false);
  };

  const fetchVirtualMachines: () => Promise<void> =
    async (): Promise<void> => {
      if (!row) {
        setVmRows([]);
        return;
      }
      try {
        setVmRows(
          await fetchVMwareInventoryRows({
            vmwareVCenterId: modelId,
            kind: VMwareResourceKind.VirtualMachine,
            clusterName: row.clusterName || displayNameForResource(row),
            datacenterName: row.datacenterName || undefined,
          }),
        );
      } catch {
        setVmRows([]);
      }
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

  if (!vcenter?.name) {
    return <ErrorMessage message="vCenter not found." />;
  }

  const vcenterName: string = vcenter.name;
  const clusterName: string = row
    ? displayNameForResource(row)
    : externalId.substring(externalId.lastIndexOf("/") + 1);

  /*
   * Cluster-level series (vcenter.cluster.*) live on the cluster's own
   * resource; the per-host series (vcenter.host.*) of its members carry
   * the same resource.vcenter.cluster.name, so the SAME filter — with
   * a host metric name — yields one line per member host.
   */
  const idAttributes: Record<string, string> = row
    ? identityAttributesForResource(vcenterName, row)
    : {
        "resource.vmware.vcenter.name": vcenterName,
        "resource.vcenter.cluster.name": clusterName,
      };

  const hostCountQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_hosts",
      title: tx("Hosts (effective vs. not effective)"),
      description: translator.translateTemplate(
        "Hosts in this cluster, split into effective and not effective. A host in maintenance mode or disconnected is not effective.",
      ),
      legend: tx("Hosts"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.host.count",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const vmCountQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vms",
      title: tx("Virtual Machines by Power State"),
      description: translator.translateTemplate(
        "Virtual machines in this cluster, split by power state.",
      ),
      legend: tx("VMs"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vm.count",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memberHostCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_host_cpu",
      title: tx("Member Host CPU Utilization"),
      description: translator.translateTemplate(
        "CPU in use on each host in this cluster, as a percentage, one line per host.",
      ),
      legend: tx("CPU"),
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.cpu.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memberHostMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_host_memory",
      title: tx("Member Host Memory Utilization"),
      description: translator.translateTemplate(
        "Memory in use on each host in this cluster, as a percentage, one line per host.",
      ),
      legend: tx("Memory"),
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.host.memory.utilization",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const effectiveCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_cpu_effective",
      title: tx("Effective CPU"),
      description: translator.translateTemplate(
        "The CPU capacity this cluster can run virtual machines on, leaving out hosts in maintenance mode.",
      ),
      legend: tx("Effective CPU"),
      legendUnit: "MHz",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.cpu.effective",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatMhz,
  };

  const effectiveMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_memory_effective",
      title: tx("Effective Memory"),
      description: translator.translateTemplate(
        "The memory capacity this cluster can run virtual machines on, leaving out hosts in maintenance mode.",
      ),
      legend: tx("Effective Memory"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.memory.effective",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: formatBytes,
  };

  /*
   * vSAN series only exist on clusters with vSAN enabled — the charts
   * stay empty elsewhere, which is the honest state.
   */
  const vsanLatencyQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_latency",
      title: tx("vSAN Latency (avg)"),
      description: translator.translateTemplate(
        "Average vSAN latency for each kind of operation. Empty unless vSAN is turned on for this cluster.",
      ),
      legend: tx("Latency"),
      legendUnit: "µs",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.latency.avg",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const vsanThroughputQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_throughput",
      title: tx("vSAN Throughput"),
      description: translator.translateTemplate(
        "How much data vSAN moves per second, for each kind of operation.",
      ),
      legend: tx("Throughput"),
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.throughput",
        attributes: idAttributes,
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: (value: number): string => {
      return ValueFormatter.formatValue(value, "By/s");
    },
  };

  const vsanCongestionQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "cluster_vsan_congestions",
      title: tx("vSAN Congestions"),
      description: translator.translateTemplate(
        "vSAN congestion in this cluster. Anything above zero means vSAN is slowing down reads and writes.",
      ),
      legend: tx("Congestions"),
      legendUnit: "/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "vcenter.cluster.vsan.congestions",
        attributes: idAttributes,
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const now: Date = OneUptimeDate.getCurrentDate();
  const routes: VMwarePartRoutes = getVMwarePartRoutes(modelId);
  const clusterHosts: Array<VMwareResourceModel> = row
    ? getVMwareHostsOfCluster(hostRows, row)
    : hostRows;
  // The cluster's VMs as vCenter counts them, templates left out.
  const virtualMachineCount: number | undefined =
    vmRows !== null
      ? summarizeVMwareHostVirtualMachines(vmRows).total
      : row?.vmCount !== null && row?.vmCount !== undefined
        ? Number(row.vmCount)
        : undefined;

  const showHosts: () => void = (): void => {
    setInitialTabName(VMWARE_CLUSTER_TAB_HOSTS);
    setTabsKey((key: number): number => {
      return key + 1;
    });
  };

  const tabs: Array<Tab> = [
    {
      name: VMWARE_CLUSTER_TAB_OVERVIEW,
      children: isLoadingRow ? (
        <PageLoader isVisible={true} />
      ) : (
        <VMwareClusterOverview
          vcenterId={modelId}
          vcenterName={vcenterName}
          externalId={externalId}
          row={row}
          hosts={clusterHosts}
          attentionVirtualMachines={attentionVmRows}
          datacenters={datacenterRows}
          routes={routes}
          onShowHosts={showHosts}
          now={now}
        />
      ),
    },
    {
      name: VMWARE_CLUSTER_TAB_HOSTS,
      countBadge: clusterHosts.length,
      children: (
        <VMwareHostsTable
          rows={clusterHosts}
          context={{
            datacenters: datacenterRows,
            hosts: clusterHosts,
            now: now,
          }}
          scope="cluster"
          isLoading={isLoadingRow}
          description="The ESXi hosts of this cluster, whether vCenter can reach each one, and how busy it is."
          getViewRoute={(hostExternalId: string) => {
            return routes.getPartRoute(VMwareResourceKind.Host, hostExternalId);
          }}
        />
      ),
    },
    {
      name: VMWARE_CLUSTER_TAB_VIRTUAL_MACHINES,
      countBadge: virtualMachineCount,
      children: (
        <ClusterVirtualMachinesTab
          rows={vmRows}
          hosts={clusterHosts}
          datacenters={datacenterRows}
          onOpen={() => {
            if (vmRows === null) {
              fetchVirtualMachines().catch(() => {});
            }
          }}
          onRefresh={() => {
            fetchVirtualMachines().catch(() => {});
          }}
          getViewRoute={(vmExternalId: string) => {
            return routes.getPartRoute(
              VMwareResourceKind.VirtualMachine,
              vmExternalId,
            );
          }}
          now={now}
        />
      ),
    },
    {
      name: VMWARE_CLUSTER_TAB_METRICS,
      children: (
        <Card
          title={translator.translateTemplate(
            "Cluster Metrics: {{clusterName}}",
            { clusterName: clusterName },
          )}
          description="Host and VM counts, member-host CPU and memory, effective capacity and vSAN health for this cluster over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={[
              hostCountQuery,
              vmCountQuery,
              memberHostCpuQuery,
              memberHostMemoryQuery,
              effectiveCpuQuery,
              effectiveMemoryQuery,
              vsanLatencyQuery,
              vsanThroughputQuery,
              vsanCongestionQuery,
            ]}
          />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="vmware-cluster-page">
      <VMwarePartHero
        kind={VMwareResourceKind.Cluster}
        row={isLoadingRow ? null : row}
        externalId={externalId}
        datacenters={datacenterRows}
        hosts={clusterHosts}
        now={now}
      />
      <Tabs
        key={tabsKey}
        tabs={tabs}
        initialTabName={initialTabName}
        wrap={true}
        onTabChange={() => {}}
      />
    </div>
  );
};

/*
 * The cluster's VMs, read the first time the tab opens (its children mount
 * only then), and on Refresh.
 */
const ClusterVirtualMachinesTab: FunctionComponent<{
  rows: Array<VMwareResourceModel> | null;
  // The cluster's hosts and the datacenters: what tells a disconnected VM.
  hosts: Array<VMwareResourceModel>;
  datacenters: Array<VMwareResourceModel>;
  onOpen: () => void;
  onRefresh: () => void;
  getViewRoute: (externalId: string) => Route | undefined;
  now: Date;
}> = (props: {
  rows: Array<VMwareResourceModel> | null;
  hosts: Array<VMwareResourceModel>;
  datacenters: Array<VMwareResourceModel>;
  onOpen: () => void;
  onRefresh: () => void;
  getViewRoute: (externalId: string) => Route | undefined;
  now: Date;
}): ReactElement => {
  useEffect(() => {
    props.onOpen();
  }, []);

  return (
    <VMwareVirtualMachinesTable
      rows={props.rows || []}
      context={{
        datacenters: props.datacenters,
        hosts: props.hosts,
        now: props.now,
      }}
      scope="cluster"
      isLoading={props.rows === null}
      onRefreshClick={props.onRefresh}
      description="The virtual machines (and VM templates) in this cluster, their state, and their current resource usage. CPU is reported only for powered-on VMs."
      emptyMessage="This cluster runs no virtual machines."
      getViewRoute={props.getViewRoute}
    />
  );
};

export default VMwareVCenterClusterDetail;
