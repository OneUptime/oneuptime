import PacketCaptureCapabilityUtil, {
  ALL_INTERFACES_NAME,
  MAX_REPORTED_ADDRESSES_PER_INTERFACE,
  MAX_REPORTED_INTERFACES,
  PacketCaptureCapability,
  PacketCaptureInterface,
} from "../../../Types/PacketCapture/PacketCaptureCapability";
import { HARD_MAX_PACKET_CAPTURE_LIMITS } from "../../../Types/PacketCapture/PacketCaptureLimits";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * What a probe says it can capture on is posted by the probe and stored on
 * the probe row, then read by the server's create checks and by the
 * dashboard's form. sanitize() is the only door: whatever the probe posted,
 * what is kept is a report of the right shape, with no interface the
 * capture tool could misread and no limit above the hard maximums.
 */

function report(overrides: JSONObject = {}): JSONObject {
  return {
    isEnabled: true,
    isToolAvailable: true,
    toolVersion: "tcpdump version 4.99.3",
    interfaces: [
      { name: "any", addresses: [], isUp: true, isLoopback: false },
      {
        name: "eth0",
        addresses: ["10.0.0.2/24", "fe80::1/64"],
        isUp: true,
        isLoopback: false,
      },
      { name: "lo", addresses: ["127.0.0.1/8"], isUp: true, isLoopback: true },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
    ...overrides,
  };
}

function sanitize(value: unknown): PacketCaptureCapability {
  const capability: PacketCaptureCapability | null =
    PacketCaptureCapabilityUtil.sanitize(value);

  expect(capability).not.toBeNull();

  return capability as PacketCaptureCapability;
}

function names(capability: PacketCaptureCapability): Array<string> {
  return capability.interfaces.map(
    (networkInterface: PacketCaptureInterface): string => {
      return networkInterface.name;
    },
  );
}

describe("PacketCaptureCapabilityUtil.isInterfaceName", () => {
  test("the names interfaces have in practice", () => {
    for (const name of [
      "any",
      "eth0",
      "ens192",
      "enp0s31f6",
      "eth0.20",
      "bond0:1",
      "br-1a2b3c4d5e6f",
      "wlan0",
      "veth1a2b@if5",
      "tun+0",
      "docker0",
      "Ethernet_2",
    ]) {
      expect(PacketCaptureCapabilityUtil.isInterfaceName(name)).toBe(true);
    }
  });

  test("nothing that could read as an option, a path or two words", () => {
    for (const name of [
      "",
      "-i",
      "--help",
      "-w/tmp/x",
      "eth0;reboot",
      "eth 0",
      "eth0\n",
      "../etc",
      "/dev/eth0",
      "eth0$",
      "a".repeat(65),
    ]) {
      expect(PacketCaptureCapabilityUtil.isInterfaceName(name)).toBe(false);
    }
  });

  test("only text is a name", () => {
    expect(PacketCaptureCapabilityUtil.isInterfaceName(0)).toBe(false);
    expect(PacketCaptureCapabilityUtil.isInterfaceName(null)).toBe(false);
    expect(PacketCaptureCapabilityUtil.isInterfaceName(undefined)).toBe(false);
    expect(PacketCaptureCapabilityUtil.isInterfaceName(["eth0"])).toBe(false);
  });
});

describe("PacketCaptureCapabilityUtil.sanitize", () => {
  test("a report that is not an object, or does not say whether captures are on, is not a report", () => {
    for (const value of [
      null,
      undefined,
      "on",
      true,
      42,
      [],
      [report()],
      {},
      { isEnabled: "true" },
      { isEnabled: 1 },
    ]) {
      expect(PacketCaptureCapabilityUtil.sanitize(value)).toBeNull();
    }
  });

  test("a probe with captures off is kept as off, and nothing else it said is kept", () => {
    expect(
      PacketCaptureCapabilityUtil.sanitize(
        report({ isEnabled: false, toolVersion: "tcpdump version 4.99.3" }),
      ),
    ).toEqual({
      isEnabled: false,
      isToolAvailable: false,
      interfaces: [],
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
    });
  });

  test("a full report is kept as it was sent", () => {
    expect(sanitize(report())).toEqual({
      isEnabled: true,
      isToolAvailable: true,
      toolVersion: "tcpdump version 4.99.3",
      interfaces: [
        { name: "any", addresses: [], isUp: true, isLoopback: false },
        {
          name: "eth0",
          addresses: ["10.0.0.2/24", "fe80::1/64"],
          isUp: true,
          isLoopback: false,
        },
        {
          name: "lo",
          addresses: ["127.0.0.1/8"],
          isUp: true,
          isLoopback: true,
        },
      ],
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
    });
  });

  test("keys it does not know are dropped, at every level", () => {
    const capability: PacketCaptureCapability = sanitize(
      report({
        extra: "dropped",
        interfaces: [
          { name: "eth0", addresses: [], mtu: 1500, script: "<b>x</b>" },
        ],
      }),
    );

    expect(Object.keys(capability).sort()).toEqual([
      "interfaces",
      "isEnabled",
      "isToolAvailable",
      "limits",
      "toolVersion",
    ]);
    expect(capability.interfaces).toEqual([{ name: "eth0", addresses: [] }]);
  });

  test("the tool is available only when the probe says exactly true", () => {
    expect(sanitize(report({ isToolAvailable: "true" })).isToolAvailable).toBe(
      false,
    );
    expect(sanitize(report({ isToolAvailable: 1 })).isToolAvailable).toBe(
      false,
    );
    expect(
      sanitize(report({ isToolAvailable: undefined })).isToolAvailable,
    ).toBe(false);
  });

  test("an interface whose name the capture tool could misread is never offered", () => {
    const capability: PacketCaptureCapability = sanitize(
      report({
        interfaces: [
          { name: "-w", addresses: [] },
          { name: "eth0; reboot", addresses: [] },
          { name: 42, addresses: [] },
          "eth1",
          null,
          { addresses: ["10.0.0.9"] },
          { name: "eth2", addresses: [] },
        ],
      }),
    );

    expect(names(capability)).toEqual(["eth2"]);
  });

  test("an interface reported twice is kept once, as first reported", () => {
    const capability: PacketCaptureCapability = sanitize(
      report({
        interfaces: [
          { name: "eth0", addresses: ["10.0.0.2"] },
          { name: "eth0", addresses: ["10.0.0.3"] },
        ],
      }),
    );

    expect(capability.interfaces).toEqual([
      { name: "eth0", addresses: ["10.0.0.2"] },
    ]);
  });

  test("at most so many interfaces, and so many addresses each, are kept", () => {
    const interfaces: Array<JSONObject> = [];

    for (let index: number = 0; index < MAX_REPORTED_INTERFACES + 20; index++) {
      interfaces.push({ name: `eth${index}`, addresses: [] });
    }

    const addresses: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_REPORTED_ADDRESSES_PER_INTERFACE + 10;
      index++
    ) {
      addresses.push(`10.0.${index}.1`);
    }

    interfaces[0] = { name: "eth0", addresses: addresses };

    const capability: PacketCaptureCapability = sanitize(
      report({ interfaces: interfaces }),
    );

    expect(capability.interfaces).toHaveLength(MAX_REPORTED_INTERFACES);
    expect(capability.interfaces[0]!.addresses).toHaveLength(
      MAX_REPORTED_ADDRESSES_PER_INTERFACE,
    );
  });

  test("only IP addresses, alone or with a prefix length they can have, are kept", () => {
    const capability: PacketCaptureCapability = sanitize(
      report({
        interfaces: [
          {
            name: "eth0",
            addresses: [
              "10.0.0.2",
              "10.0.0.2/24",
              "10.0.0.2/24",
              "10.0.0.3/33",
              "fe80::1",
              "fe80::2/64",
              "fe80::3/129",
              "garbage/24",
              "not-an-address",
              "10.0.0.4 or host x",
              42,
              null,
              `10.0.0.5/${"9".repeat(80)}`,
            ],
          },
        ],
      }),
    );

    expect(capability.interfaces[0]!.addresses).toEqual([
      "10.0.0.2",
      "10.0.0.2/24",
      "fe80::1",
      "fe80::2/64",
    ]);
  });

  test("up and loopback are kept only when the probe could tell", () => {
    const capability: PacketCaptureCapability = sanitize(
      report({
        interfaces: [
          { name: "eth0", addresses: [], isUp: false, isLoopback: false },
          { name: "eth1", addresses: [], isUp: "yes", isLoopback: 1 },
          { name: "eth2" },
        ],
      }),
    );

    expect(capability.interfaces).toEqual([
      { name: "eth0", addresses: [], isUp: false, isLoopback: false },
      { name: "eth1", addresses: [] },
      { name: "eth2", addresses: [] },
    ]);
  });

  test("a probe's limits can lower the hard maximums, never raise them", () => {
    expect(
      sanitize(
        report({
          limits: {
            maxDurationInSeconds: 600,
            maxPackets: 5000,
            maxFileSizeInMB: 5,
          },
        }),
      ).limits,
    ).toEqual({
      maxDurationInSeconds: 600,
      maxPackets: 5000,
      maxFileSizeInMB: 5,
    });

    expect(
      sanitize(
        report({
          limits: {
            maxDurationInSeconds: 99999,
            maxPackets: 99999999,
            maxFileSizeInMB: 500,
          },
        }),
      ).limits,
    ).toEqual(HARD_MAX_PACKET_CAPTURE_LIMITS);

    expect(sanitize(report({ limits: "small" })).limits).toEqual(
      HARD_MAX_PACKET_CAPTURE_LIMITS,
    );
    expect(sanitize(report({ limits: undefined })).limits).toEqual(
      HARD_MAX_PACKET_CAPTURE_LIMITS,
    );
  });

  test("the tool version is its first line, cut short", () => {
    expect(
      sanitize(
        report({
          toolVersion: "  tcpdump version 4.99.3  \nlibpcap version 1.10.3",
        }),
      ).toolVersion,
    ).toBe("tcpdump version 4.99.3");
    expect(
      sanitize(report({ toolVersion: `tcpdump ${"x".repeat(500)}` }))
        .toolVersion,
    ).toHaveLength(120);
    expect(sanitize(report({ toolVersion: 4 })).toolVersion).toBeUndefined();
    expect(sanitize(report({ toolVersion: "" })).toolVersion).toBeUndefined();
  });

  test("parse reads a stored report by the same rules", () => {
    expect(PacketCaptureCapabilityUtil.parse(report())).toEqual(
      sanitize(report()),
    );
    expect(PacketCaptureCapabilityUtil.parse(null)).toBeNull();
    expect(PacketCaptureCapabilityUtil.parse("{}")).toBeNull();
  });
});

describe("PacketCaptureCapabilityUtil.canCapture", () => {
  test("only a probe with captures on, tcpdump installed and an interface can capture", () => {
    expect(PacketCaptureCapabilityUtil.canCapture(sanitize(report()))).toBe(
      true,
    );
    expect(PacketCaptureCapabilityUtil.canCapture(null)).toBe(false);
    expect(PacketCaptureCapabilityUtil.canCapture(undefined)).toBe(false);
    expect(
      PacketCaptureCapabilityUtil.canCapture(
        sanitize(report({ isEnabled: false })),
      ),
    ).toBe(false);
    expect(
      PacketCaptureCapabilityUtil.canCapture(
        sanitize(report({ isToolAvailable: false })),
      ),
    ).toBe(false);
    expect(
      PacketCaptureCapabilityUtil.canCapture(
        sanitize(report({ interfaces: [] })),
      ),
    ).toBe(false);
  });
});

describe("PacketCaptureCapabilityUtil.findInterface", () => {
  test("finds an interface by its exact name", () => {
    const capability: PacketCaptureCapability = sanitize(report());

    expect(
      PacketCaptureCapabilityUtil.findInterface(capability, "eth0")?.addresses,
    ).toEqual(["10.0.0.2/24", "fe80::1/64"]);
    expect(
      PacketCaptureCapabilityUtil.findInterface(capability, "ETH0"),
    ).toBeUndefined();
    expect(
      PacketCaptureCapabilityUtil.findInterface(capability, "eth9"),
    ).toBeUndefined();
    expect(
      PacketCaptureCapabilityUtil.findInterface(capability, ""),
    ).toBeUndefined();
    expect(
      PacketCaptureCapabilityUtil.findInterface(capability, null),
    ).toBeUndefined();
    expect(
      PacketCaptureCapabilityUtil.findInterface(null, "eth0"),
    ).toBeUndefined();
  });
});

describe("PacketCaptureCapabilityUtil.getDefaultInterfaceName", () => {
  test("every interface at once, when the probe offers it", () => {
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(sanitize(report())),
    ).toBe(ALL_INTERFACES_NAME);
    expect(ALL_INTERFACES_NAME).toBe("any");
  });

  test("else the first interface that is up and not loopback", () => {
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(
        sanitize(
          report({
            interfaces: [
              { name: "lo", addresses: [], isUp: true, isLoopback: true },
              { name: "eth0", addresses: [], isUp: false },
              { name: "eth1", addresses: [], isUp: true },
              { name: "eth2", addresses: [] },
            ],
          }),
        ),
      ),
    ).toBe("eth1");
  });

  test("an interface whose state the probe could not tell counts as up", () => {
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(
        sanitize(
          report({
            interfaces: [
              { name: "lo", addresses: [], isLoopback: true },
              { name: "en0", addresses: [] },
            ],
          }),
        ),
      ),
    ).toBe("en0");
  });

  test("else the first one", () => {
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(
        sanitize(
          report({
            interfaces: [
              { name: "lo", addresses: [], isLoopback: true },
              { name: "eth0", addresses: [], isUp: false },
            ],
          }),
        ),
      ),
    ).toBe("lo");
  });

  test("none without interfaces", () => {
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(
        sanitize(report({ interfaces: [] })),
      ),
    ).toBeUndefined();
    expect(
      PacketCaptureCapabilityUtil.getDefaultInterfaceName(null),
    ).toBeUndefined();
  });
});
