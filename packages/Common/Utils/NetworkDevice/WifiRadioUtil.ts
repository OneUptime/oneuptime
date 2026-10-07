import {
  SnmpTableColumnRole,
  SnmpTableKind,
  SnmpTableSnapshot,
  SnmpTableSnapshotCell,
  SnmpTableSnapshotColumn,
  SnmpTableSnapshotRow,
} from "../../Types/Monitor/SnmpMonitor/SnmpTable";

/*
 * The Wi-Fi view of a device, read out of its walked SNMP tables by column
 * ROLE rather than by vendor: a radio table is any table of kind WifiRadio,
 * and its channel is whichever column is tagged Channel. A vendor template
 * that tags its columns gets the Wi-Fi tab for free.
 *
 * Frequency is derived, not read: no vendor MIB we ship reports it, and the
 * channel number plus the band is all it takes (IEEE 802.11 channel plan).
 */

// How vendors write the band: "2.4GHz", "2,4 GHz", "2G", "5 GHz", "6E" ...
const BAND_2_4_GHZ: RegExp = /2[.,]4/;
const BAND_2G: RegExp = /\b2g\b/;
const BAND_6_GHZ: RegExp = /\b6\s*g(hz)?\b/;
const BAND_6E: RegExp = /\b6e\b/;
const BAND_5_GHZ: RegExp = /\b5(\.\d+)?\s*g(hz)?\b/;
const PHY_NAME: RegExp = /^(?:802\.)?11([a-z]+)$/;

export enum WifiBand {
  Band2_4GHz = "2.4 GHz",
  Band5GHz = "5 GHz",
  Band6GHz = "6 GHz",
}

export interface WifiRadioView {
  name: string;
  index: string;
  band?: WifiBand | undefined;
  bandText?: string | undefined;
  channel?: number | undefined;
  frequencyMHz?: number | undefined;
  channelWidthMHz?: number | undefined;
  txPowerDbm?: number | undefined;
  clients?: number | undefined;
  noiseFloorDbm?: number | undefined;
  utilizationPercent?: number | undefined;
  // Undefined when the table reports no status for its radios.
  isOn?: boolean | undefined;
  statusText?: string | undefined;
}

export interface WifiSsidView {
  name: string;
  ssid: string;
  bandText?: string | undefined;
  clients?: number | undefined;
}

export interface WifiSummary {
  radios: Array<WifiRadioView>;
  ssids: Array<WifiSsidView>;
  // Sum of every radio's clients, when any radio reports a count.
  totalClients?: number | undefined;
  collectedAt?: string | undefined;
  failureCause?: string | undefined;
}

export default class WifiRadioUtil {
  public static hasWifiTables(
    snapshots: Array<SnmpTableSnapshot> | undefined,
  ): boolean {
    return (snapshots || []).some((snapshot: SnmpTableSnapshot) => {
      return (
        snapshot.kind === SnmpTableKind.WifiRadio ||
        snapshot.kind === SnmpTableKind.WifiSsid
      );
    });
  }

  public static getSummary(
    snapshots: Array<SnmpTableSnapshot> | undefined,
  ): WifiSummary {
    const radioTables: Array<SnmpTableSnapshot> = (snapshots || []).filter(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.kind === SnmpTableKind.WifiRadio;
      },
    );

    const ssidTables: Array<SnmpTableSnapshot> = (snapshots || []).filter(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.kind === SnmpTableKind.WifiSsid;
      },
    );

    const radios: Array<WifiRadioView> = radioTables.flatMap(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
          return WifiRadioUtil.toRadio(snapshot, row);
        });
      },
    );

    const ssids: Array<WifiSsidView> = ssidTables.flatMap(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
          return WifiRadioUtil.toSsid(snapshot, row);
        });
      },
    );

    const clientCounts: Array<number> = radios
      .map((radio: WifiRadioView) => {
        return radio.clients;
      })
      .filter((clients: number | undefined): clients is number => {
        return typeof clients === "number";
      });

    const summary: WifiSummary = {
      radios: radios,
      ssids: ssids,
    };

    if (clientCounts.length > 0) {
      summary.totalClients = clientCounts.reduce(
        (total: number, clients: number) => {
          return total + clients;
        },
        0,
      );
    }

    const primary: SnmpTableSnapshot | undefined = radioTables[0];

    if (primary?.collectedAt) {
      summary.collectedAt = primary.collectedAt;
    }

    if (primary?.failureCause) {
      summary.failureCause = primary.failureCause;
    }

    return summary;
  }

  public static toRadio(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): WifiRadioView {
    const cell: (
      role: SnmpTableColumnRole,
    ) => SnmpTableSnapshotCell | undefined = (
      role: SnmpTableColumnRole,
    ): SnmpTableSnapshotCell | undefined => {
      return WifiRadioUtil.getCellByRole(snapshot, row, role);
    };

    const bandText: string | undefined =
      cell(SnmpTableColumnRole.Band)?.display || undefined;
    const channel: number | undefined = cell(
      SnmpTableColumnRole.Channel,
    )?.numeric;
    const band: WifiBand | undefined =
      WifiRadioUtil.parseBand(bandText) ??
      WifiRadioUtil.inferBandFromChannel(channel);

    const statusCell: SnmpTableSnapshotCell | undefined = cell(
      SnmpTableColumnRole.Status,
    );

    const radio: WifiRadioView = {
      name: row.label,
      index: row.index,
    };

    if (band) {
      radio.band = band;
    }
    if (bandText) {
      radio.bandText = bandText;
    }
    if (channel !== undefined) {
      radio.channel = channel;

      const frequencyMHz: number | undefined =
        WifiRadioUtil.channelToFrequencyMHz(channel, band);
      if (frequencyMHz !== undefined) {
        radio.frequencyMHz = frequencyMHz;
      }
    }

    WifiRadioUtil.assignNumber(
      radio,
      "channelWidthMHz",
      cell(SnmpTableColumnRole.ChannelWidth),
    );
    WifiRadioUtil.assignNumber(
      radio,
      "txPowerDbm",
      cell(SnmpTableColumnRole.TxPower),
    );
    WifiRadioUtil.assignNumber(
      radio,
      "clients",
      cell(SnmpTableColumnRole.Clients),
    );
    WifiRadioUtil.assignNumber(
      radio,
      "noiseFloorDbm",
      cell(SnmpTableColumnRole.NoiseFloor),
    );
    WifiRadioUtil.assignNumber(
      radio,
      "utilizationPercent",
      cell(SnmpTableColumnRole.Utilization),
    );

    if (statusCell) {
      radio.statusText = statusCell.display;
      if (statusCell.isHealthy !== undefined) {
        radio.isOn = statusCell.isHealthy;
      }
    }

    return radio;
  }

  public static toSsid(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): WifiSsidView {
    const ssid: string =
      WifiRadioUtil.getCellByRole(snapshot, row, SnmpTableColumnRole.Ssid)
        ?.display || row.label;

    const view: WifiSsidView = {
      name: row.label,
      ssid: ssid,
    };

    const bandText: string | undefined = WifiRadioUtil.getCellByRole(
      snapshot,
      row,
      SnmpTableColumnRole.Band,
    )?.display;

    if (bandText) {
      view.bandText = bandText;
    }

    const clients: number | undefined = WifiRadioUtil.getCellByRole(
      snapshot,
      row,
      SnmpTableColumnRole.Clients,
    )?.numeric;

    if (clients !== undefined) {
      view.clients = clients;
    }

    return view;
  }

  private static assignNumber(
    radio: WifiRadioView,
    field:
      | "channelWidthMHz"
      | "txPowerDbm"
      | "clients"
      | "noiseFloorDbm"
      | "utilizationPercent",
    cell: SnmpTableSnapshotCell | undefined,
  ): void {
    if (cell && typeof cell.numeric === "number") {
      radio[field] = cell.numeric;
    }
  }

  private static getCellByRole(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
    role: SnmpTableColumnRole,
  ): SnmpTableSnapshotCell | undefined {
    const column: SnmpTableSnapshotColumn | undefined = snapshot.columns.find(
      (candidate: SnmpTableSnapshotColumn) => {
        return candidate.role === role;
      },
    );

    return column ? row.cells[column.oid] : undefined;
  }

  /*
   * Vendors write the band every way there is: "2.4GHz", "2.4 ghz", "5G",
   * "6 GHz", "11axg" (g = 2.4 GHz), "11ac" (a = 5 GHz).
   */
  public static parseBand(text: string | undefined): WifiBand | undefined {
    const value: string = (text || "").trim().toLowerCase();

    if (!value) {
      return undefined;
    }

    if (BAND_2_4_GHZ.test(value) || BAND_2G.test(value)) {
      return WifiBand.Band2_4GHz;
    }

    if (BAND_6_GHZ.test(value) || BAND_6E.test(value)) {
      return WifiBand.Band6GHz;
    }

    if (BAND_5_GHZ.test(value)) {
      return WifiBand.Band5GHz;
    }

    /*
     * An 802.11 PHY name: a trailing g or b is 2.4 GHz (11g, 11ng, 11axg),
     * a trailing a - or "ac" - is 5 GHz (11a, 11na, 11ac, 11axa).
     */
    const phy: RegExpMatchArray | null = value.match(PHY_NAME);

    if (phy && phy[1]) {
      const suffix: string = phy[1];

      if (suffix === "ac" || suffix.endsWith("a")) {
        return WifiBand.Band5GHz;
      }

      if (suffix.endsWith("g") || suffix.endsWith("b")) {
        return WifiBand.Band2_4GHz;
      }
    }

    return undefined;
  }

  /*
   * Only for the channels that cannot be anything else: 1-14 are 2.4 GHz
   * and 32-177 are 5 GHz, but 6 GHz reuses 1-233, so a radio that reports
   * no band is never guessed into 6 GHz.
   */
  public static inferBandFromChannel(
    channel: number | undefined,
  ): WifiBand | undefined {
    if (channel === undefined || !Number.isInteger(channel)) {
      return undefined;
    }

    if (channel >= 1 && channel <= 14) {
      return WifiBand.Band2_4GHz;
    }

    if (channel >= 32 && channel <= 177) {
      return WifiBand.Band5GHz;
    }

    return undefined;
  }

  // The centre frequency of a 20 MHz channel, per the IEEE 802.11 channel plan.
  public static channelToFrequencyMHz(
    channel: number | undefined,
    band: WifiBand | undefined,
  ): number | undefined {
    if (channel === undefined || !Number.isInteger(channel) || !band) {
      return undefined;
    }

    if (band === WifiBand.Band2_4GHz) {
      if (channel === 14) {
        return 2484;
      }
      return channel >= 1 && channel <= 13 ? 2407 + 5 * channel : undefined;
    }

    if (band === WifiBand.Band5GHz) {
      return channel >= 32 && channel <= 177 ? 5000 + 5 * channel : undefined;
    }

    // 6 GHz: channel 2 is the odd one out, below the regular raster.
    if (channel === 2) {
      return 5935;
    }

    return channel >= 1 && channel <= 233 ? 5950 + 5 * channel : undefined;
  }
}
