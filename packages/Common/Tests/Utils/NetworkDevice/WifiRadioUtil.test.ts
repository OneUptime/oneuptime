import WifiRadioUtil, {
  WifiBand,
  WifiRadioView,
  WifiSummary,
} from "../../../Utils/NetworkDevice/WifiRadioUtil";
import {
  SnmpTableKind,
  SnmpTableSnapshot,
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
      { name: "Corp / 5GHz", ssid: "Corp", bandText: "5GHz", clients: 7 },
      { name: "Guest / 2.4GHz", ssid: "Guest", bandText: "2.4GHz", clients: 2 },
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
    // Could be 6 GHz: never guessed.
    expect(WifiRadioUtil.inferBandFromChannel(181)).toBeUndefined();
    expect(WifiRadioUtil.inferBandFromChannel(20)).toBeUndefined();
    expect(WifiRadioUtil.inferBandFromChannel(undefined)).toBeUndefined();
  });
});
