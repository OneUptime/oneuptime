import WifiRadioUtil, {
  WifiBand,
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
  WifiTablesState,
} from "../../../Utils/NetworkDevice/WifiRadioUtil";
import {
  SnmpTableDefinition,
  SnmpTableFailureReason,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { describe, expect, it } from "@jest/globals";

const RADIO: string = "1.3.6.1.4.1.17713.22.1.2.1";
const WLAN: string = "1.3.6.1.4.1.17713.22.1.4.1";

/*
 * A Cambium XV3-8 walked through the shipped vendor pack: two radios on 2.4
 * and 5 GHz, one switched off, and two SSIDs.
 */
function cambiumSnapshots(): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!.tables!,
    collectedAt: new Date("2026-10-07T10:00:00.000Z"),
    results: [
      {
        key: "wifi_radios",
        rows: [
          {
            index: "1",
            values: {
              [`${RADIO}.3`]: "2.4GHz",
              [`${RADIO}.6`]: "6",
              [`${RADIO}.7`]: "20MHz",
              [`${RADIO}.8`]: 14,
              [`${RADIO}.5`]: 9,
              [`${RADIO}.16`]: "-95",
              [`${RADIO}.18`]: "31/12/19/0",
              [`${RADIO}.13`]: "ON",
            },
          },
          {
            index: "2",
            values: {
              [`${RADIO}.3`]: "5GHz",
              [`${RADIO}.6`]: "36",
              [`${RADIO}.7`]: "80MHz",
              [`${RADIO}.8`]: 21,
              [`${RADIO}.5`]: 0,
              [`${RADIO}.16`]: "-92",
              [`${RADIO}.18`]: "4/2/2/0",
              [`${RADIO}.13`]: "OFF",
            },
          },
        ],
      },
      {
        key: "wifi_ssids",
        rows: [
          {
            index: "0",
            values: {
              [`${WLAN}.2`]: "Corp",
              [`${WLAN}.3`]: "5GHz",
              [`${WLAN}.4`]: 10,
              [`${WLAN}.7`]: 7,
            },
          },
          {
            index: "1",
            values: {
              [`${WLAN}.2`]: "Guest",
              [`${WLAN}.3`]: "2.4GHz",
              [`${WLAN}.4`]: 20,
              [`${WLAN}.7`]: 2,
            },
          },
        ],
      },
    ],
  });
}

describe("WifiRadioUtil.getSummary", () => {
  it("reads every radio by column role, frequency included", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(cambiumSnapshots());

    expect(summary.radios).toEqual([
      {
        name: "2.4GHz",
        index: "1",
        band: WifiBand.Band2_4GHz,
        bandText: "2.4GHz",
        channel: 6,
        frequencyMHz: 2437,
        channelWidthMHz: 20,
        txPowerDbm: 14,
        clients: 9,
        noiseFloorDbm: -95,
        utilizationPercent: 31,
        isOn: true,
        statusText: "On",
      },
      {
        name: "5GHz",
        index: "2",
        band: WifiBand.Band5GHz,
        bandText: "5GHz",
        channel: 36,
        frequencyMHz: 5180,
        channelWidthMHz: 80,
        txPowerDbm: 21,
        clients: 0,
        noiseFloorDbm: -92,
        utilizationPercent: 4,
        isOn: false,
        statusText: "Off",
      },
    ]);

    expect(summary.totalClients).toBe(9);
    expect(summary.collectedAt).toBe("2026-10-07T10:00:00.000Z");
  });

  it("lists SSIDs with their band and clients", () => {
    expect(WifiRadioUtil.getSummary(cambiumSnapshots()).ssids).toEqual([
      {
        name: "Corp / 5GHz",
        ssid: "Corp",
        bandText: "5GHz",
        band: WifiBand.Band5GHz,
        clients: 7,
      },
      {
        name: "Guest / 2.4GHz",
        ssid: "Guest",
        bandText: "2.4GHz",
        band: WifiBand.Band2_4GHz,
        clients: 2,
      },
    ]);
  });

  it("is empty for a device with no Wi-Fi tables", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      {
        key: "fans",
        name: "Fans",
        kind: SnmpTableKind.Hardware,
        columns: [],
        rows: [],
      },
    ]);

    expect(summary.radios).toEqual([]);
    expect(summary.ssids).toEqual([]);
    expect(summary.totalClients).toBeUndefined();
    expect(WifiRadioUtil.hasWifiTables(undefined)).toBe(false);
    expect(WifiRadioUtil.hasWifiTables(cambiumSnapshots())).toBe(true);
  });

  it("passes a radio table's failure through", () => {
    const snapshots: Array<SnmpTableSnapshot> = cambiumSnapshots();
    snapshots[0] = { ...snapshots[0]!, failureCause: "Request timed out" };

    expect(WifiRadioUtil.getSummary(snapshots).failureCause).toBe(
      "Request timed out",
    );
  });

  it("infers the band from the channel when the table reports none", () => {
    const radio: WifiRadioView = WifiRadioUtil.toRadio(
      {
        key: "r",
        name: "Radios",
        kind: SnmpTableKind.WifiRadio,
        columns: [{ oid: "1.1", name: "Channel", role: "Channel" as never }],
        rows: [],
      },
      {
        index: "1",
        label: "Radio 1",
        cells: { "1.1": { raw: "149", display: "149", numeric: 149 } },
      },
    );

    expect(radio.band).toBe(WifiBand.Band5GHz);
    expect(radio.frequencyMHz).toBe(5745);
    expect(radio.isOn).toBeUndefined();
  });
});

describe("WifiRadioUtil.parseBand", () => {
  it.each([
    ["2.4GHz", WifiBand.Band2_4GHz],
    ["2.4 ghz", WifiBand.Band2_4GHz],
    ["2,4 GHz", WifiBand.Band2_4GHz],
    ["2G", WifiBand.Band2_4GHz],
    ["11axg", WifiBand.Band2_4GHz],
    ["11ng", WifiBand.Band2_4GHz],
    ["802.11b", WifiBand.Band2_4GHz],
    ["5GHz", WifiBand.Band5GHz],
    ["5 GHz", WifiBand.Band5GHz],
    ["5G", WifiBand.Band5GHz],
    ["11ac", WifiBand.Band5GHz],
    ["11axa", WifiBand.Band5GHz],
    ["11na", WifiBand.Band5GHz],
    ["6GHz", WifiBand.Band6GHz],
    ["6 GHz", WifiBand.Band6GHz],
    ["6E", WifiBand.Band6GHz],
  ])("%s -> %s", (text: string, band: WifiBand) => {
    expect(WifiRadioUtil.parseBand(text)).toBe(band);
  });

  it("gives no band for text it does not recognise", () => {
    expect(WifiRadioUtil.parseBand("11ax")).toBeUndefined();
    expect(WifiRadioUtil.parseBand("radio")).toBeUndefined();
    expect(WifiRadioUtil.parseBand("")).toBeUndefined();
    expect(WifiRadioUtil.parseBand(undefined)).toBeUndefined();
  });
});

describe("WifiRadioUtil.channelToFrequencyMHz", () => {
  it.each([
    [1, WifiBand.Band2_4GHz, 2412],
    [6, WifiBand.Band2_4GHz, 2437],
    [11, WifiBand.Band2_4GHz, 2462],
    [13, WifiBand.Band2_4GHz, 2472],
    [14, WifiBand.Band2_4GHz, 2484],
    [36, WifiBand.Band5GHz, 5180],
    [100, WifiBand.Band5GHz, 5500],
    [165, WifiBand.Band5GHz, 5825],
    [1, WifiBand.Band6GHz, 5955],
    [2, WifiBand.Band6GHz, 5935],
    [37, WifiBand.Band6GHz, 6135],
    [233, WifiBand.Band6GHz, 7115],
  ])(
    "channel %s on %s is %s MHz",
    (channel: number, band: WifiBand, mhz: number) => {
      expect(WifiRadioUtil.channelToFrequencyMHz(channel, band)).toBe(mhz);
    },
  );

  it("has no frequency for an impossible channel, a fraction or an unknown band", () => {
    expect(
      WifiRadioUtil.channelToFrequencyMHz(15, WifiBand.Band2_4GHz),
    ).toBeUndefined();
    expect(
      WifiRadioUtil.channelToFrequencyMHz(14.5, WifiBand.Band2_4GHz),
    ).toBeUndefined();
    expect(
      WifiRadioUtil.channelToFrequencyMHz(20, WifiBand.Band5GHz),
    ).toBeUndefined();
    expect(
      WifiRadioUtil.channelToFrequencyMHz(300, WifiBand.Band6GHz),
    ).toBeUndefined();
    expect(WifiRadioUtil.channelToFrequencyMHz(6, undefined)).toBeUndefined();
    expect(
      WifiRadioUtil.channelToFrequencyMHz(undefined, WifiBand.Band5GHz),
    ).toBeUndefined();
  });
});

describe("WifiRadioUtil.inferBandFromChannel", () => {
  it("only infers channels that belong to one band", () => {
    expect(WifiRadioUtil.inferBandFromChannel(1)).toBe(WifiBand.Band2_4GHz);
    expect(WifiRadioUtil.inferBandFromChannel(14)).toBe(WifiBand.Band2_4GHz);
    expect(WifiRadioUtil.inferBandFromChannel(36)).toBe(WifiBand.Band5GHz);
    expect(WifiRadioUtil.inferBandFromChannel(177)).toBe(WifiBand.Band5GHz);
    /*
     * Past 177 no 5 GHz channel is numbered, and 6 GHz numbers its
     * channels 1, 5, 9 ... 233: 181 can only be 6 GHz.
     */
    expect(WifiRadioUtil.inferBandFromChannel(181)).toBe(WifiBand.Band6GHz);
    expect(WifiRadioUtil.inferBandFromChannel(20)).toBeUndefined();
    expect(WifiRadioUtil.inferBandFromChannel(undefined)).toBeUndefined();
  });
});

/*
 * A Cambium Wi-Fi 7 access point (an X7-35X on 7.1 firmware) as the
 * customer's cnMaestro showed it: three radios, the 2.4 GHz one switched
 * off, 5 GHz on channel 44 at 40 MHz and 6 GHz on channel 5 at 80 MHz, and
 * SSIDs broadcast on both of the radios that are on. The agent numbers its
 * rows from 0, as it does the access point's own scalars.
 */
function cambiumWifi7Snapshots(): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById("cambium-wifi-ap")!.tables!,
    collectedAt: new Date("2026-10-12T09:15:00.000Z"),
    results: [
      {
        key: "wifi_radios",
        rows: [
          {
            index: "0",
            values: {
              [`${RADIO}.3`]: "2.4GHz",
              [`${RADIO}.5`]: 0,
              [`${RADIO}.6`]: "-",
              [`${RADIO}.7`]: "20MHz",
              [`${RADIO}.8`]: 0,
              [`${RADIO}.13`]: "OFF",
              [`${RADIO}.16`]: "0",
              [`${RADIO}.18`]: "0/0/0/0/0",
            },
          },
          {
            index: "1",
            values: {
              [`${RADIO}.3`]: "5GHz",
              [`${RADIO}.5`]: 5,
              [`${RADIO}.6`]: "44",
              [`${RADIO}.7`]: "40MHz",
              [`${RADIO}.8`]: 17,
              [`${RADIO}.13`]: "ON",
              [`${RADIO}.16`]: "-107",
              [`${RADIO}.18`]: "5/1452/2/0/0",
            },
          },
          {
            index: "2",
            values: {
              [`${RADIO}.3`]: "6GHz",
              [`${RADIO}.5`]: 4,
              [`${RADIO}.6`]: "5",
              [`${RADIO}.7`]: "80MHz",
              [`${RADIO}.8`]: 18,
              [`${RADIO}.13`]: "ON",
              [`${RADIO}.16`]: "-104",
              [`${RADIO}.18`]: "6/1533/3/2/0",
            },
          },
        ],
      },
      {
        key: "wifi_ssids",
        rows: [
          {
            index: "0",
            values: {
              [`${WLAN}.2`]: "Workshop",
              [`${WLAN}.3`]: "5GHz,6GHz",
              [`${WLAN}.4`]: 30,
              [`${WLAN}.7`]: 6,
            },
          },
          {
            index: "1",
            values: {
              [`${WLAN}.2`]: "Visitors",
              [`${WLAN}.3`]: "5GHz,6GHz",
              [`${WLAN}.4`]: 40,
              [`${WLAN}.7`]: 3,
            },
          },
        ],
      },
    ],
  });
}

describe("a Cambium Wi-Fi 7 access point through the shipped template", () => {
  it("reads all three radios, the 6 GHz one on its own channel plan", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      cambiumWifi7Snapshots(),
    );

    expect(summary.radios).toEqual([
      {
        name: "2.4GHz",
        index: "0",
        band: WifiBand.Band2_4GHz,
        bandText: "2.4GHz",
        channelWidthMHz: 20,
        txPowerDbm: 0,
        clients: 0,
        noiseFloorDbm: 0,
        utilizationPercent: 0,
        isOn: false,
        statusText: "Off",
      },
      {
        name: "5GHz",
        index: "1",
        band: WifiBand.Band5GHz,
        bandText: "5GHz",
        channel: 44,
        frequencyMHz: 5220,
        channelWidthMHz: 40,
        txPowerDbm: 17,
        clients: 5,
        noiseFloorDbm: -107,
        utilizationPercent: 5,
        isOn: true,
        statusText: "On",
      },
      {
        name: "6GHz",
        index: "2",
        band: WifiBand.Band6GHz,
        bandText: "6GHz",
        // Channel 5 is a 2.4 GHz channel too: the band text decides.
        channel: 5,
        frequencyMHz: 5975,
        channelWidthMHz: 80,
        txPowerDbm: 18,
        clients: 4,
        noiseFloorDbm: -104,
        utilizationPercent: 6,
        isOn: true,
        statusText: "On",
      },
    ]);

    expect(summary.totalClients).toBe(9);
    expect(summary.collectedAt).toBe("2026-10-12T09:15:00.000Z");
    expect(WifiRadioUtil.getTablesState(summary)).toBe(WifiTablesState.HasRows);
  });

  it("shows an SSID on two bands as the device wrote it, not as the first band named", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      cambiumWifi7Snapshots(),
    );

    expect(summary.ssids).toEqual([
      {
        name: "Workshop / 5GHz,6GHz",
        ssid: "Workshop",
        bandText: "5GHz,6GHz",
        clients: 6,
      },
      {
        name: "Visitors / 5GHz,6GHz",
        ssid: "Visitors",
        bandText: "5GHz,6GHz",
        clients: 3,
      },
    ]);
  });
});

describe("WifiRadioUtil.parseBand with text that names several bands", () => {
  it.each([
    "2.4GHz,5GHz",
    "2.4GHz/5GHz/6GHz",
    "5GHz,6GHz",
    "2.4 & 5 GHz",
    "5 GHz + 6 GHz",
    "2.4GHz 6E",
    "2G/5G",
  ])("%s is no one band", (text: string) => {
    expect(WifiRadioUtil.parseBand(text)).toBeUndefined();
  });

  it("still reads a band named once, however it is written", () => {
    expect(WifiRadioUtil.parseBand("5.8 GHz")).toBe(WifiBand.Band5GHz);
    expect(WifiRadioUtil.parseBand("6 GHz (6E)")).toBe(WifiBand.Band6GHz);
    expect(WifiRadioUtil.parseBand("Radio 2.4GHz")).toBe(WifiBand.Band2_4GHz);
  });

  it("places a radio whose band text names two bands by its channel instead", () => {
    const radio: WifiRadioView = WifiRadioUtil.toRadio(
      {
        key: "r",
        name: "Radios",
        kind: SnmpTableKind.WifiRadio,
        columns: [
          { oid: "1.1", name: "Band", role: "Band" as never },
          { oid: "1.2", name: "Channel", role: "Channel" as never },
        ],
        rows: [],
      },
      {
        index: "1",
        label: "Flex radio",
        cells: {
          "1.1": { raw: "5GHz/6GHz", display: "5GHz/6GHz" },
          "1.2": { raw: "149", display: "149", numeric: 149 },
        },
      },
    );

    expect(radio.bandText).toBe("5GHz/6GHz");
    expect(radio.band).toBe(WifiBand.Band5GHz);
    expect(radio.frequencyMHz).toBe(5745);
  });
});

describe("WifiRadioUtil.getTablesState", () => {
  function emptyTables(
    overrides: Partial<SnmpTableSnapshot> = {},
  ): Array<SnmpTableSnapshot> {
    return cambiumWifi7Snapshots().map((snapshot: SnmpTableSnapshot) => {
      return { ...snapshot, rows: [], ...overrides };
    });
  }

  it("has rows when any access point, radio or SSID is listed", () => {
    expect(
      WifiRadioUtil.getTablesState(
        WifiRadioUtil.getSummary(cambiumWifi7Snapshots()),
      ),
    ).toBe(WifiTablesState.HasRows);

    // SSIDs alone are something to list.
    const ssidsOnly: Array<SnmpTableSnapshot> = cambiumWifi7Snapshots();
    ssidsOnly[0] = { ...ssidsOnly[0]!, rows: [] };

    expect(
      WifiRadioUtil.getTablesState(WifiRadioUtil.getSummary(ssidsOnly)),
    ).toBe(WifiTablesState.HasRows);
  });

  it("says the probe did not walk them when that is the stored reason", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      emptyTables({
        failureCause: "The probe did not walk them.",
        failureReason: SnmpTableFailureReason.ProbeDidNotWalkTables,
      }),
    );

    expect(summary.failureReason).toBe(
      SnmpTableFailureReason.ProbeDidNotWalkTables,
    );
    expect(WifiRadioUtil.getTablesState(summary)).toBe(
      WifiTablesState.NotWalkedByProbe,
    );
  });

  it("says the walk failed when it did and nothing earlier is left", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      emptyTables({ failureCause: "Request timed out" }),
    );

    expect(summary.failureReason).toBeUndefined();
    expect(WifiRadioUtil.getTablesState(summary)).toBe(
      WifiTablesState.WalkFailed,
    );
  });

  it("says the device reported nothing when the walk worked and found nothing", () => {
    expect(
      WifiRadioUtil.getTablesState(WifiRadioUtil.getSummary(emptyTables())),
    ).toBe(WifiTablesState.NoRows);
  });

  it("reads SSIDs that are only interfaces as nothing to list", () => {
    const tables: Array<SnmpTableSnapshot> = emptyTables();
    const ssidColumn: string = `${WLAN}.2`;

    tables[1] = {
      ...tables[1]!,
      rows: [
        {
          index: "0",
          label: "N/A",
          cells: { [ssidColumn]: { raw: "N/A", display: "N/A" } },
        },
      ],
    };

    expect(WifiRadioUtil.getTablesState(WifiRadioUtil.getSummary(tables))).toBe(
      WifiTablesState.NoRows,
    );
  });

  it("carries a reason only with the failure it explains", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      emptyTables({
        failureReason: SnmpTableFailureReason.ProbeDidNotWalkTables,
      }),
    );

    expect(summary.failureReason).toBeUndefined();
    expect(WifiRadioUtil.getTablesState(summary)).toBe(WifiTablesState.NoRows);
  });
});

/*
 * A UniFi access point's snapshot as walks stored it before #4730: every
 * VAP of its unifiVapTable, UniFi's own networks included - the device
 * adoption network on both bands and the wireless mesh link, one meshed
 * access point on it. The Wi-Fi view leaves them out until the next walk
 * stores the SSIDs alone.
 */
const UNIFI_RADIO_ENTRY: string = "1.3.6.1.4.1.41112.1.6.1.1.1";
const UNIFI_VAP_ENTRY: string = "1.3.6.1.4.1.41112.1.6.1.2.1";

interface StoredVap {
  index: string;
  essid: string;
  radio: string;
  stations: number;
  usage: string;
}

function unifiStoredBeforeTheFix(
  vaps: Array<StoredVap>,
): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpVendorTemplateUtil.getById("ubiquiti-unifi-ap")!.tables!.map(
      (table: SnmpTableDefinition): SnmpTableDefinition => {
        // A table of no SSID kind keeps every row, as every walk did then.
        return { ...table, kind: SnmpTableKind.Generic };
      },
    ),
    results: [
      {
        key: "wifi_radios",
        rows: [
          { index: "1", values: { [`${UNIFI_RADIO_ENTRY}.3`]: "ng" } },
          { index: "2", values: { [`${UNIFI_RADIO_ENTRY}.3`]: "na" } },
        ],
      },
      {
        key: "wifi_ssids",
        rows: vaps.map((vap: StoredVap) => {
          return {
            index: vap.index,
            values: {
              [`${UNIFI_VAP_ENTRY}.6`]: vap.essid,
              [`${UNIFI_VAP_ENTRY}.9`]: vap.radio,
              [`${UNIFI_VAP_ENTRY}.4`]: vap.radio === "ng" ? 11 : 44,
              [`${UNIFI_VAP_ENTRY}.8`]: vap.stations,
              [`${UNIFI_VAP_ENTRY}.21`]: vap.radio === "ng" ? 17 : 23,
              [`${UNIFI_VAP_ENTRY}.23`]: vap.usage,
            },
          };
        }),
      },
    ],
    collectedAt: new Date("2026-10-12T08:00:00.000Z"),
  }).map((snapshot: SnmpTableSnapshot): SnmpTableSnapshot => {
    return {
      ...snapshot,
      kind:
        snapshot.key === "wifi_ssids"
          ? SnmpTableKind.WifiSsid
          : SnmpTableKind.WifiRadio,
    };
  });
}

const STORED_VAPS: Array<StoredVap> = [
  {
    index: "1",
    essid: "element-0f8a6c2d4e1b3957",
    radio: "ng",
    stations: 0,
    usage: "user",
  },
  { index: "2", essid: "Warehouse", radio: "ng", stations: 5, usage: "user" },
  {
    index: "3",
    essid: "element-0f8a6c2d4e1b3957",
    radio: "na",
    stations: 0,
    usage: "user",
  },
  {
    index: "4",
    essid: "vwire-c4e2a9170b5d38f6",
    radio: "na",
    stations: 1,
    usage: "downlink",
  },
  { index: "5", essid: "Warehouse", radio: "na", stations: 8, usage: "user" },
];

describe("WifiRadioUtil and the networks an access point runs for itself", () => {
  it("lists a stored snapshot's SSIDs without UniFi's own networks", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      unifiStoredBeforeTheFix(STORED_VAPS),
    );

    expect(
      summary.ssids.map((ssid: WifiSsidView): string => {
        return `${ssid.ssid}|${ssid.band}|${ssid.clients}`;
      }),
    ).toEqual(["Warehouse|2.4 GHz|5", "Warehouse|5 GHz|8"]);
  });

  it("counts no meshed access point as a client, on its radio or in the total", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      unifiStoredBeforeTheFix(STORED_VAPS),
    );

    expect(
      summary.radios.map((radio: WifiRadioView): Array<unknown> => {
        return [radio.band, radio.channel, radio.txPowerDbm, radio.clients];
      }),
    ).toEqual([
      [WifiBand.Band2_4GHz, 11, 17, 5],
      [WifiBand.Band5GHz, 44, 23, 8],
    ]);
    expect(summary.totalClients).toBe(13);
  });

  it("has nothing to list for a device whose only VAPs are UniFi's own", () => {
    const tables: Array<SnmpTableSnapshot> = unifiStoredBeforeTheFix(
      STORED_VAPS.filter((vap: StoredVap): boolean => {
        return vap.essid !== "Warehouse";
      }),
    ).map((snapshot: SnmpTableSnapshot): SnmpTableSnapshot => {
      return snapshot.key === "wifi_radios"
        ? { ...snapshot, rows: [] }
        : snapshot;
    });

    const summary: WifiSummary = WifiRadioUtil.getSummary(tables);

    expect(summary.ssids).toEqual([]);
    expect(WifiRadioUtil.getTablesState(summary)).toBe(WifiTablesState.NoRows);
  });

  it("lists exactly the stored rows a walk would store now", () => {
    const snapshots: Array<SnmpTableSnapshot> =
      unifiStoredBeforeTheFix(STORED_VAPS);
    const ssids: SnmpTableSnapshot = snapshots.find(
      (snapshot: SnmpTableSnapshot): boolean => {
        return snapshot.key === "wifi_ssids";
      },
    )!;

    // UniFi's own networks are rows 1, 3 and 4 of the five stored.
    expect(
      SnmpTableListUtil.listedRows(ssids).map(
        (row: SnmpTableSnapshotRow): string => {
          return row.index;
        },
      ),
    ).toEqual(["2", "5"]);

    expect(
      WifiRadioUtil.getSummary(snapshots).ssids.map(
        (ssid: WifiSsidView): string => {
          return ssid.name;
        },
      ),
    ).toEqual(["Warehouse / 2.4 GHz", "Warehouse / 5 GHz"]);
  });
});
