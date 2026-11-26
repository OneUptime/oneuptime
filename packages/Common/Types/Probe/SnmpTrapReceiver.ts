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
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * A PROBE'S SNMP TRAP RECEIVER, AS IT REPORTS ITSELF, AND THE SNMPv3 USERS IT
 * IS HANDED (OneUptime issue #11005).
 *
 * Every probe runs an SNMP trap receiver (Probe/Services/SnmpTrapReceiver).
 * v1 and v2c traps carry a community string and are taken as they come; an
 * SNMPv3 trap is authenticated, and usually encrypted, with a user's keys,
 * so the receiver can only take one from a user it knows. Every thirty
 * seconds the probe reports its receiver to OneUptime
 * (POST /probe/snmp-trap/receiver) and is handed back the SNMPv3 users of
 * the devices assigned to it: their own SNMPv3 credentials, their credential
 * profiles' and their sites' defaults. A credential changed, a profile
 * changed or a device moved to another probe is taken within a minute, and
 * the receiver keeps listening meanwhile.
 *
 * What the probe reports (SnmpTrapReceiverReport) is kept on the probe
 * (Probe.snmpTrapReceiver) for a project's own probes, and read by the
 * probe's page and, through the device's probe, by a device's page:
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
 * receiver tries a user on the devices it belongs to first.
 */
export interface SnmpTrapReceiverUser {
  userName: string;
  securityLevel: SnmpSecurityLevel;
  authProtocol?: SnmpAuthProtocol | undefined;
  authKey?: string | undefined;
  privProtocol?: SnmpPrivProtocol | undefined;
  privKey?: string | undefined;
  addresses: Array<string>;
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
   * dropped. Null when it is not a report at all.
   */
  public static sanitizeReport(value: unknown): SnmpTrapReceiverReport | null {
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
      refusals: SnmpTrapReceiverUtil.sanitizeRefusals(value["refusals"]),
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
   * A stored report as the dashboard and the server read it: the same rules
   * as a fresh one, so a row written by an older server reads safely.
   */
  public static parseReport(value: unknown): SnmpTrapReceiverReport | null {
    return SnmpTrapReceiverUtil.sanitizeReport(value);
  }

  /*
   * The refusals of a report whose source is one of a device's addresses:
   * its hostname, when that is an IP address, and its Other Addresses. A
   * device registered by DNS name is matched by its Other Addresses only -
   * the page does not resolve names.
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

  private static sanitizeRefusals(value: unknown): Array<SnmpTrapRefusal> {
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

      refusals.push({
        sourceAddress: IpCanonicalUtil.canonicalize(sourceAddress),
        reason: reason as SnmpTrapRefusalReason,
        userName:
          typeof userName === "string"
            ? SnmpTrapReceiverUtil.toDisplayableUserName(userName)
            : "",
        count: count,
        firstSeenAt: firstSeenAt,
        lastSeenAt: lastSeenAt,
      });
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
