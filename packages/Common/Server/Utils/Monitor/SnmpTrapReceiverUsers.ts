import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
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
import SnmpTrapRefusalShares from "../../../Types/Probe/SnmpTrapRefusalShares";
import SnmpV3CredentialHolderUtil, {
  SnmpV3CredentialHolders,
} from "../../../Types/Probe/SnmpV3CredentialHolders";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import NetworkDeviceOtherAddressesUtil from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import { isNonEmptyCredential } from "../../../Utils/NetworkDevice/SnmpCredentialUtil";
import NetworkDeviceHydrationUtil, {
  SnmpConnectionCredentials,
} from "./NetworkDeviceHydrationUtil";
import logger from "../Logger";

/*
 * THE SNMPv3 USERS A PROBE'S TRAP RECEIVER ACCEPTS (OneUptime issues
 * #11005, #11172, #11174).
 *
 * Exactly these keys reach a probe, and no others:
 *
 *   1. For every device assigned to the probe: every SNMPv3 credential it
 *      carries - its own, the credential profile it names, and its site's
 *      default profile (NetworkDeviceHydrationUtil.resolveSnmpV3Carriers).
 *      A device polled over v2c may still send its traps as its site's
 *      SNMPv3 user.
 *   2. For every site whose own Default Probe the probe is: that site's
 *      default credential profile, when it is SNMPv3 - so a device not
 *      added yet, which would be polled with it, is taken as its neighbours
 *      are, and its first trap kept as from an unknown source (#11174).
 *
 * Never another project's. Both reads hold to the poll claim's tenancy - a
 * project's own probe only its own project's devices and sites, a global
 * probe those that name it - and to projects that are served
 * (NetworkDeviceService.findDeviceIdsWithSnmpV3OnProbe,
 * findSitesWithSnmpV3DefaultOnProbe); a profile of another project, however
 * a device or a site names it, is dropped loudly by the hydration. And
 * never a profile nothing on this probe uses: a project's other profiles,
 * another site's default and a site that only inherits this probe from its
 * parent stay where they are.
 *
 * Each is read exactly as the poller reads it: assembled by the hydration's
 * buildSnmpV3Auth, then parsed with the poller's own parse() - an unset
 * protocol is the poller's default (MD5, DES), and a stored value no parse()
 * reads is left out rather than guessed at, as a poll with it would fail.
 * The same credential on many devices and sites is one user, with all their
 * addresses, and with the records that hold it (SnmpV3CredentialHolders):
 * the projects, the devices that carry it and the sites whose default it
 * is. The probe sends those back with every trap the credential signs, so
 * OneUptime keeps the trap in a project the credential is its own, on the
 * device that carries it (#11172).
 *
 * The users carry their passphrases. They go to the probe over its
 * authenticated connection, as the credentials it polls with do, and are
 * never logged - here or on the probe.
 */

// The most devices one probe's users are read from, and how many at a time.
export const MAX_TRAP_RECEIVER_DEVICES: number = 20000;
// The most sites whose default profile one probe is handed.
export const MAX_TRAP_RECEIVER_SITES: number = 5000;
const DEVICES_PER_READ: number = 1000;

/*
 * One SNMPv3 credential as a record holds it: a device (its own, its
 * profile's or its site's) or a site (its default), with the addresses it
 * is used from and the record that holds it.
 */
export interface SnmpTrapReceiverCredentialSource {
  carrier: SnmpConnectionCredentials;
  addresses: Array<string>;
  heldBy: SnmpV3CredentialHolders;
  // Names the record when a credential is left out, never a value.
  describedAs: string;
}

export default class SnmpTrapReceiverUsers {
  public static async getUsersForProbe(
    probeId: ObjectID,
  ): Promise<Array<SnmpTrapReceiverUser>> {
    const [deviceSources, siteSources]: [
      Array<SnmpTrapReceiverCredentialSource>,
      Array<SnmpTrapReceiverCredentialSource>,
    ] = await Promise.all([
      SnmpTrapReceiverUsers.getDeviceSources(probeId),
      SnmpTrapReceiverUsers.getSiteDefaultSources(probeId),
    ]);

    return SnmpTrapReceiverUsers.fromSources([
      ...deviceSources,
      ...siteSources,
    ]);
  }

  /*
   * The users of a set of devices: one per distinct credential, with the
   * addresses of every device that carries it and the devices themselves.
   */
  public static toUsers(
    devices: Array<NetworkDevice>,
    carriersByDeviceId: Map<string, Array<SnmpConnectionCredentials>>,
  ): Array<SnmpTrapReceiverUser> {
    return SnmpTrapReceiverUsers.fromSources(
      SnmpTrapReceiverUsers.toDeviceSources(devices, carriersByDeviceId),
    );
  }

  public static toDeviceSources(
    devices: Array<NetworkDevice>,
    carriersByDeviceId: Map<string, Array<SnmpConnectionCredentials>>,
  ): Array<SnmpTrapReceiverCredentialSource> {
    const sources: Array<SnmpTrapReceiverCredentialSource> = [];

    for (const device of devices) {
      const deviceId: string | undefined = device.id?.toString();
      const projectId: string | undefined = device.projectId?.toString();

      if (!deviceId || !projectId) {
        continue;
      }

      const addresses: Array<string> =
        SnmpTrapReceiverUsers.getDeviceAddresses(device);

      for (const carrier of carriersByDeviceId.get(deviceId) || []) {
        sources.push({
          carrier: carrier,
          addresses: addresses,
          heldBy: {
            projectIds: [projectId.toLowerCase()],
            deviceIds: [deviceId.toLowerCase()],
            siteIds: [],
          },
          describedAs: `network device ${deviceId}`,
        });
      }
    }

    return sources;
  }

  /*
   * A site's default profile, for the probe that is its Default Probe: held
   * by the site and its project, and used from no address until a device
   * is added - so the receiver tries it after the users of the devices at a
   * trap's address.
   */
  public static toSiteSources(
    sites: Array<NetworkSite>,
    carriersBySiteId: Map<string, SnmpConnectionCredentials>,
  ): Array<SnmpTrapReceiverCredentialSource> {
    const sources: Array<SnmpTrapReceiverCredentialSource> = [];

    for (const site of sites) {
      const siteId: string | undefined = site.id?.toString();
      const projectId: string | undefined = site.projectId?.toString();
      const carrier: SnmpConnectionCredentials | undefined = siteId
        ? carriersBySiteId.get(siteId)
        : undefined;

      if (!siteId || !projectId || !carrier) {
        continue;
      }

      sources.push({
        carrier: carrier,
        addresses: [],
        heldBy: {
          projectIds: [projectId.toLowerCase()],
          deviceIds: [],
          siteIds: [siteId.toLowerCase()],
        },
        describedAs: `network site ${siteId}`,
      });
    }

    return sources;
  }

  /*
   * One user per distinct credential, however many records hold it: their
   * addresses together, at most MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES, and
   * their holders together (a list that would grow past its limit is left
   * out: SnmpV3CredentialHolderUtil.merge). At most
   * MAX_SNMP_TRAP_RECEIVER_USERS users.
   */
  public static fromSources(
    sources: Array<SnmpTrapReceiverCredentialSource>,
  ): Array<SnmpTrapReceiverUser> {
    const usersByCredential: Map<string, SnmpTrapReceiverUser> = new Map();

    for (const source of sources) {
      const user: SnmpTrapReceiverUser | null = SnmpTrapReceiverUsers.toUser(
        source.carrier,
        source.describedAs,
      );

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
        for (const address of source.addresses) {
          if (
            existing.addresses.length < MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES &&
            !existing.addresses.includes(address)
          ) {
            existing.addresses.push(address);
          }
        }

        const heldBy: SnmpV3CredentialHolders | null = existing.heldBy
          ? SnmpV3CredentialHolderUtil.merge(existing.heldBy, source.heldBy)
          : null;

        if (heldBy) {
          existing.heldBy = heldBy;
        } else {
          // Held by more projects than can be listed: nothing is narrowed by it.
          delete existing.heldBy;
        }

        continue;
      }

      if (usersByCredential.size >= MAX_SNMP_TRAP_RECEIVER_USERS) {
        logger.warn(
          `One probe's devices and sites carry more than ${MAX_SNMP_TRAP_RECEIVER_USERS} distinct SNMPv3 credentials; its trap receiver takes the first ${MAX_SNMP_TRAP_RECEIVER_USERS}.`,
        );
        return Array.from(usersByCredential.values());
      }

      const heldBy: SnmpV3CredentialHolders | null =
        SnmpV3CredentialHolderUtil.sanitize(source.heldBy);

      usersByCredential.set(credentialKey, {
        ...user,
        addresses: source.addresses.slice(
          0,
          MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES,
        ),
        ...(heldBy ? { heldBy: heldBy } : {}),
      });
    }

    return Array.from(usersByCredential.values());
  }

  /*
   * One SNMPv3 credential as the receiver takes it, or null when a poll
   * with it could not work either: no user name, a level, protocol or key
   * nothing reads, or a level whose keys are missing. Says why at debug,
   * naming the record and never a value.
   */
  public static toUser(
    carrier: SnmpConnectionCredentials,
    describedAs: string,
  ): SnmpTrapReceiverUser | null {
    const v3Auth: SnmpV3Auth | undefined =
      NetworkDeviceHydrationUtil.buildSnmpV3Auth(carrier);

    const userName: string =
      v3Auth && isNonEmptyCredential(v3Auth.username)
        ? v3Auth.username.trim()
        : "";

    if (!v3Auth || !userName || userName.length > MAX_SNMP_USER_NAME_LENGTH) {
      return SnmpTrapReceiverUsers.leaveOut(describedAs, "its user name");
    }

    if (SnmpSecurityLevelUtil.isUnrecognized(v3Auth.securityLevel)) {
      return SnmpTrapReceiverUsers.leaveOut(describedAs, "its security level");
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
        describedAs,
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
        describedAs,
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

  /*
   * Each project's own SNMPv3 user names among a probe's users, as a
   * refusal shows a name (SnmpTrapRefusalShares): what a global probe's
   * refusals are read against for each project (#11173). A user held by
   * more projects than can be listed counts for none of them.
   */
  public static getUserNamesByProject(
    users: Array<SnmpTrapReceiverUser>,
  ): Map<string, Set<string>> {
    const namesByProject: Map<string, Set<string>> = new Map();

    for (const user of users) {
      for (const projectId of user.heldBy?.projectIds || []) {
        const names: Set<string> = namesByProject.get(projectId) || new Set();
        names.add(SnmpTrapRefusalShares.toRefusalUserName(user.userName));
        namesByProject.set(projectId, names);
      }
    }

    return namesByProject;
  }

  private static async getDeviceSources(
    probeId: ObjectID,
  ): Promise<Array<SnmpTrapReceiverCredentialSource>> {
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

    return SnmpTrapReceiverUsers.toDeviceSources(devices, carriersByDeviceId);
  }

  private static async getSiteDefaultSources(
    probeId: ObjectID,
  ): Promise<Array<SnmpTrapReceiverCredentialSource>> {
    const sites: Array<NetworkSite> =
      await NetworkDeviceService.findSitesWithSnmpV3DefaultOnProbe({
        probeId: probeId,
        limit: MAX_TRAP_RECEIVER_SITES,
      });

    if (sites.length === 0) {
      return [];
    }

    return SnmpTrapReceiverUsers.toSiteSources(
      sites,
      await NetworkDeviceHydrationUtil.resolveSiteDefaultSnmpV3Carriers(sites),
    );
  }

  private static leaveOut(describedAs: string, what: string): null {
    logger.debug(
      `An SNMPv3 credential of ${describedAs} is not given to its probe's trap receiver: ${what} cannot be read. Its traps are refused until it is corrected, as its polls fail.`,
    );
    return null;
  }
}
