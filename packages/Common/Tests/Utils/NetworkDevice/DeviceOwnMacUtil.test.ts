import { describe, expect, test } from "@jest/globals";
import {
  DeviceOwnMacCandidate,
  MAC_BLOCK_SIZE,
  isInMacBlock,
  pickDeviceOwnMac,
} from "../../../Utils/NetworkDevice/DeviceOwnMacUtil";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * A device's own MAC, out of the interface table its poll reads anyway
 * (issue #5384). A Meraki MX is the router at its site, so no walked router's
 * ARP table ever named it, and it read "MAC Address: Unknown" with its
 * interfaces' addresses already in OneUptime.
 *
 * The first cases are real devices' interface tables, as recorded for
 * LibreNMS's test suite: the table a Meraki access point really answers with
 * is the reason a radio's all-zero address has to be stepped over.
 */

// ifType values the cases use (IANAifType-MIB).
const ETHERNET: number = 6;
const PROP_VIRTUAL: number = 53;
const IEEE_80211: number = 71;
const SOFTWARE_LOOPBACK: number = 24;
const TUNNEL: number = 131;
const BRIDGE: number = 209;

function port(
  interfaceIndex: number,
  macAddress: string | undefined,
  interfaceType: number | undefined = ETHERNET,
): DeviceOwnMacCandidate {
  return { interfaceIndex, macAddress, interfaceType };
}

describe("the real tables of devices that answer IF-MIB and nothing else", () => {
  test("a Meraki MR28: its wired port, not the radios that report no address", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "6c:c3:b2:4f:cd:e7", ETHERNET),
        // The probe reads all zeros as no address.
        port(2, undefined, IEEE_80211),
        port(3, undefined, IEEE_80211),
      ]),
    ).toBe("6c:c3:b2:4f:cd:e7");
  });

  test("a Cisco CW9176 in Meraki mode reads the same way", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "ac:69:cf:1e:8d:e0", ETHERNET),
        port(2, undefined, IEEE_80211),
        port(3, undefined, IEEE_80211),
        port(4, undefined, IEEE_80211),
      ]),
    ).toBe("ac:69:cf:1e:8d:e0");
  });

  test("a Meraki MR16, whose radio carries a made-up address after the real one", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "00:18:0a:34:36:c4", ETHERNET),
        port(2, "00:18:0a:34:36:c4", IEEE_80211),
        port(3, "02:18:1a:34:36:c4", IEEE_80211),
      ]),
    ).toBe("00:18:0a:34:36:c4");
  });

  test("a cloud-managed Catalyst: its first port, whatever its interfaces are numbered from", () => {
    expect(
      pickDeviceOwnMac([
        port(9, "d4:7f:35:5b:ee:81"),
        port(10, "d4:7f:35:5b:ee:82"),
        port(11, "d4:7f:35:5b:ee:83"),
      ]),
    ).toBe("d4:7f:35:5b:ee:81");
  });
});

describe("which port", () => {
  test("Ethernet comes before a lower-numbered interface of another kind", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "00:aa:00:00:00:01", PROP_VIRTUAL),
        port(10101, "00:aa:00:00:00:81", ETHERNET),
      ]),
    ).toBe("00:aa:00:00:00:81");
  });

  test("the lowest-numbered Ethernet port, however the walk ordered them", () => {
    expect(
      pickDeviceOwnMac([
        port(30, "00:aa:00:00:00:30"),
        port(4, "00:aa:00:00:00:04"),
        port(12, "00:aa:00:00:00:12"),
      ]),
    ).toBe("00:aa:00:00:00:04");
  });

  test("every Ethernet ifType an agent uses counts", () => {
    for (const interfaceType of [6, 62, 69, 117]) {
      expect(
        pickDeviceOwnMac([
          port(1, "00:aa:00:00:00:01", BRIDGE),
          port(2, "00:aa:00:00:00:02", interfaceType),
        ]),
      ).toBe("00:aa:00:00:00:02");
    }
  });

  test("a burned-in address beats a lower-numbered made-up one: a Linux host's docker0 is not the host", () => {
    expect(
      pickDeviceOwnMac([
        port(2, "02:42:ac:11:00:02"),
        port(3, "52:54:00:12:34:56"),
        port(4, "3c:ec:ef:12:34:56"),
      ]),
    ).toBe("3c:ec:ef:12:34:56");
  });

  test("a device that is only Wi-Fi gives its radio's address", () => {
    expect(pickDeviceOwnMac([port(1, "6c:c3:b2:4f:cd:e7", IEEE_80211)])).toBe(
      "6c:c3:b2:4f:cd:e7",
    );
  });

  test("a virtual machine's only NIC has a made-up address, and that is its address", () => {
    expect(
      pickDeviceOwnMac([
        port(1, undefined, SOFTWARE_LOOPBACK),
        port(2, "52:54:00:ab:cd:ef", ETHERNET),
      ]),
    ).toBe("52:54:00:ab:cd:ef");
  });

  test("a made-up address on anything but Ethernet is no device's own", () => {
    expect(
      pickDeviceOwnMac([
        port(3, "02:18:1a:34:36:c4", IEEE_80211),
        port(4, "02:00:5e:00:00:01", TUNNEL),
      ]),
    ).toBeUndefined();
  });

  test("an older probe that sends no ifType still gives an address", () => {
    expect(
      pickDeviceOwnMac([
        { interfaceIndex: 1, macAddress: "00:aa:00:00:00:01" },
        { interfaceIndex: 2, macAddress: "00:aa:00:00:00:02" },
      ]),
    ).toBe("00:aa:00:00:00:01");
  });

  test("the choice reads no status: a port going down does not move the device's MAC", () => {
    const candidates: Array<DeviceOwnMacCandidate> = [
      {
        ...port(1, "00:aa:00:00:00:01"),
        isOperationallyUp: false,
      } as DeviceOwnMacCandidate,
      {
        ...port(2, "00:aa:00:00:00:02"),
        isOperationallyUp: true,
      } as DeviceOwnMacCandidate,
    ];

    expect(pickDeviceOwnMac(candidates)).toBe("00:aa:00:00:00:01");
  });

  test("the same table in any order gives the same address", () => {
    const table: Array<DeviceOwnMacCandidate> = [
      port(1, undefined, SOFTWARE_LOOPBACK),
      port(2, "02:42:ac:11:00:02", ETHERNET),
      port(3, "00:aa:00:00:00:03", PROP_VIRTUAL),
      port(4, "00:aa:00:00:00:04", ETHERNET),
      port(5, "00:aa:00:00:00:05", ETHERNET),
      port(6, "02:18:1a:34:36:c4", IEEE_80211),
    ];
    const random: SeededRandom = seededRandom(5384);

    for (let round: number = 0; round < 200; round++) {
      expect(pickDeviceOwnMac(shuffled(table, random))).toBe(
        "00:aa:00:00:00:04",
      );
    }
  });
});

describe("what is not a device's address", () => {
  test("all zeros, all ones and group addresses", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "00:00:00:00:00:00"),
        port(2, "ff:ff:ff:ff:ff:ff"),
        port(3, "01:00:5e:00:00:01"),
        port(4, "33:33:00:00:00:01"),
      ]),
    ).toBeUndefined();
  });

  test("anything that is not six octets: a tunnel's IP address, an EUI-64, text", () => {
    expect(
      pickDeviceOwnMac([
        port(1, "0a:00:00:01", TUNNEL),
        port(2, "00:11:22:33:44:55:66:77"),
        port(3, "not a mac"),
        port(4, ""),
      ]),
    ).toBeUndefined();
  });

  test("no interfaces at all", () => {
    expect(pickDeviceOwnMac([])).toBeUndefined();
    expect(pickDeviceOwnMac(undefined)).toBeUndefined();
  });

  test("a row an old or malformed report left half-filled is stepped over", () => {
    expect(
      pickDeviceOwnMac([
        undefined as unknown as DeviceOwnMacCandidate,
        null as unknown as DeviceOwnMacCandidate,
        port(2, "00:aa:00:00:00:02"),
      ]),
    ).toBe("00:aa:00:00:00:02");
  });

  test("a MAC in another spelling comes back in OneUptime's one spelling", () => {
    expect(pickDeviceOwnMac([port(1, "00-AA-00-00-00-01")])).toBe(
      "00:aa:00:00:00:01",
    );
    expect(pickDeviceOwnMac([port(1, "00aa.0000.0001")])).toBe(
      "00:aa:00:00:00:01",
    );
  });
});

describe("isInMacBlock: a box's ports are numbered up from the MAC its dashboard lists", () => {
  test("Meraki's own worked example: an MX64's WAN 1 is its base address plus five", () => {
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:e8", mac: "aa:bb:cc:06:25:ed" }),
    ).toBe(true);
  });

  test("a cloud-managed Catalyst's first port is its base address plus one", () => {
    expect(
      isInMacBlock({ baseMac: "d4:7f:35:5b:ee:80", mac: "d4:7f:35:5b:ee:81" }),
    ).toBe(true);
  });

  test("the base address itself is in its block", () => {
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:e8", mac: "aa:bb:cc:06:25:e8" }),
    ).toBe(true);
  });

  test("the block ends where the next box could begin", () => {
    expect(MAC_BLOCK_SIZE).toBe(64);
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:00", mac: "aa:bb:cc:06:25:3f" }),
    ).toBe(true);
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:00", mac: "aa:bb:cc:06:25:40" }),
    ).toBe(false);
  });

  test("an address below the base is not one numbered up from it", () => {
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:e8", mac: "aa:bb:cc:06:25:e7" }),
    ).toBe(false);
  });

  test("the addition carries across octets, as Meraki's does", () => {
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:fe", mac: "aa:bb:cc:06:26:01" }),
    ).toBe(true);
  });

  test("the same last octet under another vendor prefix is nowhere near", () => {
    expect(
      isInMacBlock({ baseMac: "aa:bb:cc:06:25:e8", mac: "aa:bb:cd:06:25:e8" }),
    ).toBe(false);
  });

  test("text that is not a MAC is in no block", () => {
    expect(isInMacBlock({ baseMac: "not a mac", mac: "also not" })).toBe(false);
    expect(isInMacBlock({ baseMac: "", mac: "aa:bb:cc:06:25:e8" })).toBe(false);
  });
});
