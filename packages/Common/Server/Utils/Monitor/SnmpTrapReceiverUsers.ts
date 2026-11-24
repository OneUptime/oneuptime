import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import IP from "../../../Types/IP/IP";
import ObjectID from "../../../Types/ObjectID";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpV3Auth from "../../../Types/Monitor/SnmpMonitor/SnmpV3Auth";
import {
  MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES,
  MAX_SNMP_TRAP_RECEIVER_USERS,
  MAX_SNMP_USER_NAME_LENGTH,
  SnmpTrapReceiverUser,
} from "../../../Types/Probe/SnmpTrapReceiver";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import NetworkDeviceOtherAddressesUtil from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import { isNonEmptyCredential } from "../../../Utils/NetworkDevice/SnmpCredentialUtil";
import NetworkDeviceHydrationUtil, {
  SnmpConnectionCredentials,
} from "./NetworkDeviceHydrationUtil";
import logger from "../Logger";

/*
 * THE SNMPv3 USERS A PROBE'S TRAP RECEIVER ACCEPTS (OneUptime issue #11005).
 *
 * Only the users of the devices assigned to that probe, so one project's
 * keys never reach another project's probe - the tenancy check the poll
 * claim makes (a project probe takes only its own project's devices; a
 * global probe the devices assigned to it), and only devices of a project
 * that is served. From each device, every SNMPv3 credential it carries: its
 * own, its credential profile's and its site's default
 * (NetworkDeviceHydrationUtil.resolveSnmpV3Carriers).
 *
 * Each is read exactly as the poller reads it: assembled by the hydration's
 * buildSnmpV3Auth, then parsed with the poller's own parse() - an unset
 * protocol is the poller's default (MD5, DES), and a stored value no parse()
 * reads is left out rather than guessed at, as a poll with it would fail.
 * The same credential on many devices is one user, with all their
 * addresses: the receiver tries a user on its own devices' traps first.
 *
 * The users carry their passphrases. They go to the probe over its
 * authenticated connection, as the credentials it polls with do, and are
 * never logged - here or on the probe.
 */

// The most devices one probe's users are read from, and how many at a time.
export const MAX_TRAP_RECEIVER_DEVICES: number = 20000;
const DEVICES_PER_READ: number = 1000;

export default class SnmpTrapReceiverUsers {
  public static async getUsersForProbe(
    probeId: ObjectID,
  ): Promise<Array<SnmpTrapReceiverUser>> {
    const deviceIds: Array<ObjectID> =
      await NetworkDeviceService.findDeviceIdsWithSnmpV3OnProbe({
        probeId: probeId,
        limit: MAX_TRAP_RECEIVER_DEVICES,
      });

    if (deviceIds.length === 0) {
      return [];
    }

    const devices: Array<NetworkDevice> = [];

    for (
      let start: number = 0;
      start < deviceIds.length;
      start += DEVICES_PER_READ
    ) {
      devices.push(
        ...(await NetworkDeviceService.findBy({
          query: {
            _id: QueryHelper.any(
              deviceIds.slice(start, start + DEVICES_PER_READ),
            ),
          },
          select: {
            ...NetworkDeviceHydrationUtil.snmpConfigSelect,
            otherAddresses: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        })),
      );
    }

    const carriersByDeviceId: Map<
      string,
      Array<SnmpConnectionCredentials>
    > = await NetworkDeviceHydrationUtil.resolveSnmpV3Carriers(devices);

    return SnmpTrapReceiverUsers.toUsers(devices, carriersByDeviceId);
  }

  /*
   * The users of a set of devices: one per distinct credential, with the
   * addresses of every device that carries it.
   */
  public static toUsers(
    devices: Array<NetworkDevice>,
    carriersByDeviceId: Map<string, Array<SnmpConnectionCredentials>>,
  ): Array<SnmpTrapReceiverUser> {
    const usersByCredential: Map<string, SnmpTrapReceiverUser> = new Map();

    for (const device of devices) {
      const deviceId: string | undefined = device.id?.toString();

      if (!deviceId) {
        continue;
      }

      const addresses: Array<string> =
        SnmpTrapReceiverUsers.getDeviceAddresses(device);

      for (const carrier of carriersByDeviceId.get(deviceId) || []) {
        const user: SnmpTrapReceiverUser | null =
          SnmpTrapReceiverUsers.toUser(carrier, deviceId);

        if (!user) {
          continue;
        }

        const credentialKey: string = JSON.stringify([
          user.userName,
          user.securityLevel,
          user.authProtocol || "",
          user.authKey || "",
          user.privProtocol || "",
          user.privKey || "",
        ]);

        const existing: SnmpTrapReceiverUser | undefined =
          usersByCredential.get(credentialKey);

        if (existing) {
          for (const address of addresses) {
            if (
              existing.addresses.length <
                MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES &&
              !existing.addresses.includes(address)
            ) {
              existing.addresses.push(address);
            }
          }
          continue;
        }

        if (usersByCredential.size >= MAX_SNMP_TRAP_RECEIVER_USERS) {
          logger.warn(
            `One probe's devices carry more than ${MAX_SNMP_TRAP_RECEIVER_USERS} distinct SNMPv3 credentials; its trap receiver takes the first ${MAX_SNMP_TRAP_RECEIVER_USERS}.`,
          );
          return Array.from(usersByCredential.values());
        }

        usersByCredential.set(credentialKey, {
          ...user,
          addresses: addresses.slice(0, MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES),
        });
      }
    }

    return Array.from(usersByCredential.values());
  }

  /*
   * One SNMPv3 credential as the receiver takes it, or null when a poll
   * with it could not work either: no user name, a level, protocol or key
   * nothing reads, or a level whose keys are missing. Says why at debug,
   * naming the device and never a value.
   */
  public static toUser(
    carrier: SnmpConnectionCredentials,
    deviceId: string,
  ): SnmpTrapReceiverUser | null {
    const v3Auth: SnmpV3Auth | undefined =
      NetworkDeviceHydrationUtil.buildSnmpV3Auth(carrier);

    const userName: string =
      v3Auth && isNonEmptyCredential(v3Auth.username)
        ? v3Auth.username.trim()
        : "";

    if (!v3Auth || !userName || userName.length > MAX_SNMP_USER_NAME_LENGTH) {
      return SnmpTrapReceiverUsers.leaveOut(deviceId, "its user name");
    }

    if (SnmpSecurityLevelUtil.isUnrecognized(v3Auth.securityLevel)) {
      return SnmpTrapReceiverUsers.leaveOut(deviceId, "its security level");
    }

    const securityLevel: SnmpSecurityLevel =
      SnmpSecurityLevelUtil.parse(v3Auth.securityLevel) ||
      SnmpSecurityLevel.NoAuthNoPriv;

    const user: SnmpTrapReceiverUser = {
      userName: userName,
      securityLevel: securityLevel,
      addresses: [],
    };

    if (securityLevel === SnmpSecurityLevel.NoAuthNoPriv) {
      return user;
    }

    if (
      SnmpAuthProtocolUtil.isUnrecognized(v3Auth.authProtocol) ||
      !isNonEmptyCredential(v3Auth.authKey)
    ) {
      return SnmpTrapReceiverUsers.leaveOut(
        deviceId,
        "its authentication protocol or passphrase",
      );
    }

    // Unset is the poller's default (SnmpMonitor.mapAuthProtocol).
    user.authProtocol =
      SnmpAuthProtocolUtil.parse(v3Auth.authProtocol) || SnmpAuthProtocol.MD5;
    user.authKey = v3Auth.authKey;

    if (securityLevel === SnmpSecurityLevel.AuthNoPriv) {
      return user;
    }

    if (
      SnmpPrivProtocolUtil.isUnrecognized(v3Auth.privProtocol) ||
      !isNonEmptyCredential(v3Auth.privKey)
    ) {
      return SnmpTrapReceiverUsers.leaveOut(
        deviceId,
        "its privacy protocol or passphrase",
      );
    }

    // Unset is the poller's default (SnmpMonitor.mapPrivProtocol).
    user.privProtocol =
      SnmpPrivProtocolUtil.parse(v3Auth.privProtocol) || SnmpPrivProtocol.DES;
    user.privKey = v3Auth.privKey;

    return user;
  }

  /*
   * The addresses a device's traps come from: its hostname when that is an
   * IP address, and its Other Addresses. Canonical, each once.
   */
  public static getDeviceAddresses(device: NetworkDevice): Array<string> {
    const addresses: Array<string> = [];
    const hostname: string = (device.hostname || "").trim();

    if (hostname && IP.isIP(hostname)) {
      addresses.push(IpCanonicalUtil.canonicalize(hostname));
    }

    for (const address of NetworkDeviceOtherAddressesUtil.parse(
      device.otherAddresses,
    ).addresses) {
      if (!addresses.includes(address)) {
        addresses.push(address);
      }
    }

    return addresses;
  }

  private static leaveOut(deviceId: string, what: string): null {
    logger.debug(
      `An SNMPv3 credential of network device ${deviceId} is not given to its probe's trap receiver: ${what} cannot be read. Its traps are refused until it is corrected, as its polls fail.`,
    );
    return null;
  }
}
