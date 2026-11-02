import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import {
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import {
  findVMwareDatacenter,
  getVMwareClusterStatus,
  getVMwareDatastoreStatus,
  getVMwareDisplayName,
  getVMwareHostStatus,
  getVMwareVirtualMachineStatus,
  toVMwareDate,
  toVMwareNumber,
} from "../../../Pages/VMware/Utils/VMwareHealth";
import { VMwareHostVirtualMachineSummary } from "../../../Pages/VMware/Utils/VMwareHostData";
import { isVMwareRootResourcePool } from "../../../Pages/VMware/Utils/VMwarePartFacts";
import {
  formatBytes,
  formatMhz,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * The top of a vCenter part's page - an ESXi host, a virtual machine, a
 * datastore, a cluster - above its tabs: which part it is, its state in
 * vCenter's words and coloured by what needs attention on it (VMwareHealth),
 * where it sits (each place one step away), when vCenter last reported it,
 * and its size. The shared ResourcePartHero draws it, as every resource
 * product's parts open.
 */

export type VMwarePartHeroKind =
  | VMwareResourceKind.Host
  | VMwareResourceKind.VirtualMachine
  | VMwareResourceKind.Datastore
  | VMwareResourceKind.Cluster;

export interface ComponentProps {
  kind: VMwarePartHeroKind;
  // The part's inventory row; null while it has not reported, or once gone.
  row: VMwareResource | null;
  /*
   * Whether the row was read. While it loads, or when its read failed, the
   * hero says nothing of the part's state: "Not in inventory" there would
   * be a guess (the page says the read failed, with Try again).
   */
  isRowRead?: boolean | undefined;
  externalId: string;
  // The vCenter's datacenters and hosts: a host's state and a cluster's read them.
  datacenters: Array<VMwareResource>;
  hosts: Array<VMwareResource>;
  // The page of the cluster and of the host the part sits on, when it has one.
  clusterRoute?: Route | undefined;
  hostRoute?: Route | undefined;
  // A host's or a cluster's VMs, for its chip.
  virtualMachines?: VMwareHostVirtualMachineSummary | undefined;
  /*
   * The datacenter its address names, for a part whose row is gone: a host
   * no longer in the inventory still says where it was.
   */
  fallbackDatacenterName?: string | null | undefined;
  /*
   * Whether to say when vCenter last reported it. A host's page leaves it
   * to the notice under the hero while the host is not reporting, which
   * opens with that time: said once.
   */
  showLastReport?: boolean | undefined;
  now: Date;
}

const NOT_IN_INVENTORY: ResourcePartStatus = {
  label: translationKey("Not in inventory"),
  tone: "neutral",
  description: translationKey(
    "vCenter has not reported this for more than 15 minutes, so it left the inventory.",
  ),
};

const ICONS: Record<VMwarePartHeroKind, IconProp> = {
  [VMwareResourceKind.Host]: IconProp.ServerStack,
  [VMwareResourceKind.VirtualMachine]: IconProp.Cube,
  [VMwareResourceKind.Datastore]: IconProp.Database,
  [VMwareResourceKind.Cluster]: IconProp.SquareStack,
};

const TEST_IDS: Record<VMwarePartHeroKind, string> = {
  [VMwareResourceKind.Host]: "vmware-host-hero",
  [VMwareResourceKind.VirtualMachine]: "vmware-vm-hero",
  [VMwareResourceKind.Datastore]: "vmware-datastore-hero",
  [VMwareResourceKind.Cluster]: "vmware-cluster-hero",
};

const LINK_CLASS_NAME: string =
  "font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-indigo-600 hover:decoration-indigo-400";

// The part's name, from its row, or from its id once the row is gone.
export function getVMwarePartHeroName(
  kind: VMwarePartHeroKind,
  row: VMwareResource | null,
  externalId: string,
): string {
  const tail: string = externalId.substring(externalId.lastIndexOf("/") + 1);
  if (!row) {
    return tail;
  }
  if (kind === VMwareResourceKind.Host) {
    return row.hostName || row.name || tail;
  }
  if (kind === VMwareResourceKind.Cluster) {
    return row.clusterName || row.name || tail;
  }
  return getVMwareDisplayName(row) || tail;
}

export function getVMwarePartHeroStatus(data: {
  kind: VMwarePartHeroKind;
  row: VMwareResource | null;
  // False while the row loads or when its read failed: no status then.
  isRowRead?: boolean | undefined;
  datacenters: Array<VMwareResource>;
  hosts: Array<VMwareResource>;
  now: Date;
}): ResourcePartStatus | undefined {
  const row: VMwareResource | null = data.row;
  if (data.isRowRead === false) {
    return undefined;
  }
  if (!row) {
    return NOT_IN_INVENTORY;
  }
  switch (data.kind) {
    case VMwareResourceKind.Host:
      return getVMwareHostStatus({
        host: row,
        datacenter: findVMwareDatacenter(data.datacenters, row.datacenterName),
        now: data.now,
      });
    case VMwareResourceKind.VirtualMachine: {
      const status: ResourcePartStatus = getVMwareVirtualMachineStatus({
        vm: row,
        now: data.now,
        hosts: data.hosts,
        datacenters: data.datacenters,
      });
      return {
        ...status,
        // What a VM's state is read from: which VMs send CPU data.
        description: status.description || VMWARE_METRIC_DESCRIPTIONS.vmPowerState,
      };
    }
    case VMwareResourceKind.Datastore:
      return getVMwareDatastoreStatus({ datastore: row, now: data.now });
    default:
      return getVMwareClusterStatus({
        cluster: row,
        hosts: data.hosts,
        datacenters: data.datacenters,
        now: data.now,
      });
  }
}

const VMwarePartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: VMwareResource | null = props.row;
  const datacenter: string =
    row?.datacenterName || (row ? "" : props.fallbackDatacenterName || "");
  const cluster: string = row?.clusterName || "";
  const host: string = row?.hostName || "";

  const linkTo: (text: string, route: Route | undefined) => ReactNode = (
    text: string,
    route: Route | undefined,
  ): ReactNode => {
    return route ? (
      <Link to={route} className={LINK_CLASS_NAME}>
        {text}
      </Link>
    ) : (
      <span className="font-medium text-gray-700">{text}</span>
    );
  };

  let location: ReactNode = undefined;
  const chips: Array<ResourcePartChip> = [];

  const pushVirtualMachines: () => void = (): void => {
    /*
     * A host's VMs as its page read them; a cluster's as vCenter counts them
     * (vcenter.cluster.vm.count) when its page has not read them.
     */
    const counted: number | null = toVMwareNumber(row?.vmCount);
    const summary: { total: number; running: number } | undefined =
      props.virtualMachines ||
      (props.kind === VMwareResourceKind.Cluster && counted !== null
        ? {
            total: counted,
            running: toVMwareNumber(row?.poweredOnVmCount) ?? 0,
          }
        : undefined);
    if (summary && summary.total > 0) {
      chips.push({
        key: "vms",
        icon: IconProp.Cube,
        label: translator.translatePlural(
          {
            one: "{{poweredOn}}/{{count}} VM powered on",
            other: "{{poweredOn}}/{{count}} VMs powered on",
          },
          summary.total,
          // In the reader's digits, as the count beside it is.
          { poweredOn: translator.formatNumber(summary.running) },
        ),
      });
    }
  };

  const pushCapacity: (data: {
    cpuMhz: number | null;
    memoryBytes: number | null;
  }) => void = (data: {
    cpuMhz: number | null;
    memoryBytes: number | null;
  }): void => {
    if (data.cpuMhz !== null && data.cpuMhz > 0) {
      chips.push({
        key: "cpu",
        icon: IconProp.CPUChip,
        label: translator.translateTemplate("{{capacity}} CPU", {
          capacity: formatMhz(data.cpuMhz),
        }),
      });
    }
    if (data.memoryBytes !== null && data.memoryBytes > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{capacity}} memory", {
          capacity: formatBytes(data.memoryBytes),
        }),
      });
    }
  };

  if (props.kind === VMwareResourceKind.Host) {
    if (cluster) {
      location = datacenter ? (
        <TranslatedSentence
          template="ESXi host in cluster {{cluster}}, datacenter {{datacenter}}"
          slots={{ cluster: linkTo(cluster, props.clusterRoute) }}
          values={{ datacenter: datacenter }}
        />
      ) : (
        <TranslatedSentence
          template="ESXi host in cluster {{cluster}}"
          slots={{ cluster: linkTo(cluster, props.clusterRoute) }}
        />
      );
    } else if (datacenter && row) {
      location = translator.translateTemplate(
        "Standalone ESXi host in datacenter {{datacenter}}",
        { datacenter: datacenter },
      );
    } else if (datacenter) {
      location = translator.translateTemplate(
        "ESXi host in datacenter {{datacenter}}",
        { datacenter: datacenter },
      );
    } else {
      location = tx("ESXi host");
    }
    pushCapacity({
      cpuMhz: toVMwareNumber(row?.cpuCapacityMhz),
      memoryBytes: toVMwareNumber(row?.maxMemoryBytes),
    });
    pushVirtualMachines();
  } else if (props.kind === VMwareResourceKind.VirtualMachine) {
    if (host && cluster && datacenter) {
      location = (
        <TranslatedSentence
          template="On host {{host}} in cluster {{cluster}}, datacenter {{datacenter}}"
          slots={{
            host: linkTo(host, props.hostRoute),
            cluster: linkTo(cluster, props.clusterRoute),
          }}
          values={{ datacenter: datacenter }}
        />
      );
    } else if (host && datacenter) {
      location = (
        <TranslatedSentence
          template="On host {{host}} in datacenter {{datacenter}}"
          slots={{ host: linkTo(host, props.hostRoute) }}
          values={{ datacenter: datacenter }}
        />
      );
    } else if (host) {
      location = (
        <TranslatedSentence
          template="On host {{host}}"
          slots={{ host: linkTo(host, props.hostRoute) }}
        />
      );
    }
    const memory: number | null = toVMwareNumber(row?.maxMemoryBytes);
    if (memory !== null && memory > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{capacity}} memory", {
          capacity: formatBytes(memory),
        }),
      });
    }
    const provisioned: number | null = toVMwareNumber(row?.maxDiskBytes);
    if (provisioned !== null && provisioned > 0) {
      chips.push({
        key: "disk",
        icon: IconProp.Database,
        label: translator.translateTemplate("{{capacity}} provisioned", {
          capacity: formatBytes(provisioned),
        }),
      });
    }
    /*
     * The pool or vApp it runs in; not its cluster's root pool, which
     * vSphere names "Resources" and never shows.
     */
    const pool: string =
      row?.virtualAppName ||
      (row?.resourcePoolName &&
      !isVMwareRootResourcePool({
        name: row.resourcePoolName,
        path: row.resourcePoolPath,
      })
        ? row.resourcePoolName
        : "");
    if (pool) {
      chips.push({
        key: "pool",
        icon: IconProp.Layers,
        label: row?.virtualAppName
          ? translator.translateTemplate("vApp {{name}}", { name: pool })
          : translator.translateTemplate("Pool {{name}}", { name: pool }),
      });
    }
  } else if (props.kind === VMwareResourceKind.Datastore) {
    if (datacenter) {
      location = translator.translateTemplate(
        "Datastore in datacenter {{datacenter}}",
        { datacenter: datacenter },
      );
    }
    const capacity: number | null = toVMwareNumber(row?.maxDiskBytes);
    if (capacity !== null && capacity > 0) {
      chips.push({
        key: "capacity",
        icon: IconProp.Database,
        label: translator.translateTemplate("{{capacity}} capacity", {
          capacity: formatBytes(capacity),
        }),
      });
    }
  } else {
    if (datacenter) {
      location = translator.translateTemplate(
        "Cluster in datacenter {{datacenter}}",
        { datacenter: datacenter },
      );
    }
    const total: number | null = toVMwareNumber(row?.hostCount);
    const effective: number | null = toVMwareNumber(row?.effectiveHostCount);
    if (total !== null && total > 0) {
      chips.push({
        key: "hosts",
        icon: IconProp.ServerStack,
        label:
          effective !== null && effective < total
            ? translator.translatePlural(
                {
                  one: "{{effective}}/{{count}} ESXi host effective",
                  other: "{{effective}}/{{count}} ESXi hosts effective",
                },
                total,
                { effective: translator.formatNumber(effective) },
              )
            : translator.translatePlural(
                { one: "{{count}} ESXi host", other: "{{count}} ESXi hosts" },
                total,
              ),
      });
    }
    pushVirtualMachines();
    const templates: number | null = toVMwareNumber(row?.vmTemplateCount);
    if (templates !== null && templates > 0) {
      chips.push({
        key: "templates",
        icon: IconProp.DocumentDuplicate,
        label: translator.translatePlural(
          { one: "{{count}} template", other: "{{count}} templates" },
          templates,
        ),
      });
    }
    pushCapacity({
      cpuMhz: toVMwareNumber(row?.cpuCapacityMhz),
      memoryBytes: toVMwareNumber(row?.maxMemoryBytes),
    });
  }

  const lastReportAt: Date | null =
    props.showLastReport === false
      ? null
      : toVMwareDate(row?.metricsUpdatedAt) || toVMwareDate(row?.lastSeenAt);

  return (
    <ResourcePartHero
      testId={TEST_IDS[props.kind]}
      icon={ICONS[props.kind]}
      accent="sky"
      name={getVMwarePartHeroName(props.kind, row, props.externalId)}
      status={getVMwarePartHeroStatus({
        kind: props.kind,
        row: row,
        isRowRead: props.isRowRead,
        datacenters: props.datacenters,
        hosts: props.hosts,
        now: props.now,
      })}
      location={location}
      lastReportAt={lastReportAt}
      chips={chips}
    />
  );
};

export default VMwarePartHero;
