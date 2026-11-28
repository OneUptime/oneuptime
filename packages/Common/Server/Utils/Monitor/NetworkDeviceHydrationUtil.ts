import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import NetworkSnmpCredentialProfileService from "../../Services/NetworkSnmpCredentialProfileService";
import MonitorStepSnmpMonitor from "../../../Types/Monitor/MonitorStepSnmpMonitor";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import { SnmpTableWalkRequest } from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SnmpVersion, {
  SnmpVersionUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpV3Auth from "../../../Types/Monitor/SnmpMonitor/SnmpV3Auth";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import ObjectID from "../../../Types/ObjectID";
import IP from "../../../Types/IP/IP";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import NetworkDeviceOtherAddressesUtil from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import {
  SnmpCredentialCarrier,
  hasUsableCredentials,
  isNonEmptyCredential,
  readsLegacySnmpV3Auth,
} from "../../../Utils/NetworkDevice/SnmpCredentialUtil";
import DnsResolutionCache from "./DnsResolutionCache";
import { SnmpTrapSourceTiers } from "./SnmpTrapDeviceSelection";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import logger from "../Logger";

/*
 * How long a probe's answer for one source address is kept: which of its
 * devices an SNMP trap or a syslog message from that address belongs to.
 * A device added, renamed or given another address starts receiving its
 * traps and syslog within this long - the bound syslog and flow records have
 * always had (SyslogDeviceMatcher, NetworkFlowDeviceMatcher).
 */
export const SOURCE_MATCH_CACHE_TTL_MS: number = 60 * 1000;

/*
 * One entry per (probe, source address) a process has heard from, in each
 * process. Fifty thousand covers every device of a large fleet sending traps
 * through one worker; past it the oldest answer is dropped and asked again.
 */
export const SOURCE_MATCH_CACHE_MAX_ENTRIES: number = 50_000;

/*
 * resolveHostnames' bounds (#11406). It runs while a probe waits for its
 * SNMPv3 users, every thirty seconds, so it asks about at most this many
 * names, this many at a time - dns.lookup runs on libuv's small threadpool,
 * which the file system and crypto share - and answers within this long.
 * As many names as a report reads devices (MAX_DNS_NAMED_DEVICES_PER_REPORT):
 * the names come in a stable order, and a cached one answers at once, so
 * each report gets further down a long list than the one before rather
 * than asking about its first names forever.
 */
export const MAX_HOSTNAMES_PER_RESOLVE: number = 5000;
export const HOSTNAME_RESOLVE_CONCURRENCY: number = 8;
export const HOSTNAME_RESOLVE_BUDGET_MS: number = 3000;

/*
 * A device a source address matched, as the cache keeps it: the columns the
 * trap and syslog paths read of it, as plain values, so nothing a caller does
 * to the devices it is handed can reach the next caller.
 */
interface SourceMatchedDevice {
  id: string;
  projectId: string;
  name: string | undefined;
  /*
   * The SNMPv3 context the device is polled in, which tells apart devices
   * that share an address (a Brocade chassis' logical switches) when a
   * trap names its context (SnmpTrapContextRouting).
   */
  snmpV3ContextName: string | undefined;
  /*
   * The engine ID its agent answered its last SNMPv3 poll with, which tells
   * apart devices that send SNMPv3 traps from one address (#11172). Read
   * only by findDeviceTiersByProbeAndSource.
   */
  snmpEngineId?: string | undefined;
}

// findDeviceTiersByProbeAndSource's answer, as the cache keeps it.
interface SourceMatchedTiers {
  hostname: Array<SourceMatchedDevice>;
  otherAddress: Array<SourceMatchedDevice>;
  dns: Array<SourceMatchedDevice>;
}

/*
 * Network Device monitor steps reference a NetworkDevice resource instead of
 * carrying SNMP connection details. Probes are stateless and only understand
 * concrete SNMP config, so before work is handed out the referenced device's
 * hostname/credentials are hydrated into each step's `snmpMonitor` field.
 */
export interface HydratableMonitor {
  id?: ObjectID | null | undefined;
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
}

/*
 * How the assigned probe polls a device on a given cycle.
 *
 *   ping - ICMP reachability only. The device has no usable SNMP
 *          credentials anywhere, so there is nothing to walk it with.
 *   snmp - ICMP reachability AND an SNMP walk, run in parallel. The walk
 *          is never gated on the ping: ICMP-filtered SNMP gear stays Up.
 *
 * The mode travels both ways. The list handler stamps it on every device it
 * hands out (so the probe knows whether to walk), and the probe stamps it on
 * every result it reports (so the server knows whether a missing walk means
 * "not attempted" or "lost"). A result with no mode at all comes from a
 * probe older than ping-first polling, which only ever walked, so the
 * ingest side reads a missing mode as "snmp".
 */
export type NetworkDevicePollMode = "ping" | "snmp";

/*
 * Everything needed to OPEN an SNMP session, as opposed to the three fields
 * that decide whether one is worth opening at all (SnmpCredentialCarrier).
 *
 * Three different rows satisfy this shape and the resolver below picks
 * between them per device: the device's own snmp* columns, the
 * NetworkSnmpCredentialProfile the device points at, and the profile the
 * device's SITE points at. Structural rather than a union of the two models
 * on purpose — the assembly below must not be able to tell which row it was
 * handed, or it would grow a branch that reads one of them differently.
 *
 * `| undefined` is spelled out on every field for the reason
 * SnmpCredentialCarrier documents: the repo compiles with
 * exactOptionalPropertyTypes, and a caller assembling a carrier from a
 * partially selected row hands over explicit undefineds.
 */
export interface SnmpConnectionCredentials extends SnmpCredentialCarrier {
  snmpPort?: number | null | undefined;
  // snmpV3Auth, the pre-column-flattening v3 JSON blob, is the carrier's.
  snmpV3SecurityLevel?: string | null | undefined;
  snmpV3AuthProtocol?: string | null | undefined;
  snmpV3AuthKey?: string | null | undefined;
  snmpV3PrivProtocol?: string | null | undefined;
  snmpV3PrivKey?: string | null | undefined;
}

/*
 * What one device's credentials resolved to, and therefore how it is polled
 * this cycle. `carrier` is whichever row won the resolution order; when
 * nothing usable was found anywhere it is the device's own columns and
 * `pollMode` is "ping", so a caller can always build a config from it
 * without a null check — it simply must not, in ping mode.
 */
export interface ResolvedDeviceSnmpCredentials {
  carrier: SnmpConnectionCredentials;
  pollMode: NetworkDevicePollMode;
}

/*
 * The batch answer. `unresolvedDeviceIds` are devices whose credentials
 * depend on a row this cycle could not read (the profile or site lookup
 * threw). They are NOT in `byDeviceId`, and every caller must skip them for
 * the cycle rather than fall back to the device's own columns: falling back
 * would poll a profile-credentialled device with no credentials at all,
 * which the probe reports as Down and which therefore manufactures an
 * outage out of a database blip.
 */
export interface ResolvedSnmpCredentialsForBatch {
  byDeviceId: Map<string, ResolvedDeviceSnmpCredentials>;
  unresolvedDeviceIds: Set<string>;
}

/*
 * The profiles a batch of devices may inherit credentials from, by ID, and
 * the profile each of their sites names.
 */
interface InheritedCredentialProfiles {
  profilesById: Map<string, NetworkSnmpCredentialProfile>;
  siteProfileIdBySiteId: Map<string, string>;
}

/*
 * What names a credential profile, for the tenancy check: a device (its
 * own, or through its site) or a site (its default). Its project is the one
 * the profile must belong to.
 */
interface CredentialProfileOwner {
  kind: "device" | "site";
  id: string | undefined;
  projectId: string | undefined;
}

export default class NetworkDeviceHydrationUtil {
  /*
   * The poll-time decision: walk the device over SNMP, or only ping it?
   *
   * Purely a function of whether the credential carrier the caller resolved
   * (see resolveSnmpCredentials: the device's own columns, its credential
   * profile, or its site's) has enough to open an SNMP session with - see
   * SnmpCredentialUtil.hasUsableCredentials for what "enough" means. It is
   * deliberately NOT a function of the monitoring method: a Probe device is
   * polled either way, and the method only says whether a probe polls it at
   * all.
   */
  public static resolvePollMode(
    carrier: SnmpCredentialCarrier,
  ): NetworkDevicePollMode {
    return hasUsableCredentials(carrier) ? "snmp" : "ping";
  }

  /*
   * The device columns needed to assemble a probe-executable SNMP config.
   * Shared by monitor hydration below and the device polling claim
   * endpoint, so the two can never drift apart on which credentials they
   * load.
   *
   * `projectId`, `siteId` and `snmpCredentialProfileId` are part of the
   * credential set, not extras: a device's credentials may live on a
   * profile it or its site points at, and a profile is only usable when it
   * belongs to the same project as the device (resolveSnmpCredentials drops
   * it otherwise, and cannot compare what it did not select).
   */
  public static readonly snmpConfigSelect: {
    _id: true;
    projectId: true;
    siteId: true;
    snmpCredentialProfileId: true;
    hostname: true;
    snmpVersion: true;
    snmpCommunityString: true;
    snmpPort: true;
    snmpV3Auth: true;
    snmpV3SecurityLevel: true;
    snmpV3Username: true;
    snmpV3AuthProtocol: true;
    snmpV3AuthKey: true;
    snmpV3PrivProtocol: true;
    snmpV3PrivKey: true;
    snmpV3ContextName: true;
  } = {
    _id: true,
    projectId: true,
    siteId: true,
    snmpCredentialProfileId: true,
    hostname: true,
    snmpVersion: true,
    snmpCommunityString: true,
    snmpPort: true,
    snmpV3Auth: true,
    snmpV3SecurityLevel: true,
    snmpV3Username: true,
    snmpV3AuthProtocol: true,
    snmpV3AuthKey: true,
    snmpV3PrivProtocol: true,
    snmpV3PrivKey: true,
    // The device's, not a credential's: which logical switch it is.
    snmpV3ContextName: true,
  };

  /*
   * The columns a NetworkSnmpCredentialProfile contributes when it is the
   * winning carrier. `projectId` is here for the tenancy comparison, which
   * is the whole reason the profiles are loaded as root.
   */
  private static readonly credentialProfileSelect: {
    _id: true;
    projectId: true;
    snmpVersion: true;
    snmpCommunityString: true;
    snmpPort: true;
    snmpV3SecurityLevel: true;
    snmpV3Username: true;
    snmpV3AuthProtocol: true;
    snmpV3AuthKey: true;
    snmpV3PrivProtocol: true;
    snmpV3PrivKey: true;
  } = {
    _id: true,
    projectId: true,
    snmpVersion: true,
    snmpCommunityString: true,
    snmpPort: true,
    snmpV3SecurityLevel: true,
    snmpV3Username: true,
    snmpV3AuthProtocol: true,
    snmpV3AuthKey: true,
    snmpV3PrivProtocol: true,
    snmpV3PrivKey: true,
  };

  /*
   * Resolves, for a batch of devices, WHICH row each one is walked with -
   * and therefore whether it is walked at all.
   *
   * Resolution order, first row with usable credentials wins:
   *   1. the device's own snmp* columns,
   *   2. the NetworkSnmpCredentialProfile the device points at,
   *   3. the profile the device's SITE points at.
   * With none of the three the device is pinged and never walked, and the
   * carrier handed back is the device itself so the answer is always
   * complete.
   *
   * TENANCY. Both lookups run as root, because a poll batch spans projects
   * and there is no caller tenant to scope to. Root reads mean the FK is
   * NOT a tenancy guarantee, so every profile is compared against the
   * device's own projectId and a mismatch is DROPPED with an error log
   * rather than used. A device pointed at another project's profile is
   * therefore polled with NO credentials (ping) rather than with that
   * project's community string - which is the difference between a device
   * that reads Pending and a cross-tenant credential leak onto the wire.
   *
   * COST. Three queries per batch at the very worst, and zero for the
   * common fleet where every device carries its own credentials: profiles
   * are only looked up for devices that have no usable columns of their
   * own, and sites only for those of them that still have nothing.
   *
   * This is the single resolver for BOTH the poll list handler and monitor
   * hydration, so the walk a probe is told to run and the walk the monitor
   * evaluation believes ran can never be based on different credentials.
   */
  public static async resolveSnmpCredentials(
    devices: Array<NetworkDevice>,
  ): Promise<ResolvedSnmpCredentialsForBatch> {
    const byDeviceId: Map<string, ResolvedDeviceSnmpCredentials> = new Map();
    const unresolvedDeviceIds: Set<string> = new Set();

    /*
     * A device whose own columns already open a session needs nothing read.
     * Everything below is scoped to the rest, so a fleet that never adopted
     * profiles pays for none of this.
     */
    const devicesNeedingLookup: Array<NetworkDevice> = [];

    for (const device of devices) {
      if (!device.id) {
        continue;
      }

      if (hasUsableCredentials(device)) {
        byDeviceId.set(device.id.toString(), {
          carrier: device,
          pollMode: NetworkDeviceHydrationUtil.resolvePollMode(device),
        });
        continue;
      }

      if (device.snmpCredentialProfileId || device.siteId) {
        devicesNeedingLookup.push(device);
        continue;
      }

      // Nothing of its own, nothing to inherit from: pinged only.
      byDeviceId.set(device.id.toString(), {
        carrier: device,
        pollMode: NetworkDeviceHydrationUtil.resolvePollMode(device),
      });
    }

    if (devicesNeedingLookup.length === 0) {
      return {
        byDeviceId: byDeviceId,
        unresolvedDeviceIds: unresolvedDeviceIds,
      };
    }

    let inherited: InheritedCredentialProfiles;

    try {
      inherited =
        await NetworkDeviceHydrationUtil.loadInheritedCredentialProfiles(
          devicesNeedingLookup,
        );
    } catch (err) {
      /*
       * Skip these devices this cycle rather than polling them without the
       * credentials they are configured with.
       *
       * The alternative - falling back to the device's own (empty) columns -
       * would hand the probe a ping-mode device, and a device that has been
       * answering SNMP would silently stop reporting interfaces, inventory
       * and walk health for as long as the lookup keeps failing. Claiming
       * has already advanced nextPollAt, so the cost of skipping is one
       * interval; the cost of guessing is a wrong verdict.
       */
      logger.error(
        `Could not resolve SNMP credential profiles for ${devicesNeedingLookup.length} network device(s); skipping them for this cycle rather than polling them without the credentials they are configured with.`,
      );
      logger.error(err);

      for (const device of devicesNeedingLookup) {
        if (device.id) {
          unresolvedDeviceIds.add(device.id.toString());
        }
      }

      return {
        byDeviceId: byDeviceId,
        unresolvedDeviceIds: unresolvedDeviceIds,
      };
    }

    for (const device of devicesNeedingLookup) {
      const deviceId: string = device.id!.toString();

      const candidates: Array<NetworkSnmpCredentialProfile | undefined> =
        NetworkDeviceHydrationUtil.getInheritedProfiles(device, inherited);

      const winner: NetworkSnmpCredentialProfile | undefined = candidates.find(
        (candidate: NetworkSnmpCredentialProfile | undefined) => {
          return candidate !== undefined && hasUsableCredentials(candidate);
        },
      );

      // No usable row anywhere: the device's own (empty) columns, pinged only.
      const carrier: SnmpConnectionCredentials = winner || device;

      byDeviceId.set(deviceId, {
        carrier: carrier,
        // One definition of "credentials -> mode", asked of the winning row.
        pollMode: NetworkDeviceHydrationUtil.resolvePollMode(carrier),
      });
    }

    return { byDeviceId: byDeviceId, unresolvedDeviceIds: unresolvedDeviceIds };
  }

  /*
   * Every SNMPv3 credential a batch of devices carries, for their probe's
   * trap receiver (OneUptime issue #11005): the device's own, its credential
   * profile's and its site's default - each one that is SNMPv3 with a user
   * name, in that order, not only the one resolveSnmpCredentials picks to
   * poll with. A device polled over v2c may well send its traps as the
   * site's SNMPv3 user, and a trap from it must not be refused for that.
   *
   * The same loading and the same tenancy check as resolveSnmpCredentials:
   * a profile of another project is dropped, loudly. Unlike it, a failed
   * lookup throws: the probe then keeps the users it has rather than being
   * handed a set with some missing, which would refuse their traps.
   */
  public static async resolveSnmpV3Carriers(
    devices: Array<NetworkDevice>,
  ): Promise<Map<string, Array<SnmpConnectionCredentials>>> {
    const inherited: InheritedCredentialProfiles =
      await NetworkDeviceHydrationUtil.loadInheritedCredentialProfiles(
        devices.filter((device: NetworkDevice): boolean => {
          return Boolean(device.snmpCredentialProfileId || device.siteId);
        }),
      );

    const carriersByDeviceId: Map<
      string,
      Array<SnmpConnectionCredentials>
    > = new Map();

    for (const device of devices) {
      if (!device.id) {
        continue;
      }

      const layers: Array<SnmpConnectionCredentials | undefined> = [
        device,
        ...NetworkDeviceHydrationUtil.getInheritedProfiles(device, inherited),
      ];

      const carriers: Array<SnmpConnectionCredentials> = layers.filter(
        (
          carrier: SnmpConnectionCredentials | undefined,
        ): carrier is SnmpConnectionCredentials => {
          return (
            carrier !== undefined &&
            SnmpVersionUtil.isV3(carrier.snmpVersion) &&
            hasUsableCredentials(carrier)
          );
        },
      );

      carriersByDeviceId.set(device.id.toString(), carriers);
    }

    return carriersByDeviceId;
  }

  /*
   * The SNMPv3 credential of each site's own default credential profile,
   * by site ID, for the probe that is those sites' Default Probe (OneUptime
   * issue #11174): what a device added to the site is polled with - and
   * sends its traps as - before anyone has added it. A site whose profile is
   * not SNMPv3 with a user name has none.
   *
   * The same profile read and the same tenancy check as a device's
   * (loadCredentialProfiles, sameProjectProfile): a profile of another
   * project is dropped, loudly. A failed read throws, so the probe keeps the
   * users it has rather than being handed a set with some missing.
   */
  public static async resolveSiteDefaultSnmpV3Carriers(
    sites: Array<NetworkSite>,
  ): Promise<Map<string, SnmpConnectionCredentials>> {
    const profileIds: Array<string> = Array.from(
      new Set(
        sites.flatMap((site: NetworkSite): Array<string> => {
          return site.id && site.snmpCredentialProfileId
            ? [site.snmpCredentialProfileId.toString()]
            : [];
        }),
      ),
    );

    const profilesById: Map<string, NetworkSnmpCredentialProfile> = new Map();

    for (const profile of await NetworkDeviceHydrationUtil.loadCredentialProfiles(
      profileIds,
    )) {
      if (profile.id) {
        profilesById.set(profile.id.toString(), profile);
      }
    }

    const carriersBySiteId: Map<string, SnmpConnectionCredentials> = new Map();

    for (const site of sites) {
      if (!site.id) {
        continue;
      }

      const profile: NetworkSnmpCredentialProfile | undefined =
        NetworkDeviceHydrationUtil.sameProjectProfile({
          owner: {
            kind: "site",
            id: site.id.toString(),
            projectId: site.projectId?.toString(),
          },
          profileId: site.snmpCredentialProfileId?.toString(),
          profilesById: profilesById,
          referencedBy: "site",
        });

      if (
        profile &&
        SnmpVersionUtil.isV3(profile.snmpVersion) &&
        hasUsableCredentials(profile)
      ) {
        carriersBySiteId.set(site.id.toString(), profile);
      }
    }

    return carriersBySiteId;
  }

  /*
   * The profiles a batch of devices may inherit credentials from: the ones
   * the devices name, and the ones their sites name. Two rounds at most, and
   * none for devices that name neither. Throws when a lookup fails; each
   * caller decides what that means for its devices.
   */
  private static async loadInheritedCredentialProfiles(
    devices: Array<NetworkDevice>,
  ): Promise<InheritedCredentialProfiles> {
    const profilesById: Map<string, NetworkSnmpCredentialProfile> = new Map();
    const siteProfileIdBySiteId: Map<string, string> = new Map();

    const deviceProfileIds: Array<string> = Array.from(
      new Set(
        devices.flatMap((device: NetworkDevice): Array<string> => {
          return device.snmpCredentialProfileId
            ? [device.snmpCredentialProfileId.toString()]
            : [];
        }),
      ),
    );

    const siteIds: Array<string> = Array.from(
      new Set(
        devices.flatMap((device: NetworkDevice): Array<string> => {
          return device.siteId ? [device.siteId.toString()] : [];
        }),
      ),
    );

    /*
     * Round one: the profiles the devices name, and the sites they sit in
     * (for the profile those sites name). Issued together because neither
     * depends on the other.
     */
    const [deviceProfiles, sites]: [
      Array<NetworkSnmpCredentialProfile>,
      Array<NetworkSite>,
    ] = await Promise.all([
      NetworkDeviceHydrationUtil.loadCredentialProfiles(deviceProfileIds),
      siteIds.length === 0
        ? Promise.resolve([])
        : NetworkSiteService.findBy({
            query: {
              _id: QueryHelper.any(siteIds),
            },
            select: {
              _id: true,
              projectId: true,
              snmpCredentialProfileId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          }),
    ]);

    for (const profile of deviceProfiles) {
      if (profile.id) {
        profilesById.set(profile.id.toString(), profile);
      }
    }

    for (const site of sites) {
      if (site.id && site.snmpCredentialProfileId) {
        siteProfileIdBySiteId.set(
          site.id.toString(),
          site.snmpCredentialProfileId.toString(),
        );
      }
    }

    /*
     * Round two: the profiles the sites name that were not already loaded
     * as a device's own. Only ever one extra statement, and only when a
     * site actually carries a profile.
     */
    const siteProfileIdsToLoad: Array<string> = Array.from(
      new Set(siteProfileIdBySiteId.values()),
    ).filter((profileId: string) => {
      return !profilesById.has(profileId);
    });

    for (const profile of await NetworkDeviceHydrationUtil.loadCredentialProfiles(
      siteProfileIdsToLoad,
    )) {
      if (profile.id) {
        profilesById.set(profile.id.toString(), profile);
      }
    }

    return {
      profilesById: profilesById,
      siteProfileIdBySiteId: siteProfileIdBySiteId,
    };
  }

  /*
   * A device's inherited profiles, in resolution order: the one it names,
   * then its site's - each only when it exists and is the device's own
   * project's (sameProjectProfile).
   */
  private static getInheritedProfiles(
    device: NetworkDevice,
    inherited: InheritedCredentialProfiles,
  ): Array<NetworkSnmpCredentialProfile | undefined> {
    const owner: CredentialProfileOwner = {
      kind: "device",
      id: device.id?.toString(),
      projectId: device.projectId?.toString(),
    };

    return [
      NetworkDeviceHydrationUtil.sameProjectProfile({
        owner: owner,
        profileId: device.snmpCredentialProfileId?.toString(),
        profilesById: inherited.profilesById,
        referencedBy: "device",
      }),
      NetworkDeviceHydrationUtil.sameProjectProfile({
        owner: owner,
        profileId: device.siteId
          ? inherited.siteProfileIdBySiteId.get(device.siteId.toString())
          : undefined,
        profilesById: inherited.profilesById,
        referencedBy: "site",
      }),
    ];
  }

  private static async loadCredentialProfiles(
    profileIds: Array<string>,
  ): Promise<Array<NetworkSnmpCredentialProfile>> {
    if (profileIds.length === 0) {
      return [];
    }

    return await NetworkSnmpCredentialProfileService.findBy({
      query: {
        _id: QueryHelper.any(profileIds),
      },
      select: NetworkDeviceHydrationUtil.credentialProfileSelect,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The tenancy comparison, in the one place both references pass through.
   * Returns the profile only when it exists AND belongs to the device's
   * project; a cross-project reference is dropped loudly, because the only
   * ways a row can get into that state are corrupted data or a write that
   * predates the guards in NetworkDeviceService/NetworkSiteService - and in
   * either case shipping those credentials to this project's probe is a
   * credential leak, not a degraded poll.
   */
  private static sameProjectProfile(data: {
    owner: CredentialProfileOwner;
    profileId: string | undefined;
    profilesById: Map<string, NetworkSnmpCredentialProfile>;
    referencedBy: "device" | "site";
  }): NetworkSnmpCredentialProfile | undefined {
    if (!data.profileId) {
      return undefined;
    }

    const profile: NetworkSnmpCredentialProfile | undefined =
      data.profilesById.get(data.profileId);

    if (!profile) {
      // Deleted between the device's write and this poll; nothing to log loudly.
      return undefined;
    }

    /*
     * Both sides must be present AND equal. A row missing its projectId is
     * not "unknown, therefore fine": it is a row whose tenancy cannot be
     * established, and the credentials in it are about to be put on a
     * specific project's wire. The only safe reading of an unverifiable
     * reference is to refuse it.
     */
    const isSameProject: boolean = Boolean(
      profile.projectId &&
        data.owner.projectId &&
        profile.projectId.toString() === data.owner.projectId,
    );

    if (!isSameProject) {
      logger.error(
        data.owner.kind === "device"
          ? `Network device ${data.owner.id} resolves (via its ${data.referencedBy}) to SNMP Credential Profile ${data.profileId}, whose project does not match the device's. Dropping the profile: the device is pinged only until the reference is corrected.`
          : `Network site ${data.owner.id} names SNMP Credential Profile ${data.profileId} as its default, whose project does not match the site's. Dropping the profile: no probe is handed it for the site until the reference is corrected.`,
      );
      return undefined;
    }

    return profile;
  }

  /*
   * Assembles the concrete SNMP config a stateless probe can execute.
   *
   * `hostname` and `credentials` are separate parameters, and deliberately
   * so: WHERE to connect always comes from the device, WHAT to connect with
   * comes from whichever row won resolveSnmpCredentials' order. Passing the
   * device for both was the old shape, and it made "poll this device with
   * its site's profile" unrepresentable. The caller chooses what to collect
   * (OIDs / interface walk) — for device polling those come from the
   * device's own snmpOids/walkInterfaces columns.
   *
   * `retries` is left out on purpose. A device (like its site and credential
   * profile) has no retry setting, so there is no user value to carry, and a
   * number restated here means whatever the probe reading it thinks it
   * means. It used to be `retries: 3`, written when probes read it as total
   * attempts; probes now read it as retries after the first attempt, so the
   * same 3 became four attempts per poll. Absent, every probe version lands
   * on three attempts from its own default (older probes `?? 3` total, newer
   * ones two retries), and a failed walk is retried by the next poll cycle
   * anyway. For Network Device monitors and tests, an absent value falls
   * through to the step's retry count and then PROBE_MONITOR_RETRY_LIMIT,
   * like every other monitor type. The timeout is fixed for the same reason:
   * a device has no setting for it.
   */
  public static buildSnmpMonitorConfig(data: {
    hostname: string;
    credentials: SnmpConnectionCredentials;
    oids: Array<SnmpOid>;
    monitorInterfaces: boolean;
    // The device's effective SNMP tables, already reduced to walk requests.
    tables?: Array<SnmpTableWalkRequest> | undefined;
    /*
     * The SNMPv3 context the device is polled in (NetworkDevice
     * .snmpV3ContextName): WHERE on the agent, like the hostname, so it
     * comes from the device whichever row the credentials came from.
     */
    snmpV3ContextName?: string | null | undefined;
  }): MonitorStepSnmpMonitor {
    const snmpVersion: SnmpVersion =
      NetworkDeviceHydrationUtil.parseSnmpVersion(
        data.credentials.snmpVersion || undefined,
      );
    const snmpV3Auth: SnmpV3Auth | undefined =
      NetworkDeviceHydrationUtil.buildSnmpV3Auth(data.credentials);
    const contextName: string | undefined =
      NetworkDeviceHydrationUtil.getSnmpV3ContextName({
        snmpVersion: snmpVersion,
        snmpV3ContextName: data.snmpV3ContextName,
      });

    return {
      snmpVersion: snmpVersion,
      hostname: data.hostname,
      port: data.credentials.snmpPort || 161,
      communityString: data.credentials.snmpCommunityString || undefined,
      snmpV3Auth:
        snmpV3Auth && contextName
          ? { ...snmpV3Auth, contextName: contextName }
          : snmpV3Auth,
      oids: data.oids,
      timeout: 5000,
      monitorInterfaces: data.monitorInterfaces,
      ...(data.tables && data.tables.length > 0 ? { tables: data.tables } : {}),
    };
  }

  /*
   * The context a device is polled in, or undefined: only over SNMPv3 (v1
   * and v2c have none), and only when the device names one.
   */
  public static getSnmpV3ContextName(data: {
    snmpVersion: SnmpVersion | string | null | undefined;
    snmpV3ContextName: string | null | undefined;
  }): string | undefined {
    const version: SnmpVersion = NetworkDeviceHydrationUtil.parseSnmpVersion(
      data.snmpVersion || undefined,
    );

    if (version !== SnmpVersion.V3) {
      return undefined;
    }

    const contextName: string = (data.snmpV3ContextName || "").trim();

    return contextName || undefined;
  }

  /*
   * Parses which NetworkDevice IDs a batch of Network Device monitors
   * reference in their steps (step.data.networkDeviceMonitor.networkDeviceId).
   * Non-NetworkDevice monitors are skipped. Shared by hydration below and by
   * the site rollup engine, which stamps device status on monitor status
   * changes - keep this the single copy of the step-parsing logic.
   */
  public static getReferencedNetworkDeviceIds(
    monitors: Array<HydratableMonitor>,
  ): Array<string> {
    const deviceIds: Set<string> = new Set();

    for (const monitor of monitors) {
      if (monitor.monitorType !== MonitorType.NetworkDevice) {
        continue;
      }

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;
        if (deviceId) {
          deviceIds.add(deviceId);
        }
      }
    }

    return Array.from(deviceIds);
  }

  // Accepts Monitor and MonitorTest alike (structural: monitorType + monitorSteps).
  public static async hydrateNetworkDeviceMonitors(
    monitors: Array<HydratableMonitor>,
  ): Promise<void> {
    const deviceIds: Array<string> =
      NetworkDeviceHydrationUtil.getReferencedNetworkDeviceIds(monitors);

    if (deviceIds.length === 0) {
      return;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        _id: QueryHelper.any(deviceIds),
      },
      select: NetworkDeviceHydrationUtil.snmpConfigSelect,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const devicesById: Map<string, NetworkDevice> = new Map();
    for (const device of devices) {
      if (device.id) {
        devicesById.set(device.id.toString(), device);
      }
    }

    /*
     * The same resolver the poll list handler uses, for the same devices.
     * Sharing it is the point: a device walked with its site's profile must
     * be EVALUATED against that walk too, and two independent readings of
     * "which credentials does this device use" would eventually disagree —
     * silently, and only for the devices that use a profile.
     */
    const resolvedCredentials: ResolvedSnmpCredentialsForBatch =
      await NetworkDeviceHydrationUtil.resolveSnmpCredentials(devices);

    for (const monitor of monitors) {
      if (monitor.monitorType !== MonitorType.NetworkDevice) {
        continue;
      }

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;

        if (!deviceId || !step.data) {
          continue;
        }

        const device: NetworkDevice | undefined = devicesById.get(deviceId);

        if (!device || !device.hostname) {
          logger.warn(
            `Network Device monitor ${monitor.id?.toString()} references missing device ${deviceId}. Step will not be executable.`,
          );
          continue;
        }

        const resolved: ResolvedDeviceSnmpCredentials | undefined =
          resolvedCredentials.byDeviceId.get(deviceId);

        /*
         * Only ever absent when the credential lookup failed this cycle
         * (resolveSnmpCredentials withholds those devices). Leave the step
         * unhydrated rather than assembling a config from the device's own
         * empty columns: the probe would open a session with SnmpMonitor's
         * default "public" community and report a perfectly healthy device
         * as failing its walk.
         */
        if (!resolved) {
          logger.warn(
            `Network Device monitor ${monitor.id?.toString()}: could not resolve SNMP credentials for device ${deviceId} this cycle. Leaving the step unhydrated rather than executing it without credentials.`,
          );
          continue;
        }

        /*
         * Legacy path: reads the step's own (deprecated) oids and
         * monitorInterfaces. Only monitor TESTS still flow through here —
         * regular Network Device monitors are no longer probe-executed
         * (the device polls itself; see NetworkDevicePollUtil).
         */
        step.data.snmpMonitor =
          NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
            hostname: device.hostname,
            credentials: resolved.carrier,
            oids: step.data.networkDeviceMonitor?.oids || [],
            monitorInterfaces:
              step.data.networkDeviceMonitor?.monitorInterfaces !== false,
            snmpV3ContextName: device.snmpV3ContextName,
          });
      }
    }
  }

  /*
   * Assembles the SnmpV3Auth object the probe expects. Prefers the flattened
   * snmpV3* columns (the current storage), falling back to the deprecated
   * snmpV3Auth JSON column so devices created before the columns existed keep
   * working. Returns undefined when no v3 username is configured.
   *
   * The protocol columns are passed through as stored, on purpose. It is
   * tempting to validate them here with SnmpSecurityLevelUtil /
   * SnmpAuthProtocolUtil / SnmpPrivProtocolUtil, but this runs server-side
   * inside the probe's monitor-list request, and that request claims its
   * monitors — advancing nextPingAt — before hydration runs. A throw here
   * would 500 the whole batch, so one malformed row would stall up to a
   * hundred unrelated monitors of every type, every cycle, with nothing
   * recorded against them.
   *
   * The probe validates instead, in SnmpMonitor.buildV3User, where a bad value
   * fails exactly one monitor and shows up as its failure cause. Parsing here
   * would defeat that by folding an unreadable value into undefined, which the
   * probe cannot tell from "never configured" — and would therefore poll with
   * a silently defaulted algorithm.
   *
   * Public for the probe's trap receiver users (SnmpTrapReceiverUsers), so a
   * trap is authenticated with exactly the credential a poll would use.
   */
  public static buildSnmpV3Auth(
    credentials: SnmpConnectionCredentials,
  ): SnmpV3Auth | undefined {
    /*
     * The same test hasUsableCredentials makes, so a device whose column
     * holds only whitespace is walked with the legacy object it was decided
     * on, not with that whitespace.
     */
    if (isNonEmptyCredential(credentials.snmpV3Username)) {
      return {
        securityLevel:
          (credentials.snmpV3SecurityLevel as SnmpSecurityLevel) ||
          SnmpSecurityLevel.NoAuthNoPriv,
        username: credentials.snmpV3Username,
        authProtocol:
          (credentials.snmpV3AuthProtocol as SnmpAuthProtocol | undefined) ||
          undefined,
        authKey: credentials.snmpV3AuthKey || undefined,
        privProtocol:
          (credentials.snmpV3PrivProtocol as SnmpPrivProtocol | undefined) ||
          undefined,
        privKey: credentials.snmpV3PrivKey || undefined,
      };
    }

    /*
     * Legacy devices stored the whole object in the snmpV3Auth JSON column.
     * Only devices ever had it — a credential profile is newer than the
     * flattened columns — so this branch is unreachable for a profile
     * carrier, which is exactly why the field is optional on the interface.
     * hasUsableCredentials counts its username too (#9268), so such a device
     * is walked with it rather than pinged; the MoveLegacySnmpV3AuthToColumns
     * data migration moved every one stored before into the columns.
     */
    if (readsLegacySnmpV3Auth(credentials)) {
      return credentials.snmpV3Auth as unknown as SnmpV3Auth;
    }

    return undefined;
  }

  // Tolerates both enum values ("2c") and enum keys ("V2c") in stored config.
  private static parseSnmpVersion(value: string | undefined): SnmpVersion {
    return SnmpVersionUtil.parse(value);
  }

  /*
   * Which NetworkDevices (polled by the given probe) a datagram's source
   * address belongs to - SNMP traps and probe-forwarded syslog both ask
   * here, on every trap and every message - by the rules of
   * lookupDevicesByProbeAndSource, answered from a per-process cache.
   *
   * Each answer is kept for SOURCE_MATCH_CACHE_TTL_MS, and an address that
   * is no device's is kept too. Without the cache, every trap from an
   * address no device has as its hostname - a device that sends from its
   * loopback, one registered by DNS name, or one nobody added - read every
   * device the probe polls (up to 10,000 rows) and resolved their DNS names,
   * once per trap. Concurrent asks for an address not yet cached share one
   * lookup, so a burst of traps from one sender costs one read.
   *
   * The devices handed back carry `_id`, `projectId`, `name` (traps log
   * the name) and `snmpV3ContextName` (a trap's context picks among
   * devices that share an address), and are the caller's own: changing one
   * changes no other caller's. `select` is accepted for the callers that
   * still pass it; both are always read.
   */
  public static async findDevicesByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
    select?:
      | {
          name?: boolean | undefined;
          snmpV3ContextName?: boolean | undefined;
        }
      | undefined;
  }): Promise<Array<NetworkDevice>> {
    const address: string = data.sourceIpAddress.trim();
    const key: string = `${data.probeId.toString()}|${address}`;

    const cached: Array<SourceMatchedDevice> | undefined =
      NetworkDeviceHydrationUtil.sourceMatchCache.get(key);

    if (cached) {
      return NetworkDeviceHydrationUtil.toSourceMatchedModels(cached);
    }

    let lookup: Promise<Array<SourceMatchedDevice>> | undefined =
      NetworkDeviceHydrationUtil.sourceMatchesInFlight.get(key);

    if (!lookup) {
      lookup = NetworkDeviceHydrationUtil.lookupAndCacheSourceMatches({
        key: key,
        probeId: data.probeId,
        sourceIpAddress: address,
      });

      NetworkDeviceHydrationUtil.sourceMatchesInFlight.set(key, lookup);
    }

    return NetworkDeviceHydrationUtil.toSourceMatchedModels(await lookup);
  }

  /*
   * Every device on a probe that has a trap's source address, by how it has
   * it (OneUptime issue #11172): its hostname, one of its Other Addresses,
   * or a DNS name that resolves to it. What an SNMPv3 trap the probe
   * authenticated is matched by (SnmpTrapDeviceSelection), which tells apart
   * devices that share an address - so, unlike findDevicesByProbeAndSource,
   * it reads the devices that list the address among their Other Addresses
   * even when one has it as its hostname: a NAT gateway registered at the
   * address and the devices behind it, or a chassis and its blades.
   *
   * Two reads by the address - the hostname, and the Other Addresses that
   * hold it - and, when neither finds a device, the fallback the trap path
   * has always had (an IPv6 hostname written another way, a DNS name).
   * Cached as findDevicesByProbeAndSource is, for as long, each device with
   * its SNMP engine ID besides; a lookup that fails is not cached.
   */
  public static async findDeviceTiersByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
  }): Promise<SnmpTrapSourceTiers> {
    const address: string = data.sourceIpAddress.trim();
    const key: string = `${data.probeId.toString()}|${address}`;

    const cached: SourceMatchedTiers | undefined =
      NetworkDeviceHydrationUtil.sourceTierCache.get(key);

    if (cached) {
      return NetworkDeviceHydrationUtil.toSourceMatchedTiers(cached);
    }

    let lookup: Promise<SourceMatchedTiers> | undefined =
      NetworkDeviceHydrationUtil.sourceTiersInFlight.get(key);

    if (!lookup) {
      lookup = NetworkDeviceHydrationUtil.lookupAndCacheSourceTiers({
        key: key,
        probeId: data.probeId,
        sourceIpAddress: address,
      });

      NetworkDeviceHydrationUtil.sourceTiersInFlight.set(key, lookup);
    }

    return NetworkDeviceHydrationUtil.toSourceMatchedTiers(await lookup);
  }

  // Forget every cached source-address answer (tests; SyslogDeviceMatcher).
  public static clearSourceMatchCache(): void {
    NetworkDeviceHydrationUtil.sourceMatchCache.clear();
    NetworkDeviceHydrationUtil.sourceMatchesInFlight.clear();
    NetworkDeviceHydrationUtil.sourceTierCache.clear();
    NetworkDeviceHydrationUtil.sourceTiersInFlight.clear();
  }

  private static async lookupAndCacheSourceTiers(data: {
    key: string;
    probeId: ObjectID;
    sourceIpAddress: string;
  }): Promise<SourceMatchedTiers> {
    try {
      const found: SnmpTrapSourceTiers =
        await NetworkDeviceHydrationUtil.lookupDeviceTiersByProbeAndSource({
          probeId: data.probeId,
          sourceIpAddress: data.sourceIpAddress,
        });

      const tiers: SourceMatchedTiers = {
        hostname: NetworkDeviceHydrationUtil.toSourceMatched(found.hostname),
        otherAddress: NetworkDeviceHydrationUtil.toSourceMatched(
          found.otherAddress,
        ),
        dns: NetworkDeviceHydrationUtil.toSourceMatched(found.dns),
      };

      NetworkDeviceHydrationUtil.sourceTierCache.set(
        data.key,
        tiers,
        SOURCE_MATCH_CACHE_TTL_MS,
      );

      return tiers;
    } finally {
      NetworkDeviceHydrationUtil.sourceTiersInFlight.delete(data.key);
    }
  }

  // Reads the database every time; findDeviceTiersByProbeAndSource caches it.
  public static async lookupDeviceTiersByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
  }): Promise<SnmpTrapSourceTiers> {
    const select: {
      _id: true;
      projectId: true;
      name: true;
      snmpV3ContextName: true;
      snmpEngineId: true;
    } = {
      _id: true,
      projectId: true,
      name: true,
      snmpV3ContextName: true,
      snmpEngineId: true,
    };

    const canonicalSource: string = IP.isIP(data.sourceIpAddress)
      ? IpCanonicalUtil.canonicalize(data.sourceIpAddress)
      : "";

    const [hostnameMatches, listingTheAddress]: [
      Array<NetworkDevice>,
      Array<NetworkDevice>,
    ] = await Promise.all([
      NetworkDeviceService.findBy({
        query: {
          probeId: data.probeId,
          hostname: data.sourceIpAddress,
        },
        select: select,
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      canonicalSource
        ? NetworkDeviceService.findBy({
            query: {
              probeId: data.probeId,
              otherAddresses: QueryHelper.search(canonicalSource),
            },
            select: {
              ...select,
              otherAddresses: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const hostnameIds: Set<string> = new Set(
      hostnameMatches.map((device: NetworkDevice): string => {
        return device.id?.toString() || "";
      }),
    );

    // The text search finds 10.0.0.50 for 10.0.0.5: each address is compared whole.
    const otherAddressMatches: Array<NetworkDevice> = listingTheAddress.filter(
      (device: NetworkDevice): boolean => {
        return (
          !hostnameIds.has(device.id?.toString() || "") &&
          Boolean(device.otherAddresses) &&
          NetworkDeviceOtherAddressesUtil.includes(
            device.otherAddresses!,
            canonicalSource,
          )
        );
      },
    );

    if (hostnameMatches.length > 0 || otherAddressMatches.length > 0) {
      return {
        hostname: hostnameMatches,
        otherAddress: otherAddressMatches,
        dns: [],
      };
    }

    /*
     * Neither: an IPv6 hostname written another way than the datagram's
     * address, or a DNS name that resolves to it - what the trap path's
     * fallback has always found, told apart by whether the hostname is an
     * address.
     */
    const fallback: Array<NetworkDevice> =
      await NetworkDeviceHydrationUtil.lookupDevicesByProbeAndSource({
        probeId: data.probeId,
        sourceIpAddress: data.sourceIpAddress,
        select: {
          name: true,
          snmpV3ContextName: true,
          snmpEngineId: true,
        },
      });

    return {
      hostname: fallback.filter((device: NetworkDevice): boolean => {
        return IP.isIP((device.hostname || "").trim());
      }),
      otherAddress: [],
      dns: fallback.filter((device: NetworkDevice): boolean => {
        return !IP.isIP((device.hostname || "").trim());
      }),
    };
  }

  private static toSourceMatched(
    devices: Array<NetworkDevice>,
  ): Array<SourceMatchedDevice> {
    const matched: Array<SourceMatchedDevice> = [];

    for (const device of devices) {
      if (!device.id || !device.projectId) {
        continue;
      }

      matched.push({
        id: device.id.toString(),
        projectId: device.projectId.toString(),
        name: typeof device.name === "string" ? device.name : undefined,
        snmpV3ContextName:
          typeof device.snmpV3ContextName === "string"
            ? device.snmpV3ContextName
            : undefined,
        snmpEngineId:
          typeof device.snmpEngineId === "string"
            ? device.snmpEngineId
            : undefined,
      });
    }

    return matched;
  }

  private static toSourceMatchedTiers(
    tiers: SourceMatchedTiers,
  ): SnmpTrapSourceTiers {
    return {
      hostname: NetworkDeviceHydrationUtil.toSourceMatchedModels(
        tiers.hostname,
      ),
      otherAddress: NetworkDeviceHydrationUtil.toSourceMatchedModels(
        tiers.otherAddress,
      ),
      dns: NetworkDeviceHydrationUtil.toSourceMatchedModels(tiers.dns),
    };
  }

  private static async lookupAndCacheSourceMatches(data: {
    key: string;
    probeId: ObjectID;
    sourceIpAddress: string;
  }): Promise<Array<SourceMatchedDevice>> {
    try {
      const found: Array<NetworkDevice> =
        await NetworkDeviceHydrationUtil.lookupDevicesByProbeAndSource({
          probeId: data.probeId,
          sourceIpAddress: data.sourceIpAddress,
          select: {
            name: true,
            snmpV3ContextName: true,
          },
        });

      const matched: Array<SourceMatchedDevice> =
        NetworkDeviceHydrationUtil.toSourceMatched(found);

      /*
       * A lookup that failed is not cached (it throws past this), so the
       * next trap asks again instead of being matched to nobody for a
       * minute.
       */
      NetworkDeviceHydrationUtil.sourceMatchCache.set(
        data.key,
        matched,
        SOURCE_MATCH_CACHE_TTL_MS,
      );

      return matched;
    } finally {
      NetworkDeviceHydrationUtil.sourceMatchesInFlight.delete(data.key);
    }
  }

  private static toSourceMatchedModels(
    matched: Array<SourceMatchedDevice>,
  ): Array<NetworkDevice> {
    return matched.map((entry: SourceMatchedDevice): NetworkDevice => {
      const device: NetworkDevice = new NetworkDevice(new ObjectID(entry.id));

      device.projectId = new ObjectID(entry.projectId);

      if (entry.name !== undefined) {
        device.name = entry.name;
      }

      if (entry.snmpV3ContextName !== undefined) {
        device.snmpV3ContextName = entry.snmpV3ContextName;
      }

      if (entry.snmpEngineId !== undefined) {
        device.snmpEngineId = entry.snmpEngineId;
      }

      return device;
    });
  }

  /*
   * Resolves which NetworkDevices (polled by the given probe) match a
   * datagram source IP, reading the database every time: SNMP traps and
   * probe-forwarded syslog ask through findDevicesByProbeAndSource, which
   * caches this; flow records through NetworkFlowDeviceMatcher, which
   * caches its own answer. Exact hostname == source-IP match first; devices
   * registered by DNS name are matched by resolving their hostnames
   * through a shared positive/negative cache, so a device added as
   * "switch-01.example.com" still receives its traps and syslog.
   */
  public static async lookupDevicesByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
    /*
     * Extra columns callers need (syslog attribution wants `name`; trap
     * routing `snmpV3ContextName`, and an SNMPv3 trap `snmpEngineId`).
     */
    select?:
      | {
          name?: boolean | undefined;
          snmpV3ContextName?: boolean | undefined;
          snmpEngineId?: boolean | undefined;
        }
      | undefined;
  }): Promise<Array<NetworkDevice>> {
    const select: {
      _id: boolean;
      projectId: boolean;
      name?: boolean | undefined;
      snmpV3ContextName?: boolean | undefined;
      snmpEngineId?: boolean | undefined;
    } = {
      _id: true,
      projectId: true,
      ...(data.select?.name ? { name: true } : {}),
      ...(data.select?.snmpV3ContextName ? { snmpV3ContextName: true } : {}),
      ...(data.select?.snmpEngineId ? { snmpEngineId: true } : {}),
    };

    const exactMatches: Array<NetworkDevice> =
      await NetworkDeviceService.findBy({
        query: {
          probeId: data.probeId,
          hostname: data.sourceIpAddress,
        },
        select: select,
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (exactMatches.length > 0) {
      return exactMatches;
    }

    /*
     * Fallback for what the exact match cannot see:
     * (a) IPv6-literal hostnames written differently than the datagram's
     *     normalized source (2001:DB8::1 vs 2001:db8::1) — compared
     *     canonically,
     * (b) a device that sends from another of its addresses (a loopback,
     *     the interface facing the probe) listed in its Other Addresses,
     *     and
     * (c) DNS-named devices — resolved through a shared cache and their
     *     addresses compared canonically.
     * Only runs when the exact match found nothing, in that order: what
     * someone typed wins over what DNS says.
     */
    const candidates: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        probeId: data.probeId,
      },
      select: {
        ...select,
        hostname: true,
        otherAddresses: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const canonicalSource: string = IpCanonicalUtil.canonicalize(
      data.sourceIpAddress,
    );

    const literalMatches: Array<NetworkDevice> = [];
    const otherAddressMatches: Array<NetworkDevice> = [];
    const dnsCandidates: Array<NetworkDevice> = [];

    for (const device of candidates) {
      const hostname: string = device.hostname?.trim() || "";

      if (
        device.otherAddresses &&
        NetworkDeviceOtherAddressesUtil.includes(
          device.otherAddresses,
          canonicalSource,
        )
      ) {
        otherAddressMatches.push(device);
        continue;
      }

      if (!hostname) {
        continue;
      }

      if (IP.isIP(hostname)) {
        if (IpCanonicalUtil.canonicalize(hostname) === canonicalSource) {
          literalMatches.push(device);
        }
        continue;
      }

      dnsCandidates.push(device);
    }

    if (literalMatches.length > 0) {
      return literalMatches;
    }

    if (otherAddressMatches.length > 0) {
      return otherAddressMatches;
    }

    /*
     * DNS resolution runs in parallel (deduplicated per hostname) so a
     * cold cache with a slow resolver costs one lookup timeout, not one
     * per device — this is on the trap/syslog ingest path.
     */
    const uniqueHostnames: Array<string> = [
      ...new Set(
        dnsCandidates.map((device: NetworkDevice) => {
          return device.hostname!.trim().toLowerCase();
        }),
      ),
    ];

    const addressesByHostname: Map<string, Array<string>> = new Map(
      await Promise.all(
        uniqueHostnames.map(
          async (hostname: string): Promise<[string, Array<string>]> => {
            return [
              hostname,
              await NetworkDeviceHydrationUtil.dnsCache.resolve(hostname),
            ];
          },
        ),
      ),
    );

    return dnsCandidates.filter((device: NetworkDevice) => {
      const addresses: Array<string> =
        addressesByHostname.get(device.hostname!.trim().toLowerCase()) || [];

      return addresses.some((address: string) => {
        return IpCanonicalUtil.canonicalize(address) === canonicalSource;
      });
    });
  }

  /*
   * The addresses DNS names resolve to, the way trap matching resolves a
   * device's DNS name (lookupDevicesByProbeAndSource): through the same
   * cache, five minutes for an answer and for a failure alike, so a probe
   * that reports every thirty seconds asks the resolver about each name
   * about once in five minutes. What a probe's refused SNMPv3 traps are
   * matched to their devices by (#11406).
   *
   * Bounded, as it runs while a probe waits: at most
   * MAX_HOSTNAMES_PER_RESOLVE names, the first in the order given;
   * HOSTNAME_RESOLVE_CONCURRENCY lookups at a time; and an answer within
   * `budgetInMs`. A name not answered by then is left out of this answer -
   * as a name that does not resolve is - and its lookup still lands in the
   * cache for the next one.
   *
   * By name in lower case, each address canonical; a name that resolved to
   * nothing maps to no addresses. Never throws.
   */
  public static async resolveHostnames(data: {
    hostnames: Array<string>;
    budgetInMs?: number | undefined;
  }): Promise<Map<string, Array<string>>> {
    const hostnames: Array<string> = Array.from(
      new Set(
        data.hostnames
          .map((hostname: string): string => {
            return (hostname || "").trim().toLowerCase();
          })
          .filter((hostname: string): boolean => {
            return hostname.length > 0 && !IP.isIP(hostname);
          }),
      ),
    ).slice(0, MAX_HOSTNAMES_PER_RESOLVE);

    const resolved: Map<string, Array<string>> = new Map();

    if (hostnames.length === 0) {
      return resolved;
    }

    let next: number = 0;
    let isAnswered: boolean = false;

    const work: () => Promise<void> = async (): Promise<void> => {
      while (!isAnswered && next < hostnames.length) {
        const hostname: string = hostnames[next]!;
        next++;

        let addresses: Array<string> = [];

        try {
          addresses =
            await NetworkDeviceHydrationUtil.dnsCache.resolve(hostname);
        } catch {
          // The cache answers failures as no addresses; so does this.
        }

        if (isAnswered) {
          return;
        }

        resolved.set(
          hostname,
          Array.from(
            new Set(
              addresses
                .filter((address: string): boolean => {
                  return IP.isIP((address || "").trim());
                })
                .map((address: string): string => {
                  return IpCanonicalUtil.canonicalize(address.trim());
                }),
            ),
          ),
        );
      }
    };

    let spendBudget: () => void = (): void => {};

    const budget: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        spendBudget = resolve;
      },
    );

    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => {
        spendBudget();
      },
      Math.max(0, data.budgetInMs ?? HOSTNAME_RESOLVE_BUDGET_MS),
    );

    // Never keep the process alive just for this timer.
    timer.unref?.();

    const workers: Array<Promise<void>> = [];

    for (
      let index: number = 0;
      index < Math.min(HOSTNAME_RESOLVE_CONCURRENCY, hostnames.length);
      index++
    ) {
      workers.push(work());
    }

    await Promise.race([Promise.all(workers), budget]);

    isAnswered = true;
    clearTimeout(timer);

    return resolved;
  }

  // Shared across trap and syslog ingest; 5-minute TTL, failure-cached.
  private static dnsCache: DnsResolutionCache = new DnsResolutionCache();

  // findDevicesByProbeAndSource's answers, by "probeId|address".
  private static sourceMatchCache: InMemoryTTLCache<
    Array<SourceMatchedDevice>
  > = new InMemoryTTLCache(SOURCE_MATCH_CACHE_MAX_ENTRIES);

  // The lookups under way, so concurrent asks for one address share one.
  private static sourceMatchesInFlight: Map<
    string,
    Promise<Array<SourceMatchedDevice>>
  > = new Map();

  // findDeviceTiersByProbeAndSource's answers, by "probeId|address".
  private static sourceTierCache: InMemoryTTLCache<SourceMatchedTiers> =
    new InMemoryTTLCache(SOURCE_MATCH_CACHE_MAX_ENTRIES);

  private static sourceTiersInFlight: Map<string, Promise<SourceMatchedTiers>> =
    new Map();
}
