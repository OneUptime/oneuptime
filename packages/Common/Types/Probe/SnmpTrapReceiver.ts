import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "../Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "../Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpV3CredentialHolderUtil, {
  SnmpV3CredentialHolders,
} from "./SnmpV3CredentialHolders";
import ObjectID from "../ObjectID";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * A PROBE'S SNMP TRAP RECEIVER, AS IT REPORTS ITSELF, AND THE SNMPv3 USERS IT
 * IS HANDED (OneUptime issues #11005, #11172, #11173, #11174, #11406).
 *
 * Every probe runs an SNMP trap receiver (Probe/Services/SnmpTrapReceiver).
 * v1 and v2c traps carry a community string and are taken as they come; an
 * SNMPv3 trap is authenticated, and usually encrypted, with a user's keys,
 * so the receiver can only take one from a user it knows. Every thirty
 * seconds the probe reports its receiver to OneUptime
 * (POST /probe/snmp-trap/receiver) and is handed back the SNMPv3 users it
 * may take traps from (Server/Utils/Monitor/SnmpTrapReceiverUsers):
 *
 *   - the users of the devices assigned to it: their own SNMPv3
 *     credentials, their credential profiles' and their sites' defaults;
 *   - the default credential profile of every site whose Default Probe it
 *     is, so a device not added yet is taken as its neighbours are (#11174).
 *
 * Never another project's: a project's own probe is handed only its
 * project's, and a global probe only those of the projects that assigned it
 * a device or made it a site's Default Probe. Each user comes with the
 * records that hold it (SnmpV3CredentialHolders), which the probe sends back
 * with every trap that user signed. A credential changed, a profile changed
 * or a device moved to another probe is taken within a minute, and the
 * receiver keeps listening meanwhile.
 *
 * What the probe reports (SnmpTrapReceiverReport) is kept on the probe
 * (Probe.snmpTrapReceiver) for a project's own probes, and read by the
 * probe's page and, through the device's probe, by a device's page. A
 * global probe serves many projects, so its report is split as it arrives
 * (#11173): what belongs to no project - whether it is on, its port and its
 * engine ID - is kept on the probe, and each project's refused traps, those
 * from its own devices' addresses, are kept for that project alone
 * (GlobalProbeSnmpTrapReport, SnmpTrapRefusalShares). What it reports:
 *
 *   - its SNMPv3 engine ID, which a device sending informs needs (on Cisco
 *     IOS it is typed in: `snmp-server engineID remote <probe> <id>`);
 *   - how many SNMPv3 users it accepts;
 *   - the SNMPv3 traps it refused, counted per source address, reason and
 *     user name: "12 SNMPv3 traps from 10.20.0.5 failed: unknown user
 *     san-monitor". A refused trap is never forwarded and nothing it carried
 *     is kept or logged - only that it came, from where, as whom, and why it
 *     was refused.
 *
 * OneUptime keeps each refusal with the devices it came from (#11406):
 * every device on the probe that has its source address, as its hostname,
 * one of its Other Addresses or the address its DNS name resolves to - the
 * way a trap is matched to its device. A device's pages read their own
 * refusals by it, so a device added by its DNS name sees them too. The
 * probe never says which devices: it sends addresses, and what it sends
 * is read without them (sanitizeReport); only a report OneUptime kept is
 * read with them (parseReport).
 *
 * The users carry secrets: the probe keeps them in memory only, never on
 * disk and never in a log, as it keeps the credentials it polls with.
 */

// Why an SNMPv3 trap or inform was refused, in RFC 3414's terms (usmStats*).
export enum SnmpTrapRefusalReason {
  // No device on the probe has an SNMPv3 user of that name (usmStatsUnknownUserNames).
  UnknownUser = "unknownUser",
  /*
   * The user is known, but the message's authentication digest matches none
   * of its keys: a wrong authentication passphrase or protocol
   * (usmStatsWrongDigests).
   */
  WrongDigest = "wrongDigest",
  /*
   * Authenticated, but it could not be decrypted: a wrong privacy
   * passphrase or protocol (usmStatsDecryptionErrors).
   */
  DecryptionError = "decryptionError",
  /*
   * Authenticated, but its engine boots and time put it outside the
   * 150-second window: replayed, delayed, or sent by a device whose clock
   * went backwards (usmStatsNotInTimeWindows).
   */
  NotInTimeWindow = "notInTimeWindow",
  /*
   * An inform addressed to another engine ID than the probe's: the device
   * was given a wrong engine ID for the probe (usmStatsUnknownEngineIDs).
   */
  UnknownEngineId = "unknownEngineId",
  /*
   * Sent with less security than the user is configured for: without
   * authentication, or without encryption for an authPriv user
   * (usmStatsUnsupportedSecLevels).
   */
  UnsupportedSecurityLevel = "unsupportedSecurityLevel",
}

export interface SnmpTrapRefusal {
  // Where the refused notifications came from, as a canonical IP address.
  sourceAddress: string;
  reason: SnmpTrapRefusalReason;
  /*
   * The user name they were sent as. Not a secret: SNMPv3 sends it in the
   * clear. Empty when none was given.
   */
  userName: string;
  // How many, since firstSeenAt.
  count: number;
  // ISO dates.
  firstSeenAt: string;
  lastSeenAt: string;
  /*
   * The devices on the probe it came from, by ID, in order (#11406): every
   * device that has its source address - as its hostname, one of its Other
   * Addresses or the address its DNS name resolves to - at most
   * MAX_SNMP_TRAP_REFUSAL_DEVICES. Written by OneUptime as it keeps the
   * report, only ever with devices of the project that reads it, and never
   * taken from a probe. Absent when no device has the address, and from a
   * report kept before #11406.
   */
  deviceIds?: Array<string> | undefined;
}

export interface SnmpTrapReceiverReport {
  /*
   * Whether whoever runs the probe left the receiver on
   * (PROBE_SNMP_TRAP_RECEIVER_ENABLED). A receiver that is off reports
   * nothing else.
   */
  isEnabled: boolean;
  // The UDP port it listens on (PROBE_SNMP_TRAP_RECEIVER_PORT).
  port?: number | undefined;
  /*
   * Why it could not listen on that port, as the system said it (EACCES,
   * EADDRINUSE): nothing reaches it until that is fixed. Absent while it
   * listens.
   */
  listenError?: string | undefined;
  // Its SNMPv3 engine ID, as hex in capitals, 5 to 32 octets.
  engineId?: string | undefined;
  // How many SNMPv3 users it accepts traps and informs from.
  userCount?: number | undefined;
  // The minute it last took a trap or an inform, of any version (ISO date).
  lastReceivedAt?: string | undefined;
  // The SNMPv3 traps it refused, the most recent first.
  refusals: Array<SnmpTrapRefusal>;
}

/*
 * One SNMPv3 user a probe's receiver accepts, as the server hands it over:
 * already read with the parse() the poller uses, so a stored "SHA-256" is
 * SHA256 here and an unset protocol is the poller's default (MD5, DES).
 * `addresses` are the addresses of the devices the user belongs to: the
 * receiver tries a user on the devices it belongs to first. A site's
 * default credential profile belongs to no device yet, and has none.
 */
export interface SnmpTrapReceiverUser {
  userName: string;
  securityLevel: SnmpSecurityLevel;
  authProtocol?: SnmpAuthProtocol | undefined;
  authKey?: string | undefined;
  privProtocol?: SnmpPrivProtocol | undefined;
  privKey?: string | undefined;
  addresses: Array<string>;
  /*
   * The records that hold this credential, sent back with every trap it
   * signs (SnmpTrap.signedBy). Absent from a server older than #11172.
   */
  heldBy?: SnmpV3CredentialHolders | undefined;
}

// RFC 3411: an SnmpEngineID is 5 to 32 octets.
export const MIN_SNMP_ENGINE_ID_OCTETS: number = 5;
export const MAX_SNMP_ENGINE_ID_OCTETS: number = 32;

// RFC 3414: a USM user name is 1 to 32 octets (SnmpAdminString).
export const MAX_SNMP_USER_NAME_LENGTH: number = 32;

/*
 * How many refusals a report carries, and for how long one is kept after
 * it was last seen: the page lists the last day's, the most recent first.
 */
export const MAX_REPORTED_SNMP_TRAP_REFUSALS: number = 50;
export const SNMP_TRAP_REFUSAL_RETENTION_MS: number = 24 * 60 * 60 * 1000;

/*
 * How many devices one refusal names (SnmpTrapRefusal.deviceIds): devices
 * that send from one address - blades behind their chassis, a cluster's
 * members - are a few. Past this many, a device whose page does not find it
 * by its ID still finds it by its typed addresses.
 */
export const MAX_SNMP_TRAP_REFUSAL_DEVICES: number = 25;

// How many users one probe is handed at most, and addresses per user.
export const MAX_SNMP_TRAP_RECEIVER_USERS: number = 5000;
export const MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES: number = 256;

// What a key is at most: a passphrase, never a document.
const MAX_SNMP_KEY_LENGTH: number = 1024;

const ENGINE_ID_HEX: RegExp = /^[0-9A-F]+$/;
const LISTEN_ERROR: RegExp = /^E[A-Z]{2,30}$/;
const HEX_PREFIX: RegExp = /^0x/i;

export default class SnmpTrapReceiverUtil {
  /*
   * An engine ID as the receiver reports it and the page shows it: hex in
   * capitals with no separators - what a device's configuration takes
   * (Cisco's `snmp-server engineID remote` and the others). "0x" in front
   * and colons, spaces or dashes between octets, as people copy them, are
   * read too. Null when it is not 5 to 32 octets of hex.
   */
  public static normalizeEngineId(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    let hex: string = value.trim().replace(/[\s:.-]/g, "");

    if (HEX_PREFIX.test(hex)) {
      hex = hex.substring(2);
    }

    hex = hex.toUpperCase();

    if (!hex || hex.length % 2 !== 0 || !ENGINE_ID_HEX.test(hex)) {
      return null;
    }

    const octets: number = hex.length / 2;

    if (
      octets < MIN_SNMP_ENGINE_ID_OCTETS ||
      octets > MAX_SNMP_ENGINE_ID_OCTETS
    ) {
      return null;
    }

    return hex;
  }

  /*
   * A report as the server keeps it, built from whatever the probe posted:
   * only the fields above, each of the right type and size, unknown keys
   * dropped. Null when it is not a report at all. Which devices a refusal
   * came from is never taken from a probe (#11406): OneUptime works that out
   * itself as it keeps the report, so a probe cannot put a refusal on a
   * device's page by naming the device.
   */
  public static sanitizeReport(value: unknown): SnmpTrapReceiverReport | null {
    return SnmpTrapReceiverUtil.readReport(value, { withDeviceIds: false });
  }

  /*
   * A stored report as the dashboard and the server read it: the same rules
   * as a fresh one, so a row written by an older server reads safely, and
   * with the devices OneUptime found each refusal came from.
   */
  public static parseReport(value: unknown): SnmpTrapReceiverReport | null {
    return SnmpTrapReceiverUtil.readReport(value, { withDeviceIds: true });
  }

  private static readReport(
    value: unknown,
    options: { withDeviceIds: boolean },
  ): SnmpTrapReceiverReport | null {
    if (!SnmpTrapReceiverUtil.isObject(value)) {
      return null;
    }

    if (typeof value["isEnabled"] !== "boolean") {
      return null;
    }

    if (!value["isEnabled"]) {
      return { isEnabled: false, refusals: [] };
    }

    const report: SnmpTrapReceiverReport = {
      isEnabled: true,
      refusals: SnmpTrapReceiverUtil.sanitizeRefusals(
        value["refusals"],
        options,
      ),
    };

    const port: unknown = value["port"];

    if (
      typeof port === "number" &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535
    ) {
      report.port = port;
    }

    const listenError: unknown = value["listenError"];

    if (typeof listenError === "string" && LISTEN_ERROR.test(listenError)) {
      report.listenError = listenError;
    }

    const engineId: string | null = SnmpTrapReceiverUtil.normalizeEngineId(
      value["engineId"],
    );

    if (engineId) {
      report.engineId = engineId;
    }

    const userCount: unknown = value["userCount"];

    if (
      typeof userCount === "number" &&
      Number.isInteger(userCount) &&
      userCount >= 0 &&
      userCount <= MAX_SNMP_TRAP_RECEIVER_USERS
    ) {
      report.userCount = userCount;
    }

    const lastReceivedAt: string | null = SnmpTrapReceiverUtil.readIsoDate(
      value["lastReceivedAt"],
    );

    if (lastReceivedAt) {
      report.lastReceivedAt = lastReceivedAt;
    }

    return report;
  }

  /*
   * What a global probe's report says that belongs to no project, and is
   * kept on the probe for every project that uses it to read (#11173):
   * whether its receiver is on, its port, why it cannot listen, and its
   * SNMPv3 engine ID - which a device sending it informs needs. Not its
   * refusals, which name projects' addresses and user names (each project's
   * are kept for it alone); not how many users it takes, which counts every
   * project's credentials; not when it last took a trap, which says when
   * some project's device last sent one.
   */
  public static toSharedReport(
    report: SnmpTrapReceiverReport,
  ): SnmpTrapReceiverReport {
    if (!report.isEnabled) {
      return { isEnabled: false, refusals: [] };
    }

    const shared: SnmpTrapReceiverReport = { isEnabled: true, refusals: [] };

    if (report.port !== undefined) {
      shared.port = report.port;
    }

    if (report.listenError !== undefined) {
      shared.listenError = report.listenError;
    }

    if (report.engineId !== undefined) {
      shared.engineId = report.engineId;
    }

    return shared;
  }

  /*
   * A device's own refusals, as its pages show them (#11406): those
   * OneUptime found came from the device - which is how a device added by
   * its DNS name finds them, as the page resolves no names - and those from
   * one of its typed addresses, for a report kept before OneUptime said
   * which devices, or a refusal from an address more devices share than one
   * refusal names.
   */
  public static getRefusalsOfDevice(
    report: SnmpTrapReceiverReport | null | undefined,
    device: {
      deviceId: string | null | undefined;
      addresses: Array<string | null | undefined>;
    },
  ): Array<SnmpTrapRefusal> {
    if (!report || report.refusals.length === 0) {
      return [];
    }

    const deviceId: string = (device.deviceId || "").trim().toLowerCase();
    const fromAddresses: Set<SnmpTrapRefusal> = new Set(
      SnmpTrapReceiverUtil.getRefusalsFromAddresses(report, device.addresses),
    );

    return report.refusals.filter((refusal: SnmpTrapRefusal): boolean => {
      return (
        fromAddresses.has(refusal) ||
        Boolean(deviceId && refusal.deviceIds?.includes(deviceId))
      );
    });
  }

  /*
   * The refusals of a report whose source is one of a device's addresses:
   * its hostname, when that is an IP address, and its Other Addresses. A
   * DNS name matches nothing here - nothing is resolved - so a device's
   * pages read their refusals through getRefusalsOfDevice.
   */
  public static getRefusalsFromAddresses(
    report: SnmpTrapReceiverReport | null | undefined,
    addresses: Array<string | null | undefined>,
  ): Array<SnmpTrapRefusal> {
    if (!report || report.refusals.length === 0) {
      return [];
    }

    const canonicalAddresses: Set<string> = new Set();

    for (const address of addresses) {
      const trimmed: string = (address || "").trim();

      if (trimmed && IP.isIP(trimmed)) {
        canonicalAddresses.add(IpCanonicalUtil.canonicalize(trimmed));
      }
    }

    return report.refusals.filter((refusal: SnmpTrapRefusal): boolean => {
      return canonicalAddresses.has(refusal.sourceAddress);
    });
  }

  // How many refused notifications the refusals count together.
  public static countRefused(refusals: Array<SnmpTrapRefusal>): number {
    return refusals.reduce((total: number, refusal: SnmpTrapRefusal) => {
      return total + refusal.count;
    }, 0);
  }

  /*
   * A user the server handed over, as the probe takes it: the right types,
   * a level it can honour, and the keys that level needs. Null when it is
   * not one - the probe leaves it out rather than guess.
   */
  public static sanitizeUser(value: unknown): SnmpTrapReceiverUser | null {
    if (!SnmpTrapReceiverUtil.isObject(value)) {
      return null;
    }

    const userName: unknown = value["userName"];

    if (
      typeof userName !== "string" ||
      userName.length === 0 ||
      userName.length > MAX_SNMP_USER_NAME_LENGTH
    ) {
      return null;
    }

    const securityLevel: SnmpSecurityLevel | undefined =
      SnmpSecurityLevelUtil.parse(
        typeof value["securityLevel"] === "string"
          ? value["securityLevel"]
          : undefined,
      );

    if (!securityLevel) {
      return null;
    }

    const user: SnmpTrapReceiverUser = {
      userName: userName,
      securityLevel: securityLevel,
      addresses: SnmpTrapReceiverUtil.sanitizeAddresses(value["addresses"]),
    };

    const heldBy: SnmpV3CredentialHolders | null =
      SnmpV3CredentialHolderUtil.sanitize(value["heldBy"]);

    if (heldBy) {
      user.heldBy = heldBy;
    }

    if (securityLevel === SnmpSecurityLevel.NoAuthNoPriv) {
      return user;
    }

    const authProtocol: SnmpAuthProtocol | undefined =
      SnmpAuthProtocolUtil.parse(
        typeof value["authProtocol"] === "string"
          ? value["authProtocol"]
          : undefined,
      );
    const authKey: string | null = SnmpTrapReceiverUtil.readKey(
      value["authKey"],
    );

    if (!authProtocol || !authKey) {
      return null;
    }

    user.authProtocol = authProtocol;
    user.authKey = authKey;

    if (securityLevel === SnmpSecurityLevel.AuthNoPriv) {
      return user;
    }

    const privProtocol: SnmpPrivProtocol | undefined =
      SnmpPrivProtocolUtil.parse(
        typeof value["privProtocol"] === "string"
          ? value["privProtocol"]
          : undefined,
      );
    const privKey: string | null = SnmpTrapReceiverUtil.readKey(
      value["privKey"],
    );

    if (!privProtocol || !privKey) {
      return null;
    }

    user.privProtocol = privProtocol;
    user.privKey = privKey;

    return user;
  }

  public static sanitizeUsers(value: unknown): Array<SnmpTrapReceiverUser> {
    if (!Array.isArray(value)) {
      return [];
    }

    const users: Array<SnmpTrapReceiverUser> = [];

    for (const entry of value) {
      if (users.length >= MAX_SNMP_TRAP_RECEIVER_USERS) {
        break;
      }

      const user: SnmpTrapReceiverUser | null =
        SnmpTrapReceiverUtil.sanitizeUser(entry);

      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  /*
   * The devices a stored refusal names: IDs only, in lower case, each once,
   * in order, at most MAX_SNMP_TRAP_REFUSAL_DEVICES. Undefined when it names
   * none, so a refusal no device sent reads as it was written.
   */
  public static sanitizeDeviceIds(value: unknown): Array<string> | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const deviceIds: Set<string> = new Set();

    for (const entry of value) {
      if (typeof entry !== "string") {
        continue;
      }

      const id: string = entry.trim().toLowerCase();

      if (ObjectID.isValidUUID(id)) {
        deviceIds.add(id);
      }
    }

    const sorted: Array<string> = Array.from(deviceIds)
      .sort()
      .slice(0, MAX_SNMP_TRAP_REFUSAL_DEVICES);

    return sorted.length > 0 ? sorted : undefined;
  }

  private static sanitizeRefusals(
    value: unknown,
    options: { withDeviceIds: boolean },
  ): Array<SnmpTrapRefusal> {
    if (!Array.isArray(value)) {
      return [];
    }

    const reasons: Array<string> = Object.values(SnmpTrapRefusalReason);
    const refusals: Array<SnmpTrapRefusal> = [];

    for (const entry of value) {
      if (refusals.length >= MAX_REPORTED_SNMP_TRAP_REFUSALS) {
        break;
      }

      if (!SnmpTrapReceiverUtil.isObject(entry)) {
        continue;
      }

      const sourceAddress: unknown = entry["sourceAddress"];
      const reason: unknown = entry["reason"];
      const userName: unknown = entry["userName"];
      const count: unknown = entry["count"];
      const firstSeenAt: string | null = SnmpTrapReceiverUtil.readIsoDate(
        entry["firstSeenAt"],
      );
      const lastSeenAt: string | null = SnmpTrapReceiverUtil.readIsoDate(
        entry["lastSeenAt"],
      );

      if (
        typeof sourceAddress !== "string" ||
        !IP.isIP(sourceAddress.trim()) ||
        typeof reason !== "string" ||
        !reasons.includes(reason) ||
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        !firstSeenAt ||
        !lastSeenAt
      ) {
        continue;
      }

      const refusal: SnmpTrapRefusal = {
        sourceAddress: IpCanonicalUtil.canonicalize(sourceAddress),
        reason: reason as SnmpTrapRefusalReason,
        userName:
          typeof userName === "string"
            ? SnmpTrapReceiverUtil.toDisplayableUserName(userName)
            : "",
        count: count,
        firstSeenAt: firstSeenAt,
        lastSeenAt: lastSeenAt,
      };

      const deviceIds: Array<string> | undefined = options.withDeviceIds
        ? SnmpTrapReceiverUtil.sanitizeDeviceIds(entry["deviceIds"])
        : undefined;

      if (deviceIds) {
        refusal.deviceIds = deviceIds;
      }

      refusals.push(refusal);
    }

    return refusals.sort((a: SnmpTrapRefusal, b: SnmpTrapRefusal): number => {
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    });
  }

  /*
   * A user name exactly as it was sent, cut to what SNMPv3 allows and with
   * anything that is not printable written as "?": it arrived in a datagram
   * from anyone who can reach the probe, and is shown on a page.
   */
  public static toDisplayableUserName(value: string): string {
    return Array.from(value.substring(0, MAX_SNMP_USER_NAME_LENGTH))
      .map((character: string): string => {
        const code: number = character.codePointAt(0) || 0;
        return code < 0x20 || code === 0x7f ? "?" : character;
      })
      .join("");
  }

  private static sanitizeAddresses(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const addresses: Array<string> = [];

    for (const entry of value) {
      if (addresses.length >= MAX_SNMP_TRAP_RECEIVER_USER_ADDRESSES) {
        break;
      }

      if (typeof entry !== "string" || !IP.isIP(entry.trim())) {
        continue;
      }

      const canonical: string = IpCanonicalUtil.canonicalize(entry);

      if (!addresses.includes(canonical)) {
        addresses.push(canonical);
      }
    }

    return addresses;
  }

  private static readKey(value: unknown): string | null {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_SNMP_KEY_LENGTH
    ) {
      return null;
    }

    return value;
  }

  private static readIsoDate(value: unknown): string | null {
    if (typeof value !== "string" && !(value instanceof Date)) {
      return null;
    }

    const date: Date = value instanceof Date ? value : new Date(value);

    if (isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  private static isObject(value: unknown): value is JSONObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
