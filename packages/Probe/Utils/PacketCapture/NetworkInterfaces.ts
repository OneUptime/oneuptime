import PacketCaptureCapabilityUtil, {
  ALL_INTERFACES_NAME,
  MAX_REPORTED_ADDRESSES_PER_INTERFACE,
  MAX_REPORTED_INTERFACES,
  PacketCaptureInterface,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The network interfaces this probe can capture on, as the dashboard offers
 * them.
 *
 * Node's os.networkInterfaces() lists only interfaces that have an address,
 * and the interface a network engineer most wants - the one a switch
 * mirrors a port to - usually has none. On Linux every interface is a
 * directory under /sys/class/net, with its state and flags beside it, so
 * that is the list; addresses come from Node. Elsewhere Node's list is all
 * there is.
 *
 * On Linux "any" is listed first: tcpdump's pseudo-interface that captures
 * on every interface at once, which with a host or port filter is what most
 * captures want.
 */

const SYS_CLASS_NET: string = "/sys/class/net";

// IFF_UP and IFF_LOOPBACK from <net/if.h>, as /sys/class/net/<if>/flags shows them.
const IFF_UP: number = 0x1;
const IFF_LOOPBACK: number = 0x8;

// Where the interfaces are read from; replaced in tests.
export interface InterfaceSource {
  platform: string;
  // Interface names under /sys/class/net, or null when it cannot be read.
  listSysClassNet: () => Array<string> | null;
  // An interface's operstate ("up", "down", "unknown"), or null.
  readOperState: (name: string) => string | null;
  // An interface's flags, or null.
  readFlags: (name: string) => number | null;
  networkInterfaces: () => NodeJS.Dict<Array<os.NetworkInterfaceInfo>>;
}

function readSysFile(name: string, file: string): string | null {
  try {
    return fs
      .readFileSync(path.join(SYS_CLASS_NET, name, file), "utf8")
      .trim();
  } catch {
    return null;
  }
}

export const SYSTEM_INTERFACE_SOURCE: InterfaceSource = {
  platform: process.platform,
  listSysClassNet: (): Array<string> | null => {
    try {
      return fs.readdirSync(SYS_CLASS_NET);
    } catch {
      return null;
    }
  },
  readOperState: (name: string): string | null => {
    return readSysFile(name, "operstate");
  },
  readFlags: (name: string): number | null => {
    const flags: string | null = readSysFile(name, "flags");

    if (!flags) {
      return null;
    }

    const value: number = Number.parseInt(flags, 16);

    return Number.isFinite(value) ? value : null;
  },
  networkInterfaces: (): NodeJS.Dict<Array<os.NetworkInterfaceInfo>> => {
    return os.networkInterfaces();
  },
};

// The order the dashboard lists them in: "any", the live ones, the rest, loopback.
function rank(networkInterface: PacketCaptureInterface): number {
  if (networkInterface.name === ALL_INTERFACES_NAME) {
    return 0;
  }

  if (networkInterface.isLoopback) {
    return 3;
  }

  return networkInterface.isUp === false ? 2 : 1;
}

export function listCaptureInterfaces(
  source: InterfaceSource = SYSTEM_INTERFACE_SOURCE,
): Array<PacketCaptureInterface> {
  const isLinux: boolean = source.platform === "linux";
  const fromNode: NodeJS.Dict<Array<os.NetworkInterfaceInfo>> =
    source.networkInterfaces();
  const fromSys: Array<string> | null = isLinux
    ? source.listSysClassNet()
    : null;

  const names: Array<string> = Array.from(
    new Set([...(fromSys || []), ...Object.keys(fromNode)]),
  ).filter((name: string): boolean => {
    return (
      name !== ALL_INTERFACES_NAME &&
      PacketCaptureCapabilityUtil.isInterfaceName(name)
    );
  });

  const interfaces: Array<PacketCaptureInterface> = names.map(
    (name: string): PacketCaptureInterface => {
      const infos: Array<os.NetworkInterfaceInfo> = fromNode[name] || [];

      const addresses: Array<string> = Array.from(
        new Set(
          infos.map((info: os.NetworkInterfaceInfo): string => {
            return info.cidr || info.address;
          }),
        ),
      ).slice(0, MAX_REPORTED_ADDRESSES_PER_INTERFACE);

      const networkInterface: PacketCaptureInterface = {
        name: name,
        addresses: addresses,
      };

      const flags: number | null =
        isLinux && fromSys ? source.readFlags(name) : null;
      const operState: string | null =
        isLinux && fromSys ? source.readOperState(name) : null;

      if (flags !== null) {
        networkInterface.isLoopback = (flags & IFF_LOOPBACK) !== 0;
      } else if (infos.length > 0) {
        networkInterface.isLoopback = infos.every(
          (info: os.NetworkInterfaceInfo): boolean => {
            return info.internal;
          },
        );
      }

      if (operState === "up") {
        networkInterface.isUp = true;
      } else if (operState === "down" || operState === "lowerlayerdown") {
        networkInterface.isUp = false;
      } else if (flags !== null) {
        // "unknown" (loopback, tunnels): the administrative flag decides.
        networkInterface.isUp = (flags & IFF_UP) !== 0;
      }

      return networkInterface;
    },
  );

  interfaces.sort(
    (a: PacketCaptureInterface, b: PacketCaptureInterface): number => {
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    },
  );

  if (isLinux) {
    interfaces.unshift({
      name: ALL_INTERFACES_NAME,
      addresses: [],
      isUp: true,
      isLoopback: false,
    });
  }

  return interfaces.slice(0, MAX_REPORTED_INTERFACES);
}
