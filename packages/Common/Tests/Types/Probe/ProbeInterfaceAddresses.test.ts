import { describe, expect, test } from "@jest/globals";
import ProbeInterfaceAddressesUtil, {
  MAX_PROBE_INTERFACE_ADDRESSES,
  MAX_PROBE_INTERFACE_ADDRESS_ENTRIES_READ,
  PROBE_INTERFACE_ADDRESSES_FIELD,
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
