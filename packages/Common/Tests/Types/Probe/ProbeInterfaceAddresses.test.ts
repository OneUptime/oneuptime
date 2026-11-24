import { describe, expect, test } from "@jest/globals";
import ProbeInterfaceAddressesUtil, {
  MAX_PROBE_INTERFACE_ADDRESSES,
  MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ,
  PROBE_HOST_IP_ADDRESSES_SETTING,
  PROBE_INTERFACE_ADDRESSES_FIELD,
  ProbeHostAddressesSetting,
} from "../../../Types/Probe/ProbeInterfaceAddresses";

/*
 * What OneUptime keeps of the addresses a probe lists when it checks in
 * (#10429): the probe sends what it would keep, and the server reads what
 * arrives the same way, so a probe and a OneUptime of different releases
 * agree, and nothing a request sends is kept as it was sent.
 */

describe("a probe's check-in", () => {
  test("lists its addresses under one field", () => {
    expect(PROBE_INTERFACE_ADDRESSES_FIELD).toBe("probeInterfaceAddresses");
  });

  test("a check-in that says nothing leaves what is kept alone", () => {
    expect(ProbeInterfaceAddressesUtil.read(undefined)).toBeNull();
    expect(ProbeInterfaceAddressesUtil.read(null)).toBeNull();
    expect(ProbeInterfaceAddressesUtil.read("10.0.0.5")).toBeNull();
    expect(ProbeInterfaceAddressesUtil.read({ 0: "10.0.0.5" })).toBeNull();
  });

  test("an empty list says the probe has no address worth keeping", () => {
    expect(ProbeInterfaceAddressesUtil.read([])).toEqual([]);
  });
});

describe("what is kept of a report", () => {
  test("addresses without their prefix lengths", () => {
    expect(
      ProbeInterfaceAddressesUtil.read(["10.0.0.5/24", "2001:db8::5/64"]),
    ).toEqual(["10.0.0.5", "2001:db8::5"]);
  });

  test("written the one way, so two spellings are one address", () => {
    expect(
      ProbeInterfaceAddressesUtil.read([
        "2001:DB8:0:0:0:0:0:5",
        "2001:db8::5/64",
        "::ffff:10.0.0.5",
        " 10.0.0.5 ",
      ]),
    ).toEqual(["10.0.0.5", "2001:db8::5"]);
  });

  test("private, shared and public addresses are kept", () => {
    expect(
      ProbeInterfaceAddressesUtil.read([
        "203.0.113.7",
        "100.64.1.2",
        "192.168.1.10",
        "172.16.0.4",
        "fd00::4",
        "2001:db8::7",
      ]),
    ).toEqual([
      "100.64.1.2",
      "172.16.0.4",
      "192.168.1.10",
      "203.0.113.7",
      "2001:db8::7",
      "fd00::4",
    ]);
  });

  test("no address that is not on a network: loopback, unspecified, link-local, multicast", () => {
    expect(
      ProbeInterfaceAddressesUtil.read([
        "127.0.0.1/8",
        "::1/128",
        "0.0.0.0",
        "::",
        "169.254.10.1/16",
        "fe80::1/64",
        "224.0.0.251",
        "ff02::1",
      ]),
    ).toEqual([]);
  });

  test("nothing that is not an address: names, zones, ports, numbers", () => {
    expect(
      ProbeInterfaceAddressesUtil.read([
        "probe.local",
        "fe80::1%eth0",
        "10.0.0.5:161",
        "10.0.0.5/24/8",
        "300.1.1.1",
        42,
        null,
        { address: "10.0.0.6" },
        "",
      ]),
    ).toEqual([]);
  });

  test("IPv4 first, each family in address order: the same interfaces are the same text", () => {
    const first: Array<string> | null = ProbeInterfaceAddressesUtil.read([
      "10.0.0.20",
      "2001:db8::2",
      "10.0.0.3",
      "9.9.9.9",
    ]);
    const second: Array<string> | null = ProbeInterfaceAddressesUtil.read([
      "9.9.9.9",
      "10.0.0.3",
      "2001:db8::2",
      "10.0.0.20",
    ]);

    expect(first).toEqual(["9.9.9.9", "10.0.0.3", "10.0.0.20", "2001:db8::2"]);
    expect(ProbeInterfaceAddressesUtil.toText(first!)).toBe(
      ProbeInterfaceAddressesUtil.toText(second!),
    );
  });

  test("at most so many, the lowest kept", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 200; index++) {
      many.push(`10.0.${Math.floor(index / 250)}.${(index % 250) + 1}`);
    }

    const kept: Array<string> = ProbeInterfaceAddressesUtil.read(many)!;

    expect(kept).toHaveLength(MAX_PROBE_INTERFACE_ADDRESSES);
    expect(kept[0]).toBe("10.0.0.1");
  });

  test("a report of very many entries is read only so far", () => {
    const entries: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ;
      index++
    ) {
      entries.push("not an address");
    }

    entries.push("10.0.0.5");

    expect(ProbeInterfaceAddressesUtil.read(entries)).toEqual([]);
  });
});

describe("the column", () => {
  test("holds the addresses with a comma and a space between", () => {
    expect(
      ProbeInterfaceAddressesUtil.toText(["10.0.0.5", "2001:db8::5"]),
    ).toBe("10.0.0.5, 2001:db8::5");
    expect(ProbeInterfaceAddressesUtil.toText([])).toBe("");
  });

  test("reads back what it holds", () => {
    expect(
      ProbeInterfaceAddressesUtil.fromText("10.0.0.5, 2001:db8::5"),
    ).toEqual(["10.0.0.5", "2001:db8::5"]);
  });

  test("keeps only addresses of a value written another way", () => {
    expect(
      ProbeInterfaceAddressesUtil.fromText(
        "10.0.0.5,127.0.0.1, not-an-address ,fe80::1, 10.0.0.5",
      ),
    ).toEqual(["10.0.0.5"]);
    expect(ProbeInterfaceAddressesUtil.fromText("")).toEqual([]);
    expect(ProbeInterfaceAddressesUtil.fromText(null)).toEqual([]);
    expect(ProbeInterfaceAddressesUtil.fromText(undefined)).toEqual([]);
  });
});

/*
 * A probe without host networking (#10633) - a Kubernetes pod, a container
 * on a Docker bridge network - is told its host's addresses
 * (PROBE_HOST_IP_ADDRESSES), and lists them beside its interfaces' in the
 * same field, kept by the same rules: its polls leave the host
 * source-NATed to the host's address, which no interface of the probe holds.
 */
describe("the host's addresses a probe is told", () => {
  test("are told by one setting", () => {
    expect(PROBE_HOST_IP_ADDRESSES_SETTING).toBe("PROBE_HOST_IP_ADDRESSES");
  });

  test("Kubernetes' status.hostIP, and status.hostIPs for a dual-stack node", () => {
    expect(
      ProbeInterfaceAddressesUtil.readHostAddressesSetting("10.0.0.4"),
    ).toEqual({ addresses: ["10.0.0.4"], invalid: [] });
    expect(
      ProbeInterfaceAddressesUtil.readHostAddressesSetting("10.0.0.4,fd00::4"),
    ).toEqual({ addresses: ["10.0.0.4", "fd00::4"], invalid: [] });
  });

  test("written by a person: commas, spaces, tabs and new lines all separate", () => {
    expect(
      ProbeInterfaceAddressesUtil.readHostAddressesSetting(
        " 192.168.1.20 ,\t2001:db8::20\n 10.1.0.20,,",
      ),
    ).toEqual({
      addresses: ["192.168.1.20", "2001:db8::20", "10.1.0.20"],
      invalid: [],
    });
  });

  test("unset or blank: none, and nothing to warn of", () => {
    for (const text of [undefined, null, "", "   ", " , ,\n"]) {
      expect(
        ProbeInterfaceAddressesUtil.readHostAddressesSetting(text),
      ).toEqual({ addresses: [], invalid: [] });
    }
  });

  test("read as an interface's address: one way of writing it, its prefix length dropped, each once", () => {
    expect(
      ProbeInterfaceAddressesUtil.readHostAddressesSetting(
        "2001:DB8:0:0:0:0:0:20, 192.168.1.20/24, 2001:db8::20, 192.168.1.20",
      ),
    ).toEqual({ addresses: ["2001:db8::20", "192.168.1.20"], invalid: [] });
  });

  test("a malformed entry is dropped by the same rules, and named so the probe can warn of it", () => {
    const setting: ProbeHostAddressesSetting =
      ProbeInterfaceAddressesUtil.readHostAddressesSetting(
        "node-1.internal, 10.0.0.4, 127.0.0.1, fe80::1, 10.0.0.300, 10.0.0.4:161, 0.0.0.0, 224.0.0.1, $(HOST_IP)",
      );

    expect(setting.addresses).toEqual(["10.0.0.4"]);
    expect(setting.invalid).toEqual([
      "node-1.internal",
      "127.0.0.1",
      "fe80::1",
      "10.0.0.300",
      "10.0.0.4:161",
      "0.0.0.0",
      "224.0.0.1",
      "$(HOST_IP)",
    ]);
  });

  test("a range is never kept as one: what a slash names is one address, so a claim names single machines", () => {
    const setting: ProbeHostAddressesSetting =
      ProbeInterfaceAddressesUtil.readHostAddressesSetting(
        "10.0.0.0/8, 0.0.0.0/0, ::/0, 10.0.0.4/33/1",
      );

    // 10.0.0.0 is one address - the one written before the slash - and no more.
    expect(setting.addresses).toEqual(["10.0.0.0"]);
    expect(setting.invalid).toEqual(["0.0.0.0/0", "::/0", "10.0.0.4/33/1"]);
  });

  test("at most as many as a check-in keeps", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 100; index++) {
      many.push(`10.9.0.${index + 1}`);
    }

    expect(
      ProbeInterfaceAddressesUtil.readHostAddressesSetting(many.join(","))
        .addresses,
    ).toHaveLength(MAX_PROBE_INTERFACE_ADDRESSES);
  });
});

describe("what a check-in lists", () => {
  test("a probe told its host's address lists it beside its interfaces'", () => {
    expect(
      ProbeInterfaceAddressesUtil.forCheckIn({
        interfaceAddresses: ["10.244.1.7/24", "fe80::a8b9:1/64"],
        hostAddresses: ["10.0.0.4"],
      }),
    ).toEqual(["10.0.0.4", "10.244.1.7"]);
  });

  test("one told nothing lists only its interfaces'", () => {
    expect(
      ProbeInterfaceAddressesUtil.forCheckIn({
        interfaceAddresses: ["172.17.0.2/16"],
        hostAddresses: [],
      }),
    ).toEqual(["172.17.0.2"]);
  });

  test("a host address an interface holds too is listed once: a probe on host networking told it anyway", () => {
    expect(
      ProbeInterfaceAddressesUtil.forCheckIn({
        interfaceAddresses: ["10.0.0.4/24", "2001:db8::4/64"],
        hostAddresses: ["10.0.0.4", "2001:db8::4"],
      }),
    ).toEqual(["10.0.0.4", "2001:db8::4"]);
  });

  test("the same set is the same text, whichever side lists an address", () => {
    const told: Array<string> = ProbeInterfaceAddressesUtil.forCheckIn({
      interfaceAddresses: ["10.244.1.7/24"],
      hostAddresses: ["10.0.0.4"],
    });
    const listed: Array<string> | null = ProbeInterfaceAddressesUtil.read([
      "10.0.0.4",
      "10.244.1.7",
    ]);

    expect(ProbeInterfaceAddressesUtil.toText(told)).toBe(
      ProbeInterfaceAddressesUtil.toText(listed!),
    );
  });

  test("what the server reads of it is exactly what the probe sent: the two agree", () => {
    const sent: Array<string> = ProbeInterfaceAddressesUtil.forCheckIn({
      interfaceAddresses: ["10.244.1.7/24", "fd00:10:244::7/64"],
      hostAddresses: ["10.0.0.4", "fd00::4"],
    });

    expect(ProbeInterfaceAddressesUtil.read(sent)).toEqual(sent);
    expect(
      ProbeInterfaceAddressesUtil.fromText(
        ProbeInterfaceAddressesUtil.toText(sent),
      ),
    ).toEqual(sent);
  });

  test("an interface listing of very many entries never cuts the host's addresses from what is read", () => {
    const noise: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ + 10;
      index++
    ) {
      noise.push("fe80::1/64");
    }

    expect(
      ProbeInterfaceAddressesUtil.forCheckIn({
        interfaceAddresses: noise,
        hostAddresses: ["10.0.0.4"],
      }),
    ).toEqual(["10.0.0.4"]);
  });
});
