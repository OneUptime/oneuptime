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
 * Vendors split the same facts differently, and the view puts them back
 * together the same way for every one of them:
 *
 *   - Frequency is worked out, not read: the channel number plus the band
 *     is all it takes (IEEE 802.11 channel plan). A controller that reports
 *     the frequency where its MIB says channel (Extreme's reports 5220 for
 *     channel 44) is read the other way round.
 *   - A radio that reports no band is placed by its channel, where only one
 *     band numbers its channels that way.
 *   - UniFi keeps channel, transmit power and clients per SSID rather than
 *     per radio: a radio that reports none of them takes them from the
 *     SSIDs on its band, when it is the only radio on that band.
 *   - Controllers that count clients per radio but not per access point
 *     (Aruba) have each access point's clients added up from the radios
 *     whose index starts with its own.
 *   - An SSID row with no name is an interface, not a network: HiveOS lists
 *     every interface in its SSID table, "N/A" for the ones that broadcast
 *     nothing.
 */

// How vendors write the band: "2.4GHz", "2,4 GHz", "2G", "5 GHz", "6E" ...
const BAND_2_4_GHZ: RegExp = /2[.,]4/;
const BAND_2G: RegExp = /\b2g\b/;
const BAND_6_GHZ: RegExp = /\b6\s*g(hz)?\b/;
const BAND_6E: RegExp = /\b6e\b/;
const BAND_5_GHZ: RegExp = /\b5(\.\d+)?\s*g(hz)?\b/;
const PHY_NAME: RegExp = /^(?:802\.)?11([a-z]+)$/;

// What vendors put in an SSID column for an interface that broadcasts none.
const NO_SSID_NAME: RegExp = /^(?:n\/?a|none|-+)$/i;

// Below this a channel column holds a channel number, from it a frequency in MHz.
const LOWEST_WIFI_FREQUENCY_MHZ: number = 2400;

export enum WifiBand {
  Band2_4GHz = "2.4 GHz",
  Band5GHz = "5 GHz",
  Band6GHz = "6 GHz",
}

export interface WifiAccessPointView {
  name: string;
  index: string;
  // Undefined when the table reports no status for its access points.
  isUp?: boolean | undefined;
  statusText?: string | undefined;
  clients?: number | undefined;
  // The radios whose index starts with this access point's.
  radioCount?: number | undefined;
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
  band?: WifiBand | undefined;
  /*
   * What the SSID's own row says about the radio it is on. UniFi reports
   * these per SSID only; they fill in the radio (see fillRadiosFromSsids).
   */
  channel?: number | undefined;
  txPowerDbm?: number | undefined;
  clients?: number | undefined;
}

export interface WifiSummary {
  accessPoints: Array<WifiAccessPointView>;
  radios: Array<WifiRadioView>;
  ssids: Array<WifiSsidView>;
  /*
   * Every client the device reports: the radios' when the radio table
   * counts them, otherwise the SSIDs', otherwise the access points'.
   */
  totalClients?: number | undefined;
  collectedAt?: string | undefined;
  failureCause?: string | undefined;
}

export const WIFI_TABLE_KINDS: Array<SnmpTableKind> = [
  SnmpTableKind.WifiAccessPoint,
  SnmpTableKind.WifiRadio,
  SnmpTableKind.WifiSsid,
];

export default class WifiRadioUtil {
  public static hasWifiTables(
    snapshots: Array<SnmpTableSnapshot> | undefined,
  ): boolean {
    return (snapshots || []).some((snapshot: SnmpTableSnapshot) => {
      return WIFI_TABLE_KINDS.includes(snapshot.kind);
    });
  }

  public static getSummary(
    snapshots: Array<SnmpTableSnapshot> | undefined,
  ): WifiSummary {
    const tablesOf: (kind: SnmpTableKind) => Array<SnmpTableSnapshot> = (
      kind: SnmpTableKind,
    ): Array<SnmpTableSnapshot> => {
      return (snapshots || []).filter((snapshot: SnmpTableSnapshot) => {
        return snapshot.kind === kind;
      });
    };

    const accessPointTables: Array<SnmpTableSnapshot> = tablesOf(
      SnmpTableKind.WifiAccessPoint,
    );
    const radioTables: Array<SnmpTableSnapshot> = tablesOf(
      SnmpTableKind.WifiRadio,
    );
    const ssidTables: Array<SnmpTableSnapshot> = tablesOf(
      SnmpTableKind.WifiSsid,
    );

    const radios: Array<WifiRadioView> = radioTables.flatMap(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
          return WifiRadioUtil.toRadio(snapshot, row);
        });
      },
    );

    // Whether the radio table itself counts clients, before any fill-in.
    const radiosCountClients: boolean = radios.some((radio: WifiRadioView) => {
      return radio.clients !== undefined;
    });

    const ssids: Array<WifiSsidView> = ssidTables
      .flatMap((snapshot: SnmpTableSnapshot) => {
        return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
          return WifiRadioUtil.toSsid(snapshot, row);
        });
      })
      .filter((ssid: WifiSsidView) => {
        return WifiRadioUtil.isNetworkName(ssid.ssid);
      });

    WifiRadioUtil.fillRadiosFromSsids(radios, ssids);

    const accessPoints: Array<WifiAccessPointView> = accessPointTables.flatMap(
      (snapshot: SnmpTableSnapshot) => {
        return snapshot.rows.map((row: SnmpTableSnapshotRow) => {
          return WifiRadioUtil.toAccessPoint(snapshot, row);
        });
      },
    );

    WifiRadioUtil.fillAccessPointsFromRadios(accessPoints, radios);

    const summary: WifiSummary = {
      accessPoints: accessPoints,
      radios: radios,
      ssids: ssids,
    };

    const totalClients: number | undefined = radiosCountClients
      ? WifiRadioUtil.sumClients(radios)
      : (WifiRadioUtil.sumClients(ssids) ??
        WifiRadioUtil.sumClients(accessPoints));

    if (totalClients !== undefined) {
      summary.totalClients = totalClients;
    }

    // The radio table speaks for the walk; a device without one, the next.
    const primary: SnmpTableSnapshot | undefined =
      radioTables[0] || accessPointTables[0] || ssidTables[0];

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

    const radio: WifiRadioView = {
      name: row.label,
      index: row.index,
    };

    if (bandText) {
      radio.bandText = bandText;
    }

    WifiRadioUtil.placeOnChannel(
      radio,
      cell(SnmpTableColumnRole.Channel)?.numeric,
      bandText,
    );

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

    const statusCell: SnmpTableSnapshotCell | undefined = cell(
      SnmpTableColumnRole.Status,
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
    /*
     * A table with an SSID column says what each row broadcasts, even when
     * that is nothing; only a table without one is named by its rows.
     */
    const ssidCell: SnmpTableSnapshotCell | undefined =
      WifiRadioUtil.getCellByRole(snapshot, row, SnmpTableColumnRole.Ssid);

    const view: WifiSsidView = {
      name: row.label,
      ssid: ssidCell ? ssidCell.display.trim() : row.label,
    };

    const bandText: string | undefined = WifiRadioUtil.getCellByRole(
      snapshot,
      row,
      SnmpTableColumnRole.Band,
    )?.display;

    if (bandText) {
      view.bandText = bandText;
    }

    const channelReading: { channel: number; band?: WifiBand } | undefined =
      WifiRadioUtil.readChannel(
        WifiRadioUtil.getCellByRole(snapshot, row, SnmpTableColumnRole.Channel)
          ?.numeric,
      );

    const band: WifiBand | undefined =
      channelReading?.band ??
      WifiRadioUtil.parseBand(bandText) ??
      WifiRadioUtil.inferBandFromChannel(channelReading?.channel);

    if (band) {
      view.band = band;
    }

    if (channelReading) {
      view.channel = channelReading.channel;
    }

    const txPowerDbm: number | undefined = WifiRadioUtil.getCellByRole(
      snapshot,
      row,
      SnmpTableColumnRole.TxPower,
    )?.numeric;

    if (txPowerDbm !== undefined) {
      view.txPowerDbm = txPowerDbm;
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

  public static toAccessPoint(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): WifiAccessPointView {
    const view: WifiAccessPointView = {
      name: row.label,
      index: row.index,
    };

    const statusCell: SnmpTableSnapshotCell | undefined =
      WifiRadioUtil.getCellByRole(snapshot, row, SnmpTableColumnRole.Status);

    if (statusCell) {
      view.statusText = statusCell.display;

      if (statusCell.isHealthy !== undefined) {
        view.isUp = statusCell.isHealthy;
      }
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

  // Whether an SSID cell names a network clients can join.
  public static isNetworkName(name: string | undefined): boolean {
    const text: string = (name || "").trim();
    return text.length > 0 && !NO_SSID_NAME.test(text);
  }

  /*
   * Channel, frequency and band, from whatever the channel column holds: a
   * channel number, or - from controllers that report it there - the
   * frequency in MHz.
   */
  private static placeOnChannel(
    radio: WifiRadioView,
    channelValue: number | undefined,
    bandText: string | undefined,
  ): void {
    const reading: { channel: number; band?: WifiBand } | undefined =
      WifiRadioUtil.readChannel(channelValue);

    const band: WifiBand | undefined =
      reading?.band ??
      WifiRadioUtil.parseBand(bandText) ??
      WifiRadioUtil.inferBandFromChannel(reading?.channel);

    if (band) {
      radio.band = band;
    }

    if (!reading) {
      return;
    }

    radio.channel = reading.channel;

    const frequencyMHz: number | undefined =
      channelValue !== undefined && channelValue >= LOWEST_WIFI_FREQUENCY_MHZ
        ? channelValue
        : WifiRadioUtil.channelToFrequencyMHz(reading.channel, band);

    if (frequencyMHz !== undefined) {
      radio.frequencyMHz = frequencyMHz;
    }
  }

  /*
   * A channel column's value as a channel. A value in the Wi-Fi bands'
   * frequency range is a frequency, and comes back as its channel with the
   * band it pins down; anything else is taken as the channel number it is.
   */
  private static readChannel(
    value: number | undefined,
  ): { channel: number; band?: WifiBand } | undefined {
    if (value === undefined || !Number.isFinite(value)) {
      return undefined;
    }

    if (value < LOWEST_WIFI_FREQUENCY_MHZ) {
      return { channel: value };
    }

    return WifiRadioUtil.frequencyToChannel(value);
  }

  /*
   * UniFi's radio table carries a radio's band and airtime; its channel,
   * transmit power and clients are on each SSID the radio broadcasts. A
   * radio that reports none of a value takes it from the SSIDs on its band,
   * provided it is the only radio on that band (a second 5 GHz radio would
   * make the SSIDs ambiguous) - the channel and power only when every SSID
   * agrees, the clients as their sum.
   */
  public static fillRadiosFromSsids(
    radios: Array<WifiRadioView>,
    ssids: Array<WifiSsidView>,
  ): void {
    for (const radio of radios) {
      if (!radio.band) {
        continue;
      }

      const radiosOnBand: number = radios.filter(
        (candidate: WifiRadioView) => {
          return candidate.band === radio.band;
        },
      ).length;

      if (radiosOnBand !== 1) {
        continue;
      }

      const onBand: Array<WifiSsidView> = ssids.filter(
        (ssid: WifiSsidView) => {
          return ssid.band === radio.band;
        },
      );

      if (onBand.length === 0) {
        continue;
      }

      if (radio.channel === undefined) {
        const channel: number | undefined = WifiRadioUtil.agreedValue(
          onBand.map((ssid: WifiSsidView) => {
            return ssid.channel;
          }),
        );

        if (channel !== undefined) {
          radio.channel = channel;

          const frequencyMHz: number | undefined =
            WifiRadioUtil.channelToFrequencyMHz(channel, radio.band);

          if (frequencyMHz !== undefined) {
            radio.frequencyMHz = frequencyMHz;
          }
        }
      }

      if (radio.txPowerDbm === undefined) {
        const txPowerDbm: number | undefined = WifiRadioUtil.agreedValue(
          onBand.map((ssid: WifiSsidView) => {
            return ssid.txPowerDbm;
          }),
        );

        if (txPowerDbm !== undefined) {
          radio.txPowerDbm = txPowerDbm;
        }
      }

      if (radio.clients === undefined) {
        const clients: number | undefined = WifiRadioUtil.sumClients(onBand);

        if (clients !== undefined) {
          radio.clients = clients;
        }
      }
    }
  }

  /*
   * An access point's radios are the radio rows whose index starts with
   * its own (Aruba indexes both by the access point's MAC address). They
   * give the access point a radio count and, when its own row reports no
   * clients, its clients.
   */
  public static fillAccessPointsFromRadios(
    accessPoints: Array<WifiAccessPointView>,
    radios: Array<WifiRadioView>,
  ): void {
    for (const accessPoint of accessPoints) {
      const prefix: string = `${accessPoint.index}.`;

      const ownRadios: Array<WifiRadioView> = radios.filter(
        (radio: WifiRadioView) => {
          return radio.index.startsWith(prefix);
        },
      );

      if (ownRadios.length === 0) {
        continue;
      }

      accessPoint.radioCount = ownRadios.length;

      if (accessPoint.clients === undefined) {
        const clients: number | undefined = WifiRadioUtil.sumClients(ownRadios);

        if (clients !== undefined) {
          accessPoint.clients = clients;
        }
      }
    }
  }

  // The one value every entry that has one agrees on; undefined otherwise.
  private static agreedValue(
    values: Array<number | undefined>,
  ): number | undefined {
    const known: Array<number> = values.filter(
      (value: number | undefined): value is number => {
        return typeof value === "number";
      },
    );

    if (known.length === 0) {
      return undefined;
    }

    return known.every((value: number) => {
      return value === known[0];
    })
      ? known[0]
      : undefined;
  }

  // The sum of every known client count; undefined when none is known.
  private static sumClients(
    entries: Array<{ clients?: number | undefined }>,
  ): number | undefined {
    const counts: Array<number> = entries
      .map((entry: { clients?: number | undefined }) => {
        return entry.clients;
      })
      .filter((clients: number | undefined): clients is number => {
        return typeof clients === "number";
      });

    if (counts.length === 0) {
      return undefined;
    }

    return counts.reduce((total: number, clients: number) => {
      return total + clients;
    }, 0);
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
   * Only for the channels that cannot be anything else.
   *
   * 1-14 are 2.4 GHz and 32-177 are 5 GHz - except that 6 GHz numbers its
   * channels 1, 5, 9 ... 233, and no 5 GHz channel below 149 is numbered
   * that way: 5 GHz channels there are multiples of 4, and the centres of
   * its wider channels 2 more. So 37, 53 or 181 can only be 6 GHz, while a
   * radio that reports no band on channel 1 or 149 is still read as 2.4 or
   * 5 GHz, which is what such a radio almost always is.
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

    const isSixGhzNumbering: boolean = channel % 4 === 1;

    if (
      isSixGhzNumbering &&
      ((channel >= 17 && channel <= 145) || (channel >= 181 && channel <= 233))
    ) {
      return WifiBand.Band6GHz;
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

  /*
   * The channel and band of a centre frequency - channelToFrequencyMHz the
   * other way round. Undefined for a frequency that is no Wi-Fi channel's.
   */
  public static frequencyToChannel(
    frequencyMHz: number | undefined,
  ): { channel: number; band: WifiBand } | undefined {
    if (frequencyMHz === undefined || !Number.isInteger(frequencyMHz)) {
      return undefined;
    }

    if (frequencyMHz === 2484) {
      return { channel: 14, band: WifiBand.Band2_4GHz };
    }

    if (
      frequencyMHz >= 2412 &&
      frequencyMHz <= 2472 &&
      (frequencyMHz - 2407) % 5 === 0
    ) {
      return { channel: (frequencyMHz - 2407) / 5, band: WifiBand.Band2_4GHz };
    }

    if (
      frequencyMHz >= 5160 &&
      frequencyMHz <= 5885 &&
      (frequencyMHz - 5000) % 5 === 0
    ) {
      return { channel: (frequencyMHz - 5000) / 5, band: WifiBand.Band5GHz };
    }

    if (frequencyMHz === 5935) {
      return { channel: 2, band: WifiBand.Band6GHz };
    }

    if (
      frequencyMHz >= 5955 &&
      frequencyMHz <= 7115 &&
      (frequencyMHz - 5950) % 5 === 0
    ) {
      return { channel: (frequencyMHz - 5950) / 5, band: WifiBand.Band6GHz };
    }

    return undefined;
  }
}
