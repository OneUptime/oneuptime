import Monitor from "../../../Models/DatabaseModels/Monitor";
import logger from "../Logger";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../AffectedResources/LinkedAffectedResources";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../Types/Database/QueryHelper";
import MonitorStepResourceIdentity from "./MonitorStepResourceIdentity";
import InfrastructureResourceBinding from "./InfrastructureResourceBinding";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import { SeriesResourceRefs } from "./SeriesResourceLabels";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
  SeriesResourcesOfEvaluation,
} from "./SeriesResourceLinker";

/*
 * Incidents and alerts created by a monitor must be attached to the
 * resources that monitor watches — the per-resource Activity pages, the
 * SideMenu badge counts, the "Affected Resources" card, the affected-
 * resources filter, and resource owner/label inheritance all query those
 * relations on Incident/Alert.
 *
 * Series labels cannot supply that identity on their own. They exist
 * only when the criteria is GROUPED, and most monitors are not: every
 * shipped Host / Docker / Podman / RUM template is ungrouped, the
 * Kubernetes templates group by node/pod (never by cluster), and
 * Logs / Traces / Exceptions monitors have no series concept at all. An
 * ungrouped monitor therefore linked nothing, which is why a metric
 * monitor scoped to one service with
 * `oneuptime.service.name = checkout-api` opened alerts that showed "No
 * resources affected".
 *
 * The deterministic source is the monitor's own step config, which
 * always carries whatever the user picked when they built the monitor:
 * a hostIdentifier, a clusterIdentifier, a vcenterIdentifier, a
 * fleetIdentifier, a set of telemetryServiceIds, or a metric attribute
 * filter. This module reads it once per evaluation and resolves it to
 * real rows.
 *
 * This supersedes the old MonitorClusterContext, which did the same
 * thing for exactly four cluster types (Proxmox / Ceph / Docker Swarm /
 * IoT) with a hand-rolled findOneBy per identifier.
 */

/*
 * What the incidents and alerts one evaluation opens are about, beyond
 * their series: the resources the monitor's config names
 * (resolveResourceContextForMonitor) and those someone linked it to by hand
 * (resolveLinkedResourcesForMonitor). Each is read the first time a record
 * is really created, and once for every incident and alert of the
 * evaluation (issue #8118): one that opens an incident and an alert used to
 * read both twice, once per creator - a dozen statements for the linked
 * resources alone - and an evaluation that opens nothing reads neither.
 *
 * Both creators only read what is handed back (SeriesResourceLinker merges
 * it into each record), so one answer serves them all.
 */
export interface MonitorRecordResources {
  getResourceContext: () => Promise<SeriesResolvedResourceIds>;
  getLinkedResources: () => Promise<SeriesResolvedResourceIds>;
  /*
   * What each record's series names, resolved for every series a create
   * pass will open a record for before the pass (#10315): one read per
   * resource kind, not one per series, kept for the evaluation's incidents
   * and alerts alike.
   */
  seriesResources: SeriesResourcesOfEvaluation;
}

export default class MonitorResourceContextUtil {
  /*
   * The record resources of one evaluation of `monitor`, each read at most
   * once and only when first asked for (MonitorRecordResources).
   */
  public static forEvaluation(input: {
    monitor: Monitor;
  }): MonitorRecordResources {
    let resourceContext: Promise<SeriesResolvedResourceIds> | null = null;
    let linkedResources: Promise<SeriesResolvedResourceIds> | null = null;

    return {
      getResourceContext: (): Promise<SeriesResolvedResourceIds> => {
        if (!resourceContext) {
          resourceContext =
            MonitorResourceContextUtil.resolveResourceContextForMonitor({
              monitor: input.monitor,
            });
        }

        return resourceContext;
      },
      getLinkedResources: (): Promise<SeriesResolvedResourceIds> => {
        if (!linkedResources) {
          linkedResources =
            MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
              monitor: input.monitor,
            });
        }

        return linkedResources;
      },
      seriesResources: new SeriesResourcesOfEvaluation({
        projectId: input.monitor.projectId,
        monitorType: input.monitor.monitorType,
      }),
    };
  }

  /*
   * Resolve the resource rows the monitor's configuration names.
   *
   * Lookup-only — row creation belongs to ingest discovery
   * (findOrCreateByName); a monitor pointing at a host that never sent
   * data simply links nothing. Lookups are ALWAYS project-scoped:
   * `isRoot` bypasses row-level access control, so a stale or hostile
   * identifier must never be able to pull a row in from another tenant.
   *
   * Returns empty for every monitor type whose config names no resource
   * (Website, API, Ping, Synthetic, ...) without touching the database.
   */
  public static async resolveResourceContextForMonitor(input: {
    monitor: Monitor;
  }): Promise<SeriesResolvedResourceIds> {
    const empty: SeriesResolvedResourceIds = this.emptyContext();

    if (!input.monitor.projectId) {
      return empty;
    }

    /*
     * Resource linking is best-effort context — a failure must never
     * block incident/alert creation, which runs inside the probe and
     * telemetry queue workers where a throw retries the whole job
     * forever. The EXTRACTION is inside the try as well as the lookup:
     * it reads free-form, unvalidated step JSON, so a monitor saved
     * through the API or an import can hand it a shape it cannot parse.
     */
    try {
      const refs: SeriesResourceRefs =
        MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
          monitor: await this.withCurrentResourceValues(input.monitor),
        });

      if (MonitorStepResourceIdentity.isEmpty(refs)) {
        return empty;
      }

      return await SeriesResourceLinker.resolveResourceRefs({
        refs: refs,
        projectId: input.monitor.projectId,
        /*
         * The identifiers here were typed by a user into the monitor
         * form, while the rows' names were stamped by an agent at
         * ingest; the two legitimately differ by case.
         */
        nameMatch: "caseInsensitive",
      });
    } catch (err) {
      logger.error(
        `Failed to resolve affected resources for monitor ${input.monitor.id?.toString()}: ${err}`,
      );
      return empty;
    }
  }

  /*
   * The monitor with each infrastructure step on its bound resource's
   * current value, so a cluster renamed since the monitor was saved is still
   * the one its incidents and alerts are about (InfrastructureResourceBinding).
   * The same monitor when nothing changed; a copy otherwise.
   */
  private static async withCurrentResourceValues(
    monitor: Monitor,
  ): Promise<Monitor> {
    if (!monitor.monitorSteps || !monitor.projectId) {
      return monitor;
    }

    const monitorSteps: MonitorSteps =
      await InfrastructureResourceBinding.resolveMonitorSteps({
        projectId: monitor.projectId,
        monitorType: monitor.monitorType,
        monitorSteps: monitor.monitorSteps,
      });

    if (monitorSteps === monitor.monitorSteps) {
      return monitor;
    }

    const copy: Monitor = new Monitor();

    if (monitor._id) {
      copy._id = monitor._id;
    }

    if (monitor.monitorType) {
      copy.monitorType = monitor.monitorType;
    }

    copy.projectId = monitor.projectId;
    copy.monitorSteps = monitorSteps;

    return copy;
  }

  /*
   * The resources someone linked to the monitor by hand (Monitor > Overview
   * > Linked Resources) - what a website, API or synthetic monitor watches,
   * which its configuration cannot name. Merged into every incident and
   * alert the monitor creates, next to what resolveResourceContextForMonitor
   * finds in the config, so a "site is down" incident is about the cluster
   * serving the site and OneUptime AI can investigate and fix it there.
   *
   * A database read, unlike the config path's no-op for such monitors, so
   * callers make it only when they are about to create a record (and at
   * most once per evaluation). Never throws: a failed read links nothing
   * rather than failing the probe or telemetry job that creates the record.
   */
  public static async resolveLinkedResourcesForMonitor(input: {
    monitor: Monitor;
  }): Promise<SeriesResolvedResourceIds> {
    const resolved: SeriesResolvedResourceIds = this.emptyContext();

    if (!input.monitor.id || !input.monitor.projectId) {
      return resolved;
    }

    try {
      const [resources, networkDeviceIds]: [
        Array<LinkedAffectedResource>,
        Array<string>,
      ] = await Promise.all([
        LinkedAffectedResources.readForMonitors({
          service: MonitorService,
          projectId: input.monitor.projectId,
          monitorIds: [input.monitor.id],
        }),
        /*
         * Read on its own terms: a device read that fails costs the
         * devices, never the resources linked by hand.
         */
        this.resolveNetworkDevicesTheMonitorReportsOn({
          monitorId: input.monitor.id,
          projectId: input.monitor.projectId,
          autoProvisionedNetworkDeviceId:
            input.monitor.autoProvisionedNetworkDeviceId,
          networkDeviceId: input.monitor.networkDeviceId,
        }).catch((err: unknown): Array<string> => {
          logger.error(
            `Failed to read the network devices monitor ${input.monitor.id?.toString()} reports on: ${err}`,
          );
          return [];
        }),
      ]);

      for (const resource of resources) {
        const key: keyof SeriesResolvedResourceIds | undefined =
          LINKED_RESOURCE_KEYS[resource.type];

        if (key && !resolved[key].includes(resource.id)) {
          resolved[key].push(resource.id);
        }
      }

      for (const networkDeviceId of networkDeviceIds) {
        if (!resolved.networkDeviceIds.includes(networkDeviceId)) {
          resolved.networkDeviceIds.push(networkDeviceId);
        }
      }

      return resolved;
    } catch (err) {
      logger.error(
        `Failed to read the linked resources of monitor ${input.monitor.id?.toString()}: ${err}`,
      );
      return this.emptyContext();
    }
  }

  /*
   * The network devices a monitor reports on without its steps naming them
   * (issue #5341): the device bound to it - a device whose monitoring
   * method is Monitor takes its status from this monitor
   * (NetworkDevice.monitorId) - the device a discovery import made it for
   * (Monitor.autoProvisionedNetworkDeviceId), an ordinary Ping, IP, Port,
   * NTP, Website, API or SSL Certificate monitor of the device, and the
   * device a person tied it to (Monitor.networkDeviceId, issue #9545). A
   * Network Device monitor names its device in its steps instead, which
   * resolveResourceContextForMonitor reads. The same ways the device's own
   * Monitors page lists (DeviceMonitorLookupUtil), so the device's
   * Incidents and Alerts tabs show what those monitors raise.
   *
   * Held to the monitor's project like every lookup here; at most a page of
   * bound devices, though a monitor is bound to one device in practice.
   */
  private static async resolveNetworkDevicesTheMonitorReportsOn(input: {
    monitorId: ObjectID;
    projectId: ObjectID;
    autoProvisionedNetworkDeviceId?: ObjectID | undefined | null;
    networkDeviceId?: ObjectID | undefined | null;
  }): Promise<Array<string>> {
    let madeForDeviceId: ObjectID | undefined | null =
      input.autoProvisionedNetworkDeviceId;
    let tiedToDeviceId: ObjectID | undefined | null = input.networkDeviceId;

    /*
     * Not every caller selects the two columns: with neither on the
     * monitor, they are read off its row. A monitor made for a device is
     * that device's, and a person ties a monitor nothing made, so one known
     * is enough.
     */
    if (!madeForDeviceId && !tiedToDeviceId) {
      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: input.monitorId,
          projectId: input.projectId,
        },
        select: {
          _id: true,
          autoProvisionedNetworkDeviceId: true,
          networkDeviceId: true,
        },
        props: {
          isRoot: true,
        },
      });

      madeForDeviceId = monitor?.autoProvisionedNetworkDeviceId;
      tiedToDeviceId = monitor?.networkDeviceId;
    }

    // The device it was made for and the one it is tied to, each once.
    const ownDeviceIds: Array<ObjectID> = [];

    for (const deviceId of [madeForDeviceId, tiedToDeviceId]) {
      if (
        deviceId &&
        !ownDeviceIds.some((listed: ObjectID): boolean => {
          return (
            listed.toString().toLowerCase() ===
            deviceId.toString().toLowerCase()
          );
        })
      ) {
        ownDeviceIds.push(deviceId);
      }
    }

    const [boundDevices, madeForDevices]: [
      Array<NetworkDevice>,
      Array<NetworkDevice>,
    ] = await Promise.all([
      NetworkDeviceService.findBy({
        query: {
          projectId: input.projectId,
          monitorId: input.monitorId,
        },
        select: { _id: true },
        skip: 0,
        limit: MAX_BOUND_NETWORK_DEVICES,
        props: { isRoot: true },
      }),
      ownDeviceIds.length > 0
        ? NetworkDeviceService.findBy({
            query: {
              projectId: input.projectId,
              _id:
                ownDeviceIds.length === 1
                  ? ownDeviceIds[0]!
                  : QueryHelper.any(ownDeviceIds),
            },
            select: { _id: true },
            skip: 0,
            limit: ownDeviceIds.length,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const ids: Array<string> = [];

    for (const device of [...boundDevices, ...madeForDevices]) {
      const id: string = device._id?.toString().toLowerCase() || "";

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  public static emptyContext(): SeriesResolvedResourceIds {
    return {
      hostIds: [],
      dockerHostIds: [],
      podmanHostIds: [],
      kubernetesClusterIds: [],
      serviceIds: [],
      proxmoxClusterIds: [],
      openStackCloudIds: [],
      vmwareVCenterIds: [],
      cephClusterIds: [],
      dockerSwarmClusterIds: [],
      iotFleetIds: [],
      databaseServerIds: [],
      storageArrayIds: [],
      cloudResourceIds: [],
      networkDeviceIds: [],
    };
  }
}

/*
 * The most devices one monitor is read as bound to. A device takes its
 * status from one monitor, and a monitor normally reports on one device;
 * the cap only bounds a project that bound one monitor to many.
 */
const MAX_BOUND_NETWORK_DEVICES: number = 10;

// Where each kind of linked resource goes in a resolved context.
const LINKED_RESOURCE_KEYS: Partial<
  Record<LinkedAffectedResourceType, keyof SeriesResolvedResourceIds>
> = {
  [LinkedAffectedResourceType.Host]: "hostIds",
  [LinkedAffectedResourceType.NetworkDevice]: "networkDeviceIds",
  [LinkedAffectedResourceType.KubernetesCluster]: "kubernetesClusterIds",
  [LinkedAffectedResourceType.DockerHost]: "dockerHostIds",
  [LinkedAffectedResourceType.PodmanHost]: "podmanHostIds",
  [LinkedAffectedResourceType.ProxmoxCluster]: "proxmoxClusterIds",
  [LinkedAffectedResourceType.OpenStackCloud]: "openStackCloudIds",
  [LinkedAffectedResourceType.VMwareVCenter]: "vmwareVCenterIds",
  [LinkedAffectedResourceType.CephCluster]: "cephClusterIds",
  [LinkedAffectedResourceType.StorageArray]: "storageArrayIds",
  [LinkedAffectedResourceType.DockerSwarmCluster]: "dockerSwarmClusterIds",
  [LinkedAffectedResourceType.IoTFleet]: "iotFleetIds",
  [LinkedAffectedResourceType.DatabaseServer]: "databaseServerIds",
  [LinkedAffectedResourceType.CloudResource]: "cloudResourceIds",
  [LinkedAffectedResourceType.Service]: "serviceIds",
};
