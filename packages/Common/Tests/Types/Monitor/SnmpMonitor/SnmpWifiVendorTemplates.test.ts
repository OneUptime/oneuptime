import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  SnmpTableColumn,
  SnmpTableColumnRole,
  SnmpTableDefinition,
  SnmpTableKind,
  SnmpTableResult,
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpOid from "../../../../Types/Monitor/SnmpMonitor/SnmpOid";
import WifiRadioUtil, {
  WifiAccessPointView,
  WifiBand,
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
} from "../../../../Utils/NetworkDevice/WifiRadioUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * The Wi-Fi vendors a managed-service customer asked for - Ubiquiti UniFi,
 * HPE Aruba (Instant and Mobility Controllers), Extreme Networks (IQ Engine
 * access points and its wireless controllers) and TP-Link Omada - read
 * through their templates exactly as a poll reads them: the probe's raw
 * rows (one per walked index, keyed by column OID, values as net-snmp hands
 * them over) are joined to the template's tables by
 * SnmpTableListUtil.materialize, and the Wi-Fi view is built from the
 * snapshots by WifiRadioUtil.
 *
 * The fixtures keep the shapes real walks have: Aruba's rows are indexed by
 * the access point's MAC address and the radio number, HiveOS's and
 * Extreme's controller's by ifIndex, UniFi's radio and SSID tables by their
 * own counters, ArubaOS's SSID table by the SSID itself. Values are typed as
 * the agents type them: Aruba's channel is text ("116E"), Aerohive's noise
 * floor carries 256, ArubaOS doubles its transmit power, Extreme's
 * controller reports the channel as a frequency.
 */

function template(id: string): SnmpVendorTemplate {
  const found: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.getById(id);

  if (!found) {
    throw new Error(`No vendor template "${id}".`);
  }

  return found;
}

function tableOf(id: string, key: string): SnmpTableDefinition {
  const table: SnmpTableDefinition | undefined = (
    template(id).tables || []
  ).find((candidate: SnmpTableDefinition) => {
    return candidate.key === key;
  });

  if (!table) {
    throw new Error(`Template "${id}" has no table "${key}".`);
  }

  return table;
}

/*
 * What a poll stores for a template: its tables, validated the way a saved
 * device's are (resolveEffectiveTables), joined to the walk.
 */
function walk(
  id: string,
  results: Array<SnmpTableResult>,
): Array<SnmpTableSnapshot> {
  return SnmpTableListUtil.materialize({
    tables: SnmpTableListUtil.resolveEffectiveTables({
      templateTables: template(id).tables,
      deviceTables: [],
    }).tables,
    results: results,
    collectedAt: new Date("2026-10-09T08:00:00.000Z"),
  });
}

function snapshotOf(
  snapshots: Array<SnmpTableSnapshot>,
  key: string,
): SnmpTableSnapshot {
  const snapshot: SnmpTableSnapshot | undefined = snapshots.find(
    (candidate: SnmpTableSnapshot) => {
      return candidate.key === key;
    },
  );

  if (!snapshot) {
    throw new Error(`No snapshot "${key}".`);
  }

  return snapshot;
}

function labels(snapshot: SnmpTableSnapshot): Array<string> {
  return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
    return row.label;
  });
}

function radioNamed(summary: WifiSummary, name: string): WifiRadioView {
  const radio: WifiRadioView | undefined = summary.radios.find(
    (candidate: WifiRadioView) => {
      return candidate.name === name;
    },
  );

  if (!radio) {
    throw new Error(
      `No radio "${name}" among ${summary.radios
        .map((candidate: WifiRadioView) => {
          return candidate.name;
        })
        .join(", ")}.`,
    );
  }

  return radio;
}

// --- Ubiquiti UniFi (UBNT-UniFi-MIB) ---

const UNIFI_RADIO: string = "1.3.6.1.4.1.41112.1.6.1.1.1";
const UNIFI_VAP: string = "1.3.6.1.4.1.41112.1.6.1.2.1";
const HR_PROCESSOR_LOAD: string = "1.3.6.1.2.1.25.3.3.1.2";

/*
 * A UAP-nanoHD: a 2.4 GHz and a 5 GHz radio, each broadcasting the office
 * SSID and the hidden mesh SSID UniFi adds ("vwire-..."), CPU numbered from
 * 196608 as Host Resources numbers it on UniFi firmware.
 */
function unifiResults(): Array<SnmpTableResult> {
  return [
    {
      key: "wifi_radios",
      rows: [
        {
          index: "1",
          values: {
            [`${UNIFI_RADIO}.3`]: "ng",
            [`${UNIFI_RADIO}.2`]: "wifi0",
            [`${UNIFI_RADIO}.6`]: 13,
            [`${UNIFI_RADIO}.7`]: 11,
            [`${UNIFI_RADIO}.8`]: 2,
          },
        },
        {
          index: "2",
          values: {
            [`${UNIFI_RADIO}.3`]: "na",
            [`${UNIFI_RADIO}.2`]: "wifi1",
            [`${UNIFI_RADIO}.6`]: 4,
            [`${UNIFI_RADIO}.7`]: 3,
            [`${UNIFI_RADIO}.8`]: 1,
          },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        {
          index: "1",
          values: {
            [`${UNIFI_VAP}.6`]: "homewifi_ac",
            [`${UNIFI_VAP}.9`]: "ng",
            [`${UNIFI_VAP}.4`]: 6,
            [`${UNIFI_VAP}.8`]: 4,
            [`${UNIFI_VAP}.21`]: 23,
            [`${UNIFI_VAP}.3`]: 789,
            [`${UNIFI_VAP}.22`]: 1,
            [`${UNIFI_VAP}.23`]: "user",
          },
        },
        {
          index: "2",
          values: {
            [`${UNIFI_VAP}.6`]: "vwire-d4aebb3212a82cd8",
            [`${UNIFI_VAP}.9`]: "ng",
            [`${UNIFI_VAP}.4`]: 6,
            [`${UNIFI_VAP}.8`]: 0,
            [`${UNIFI_VAP}.21`]: 23,
            [`${UNIFI_VAP}.22`]: 1,
          },
        },
        {
          index: "3",
          values: {
            [`${UNIFI_VAP}.6`]: "homewifi_ac",
            [`${UNIFI_VAP}.9`]: "na",
            [`${UNIFI_VAP}.4`]: 157,
            [`${UNIFI_VAP}.8`]: 14,
            [`${UNIFI_VAP}.21`]: 26,
            [`${UNIFI_VAP}.3`]: 991,
            [`${UNIFI_VAP}.22`]: 1,
            [`${UNIFI_VAP}.23`]: "user",
          },
        },
        {
          index: "4",
          values: {
            [`${UNIFI_VAP}.6`]: "vwire-d4aebb3212a82cd8",
            [`${UNIFI_VAP}.9`]: "na",
            [`${UNIFI_VAP}.4`]: 157,
            [`${UNIFI_VAP}.8`]: 0,
            [`${UNIFI_VAP}.21`]: 26,
            [`${UNIFI_VAP}.22`]: 2,
          },
        },
      ],
    },
    {
      key: "cpu_cores",
      rows: [
        { index: "196608", values: { [HR_PROCESSOR_LOAD]: 3 } },
        { index: "196609", values: { [HR_PROCESSOR_LOAD]: 2 } },
      ],
    },
  ];
}

describe("Ubiquiti UniFi access points", () => {
  it("names radios by their band, read from UniFi's 802.11 mode codes, and their interface", () => {
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("ubiquiti-unifi-ap", unifiResults()),
      "wifi_radios",
    );

    expect(radios.kind).toBe(SnmpTableKind.WifiRadio);
    expect(labels(radios)).toEqual(["2.4 GHz / wifi0", "5 GHz / wifi1"]);
    expect(radios.rows[0]!.cells[`${UNIFI_RADIO}.3`]).toEqual({
      raw: "ng",
      display: "2.4 GHz",
    });
  });

  it("fills each radio's channel, power and clients in from the SSIDs it broadcasts", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("ubiquiti-unifi-ap", unifiResults()),
    );

    expect(radioNamed(summary, "2.4 GHz / wifi0")).toEqual({
      name: "2.4 GHz / wifi0",
      index: "1",
      band: WifiBand.Band2_4GHz,
      bandText: "2.4 GHz",
      channel: 6,
      frequencyMHz: 2437,
      txPowerDbm: 23,
      clients: 4,
      utilizationPercent: 13,
    });

    expect(radioNamed(summary, "5 GHz / wifi1")).toEqual({
      name: "5 GHz / wifi1",
      index: "2",
      band: WifiBand.Band5GHz,
      bandText: "5 GHz",
      channel: 157,
      frequencyMHz: 5785,
      txPowerDbm: 26,
      clients: 14,
      utilizationPercent: 4,
    });

    expect(summary.totalClients).toBe(18);
  });

  it("lists every SSID on every band, the mesh SSID included", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("ubiquiti-unifi-ap", unifiResults()),
    );

    expect(
      summary.ssids.map((ssid: WifiSsidView) => {
        return `${ssid.ssid}|${ssid.band}|${ssid.clients}`;
      }),
    ).toEqual([
      "homewifi_ac|2.4 GHz|4",
      "vwire-d4aebb3212a82cd8|2.4 GHz|0",
      "homewifi_ac|5 GHz|14",
      "vwire-d4aebb3212a82cd8|5 GHz|0",
    ]);
    expect(summary.ssids[0]!.name).toBe("homewifi_ac / 2.4 GHz");
  });

  it("reads connection quality in percent, though UniFi reports tenths of one", () => {
    const ssids: SnmpTableSnapshot = snapshotOf(
      walk("ubiquiti-unifi-ap", unifiResults()),
      "wifi_ssids",
    );

    expect(ssids.rows[0]!.cells[`${UNIFI_VAP}.3`]).toEqual({
      raw: 789,
      display: "78.9",
      numeric: 78.9,
    });
    expect(ssids.rows[2]!.cells[`${UNIFI_VAP}.3`]!.numeric).toBe(99.1);
    // A VAP that reports no quality has none - not 0.
    expect(ssids.rows[1]!.cells[`${UNIFI_VAP}.3`]!.numeric).toBeUndefined();
  });

  it("labels a VAP's up/down state without alerting on it - a scheduled SSID is down on purpose", () => {
    const ssids: SnmpTableDefinition = tableOf(
      "ubiquiti-unifi-ap",
      "wifi_ssids",
    );
    const up: SnmpTableColumn | undefined = ssids.columns.find(
      (column: SnmpTableColumn) => {
        return column.oid === `${UNIFI_VAP}.22`;
      },
    );

    expect(up?.valueLabels).toEqual({ "1": "up", "2": "down" });
    expect(up?.healthyValues).toBeUndefined();

    const snapshot: SnmpTableSnapshot = snapshotOf(
      walk("ubiquiti-unifi-ap", unifiResults()),
      "wifi_ssids",
    );
    expect(snapshot.rows[3]!.cells[`${UNIFI_VAP}.22`]!.display).toBe("down");
  });

  it("reads CPU per core whatever Host Resources numbers the cores", () => {
    const cpu: SnmpTableSnapshot = snapshotOf(
      walk("ubiquiti-unifi-ap", unifiResults()),
      "cpu_cores",
    );

    expect(
      cpu.rows.map((row: SnmpTableSnapshotRow) => {
        return row.cells[HR_PROCESSOR_LOAD]!.numeric;
      }),
    ).toEqual([3, 2]);
  });

  it("names a 6 GHz radio by UniFi's 6e code", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("ubiquiti-unifi-ap", [
        {
          key: "wifi_radios",
          rows: [{ index: "3", values: { [`${UNIFI_RADIO}.3`]: "6e" } }],
        },
        {
          key: "wifi_ssids",
          rows: [
            {
              index: "9",
              values: {
                [`${UNIFI_VAP}.6`]: "Corp",
                [`${UNIFI_VAP}.9`]: "6e",
                [`${UNIFI_VAP}.4`]: 37,
                [`${UNIFI_VAP}.8`]: 2,
              },
            },
          ],
        },
      ]),
    );

    expect(summary.radios[0]).toMatchObject({
      name: "6 GHz",
      band: WifiBand.Band6GHz,
      channel: 37,
      frequencyMHz: 6135,
      clients: 2,
    });
  });
});

// --- HPE Aruba Instant (AI-AP-MIB) ---

const AI_AP: string = "1.3.6.1.4.1.14823.2.3.3.1.2.1.1";
const AI_RADIO: string = "1.3.6.1.4.1.14823.2.3.3.1.2.2.1";
const AI_SSID: string = "1.3.6.1.4.1.14823.2.3.3.1.1.7.1";

// Access points' MAC addresses, as the six arcs of an index.
const AP06: string = "104.40.207.199.233.192";
const AP14: string = "104.40.207.200.4.72";
const AP_CONDUCTOR: string = "112.58.14.201.194.70";

/*
 * A three-access-point Instant cluster walked through its virtual
 * controller: two tri-radio AP-635s (5, 2.4 and 6 GHz) and an AP-225, one
 * of the 635s down. The radio table walks aiAPName as its parent name
 * column, so the probe hands over the access points' rows (six arcs) next
 * to the radios' (seven).
 */
function arubaInstantResults(): Array<SnmpTableResult> {
  const apName: string = `${AI_AP}.2`;

  return [
    {
      key: "wifi_access_points",
      rows: [
        {
          index: AP06,
          values: {
            [apName]: "ECA-Ultimo-L11-AP06",
            [`${AI_AP}.11`]: 1,
            [`${AI_AP}.6`]: "635",
            [`${AI_AP}.3`]: "192.168.126.30",
            [`${AI_AP}.4`]: "PHRCKYJ2RR",
            [`${AI_AP}.7`]: 6,
            [`${AI_AP}.8`]: 564543488,
            [`${AI_AP}.10`]: 1787162624,
          },
        },
        {
          index: AP14,
          values: {
            [apName]: "ECA-Ultimo-L11-AP14",
            [`${AI_AP}.11`]: 2,
            [`${AI_AP}.6`]: "635",
            [`${AI_AP}.7`]: 5,
          },
        },
        {
          index: AP_CONDUCTOR,
          values: {
            [apName]: "instant-ap-src-1",
            [`${AI_AP}.11`]: 1,
            [`${AI_AP}.6`]: "225",
            [`${AI_AP}.7`]: 9,
          },
        },
      ],
    },
    {
      key: "wifi_radios",
      rows: [
        { index: AP06, values: { [apName]: "ECA-Ultimo-L11-AP06" } },
        { index: AP14, values: { [apName]: "ECA-Ultimo-L11-AP14" } },
        { index: AP_CONDUCTOR, values: { [apName]: "instant-ap-src-1" } },
        {
          index: `${AP06}.0`,
          values: {
            [`${AI_RADIO}.2`]: 0,
            [`${AI_RADIO}.4`]: "161",
            [`${AI_RADIO}.5`]: 16,
            [`${AI_RADIO}.6`]: 94,
            [`${AI_RADIO}.8`]: 1,
            [`${AI_RADIO}.21`]: 7,
            [`${AI_RADIO}.20`]: 1,
            [`${AI_RADIO}.22`]: "access",
          },
        },
        {
          index: `${AP06}.1`,
          values: {
            [`${AI_RADIO}.2`]: 1,
            [`${AI_RADIO}.4`]: "1",
            [`${AI_RADIO}.5`]: 26,
            [`${AI_RADIO}.6`]: 95,
            [`${AI_RADIO}.8`]: 0,
            [`${AI_RADIO}.21`]: 3,
            [`${AI_RADIO}.20`]: 1,
          },
        },
        {
          index: `${AP06}.2`,
          values: {
            [`${AI_RADIO}.2`]: 2,
            [`${AI_RADIO}.4`]: "53S",
            [`${AI_RADIO}.5`]: 15,
            [`${AI_RADIO}.6`]: 90,
            [`${AI_RADIO}.8`]: 0,
            [`${AI_RADIO}.21`]: 1,
            [`${AI_RADIO}.20`]: 1,
          },
        },
        {
          index: `${AP14}.0`,
          values: {
            [`${AI_RADIO}.2`]: 0,
            [`${AI_RADIO}.4`]: "60",
            [`${AI_RADIO}.5`]: 16,
            [`${AI_RADIO}.6`]: 96,
            [`${AI_RADIO}.21`]: 0,
            [`${AI_RADIO}.20`]: 2,
          },
        },
        {
          index: `${AP_CONDUCTOR}.0`,
          values: {
            [`${AI_RADIO}.2`]: 0,
            [`${AI_RADIO}.4`]: "116E",
            [`${AI_RADIO}.5`]: 21,
            [`${AI_RADIO}.6`]: 92,
            [`${AI_RADIO}.8`]: 1,
            [`${AI_RADIO}.21`]: 12,
            [`${AI_RADIO}.20`]: 1,
          },
        },
        {
          index: `${AP_CONDUCTOR}.1`,
          values: {
            [`${AI_RADIO}.2`]: 1,
            [`${AI_RADIO}.4`]: "6",
            [`${AI_RADIO}.5`]: 18,
            [`${AI_RADIO}.6`]: 96,
            [`${AI_RADIO}.8`]: 11,
            [`${AI_RADIO}.21`]: 5,
            [`${AI_RADIO}.20`]: 1,
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
            [`${AI_SSID}.2`]: "EOU-Regional",
            [`${AI_SSID}.4`]: 9,
            [`${AI_SSID}.3`]: 0,
            [`${AI_SSID}.5`]: 0,
          },
        },
        {
          index: "1",
          values: {
            [`${AI_SSID}.2`]: "ECA-Corp",
            [`${AI_SSID}.4`]: 19,
            [`${AI_SSID}.3`]: 0,
            [`${AI_SSID}.5`]: 1,
          },
        },
      ],
    },
  ];
}

describe("HPE Aruba Instant", () => {
  it("names every radio by its access point, from the parent access point rows", () => {
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("aruba-instant", arubaInstantResults()),
      "wifi_radios",
    );

    expect(labels(radios)).toEqual([
      "ECA-Ultimo-L11-AP06 / Radio 0",
      "ECA-Ultimo-L11-AP06 / Radio 1",
      "ECA-Ultimo-L11-AP06 / Radio 2",
      "ECA-Ultimo-L11-AP14 / Radio 0",
      "instant-ap-src-1 / Radio 0",
      "instant-ap-src-1 / Radio 1",
    ]);
  });

  it("reads the noise floor as the negative dBm Aruba leaves the sign off", () => {
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("aruba-instant", arubaInstantResults()),
      "wifi_radios",
    );

    expect(radios.rows[0]!.cells[`${AI_RADIO}.6`]).toEqual({
      raw: 94,
      display: "-94",
      numeric: -94,
    });
  });

  it("places every radio on its band from the channel Aruba writes with its width", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-instant", arubaInstantResults()),
    );

    expect(radioNamed(summary, "ECA-Ultimo-L11-AP06 / Radio 0")).toMatchObject(
      {
        band: WifiBand.Band5GHz,
        channel: 161,
        frequencyMHz: 5805,
        txPowerDbm: 16,
        noiseFloorDbm: -94,
        utilizationPercent: 1,
        clients: 7,
        isOn: true,
        statusText: "up",
      },
    );
    expect(radioNamed(summary, "ECA-Ultimo-L11-AP06 / Radio 1")).toMatchObject(
      { band: WifiBand.Band2_4GHz, channel: 1, frequencyMHz: 2412 },
    );
    // "53S": channel 53 at 160 MHz - a number only 6 GHz uses.
    expect(radioNamed(summary, "ECA-Ultimo-L11-AP06 / Radio 2")).toMatchObject(
      { band: WifiBand.Band6GHz, channel: 53, frequencyMHz: 6215 },
    );
    // "116E": channel 116 at 80 MHz.
    expect(radioNamed(summary, "instant-ap-src-1 / Radio 0")).toMatchObject({
      band: WifiBand.Band5GHz,
      channel: 116,
      frequencyMHz: 5580,
    });
    expect(radioNamed(summary, "ECA-Ultimo-L11-AP14 / Radio 0")).toMatchObject(
      { isOn: false, statusText: "down" },
    );
  });

  it("lists the cluster's access points, the down one marked, each with its radios' clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-instant", arubaInstantResults()),
    );

    expect(summary.accessPoints).toEqual([
      {
        name: "ECA-Ultimo-L11-AP06",
        index: AP06,
        isUp: true,
        statusText: "up",
        radioCount: 3,
        clients: 11,
      },
      {
        name: "ECA-Ultimo-L11-AP14",
        index: AP14,
        isUp: false,
        statusText: "down",
        radioCount: 1,
        clients: 0,
      },
      {
        name: "instant-ap-src-1",
        index: AP_CONDUCTOR,
        isUp: true,
        statusText: "up",
        radioCount: 2,
        clients: 17,
      },
    ]);

    // The radio table counts clients, so the total is the radios'.
    expect(summary.totalClients).toBe(28);
  });

  it("keeps each access point's own columns: model, address, CPU and memory", () => {
    const accessPoints: SnmpTableSnapshot = snapshotOf(
      walk("aruba-instant", arubaInstantResults()),
      "wifi_access_points",
    );

    expect(accessPoints.kind).toBe(SnmpTableKind.WifiAccessPoint);
    expect(labels(accessPoints)).toEqual([
      "ECA-Ultimo-L11-AP06",
      "ECA-Ultimo-L11-AP14",
      "instant-ap-src-1",
    ]);

    const ap06: SnmpTableSnapshotRow = accessPoints.rows[0]!;
    expect(ap06.cells[`${AI_AP}.6`]!.display).toBe("635");
    // A model number is a name, not a quantity: it is not charted.
    expect(ap06.cells[`${AI_AP}.6`]!.numeric).toBeUndefined();
    expect(ap06.cells[`${AI_AP}.3`]!.display).toBe("192.168.126.30");
    expect(ap06.cells[`${AI_AP}.7`]!.numeric).toBe(6);
    expect(ap06.cells[`${AI_AP}.10`]!.numeric).toBe(1787162624);
    expect(accessPoints.rows[1]!.cells[`${AI_AP}.11`]!.isHealthy).toBe(false);
  });

  it("lists the cluster's SSIDs with their clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-instant", arubaInstantResults()),
    );

    expect(summary.ssids).toEqual([
      { name: "EOU-Regional", ssid: "EOU-Regional", clients: 9 },
      { name: "ECA-Corp", ssid: "ECA-Corp", clients: 19 },
    ]);

    const ssids: SnmpTableSnapshot = snapshotOf(
      walk("aruba-instant", arubaInstantResults()),
      "wifi_ssids",
    );
    expect(ssids.rows[1]!.cells[`${AI_SSID}.5`]!.display).toBe("yes");
    expect(ssids.rows[1]!.cells[`${AI_SSID}.3`]!.display).toBe("enabled");
  });
});

// --- HPE Aruba Mobility Controller (WLSX MIBs) ---

const WLSX_AP: string = "1.3.6.1.4.1.14823.2.2.1.5.2.1.4.1";
const WLSX_RADIO: string = "1.3.6.1.4.1.14823.2.2.1.5.2.1.5.1";
const WLSX_ESSID: string = "1.3.6.1.4.1.14823.2.2.1.5.2.1.8.1";
const SYSX_CPU: string = "1.3.6.1.4.1.14823.2.2.1.1.1.9.1";
const SYSX_MEMORY: string = "1.3.6.1.4.1.14823.2.2.1.1.1.11.1";

const CAMPUS_AP: string = "0.78.53.194.34.232";

// An SSID index: its length, then one arc per byte.
function textIndex(text: string): string {
  const bytes: Array<number> = Array.from(Buffer.from(text, "utf8"));
  return [bytes.length, ...bytes].join(".");
}

function arubaControllerResults(): Array<SnmpTableResult> {
  return [
    {
      key: "wifi_access_points",
      rows: [
        {
          index: CAMPUS_AP,
          values: {
            [`${WLSX_AP}.3`]: "ar6-bib4le2n",
            [`${WLSX_AP}.19`]: 1,
            [`${WLSX_AP}.13`]: "515",
            [`${WLSX_AP}.2`]: "10.20.30.40",
            [`${WLSX_AP}.4`]: "campus",
          },
        },
      ],
    },
    {
      key: "wifi_radios",
      rows: [
        {
          index: `${CAMPUS_AP}.1`,
          values: {
            [`${WLSX_RADIO}.16`]: "ar6-bib4le2n",
            [`${WLSX_RADIO}.2`]: 1,
            [`${WLSX_RADIO}.3`]: 44,
            [`${WLSX_RADIO}.4`]: 38,
            [`${WLSX_RADIO}.6`]: 4,
            [`${WLSX_RADIO}.7`]: 18,
            [`${WLSX_RADIO}.5`]: 2,
          },
        },
        {
          index: `${CAMPUS_AP}.2`,
          values: {
            [`${WLSX_RADIO}.16`]: "ar6-bib4le2n",
            [`${WLSX_RADIO}.2`]: 3,
            [`${WLSX_RADIO}.3`]: 1,
            [`${WLSX_RADIO}.4`]: 28,
            [`${WLSX_RADIO}.6`]: 5,
            [`${WLSX_RADIO}.7`]: 3,
            [`${WLSX_RADIO}.5`]: 2,
          },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        {
          index: textIndex("Corp"),
          values: {
            [`${WLSX_ESSID}.2`]: 120,
            [`${WLSX_ESSID}.3`]: 12,
            [`${WLSX_ESSID}.4`]: 0,
          },
        },
        {
          index: textIndex("Café Guest"),
          values: {
            [`${WLSX_ESSID}.2`]: 7,
            [`${WLSX_ESSID}.3`]: 11,
            [`${WLSX_ESSID}.4`]: 1,
          },
        },
      ],
    },
    {
      key: "cpu_processors",
      rows: [
        {
          index: "1",
          values: { [`${SYSX_CPU}.2`]: "MIPS 1", [`${SYSX_CPU}.3`]: 7 },
        },
      ],
    },
    {
      key: "memory",
      rows: [
        {
          index: "1",
          values: {
            [`${SYSX_MEMORY}.2`]: 5184256,
            [`${SYSX_MEMORY}.3`]: 4326272,
            [`${SYSX_MEMORY}.4`]: 857984,
          },
        },
      ],
    },
  ];
}

describe("HPE Aruba Mobility Controller", () => {
  it("names radios by their access point and band", () => {
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("aruba-mobility-controller", arubaControllerResults()),
      "wifi_radios",
    );

    expect(labels(radios)).toEqual([
      "ar6-bib4le2n / 5 GHz",
      "ar6-bib4le2n / 2.4 GHz",
    ]);
  });

  it("halves the transmit power ArubaOS reports doubled", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-mobility-controller", arubaControllerResults()),
    );

    expect(radioNamed(summary, "ar6-bib4le2n / 5 GHz")).toMatchObject({
      band: WifiBand.Band5GHz,
      bandText: "5 GHz",
      channel: 44,
      frequencyMHz: 5220,
      txPowerDbm: 19,
      utilizationPercent: 4,
      clients: 18,
    });
    expect(radioNamed(summary, "ar6-bib4le2n / 2.4 GHz")).toMatchObject({
      band: WifiBand.Band2_4GHz,
      channel: 1,
      txPowerDbm: 14,
      clients: 3,
    });
    expect(summary.totalClients).toBe(21);
  });

  it("names its SSIDs from the index ArubaOS keys them by, UTF-8 included", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-mobility-controller", arubaControllerResults()),
    );

    expect(summary.ssids).toEqual([
      { name: "Corp", ssid: "Corp", clients: 120 },
      { name: "Café Guest", ssid: "Café Guest", clients: 7 },
    ]);
  });

  it("lists its access points with their radios' clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("aruba-mobility-controller", arubaControllerResults()),
    );

    expect(summary.accessPoints).toEqual([
      {
        name: "ar6-bib4le2n",
        index: CAMPUS_AP,
        isUp: true,
        statusText: "up",
        radioCount: 2,
        clients: 21,
      },
    ]);
  });

  it("reads the controller's processors and memory", () => {
    const snapshots: Array<SnmpTableSnapshot> = walk(
      "aruba-mobility-controller",
      arubaControllerResults(),
    );

    expect(labels(snapshotOf(snapshots, "cpu_processors"))).toEqual([
      "MIPS 1",
    ]);
    expect(
      snapshotOf(snapshots, "memory").rows[0]!.cells[`${SYSX_MEMORY}.4`]!
        .numeric,
    ).toBe(857984);
  });
});

// --- Extreme Networks IQ Engine / HiveOS (AH MIBs) ---

const AH_IF: string = "1.3.6.1.4.1.26928.1.1.1.2.1.1.1";
const AH_RADIO: string = "1.3.6.1.4.1.26928.1.1.1.2.1.5.1";

/*
 * An AP250: its radios wifi0 and wifi1 at ifIndex 7 and 8 (ahIfName lives
 * in ahXIfTable, which augments ifTable, so it shares the index), and every
 * interface in the SSID table, "N/A" for the ones that broadcast nothing.
 */
function hiveosResults(): Array<SnmpTableResult> {
  const interfaces: Array<[string, string, string]> = [
    ["3", "eth0", "N/A"],
    ["7", "wifi0", "N/A"],
    ["8", "wifi1", "N/A"],
    ["11", "mgt0", "N/A"],
    ["14", "wifi0.1", "AH-Guest"],
    ["16", "wifi1.1", "AH-Air"],
    ["17", "wifi1.2", "AH-employee"],
  ];

  return [
    {
      key: "wifi_radios",
      rows: [
        {
          index: "7",
          values: {
            [`${AH_IF}.1`]: "wifi0",
            [`${AH_RADIO}.1`]: 6,
            [`${AH_RADIO}.2`]: 5,
            [`${AH_RADIO}.3`]: 161,
          },
        },
        {
          index: "8",
          values: {
            [`${AH_IF}.1`]: "wifi1",
            [`${AH_RADIO}.1`]: 165,
            [`${AH_RADIO}.2`]: 19,
            [`${AH_RADIO}.3`]: 165,
          },
        },
        // The interface names of everything else ride along with the label column.
        ...interfaces
          .filter(([index]: [string, string, string]) => {
            return index !== "7" && index !== "8";
          })
          .map(([index, name]: [string, string, string]) => {
            return { index: index, values: { [`${AH_IF}.1`]: name } };
          }),
      ],
    },
    {
      key: "wifi_ssids",
      rows: interfaces.map(([index, name, ssid]: [string, string, string]) => {
        return {
          index: index,
          values: { [`${AH_IF}.1`]: name, [`${AH_IF}.2`]: ssid },
        };
      }),
    },
  ];
}

describe("Extreme Networks IQ Engine (HiveOS) access points", () => {
  it("names radios by their interface and reads the noise floor without Aerohive's 256", () => {
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("extreme-iq-engine-ap", hiveosResults()),
      "wifi_radios",
    );

    const wifi0: SnmpTableSnapshotRow = radios.rows.find(
      (row: SnmpTableSnapshotRow) => {
        return row.label === "wifi0";
      },
    )!;

    expect(wifi0.cells[`${AH_RADIO}.3`]).toEqual({
      raw: 161,
      display: "-95",
      numeric: -95,
    });
  });

  it("places radios on the band their channel belongs to", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("extreme-iq-engine-ap", hiveosResults()),
    );

    expect(radioNamed(summary, "wifi0")).toMatchObject({
      band: WifiBand.Band2_4GHz,
      channel: 6,
      frequencyMHz: 2437,
      txPowerDbm: 5,
      noiseFloorDbm: -95,
    });
    expect(radioNamed(summary, "wifi1")).toMatchObject({
      band: WifiBand.Band5GHz,
      channel: 165,
      frequencyMHz: 5825,
      txPowerDbm: 19,
      noiseFloorDbm: -91,
    });
  });

  it("lists only the interfaces that broadcast an SSID", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("extreme-iq-engine-ap", hiveosResults()),
    );

    expect(
      summary.ssids.map((ssid: WifiSsidView) => {
        return ssid.name;
      }),
    ).toEqual([
      "AH-Guest / wifi0.1",
      "AH-Air / wifi1.1",
      "AH-employee / wifi1.2",
    ]);

    // The SNMP Tables tab still shows every interface, as walked.
    expect(
      snapshotOf(walk("extreme-iq-engine-ap", hiveosResults()), "wifi_ssids")
        .rows,
    ).toHaveLength(7);
  });

  it("keeps the other interfaces ahIfName names out of the radio table", () => {
    expect(
      labels(
        snapshotOf(walk("extreme-iq-engine-ap", hiveosResults()), "wifi_radios"),
      ),
    ).toEqual(["wifi0", "wifi1"]);
  });
});

// --- Extreme Networks wireless controller (HIPATH-WIRELESS MIBs) ---

const HWC_AP: string = "1.3.6.1.4.1.4329.15.3.5.1.2.1";
const HWC_AP_STATS: string = "1.3.6.1.4.1.4329.15.3.5.2.2.1";
const HWC_RADIO_STATUS: string = "1.3.6.1.4.1.4329.15.3.5.2.4.1";
const HWC_RADIO_STATS: string = "1.3.6.1.4.1.4329.15.3.1.4.3.1";
const HWC_WLAN: string = "1.3.6.1.4.1.4329.15.3.3.4.4.1";
const HWC_WLAN_STATS: string = "1.3.6.1.4.1.4329.15.3.3.4.5.1";
const IF_NAME: string = "1.3.6.1.2.1.31.1.1.1.1";

/*
 * An ExtremeCloud IQ Controller with one access point: its radios are
 * interfaces of the controller (ifIndex 1001, 1002), named by IF-MIB's
 * ifName - which, walked as the label column, also names the controller's
 * own ports.
 */
function extremeControllerResults(): Array<SnmpTableResult> {
  return [
    {
      key: "wifi_access_points",
      rows: [
        {
          index: "1",
          values: {
            [`${HWC_AP}.2`]: "TestAP",
            [`${HWC_AP}.22`]: 1,
            [`${HWC_AP_STATS}.14`]: 10,
            [`${HWC_AP}.14`]: "10.0.0.21",
            [`${HWC_AP}.4`]: "1234567890ABCDEF",
            [`${HWC_AP}.7`]: "10.51.12.0006",
          },
        },
        {
          index: "2",
          values: {
            [`${HWC_AP}.2`]: "Warehouse-AP",
            [`${HWC_AP}.22`]: 2,
            [`${HWC_AP_STATS}.14`]: 0,
          },
        },
      ],
    },
    {
      key: "wifi_radios",
      rows: [
        { index: "1", values: { [IF_NAME]: "esa0" } },
        { index: "99", values: { [IF_NAME]: "eth0" } },
        {
          index: "1001",
          values: {
            [IF_NAME]: "TestAP_r1_802.11a/n",
            [`${HWC_RADIO_STATS}.1`]: 2,
            [`${HWC_RADIO_STATUS}.1`]: 5220,
            [`${HWC_RADIO_STATUS}.2`]: 4,
            [`${HWC_RADIO_STATS}.31`]: -94,
            [`${HWC_RADIO_STATS}.39`]: 37,
          },
        },
        {
          index: "1002",
          values: {
            [IF_NAME]: "TestAP_r2_802.11g/n",
            [`${HWC_RADIO_STATS}.1`]: 7,
            [`${HWC_RADIO_STATUS}.1`]: 2412,
            [`${HWC_RADIO_STATUS}.2`]: 1,
            [`${HWC_RADIO_STATS}.31`]: -94,
            [`${HWC_RADIO_STATS}.39`]: 12,
          },
        },
      ],
    },
    {
      key: "wifi_ssids",
      rows: [
        {
          index: "101",
          values: {
            [`${HWC_WLAN}.4`]: "Test VNS",
            [`${HWC_WLAN}.5`]: "Test",
            [`${HWC_WLAN_STATS}.2`]: 10,
            [`${HWC_WLAN}.7`]: 1,
          },
        },
      ],
    },
  ];
}

describe("Extreme Networks wireless controller", () => {
  it("reads the channel the controller reports as a frequency, and the width it counts in 20 MHz", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("extreme-wireless-controller", extremeControllerResults()),
    );

    expect(radioNamed(summary, "TestAP_r1_802.11a/n")).toEqual({
      name: "TestAP_r1_802.11a/n",
      index: "1001",
      band: WifiBand.Band5GHz,
      bandText: "5 GHz",
      channel: 44,
      frequencyMHz: 5220,
      channelWidthMHz: 80,
      noiseFloorDbm: -94,
      utilizationPercent: 37,
    });
    expect(radioNamed(summary, "TestAP_r2_802.11g/n")).toMatchObject({
      band: WifiBand.Band2_4GHz,
      channel: 1,
      frequencyMHz: 2412,
      channelWidthMHz: 20,
    });
  });

  it("has only the access points' radios as radios, not the controller's own ports", () => {
    /*
     * ifName names every interface, so the controller's ports come along
     * with the name column, holding nothing but a name. They are not rows
     * of the radio table - not on the SNMP Tables tab, not in the Wi-Fi tab.
     */
    const radios: SnmpTableSnapshot = snapshotOf(
      walk("extreme-wireless-controller", extremeControllerResults()),
      "wifi_radios",
    );

    expect(labels(radios)).toEqual([
      "TestAP_r1_802.11a/n",
      "TestAP_r2_802.11g/n",
    ]);
  });

  it("lists access points with their state and clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("extreme-wireless-controller", extremeControllerResults()),
    );

    expect(summary.accessPoints).toEqual([
      {
        name: "TestAP",
        index: "1",
        isUp: true,
        statusText: "active",
        clients: 10,
      },
      {
        name: "Warehouse-AP",
        index: "2",
        isUp: false,
        statusText: "inactive",
        clients: 0,
      },
    ]);
  });

  it("joins each WLAN's SSID to its client count by the WLAN index", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary(
      walk("extreme-wireless-controller", extremeControllerResults()),
    );

    expect(summary.ssids).toEqual([
      { name: "Test VNS", ssid: "Test", clients: 10 },
    ]);
    // No radio counts clients here, so the total is the WLANs'.
    expect(summary.totalClients).toBe(10);
  });
});

// --- TP-Link Omada ---

describe("TP-Link Omada access points", () => {
  it("collect the client count, the one Wi-Fi value they report over SNMP", () => {
    const omada: SnmpVendorTemplate = template("tplink-omada-eap");

    expect(
      omada.oids.map((oid: SnmpOid) => {
        return oid.oid;
      }),
    ).toEqual(["1.3.6.1.4.1.11863.10.1.1.1.0"]);
    expect(omada.tables || []).toEqual([]);
    expect(omada.description).toContain("Omada Controller");
  });
});

// --- The templates as a set ---

const WIFI_TEMPLATE_IDS: Array<string> = [
  "ubiquiti-unifi-ap",
  "aruba-instant",
  "aruba-mobility-controller",
  "extreme-iq-engine-ap",
  "extreme-wireless-controller",
];

/*
 * Where each template's OIDs may live: the vendor's own arc, and the
 * standard MIBs it reads besides (Host Resources and UCD for UniFi's CPU and
 * memory, IF-MIB's ifName for Extreme's radio names). An OID outside these
 * is a copy-paste from another vendor.
 */
const ALLOWED_ARCS: Record<string, Array<string>> = {
  "ubiquiti-unifi-ap": [
    "1.3.6.1.4.1.41112.1.6.",
    "1.3.6.1.4.1.2021.",
    "1.3.6.1.2.1.25.3.3.1.",
  ],
  "aruba-instant": ["1.3.6.1.4.1.14823.2.3.3.1."],
  "aruba-mobility-controller": ["1.3.6.1.4.1.14823.2.2.1."],
  "extreme-iq-engine-ap": ["1.3.6.1.4.1.26928.1."],
  "extreme-wireless-controller": [
    "1.3.6.1.4.1.4329.15.3.",
    "1.3.6.1.2.1.31.1.1.1.1",
  ],
  "tplink-omada-eap": ["1.3.6.1.4.1.11863.10."],
};

function everyOid(id: string): Array<string> {
  const oids: Array<string> = template(id).oids.map((oid: SnmpOid) => {
    return oid.oid;
  });

  for (const table of template(id).tables || []) {
    oids.push(...(table.rowLabelColumnOids || []));
    oids.push(
      ...table.columns.map((column: SnmpTableColumn) => {
        return column.oid;
      }),
    );
  }

  return oids;
}

describe("the Wi-Fi vendor templates", () => {
  it.each(Object.keys(ALLOWED_ARCS))(
    "%s reads only its vendor's MIBs and the standard ones it names",
    (id: string) => {
      for (const oid of everyOid(id)) {
        expect(
          ALLOWED_ARCS[id]!.some((arc: string) => {
            return oid.startsWith(arc) || oid === arc;
          }),
        ).toBe(true);
      }
    },
  );

  it.each(WIFI_TEMPLATE_IDS)(
    "%s has a radio table and an SSID table the Wi-Fi tab reads by role",
    (id: string) => {
      const kinds: Array<SnmpTableKind | undefined> = (
        template(id).tables || []
      ).map((table: SnmpTableDefinition) => {
        return table.kind;
      });

      expect(kinds).toContain(SnmpTableKind.WifiRadio);
      expect(kinds).toContain(SnmpTableKind.WifiSsid);

      const radio: SnmpTableDefinition = tableOf(id, "wifi_radios");
      const roles: Array<SnmpTableColumnRole | undefined> = radio.columns.map(
        (column: SnmpTableColumn) => {
          return column.role;
        },
      );

      // Every radio table places its radio on a channel (or a band).
      expect(
        roles.includes(SnmpTableColumnRole.Channel) ||
          roles.includes(SnmpTableColumnRole.Band),
      ).toBe(true);
    },
  );

  it("gives the controllers an access point table that knows what connected means", () => {
    for (const id of [
      "aruba-instant",
      "aruba-mobility-controller",
      "extreme-wireless-controller",
    ]) {
      const accessPoints: SnmpTableDefinition = tableOf(
        id,
        "wifi_access_points",
      );

      expect(accessPoints.kind).toBe(SnmpTableKind.WifiAccessPoint);

      const status: SnmpTableColumn | undefined = accessPoints.columns.find(
        (column: SnmpTableColumn) => {
          return column.role === SnmpTableColumnRole.Status;
        },
      );

      expect(status?.healthyValues).toEqual(["1"]);
    }
  });

  it("does not chart enumerations and names: band codes, models and addresses are text", () => {
    for (const id of WIFI_TEMPLATE_IDS) {
      for (const table of template(id).tables || []) {
        for (const column of table.columns) {
          if (
            column.role === SnmpTableColumnRole.Band ||
            column.role === SnmpTableColumnRole.Ssid ||
            ["Model", "IP Address", "Serial Number", "Interface"].includes(
              column.name,
            )
          ) {
            expect(column.valueType).toBe("Text");
          }
        }
      }
    }
  });

  it("keeps controllers' access point and radio tables at the most rows a table may keep", () => {
    for (const id of [
      "aruba-instant",
      "aruba-mobility-controller",
      "extreme-wireless-controller",
    ]) {
      expect(tableOf(id, "wifi_access_points").maxRows).toBe(250);
      expect(tableOf(id, "wifi_radios").maxRows).toBe(250);
    }
  });

  it("lists the templates generic first, then by label, as every template list shows them", () => {
    const labelsInOrder: Array<string> = SnmpVendorTemplateUtil.getAll()
      .slice(1)
      .map((entry: SnmpVendorTemplate) => {
        return entry.label.toLowerCase();
      });

    expect(labelsInOrder).toEqual(
      [...labelsInOrder].sort((a: string, b: string) => {
        return a.localeCompare(b, "en");
      }),
    );
    expect(SnmpVendorTemplateUtil.getAll()[0]!.id).toBe("host-resources-mib");
  });
});

describe("matching a Wi-Fi device to its template", () => {
  it.each([
    // UniFi: bare Ubiquiti arc on current firmware, Net-SNMP's on older.
    ["1.3.6.1.4.1.41112", "UAP-nanoHD 5.60.3.12934", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "U6-Pro 6.5.28.14491", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "U6+ 6.6.55.15189", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "U7-Pro 7.0.83.16045", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "UK-Ultra 6.6.77.15402", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "U-LTE-Pro-EU 6.6.57.15206", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.41112", "E7 *14", "ubiquiti-unifi-ap"],
    [
      "1.3.6.1.4.1.8072.3.2.10",
      "UAP-AC-HD 3.9.19.8123",
      "ubiquiti-unifi-ap",
    ],
    [
      ".1.3.6.1.4.1.8072.3.2.10",
      "UAP-nanoHD 5.43.36.12724",
      "ubiquiti-unifi-ap",
    ],
    // Ubiquiti's routers and switches keep their template.
    ["1.3.6.1.4.1.41112.1.5", "EdgeOS v2.0.9-hotfix.7", "ubiquiti-edgeos"],
    ["1.3.6.1.4.1.41112", "", "ubiquiti-edgeos"],
    // Aruba: access points (Instant) and controllers by product arc.
    [
      "1.3.6.1.4.1.14823.1.2.59",
      "ArubaOS (MODEL: 225), Version 8.4.0.0-8.4.0.0",
      "aruba-instant",
    ],
    [
      "1.3.6.1.4.1.14823.1.2.107",
      "AOS-8 (MODEL: 515), Version 8.13.0.1-8.13.0.1 LSR",
      "aruba-instant",
    ],
    [
      "1.3.6.1.4.1.14823.1.1.32",
      "ArubaOS (MODEL: Aruba7210), Version 8.2.0.2 (62929)",
      "aruba-mobility-controller",
    ],
    [
      "1.3.6.1.4.1.14823.1.1.9999",
      "ArubaOS (MODEL: ArubaMC-VA), Version 8.10.0.12-FIPS LSR (89862)",
      "aruba-mobility-controller",
    ],
    // Extreme: IQ Engine access points by their description.
    [
      "1.3.6.1.4.1.26928.1",
      "AP230, HiveOS 8.1r2a build-178408",
      "extreme-iq-engine-ap",
    ],
    [
      "1.3.6.1.4.1.26928.1",
      "HiveAP330, HiveOS 6.5r7 build-160188",
      "extreme-iq-engine-ap",
    ],
    [
      "1.3.6.1.4.1.26928.1",
      "HiveAP320_n, HiveOS 6.5r9a build-194750",
      "extreme-iq-engine-ap",
    ],
    [
      ".1.3.6.1.4.1.26928.1",
      "AP245X, HiveOS 8.2r4 build-207023",
      "extreme-iq-engine-ap",
    ],
    [
      "1.3.6.1.4.1.26928.1",
      "AP305C-1, HiveOS 10.6r4 build-dcfd27b",
      "extreme-iq-engine-ap",
    ],
    [
      "1.3.6.1.4.1.26928.1",
      "AP4000, IQ Engine 10.6r7 build-282012",
      "extreme-iq-engine-ap",
    ],
    // Extreme: the controllers on Siemens' HiPath Wireless arc.
    [
      "1.3.6.1.4.1.4329.15.1.1.13",
      "Extreme Networks Wireless Controller - V2110 Medium,  System Version 10.21.04.0005",
      "extreme-wireless-controller",
    ],
  ])(
    "%s (%s) -> %s",
    (sysObjectId: string, sysDescr: string, id: string) => {
      expect(
        SnmpVendorTemplateUtil.matchDevice({
          sysObjectId: sysObjectId,
          sysDescr: sysDescr,
        })?.id,
      ).toBe(id);
    },
  );

  it.each([
    // Any other Linux host answering with Net-SNMP's arc.
    ["1.3.6.1.4.1.8072.3.2.10", "Linux gw01 5.15.0-91-generic #101 x86_64"],
    // A description that only starts like a UniFi model, with no version.
    ["1.3.6.1.4.1.8072.3.2.10", "UK-London file server"],
    // The first UniFi firmware answered with Frogfoot's arc and "Linux".
    ["1.3.6.1.4.1.10002.1", "Linux 3.3.8 #1 Wed Jan 18 09:26:53 PST 2017 mips"],
    // Aerohive's switches share the arc and the OS name; they have no radios.
    ["1.3.6.1.4.1.26928.1", "SR2024P, HiveOS 6.5r4 Honolulu build-128121"],
    // ClearPass and other Aruba products are neither.
    ["1.3.6.1.4.1.14823.1.6.1", "ClearPass Policy Manager"],
    // Other Siemens products.
    ["1.3.6.1.4.1.4329.20.1.1", "SCALANCE X-300"],
    // TP-Link's arc carries switches and routers; Omada EAPs are applied by hand.
    ["1.3.6.1.4.1.11863.1.1.3", "TL-SG3428"],
  ])("%s (%s) matches no Wi-Fi template", (sysObjectId: string, sysDescr: string) => {
    expect(
      WIFI_TEMPLATE_IDS.concat(["tplink-omada-eap"]).includes(
        SnmpVendorTemplateUtil.matchDevice({
          sysObjectId: sysObjectId,
          sysDescr: sysDescr,
        })?.id || "",
      ),
    ).toBe(false);
  });

  it.each([
    ["1.3.6.1.4.1.8072.3.2.10", "UAP-AC-HD 3.9.19.8123", "Ubiquiti"],
    ["1.3.6.1.4.1.41112", "U6-Pro 6.5.28.14491", "Ubiquiti"],
    ["1.3.6.1.4.1.26928.1", "AP230, HiveOS 8.1r2a build-178408", "Extreme Networks"],
    [
      "1.3.6.1.4.1.4329.15.1.1.13",
      "Extreme Networks Wireless Controller - V2110 Medium",
      "Extreme Networks",
    ],
    ["1.3.6.1.4.1.14823.1.2.59", "ArubaOS (MODEL: 225)", "Aruba"],
    // A Net-SNMP host that is not an access point stays Net-SNMP.
    ["1.3.6.1.4.1.8072.3.2.10", "Linux gw01 5.15.0-91-generic", "Net-SNMP"],
  ])(
    "%s (%s) is made by %s",
    (sysObjectId: string, sysDescr: string, vendor: string) => {
      expect(
        SnmpVendorTemplateUtil.getVendorName({
          sysObjectId: sysObjectId,
          sysDescr: sysDescr,
        }),
      ).toBe(vendor);
    },
  );

  it("leaves a Siemens product other than the wireless controllers without a vendor name", () => {
    expect(
      SnmpVendorTemplateUtil.getVendorName({
        sysObjectId: "1.3.6.1.4.1.4329.20.1.1",
        sysDescr: "SCALANCE X-300",
      }),
    ).toBeUndefined();
  });
});

describe("the Wi-Fi tab of a device with each template, end to end", () => {
  it.each([
    ["ubiquiti-unifi-ap", unifiResults, 0, 2, 4],
    ["aruba-instant", arubaInstantResults, 3, 6, 2],
    ["aruba-mobility-controller", arubaControllerResults, 1, 2, 2],
    ["extreme-iq-engine-ap", hiveosResults, 0, 2, 3],
    ["extreme-wireless-controller", extremeControllerResults, 2, 2, 1],
  ])(
    "%s: access points, radios and SSIDs",
    (
      id: string,
      results: () => Array<SnmpTableResult>,
      accessPoints: number,
      radios: number,
      ssids: number,
    ) => {
      const snapshots: Array<SnmpTableSnapshot> = walk(id, results());

      expect(WifiRadioUtil.hasWifiTables(snapshots)).toBe(true);

      const summary: WifiSummary = WifiRadioUtil.getSummary(snapshots);

      expect(summary.accessPoints).toHaveLength(accessPoints);
      expect(summary.radios).toHaveLength(radios);
      expect(summary.ssids).toHaveLength(ssids);
      expect(summary.collectedAt).toBe("2026-10-09T08:00:00.000Z");

      for (const accessPoint of summary.accessPoints) {
        expect((accessPoint as WifiAccessPointView).name.length).toBeGreaterThan(
          0,
        );
      }
    },
  );
});
