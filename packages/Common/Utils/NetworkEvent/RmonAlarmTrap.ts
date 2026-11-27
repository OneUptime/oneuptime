import SnmpTrap, {
  SnmpTrapVarbind,
} from "../../Types/Monitor/SnmpMonitor/SnmpTrap";

/*
 * RMON ALARM TRAPS: HOW A SWITCH'S OWN THRESHOLDS ARRIVE.
 *
 * A Cisco MDS port-monitor policy - "credit loss above 1 in 60 seconds on
 * every F-port" - is an RMON alarm on the switch, and a counter crossing its
 * threshold is sent as an RMON alarm trap: RMON-MIB's risingAlarm and
 * fallingAlarm for a 32-bit counter, HC-ALARM-MIB's hcRisingAlarm and
 * hcFallingAlarm (or Cisco's own cHcRisingAlarm and cHcFallingAlarm) for a
 * 64-bit one such as credit loss or timeout discards.
 *
 * Each carries the alarm's variable - the counter's OID, which ends in the
 * interface's ifIndex - its value and the threshold it crossed. This reads
 * them into what an alert should say: which counter, on which interface.
 * The interface's name is looked up by the caller that knows the device's
 * interfaces; failing that, an MDS's Fibre Channel interface is named from
 * its ifIndex the way NX-OS numbers them, and anything else is "ifIndex N".
 */

export enum RmonAlarmDirection {
  Rising = "rising",
  Falling = "falling",
}

// The alarm trap OIDs, by direction.
export const RMON_RISING_ALARM_TRAP_OIDS: ReadonlyArray<string> = [
  // RMON-MIB risingAlarm.
  "1.3.6.1.2.1.16.0.1",
  // HC-ALARM-MIB hcRisingAlarm.
  "1.3.6.1.2.1.16.29.2.0.1",
  // CISCO-HC-ALARM-MIB cHcRisingAlarm.
  "1.3.6.1.4.1.9.10.93.2.0.1",
];

export const RMON_FALLING_ALARM_TRAP_OIDS: ReadonlyArray<string> = [
  // RMON-MIB fallingAlarm.
  "1.3.6.1.2.1.16.0.2",
  // HC-ALARM-MIB hcFallingAlarm.
  "1.3.6.1.2.1.16.29.2.0.2",
  // CISCO-HC-ALARM-MIB cHcFallingAlarm.
  "1.3.6.1.4.1.9.10.93.2.0.2",
];

/*
 * Where each family keeps the alarm's columns: the variable, its value and
 * the threshold of each direction (the HC tables split a 64-bit threshold
 * into a low and a high 32 bits).
 */
interface AlarmColumns {
  entryOid: string;
  variable: number;
  value: number;
  risingThreshold: number;
  risingThresholdHigh?: number | undefined;
  fallingThreshold: number;
  fallingThresholdHigh?: number | undefined;
}

const RMON_ALARM_COLUMNS: AlarmColumns = {
  entryOid: "1.3.6.1.2.1.16.3.1.1",
  variable: 3,
  value: 5,
  risingThreshold: 7,
  fallingThreshold: 8,
};

const HC_ALARM_COLUMNS: AlarmColumns = {
  entryOid: "1.3.6.1.2.1.16.29.1.1.1.1",
  variable: 3,
  value: 5,
  risingThreshold: 8,
  risingThresholdHigh: 9,
  fallingThreshold: 11,
  fallingThresholdHigh: 12,
};

const CISCO_HC_ALARM_COLUMNS: AlarmColumns = {
  ...HC_ALARM_COLUMNS,
  entryOid: "1.3.6.1.4.1.9.10.93.1.1.1.1",
};

const ALARM_FAMILIES: Array<{
  rising: string;
  falling: string;
  columns: AlarmColumns;
}> = [
  {
    rising: "1.3.6.1.2.1.16.0.1",
    falling: "1.3.6.1.2.1.16.0.2",
    columns: RMON_ALARM_COLUMNS,
  },
  {
    rising: "1.3.6.1.2.1.16.29.2.0.1",
    falling: "1.3.6.1.2.1.16.29.2.0.2",
    columns: HC_ALARM_COLUMNS,
  },
  {
    rising: "1.3.6.1.4.1.9.10.93.2.0.1",
    falling: "1.3.6.1.4.1.9.10.93.2.0.2",
    columns: CISCO_HC_ALARM_COLUMNS,
  },
];

/*
 * Counters indexed by ifIndex that an alarm watches, by column OID, with
 * what to call them. The MDS port-monitor counters are CISCO-FC-FE-MIB's;
 * a plain RMON alarm on a port is usually on IF-MIB.
 */
const INTERFACE_COUNTER_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  // CISCO-FC-FE-MIB fcIfErrorEntry.
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.1", "Link failures"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.2", "Loss of sync"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.3", "Loss of signal"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.4", "Primitive sequence protocol errors"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.5", "Invalid transmission words"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.6", "Invalid CRCs"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.9", "Link resets received"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.10", "Link resets sent"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.15", "TX wait"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.26", "Frames discarded"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.28", "TX credit not available"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.35", "Timeout discards"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.36", "TX discards"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.37", "Credit loss"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.39", "RX credit not available"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.40", "TX credit not available"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.41", "RX credit not available"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.44", "Slow port"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.46", "State changes"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.47", "TX wait"],
  ["1.3.6.1.4.1.9.9.289.1.2.1.1.48", "RX wait"],
  // CISCO-FC-FE-MIB fcIfC3AccountingEntry.
  ["1.3.6.1.4.1.9.9.289.1.2.3.1.5", "Class 3 discards"],
  // IF-MIB ifEntry and ifXEntry.
  ["1.3.6.1.2.1.2.2.1.10", "Inbound octets"],
  ["1.3.6.1.2.1.2.2.1.13", "Inbound discards"],
  ["1.3.6.1.2.1.2.2.1.14", "Inbound errors"],
  ["1.3.6.1.2.1.2.2.1.16", "Outbound octets"],
  ["1.3.6.1.2.1.2.2.1.19", "Outbound discards"],
  ["1.3.6.1.2.1.2.2.1.20", "Outbound errors"],
  ["1.3.6.1.2.1.31.1.1.1.6", "Inbound octets"],
  ["1.3.6.1.2.1.31.1.1.1.10", "Outbound octets"],
]);

// An interface index is a positive 32-bit integer (InterfaceIndex, RFC 2863).
const INTERFACE_INDEX: RegExp = /^[1-9]\d{0,9}$/;

const DIGITS_ONLY: RegExp = /^\d+$/;
const MAX_INTERFACE_INDEX: number = 2147483647;

/*
 * How NX-OS numbers an MDS's Fibre Channel interfaces: fc1/1 is 0x1000000,
 * each next port 0x1000 more, 128 ports to a slot (fc9/41 is 0x1428000, as
 * MDS's own port-monitor log prints it); port-channel N is 0x4000000 + N - 1.
 */
const MDS_FC_INTERFACE_BASE: number = 0x1000000;
const MDS_FC_INTERFACE_STEP: number = 0x1000;
const MDS_FC_PORTS_PER_SLOT: number = 128;
const MDS_FC_INTERFACE_LIMIT: number = 0x2000000;
const MDS_PORT_CHANNEL_BASE: number = 0x4000000;
const MDS_PORT_CHANNEL_LIMIT: number = 0x4000000 + 256;

export interface RmonAlarm {
  direction: RmonAlarmDirection;
  // The OID the alarm watches, as the trap names it.
  variableOid?: string | undefined;
  // What the counter is called, when OneUptime knows it.
  counterName?: string | undefined;
  // The interface, for a counter indexed by ifIndex.
  interfaceIndex?: number | undefined;
  value?: string | undefined;
  threshold?: string | undefined;
}

function withoutLeadingDot(oid: string): string {
  return oid.trim().replace(/^\./, "");
}

function varbindOf(
  varbinds: Array<SnmpTrapVarbind>,
  columnOid: string,
): SnmpTrapVarbind | undefined {
  return varbinds.find((varbind: SnmpTrapVarbind) => {
    if (!varbind || typeof varbind.oid !== "string") {
      return false;
    }

    const oid: string = withoutLeadingDot(varbind.oid);
    return oid === columnOid || oid.startsWith(`${columnOid}.`);
  });
}

function valueOf(
  varbinds: Array<SnmpTrapVarbind>,
  columnOid: string,
): string | undefined {
  const value: string = String(
    varbindOf(varbinds, columnOid)?.value ?? "",
  ).trim();

  return value || undefined;
}

// A 64-bit threshold split in two 32-bit halves, as the HC tables send it.
function joinHalves(
  low: string | undefined,
  high: string | undefined,
): string | undefined {
  if (low === undefined) {
    return undefined;
  }

  if (high === undefined || high === "0") {
    return low;
  }

  if (!DIGITS_ONLY.test(low) || !DIGITS_ONLY.test(high)) {
    return low;
  }

  return (BigInt(high) * BigInt(4294967296) + BigInt(low)).toString();
}

export default class RmonAlarmTrapUtil {
  public static isRmonAlarmTrap(trapOid: string | undefined): boolean {
    const oid: string = withoutLeadingDot(trapOid || "");

    return (
      RMON_RISING_ALARM_TRAP_OIDS.includes(oid) ||
      RMON_FALLING_ALARM_TRAP_OIDS.includes(oid)
    );
  }

  /*
   * The alarm an RMON alarm trap reports, or null for any other trap. Every
   * field is best effort: an agent that leaves the variable out still says
   * an alarm rose.
   */
  public static decode(
    trap: Pick<SnmpTrap, "trapOid" | "varbinds"> | null | undefined,
  ): RmonAlarm | null {
    if (!trap || typeof trap.trapOid !== "string") {
      return null;
    }

    const trapOid: string = withoutLeadingDot(trap.trapOid);
    const family: (typeof ALARM_FAMILIES)[number] | undefined =
      ALARM_FAMILIES.find((candidate: (typeof ALARM_FAMILIES)[number]) => {
        return candidate.rising === trapOid || candidate.falling === trapOid;
      });

    if (!family) {
      return null;
    }

    const direction: RmonAlarmDirection =
      family.rising === trapOid
        ? RmonAlarmDirection.Rising
        : RmonAlarmDirection.Falling;
    const varbinds: Array<SnmpTrapVarbind> = Array.isArray(trap.varbinds)
      ? trap.varbinds
      : [];
    const c: AlarmColumns = family.columns;
    const column: (number: number) => string = (number: number): string => {
      return `${c.entryOid}.${number}`;
    };

    const alarm: RmonAlarm = { direction: direction };

    const variable: string | undefined = valueOf(varbinds, column(c.variable));

    if (variable) {
      alarm.variableOid = withoutLeadingDot(variable);

      const counter: { name: string; interfaceIndex?: number } | undefined =
        RmonAlarmTrapUtil.readCounter(alarm.variableOid);

      if (counter) {
        alarm.counterName = counter.name;

        if (counter.interfaceIndex !== undefined) {
          alarm.interfaceIndex = counter.interfaceIndex;
        }
      }
    }

    const value: string | undefined = valueOf(varbinds, column(c.value));

    if (value !== undefined) {
      alarm.value = value;
    }

    const threshold: string | undefined =
      direction === RmonAlarmDirection.Rising
        ? joinHalves(
            valueOf(varbinds, column(c.risingThreshold)),
            c.risingThresholdHigh !== undefined
              ? valueOf(varbinds, column(c.risingThresholdHigh))
              : undefined,
          )
        : joinHalves(
            valueOf(varbinds, column(c.fallingThreshold)),
            c.fallingThresholdHigh !== undefined
              ? valueOf(varbinds, column(c.fallingThresholdHigh))
              : undefined,
          );

    if (threshold !== undefined) {
      alarm.threshold = threshold;
    }

    return alarm;
  }

  /*
   * The counter an alarm's variable names, and the ifIndex it ends in, for
   * the columns OneUptime knows. Undefined for anything else.
   */
  public static readCounter(
    variableOid: string,
  ): { name: string; interfaceIndex?: number } | undefined {
    const oid: string = withoutLeadingDot(variableOid);
    const lastDot: number = oid.lastIndexOf(".");

    if (lastDot <= 0) {
      return undefined;
    }

    const columnOid: string = oid.substring(0, lastDot);
    const suffix: string = oid.substring(lastDot + 1);
    const name: string | undefined = INTERFACE_COUNTER_NAMES.get(columnOid);

    if (!name) {
      return undefined;
    }

    const interfaceIndex: number = Number(suffix);

    return INTERFACE_INDEX.test(suffix) && interfaceIndex <= MAX_INTERFACE_INDEX
      ? { name: name, interfaceIndex: interfaceIndex }
      : { name: name };
  }

  /*
   * An MDS interface's name from its ifIndex: "fc9/41", "port-channel3".
   * Undefined for an index outside NX-OS's Fibre Channel numbering.
   */
  public static mdsInterfaceName(interfaceIndex: number): string | undefined {
    if (
      interfaceIndex >= MDS_FC_INTERFACE_BASE &&
      interfaceIndex < MDS_FC_INTERFACE_LIMIT &&
      (interfaceIndex - MDS_FC_INTERFACE_BASE) % MDS_FC_INTERFACE_STEP === 0
    ) {
      const position: number =
        (interfaceIndex - MDS_FC_INTERFACE_BASE) / MDS_FC_INTERFACE_STEP;
      const slot: number = Math.floor(position / MDS_FC_PORTS_PER_SLOT) + 1;
      const port: number = (position % MDS_FC_PORTS_PER_SLOT) + 1;

      return `fc${slot}/${port}`;
    }

    if (
      interfaceIndex >= MDS_PORT_CHANNEL_BASE &&
      interfaceIndex < MDS_PORT_CHANNEL_LIMIT
    ) {
      return `port-channel${interfaceIndex - MDS_PORT_CHANNEL_BASE + 1}`;
    }

    return undefined;
  }

  /*
   * The interface an alarm is about, as an alert should name it: the name
   * the device's walk recorded for its ifIndex, else an MDS Fibre Channel
   * interface's name from its numbering (only for a Cisco Fibre Channel
   * counter, the only alarms that numbering is known to apply to), else
   * "ifIndex N". Undefined when the alarm names no interface.
   */
  public static describeInterface(
    alarm: RmonAlarm,
    knownName?: string | undefined,
  ): string | undefined {
    if (knownName && knownName.trim()) {
      return knownName.trim();
    }

    if (alarm.interfaceIndex === undefined) {
      return undefined;
    }

    if (alarm.variableOid?.startsWith("1.3.6.1.4.1.9.9.289.")) {
      const derived: string | undefined = RmonAlarmTrapUtil.mdsInterfaceName(
        alarm.interfaceIndex,
      );

      if (derived) {
        return derived;
      }
    }

    return `ifIndex ${alarm.interfaceIndex}`;
  }

  /*
   * One line for an alert or a log: "Credit loss on fc1/5 rose past its
   * threshold (value 3, threshold 1)".
   */
  public static describe(
    alarm: RmonAlarm,
    knownInterfaceName?: string | undefined,
  ): string {
    const counter: string =
      alarm.counterName || alarm.variableOid || "An RMON alarm";
    const interfaceName: string | undefined =
      RmonAlarmTrapUtil.describeInterface(alarm, knownInterfaceName);
    const where: string = interfaceName ? ` on ${interfaceName}` : "";
    const movement: string =
      alarm.direction === RmonAlarmDirection.Rising
        ? "rose past its threshold"
        : "fell back below its threshold";

    const facts: Array<string> = [];

    if (alarm.value !== undefined) {
      facts.push(`value ${alarm.value}`);
    }

    if (alarm.threshold !== undefined) {
      facts.push(`threshold ${alarm.threshold}`);
    }

    return `${counter}${where} ${movement}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`;
  }
}
