import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareVirtualMachinesTable } from "../VMwareResourceTables";

/*
 * The virtual machines one ESXi host runs, as every VMware list draws a VM
 * (VMwareVirtualMachinesTable): its state coloured by what needs attention
 * on it, with why under it, less the Host and Cluster columns (the same for
 * every row here). The rows are the ones the host's page already read for
 * its Overview, so the tab and the Overview's counts never disagree. While
 * vCenter cannot reach the host, its VMs read Disconnected (the host's row
 * and its datacenter's say so).
 */

export interface ComponentProps {
  rows: Array<VMwareResourceModel>;
  hostRow: VMwareResourceModel | null;
  datacenterRow: VMwareResourceModel | null;
  isLoading: boolean;
  // Why the host's rows could not be read: said in the table, with Refresh.
  error?: string | undefined;
  getVirtualMachineRoute: (externalId: string) => Route;
  onRefreshClick: () => void;
}

const VMwareHostVirtualMachinesTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <VMwareVirtualMachinesTable
      rows={props.rows}
      context={{
        datacenters: props.datacenterRow ? [props.datacenterRow] : [],
        hosts: props.hostRow ? [props.hostRow] : [],
        now: OneUptimeDate.getCurrentDate(),
      }}
      scope="host"
      isLoading={props.isLoading}
      error={props.error}
      onRefreshClick={props.onRefreshClick}
      description="The virtual machines (and VM templates) on this host, their state, and their current resource usage. CPU is reported only for powered-on VMs."
      emptyMessage="This host runs no virtual machines."
      getViewRoute={props.getVirtualMachineRoute}
    />
  );
};

export default VMwareHostVirtualMachinesTab;
