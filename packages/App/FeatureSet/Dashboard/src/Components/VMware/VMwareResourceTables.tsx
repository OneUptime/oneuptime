import React, { FunctionComponent, ReactElement } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
} from "../Infrastructure/ResourceTable";
import { VMWARE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/VMwareMetricDescriptions";
import {
  formatBytes,
  formatMhz,
  formatPercent,
} from "../../Pages/VMware/Utils/VMwareResourceUtils";
import {
  VMWARE_USAGE_BAR_THRESHOLDS,
  VMwareListContext,
  getVMwareCpuReadyTone,
  toVMwareListResources,
} from "./VMwareResourceColumns";
import { isVMwareRootResourcePool } from "../../Pages/VMware/Utils/VMwarePartFacts";

/*
 * The ESXi hosts and the virtual machines of a vCenter as a table - on its
 * Hosts and Virtual Machines pages, on a cluster's page and on a host's -
 * so a host or a VM reads the same in every list: its status in vCenter's
 * words with why it needs a look under it (VMwareResourceColumns), and the
 * columns that are not the same on every row of that list. A host's or a
 * VM's CPU and memory turn amber past 90%, as their alerts and Needs
 * attention do, never red.
 *
 * Beside the side menu on a laptop the rows do not fit every column: where
 * a part sits (its datacenter, cluster, host and pool) moves under its name
 * and a host's CPU capacity under its CPU bar, so its state and how busy it
 * is stay in sight without scrolling sideways (ResourceColumn.foldInto).
 *
 * vCenter reports no uptime or creation time, so neither table has an Age
 * column of dashes.
 */

// Which list the table is: a vCenter's whole list, or one cluster's or host's.
export type VMwareTableScope = "vcenter" | "cluster" | "host";

export interface HostsTableProps {
  rows: Array<VMwareResource>;
  context: VMwareListContext;
  scope: VMwareTableScope;
  getViewRoute: (externalId: string) => Route | undefined;
  onRefreshClick?: (() => void) | undefined;
  isLoading?: boolean | undefined;
  description?: string | undefined;
}

export const VMwareHostsTable: FunctionComponent<HostsTableProps> = (
  props: HostsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // A host in no cluster, in the reader's words (a cell draws its value as given).
  const standalone: string =
    translator.translateText("Standalone") || "Standalone";
  const resources: Array<InfrastructureResource> = toVMwareListResources(
    props.rows,
    props.context,
  );

  const columns: Array<ResourceColumn> = [];
  if (props.scope === "vcenter") {
    columns.push({
      title: "Cluster",
      key: "clusterName",
      foldInto: "name",
      getValue: (resource: InfrastructureResource): string => {
        return resource.additionalAttributes["clusterName"] || standalone;
      },
    });
  }
  columns.push({
    title: "CPU Capacity",
    key: "cpuCapacityMhz",
    description: VMWARE_METRIC_DESCRIPTIONS.hostListCpuCapacity,
    foldInto: "cpuUtilization",
    showTitleWhenFolded: true,
    getValue: (resource: InfrastructureResource): string => {
      const raw: string = resource.additionalAttributes["cpuCapacityMhz"] || "";
      return raw ? formatMhz(Number(raw)) : "N/A";
    },
  });

  return (
    <ResourceTable
      onRefreshClick={props.onRefreshClick}
      isLoading={props.isLoading}
      title="Hosts"
      description={
        props.description ||
        "ESXi hosts managed by this vCenter, whether vCenter can reach each one, and how busy it is."
      }
      resources={resources}
      showGroupColumn={props.scope === "vcenter"}
      groupColumnTitle="Datacenter"
      groupColumnFoldInto="name"
      showAge={false}
      formatMemory={formatBytes}
      tableIdPrefix={props.scope === "vcenter" ? "vmware" : "vmware-cluster"}
      emptyMessage="No ESXi hosts reported yet. Make sure the VMware agent is sending metrics and that its read-only user can see the hosts."
      builtInColumnDescriptions={{
        status: VMWARE_METRIC_DESCRIPTIONS.hostListStatus,
        cpu: VMWARE_METRIC_DESCRIPTIONS.hostListCpu,
        memory: VMWARE_METRIC_DESCRIPTIONS.hostListMemory,
      }}
      metricThresholds={{
        cpu: VMWARE_USAGE_BAR_THRESHOLDS,
        memory: VMWARE_USAGE_BAR_THRESHOLDS,
      }}
      columns={columns}
      getViewRoute={(resource: InfrastructureResource): Route => {
        return (
          props.getViewRoute(
            resource.additionalAttributes["externalId"] || "",
          ) || new Route("")
        );
      }}
    />
  );
};

export interface VirtualMachinesTableProps {
  rows: Array<VMwareResource>;
  context: VMwareListContext;
  scope: VMwareTableScope;
  getViewRoute: (externalId: string) => Route | undefined;
  onRefreshClick?: (() => void) | undefined;
  isLoading?: boolean | undefined;
  description?: string | undefined;
  emptyMessage?: string | undefined;
}

export const VMwareVirtualMachinesTable: FunctionComponent<
  VirtualMachinesTableProps
> = (props: VirtualMachinesTableProps): ReactElement => {
  const resources: Array<InfrastructureResource> = toVMwareListResources(
    props.rows,
    props.context,
  );

  const columns: Array<ResourceColumn> = [];
  if (props.scope === "vcenter") {
    columns.push({
      title: "Cluster",
      key: "clusterName",
      foldInto: "name",
      getValue: (resource: InfrastructureResource): string => {
        return resource.additionalAttributes["clusterName"] || "-";
      },
    });
  }
  columns.push(
    {
      /*
       * The pool or vApp the VM runs in. A VM in its cluster's (or host's)
       * root pool, which vSphere names "Resources" and never shows, is in no
       * pool of anyone's making: a quiet dash, and no line under its name.
       */
      title: "Resource Pool",
      key: "resourcePoolName",
      foldInto: "name",
      getValue: (resource: InfrastructureResource): string => {
        const poolName: string =
          resource.additionalAttributes["resourcePoolName"] || "";
        if (
          poolName &&
          !isVMwareRootResourcePool({
            name: poolName,
            path: resource.additionalAttributes["resourcePoolPath"],
          })
        ) {
          return poolName;
        }
        return resource.additionalAttributes["virtualAppName"] || "-";
      },
    },
    {
      /*
       * vcenter.vm.cpu.readiness - the share of time the VM was ready to
       * run but waited for a physical CPU: the best single sign of a host
       * short of CPU, amber past 10%.
       */
      title: "CPU Ready",
      key: "cpuReadinessPercent",
      description: VMWARE_METRIC_DESCRIPTIONS.vmListCpuReady,
      getValue: (resource: InfrastructureResource): string => {
        const raw: string =
          resource.additionalAttributes["cpuReadinessPercent"] || "";
        return raw ? formatPercent(Number(raw)) : "-";
      },
      getTone: getVMwareCpuReadyTone,
    },
  );

  return (
    <ResourceTable
      onRefreshClick={props.onRefreshClick}
      isLoading={props.isLoading}
      title="Virtual Machines"
      description={
        props.description ||
        "Virtual machines (and VM templates) in this vCenter, their state, and their current resource usage. CPU is reported only for powered-on VMs."
      }
      resources={resources}
      showGroupColumn={props.scope !== "host"}
      groupColumnTitle="Host"
      groupColumnFoldInto="name"
      showAge={false}
      formatMemory={formatBytes}
      tableIdPrefix={
        props.scope === "vcenter"
          ? "vmware"
          : props.scope === "cluster"
            ? "vmware-cluster"
            : "vmware-host"
      }
      emptyMessage={
        props.emptyMessage ||
        "No virtual machines reported yet. Make sure the VMware agent is sending metrics and that its read-only role is propagated to child objects."
      }
      builtInColumnDescriptions={{
        status: VMWARE_METRIC_DESCRIPTIONS.vmListStatus,
        cpu: VMWARE_METRIC_DESCRIPTIONS.vmListCpu,
        memory: VMWARE_METRIC_DESCRIPTIONS.vmListMemory,
      }}
      metricThresholds={{
        cpu: VMWARE_USAGE_BAR_THRESHOLDS,
        memory: VMWARE_USAGE_BAR_THRESHOLDS,
      }}
      columns={columns}
      getViewRoute={(resource: InfrastructureResource): Route => {
        return (
          props.getViewRoute(
            resource.additionalAttributes["externalId"] || "",
          ) || new Route("")
        );
      }}
    />
  );
};
