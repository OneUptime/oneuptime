import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import {
  InfrastructureResource,
  ResourceColumnTone,
  ResourceMetricThresholds,
  ResourceStatusReason,
} from "../Infrastructure/ResourceTable";
import { ResourcePartStatus } from "../ResourcePart/ResourcePartTypes";
import { ResourceAttentionText } from "../ResourcePart/ResourceAttention";
import {
  VMWARE_HOST_SATURATION_PERCENT,
  VMwareAssessment,
  assessVMwareClusterWithHosts,
  assessVMwareHost,
  assessVMwareResourcePool,
  assessVMwareVirtualMachine,
  findVMwareDatacenter,
  getVMwareClusterStatus,
  getVMwareHostState,
  getVMwareHostStatus,
  getVMwareVirtualMachineStatus,
  isVMwareHostRunning,
  isVMwareVirtualMachineDisconnected,
  toVMwareNumber,
} from "../../Pages/VMware/Utils/VMwareHealth";
import {
  VMwareClusterUsage,
  VMwareUsageTone,
  getVMwareClusterUsage,
  getVMwareCpuReadyPercentTone,
  getVMwareDatastoreFullTone,
} from "../../Pages/VMware/Utils/VMwarePartFacts";
import { toInfrastructureResource } from "../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * A row of a VMware list - the ESXi hosts, the virtual machines, the
 * clusters, the datastores, the resource pools - as VMwareHealth judges it:
 * its status in vCenter's words, coloured by what needs attention on it,
 * with the reason under it ("CPU at 94%"), so a list says what the
 * Overview's Needs attention says about the same part.
 *
 * The rules for some parts read others: a host's state reads its
 * datacenter's counts, a cluster's its hosts. A list hands in the rows it
 * has (VMwareListContext); a part whose context is missing is judged on
 * its own row alone.
 */

export interface VMwareListContext {
  datacenters: Array<VMwareResource>;
  hosts: Array<VMwareResource>;
  now: Date;
}

// The lines a host's and a VM's CPU and memory bars change colour at.
export const VMWARE_USAGE_BAR_THRESHOLDS: ResourceMetricThresholds = {
  warning: VMWARE_HOST_SATURATION_PERCENT,
};

function toReasons(
  reasons: Array<ResourceAttentionText>,
): Array<ResourceStatusReason> {
  return reasons.map((reason: ResourceAttentionText): ResourceStatusReason => {
    return {
      text: reason.text,
      values: reason.values,
      plural: reason.plural,
    };
  });
}

function withStatus(
  resource: InfrastructureResource,
  status: ResourcePartStatus,
  assessment: VMwareAssessment | null,
): InfrastructureResource {
  return {
    ...resource,
    // English, for the Status filter and the sort.
    status: status.label,
    statusText: { text: status.label, values: status.values },
    statusTone: status.tone,
    statusReasons: assessment ? toReasons(assessment.reasons) : [],
  };
}

export function toVMwareListResource(
  row: VMwareResource,
  context: VMwareListContext,
): InfrastructureResource {
  const resource: InfrastructureResource = toInfrastructureResource(row);

  switch (row.kind) {
    case VMwareResourceKind.Host: {
      const datacenter: VMwareResource | null = findVMwareDatacenter(
        context.datacenters,
        row.datacenterName,
      );
      const state: ReturnType<typeof getVMwareHostState> = getVMwareHostState({
        host: row,
        datacenter: datacenter,
        now: context.now,
      });
      /*
       * A host that is not running reports 0% CPU and no memory: drawn as
       * no reading, never as an idle host. Its status says what it is ("Not
       * responding"), with no reason under it to say the same again; a
       * running host's reason says what on it is busy ("CPU at 94%").
       */
      const isRunning: boolean = isVMwareHostRunning(state);
      const shown: InfrastructureResource = isRunning
        ? resource
        : { ...resource, cpuUtilization: null, memoryUsageBytes: null };
      return withStatus(
        shown,
        getVMwareHostStatus({
          host: row,
          datacenter: datacenter,
          now: context.now,
        }),
        isRunning
          ? assessVMwareHost({
              host: row,
              datacenter: datacenter,
              now: context.now,
            })
          : null,
      );
    }
    case VMwareResourceKind.VirtualMachine: {
      /*
       * On a host vCenter cannot reach, its 0% CPU and memory are no
       * reading: drawn as none, as its host's are.
       */
      const vmContext: {
        vm: VMwareResource;
        now: Date;
        hosts: Array<VMwareResource>;
        datacenters: Array<VMwareResource>;
      } = {
        vm: row,
        now: context.now,
        hosts: context.hosts,
        datacenters: context.datacenters,
      };
      const shown: InfrastructureResource = isVMwareVirtualMachineDisconnected(
        vmContext,
      )
        ? {
            ...resource,
            cpuUtilization: null,
            memoryUsageBytes: null,
            // Its CPU Ready too: "0.0%" read as a VM that never waits.
            additionalAttributes: {
              ...resource.additionalAttributes,
              cpuReadinessPercent: "",
            },
          }
        : resource;
      return withStatus(
        shown,
        getVMwareVirtualMachineStatus(vmContext),
        assessVMwareVirtualMachine(vmContext),
      );
    }
    case VMwareResourceKind.Cluster: {
      /*
       * How much of what the cluster can give its VMs its running hosts use,
       * as the cluster's page says it: the CPU and Memory bars of its row.
       */
      const usage: VMwareClusterUsage = getVMwareClusterUsage({
        cluster: row,
        hosts: context.hosts,
        datacenters: context.datacenters,
        now: context.now,
      });
      return withStatus(
        {
          ...resource,
          cpuUtilization: usage.cpuPercent,
          memoryUsageBytes: usage.memoryUsedBytes,
          memoryLimitBytes: usage.memoryEffectiveBytes,
        },
        getVMwareClusterStatus({
          cluster: row,
          hosts: context.hosts,
          datacenters: context.datacenters,
          now: context.now,
        }),
        assessVMwareClusterWithHosts({
          cluster: row,
          hosts: context.hosts,
          datacenters: context.datacenters,
          now: context.now,
        }),
      );
    }
    case VMwareResourceKind.ResourcePool: {
      const assessment: VMwareAssessment = assessVMwareResourcePool({
        pool: row,
        now: context.now,
      });
      return {
        ...resource,
        statusReasons: toReasons(assessment.reasons),
      };
    }
    default:
      return resource;
  }
}

export function toVMwareListResources(
  rows: Array<VMwareResource>,
  context: VMwareListContext,
): Array<InfrastructureResource> {
  return rows.map((row: VMwareResource): InfrastructureResource => {
    return toVMwareListResource(row, context);
  });
}

// A datastore's Used cell: red past 90% full, amber past 80%, as its alerts.
export function getVMwareDatastoreUsedTone(
  resource: InfrastructureResource,
): ResourceColumnTone | undefined {
  const reported: number | null = toVMwareNumber(
    resource.additionalAttributes["diskPercent"],
  );
  const used: number | null = toVMwareNumber(
    resource.additionalAttributes["diskBytes"],
  );
  const total: number | null = toVMwareNumber(
    resource.additionalAttributes["maxDiskBytes"],
  );
  const percent: number | null =
    reported !== null
      ? reported
      : used !== null && total !== null && total > 0
        ? (used / total) * 100
        : null;
  const tone: VMwareUsageTone = getVMwareDatastoreFullTone(percent);
  return tone === "positive" ? undefined : tone;
}

// A VM's CPU Ready cell: amber past 10%, as its alert and Needs attention.
export function getVMwareCpuReadyTone(
  resource: InfrastructureResource,
): ResourceColumnTone | undefined {
  const ready: number | null = toVMwareNumber(
    resource.additionalAttributes["cpuReadinessPercent"],
  );
  return getVMwareCpuReadyPercentTone(ready) === "warning"
    ? "warning"
    : undefined;
}

// A cluster's Hosts cell: amber while some of its hosts are not effective.
export function getVMwareClusterHostsTone(
  resource: InfrastructureResource,
): ResourceColumnTone | undefined {
  const total: number | null = toVMwareNumber(
    resource.additionalAttributes["hostCount"],
  );
  const effective: number | null = toVMwareNumber(
    resource.additionalAttributes["effectiveHostCount"],
  );
  return total !== null && effective !== null && effective < total
    ? "warning"
    : undefined;
}

// A resource pool's Ballooned / Swapped cell: amber once the host swaps it.
export function getVMwareResourcePoolMemoryTone(
  resource: InfrastructureResource,
): ResourceColumnTone | undefined {
  const swapped: number | null = toVMwareNumber(
    resource.additionalAttributes["memorySwappedBytes"],
  );
  return swapped !== null && swapped > 0 ? "warning" : undefined;
}
