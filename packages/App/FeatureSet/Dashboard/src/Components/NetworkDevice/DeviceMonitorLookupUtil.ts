import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { DEVICE_TARGET_MONITOR_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import DeviceWebUiUtil from "Common/Utils/NetworkDevice/DeviceWebUiUtil";
import Search from "Common/Types/BaseDatabase/Search";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";

/** What a device's own row says about who reports its health. */
export interface DeviceBinding {
  boundMonitor: Monitor | null;
  isMonitorBacked: boolean;
  /*
   * The device's name and the address its probe polls: what its web UI
   * monitor is found by (DeviceWebUiUtil.isWebUiMonitorOf). Empty when the
   * device could not be read.
   */
  deviceName: string;
  deviceAddress: string;
}

/*
 * The most Website monitors named after a device read to find its web UI
 * monitor among them: a device has one or two.
 */
export const WEB_UI_MONITOR_CANDIDATES_LIMIT: number = 50;

/** Everything the device's monitor surfaces render from. */
export interface DeviceMonitorContext {
  monitors: Array<Monitor>;
  isMonitorBacked: boolean;
  /*
   * The monitors listed only because a person tied them to the device
   * (Monitor.networkDeviceId, issues #9545 and #9676), by id: the ones the
   * Monitors card can take off the device. One made for it, bound to it,
   * watching it, or its web UI monitor is the device's for that reason, and
   * stays listed whatever its tie.
   */
  removableMonitorIds: Set<string>;
}

// The monitors listed for a device, and which of them only by a person's tie.
export interface DeviceMonitorListing {
  monitors: Array<Monitor>;
  removableMonitorIds: Set<string>;
}

/*
 * Where the server answers which Network Device monitors watch a device
 * (Common/Server/API/NetworkDeviceWatchingMonitorsAPI, issue #8101).
 */
export const NETWORK_DEVICE_WATCHING_MONITORS_ROUTE: string =
  "/network-device/:networkDeviceId/watching-monitors";

export function getWatchingMonitorsRoute(
  networkDeviceId: ObjectID | string,
): string {
  return NETWORK_DEVICE_WATCHING_MONITORS_ROUTE.replace(
    ":networkDeviceId",
    encodeURIComponent(networkDeviceId.toString()),
  );
}

/*
 * The most watching monitors one Monitor list request names by id. A device
 * has a handful; a device with more is read in pieces of this many, never
 * cut off at a page.
 */
export const WATCHING_MONITORS_PER_READ: number = 500;

/*
 * Finds the monitors that report on a given network device.
 *
 * There are FOUR ways a monitor relates to a device, and this util has to
 * return all of them or the device's own pages contradict its status pill,
 * or the import - or the "Monitor web UI" action - that just gave it a
 * monitor. The fourth, its web UI monitor, is listWebUiMonitors'.
 *
 * 1. A Network Device monitor WATCHES the device: the reference lives inside
 *    the monitor's monitorSteps JSON column
 *    (step.data.networkDeviceMonitor.networkDeviceId). Postgres keeps
 *    MonitorNetworkDevice from every monitor's steps, so the server answers
 *    which monitors those are, by the device
 *    (POST /network-device/:id/watching-monitors, listWatchingMonitors), and
 *    they are read by id. It used to list every Network Device monitor in
 *    the project, steps and all, and filter them here: one heavy read of
 *    every monitor's steps each time someone opened a device, and past
 *    LIMIT_PER_PROJECT a monitor that did watch the device was silently
 *    missed (OneUptime issue #8101).
 *
 * 2. A monitor is BOUND to the device (NetworkDevice.monitorId): the
 *    monitor-backed contract, where that monitor's status IS the device's
 *    status. It is an ordinary Ping or IP monitor, so it is not of type
 *    NetworkDevice and its steps say nothing about the device — the lookup in
 *    (1) can never find it.
 *
 * 3. A monitor was MADE FOR the device (Monitor.autoProvisionedNetworkDeviceId)
 *    from a Ping, IP, Port or NTP template - or, since issue #9546, a
 *    Website, API or SSL Certificate one - by a discovery import (OneUptime
 *    issue #5145): it checks the device's address, or a URL on it, so it too
 *    is not of type NetworkDevice. Its provenance is queryable and indexed.
 *    A monitor a person made and TIED to the device (Monitor.networkDeviceId,
 *    issue #9545) is read by that tie the same way.
 *
 * Returning only (1) is what made a ping-only device that HAS a bound monitor
 * still render "No monitors are alerting on this device yet" next to a green
 * status pill the bound monitor had just produced (OneUptime/oneuptime#3447).
 * The bound monitor leads the list: it is the one deciding the device's state.
 */
export default class DeviceMonitorLookupUtil {
  /**
   * The device's binding half: the monitor bound to it, and whether it is
   * monitor-backed at all.
   *
   * Both answers come out of ONE device read because every caller needs both
   * — the card lists the monitor AND changes its copy on the method — and a
   * second round trip for a boolean already on the row would be waste.
   *
   * Failure is deliberately swallowed rather than thrown: the watching-monitor
   * list is the older, load-bearing half of this lookup, and a device the
   * caller cannot read (or one deleted mid-render) must not take the whole
   * card down with it. An unreadable device reads as "not monitor-backed",
   * which is the pre-existing behaviour.
   */
  public static async getDeviceBinding(
    networkDeviceId: ObjectID,
  ): Promise<DeviceBinding> {
    let device: NetworkDevice | null = null;

    try {
      device = await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: networkDeviceId,
        select: {
          _id: true,
          monitoringMethod: true,
          /*
           * Deliberately NOT selecting the monitor's currentMonitorStatus:
           * that relation carries no `canReadOnRelationQuery`, so reading it
           * one relation deep throws "Column currentMonitorStatus on Monitor
           * does not support read on relation query." Widening a shared
           * model's read surface to put a status pill on one card is the
           * wrong trade — the device's own status hero already shows the
           * verdict this monitor produced, and the card's pill is optional.
           */
          monitor: {
            _id: true,
            name: true,
            monitorType: true,
          },
          name: true,
          hostname: true,
        },
      });
    } catch {
      return {
        boundMonitor: null,
        isMonitorBacked: false,
        deviceName: "",
        deviceAddress: "",
      };
    }

    return {
      boundMonitor: device?.monitor || null,
      /*
       * Through the parser, never a raw compare: NULL means SNMP, which is
       * what every device that predates the column is.
       */
      isMonitorBacked: NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device?.monitoringMethod,
      ),
      deviceName: device?.name?.toString() || "",
      deviceAddress: device?.hostname?.toString() || "",
    };
  }

  /**
   * Everything a device's monitor surfaces need, in one call: the monitors
   * that report on it, and whether an empty list is a problem.
   */
  public static async getDeviceMonitorContext(
    networkDeviceId: ObjectID,
  ): Promise<DeviceMonitorContext> {
    const binding: DeviceBinding =
      await DeviceMonitorLookupUtil.getDeviceBinding(networkDeviceId);

    const listing: DeviceMonitorListing =
      await DeviceMonitorLookupUtil.listMonitorsForDevice({
        networkDeviceId,
        binding: binding,
      });

    return {
      monitors: listing.monitors,
      isMonitorBacked: binding.isMonitorBacked,
      removableMonitorIds: listing.removableMonitorIds,
    };
  }

  public static async getMonitorsWatchingDevice(
    networkDeviceId: ObjectID,
  ): Promise<Array<Monitor>> {
    const binding: DeviceBinding =
      await DeviceMonitorLookupUtil.getDeviceBinding(networkDeviceId);

    return (
      await DeviceMonitorLookupUtil.listMonitorsForDevice({
        networkDeviceId,
        binding: binding,
      })
    ).monitors;
  }

  /*
   * Which of the listed monitors a person's tie alone puts on the device
   * (issue #9676): in the tied list and in no other. React-free and
   * request-free, so the rule is tested on its own.
   */
  public static getRemovableMonitorIds(data: {
    tiedToDevice: ReadonlyArray<Monitor>;
    listedForOtherReasons: ReadonlyArray<Monitor | null | undefined>;
  }): Set<string> {
    const idOf: (monitor: Monitor | null | undefined) => string = (
      monitor: Monitor | null | undefined,
    ): string => {
      return (monitor?._id?.toString() || monitor?.id?.toString() || "")
        .trim()
        .toLowerCase();
    };

    const otherReasons: Set<string> = new Set<string>(
      data.listedForOtherReasons.map(idOf).filter((id: string): boolean => {
        return Boolean(id);
      }),
    );

    const removable: Set<string> = new Set<string>();

    for (const monitor of data.tiedToDevice) {
      const id: string = idOf(monitor);

      if (id && !otherReasons.has(id)) {
        removable.add(id);
      }
    }

    return removable;
  }

  /*
   * The ids of the Network Device monitors watching the device that the
   * reader may read, as the server answers them. An id that is not one is
   * dropped, and each is kept once. A failed request is thrown, as the
   * Monitor list's was: the card says so rather than say nothing alerts.
   */
  public static async fetchWatchingMonitorIds(
    networkDeviceId: ObjectID,
  ): Promise<Array<string>> {
    const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
      getWatchingMonitorsRoute(networkDeviceId),
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: {},
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const value: JSONValue | undefined = (response.data || {})["monitorIds"];

    if (!Array.isArray(value)) {
      return [];
    }

    const monitorIds: Set<string> = new Set<string>();

    for (const id of value) {
      if (typeof id === "string" && ObjectID.isValidUUID(id)) {
        monitorIds.add(id);
      }
    }

    return Array.from(monitorIds);
  }

  /*
   * 1. The Network Device monitors WATCHING the device: the server names
   *    them (fetchWatchingMonitorIds), and they are read by id with the
   *    card's columns - never the project's every Network Device monitor.
   *    In name order, as the list read sorted them; a device watched by
   *    more than WATCHING_MONITORS_PER_READ is read in pieces, all of them.
   */
  public static async listWatchingMonitors(data: {
    networkDeviceId: ObjectID;
    select: Select<Monitor>;
  }): Promise<Array<Monitor>> {
    const monitorIds: Array<string> =
      await DeviceMonitorLookupUtil.fetchWatchingMonitorIds(
        data.networkDeviceId,
      );

    const monitors: Array<Monitor> = [];

    for (
      let offset: number = 0;
      offset < monitorIds.length;
      offset += WATCHING_MONITORS_PER_READ
    ) {
      const chunk: Array<string> = monitorIds.slice(
        offset,
        offset + WATCHING_MONITORS_PER_READ,
      );

      const page: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          _id: new Includes(chunk),
          monitorType: MonitorType.NetworkDevice,
        },
        limit: chunk.length,
        skip: 0,
        select: data.select,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      monitors.push(...page.data);
    }

    if (monitorIds.length > WATCHING_MONITORS_PER_READ) {
      monitors.sort((first: Monitor, second: Monitor): number => {
        return (first.name || "").localeCompare(second.name || "");
      });
    }

    return monitors;
  }

  /*
   * 4. The device's WEB UI monitor: a Website monitor of its management
   *    page, as "Monitor web UI" on its Monitors card makes one
   *    (DeviceWebUiUtil). Nothing on a Website monitor names a device, so
   *    it is found by what it is: named after the device, with a step on
   *    the device's address. Only Website monitors whose name holds the
   *    device's are read - a handful - never the project's every one.
   *    Best effort, like the binding: a read that fails leaves the other
   *    monitors listed.
   */
  public static async listWebUiMonitors(data: {
    binding: DeviceBinding;
    select: Select<Monitor>;
  }): Promise<Array<Monitor>> {
    const deviceName: string = data.binding.deviceName.trim();

    if (!deviceName || !data.binding.deviceAddress.trim()) {
      return [];
    }

    let candidates: ListResult<Monitor>;

    try {
      candidates = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          monitorType: MonitorType.Website,
          name: new Search(deviceName),
        },
        limit: WEB_UI_MONITOR_CANDIDATES_LIMIT,
        skip: 0,
        select: { ...data.select, monitorSteps: true },
        sort: {
          name: SortOrder.Ascending,
        },
      });
    } catch {
      return [];
    }

    return candidates.data.filter((monitor: Monitor): boolean => {
      const steps: Array<MonitorStep> =
        monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

      return DeviceWebUiUtil.isWebUiMonitorOf({
        monitorName: monitor.name,
        destinations: steps.map((step: MonitorStep) => {
          return step.data?.monitorDestination?.toString();
        }),
        deviceName: deviceName,
        deviceAddress: data.binding.deviceAddress,
      });
    });
  }

  private static async listMonitorsForDevice(data: {
    networkDeviceId: ObjectID;
    binding: DeviceBinding;
  }): Promise<DeviceMonitorListing> {
    const networkDeviceId: ObjectID = data.networkDeviceId;
    const boundMonitor: Monitor | null = data.binding.boundMonitor;

    const select: Select<Monitor> = {
      _id: true,
      name: true,
      monitorType: true,
      /*
       * Whether an alert policy owns this monitor — the id only, not the
       * policy row. The `networkAlertPolicy` RELATION carries no
       * `canReadOnRelationQuery` (same reason the status pill above reads
       * the way it does), and widening a shared model's read surface to
       * put a policy's name on one card is the wrong trade. The id is
       * enough for what the operator needs to know here: that editing or
       * deleting this monitor by hand will be undone by the engine.
       */
      networkAlertPolicyId: true,
      currentMonitorStatus: {
        name: true,
        color: true,
      },
    };

    const [watching, madeForDevice, tiedToDevice, webUiMonitors]: [
      Array<Monitor>,
      ListResult<Monitor>,
      ListResult<Monitor>,
      Array<Monitor>,
    ] = await Promise.all([
      // 1. The Network Device monitors watching it (listWatchingMonitors).
      DeviceMonitorLookupUtil.listWatchingMonitors({
        networkDeviceId: networkDeviceId,
        select: select,
      }),
      /*
       * 3. A monitor made FOR the device from a Ping, IP, Port, NTP,
       *    Website, API or SSL Certificate template - a discovery import
       *    gives each device one (OneUptime issues #5145, #9546) - checks
       *    the device's address, or a URL on it. Its steps name an address,
       *    not the device; its provenance names the device: the column that
       *    finds it again and deletes it with the device.
       */
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          autoProvisionedNetworkDeviceId: networkDeviceId,
          monitorType: new Includes([...DEVICE_TARGET_MONITOR_TYPES]),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: select,
        sort: {
          name: SortOrder.Ascending,
        },
      }),
      /*
       * 5. A monitor a person TIED to the device (Monitor.networkDeviceId,
       *    issue #9545): made by hand from Monitors > Create, from this
       *    device's page, or on an address only this device has - of any
       *    kind. Nothing in its steps names the device either.
       */
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          networkDeviceId: networkDeviceId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: select,
        sort: {
          name: SortOrder.Ascending,
        },
      }),
      // 4. Its web UI monitor (listWebUiMonitors).
      DeviceMonitorLookupUtil.listWebUiMonitors({
        binding: data.binding,
        select: select,
      }),
    ]);

    /*
     * Deduped by id, not by identity: the bound monitor arrives from a
     * different request than the rest, so the same monitor bound to a
     * device AND made for it is two distinct objects. Without this it would
     * render twice. The bound monitor leads: it decides the device's state.
     */
    const listed: Array<Monitor> = [];
    const listedIds: Set<string> = new Set<string>();

    for (const monitor of [
      ...(boundMonitor ? [boundMonitor] : []),
      ...watching,
      ...madeForDevice.data,
      ...tiedToDevice.data,
      ...webUiMonitors,
    ]) {
      const monitorId: string = monitor._id?.toString() || "";

      if (monitorId && listedIds.has(monitorId)) {
        continue;
      }

      if (monitorId) {
        listedIds.add(monitorId);
      }

      listed.push(monitor);
    }

    return {
      monitors: listed,
      // A person's tie alone lists these (issue #9676): Remove unties them.
      removableMonitorIds: DeviceMonitorLookupUtil.getRemovableMonitorIds({
        tiedToDevice: tiedToDevice.data,
        listedForOtherReasons: [
          boundMonitor,
          ...watching,
          ...madeForDevice.data,
          ...webUiMonitors,
        ],
      }),
    };
  }
}
