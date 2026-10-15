import LldpNeighbor from "Common/Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "Common/Types/Monitor/SnmpMonitor/CdpNeighbor";

/*
 * The devices a switch, router or firewall says it is cabled to: the LLDP
 * and CDP neighbours its SNMP walk reported - the same tables the topology
 * map draws its lines from.
 *
 * A device's "Connected to" card used to answer only one question: which
 * switch port a device that speaks neither protocol is plugged into, learned
 * from the switches' forwarding tables. On a core switch with five
 * neighbours drawn on the map, it said "No switch at this site has reported
 * this device yet". Now a device that reports neighbours lists them.
 *
 * Plain logic, free of React and of the API, so App/Tests can read it.
 */

export enum NeighbourProtocol {
  Lldp = "LLDP",
  Cdp = "CDP",
}

export interface DeviceNeighbour {
  // What the neighbour calls itself, or its chassis id when it gave no name.
  name: string;
  // Whether `name` is the neighbour's own name (not a chassis id).
  hasAdvertisedName: boolean;
  // The neighbour's port at its end of the cable.
  remotePort?: string | undefined;
  // This device's port: its ifIndex, named from its interfaces when known.
  localInterfaceIndex?: number | undefined;
  protocol: NeighbourProtocol;
}

// How many neighbours the card lists before "and N more".
export const NEIGHBOURS_SHOWN: number = 8;

// A port id that already says it is a port ("port1", "Port 3").
const NAMED_AS_PORT: RegExp = /^port\b|^port\d/i;

/**
 * Whether a neighbour's port id reads as a port on its own, so it is shown
 * as it is ("port1") rather than as "port port1". Ids like "Gi0/0/1" or "49"
 * get the word "port" in front.
 */
export function isPortNamedAsPort(remotePort: string): boolean {
  return NAMED_AS_PORT.test(remotePort.trim());
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * The neighbour's port, unless it only repeats the neighbour's name: an
 * LLDP agent that names its port by its chassis MAC (port id subtype MAC
 * address) and gives no system name would otherwise read
 * "70:3a:0e:12:4f:c1 · port 70:3a:0e:12:4f:c1".
 */
function readRemotePort(value: unknown, name: string): string | undefined {
  const port: string = readText(value);

  if (!port || port.toLowerCase() === name.toLowerCase()) {
    return undefined;
  }

  return port;
}

function readIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function keyOf(neighbour: DeviceNeighbour): string {
  return `${neighbour.name.toLowerCase()}|${
    neighbour.localInterfaceIndex === undefined
      ? ""
      : String(neighbour.localInterfaceIndex)
  }`;
}

/**
 * The device's neighbours, LLDP first and then CDP, each cable once (a Cisco
 * neighbour speaking both is one neighbour), in the order of this device's
 * ports. A row with neither a name nor a chassis id says nothing and is left
 * out.
 */
export function getDeviceNeighbours(data: {
  lldpNeighbors?: Array<LldpNeighbor> | null | undefined;
  cdpNeighbors?: Array<CdpNeighbor> | null | undefined;
}): Array<DeviceNeighbour> {
  const neighbours: Array<DeviceNeighbour> = [];
  const seen: Set<string> = new Set<string>();

  const add: (neighbour: DeviceNeighbour) => void = (
    neighbour: DeviceNeighbour,
  ): void => {
    const key: string = keyOf(neighbour);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    neighbours.push(neighbour);
  };

  for (const row of Array.isArray(data.lldpNeighbors)
    ? data.lldpNeighbors
    : []) {
    const sysName: string = readText(row?.remoteSysName);
    const chassisId: string = readText(row?.remoteChassisId);
    const name: string = sysName || chassisId;

    if (!name) {
      continue;
    }

    add({
      name: name,
      hasAdvertisedName: Boolean(sysName),
      remotePort: readRemotePort(row?.remotePortId, name),
      localInterfaceIndex: readIndex(row?.localInterfaceIndex),
      protocol: NeighbourProtocol.Lldp,
    });
  }

  for (const row of Array.isArray(data.cdpNeighbors) ? data.cdpNeighbors : []) {
    const name: string = readText(row?.remoteDeviceId);

    if (!name) {
      continue;
    }

    add({
      name: name,
      hasAdvertisedName: true,
      remotePort: readRemotePort(row?.remotePortId, name),
      localInterfaceIndex: readIndex(row?.localInterfaceIndex),
      protocol: NeighbourProtocol.Cdp,
    });
  }

  return neighbours.sort((a: DeviceNeighbour, b: DeviceNeighbour): number => {
    const left: number = a.localInterfaceIndex ?? Number.MAX_SAFE_INTEGER;
    const right: number = b.localInterfaceIndex ?? Number.MAX_SAFE_INTEGER;

    if (left !== right) {
      return left - right;
    }

    return a.name.localeCompare(b.name);
  });
}
