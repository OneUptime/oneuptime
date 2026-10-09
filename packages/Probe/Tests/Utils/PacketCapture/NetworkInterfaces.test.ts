import { describe, expect, test } from "@jest/globals";
import { PacketCaptureInterface } from "Common/Types/PacketCapture/PacketCaptureCapability";
import {
  InterfaceSource,
  listCaptureInterfaces,
} from "../../../Utils/PacketCapture/NetworkInterfaces";
import os from "os";

/*
 * The interfaces a probe offers to capture on. Node lists only interfaces
 * with an address, and the one a network engineer most wants - the port a
 * switch mirrors traffic to - usually has none, so on Linux the list is
 * /sys/class/net, with state and flags beside it. These run on a described
 * host (InterfaceSource), never the test machine's.
 */

type NodeInterfaces = NodeJS.Dict<Array<os.NetworkInterfaceInfo>>;

function address(
  cidr: string,
  internal: boolean = false,
): os.NetworkInterfaceInfo {
  const [ip] = cidr.split("/");
  const isV6: boolean = (ip || "").includes(":");

  return {
    address: ip || "",
    netmask: "",
    family: isV6 ? "IPv6" : "IPv4",
    mac: "00:00:00:00:00:00",
    internal: internal,
    cidr: cidr,
    ...(isV6 ? { scopeid: 0 } : {}),
  } as os.NetworkInterfaceInfo;
}

const LINUX_NODE: NodeInterfaces = {
  lo: [address("127.0.0.1/8", true), address("::1/128", true)],
  eth0: [address("10.0.0.2/24"), address("fe80::1/64")],
  "eth0.20": [address("10.20.0.2/24")],
};

function linux(data: {
  sys?: Array<string> | null;
  node?: NodeInterfaces;
  operState?: Record<string, string>;
  flags?: Record<string, number>;
}): InterfaceSource {
  return {
    platform: "linux",
    listSysClassNet: (): Array<string> | null => {
      return data.sys === undefined
        ? ["lo", "eth0", "eth1", "eth0.20", "docker0"]
        : data.sys;
    },
    readOperState: (name: string): string | null => {
      return (data.operState || {})[name] ?? null;
    },
    readFlags: (name: string): number | null => {
      return (data.flags || {})[name] ?? null;
    },
    networkInterfaces: (): NodeInterfaces => {
      return data.node || LINUX_NODE;
    },
  };
}

function names(interfaces: Array<PacketCaptureInterface>): Array<string> {
  return interfaces.map((networkInterface: PacketCaptureInterface): string => {
    return networkInterface.name;
  });
}

describe("on Linux", () => {
  const source: InterfaceSource = linux({
    operState: {
      lo: "unknown",
      eth0: "up",
      eth1: "up",
      "eth0.20": "up",
      docker0: "down",
    },
    flags: {
      lo: 0x9,
      eth0: 0x1003,
      eth1: 0x1003,
      "eth0.20": 0x1003,
      docker0: 0x1002,
    },
  });

  test("every interface, those with no address included, after 'any': live, down, loopback", () => {
    expect(names(listCaptureInterfaces(source))).toEqual([
      "any",
      "eth0",
      "eth0.20",
      "eth1",
      "docker0",
      "lo",
    ]);
  });

  test("'any' captures on all of them at once", () => {
    expect(listCaptureInterfaces(source)[0]).toEqual({
      name: "any",
      addresses: [],
      isUp: true,
      isLoopback: false,
    });
  });

  test("each with its addresses and prefix lengths, its state and whether it is loopback", () => {
    const interfaces: Array<PacketCaptureInterface> =
      listCaptureInterfaces(source);

    expect(
      interfaces.find((item: PacketCaptureInterface): boolean => {
        return item.name === "eth0";
      }),
    ).toEqual({
      name: "eth0",
      addresses: ["10.0.0.2/24", "fe80::1/64"],
      isUp: true,
      isLoopback: false,
    });

    // A mirror port: no address, still offered.
    expect(
      interfaces.find((item: PacketCaptureInterface): boolean => {
        return item.name === "eth1";
      }),
    ).toEqual({ name: "eth1", addresses: [], isUp: true, isLoopback: false });

    expect(
      interfaces.find((item: PacketCaptureInterface): boolean => {
        return item.name === "docker0";
      }),
    ).toMatchObject({ isUp: false, isLoopback: false });

    // operstate "unknown": the administrative flag decides.
    expect(
      interfaces.find((item: PacketCaptureInterface): boolean => {
        return item.name === "lo";
      }),
    ).toMatchObject({ isUp: true, isLoopback: true });
  });

  test("a name tcpdump could misread is never offered", () => {
    expect(
      names(
        listCaptureInterfaces(
          linux({ sys: ["eth0", "-w", "bad name", "any"], node: {} }),
        ),
      ),
    ).toEqual(["any", "eth0"]);
  });

  test("with /sys/class/net unreadable, Node's list is used", () => {
    expect(names(listCaptureInterfaces(linux({ sys: null })))).toEqual([
      "any",
      "eth0",
      "eth0.20",
      "lo",
    ]);
  });

  test("at most so many interfaces", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 300; index++) {
      many.push(`veth${index}`);
    }

    expect(listCaptureInterfaces(linux({ sys: many, node: {} }))).toHaveLength(
      128,
    );
  });
});

describe("elsewhere", () => {
  test("Node's list, with no 'any' - it is a Linux pseudo-interface", () => {
    const source: InterfaceSource = {
      platform: "darwin",
      listSysClassNet: (): Array<string> | null => {
        throw new Error("never read off Linux");
      },
      readOperState: (): string | null => {
        return null;
      },
      readFlags: (): number | null => {
        return null;
      },
      networkInterfaces: (): NodeInterfaces => {
        return {
          lo0: [address("127.0.0.1/8", true)],
          en0: [address("192.168.1.10/24")],
        };
      },
    };

    expect(listCaptureInterfaces(source)).toEqual([
      { name: "en0", addresses: ["192.168.1.10/24"], isLoopback: false },
      { name: "lo0", addresses: ["127.0.0.1/8"], isLoopback: true },
    ]);
  });
});
