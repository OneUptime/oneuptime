import { JSONObject } from "../../Types/JSON";
import SnmpDataType from "../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpOidListUtil from "../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import SnmpVersion from "../../Types/Monitor/SnmpMonitor/SnmpVersion";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH,
  SNMP_WALK_MAX_OID_LENGTH,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_VALUE_LENGTH,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailure,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "../../Types/NetworkDevice/NetworkDeviceSnmpWalk";

/*
 * Where a walk starts, as the server stores it: the subtree to walk, and,
 * for a walk that continues another, the OID it continues after.
 */
export interface SnmpWalkStart {
  rootOid: string;
  afterOid?: string | undefined;
}

/*
 * Why a requested start was refused - in the words the person reads, since
 * the service throws them back to the dashboard as they are.
 */
export const SNMP_WALK_INVALID_ROOT_MESSAGE: string =
  "The starting OID must be a numeric OID such as 1.3.6.1.2.1.1, not a MIB name.";
export const SNMP_WALK_INVALID_AFTER_MESSAGE: string =
  "The OID to continue after must be a numeric OID inside the subtree being walked.";

const NUL_CHARACTER: string = String.fromCharCode(0);

/*
 * The pure half of an SNMP walk (issue #5184), shared by the probe that
 * walks, the server that stores what it read, and the dashboard that shows
 * it: OID order, where a walk starts, and the check every probe report goes
 * through before it is stored.
 */
export default class SnmpWalkResultUtil {
  /*
   * Compares two dotted OIDs arc by arc, as numbers: "1.3.6.1.2.1.2.2.1.10"
   * comes after "1.3.6.1.2.1.2.2.1.9", which a string comparison gets
   * wrong. A prefix comes before everything under it. Negative, zero or
   * positive, like Array.sort expects.
   */
  public static compareOids(a: string, b: string): number {
    const left: Array<string> = SnmpOidListUtil.normalizeOid(a).split(".");
    const right: Array<string> = SnmpOidListUtil.normalizeOid(b).split(".");
    const length: number = Math.min(left.length, right.length);

    for (let index: number = 0; index < length; index++) {
      const leftArc: number = Number(left[index]);
      const rightArc: number = Number(right[index]);

      if (leftArc !== rightArc) {
        return leftArc < rightArc ? -1 : 1;
      }
    }

    return left.length - right.length;
  }

  // Whether `oid` is the root itself or sits anywhere under it.
  public static isWithinSubtree(rootOid: string, oid: string): boolean {
    const root: string = SnmpOidListUtil.normalizeOid(rootOid);
    const candidate: string = SnmpOidListUtil.normalizeOid(oid);

    return candidate === root || candidate.startsWith(`${root}.`);
  }

  /*
   * The start of a walk as the server stores it, from what a caller sent:
   * no starting OID walks everything (SNMP_WALK_DEFAULT_ROOT_OID), a
   * leading dot is dropped, and a MIB name or anything else that is not a
   * numeric OID is refused - net-snmp walks numeric OIDs only. An OID to
   * continue after must sit inside the subtree; one equal to the root is no
   * continuation at all. Throws an Error with the person's sentence.
   */
  public static resolveStart(data: {
    rootOid?: string | null | undefined;
    afterOid?: string | null | undefined;
  }): SnmpWalkStart {
    const requestedRoot: string = SnmpOidListUtil.normalizeOid(
      data.rootOid || "",
    );

    const rootOid: string = requestedRoot || SNMP_WALK_DEFAULT_ROOT_OID;

    if (
      !SnmpOidListUtil.isValidOid(rootOid) ||
      rootOid.length > SNMP_WALK_MAX_OID_LENGTH
    ) {
      throw new Error(SNMP_WALK_INVALID_ROOT_MESSAGE);
    }

    const requestedAfter: string = SnmpOidListUtil.normalizeOid(
      data.afterOid || "",
    );

    if (!requestedAfter || requestedAfter === rootOid) {
      return { rootOid: rootOid };
    }

    if (
      !SnmpOidListUtil.isValidOid(requestedAfter) ||
      requestedAfter.length > SNMP_WALK_MAX_OID_LENGTH ||
      !SnmpWalkResultUtil.isWithinSubtree(rootOid, requestedAfter)
    ) {
      throw new Error(SNMP_WALK_INVALID_AFTER_MESSAGE);
    }

    return { rootOid: rootOid, afterOid: requestedAfter };
  }

  /*
   * A probe's walk report, as the server stores it - or null when it is not
   * a walk result at all.
   *
   * The report arrives from a probe and lands in a jsonb column the
   * dashboard renders, so nothing in it is taken on trust: rows past the
   * walk limit are dropped, an OID that is not a numeric OID is dropped,
   * text is cut at its limit, a NUL (which jsonb refuses, and which would
   * leave the row In Progress for good) is shown as hex, and an enum value
   * this server does not know reads as the safe default. A current probe
   * never sends any of that; an older or newer one, or a broken one, might.
   */
  public static sanitize(
    value: unknown,
  ): NetworkDeviceDiagnosticSnmpWalkResult | null {
    if (!SnmpWalkResultUtil.isObject(value)) {
      return null;
    }

    const rawRows: unknown = value["rows"];
    const rows: Array<SnmpWalkRow> = [];

    if (Array.isArray(rawRows)) {
      for (const rawRow of rawRows) {
        if (rows.length >= SNMP_WALK_MAX_OIDS) {
          break;
        }

        const row: SnmpWalkRow | null = SnmpWalkResultUtil.sanitizeRow(rawRow);

        if (row) {
          rows.push(row);
        }
      }
    }

    const failure: SnmpWalkFailure | undefined =
      SnmpWalkResultUtil.sanitizeFailure(value["failure"]);

    const rootOid: string =
      SnmpWalkResultUtil.readOid(value["rootOid"]) ||
      SNMP_WALK_DEFAULT_ROOT_OID;

    const afterOid: string | undefined = SnmpWalkResultUtil.readOid(
      value["afterOid"],
    );

    const nextOid: string | undefined = SnmpWalkResultUtil.readOid(
      value["nextOid"],
    );

    const snmpVersion: string | undefined = Object.values(SnmpVersion).find(
      (version: string): boolean => {
        return version === value["snmpVersion"];
      },
    );

    const result: NetworkDeviceDiagnosticSnmpWalkResult = {
      rootOid: rootOid,
      rows: rows,
      stopReason: SnmpWalkResultUtil.readStopReason(
        value["stopReason"],
        failure,
      ),
      requestCount: SnmpWalkResultUtil.readCount(value["requestCount"]),
      durationInMs: SnmpWalkResultUtil.readCount(value["durationInMs"]),
    };

    if (afterOid) {
      result.afterOid = afterOid;
    }

    if (nextOid) {
      result.nextOid = nextOid;
    }

    if (failure) {
      result.failure = failure;
    }

    if (snmpVersion) {
      result.snmpVersion = snmpVersion;
    }

    return result;
  }

  private static sanitizeRow(value: unknown): SnmpWalkRow | null {
    if (!SnmpWalkResultUtil.isObject(value)) {
      return null;
    }

    const oid: string | undefined = SnmpWalkResultUtil.readOid(value["oid"]);

    if (!oid) {
      return null;
    }

    const type: SnmpDataType =
      Object.values(SnmpDataType).find((dataType: string): boolean => {
        return dataType === value["type"];
      }) || SnmpDataType.Unknown;

    const row: SnmpWalkRow = { oid: oid, type: type, value: null };
    const rawValue: unknown = value["value"];

    if (typeof rawValue === "number") {
      row.value = Number.isFinite(rawValue) ? rawValue : null;
    } else if (typeof rawValue === "string") {
      let text: string = rawValue;

      if (text.includes(NUL_CHARACTER)) {
        // Postgres refuses a NUL inside jsonb: show the text's bytes instead.
        text = SnmpWalkResultUtil.toHex(new TextEncoder().encode(text));
        row.isHex = true;
      }

      if (text.length > SNMP_WALK_MAX_VALUE_LENGTH) {
        text = text.substring(0, SNMP_WALK_MAX_VALUE_LENGTH);
        row.isCut = true;
      }

      row.value = text;
    }

    if (value["isHex"] === true) {
      row.isHex = true;
    }

    if (value["isCut"] === true) {
      row.isCut = true;
    }

    return row;
  }

  private static sanitizeFailure(value: unknown): SnmpWalkFailure | undefined {
    if (!SnmpWalkResultUtil.isObject(value)) {
      return undefined;
    }

    const kind: SnmpWalkFailureKind =
      Object.values(SnmpWalkFailureKind).find((entry: string): boolean => {
        return entry === value["kind"];
      }) || SnmpWalkFailureKind.Unknown;

    const failure: SnmpWalkFailure = {
      kind: kind,
      message:
        typeof value["message"] === "string"
          ? value["message"]
              .split(NUL_CHARACTER)
              .join("")
              .substring(0, SNMP_WALK_MAX_FAILURE_MESSAGE_LENGTH)
          : "",
    };

    const reason: SnmpWalkAuthenticationReason | undefined = Object.values(
      SnmpWalkAuthenticationReason,
    ).find((entry: string): boolean => {
      return entry === value["authenticationReason"];
    });

    if (reason) {
      failure.authenticationReason = reason;
    }

    return failure;
  }

  private static readStopReason(
    value: unknown,
    failure: SnmpWalkFailure | undefined,
  ): SnmpWalkStopReason {
    const known: SnmpWalkStopReason | undefined = Object.values(
      SnmpWalkStopReason,
    ).find((entry: string): boolean => {
      return entry === value;
    });

    if (known) {
      return known;
    }

    // A report that says nothing about why it stopped: its failure does.
    return failure ? SnmpWalkStopReason.Failed : SnmpWalkStopReason.Complete;
  }

  private static readOid(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const oid: string = SnmpOidListUtil.normalizeOid(value);

    if (
      !oid ||
      oid.length > SNMP_WALK_MAX_OID_LENGTH ||
      !SnmpOidListUtil.isValidOid(oid)
    ) {
      return undefined;
    }

    return oid;
  }

  private static readCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.floor(value);
  }

  // Octets as the walk shows binary values: "00 1A 2B 3C".
  public static toHex(bytes: Uint8Array): string {
    const parts: Array<string> = [];

    for (const byte of bytes) {
      parts.push(byte.toString(16).toUpperCase().padStart(2, "0"));
    }

    return parts.join(" ");
  }

  private static isObject(value: unknown): value is JSONObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
