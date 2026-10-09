import WifiRadioUtil, {
  WIFI_TABLE_KINDS,
  WifiAccessPointView,
  WifiBand,
  WifiRadioView,
  WifiSsidView,
  WifiSummary,
} from "../../../Utils/NetworkDevice/WifiRadioUtil";
import {
  SnmpTableColumnRole,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import { describe, expect, it } from "@jest/globals";

/*
 * How the Wi-Fi view puts each vendor's facts back together - the rules
 * that let one page show every vendor's radios the same way:
 *
 *   - a channel column that holds a frequency (Extreme's controller) is
 *     read as the frequency it is;
 *   - a channel only 6 GHz numbers that way is 6 GHz, even with no band;
 *   - a radio reporting no channel, power or clients takes them from the
 *     SSIDs on its band (UniFi), when it alone is on that band;
 *   - an access point counts the radios - and their clients - whose index
 *     starts with its own (Aruba);
 *   - an SSID row naming no network is an interface, not an SSID (HiveOS);
 *   - the total is the radios' clients, else the SSIDs', else the access
 *     points'.
 */

interface CellSpec {
  role?: SnmpTableColumnRole | undefined;
  raw: string | number | null;
  display?: string | undefined;
  numeric?: number | undefined;
  isHealthy?: boolean | undefined;
}

let nextOid: number = 1;

/*
 * A snapshot from rows of role -> value. Each role gets one column; a
 * value given as a number is numeric, as text it is shown as text.
 */
function snapshot(
  kind: SnmpTableKind,
  rows: Array<{
    index: string;
    label: string;
    cells: Partial<Record<SnmpTableColumnRole, CellSpec>>;
  }>,
  extra: Partial<SnmpTableSnapshot> = {},
): SnmpTableSnapshot {
  const roles: Array<SnmpTableColumnRole> = Array.from(
    new Set(
      rows.flatMap(
        (row: {
          cells: Partial<Record<SnmpTableColumnRole, CellSpec>>;
        }): Array<SnmpTableColumnRole> => {
          return Object.keys(row.cells) as Array<SnmpTableColumnRole>;
        },
      ),
    ),
  );

  const oids: Map<SnmpTableColumnRole, string> = new Map();

  const columns: Array<SnmpTableSnapshotColumn> = roles.map(
    (role: SnmpTableColumnRole): SnmpTableSnapshotColumn => {
      const oid: string = `1.3.6.1.4.1.99999.${nextOid++}`;
      oids.set(role, oid);
      return { oid: oid, name: role, role: role };
    },
  );

  return {
    key: `table_${nextOid++}`,
    name: kind,
    kind: kind,
    columns: columns,
    rows: rows.map(
      (row: {
        index: string;
        label: string;
        cells: Partial<Record<SnmpTableColumnRole, CellSpec>>;
      }): SnmpTableSnapshotRow => {
        const cells: Record<string, SnmpTableSnapshotCell> = {};

        for (const [role, spec] of Object.entries(row.cells) as Array<
          [SnmpTableColumnRole, CellSpec]
        >) {
          const cell: SnmpTableSnapshotCell = {
            raw: spec.raw,
            display:
              spec.display ?? (spec.raw === null ? "" : String(spec.raw)),
          };

          const numeric: number | undefined =
            spec.numeric ?? (typeof spec.raw === "number" ? spec.raw : undefined);

          if (numeric !== undefined) {
            cell.numeric = numeric;
          }

          if (spec.isHealthy !== undefined) {
            cell.isHealthy = spec.isHealthy;
          }

          cells[oids.get(role)!] = cell;
        }

        return { index: row.index, label: row.label, cells: cells };
      },
    ),
    ...extra,
  };
}

function value(raw: string | number, display?: string): CellSpec {
  return display === undefined ? { raw: raw } : { raw: raw, display: display };
}

describe("a channel column that holds a frequency", () => {
  it.each([
    [2412, WifiBand.Band2_4GHz, 1],
    [2437, WifiBand.Band2_4GHz, 6],
    [2472, WifiBand.Band2_4GHz, 13],
    [2484, WifiBand.Band2_4GHz, 14],
    [5180, WifiBand.Band5GHz, 36],
    [5220, WifiBand.Band5GHz, 44],
    [5745, WifiBand.Band5GHz, 149],
    [5825, WifiBand.Band5GHz, 165],
    [5885, WifiBand.Band5GHz, 177],
    [5935, WifiBand.Band6GHz, 2],
    [5955, WifiBand.Band6GHz, 1],
    [6135, WifiBand.Band6GHz, 37],
    [7115, WifiBand.Band6GHz, 233],
  ])("%s MHz is %s channel %s", (mhz: number, band: WifiBand, channel: number) => {
    expect(WifiRadioUtil.frequencyToChannel(mhz)).toEqual({
      band: band,
      channel: channel,
    });
    // And back again.
    expect(WifiRadioUtil.channelToFrequencyMHz(channel, band)).toBe(mhz);
  });

  it.each([[2400], [2413], [2490], [5000], [5162], [5950], [7120], [5220.5]])(
    "%s MHz is no channel's centre",
    (mhz: number) => {
      expect(WifiRadioUtil.frequencyToChannel(mhz)).toBeUndefined();
    },
  );

  it("is no frequency when undefined", () => {
    expect(WifiRadioUtil.frequencyToChannel(undefined)).toBeUndefined();
  });

  it("gives a radio its channel, the frequency it reported, and the band the frequency pins down", () => {
    const radio: WifiRadioView = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1001",
          label: "AP1_r1",
          cells: { [SnmpTableColumnRole.Channel]: value(5220) },
        },
      ]),
    ]).radios[0]!;

    expect(radio).toEqual({
      name: "AP1_r1",
      index: "1001",
      band: WifiBand.Band5GHz,
      channel: 44,
      frequencyMHz: 5220,
    });
  });

  it("trusts the frequency over a band label that disagrees", () => {
    const radio: WifiRadioView = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1",
          label: "r",
          cells: {
            [SnmpTableColumnRole.Channel]: value(2412),
            [SnmpTableColumnRole.Band]: value("5 GHz"),
          },
        },
      ]),
    ]).radios[0]!;

    expect(radio.band).toBe(WifiBand.Band2_4GHz);
    expect(radio.bandText).toBe("5 GHz");
    expect(radio.channel).toBe(1);
  });

  it("keeps a channel number as a channel", () => {
    const radio: WifiRadioView = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1",
          label: "r",
          cells: { [SnmpTableColumnRole.Channel]: value(149) },
        },
      ]),
    ]).radios[0]!;

    expect(radio).toMatchObject({
      band: WifiBand.Band5GHz,
      channel: 149,
      frequencyMHz: 5745,
    });
  });

  it("has no channel for a frequency outside every band", () => {
    const radio: WifiRadioView = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1",
          label: "r",
          cells: { [SnmpTableColumnRole.Channel]: value(3000) },
        },
      ]),
    ]).radios[0]!;

    expect(radio.channel).toBeUndefined();
    expect(radio.frequencyMHz).toBeUndefined();
  });
});

describe("a channel only 6 GHz numbers that way", () => {
  it.each([[17], [21], [33], [37], [53], [69], [101], [133], [145], [181], [233]])(
    "channel %s is 6 GHz",
    (channel: number) => {
      expect(WifiRadioUtil.inferBandFromChannel(channel)).toBe(
        WifiBand.Band6GHz,
      );
    },
  );

  it.each([
    // 5 GHz channels and the centres of its 40, 80 and 160 MHz channels.
    [32],
    [36],
    [38],
    [42],
    [46],
    [50],
    [58],
    [106],
    [114],
    [138],
    [144],
    // 5 GHz numbers its upper channels 1 apart from a multiple of 4 too.
    [149],
    [155],
    [165],
    [177],
  ])("channel %s stays 5 GHz", (channel: number) => {
    expect(WifiRadioUtil.inferBandFromChannel(channel)).toBe(
      WifiBand.Band5GHz,
    );
  });

  it.each([[0], [15], [20], [237], [-1], [6.5]])(
    "channel %s is no band",
    (channel: number) => {
      expect(WifiRadioUtil.inferBandFromChannel(channel)).toBeUndefined();
    },
  );
});

describe("a radio that reports no channel, power or clients", () => {
  function unifi(
    radioRows: Array<{
      index: string;
      band: string;
      clients?: number;
      channel?: number;
    }>,
    ssidRows: Array<{
      name: string;
      band: string;
      channel?: number;
      power?: number;
      clients?: number;
    }>,
  ): WifiSummary {
    return WifiRadioUtil.getSummary([
      snapshot(
        SnmpTableKind.WifiRadio,
        radioRows.map(
          (row: {
            index: string;
            band: string;
            clients?: number;
            channel?: number;
          }) => {
            return {
              index: row.index,
              label: row.band,
              cells: {
                [SnmpTableColumnRole.Band]: value(row.band),
                ...(row.clients === undefined
                  ? {}
                  : { [SnmpTableColumnRole.Clients]: value(row.clients) }),
                ...(row.channel === undefined
                  ? {}
                  : { [SnmpTableColumnRole.Channel]: value(row.channel) }),
              },
            };
          },
        ),
      ),
      snapshot(
        SnmpTableKind.WifiSsid,
        ssidRows.map(
          (
            row: {
              name: string;
              band: string;
              channel?: number;
              power?: number;
              clients?: number;
            },
            position: number,
          ) => {
            return {
              index: `${position + 1}`,
              label: `${row.name} / ${row.band}`,
              cells: {
                [SnmpTableColumnRole.Ssid]: value(row.name),
                [SnmpTableColumnRole.Band]: value(row.band),
                ...(row.channel === undefined
                  ? {}
                  : { [SnmpTableColumnRole.Channel]: value(row.channel) }),
                ...(row.power === undefined
                  ? {}
                  : { [SnmpTableColumnRole.TxPower]: value(row.power) }),
                ...(row.clients === undefined
                  ? {}
                  : { [SnmpTableColumnRole.Clients]: value(row.clients) }),
              },
            };
          },
        ),
      ),
    ]);
  }

  it("takes them from the SSIDs on its band", () => {
    const summary: WifiSummary = unifi(
      [{ index: "1", band: "2.4 GHz" }],
      [
        { name: "Corp", band: "2.4 GHz", channel: 11, power: 20, clients: 3 },
        { name: "Guest", band: "2.4 GHz", channel: 11, power: 20, clients: 5 },
      ],
    );

    expect(summary.radios[0]).toMatchObject({
      channel: 11,
      frequencyMHz: 2462,
      txPowerDbm: 20,
      clients: 8,
    });
  });

  it("takes nothing when two radios share the band - the SSIDs could be either's", () => {
    const summary: WifiSummary = unifi(
      [
        { index: "1", band: "5 GHz" },
        { index: "2", band: "5 GHz" },
      ],
      [{ name: "Corp", band: "5 GHz", channel: 36, power: 22, clients: 9 }],
    );

    for (const radio of summary.radios) {
      expect(radio.channel).toBeUndefined();
      expect(radio.txPowerDbm).toBeUndefined();
      expect(radio.clients).toBeUndefined();
    }

    // The SSIDs still count every client.
    expect(summary.totalClients).toBe(9);
  });

  it("takes no channel the SSIDs disagree on, but still adds up their clients", () => {
    const summary: WifiSummary = unifi(
      [{ index: "1", band: "5 GHz" }],
      [
        { name: "Corp", band: "5 GHz", channel: 36, clients: 2 },
        { name: "Guest", band: "5 GHz", channel: 40, clients: 1 },
      ],
    );

    expect(summary.radios[0]!.channel).toBeUndefined();
    expect(summary.radios[0]!.clients).toBe(3);
  });

  it("keeps what the radio reports itself", () => {
    const summary: WifiSummary = unifi(
      [{ index: "1", band: "2.4 GHz", channel: 6, clients: 12 }],
      [{ name: "Corp", band: "2.4 GHz", channel: 1, clients: 3 }],
    );

    expect(summary.radios[0]).toMatchObject({ channel: 6, clients: 12 });
    // The radio table counts clients: the total is the radios'.
    expect(summary.totalClients).toBe(12);
  });

  it("takes nothing for a radio with no band, or from SSIDs with none", () => {
    const summary: WifiSummary = unifi(
      [
        { index: "1", band: "" },
        { index: "2", band: "5 GHz" },
      ],
      [{ name: "Corp", band: "", clients: 4 }],
    );

    expect(summary.radios[0]!.clients).toBeUndefined();
    expect(summary.radios[1]!.clients).toBeUndefined();
    expect(summary.totalClients).toBe(4);
  });

  it("places an SSID that reports no band by its channel", () => {
    const summary: WifiSummary = unifi(
      [{ index: "2", band: "5 GHz" }],
      [{ name: "Corp", band: "", channel: 36, clients: 4 }],
    );

    expect(summary.radios[0]).toMatchObject({ channel: 36, clients: 4 });
  });
});

describe("SSID rows", () => {
  function ssids(names: Array<string>): Array<WifiSsidView> {
    return WifiRadioUtil.getSummary([
      snapshot(
        SnmpTableKind.WifiSsid,
        names.map((name: string, position: number) => {
          return {
            index: `${position}`,
            label: `${name || "(none)"} / if${position}`,
            cells: { [SnmpTableColumnRole.Ssid]: value(name) },
          };
        }),
      ),
    ]).ssids;
  }

  it("leave out interfaces that broadcast no network", () => {
    expect(
      ssids(["Corp", "N/A", "n/a", "", "  ", "-", "Guest"]).map(
        (ssid: WifiSsidView) => {
          return ssid.ssid;
        },
      ),
    ).toEqual(["Corp", "Guest"]);
  });

  it("keep a network that is really called NA or none", () => {
    expect(
      ssids(["NA", "none"]).map((ssid: WifiSsidView) => {
        return ssid.ssid;
      }),
    ).toEqual(["NA", "none"]);
  });

  it("name an SSID by its row when the table has no SSID column", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiSsid, [
        {
          index: "4.67.111.114.112",
          label: "Corp",
          cells: { [SnmpTableColumnRole.Clients]: value(120) },
        },
      ]),
    ]);

    expect(summary.ssids).toEqual([
      { name: "Corp", ssid: "Corp", clients: 120 },
    ]);
  });

  it("carry the band their row reports, read the way radios read theirs", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiSsid, [
        {
          index: "1",
          label: "Corp / na",
          cells: {
            [SnmpTableColumnRole.Ssid]: value("Corp"),
            [SnmpTableColumnRole.Band]: value("na", "5 GHz"),
          },
        },
        {
          index: "2",
          label: "Corp / ?",
          cells: {
            [SnmpTableColumnRole.Ssid]: value("Corp"),
            [SnmpTableColumnRole.Channel]: value(37),
          },
        },
      ]),
    ]);

    expect(summary.ssids[0]!.band).toBe(WifiBand.Band5GHz);
    expect(summary.ssids[0]!.bandText).toBe("5 GHz");
    expect(summary.ssids[1]!.band).toBe(WifiBand.Band6GHz);
    expect(summary.ssids[1]!.channel).toBe(37);
  });
});

describe("access points", () => {
  function controller(
    accessPointClients: Array<number | undefined>,
  ): WifiSummary {
    return WifiRadioUtil.getSummary([
      snapshot(
        SnmpTableKind.WifiAccessPoint,
        accessPointClients.map(
          (clients: number | undefined, position: number) => {
            return {
              index: `0.11.${position}`,
              label: `ap-${position}`,
              cells: {
                [SnmpTableColumnRole.Status]: {
                  raw: position === 1 ? 2 : 1,
                  display: position === 1 ? "down" : "up",
                  isHealthy: position !== 1,
                },
                ...(clients === undefined
                  ? {}
                  : { [SnmpTableColumnRole.Clients]: value(clients) }),
              },
            };
          },
        ),
      ),
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "0.11.0.0",
          label: "ap-0 / Radio 0",
          cells: { [SnmpTableColumnRole.Clients]: value(5) },
        },
        {
          index: "0.11.0.1",
          label: "ap-0 / Radio 1",
          cells: { [SnmpTableColumnRole.Clients]: value(2) },
        },
        {
          index: "0.11.1.0",
          label: "ap-1 / Radio 0",
          cells: { [SnmpTableColumnRole.Clients]: value(0) },
        },
        // 0.11.10 is not ap-1's: indexes are compared arc by arc.
        {
          index: "0.11.10.0",
          label: "other / Radio 0",
          cells: { [SnmpTableColumnRole.Clients]: value(4) },
        },
      ]),
    ]);
  }

  it("are listed with their state, radios and their radios' clients", () => {
    expect(controller([undefined, undefined, undefined]).accessPoints).toEqual(
      [
        {
          name: "ap-0",
          index: "0.11.0",
          isUp: true,
          statusText: "up",
          radioCount: 2,
          clients: 7,
        },
        {
          name: "ap-1",
          index: "0.11.1",
          isUp: false,
          statusText: "down",
          radioCount: 1,
          clients: 0,
        },
        { name: "ap-2", index: "0.11.2", isUp: true, statusText: "up" },
      ],
    );
  });

  it("keep the clients their own row reports", () => {
    expect(controller([30, undefined, 4]).accessPoints[0]!.clients).toBe(30);
  });

  it("make the Wi-Fi tab even with no radio table, and date it", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      snapshot(
        SnmpTableKind.WifiAccessPoint,
        [
          {
            index: "1",
            label: "TestAP",
            cells: { [SnmpTableColumnRole.Clients]: value(10) },
          },
        ],
        { collectedAt: "2026-10-09T08:00:00.000Z" },
      ),
    ]);

    expect(
      WifiRadioUtil.hasWifiTables([
        snapshot(SnmpTableKind.WifiAccessPoint, []),
      ]),
    ).toBe(true);
    expect(summary.radios).toEqual([]);
    expect(summary.collectedAt).toBe("2026-10-09T08:00:00.000Z");
    // Nothing else counts clients: the total is the access points'.
    expect(summary.totalClients).toBe(10);
  });

  it("is a kind the Wi-Fi tab reads, with radios and SSIDs", () => {
    expect(WIFI_TABLE_KINDS).toEqual([
      SnmpTableKind.WifiAccessPoint,
      SnmpTableKind.WifiRadio,
      SnmpTableKind.WifiSsid,
    ]);
  });
});

describe("the client total", () => {
  it("is the radios' when the radio table counts clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1",
          label: "r",
          cells: { [SnmpTableColumnRole.Clients]: value(3) },
        },
      ]),
      snapshot(SnmpTableKind.WifiSsid, [
        {
          index: "1",
          label: "s",
          cells: {
            [SnmpTableColumnRole.Ssid]: value("s"),
            [SnmpTableColumnRole.Clients]: value(99),
          },
        },
      ]),
    ]);

    expect(summary.totalClients).toBe(3);
  });

  it("is nothing when no table counts clients", () => {
    const summary: WifiSummary = WifiRadioUtil.getSummary([
      snapshot(SnmpTableKind.WifiRadio, [
        {
          index: "1",
          label: "r",
          cells: { [SnmpTableColumnRole.Channel]: value(6) },
        },
      ]),
    ]);

    expect(summary.totalClients).toBeUndefined();
    expect(summary.accessPoints).toEqual([] as Array<WifiAccessPointView>);
  });
});
