import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  VMwareListRouteFor,
  VMwareRouteFor,
  getVMwareAttentionItems,
  getVMwareAttentionKey,
  isVMwareVirtualMachineDisconnected,
} from "./VMwareHealth";

/*
 * WHAT NEEDS ATTENTION ON AN ESXI HOST'S, A CLUSTER'S, A DATASTORE'S OR A
 * VIRTUAL MACHINE'S PAGE.
 *
 * One list per page, read once by the vCenter's one set of rules: its
 * Needs attention card draws it, and the hero's status opens it when it
 * says something is wrong ("Not responding", "Disconnected", "Powered
 * off"), so the two can never disagree (#9594). The part itself reads as
 * its card names it - "This host" - under the card's own words.
 *
 *   - a host: it and the VMs it runs, read beside its datacenter;
 *   - a cluster: it, its hosts and the VMs in it that may need attention,
 *     beside the vCenter's datacenters;
 *   - a datastore: it alone;
 *   - a VM: it alone - or, on a host vCenter cannot reach, it and that
 *     host, whose trouble it is.
 *
 * React-free, so App tests can read it.
 */

export type VMwarePartPageKind =
  | VMwareResourceKind.Host
  | VMwareResourceKind.Cluster
  | VMwareResourceKind.Datastore
  | VMwareResourceKind.VirtualMachine;

export const VMWARE_PART_ATTENTION_WORDS: Record<
  VMwarePartPageKind,
  { description: string; current: string }
> = {
  [VMwareResourceKind.Host]: {
    description: translationKey(
      "What about this host and the VMs it runs is broken or needs a look.",
    ),
    current: translationKey("This host"),
  },
  [VMwareResourceKind.Cluster]: {
    description: translationKey(
      "What in this cluster is broken or needs a look: the cluster, its hosts and the VMs on them.",
    ),
    current: translationKey("This cluster"),
  },
  [VMwareResourceKind.Datastore]: {
    description: translationKey(
      "What about this datastore is broken or needs a look.",
    ),
    current: translationKey("This datastore"),
  },
  [VMwareResourceKind.VirtualMachine]: {
    description: translationKey(
      "What about this virtual machine is broken or needs a look.",
    ),
    current: translationKey("This VM"),
  },
};

export function getVMwarePartAttention(data: {
  kind: VMwarePartPageKind;
  externalId: string;
  // The part's inventory row; null while it has not reported.
  row: VMwareResource | null;
  // A cluster's hosts, or the host a VM runs on.
  hosts?: Array<VMwareResource> | undefined;
  // A host's VMs, or the VMs in a cluster that may need attention.
  virtualMachines?: Array<VMwareResource> | undefined;
  // The vCenter's datacenters (a host's own, for a host).
  datacenters?: Array<VMwareResource> | undefined;
  now: Date;
  routeFor: VMwareRouteFor;
  listRouteFor?: VMwareListRouteFor | undefined;
}): ResourcePartAttention {
  const words: { description: string; current: string } =
    VMWARE_PART_ATTENTION_WORDS[data.kind];
  const attention: ResourcePartAttention = {
    items: [],
    description: words.description,
    current: {
      key: getVMwareAttentionKey(data.kind, data.externalId),
      label: words.current,
    },
  };

  const row: VMwareResource | null = data.row;
  if (!row) {
    return attention;
  }

  const hosts: Array<VMwareResource> = data.hosts || [];
  const virtualMachines: Array<VMwareResource> = data.virtualMachines || [];
  const datacenters: Array<VMwareResource> = data.datacenters || [];

  let rows: Array<VMwareResource> = [row];
  let contextRows: Array<VMwareResource> = [];

  if (data.kind === VMwareResourceKind.Host) {
    rows = [row, ...virtualMachines];
    contextRows = datacenters;
  } else if (data.kind === VMwareResourceKind.Cluster) {
    rows = [row, ...hosts, ...virtualMachines];
    contextRows = datacenters;
  } else if (data.kind === VMwareResourceKind.VirtualMachine) {
    /*
     * A disconnected VM's trouble is its host's: the list holds the host
     * vCenter cannot reach, one step from its page.
     */
    const isDisconnected: boolean = isVMwareVirtualMachineDisconnected({
      vm: row,
      hosts: hosts,
      datacenters: datacenters,
      now: data.now,
    });
    rows = isDisconnected ? [row, ...hosts] : [row];
    contextRows = [...(isDisconnected ? [] : hosts), ...datacenters];
  }

  attention.items = getVMwareAttentionItems({
    rows: rows,
    contextRows: contextRows,
    now: data.now,
    routeFor: data.routeFor,
    listRouteFor: data.listRouteFor,
  });

  return attention;
}
