import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import NetworkInterfaceService from "../../Services/NetworkInterfaceService";
import ObjectID from "../../../Types/ObjectID";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import RmonAlarmTrapUtil, {
  RmonAlarm,
} from "../../../Utils/NetworkEvent/RmonAlarmTrap";
import { getSnmpTrapInterfaceIndex } from "../../../Utils/NetworkEvent/SnmpTrapEvent";
import logger from "../Logger";

/*
 * The name of the interface a trap is about, for one device: what its
 * monitors' alerts say instead of "ifIndex 16781312".
 *
 * A link trap that carries only the interface's index (all RFC 2863 asks of
 * it) and an RMON alarm on a port's counter - how an MDS port-monitor
 * policy pages - name the interface by its ifIndex alone. The device's last
 * walk recorded every interface's name, so it is looked up there, once per
 * device the trap matched: devices that share an address (the logical
 * switches of one Brocade chassis) number their interfaces each their own
 * way.
 */
export default class SnmpTrapInterfaceName {
  // The ifIndex a trap names its interface by, or null when it names none.
  public static getInterfaceIndex(
    trap: Pick<SnmpTrap, "trapOid" | "varbinds">,
  ): number | null {
    const linkIndex: number | null = getSnmpTrapInterfaceIndex(trap);

    if (linkIndex !== null) {
      return linkIndex;
    }

    const alarm: RmonAlarm | null = RmonAlarmTrapUtil.decode(trap);

    return alarm?.interfaceIndex ?? null;
  }

  /*
   * The recorded name, or undefined: for a trap that names no interface by
   * index, for an index the device's walk never saw, and when the lookup
   * fails - which never loses the trap.
   */
  public static async findForDevice(data: {
    trap: Pick<SnmpTrap, "trapOid" | "varbinds">;
    networkDeviceId: ObjectID;
  }): Promise<string | undefined> {
    const interfaceIndex: number | null =
      SnmpTrapInterfaceName.getInterfaceIndex(data.trap);

    if (interfaceIndex === null) {
      return undefined;
    }

    try {
      const networkInterface: NetworkInterface | null =
        await NetworkInterfaceService.findOneBy({
          query: {
            networkDeviceId: data.networkDeviceId,
            interfaceIndex: interfaceIndex,
          },
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      return networkInterface?.name?.trim() || undefined;
    } catch (err) {
      logger.error("SNMP trap: error reading the interface a trap names:");
      logger.error(err);

      return undefined;
    }
  }
}
