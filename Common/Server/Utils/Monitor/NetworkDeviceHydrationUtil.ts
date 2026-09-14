import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import NetworkSnmpCredentialProfileService from "../../Services/NetworkSnmpCredentialProfileService";
import MonitorStepSnmpMonitor from "../../../Types/Monitor/MonitorStepSnmpMonitor";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
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
import { JSONObject } from "../../../Types/JSON";
import IP from "../../../Types/IP/IP";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import {
  SnmpCredentialCarrier,
  hasUsableCredentials,
} from "../../../Utils/NetworkDevice/SnmpCredentialUtil";
import DnsResolutionCache from "./DnsResolutionCache";
import logger from "../Logger";

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
  // Only devices have this: the pre-column-flattening v3 JSON blob.
  snmpV3Auth?: JSONObject | null | undefined;
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

    const profilesById: Map<string, NetworkSnmpCredentialProfile> = new Map();
    const siteProfileIdBySiteId: Map<string, string> = new Map();

    try {
      const deviceProfileIds: Array<string> = Array.from(
        new Set(
          devicesNeedingLookup.flatMap(
            (device: NetworkDevice): Array<string> => {
              return device.snmpCredentialProfileId
                ? [device.snmpCredentialProfileId.toString()]
                : [];
            },
          ),
        ),
      );

      const siteIds: Array<string> = Array.from(
        new Set(
          devicesNeedingLookup.flatMap(
            (device: NetworkDevice): Array<string> => {
              return device.siteId ? [device.siteId.toString()] : [];
            },
          ),
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

      const candidates: Array<NetworkSnmpCredentialProfile | undefined> = [
        NetworkDeviceHydrationUtil.sameProjectProfile({
          device: device,
          profileId: device.snmpCredentialProfileId?.toString(),
          profilesById: profilesById,
          referencedBy: "device",
        }),
        NetworkDeviceHydrationUtil.sameProjectProfile({
          device: device,
          profileId: device.siteId
            ? siteProfileIdBySiteId.get(device.siteId.toString())
            : undefined,
          profilesById: profilesById,
          referencedBy: "site",
        }),
      ];

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
    device: NetworkDevice;
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
        data.device.projectId &&
        profile.projectId.toString() === data.device.projectId.toString(),
    );

    if (!isSameProject) {
      logger.error(
        `Network device ${data.device.id?.toString()} resolves (via its ${data.referencedBy}) to SNMP Credential Profile ${data.profileId}, whose project does not match the device's. Dropping the profile: the device is pinged only until the reference is corrected.`,
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
   */
  public static buildSnmpMonitorConfig(data: {
    hostname: string;
    credentials: SnmpConnectionCredentials;
    oids: Array<SnmpOid>;
    monitorInterfaces: boolean;
  }): MonitorStepSnmpMonitor {
    return {
      snmpVersion: NetworkDeviceHydrationUtil.parseSnmpVersion(
        data.credentials.snmpVersion || undefined,
      ),
      hostname: data.hostname,
      port: data.credentials.snmpPort || 161,
      communityString: data.credentials.snmpCommunityString || undefined,
      snmpV3Auth: NetworkDeviceHydrationUtil.buildSnmpV3Auth(data.credentials),
      oids: data.oids,
      timeout: 5000,
      retries: 3,
      monitorInterfaces: data.monitorInterfaces,
    };
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
   */
  private static buildSnmpV3Auth(
    credentials: SnmpConnectionCredentials,
  ): SnmpV3Auth | undefined {
    if (credentials.snmpV3Username) {
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
     */
    const legacy: SnmpV3Auth | undefined = credentials.snmpV3Auth as
      | SnmpV3Auth
      | undefined;
    if (legacy && legacy.username) {
      return legacy;
    }

    return undefined;
  }

  // Tolerates both enum values ("2c") and enum keys ("V2c") in stored config.
  private static parseSnmpVersion(value: string | undefined): SnmpVersion {
    return SnmpVersionUtil.parse(value);
  }

  /*
   * Resolves which NetworkDevices (polled by the given probe) match a
   * datagram source IP — SNMP traps and probe-forwarded syslog both route
   * through here. Exact hostname == source-IP match first; devices
   * registered by DNS name are matched by resolving their hostnames
   * through a shared positive/negative cache, so a device added as
   * "switch-01.example.com" still receives its traps and syslog.
   */
  public static async findDevicesByProbeAndSource(data: {
    probeId: ObjectID;
    sourceIpAddress: string;
    // Extra columns callers need (syslog attribution wants `name`).
    select?: { name?: boolean | undefined } | undefined;
  }): Promise<Array<NetworkDevice>> {
    const select: {
      _id: boolean;
      projectId: boolean;
      name?: boolean | undefined;
    } = {
      _id: true,
      projectId: true,
      ...(data.select?.name ? { name: true } : {}),
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
     * Fallback for the two spellings the exact match cannot see:
     * (a) IPv6-literal hostnames written differently than the datagram's
     *     normalized source (2001:DB8::1 vs 2001:db8::1) — compared
     *     canonically, and
     * (b) DNS-named devices — resolved through a shared cache and their
     *     addresses compared canonically.
     * Only runs when the exact match found nothing.
     */
    const candidates: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        probeId: data.probeId,
      },
      select: {
        ...select,
        hostname: true,
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
    const dnsCandidates: Array<NetworkDevice> = [];

    for (const device of candidates) {
      const hostname: string = device.hostname?.trim() || "";

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

  // Shared across trap and syslog ingest; 5-minute TTL, failure-cached.
  private static dnsCache: DnsResolutionCache = new DnsResolutionCache();
}
