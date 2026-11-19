import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  DeviceSeenFrom,
  WhenReachUnknown,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import {
  getHostLookupValues,
  getMonitorCheckedHost,
  isSameHost,
} from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import NetworkDeviceService from "../../Services/NetworkDeviceService";

/*
 * WHICH NETWORK DEVICE A HAND-MADE MONITOR IS OF (OneUptime issue #9545), on
 * the server.
 *
 * A monitor an import, an auto import rule or an alert policy made for a
 * device carries provenance (Monitor.autoProvisionedNetworkDeviceId). One a
 * person made carried nothing, so the duplicate check could not see it, an
 * import gave the device a second Ping monitor beside it, and the device's
 * pages did not list it. A person's monitor is tied to its device by
 * Monitor.networkDeviceId:
 *
 *   - by the person, from the monitor's form or the device's Monitors card;
 *   - or, when the monitor is created on the address of a device, to the
 *     device its probes see at that address (findDeviceAt). Two sites can
 *     each have a 10.0.0.5 (issue #9677): the device is the one the
 *     monitor's probes poll, else the one in a site they look into
 *     (Utils/NetworkDevice/DeviceAddressScope). A monitor whose probes are
 *     no site's - they poll no device and are no site's default probe - is
 *     tied only to a device in no site that is alone at its address: it is
 *     never counted as one site's device's monitor when it may check another
 *     site's host. Devices the probes cannot tell apart tie it to none, and
 *     the person picks one in the form.
 *
 * And when a person changes the address of a monitor that was tied to the
 * device at its old address, the tie follows the address
 * (followAddressChange) - to the device its probes see at the new address,
 * or to none. A tie the person made to a device at another address (its DNS
 * name, a second interface) is theirs, and stays.
 *
 * Reads as OneUptime, held to the monitor's project. Whether the person may
 * see the device they tie a monitor to is assertPersonMayReadDevice's.
 */

// What a device is read with here: its id, its address, and where it is.
const DEVICE_ADDRESS_SELECT: {
  _id: true;
  hostname: true;
  siteId: true;
  probeId: true;
} = {
  _id: true,
  hostname: true,
  siteId: true,
  probeId: true,
};

/*
 * The probes a monitor runs on, read only once a device is at the address it
 * checks: most monitors check no device's, and need nothing more read.
 */
export type MonitorProbeIdsReader = () => Promise<
  Array<ObjectID | string | null | undefined>
>;

/*
 * Why a device cannot be tied to the monitor: it is not one the person can
 * see in the project. Worded as a missing device is, whatever the reason, so
 * it tells nobody what they may not read.
 */
export const MONITOR_DEVICE_NOT_FOUND: string =
  "That network device was not found. It may have been deleted. Pick another device, or leave Network Device empty.";

/*
 * Why a monitor an import, an auto import rule or an alert policy made for a
 * device is not tied to a device by hand: its provenance makes it that
 * device's already, and deletes it with that device.
 */
export const MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN: string =
  "An import, an auto import rule or an alert policy made this monitor for its network device, so it is that device's already. Its Network Device cannot be changed.";

export default class MonitorDeviceLink {
  /*
   * The device in the project at this host that a monitor running on these
   * probes checks (see the top of this file), or null when there is none,
   * when it may be another site's, or when several cannot be told apart.
   */
  public static async findDeviceAt(data: {
    projectId: ObjectID;
    host: string;
    getProbeIds: MonitorProbeIdsReader;
  }): Promise<ObjectID | null> {
    const values: Array<string> = getHostLookupValues(data.host);

    if (values.length === 0) {
      return null;
    }

    const atHostnames: Map<
      string,
      Array<NetworkDevice>
    > = await NetworkDeviceService.getAllDevicesAtHostnames({
      projectId: data.projectId,
      hostnames: values,
      select: DEVICE_ADDRESS_SELECT,
      props: { isRoot: true },
    });

    // The spellings of one host are one address.
    const candidates: Array<NetworkDevice> = [];

    for (const devices of atHostnames.values()) {
      candidates.push(...devices);
    }

    if (candidates.length === 0) {
      return null;
    }

    const seen: Map<
      string,
      DeviceSeenFrom<NetworkDevice>
    > = await NetworkDeviceService.resolveDevicesSeenFrom({
      projectId: data.projectId,
      devicesByAddress: new Map<string, Array<NetworkDevice>>([
        [data.host, candidates],
      ]),
      seenFrom: {
        probeIds: await data.getProbeIds(),
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      },
    });

    const match: DeviceSeenFrom<NetworkDevice> | undefined = seen.get(
      data.host,
    );

    return match?.kind === "device" && match.device.id ? match.device.id : null;
  }

  /*
   * The device a new monitor with these steps and probes is of, when its
   * address says so (see the top of this file), or null.
   */
  public static async findDeviceOfNewMonitor(data: {
    projectId: ObjectID;
    monitorType: MonitorType | string | null | undefined;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
    getProbeIds: MonitorProbeIdsReader;
  }): Promise<ObjectID | null> {
    const host: string = getMonitorCheckedHost({
      monitorType: data.monitorType,
      monitorSteps: data.monitorSteps,
    });

    if (!host) {
      return null;
    }

    return await this.findDeviceAt({
      projectId: data.projectId,
      host: host,
      getProbeIds: data.getProbeIds,
    });
  }

  /*
   * The device a monitor is tied to once its steps change, when the tie
   * followed its address: `undefined` to leave the tie as it is, otherwise
   * the device its probes see at the new address (null for none).
   *
   * The tie follows only when it was the address's - the device it names
   * is at the address the monitor checked before - and the address
   * changed. Read as the monitor is stored (its type, steps, tie and
   * probes) and as it is written (its new steps).
   */
  public static async followAddressChange(data: {
    projectId: ObjectID;
    monitorType: MonitorType | string | null | undefined;
    storedSteps: MonitorSteps | JSONObject | null | undefined;
    writtenSteps: MonitorSteps | JSONObject | null | undefined;
    linkedDeviceId: ObjectID | string | null | undefined;
    getProbeIds: MonitorProbeIdsReader;
  }): Promise<ObjectID | null | undefined> {
    if (!data.linkedDeviceId) {
      return undefined;
    }

    const storedHost: string = getMonitorCheckedHost({
      monitorType: data.monitorType,
      monitorSteps: data.storedSteps,
    });
    const writtenHost: string = getMonitorCheckedHost({
      monitorType: data.monitorType,
      monitorSteps: data.writtenSteps,
    });

    if (!storedHost || isSameHost(storedHost, writtenHost)) {
      return undefined;
    }

    const linked: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: data.linkedDeviceId.toString(),
        projectId: data.projectId,
      },
      select: DEVICE_ADDRESS_SELECT,
      props: { isRoot: true },
    });

    // A tie the person made to a device at another address is theirs.
    if (!linked || !isSameHost(linked.hostname || "", storedHost)) {
      return undefined;
    }

    if (!writtenHost) {
      return null;
    }

    return await this.findDeviceAt({
      projectId: data.projectId,
      host: writtenHost,
      getProbeIds: data.getProbeIds,
    });
  }

  /*
   * A person ties a monitor only to a device they can see: read as them,
   * in the monitor's project. OneUptime's own writes are not asked.
   */
  public static async assertPersonMayReadDevice(data: {
    networkDeviceId: ObjectID | string;
    projectId: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    if (!data.projectId) {
      throw new BadDataException(MONITOR_DEVICE_NOT_FOUND);
    }

    let device: NetworkDevice | null = null;

    try {
      device = await NetworkDeviceService.findOneBy({
        query: {
          _id: data.networkDeviceId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props: data.props,
      });
    } catch {
      device = null;
    }

    if (!device) {
      throw new BadDataException(MONITOR_DEVICE_NOT_FOUND);
    }
  }
}
