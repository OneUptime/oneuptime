/*
 * Networks an access point runs for itself.
 *
 * An SSID table lists the networks people join. Some vendors' tables also
 * hold networks their access points run for their own use: nobody joins
 * them and nobody created them, so listed as SSIDs they add rows the
 * customer never configured, inflate the SSID count and - a mesh link's
 * stations being access points - the client totals (issue #4730: a UniFi
 * access point broadcasting one SSID on two bands was listed with five).
 *
 * A row is told apart by what the vendor's MIB reports about it wherever
 * the MIB says it - a VAP's usage, its interface name, a WLAN's service
 * type. A name is read only where nothing else tells: UniFi's device
 * adoption network reports exactly what a network of the customer's
 * reports, but for its name. Each name rule matches the whole name UniFi
 * generates - a prefix and 16 lowercase hex digits - so no network of the
 * customer's, hidden or not, is taken for one.
 *
 * The rules key on column OIDs rather than on a flag in the table's
 * definition: applying a vendor template COPIES its tables into the device,
 * so a flag would only reach devices set up after it was added, while the
 * columns these rules read are in every copy. A table of the SSID kind
 * leaves these rows out (SnmpTableListUtil.materialize, before anything
 * stores, charts or judges them); any other table keeps every row.
 *
 * What the other Wi-Fi vendors' MIBs say, and why they need no rule here:
 *
 *   - Aruba Instant (AI-AP-MIB) keeps mesh links in aiMeshTable, apart from
 *     the SSIDs in aiWlanSSIDTable; a hidden SSID there (aiSSIDHide) is a
 *     network of the customer's.
 *   - ArubaOS controllers (WLSX-WLAN-MIB) list the ESSIDs they advertise in
 *     wlsxWlanESSIDTable; mesh portals and points are a mode of a BSSID
 *     (wlanAPBssidMode), in a table of their own.
 *   - IQ Engine (AH-INTERFACE-MIB) reports "N/A" as the SSID of every
 *     interface that is not a wireless interface in access mode - its mesh
 *     backhaul included - which isNetworkName reads as no network.
 *   - Cambium (CAMBIUM-MIB) lists the WLANs configured on the access point;
 *     mesh peers are in cambiumMeshClientTable.
 *   - TP-Link Omada access points report no SSID table at all.
 */

export enum WifiInternalNetworkKind {
  /*
   * A wireless link between access points, for meshing: UniFi's "vwire"
   * VAP, an Extreme controller's WDS and mesh WLAN services.
   */
  MeshLink = "MeshLink",
  /*
   * UniFi's hidden network that new UniFi devices join to be adopted
   * (Element Adoption, now New Device Auto-Link).
   */
  DeviceAdoption = "DeviceAdoption",
}

export interface WifiInternalNetworkRule {
  // Whose MIB the rule reads, for people and tests.
  vendor: string;
  kind: WifiInternalNetworkKind;
  // The column the rule reads: the table entry's OID plus the column number.
  columnOid: string;
  // The column's MIB object name, for people and tests.
  column: string;
  // Values that mark the row, compared trimmed and case-insensitively.
  values?: Array<string> | undefined;
  // Text the value starts with, compared case-insensitively.
  prefix?: string | undefined;
  // A pattern the whole value matches, for a name nothing else tells apart.
  pattern?: RegExp | undefined;
}

// UBNT-UniFi-MIB's unifiVapTable: one row per VAP of every radio.
export const UNIFI_VAP_ENTRY_OID: string = "1.3.6.1.4.1.41112.1.6.1.2.1";
// unifiVapEssId: the network's name.
export const UNIFI_VAP_ESSID_OID: string = `${UNIFI_VAP_ENTRY_OID}.6`;
// unifiVapName: the VAP's interface - ath0, ath1 ... or vwire8, vwireap0.
export const UNIFI_VAP_NAME_OID: string = `${UNIFI_VAP_ENTRY_OID}.7`;
// unifiVapUsage: "Usage type: guest or regular user".
export const UNIFI_VAP_USAGE_OID: string = `${UNIFI_VAP_ENTRY_OID}.23`;

// HIPATH-WIRELESS-HWC-MIB's wlanTable: one row per configured WLAN service.
export const EXTREME_WLAN_ENTRY_OID: string = "1.3.6.1.4.1.4329.15.3.3.4.4.1";
// wlanServiceType: standard(0), wds(3), thirdParty(4), remote(5), mesh(6).
export const EXTREME_WLAN_SERVICE_TYPE_OID: string = `${EXTREME_WLAN_ENTRY_OID}.3`;

// The name UniFi gives its mesh link: "vwire-" and 16 lowercase hex digits.
const UNIFI_MESH_LINK_ESSID: RegExp = /^vwire-[0-9a-f]{16}$/;

// The name UniFi gives its adoption network: "element-" and 16 hex digits.
const UNIFI_DEVICE_ADOPTION_ESSID: RegExp = /^element-[0-9a-f]{16}$/;

/*
 * What vendors put in an SSID column for an interface that broadcasts none:
 * IQ Engine writes "N/A" (its MIB says so for every interface not in access
 * mode). Kept this narrow so a network really called "NA" or "none" is
 * still listed.
 */
const NO_SSID_NAME: RegExp = /^(?:n\/a|-+)$/i;

export const WIFI_INTERNAL_NETWORK_RULES: ReadonlyArray<WifiInternalNetworkRule> =
  [
    {
      /*
       * A network's usage is "user" or "guest". UniFi's mesh link reports
       * "downlink" on the access point that offers it (UAP-AC-Lite and
       * UAP-AC-Pro, firmware 6.6), "uplink" its meshed side's counterpart.
       */
      vendor: "Ubiquiti UniFi",
      kind: WifiInternalNetworkKind.MeshLink,
      columnOid: UNIFI_VAP_USAGE_OID,
      column: "unifiVapUsage",
      values: ["downlink", "uplink"],
    },
    {
      /*
       * UniFi names a network's VAP after its radio's driver (ath0,
       * ath1 ...) and its mesh link's "vwire": vwire8 on firmware 6.6,
       * vwireap0 and vwiresta0 on later firmware.
       */
      vendor: "Ubiquiti UniFi",
      kind: WifiInternalNetworkKind.MeshLink,
      columnOid: UNIFI_VAP_NAME_OID,
      column: "unifiVapName",
      prefix: "vwire",
    },
    {
      vendor: "Ubiquiti UniFi",
      kind: WifiInternalNetworkKind.MeshLink,
      columnOid: UNIFI_VAP_ESSID_OID,
      column: "unifiVapEssId",
      pattern: UNIFI_MESH_LINK_ESSID,
    },
    {
      /*
       * The adoption network reports usage "user", an athN interface and
       * up - as a network of the customer's does. Only its name tells.
       */
      vendor: "Ubiquiti UniFi",
      kind: WifiInternalNetworkKind.DeviceAdoption,
      columnOid: UNIFI_VAP_ESSID_OID,
      column: "unifiVapEssId",
      pattern: UNIFI_DEVICE_ADOPTION_ESSID,
    },
    {
      /*
       * WDS and mesh WLAN services carry traffic between access points:
       * the satellite access points are what associates to them.
       */
      vendor: "Extreme Networks",
      kind: WifiInternalNetworkKind.MeshLink,
      columnOid: EXTREME_WLAN_SERVICE_TYPE_OID,
      column: "wlanServiceType",
      values: ["3", "6"],
    },
  ];

// A walked row's raw value of a column, by the column's OID.
export type WifiRowValueReader = (
  columnOid: string,
) => string | number | null | undefined;

/*
 * A row of an SSID table as the rules read it: the SSID it names (undefined
 * when the table has no SSID column) and its raw values by column OID.
 */
export interface WifiRowReading {
  ssid: string | undefined;
  read: WifiRowValueReader;
}

export default class WifiInternalNetworkUtil {
  /*
   * The kind of network an access point runs for itself that a row of an
   * SSID table holds, or undefined for a network people join.
   */
  public static getKind(
    read: WifiRowValueReader,
  ): WifiInternalNetworkKind | undefined {
    for (const rule of WIFI_INTERNAL_NETWORK_RULES) {
      if (WifiInternalNetworkUtil.matches(rule, read(rule.columnOid))) {
        return rule.kind;
      }
    }

    return undefined;
  }

  // Whether an SSID cell names a network clients can join.
  public static isNetworkName(name: string | undefined): boolean {
    const text: string = (name || "").trim();
    return text.length > 0 && !NO_SSID_NAME.test(text);
  }

  /*
   * Whether a row of an SSID table is a network people join: it names one,
   * when the table has an SSID column (`ssid` is undefined when it has
   * none), and it is no network the access point runs for itself.
   */
  public static isJoinableNetwork(data: WifiRowReading): boolean {
    if (
      data.ssid !== undefined &&
      !WifiInternalNetworkUtil.isNetworkName(data.ssid)
    ) {
      return false;
    }

    return WifiInternalNetworkUtil.getKind(data.read) === undefined;
  }

  /*
   * Whether a row that is no network people join still tells of something
   * the device has there: a network it runs for itself, or an SSID column
   * that names none ("N/A"). A row whose SSID column holds nothing tells
   * nothing - the device may not have that column, or a mistyped OID or the
   * SNMP view may hide it - so it does not say the access point broadcasts
   * no SSID.
   */
  public static isReportedRow(data: WifiRowReading): boolean {
    return (
      (data.ssid !== undefined && data.ssid.trim().length > 0) ||
      WifiInternalNetworkUtil.getKind(data.read) !== undefined
    );
  }

  private static matches(
    rule: WifiInternalNetworkRule,
    raw: string | number | null | undefined,
  ): boolean {
    if (raw === undefined || raw === null) {
      return false;
    }

    const text: string = String(raw).trim();

    if (!text) {
      return false;
    }

    if (rule.values) {
      return rule.values.includes(text.toLowerCase());
    }

    if (rule.prefix) {
      return text.toLowerCase().startsWith(rule.prefix.toLowerCase());
    }

    if (rule.pattern) {
      return rule.pattern.test(text);
    }

    return false;
  }
}
