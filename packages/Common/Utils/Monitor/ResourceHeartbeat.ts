import Dictionary from "../../Types/Dictionary";
import MonitorStep, { MonitorStepType } from "../../Types/Monitor/MonitorStep";

/*
 * What a resource always sends while it reports, and the attributes that
 * narrow it to the resource a monitor step watches: the series the resource's
 * Stopped Reporting template counts, scoped by the same identity every query
 * of that monitor is read with. Not by a monitor's narrower filters (one
 * namespace, one host of a vCenter): the heartbeat may not carry those.
 *
 * A row of it in a window says the resource answered its collector in that
 * window. It has to be this series, not anything at all from the resource: a
 * collector goes on reporting about itself after what it reads has stopped
 * answering. The prometheus receiver writes `up` and `scrape_*` for a failed
 * scrape, with the resource's attributes, and a Ceph agent gets `up` = 1 from
 * every standby mgr while no mgr serves any metric.
 *
 * A storage array names both of Pure's series, so that a monitor whose
 * platform is not known reads the right one; its array name tells the arrays
 * apart. IoT has none: a fleet sends nothing of its own, only its devices do.
 *
 * InfrastructureStoppedReportingTemplates.test.ts holds these to the templates,
 * and MonitorTelemetryMonitorResourceStillReporting.test.ts to the scope the
 * worker reads each monitor type's queries with.
 */
export interface ResourceHeartbeat {
  metricNames: Array<string>;
  attributes: Dictionary<string>;
}

export default class ResourceHeartbeatUtil {
  public static getForMonitorStep(
    monitorStep: MonitorStep | undefined,
  ): ResourceHeartbeat | null {
    const data: MonitorStepType | undefined = monitorStep?.data;

    if (!data) {
      return null;
    }

    if (data.hostMonitor) {
      return {
        metricNames: ["system.memory.usage"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.host.name",
          data.hostMonitor.hostIdentifier,
        ),
      };
    }

    if (data.kubernetesMonitor) {
      return {
        metricNames: ["k8s.node.condition_ready"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.k8s.cluster.name",
          data.kubernetesMonitor.clusterIdentifier,
        ),
      };
    }

    if (data.dockerMonitor) {
      return {
        metricNames: ["container.memory.percent"],
        attributes: {
          ...ResourceHeartbeatUtil.scopedTo(
            "resource.host.name",
            data.dockerMonitor.hostIdentifier,
          ),
          "resource.container.runtime": "docker",
        },
      };
    }

    if (data.podmanMonitor) {
      return {
        metricNames: ["container.memory.percent"],
        attributes: {
          ...ResourceHeartbeatUtil.scopedTo(
            "resource.host.name",
            data.podmanMonitor.hostIdentifier,
          ),
          "resource.container.runtime": "podman",
        },
      };
    }

    if (data.dockerSwarmMonitor) {
      return {
        metricNames: ["container.memory.percent"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.docker.swarm.cluster.name",
          data.dockerSwarmMonitor.clusterIdentifier,
        ),
      };
    }

    if (data.proxmoxMonitor) {
      return {
        metricNames: ["pve_up"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.proxmox.cluster.name",
          data.proxmoxMonitor.clusterIdentifier,
        ),
      };
    }

    if (data.vmwareMonitor) {
      return {
        metricNames: ["vcenter.datacenter.cpu.limit"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.vmware.vcenter.name",
          data.vmwareMonitor.vcenterIdentifier,
        ),
      };
    }

    if (data.cephMonitor) {
      return {
        metricNames: ["ceph_health_status"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.ceph.cluster.name",
          data.cephMonitor.clusterIdentifier,
        ),
      };
    }

    if (data.storageArrayMonitor) {
      return {
        metricNames: ["purefa_info", "purefb_info"],
        attributes: ResourceHeartbeatUtil.scopedTo(
          "resource.storage.array.name",
          data.storageArrayMonitor.arrayIdentifier,
        ),
      };
    }

    return null;
  }

  /*
   * A step without an identifier reads every resource of the project, as its
   * queries do, so its heartbeat is any of theirs.
   */
  private static scopedTo(
    attributeKey: string,
    identifier: string | undefined,
  ): Dictionary<string> {
    return identifier ? { [attributeKey]: identifier } : {};
  }
}
