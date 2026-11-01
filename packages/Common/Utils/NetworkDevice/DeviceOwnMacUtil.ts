import { normalizeMac } from "../Monitor/EndpointAttachmentUtil";

/*
 * A network device's own MAC, out of what its SNMP walk read (OneUptime issue
 * #5384).
 *
 * A device's MAC used to come from one of three places: a person typed it, a
 * walked router's ARP table named it, or its Meraki dashboard listed it. A
 * router's ARP table is no help for the device most likely to be left out -
 * the router itself: a Meraki MX at a branch is the gateway, and nothing
 * walked sits in front of it. Yet its poll reads ifPhysAddress on every
 * interface it has, every time, and kept it only on each interface's own row.
 * IF-MIB is one of the two MIBs a Meraki device answers, and the rows really
 * do hold a MAC: an MR28 reports its wired port's, and all zeros for its
 * radios.
 *
 * WHICH ONE. A device has a MAC per port, and one line in a CMDB. This picks
 * the same port every time from what does not change between polls - never
 * its status, or the value would move every time a cable did:
 *
 *   1. the lowest-numbered Ethernet port with an address burned into it;
 *   2. else the lowest-numbered interface of any kind with one, for a device
 *      whose Wi-Fi radio is all it has;
 *   3. else the lowest-numbered Ethernet port with an address assigned to it
 *      (the locally administered bit), which is what a virtual machine's NIC
 *      has. A Docker bridge or a radio's virtual interface has one too, which
 *      is why they come last, and why a locally administered address on
 *      anything but Ethernet is not used at all.
 *
 * An address no single box owns is no address: all zeros, all ones, or a
 * group address. It is a real MAC of the device and says so, not "the"
 * management MAC: an ARP table's reading, which is the MAC behind the address
 * OneUptime polls, comes first (NetworkDeviceAssetFacts).
 *
 * A device whose interfaces hold nothing usable has no MAC to report, and
 * reads Unknown as it did.
 */

// The part of a device's interface this reads: an SnmpInterface will do.
export interface DeviceOwnMacCandidate {
  interfaceIndex: number;
  macAddress?: string | undefined;
  interfaceType?: number | undefined;
}

/*
 * ifType values that are Ethernet (IANAifType-MIB): ethernetCsmacd,
 * fastEther, fastEtherFX and gigabitEthernet. Current agents say 6 for all of
 * them; the others are from agents old enough to tell them apart.
 */
const ETHERNET_INTERFACE_TYPES: ReadonlySet<number> = new Set<number>([
  6, 62, 69, 117,
]);

// The first octet's individual/group and universal/local bits (IEEE 802).
const GROUP_ADDRESS_BIT: number = 0x01;
const LOCALLY_ADMINISTERED_BIT: number = 0x02;

const ALL_ONES_MAC: string = "ff:ff:ff:ff:ff:ff";
const ALL_ZEROS_MAC: string = "00:00:00:00:00:00";

/*
 * How far above a controller's MAC for a box the box's ports are numbered.
 * Meraki lists a base address and derives its ports' from it: an MX's uplinks
 * sit a few addresses above it ("typically offset by 4 or 5"), and a
 * cloud-managed Catalyst numbers its 48 ports and their uplinks one by one
 * from it. A block a box has to itself is at most this wide.
 */
export const MAC_BLOCK_SIZE: number = 64;

function firstOctetOf(mac: string): number {
  return parseInt(mac.substring(0, 2), 16);
}

function isOwnableMac(mac: string): boolean {
  return (
    mac !== ALL_ZEROS_MAC &&
    mac !== ALL_ONES_MAC &&
    (firstOctetOf(mac) & GROUP_ADDRESS_BIT) === 0
  );
}

function isBurnedInMac(mac: string): boolean {
  return (firstOctetOf(mac) & LOCALLY_ADMINISTERED_BIT) === 0;
}

function isEthernet(candidate: DeviceOwnMacCandidate): boolean {
  return (
    candidate.interfaceType !== undefined &&
    ETHERNET_INTERFACE_TYPES.has(candidate.interfaceType)
  );
}

/**
 * The device's own MAC, in OneUptime's one MAC spelling, or undefined when
 * none of its interfaces holds a usable one. See the header for which port.
 */
export function pickDeviceOwnMac(
  interfaces: ReadonlyArray<DeviceOwnMacCandidate> | undefined,
): string | undefined {
  type Port = { mac: string; candidate: DeviceOwnMacCandidate };

  const ports: Array<Port> = [];

  for (const candidate of interfaces || []) {
    const mac: string | undefined = normalizeMac(candidate?.macAddress);

    if (mac && isOwnableMac(mac)) {
      ports.push({ mac: mac, candidate: candidate });
    }
  }

  ports.sort((left: Port, right: Port): number => {
    return left.candidate.interfaceIndex - right.candidate.interfaceIndex;
  });

  const chosen: Port | undefined =
    ports.find((port: Port): boolean => {
      return isEthernet(port.candidate) && isBurnedInMac(port.mac);
    }) ||
    ports.find((port: Port): boolean => {
      return isBurnedInMac(port.mac);
    }) ||
    ports.find((port: Port): boolean => {
      return isEthernet(port.candidate);
    });

  return chosen?.mac;
}

/**
 * True when `mac` is one of the addresses numbered up from `baseMac`, as a
 * Meraki box's ports are from the MAC its dashboard lists (see
 * MAC_BLOCK_SIZE). Both are in OneUptime's one MAC spelling.
 */
export function isInMacBlock(data: { baseMac: string; mac: string }): boolean {
  const base: number = parseInt(data.baseMac.split(":").join(""), 16);
  const mac: number = parseInt(data.mac.split(":").join(""), 16);

  if (Number.isNaN(base) || Number.isNaN(mac)) {
    return false;
  }

  return mac >= base && mac - base < MAC_BLOCK_SIZE;
}
