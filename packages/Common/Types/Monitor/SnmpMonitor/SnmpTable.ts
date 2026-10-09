/*
 * SNMP tables: data that lives in rows rather than scalars.
 *
 * A health OID names ONE value. Most of what an operator cares about on a
 * firewall, an access point or a fabric switch is a list instead - one row
 * per IPsec tunnel, per radio, per SSID, per routing neighbour, per fan -
 * and the rows come and go: tunnels are added, a radio is switched off, a
 * neighbour drops. Pinning a health OID to `…ConnStatus.3` collects "whatever
 * sits at row 3 today", which is why a table is defined by its COLUMNS and
 * walked whole on every poll.
 *
 * Three shapes, one per stage:
 *
 *   SnmpTableDefinition  - what the operator (or a vendor template) asks
 *                          for, stored on OID Collection Templates and on
 *                          devices.
 *   SnmpTableWalkRequest - the compact form the probe receives: which
 *                          column OIDs to walk and how many rows to keep.
 *   SnmpTableResult      - what the probe walked: raw values per row index
 *                          and column OID. The probe knows nothing about
 *                          names, labels or units.
 *   SnmpTableSnapshot    - the result joined back to its definition on the
 *                          server: named columns, labelled rows, display and
 *                          numeric values. Criteria, metrics, the device's
 *                          Tables tab and the Wi-Fi view all read this one.
 */

/*
 * What a table represents. Purely descriptive for the generic Tables view;
 * the Wi-Fi view reads the Wi-Fi kinds to know which tables hold access
 * points, radios and SSIDs. Stored as a string, so adding a kind never
 * breaks a stored definition.
 */
export enum SnmpTableKind {
  Generic = "Generic",
  WifiRadio = "WifiRadio",
  WifiSsid = "WifiSsid",
  /*
   * The access points a wireless controller manages - an Aruba Instant
   * cluster's virtual controller, an ArubaOS Mobility Controller, an
   * Extreme wireless controller - one row per access point. An access point
   * that drops off its controller leaves its area without Wi-Fi, so the
   * recommended alerts raise an incident for it, as for a tunnel.
   */
  WifiAccessPoint = "WifiAccessPoint",
  VpnTunnel = "VpnTunnel",
  RoutingAdjacency = "RoutingAdjacency",
  Hardware = "Hardware",
}

/*
 * What a column means, for views that render a table by meaning rather than
 * by column name: the Wi-Fi view finds a radio's channel, width and power
 * through these, whichever vendor's MIB they came from. Optional - a column
 * with no role is still collected, charted and alertable.
 */
export enum SnmpTableColumnRole {
  Status = "Status",
  Band = "Band",
  Channel = "Channel",
  ChannelWidth = "ChannelWidth",
  TxPower = "TxPower",
  Clients = "Clients",
  NoiseFloor = "NoiseFloor",
  Utilization = "Utilization",
  Ssid = "Ssid",
}

/*
 * How a column's values are read.
 *
 * Unset (the default) reads a number wherever there is one: numeric varbinds
 * as they are, and text that STARTS with a number by that number - "36",
 * "-95 dBm", "80MHz", "1.5". Plenty of vendors put numbers in OctetStrings
 * (Cambium's channel and noise floor, EXOS's memory counters), and without
 * this they could never be charted or compared.
 *
 * Text switches that off for a column whose values only look numeric - a
 * radio type such as "11axg" would otherwise chart as 11.
 */
export enum SnmpTableValueType {
  Number = "Number",
  Text = "Text",
}

export interface SnmpTableColumn {
  // Full column OID (the table entry OID plus the column number).
  oid: string;
  name: string;
  description?: string | undefined;
  unit?: string | undefined;
  role?: SnmpTableColumnRole | undefined;
  valueType?: SnmpTableValueType | undefined;
  /*
   * Raw value -> what to show, for enumerations: Sophos reports a tunnel as
   * 0/1/2, which reads as inactive/active/partially active. The raw value is
   * still what criteria compare numerically and what metrics record; the
   * label is what people read, and what text criteria can compare against.
   */
  valueLabels?: Record<string, string> | undefined;
  /*
   * The raw values that mean "fine", for status columns. Lets the Tables
   * view mark a row red without anyone writing a criteria, and lets vendor
   * templates say what healthy looks like once.
   */
  healthyValues?: Array<string> | undefined;
  /*
   * How the number a cell holds is put into the column's unit: multiplied
   * by `scale`, then `offset` added. For MIBs that keep a value in a unit of
   * their own - ArubaOS reports transmit power in half dBm (scale 0.5),
   * Aruba Instant the noise floor's magnitude (scale -1: 94 is -94 dBm),
   * Aerohive the noise floor plus 256 (offset -256). The adjusted number is
   * what is shown, charted and compared, so "noise floor above -80 dBm"
   * means the same on every vendor; the raw value is kept as it came.
   */
  scale?: number | undefined;
  offset?: number | undefined;
}

export interface SnmpTableDefinition {
  /*
   * Stable identifier: what criteria and metrics refer to, so renaming a
   * table does not orphan an alert. Lowercase letters, digits and
   * underscores; derived from the name when left empty.
   */
  key: string;
  name: string;
  description?: string | undefined;
  kind?: SnmpTableKind | undefined;
  /*
   * Columns whose values name each row - a tunnel's connection name, a
   * radio's band. Joined with " / " when there are several. A table without
   * them names its rows by index. They do not need to be value columns too.
   *
   * A name column may come from a parent table, one whose index is the
   * start of this table's: Aruba Instant indexes its radios by access point
   * and radio number, and its access point names by access point alone, so
   * a radio is named "AP-12 / Radio 0". The parent's own rows only name
   * their children; they are not rows of this table.
   */
  rowLabelColumnOids?: Array<string> | undefined;
  /*
   * The row index is a text string in SNMP's encoding - its length, then
   * one arc per byte - as when a table is indexed by a name: ArubaOS indexes
   * its ESSID table by the SSID itself. The decoded text names each row
   * that no name column names.
   */
  rowIndexIsText?: boolean | undefined;
  columns: Array<SnmpTableColumn>;
  // Rows kept per walk. Defaults to DEFAULT_SNMP_TABLE_MAX_ROWS.
  maxRows?: number | undefined;
}

/*
 * Attributes on every SNMP table metric point (one point per numeric cell).
 * The contract between the poll that writes the points and every reader -
 * the device's charts, the Metric Explorer, a Metrics monitor's Group By.
 */
export const SNMP_TABLE_KEY_ATTRIBUTE: string = "snmpTableKey";
export const SNMP_TABLE_NAME_ATTRIBUTE: string = "snmpTableName";
export const SNMP_TABLE_COLUMN_ATTRIBUTE: string = "snmpTableColumn";
export const SNMP_TABLE_COLUMN_OID_ATTRIBUTE: string = "snmpTableColumnOid";
export const SNMP_TABLE_ROW_ATTRIBUTE: string = "snmpTableRow";
export const SNMP_TABLE_ROW_INDEX_ATTRIBUTE: string = "snmpTableRowIndex";

// --- Probe wire format ---

export interface SnmpTableWalkRequest {
  key: string;
  // Every column to walk: the row-label columns and the value columns.
  columnOids: Array<string>;
  maxRows: number;
}

export interface SnmpTableResultRow {
  // The row's index: everything after the column OID, e.g. "3" or "1.5".
  index: string;
  // Column OID -> raw value, as parsed from the varbind.
  values: Record<string, string | number | null>;
}

export interface SnmpTableResult {
  key: string;
  rows: Array<SnmpTableResultRow>;
  // True when the walk stopped at maxRows rather than at the end of the table.
  isTruncated?: boolean | undefined;
  // Set when this table could not be walked; rows is then empty.
  failureCause?: string | undefined;
}

// --- Materialized on the server ---

export interface SnmpTableSnapshotColumn {
  oid: string;
  name: string;
  unit?: string | undefined;
  role?: SnmpTableColumnRole | undefined;
  healthyValues?: Array<string> | undefined;
}

export interface SnmpTableSnapshotCell {
  raw: string | number | null;
  // The value label when one is configured, else the raw value as text.
  display: string;
  // Undefined when the value is not a number (see SnmpTableValueType).
  numeric?: number | undefined;
  // Only set when the column lists healthyValues.
  isHealthy?: boolean | undefined;
}

export interface SnmpTableSnapshotRow {
  index: string;
  label: string;
  // Column OID -> cell.
  cells: Record<string, SnmpTableSnapshotCell>;
}

export interface SnmpTableSnapshot {
  key: string;
  name: string;
  kind: SnmpTableKind;
  columns: Array<SnmpTableSnapshotColumn>;
  rows: Array<SnmpTableSnapshotRow>;
  isTruncated?: boolean | undefined;
  failureCause?: string | undefined;
  // ISO timestamp of the walk that produced these rows.
  collectedAt?: string | undefined;
}
