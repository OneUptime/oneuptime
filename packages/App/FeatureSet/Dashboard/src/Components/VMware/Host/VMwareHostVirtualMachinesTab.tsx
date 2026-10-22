import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import ResourceTable, {
  InfrastructureResource,
} from "../../Infrastructure/ResourceTable";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import {
  formatPercent,
  toInfrastructureResources,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * The virtual machines one ESXi host runs, with the vCenter's own Virtual
 * Machines list's columns less Host and Cluster (the same for every row
 * here) and Power State (the Status column already says Running, Powered
 * off or Template). The rows are the ones the host's page already read for
 * its Overview, so the tab and the Overview's counts never disagree.
 */

export interface ComponentProps {
  rows: Array<VMwareResourceModel>;
  isLoading: boolean;
  getVirtualMachineRoute: (externalId: string) => Route;
  onRefreshClick: () => void;
}

const VMwareHostVirtualMachinesTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resources: Array<InfrastructureResource> = toInfrastructureResources(
    props.rows,
  );

  return (
    <ResourceTable
      onRefreshClick={props.onRefreshClick}
      isLoading={props.isLoading}
      title="Virtual Machines"
      description="The virtual machines (and VM templates) on this host, with their current resource usage. CPU is reported only for powered-on VMs."
      resources={resources}
      showGroupColumn={false}
      tableIdPrefix="vmware-host"
      emptyMessage="This host runs no virtual machines."
      builtInColumnDescriptions={{
        status: VMWARE_METRIC_DESCRIPTIONS.vmListStatus,
        cpu: VMWARE_METRIC_DESCRIPTIONS.vmListCpu,
        memory: VMWARE_METRIC_DESCRIPTIONS.vmListMemory,
        age: VMWARE_METRIC_DESCRIPTIONS.vmListAge,
      }}
      columns={[
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
          title: "CPU Ready",
          key: "cpuReadinessPercent",
          description: VMWARE_METRIC_DESCRIPTIONS.vmListCpuReady,
          getValue: (resource: InfrastructureResource): string => {
            const raw: string =
              resource.additionalAttributes["cpuReadinessPercent"] || "";
            return raw ? formatPercent(Number(raw)) : "-";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource): Route => {
        return props.getVirtualMachineRoute(
          resource.additionalAttributes["externalId"] || "",
        );
      }}
    />
  );
};

export default VMwareHostVirtualMachinesTab;
