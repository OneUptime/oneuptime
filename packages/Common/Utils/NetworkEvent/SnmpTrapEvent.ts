import SnmpTrap, {
  SnmpTrapVarbind,
} from "../../Types/Monitor/SnmpMonitor/SnmpTrap";
import NetworkEventAttribute, {
  MAX_NETWORK_EVENT_SUBJECT_LENGTH,
  NETWORK_EVENT_DOMAIN,
} from "../../Types/NetworkEvent/NetworkEventAttribute";
import NetworkEventType from "../../Types/NetworkEvent/NetworkEventType";

/*
 * THE STANDARD SNMP TRAPS, AS NETWORK EVENTS.
 *
 * A link going down reaches OneUptime twice from most devices: as a syslog
 * line in the vendor's own words, and as the linkDown trap every SNMP agent
 * sends. Both are the same event, so the trap is stored under the same
 * name - `event.name` = interface.down - and a search, a monitor or a
 * dashboard built on the event finds it either way.
 *
 * Only the traps RFC 3418 and RFC 2863 define for every agent are read
 * here. A vendor's own traps say what they mean in their varbinds, in
 * words only that vendor knows; they are stored as before, and alerted on
 * with the trap criteria of a Network Device monitor.
 */

// snmpTraps (1.3.6.1.6.3.1.1.5), RFC 3418 and RFC 2863.
const COLD_START: string = "1.3.6.1.6.3.1.1.5.1";
const WARM_START: string = "1.3.6.1.6.3.1.1.5.2";
const LINK_DOWN: string = "1.3.6.1.6.3.1.1.5.3";
const LINK_UP: string = "1.3.6.1.6.3.1.1.5.4";

// IF-MIB columns a link trap may carry, each followed by the interface's index.
const IF_INDEX: string = "1.3.6.1.2.1.2.2.1.1.";
const IF_DESCR: string = "1.3.6.1.2.1.2.2.1.2.";
const IF_NAME: string = "1.3.6.1.2.1.31.1.1.1.1.";

// An interface index is a positive 32-bit integer (InterfaceIndex, RFC 2863).
const MAX_INTERFACE_INDEX: number = 2147483647;
const INTERFACE_INDEX: RegExp = /^[1-9]\d{0,9}$/;

type TrapLike = Pick<SnmpTrap, "trapOid" | "varbinds"> | null | undefined;

function withoutLeadingDot(oid: string): string {
  return oid.startsWith(".") ? oid.slice(1) : oid;
}

function valueOf(
  varbinds: Array<SnmpTrapVarbind>,
  columnPrefix: string,
): string {
  for (const varbind of varbinds) {
    if (
      varbind &&
      typeof varbind.oid === "string" &&
      withoutLeadingDot(varbind.oid.trim()).startsWith(columnPrefix)
    ) {
      const value: string = String(varbind.value ?? "").trim();

      if (value) {
        return value.slice(0, MAX_NETWORK_EVENT_SUBJECT_LENGTH);
      }
    }
  }

  return "";
}

function eventOf(trap: TrapLike): NetworkEventType | null {
  if (!trap || typeof trap.trapOid !== "string") {
    return null;
  }

  switch (withoutLeadingDot(trap.trapOid.trim())) {
    case LINK_DOWN:
      return NetworkEventType.InterfaceDown;
    case LINK_UP:
      return NetworkEventType.InterfaceUp;
    case COLD_START:
    case WARM_START:
      return NetworkEventType.DeviceReboot;
    default:
      return null;
  }
}

function varbindsOf(trap: TrapLike): Array<SnmpTrapVarbind> {
  return trap && Array.isArray(trap.varbinds) ? trap.varbinds : [];
}

// The name a link trap gives its interface itself: ifName, else ifDescr.
function namedInterfaceOf(varbinds: Array<SnmpTrapVarbind>): string {
  return valueOf(varbinds, IF_NAME) || valueOf(varbinds, IF_DESCR);
}

function indexOf(varbinds: Array<SnmpTrapVarbind>): number | null {
  const value: string = valueOf(varbinds, IF_INDEX);

  if (!INTERFACE_INDEX.test(value)) {
    return null;
  }

  const index: number = Number(value);

  return index <= MAX_INTERFACE_INDEX ? index : null;
}

/*
 * The index of the interface a link trap is about, when the index is all
 * the trap says of it - what RFC 2863 requires, and all most agents send.
 * The caller that knows the device's interfaces looks its name up, so the
 * event reads "GigabitEthernet0/1" and not "ifIndex 10101".
 *
 * Null for any other trap, and for a link trap that names its interface.
 */
export function getSnmpTrapInterfaceIndex(trap: TrapLike): number | null {
  const event: NetworkEventType | null = eventOf(trap);

  if (
    event !== NetworkEventType.InterfaceDown &&
    event !== NetworkEventType.InterfaceUp
  ) {
    return null;
  }

  const varbinds: Array<SnmpTrapVarbind> = varbindsOf(trap);

  if (namedInterfaceOf(varbinds)) {
    return null;
  }

  return indexOf(varbinds);
}

/*
 * The attributes that make a standard trap a network event, or an empty
 * object for any other trap.
 *
 * The interface of a link trap is, in order: the name the trap carries
 * (ifName, else ifDescr), the name the caller found for its index, and
 * "ifIndex N" when nobody knows a name for it.
 */
export function getSnmpTrapEventAttributes(
  trap: TrapLike,
  known?: { interfaceName?: string | null | undefined },
): Record<string, string> {
  const event: NetworkEventType | null = eventOf(trap);

  if (!event) {
    return {};
  }

  const attributes: Record<string, string> = {
    [NetworkEventAttribute.Domain]: NETWORK_EVENT_DOMAIN,
    [NetworkEventAttribute.Name]: event,
  };

  if (
    event === NetworkEventType.InterfaceDown ||
    event === NetworkEventType.InterfaceUp
  ) {
    const varbinds: Array<SnmpTrapVarbind> = varbindsOf(trap);
    const index: string = valueOf(varbinds, IF_INDEX);
    const interfaceName: string =
      namedInterfaceOf(varbinds) ||
      (typeof known?.interfaceName === "string"
        ? known.interfaceName.trim().slice(0, MAX_NETWORK_EVENT_SUBJECT_LENGTH)
        : "") ||
      (index ? `ifIndex ${index}` : "");

    if (interfaceName) {
      attributes[NetworkEventAttribute.InterfaceName] = interfaceName;
    }
  }

  return attributes;
}
