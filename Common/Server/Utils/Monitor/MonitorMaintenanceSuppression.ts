import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

/*
 * Ids and names of one resource type that are currently inside an
 * ongoing maintenance window. Ids are OneUptime database ids; names are
 * the resource's identifier column (hostIdentifier / clusterIdentifier /
 * service name). A series matches if it references the resource by
 * either form.
 */
export interface ResourceKeySet {
  ids: Set<string>;
  names: Set<string>;
}

export interface MaintainedResourceKeys {
  hosts: ResourceKeySet;
  dockerHosts: ResourceKeySet;
  podmanHosts: ResourceKeySet;
  kubernetesClusters: ResourceKeySet;
  /*
   * Proxmox/Ceph clusters have no `oneuptime.*.id` label stamp, so only
   * the name set is ever matched; the id set exists for shape parity.
   */
  proxmoxClusters: ResourceKeySet;
  cephClusters: ResourceKeySet;
  /*
   * IoT fleets, like Proxmox/Ceph clusters, have no `oneuptime.*.id`
   * label stamp, so only the name set is ever matched; the id set
   * exists for shape parity.
   */
  iotFleets: ResourceKeySet;
  services: ResourceKeySet;
}

/*
 * Per-series counterpart to the whole-monitor
 * `disableActiveMonitoringBecauseOfScheduledMaintenanceEvent` flag.
 *
 * A grouped metric monitor (group-by `host.name`, say) evaluates its
 * criteria once per series and creates one incident/alert per breaching
 * series. The whole-monitor flag is all-or-nothing: it only fires when
 * the *monitor itself* is attached to a maintenance event, and it would
 * silence every series. That leaves a gap — attaching only some of the
 * underlying resources (10 of 100 hosts) to a maintenance window did
 * nothing, because nothing maps an attached host back to the series it
 * owns.
 *
 * This util closes that gap: it returns the fingerprints of the series
 * whose resource is under an ongoing maintenance window, so the
 * incident/alert creation loops can skip exactly those series while the
 * other 90 hosts keep alerting. It covers every resource type a
 * maintenance event can attach to AND a series can identify: Host,
 * DockerHost, KubernetesCluster, ProxmoxCluster, CephCluster, and
 * Service.
 */
export default class MonitorMaintenanceSuppression {
  /*
   * Resolve the per-series suppression set for one project. Returns an
   * empty set on the common paths — no per-series matches, or no
   * ongoing maintenance touching any resource — so callers pay at most
   * one query and nothing when there is no maintenance.
   */
  @CaptureSpan()
  public static async getSuppressedSeriesFingerprints(input: {
    projectId: ObjectID;
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
  }): Promise<Set<string>> {
    if (!input.matchesPerSeries || input.matchesPerSeries.length === 0) {
      return new Set<string>();
    }

    const maintained: MaintainedResourceKeys =
      await this.getResourcesUnderOngoingMaintenance(input.projectId);

    if (!this.hasAnyMaintainedResource(maintained)) {
      return new Set<string>();
    }

    return this.getSuppressedFingerprintsForMaintainedResources({
      matchesPerSeries: input.matchesPerSeries,
      maintained,
    });
  }

  /*
   * Pure matching step, split out from the query so it can be unit
   * tested without a database. For each series, pull the resource
   * identifiers out of its labels and suppress the series if any of
   * them is under maintenance.
   */
  public static getSuppressedFingerprintsForMaintainedResources(input: {
    matchesPerSeries: Array<PerSeriesCriteriaMatch>;
    maintained: MaintainedResourceKeys;
  }): Set<string> {
    const suppressed: Set<string> = new Set<string>();

    for (const series of input.matchesPerSeries) {
      if (!series.fingerprint || !series.labels) {
        continue;
      }

      const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
        series.labels,
      );

      const isUnderMaintenance: boolean =
        this.intersects(refs.hostIds, input.maintained.hosts.ids) ||
        this.intersects(refs.hostNames, input.maintained.hosts.names) ||
        this.intersects(refs.dockerHostIds, input.maintained.dockerHosts.ids) ||
        this.intersects(
          refs.dockerHostNames,
          input.maintained.dockerHosts.names,
        ) ||
        this.intersects(refs.podmanHostIds, input.maintained.podmanHosts.ids) ||
        this.intersects(
          refs.podmanHostNames,
          input.maintained.podmanHosts.names,
        ) ||
        this.intersects(
          refs.kubernetesClusterIds,
          input.maintained.kubernetesClusters.ids,
        ) ||
        this.intersects(
          refs.kubernetesClusterNames,
          input.maintained.kubernetesClusters.names,
        ) ||
        this.intersects(
          refs.proxmoxClusterNames,
          input.maintained.proxmoxClusters.names,
        ) ||
        this.intersects(
          refs.cephClusterNames,
          input.maintained.cephClusters.names,
        ) ||
        this.intersects(refs.iotFleetNames, input.maintained.iotFleets.names) ||
        this.intersects(refs.serviceIds, input.maintained.services.ids) ||
        this.intersects(refs.serviceNames, input.maintained.services.names);

      if (isUnderMaintenance) {
        suppressed.add(series.fingerprint);
      }
    }

    return suppressed;
  }

  private static intersects(values: Array<string>, set: Set<string>): boolean {
    for (const value of values) {
      if (set.has(value)) {
        return true;
      }
    }
    return false;
  }

  private static hasAnyMaintainedResource(
    maintained: MaintainedResourceKeys,
  ): boolean {
    return (
      maintained.hosts.ids.size > 0 ||
      maintained.hosts.names.size > 0 ||
      maintained.dockerHosts.ids.size > 0 ||
      maintained.dockerHosts.names.size > 0 ||
      maintained.podmanHosts.ids.size > 0 ||
      maintained.podmanHosts.names.size > 0 ||
      maintained.kubernetesClusters.ids.size > 0 ||
      maintained.kubernetesClusters.names.size > 0 ||
      maintained.proxmoxClusters.ids.size > 0 ||
      maintained.proxmoxClusters.names.size > 0 ||
      maintained.cephClusters.ids.size > 0 ||
      maintained.cephClusters.names.size > 0 ||
      maintained.iotFleets.ids.size > 0 ||
      maintained.iotFleets.names.size > 0 ||
      maintained.services.ids.size > 0 ||
      maintained.services.names.size > 0
    );
  }

  /*
   * Collect the ids + identifiers of every Host / DockerHost /
   * KubernetesCluster / ProxmoxCluster / CephCluster / Service attached
   * to an ongoing maintenance event in this project. Monitors attached
   * to the event are intentionally not collected here — those are
   * already handled upstream by the whole-monitor disable flag, which
   * short-circuits evaluation before we ever reach per-series creation.
   */
  private static async getResourcesUnderOngoingMaintenance(
    projectId: ObjectID,
  ): Promise<MaintainedResourceKeys> {
    const maintained: MaintainedResourceKeys = {
      hosts: { ids: new Set<string>(), names: new Set<string>() },
      dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
      podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
      kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
      proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
      cephClusters: { ids: new Set<string>(), names: new Set<string>() },
      iotFleets: { ids: new Set<string>(), names: new Set<string>() },
      services: { ids: new Set<string>(), names: new Set<string>() },
    };

    const ongoingEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: projectId,
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          },
        },
        select: {
          _id: true,
          hosts: { _id: true, hostIdentifier: true },
          dockerHosts: { _id: true, hostIdentifier: true },
          podmanHosts: { _id: true, hostIdentifier: true },
          kubernetesClusters: { _id: true, clusterIdentifier: true },
          proxmoxClusters: { _id: true, name: true },
          cephClusters: { _id: true, name: true },
          iotFleets: { _id: true, name: true },
          services: { _id: true, name: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    for (const event of ongoingEvents) {
      for (const host of event.hosts || []) {
        this.addKey(maintained.hosts, host._id, host.hostIdentifier);
      }
      for (const dockerHost of event.dockerHosts || []) {
        this.addKey(
          maintained.dockerHosts,
          dockerHost._id,
          dockerHost.hostIdentifier,
        );
      }
      for (const podmanHost of event.podmanHosts || []) {
        this.addKey(
          maintained.podmanHosts,
          podmanHost._id,
          podmanHost.hostIdentifier,
        );
      }
      for (const cluster of event.kubernetesClusters || []) {
        this.addKey(
          maintained.kubernetesClusters,
          cluster._id,
          cluster.clusterIdentifier,
        );
      }
      for (const proxmoxCluster of event.proxmoxClusters || []) {
        this.addKey(
          maintained.proxmoxClusters,
          proxmoxCluster._id,
          proxmoxCluster.name,
        );
      }
      for (const cephCluster of event.cephClusters || []) {
        this.addKey(maintained.cephClusters, cephCluster._id, cephCluster.name);
      }
      for (const iotFleet of event.iotFleets || []) {
        this.addKey(maintained.iotFleets, iotFleet._id, iotFleet.name);
      }
      for (const service of event.services || []) {
        this.addKey(maintained.services, service._id, service.name);
      }
    }

    return maintained;
  }

  private static addKey(
    keySet: ResourceKeySet,
    id: string | undefined,
    name: string | undefined,
  ): void {
    if (id) {
      keySet.ids.add(String(id));
    }
    if (name) {
      keySet.names.add(name);
    }
  }
}
