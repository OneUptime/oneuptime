import {
  readClientLastSeen,
  readClientName,
  readClientPort,
  readClientVlanId,
  readMerakiClients,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiClientList";
import { NetworkControllerClient } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * What a network's client listing says about where each client is
 * (OneUptime issue #5379). The rows are shaped as the API's specification
 * (v1.75) shapes them: `lastSeen` is epoch seconds, `vlan` is text,
 * `recentDeviceConnection` is "Wired" or "Wireless".
 */

const NOW: Date = new Date("2026-11-01T12:00:00Z");

const wiredRow: Record<string, unknown> = {
  id: "k74272e",
  mac: "AA:BB:CC:00:00:51",
  ip: "10.18.166.51",
  description: "wb-0660-kds01",
  firstSeen: 1761000000,
  lastSeen: 1793534000,
  manufacturer: "Elo Touch",
  vlan: "18",
  switchport: "7",
  ssid: null,
  recentDeviceSerial: "q2xx-aaaa-0001",
  recentDeviceName: "UN0660LANSWI01",
  recentDeviceMac: "e0:55:3d:00:00:01",
  recentDeviceConnection: "Wired",
  status: "Online",
};

function readOne(
  row: Record<string, unknown>,
): NetworkControllerClient | undefined {
  return readMerakiClients([row], NOW)[0];
}

describe("one row", () => {
  test("a wired client: which switch, which port, what it is called", () => {
    expect(readOne(wiredRow)).toEqual({
      mac: "aa:bb:cc:00:00:51",
      ip: "10.18.166.51",
      name: "wb-0660-kds01",
      manufacturer: "Elo Touch",
      vlanId: 18,
      deviceSerial: "Q2XX-AAAA-0001",
      port: "Port 7",
      isWireless: false,
      lastSeenAt: new Date(1793534000 * 1000),
    });
  });

  test("a Wi-Fi client is on its access point, and its SSID is what it hangs from", () => {
    expect(
      readOne({
        ...wiredRow,
        switchport: null,
        ssid: "Store-POS",
        recentDeviceConnection: "Wireless",
      }),
    ).toMatchObject({ isWireless: true, port: "Store-POS" });
  });

  test("a row from before Meraki said how it connects: an SSID and no port is Wi-Fi", () => {
    expect(
      readOne({
        ...wiredRow,
        recentDeviceConnection: undefined,
        switchport: null,
        ssid: "Store-POS",
      }),
    ).toMatchObject({ isWireless: true });
    expect(
      readOne({ ...wiredRow, recentDeviceConnection: undefined }),
    ).toMatchObject({ isWireless: false });
  });

  test("a wired client on an appliance's port says so with no port at all", () => {
    expect(readOne({ ...wiredRow, switchport: null })).toMatchObject({
      port: "",
      isWireless: false,
    });
  });

  test("any spelling of a MAC comes out in the one OneUptime keeps", () => {
    expect(readOne({ ...wiredRow, mac: "aabb.cc00.0051" })?.mac).toBe(
      "aa:bb:cc:00:00:51",
    );
    expect(readOne({ ...wiredRow, mac: "AA-BB-CC-00-00-51" })?.mac).toBe(
      "aa:bb:cc:00:00:51",
    );
  });

  test("an address that is no address is left out, and the client stays", () => {
    expect(readOne({ ...wiredRow, ip: "not an address" })?.ip).toBe("");
    expect(readOne({ ...wiredRow, ip: null })?.ip).toBe("");
  });

  test.each([
    ["no MAC", { mac: null }],
    ["a MAC that is not one", { mac: "aa:bb" }],
    ["no device", { recentDeviceSerial: null }],
    ["an empty device", { recentDeviceSerial: "   " }],
  ])(
    "a row with %s places nothing",
    (_label: string, change: Record<string, unknown>) => {
      expect(readOne({ ...wiredRow, ...change })).toBeUndefined();
    },
  );

  test("a row that is not an object is skipped, and the ones around it are read", () => {
    expect(
      readMerakiClients([null, "client", 7, [], wiredRow], NOW),
    ).toHaveLength(1);
  });

  test("one MAC is one client: the first row wins", () => {
    const clients: Array<NetworkControllerClient> = readMerakiClients(
      [wiredRow, { ...wiredRow, switchport: "9" }],
      NOW,
    );

    expect(clients).toHaveLength(1);
    expect(clients[0]?.port).toBe("Port 7");
  });

  test("outside text is cut to fit and has no control characters left", () => {
    const client: NetworkControllerClient | undefined = readOne({
      ...wiredRow,
      description: `kds\u0000\n${"x".repeat(1000)}`,
    });

    expect(client?.name.startsWith("kds x")).toBe(true);
    expect(client?.name.length).toBeLessThanOrEqual(128);
  });
});

describe("a client's name", () => {
  test.each([
    ["wb-0660-kds01", "wb-0660-kds01"],
    ["Miles's phone", "Miles's phone"],
    ["  padded  ", "padded"],
  ])("%s is a name", (value: string, expected: string) => {
    expect(readClientName(value)).toBe(expected);
  });

  test.each([
    ["its MAC", "aa:bb:cc:00:00:51"],
    ["its MAC in Cisco's spelling", "aabb.cc00.0051"],
    ["bare hex", "aabbcc000051"],
    ["its address", "10.18.166.51"],
    ["an IPv6 address", "2001:db8::1"],
    ["nothing", ""],
    ["null", null],
  ])("%s is not", (_label: string, value: unknown) => {
    expect(readClientName(value)).toBe("");
  });
});

describe("a client's port", () => {
  test.each([
    ["7", "Port 7"],
    [7, "Port 7"],
    ["  12 ", "Port 12"],
    ["1_MA-MOD-4X10G_1", "1_MA-MOD-4X10G_1"],
    ["My switch port", "My switch port"],
    ["", ""],
    [null, ""],
  ])("%s reads as %s", (value: unknown, expected: string) => {
    expect(readClientPort(value)).toBe(expected);
  });
});

describe("a client's VLAN", () => {
  test.each([
    ["100", 100],
    [100, 100],
    ["1", 1],
    ["4094", 4094],
  ])("%s is that VLAN", (value: unknown, expected: number) => {
    expect(readClientVlanId(value)).toBe(expected);
  });

  test.each([
    ["a name", "Kitchen"],
    ["zero", "0"],
    ["past the range", "4095"],
    ["a negative", "-1"],
    ["a decimal", "1.5"],
    ["nothing", null],
    ["a huge number", "99999999999999999999"],
  ])("%s is not", (_label: string, value: unknown) => {
    expect(readClientVlanId(value)).toBeUndefined();
  });
});

describe("when a client was last seen", () => {
  test("Meraki's epoch seconds", () => {
    expect(readClientLastSeen(1793534000, NOW)).toEqual(
      new Date(1793534000 * 1000),
    );
  });

  test("the same as a string of digits", () => {
    expect(readClientLastSeen("1793534000", NOW)).toEqual(
      new Date(1793534000 * 1000),
    );
  });

  test("an ISO time, as other Meraki listings send", () => {
    expect(readClientLastSeen("2026-11-01T10:00:00Z", NOW)).toEqual(
      new Date("2026-11-01T10:00:00Z"),
    );
  });

  test("a sighting from the future is the read's: it would keep a row fresh for ever", () => {
    expect(readClientLastSeen(9999999999, NOW)).toEqual(NOW);
    expect(readClientLastSeen("2099-01-01T00:00:00Z", NOW)).toEqual(NOW);
  });

  test.each([
    ["nothing", null],
    ["garbage", "yesterday-ish"],
    ["zero", 0],
    ["a negative", -5],
    ["not a number", Number.NaN],
    ["an object", {}],
  ])("%s is the read's own time", (_label: string, value: unknown) => {
    expect(readClientLastSeen(value, NOW)).toEqual(NOW);
  });
});
