import { JSONObject } from "../../../Types/JSON";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpOidListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";

/*
 * How fast each counter OID a device's poll read is growing, per second.
 *
 * A counter (Counter32, Counter64) only grows - until it wraps or the device
 * restarts - so its raw value against a threshold says nothing about now:
 * "ifInErrors above 1000" stays true from the first thousand errors since
 * boot until the next reboot. What matters is how fast it grows: the SNMP OID
 * Rate (per second) criteria compares that, and SNMP Walk's Alert on it
 * starts a counter there (an "above the walked value" threshold on the raw
 * counter fired at the very next poll).
 *
 * Probes stay stateless, as for interface rates (SnmpInterfaceRateUtil): the
 * server keeps the counters each poll read in the device's lastWalkLog
 * (oidCounters, a few numbers - the counters only, never the rest of the
 * health OIDs), and the next poll's rate is the delta over the time between
 * the two polls' receipt. A counter that went backwards - it wrapped, or the
 * device restarted - gets no rate that poll; the next one has a fresh
 * baseline.
 */

export interface SnmpOidCounterBaseline {
  /*
   * Each counter's value as the poll read it, by OID (canonical form). Kept
   * as text so nothing about the stored shape depends on a number's size.
   */
  values: Record<string, string>;
  // When the server received that poll (ISO 8601).
  readAt: string;
}

/*
 * At most this many counters are kept per device. A device's health OIDs
 * are a template's and its own - tens, not thousands - so this only bounds a
 * runaway list.
 */
export const SNMP_OID_COUNTER_BASELINE_LIMIT: number = 200;

// Where in NetworkDevice.lastWalkLog the counters are kept.
export const SNMP_OID_COUNTER_BASELINE_KEY: string = "oidCounters";

const COUNTER_TYPES: ReadonlyArray<SnmpDataType> = [
  SnmpDataType.Counter,
  SnmpDataType.Counter32,
  SnmpDataType.Counter64,
];

const round: (value: number) => number = (value: number): number => {
  return Math.round(value * 100) / 100;
};

// A counter's reading as a number, or undefined when it is not one.
const toCounterNumber: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

export default class SnmpOidRateUtil {
  public static isCounter(type: SnmpDataType | string | undefined): boolean {
    return COUNTER_TYPES.includes(type as SnmpDataType);
  }

  /*
   * The counters this poll read, to rate the next poll against - or
   * undefined when it read none (a poll that walked nothing, a device whose
   * health OIDs are all gauges and text).
   */
  public static getCounterBaseline(data: {
    snmpResponse: SnmpMonitorResponse | undefined;
    now: Date;
  }): SnmpOidCounterBaseline | undefined {
    const values: Record<string, string> = {};
    let count: number = 0;

    for (const oidResponse of data.snmpResponse?.oidResponses || []) {
      if (count >= SNMP_OID_COUNTER_BASELINE_LIMIT) {
        break;
      }

      if (!SnmpOidRateUtil.isCounter(oidResponse.type)) {
        continue;
      }

      const reading: number | undefined = toCounterNumber(oidResponse.value);
      const oid: string = SnmpOidListUtil.normalizeOid(oidResponse.oid);

      if (reading === undefined || !oid || values[oid] !== undefined) {
        continue;
      }

      values[oid] = String(reading);
      count++;
    }

    if (count === 0) {
      return undefined;
    }

    return { values: values, readAt: data.now.toISOString() };
  }

  /*
   * The counters a device's lastWalkLog holds, or undefined when it holds
   * none or holds them in a shape this does not know (it is read back from
   * jsonb, so nothing is taken on trust).
   */
  public static readBaseline(
    lastWalkLog: JSONObject | undefined | null,
  ): SnmpOidCounterBaseline | undefined {
    const stored: unknown = lastWalkLog?.[SNMP_OID_COUNTER_BASELINE_KEY];

    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return undefined;
    }

    const values: unknown = (stored as JSONObject)["values"];
    const readAt: unknown = (stored as JSONObject)["readAt"];

    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values) ||
      typeof readAt !== "string" ||
      Number.isNaN(new Date(readAt).getTime())
    ) {
      return undefined;
    }

    const read: Record<string, string> = {};

    for (const [oid, value] of Object.entries(values as JSONObject)) {
      if (typeof value === "string" || typeof value === "number") {
        read[oid] = String(value);
      }
    }

    return { values: read, readAt: readAt };
  }

  /*
   * Gives every counter of this poll that the previous poll read too its
   * ratePerSecond: the counter's growth over the seconds between the two
   * polls. Leaves alone a counter with no earlier reading, one that went
   * backwards, and every OID that is not a counter.
   */
  public static attachOidRates(data: {
    snmpResponse: SnmpMonitorResponse | undefined;
    previousBaseline: SnmpOidCounterBaseline | undefined;
    now: Date;
  }): void {
    const oidResponses: Array<SnmpOidResponse> =
      data.snmpResponse?.oidResponses || [];

    if (!data.previousBaseline || oidResponses.length === 0) {
      return;
    }

    const elapsedSeconds: number =
      (data.now.getTime() - new Date(data.previousBaseline.readAt).getTime()) /
      1000;

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return;
    }

    for (const oidResponse of oidResponses) {
      if (!SnmpOidRateUtil.isCounter(oidResponse.type)) {
        continue;
      }

      const current: number | undefined = toCounterNumber(oidResponse.value);
      const previous: number | undefined = toCounterNumber(
        data.previousBaseline.values[
          SnmpOidListUtil.normalizeOid(oidResponse.oid)
        ],
      );

      if (current === undefined || previous === undefined) {
        continue;
      }

      const delta: number = current - previous;

      // It wrapped, or the device restarted: no rate until the next poll.
      if (delta < 0) {
        continue;
      }

      oidResponse.ratePerSecond = round(delta / elapsedSeconds);
    }
  }
}
