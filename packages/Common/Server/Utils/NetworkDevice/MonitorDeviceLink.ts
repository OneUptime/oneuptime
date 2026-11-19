import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  getHostLookupValues,
  getMonitorCheckedHost,
  isSameHost,
} from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";

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
 *   - or, when the monitor is created on an address exactly one device in
 *     the project has, to that device (findOnlyDeviceAt). Two sites can
 *     both have a 10.0.0.5: an address two devices share ties the monitor
 *     to neither, and the person picks one in the form.
 *
 * And when a person changes the address of a monitor that was tied to the
 * device at its old address, the tie follows the address
 * (followAddressChange) - to the one device at the new address, or to none.
 * A tie the person made to a device at another address (its DNS name, a
 * second interface) is theirs, and stays.
 *
 * Reads as OneUptime, held to the monitor's project. Whether the person may
 * see the device they tie a monitor to is assertPersonMayReadDevice's.
 */

// What a device is read with here: its id, and the address it is at.
const DEVICE_ADDRESS_SELECT: { _id: true; hostname: true } = {
  _id: true,
  hostname: true,
};

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
   * The one device in the project whose address is this host, or null when
   * none is, or more than one is.
   */
  public static async findOnlyDeviceAt(data: {
    projectId: ObjectID;
    host: string;
  }): Promise<ObjectID | null> {
    const values: Array<string> = getHostLookupValues(data.host);

    if (values.length === 0) {
      return null;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        hostname: QueryHelper.any(values),
      },
      select: DEVICE_ADDRESS_SELECT,
      // Two are enough to know the address is shared.
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });

    return devices.length === 1 && devices[0]?.id ? devices[0].id : null;
  }

  /*
   * The device a new monitor with these steps is of, when its address says
   * so unambiguously (see the top of this file), or null.
   */
  public static async findDeviceOfNewMonitor(data: {
    projectId: ObjectID;
    monitorType: MonitorType | string | null | undefined;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
  }): Promise<ObjectID | null> {
    const host: string = getMonitorCheckedHost({
      monitorType: data.monitorType,
      monitorSteps: data.monitorSteps,
    });

    if (!host) {
      return null;
    }

    return await this.findOnlyDeviceAt({
      projectId: data.projectId,
      host: host,
    });
  }

  /*
   * The device a monitor is tied to once its steps change, when the tie
   * followed its address: `undefined` to leave the tie as it is, otherwise
   * the device at the new address (null for none).
   *
   * The tie follows only when it was the address's - the device it names
   * is at the address the monitor checked before - and the address
   * changed. Read as the monitor is stored (its type, steps and tie) and as
   * it is written (its new steps).
   */
  public static async followAddressChange(data: {
    projectId: ObjectID;
    monitorType: MonitorType | string | null | undefined;
    storedSteps: MonitorSteps | JSONObject | null | undefined;
    writtenSteps: MonitorSteps | JSONObject | null | undefined;
    linkedDeviceId: ObjectID | string | null | undefined;
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

    return await this.findOnlyDeviceAt({
      projectId: data.projectId,
      host: writtenHost,
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
