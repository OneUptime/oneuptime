import ArpEntry from "Common/Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "Common/Types/Monitor/SnmpMonitor/FdbEntry";

/*
 * Pure parsers for the SNMP endpoint-discovery tables (IP-MIB ARP cache,
 * BRIDGE/Q-BRIDGE forwarding databases, and the bridge base-port map). They
 * consume the exact row shape net-snmp's session.tableColumns produces —
 * rows keyed by the (possibly composite) row index, each row keyed by
 * column number as a string — and have no dependency on a live SNMP
 * session, so every parsing rule is unit-testable against canned tables.
 */

// Row shape produced by net-snmp's session.tableColumns.
export type SnmpTableRows = Record<string, Record<string, unknown>>;

/*
 * Every constant below is the TABLE OID, not the Entry OID: the walker
 * appends the ".1." Entry subid itself (exactly as net-snmp's
 * session.tableColumns does) before appending the column number. Including
 * the Entry subid here would walk one level too deep — a subtree that
 * resolves cleanly to zero rows — so the convention matters and is pinned
 * by the walk tests.
 */

/*
 * IP-MIB ipNetToMediaTable — the device's ARP / IP-to-media cache. The row
 * index is "ipNetToMediaIfIndex.a.b.c.d" (the interface index plus the four
 * IP octets); the same values are also exposed as columns, which are
 * preferred because agents are more reliable at columns than at composite
 * indexes.
 */
export const IP_NET_TO_MEDIA_TABLE_OID: string = "1.3.6.1.2.1.4.22";
export const IP_NET_TO_MEDIA_COLUMNS: {
  ipNetToMediaIfIndex: number;
  ipNetToMediaPhysAddress: number;
  ipNetToMediaNetAddress: number;
  ipNetToMediaType: number;
} = {
  ipNetToMediaIfIndex: 1,
  ipNetToMediaPhysAddress: 2,
  ipNetToMediaNetAddress: 3,
  ipNetToMediaType: 4,
};

/*
 * Q-BRIDGE-MIB dot1qTpFdbTable — per-VLAN learned MACs. The row index is
 * "fdbId.m1.m2.m3.m4.m5.m6" where fdbId is the VLAN's forwarding-database
 * id (equal to the VLAN id on most gear — exposed as vlanId best-effort)
 * and the six trailing components are the MAC octets in decimal.
 */
export const DOT1Q_TP_FDB_TABLE_OID: string = "1.3.6.1.2.1.17.7.1.2.2";
export const DOT1Q_TP_FDB_COLUMNS: {
  dot1qTpFdbPort: number;
  dot1qTpFdbStatus: number;
} = {
  dot1qTpFdbPort: 2,
  dot1qTpFdbStatus: 3,
};

/*
 * BRIDGE-MIB dot1dTpFdbTable — the pre-VLAN forwarding database, walked as
 * a fallback when the Q-BRIDGE table is empty or unimplemented. The row
 * index is the six MAC octets in decimal.
 */
export const DOT1D_TP_FDB_TABLE_OID: string = "1.3.6.1.2.1.17.4.3";
export const DOT1D_TP_FDB_COLUMNS: {
  dot1dTpFdbAddress: number;
  dot1dTpFdbPort: number;
  dot1dTpFdbStatus: number;
} = {
  dot1dTpFdbAddress: 1,
  dot1dTpFdbPort: 2,
  dot1dTpFdbStatus: 3,
};

/*
 * BRIDGE-MIB dot1dBasePortTable — maps bridge ports (the number space FDB
 * rows use) to ifIndexes (the number space interfaces use). The two are
 * DIFFERENT namespaces; without this table an FDB bridge port cannot be
 * tied to an interface.
 */
export const DOT1D_BASE_PORT_TABLE_OID: string = "1.3.6.1.2.1.17.1.4";
export const DOT1D_BASE_PORT_COLUMNS: {
  dot1dBasePortIfIndex: number;
} = {
  dot1dBasePortIfIndex: 2,
};

/*
 * ARP caches on core routers and FDBs on busy switches can hold tens of
 * thousands of rows; cap what a single poll ships so one chatty device
 * cannot balloon the ingest payload. The FDB cap applies post-filter (only
 * learned entries count against it).
 *
 * These same caps are ALSO handed to the walker, which stops asking the
 * device for more rows once it has that many — the parsers are the second
 * line of defence, not the first. Bounding only here would still let a
 * device with a hundred thousand learned MACs buffer every one of them in
 * the probe's heap, and take thousands of sequential GETBULKs doing it,
 * before a single row was discarded.
 */
export const MAX_ARP_ENTRIES: number = 2048;
export const MAX_FDB_ENTRIES: number = 4096;

/*
 * dot1dBasePortTable is bounded by the device's bridge-port count rather
 * than by learned traffic, so this cap is a backstop against a malformed or
 * hostile agent rather than an expected limit; 4096 is the widest bridge
 * port range real gear reports.
 */
export const MAX_BASE_PORT_ENTRIES: number = 4096;

// dot1dTpFdbStatus / dot1qTpFdbStatus value for dynamically learned MACs.
const FDB_STATUS_LEARNED: number = 3;

// ipNetToMediaType values worth keeping; other(1)/invalid(2) are skipped.
const ARP_ENTRY_TYPE_DYNAMIC: number = 3;
const ARP_ENTRY_TYPE_STATIC: number = 4;

const DECIMAL_OCTET_REGEX: RegExp = /^\d{1,3}$/;
const DOTTED_IPV4_REGEX: RegExp = /^\d{1,3}(\.\d{1,3}){3}$/;

/*
 * Formats a raw octet buffer as a colon-separated lowercase MAC address.
 * Empty and all-zero buffers (loopbacks, unset ifPhysAddress) are "no MAC".
 * Length is NOT validated here — ifPhysAddress legitimately varies (e.g.
 * 8-byte EUI-64); callers that need exactly six octets use toSixOctetMac.
 */
export function toMacAddressString(value: unknown): string | undefined {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    return undefined;
  }

  const isAllZero: boolean = value.every((byte: number) => {
    return byte === 0;
  });
  if (isAllZero) {
    return undefined;
  }

  return Array.from(value)
    .map((byte: number) => {
      return byte.toString(16).padStart(2, "0");
    })
    .join(":");
}

/*
 * Strict variant for ARP/FDB rows, where the MAC is a join key across
 * tables: anything that is not exactly six octets is a malformed row, not
 * an address.
 */
export function toSixOctetMac(value: unknown): string | undefined {
  if (!Buffer.isBuffer(value) || value.length !== 6) {
    return undefined;
  }

  return toMacAddressString(value);
}

/*
 * Decodes a table-cell value into an integer (ifIndex, bridge port, status
 * code). net-snmp usually hands these over as plain numbers, but Integer32
 * cells occasionally arrive as short buffers and some agents stringify
 * them. Undefined means "not a number" — never throws.
 */
function toCellNumber(value: unknown): number | undefined {
  if (typeof value === "number" && isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed: number = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  if (Buffer.isBuffer(value) && value.length > 0 && value.length <= 6) {
    return value.readUIntBE(0, value.length);
  }

  return undefined;
}

/*
 * Decodes six decimal row-index components (e.g. the tail of
 * "1.170.187.204.221.238.255") into a MAC string. Undefined when any
 * component is not an octet, or when all six are zero (not a real MAC).
 */
function macFromIndexParts(parts: Array<string>): string | undefined {
  if (parts.length !== 6) {
    return undefined;
  }

  const octets: Array<number> = [];
  for (const part of parts) {
    if (!DECIMAL_OCTET_REGEX.test(part)) {
      return undefined;
    }
    const octet: number = parseInt(part, 10);
    if (octet > 255) {
      return undefined;
    }
    octets.push(octet);
  }

  return toMacAddressString(Buffer.from(octets));
}

/*
 * ipNetToMediaNetAddress cells arrive as dotted strings from net-snmp
 * (IpAddress varbinds) or, from some agents, as raw 4-byte buffers.
 */
function toIpAddressString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return DOTTED_IPV4_REGEX.test(trimmed) ? trimmed : undefined;
  }

  if (Buffer.isBuffer(value) && value.length === 4) {
    return Array.from(value).join(".");
  }

  return undefined;
}

// The four trailing components of an ipNetToMediaTable row index.
function ipFromIndexParts(parts: Array<string>): string | undefined {
  if (parts.length !== 4) {
    return undefined;
  }

  for (const part of parts) {
    if (!DECIMAL_OCTET_REGEX.test(part) || parseInt(part, 10) > 255) {
      return undefined;
    }
  }

  return parts.join(".");
}

/*
 * Parses ipNetToMediaTable rows into ArpEntry values. Rows missing any of
 * the three identities (ifIndex, IP, six-octet MAC) are skipped, as are
 * rows whose ipNetToMediaType is present but neither dynamic(3) nor
 * static(4) — other(1) carries no meaning and invalid(2) rows are
 * tombstones. Capped at MAX_ARP_ENTRIES; malformed rows never throw.
 */
export function parseArpRows(rows: SnmpTableRows): Array<ArpEntry> {
  const entries: Array<ArpEntry> = [];

  for (const rowKey of Object.keys(rows)) {
    if (entries.length >= MAX_ARP_ENTRIES) {
      break;
    }

    const row: Record<string, unknown> = rows[rowKey] || {};
    const indexParts: Array<string> = rowKey.split(".");
    const hasCompositeIndex: boolean = indexParts.length >= 5;

    /*
     * Row index is "ifIndex.a.b.c.d". The same values also exist as
     * columns; prefer those and fall back to the index.
     */
    const interfaceIndex: number | undefined =
      toCellNumber(
        row[IP_NET_TO_MEDIA_COLUMNS.ipNetToMediaIfIndex.toString()],
      ) ?? (hasCompositeIndex ? toCellNumber(indexParts[0]) : undefined);

    const ipAddress: string | undefined =
      toIpAddressString(
        row[IP_NET_TO_MEDIA_COLUMNS.ipNetToMediaNetAddress.toString()],
      ) ??
      (hasCompositeIndex ? ipFromIndexParts(indexParts.slice(-4)) : undefined);

    const macAddress: string | undefined = toSixOctetMac(
      row[IP_NET_TO_MEDIA_COLUMNS.ipNetToMediaPhysAddress.toString()],
    );

    if (interfaceIndex === undefined || !ipAddress || !macAddress) {
      continue;
    }

    const rawType: number | undefined = toCellNumber(
      row[IP_NET_TO_MEDIA_COLUMNS.ipNetToMediaType.toString()],
    );

    let entryType: string | undefined = undefined;
    if (rawType === ARP_ENTRY_TYPE_DYNAMIC) {
      entryType = "dynamic";
    } else if (rawType === ARP_ENTRY_TYPE_STATIC) {
      entryType = "static";
    } else if (rawType !== undefined) {
      // other(1), invalid(2), or an unknown code — not a usable mapping.
      continue;
    }

    entries.push({
      ipAddress: ipAddress,
      macAddress: macAddress,
      interfaceIndex: interfaceIndex,
      entryType: entryType,
    });
  }

  return entries;
}

/*
 * Parses dot1qTpFdbTable rows into FdbEntry values. Only learned(3) rows
 * are kept; rows with a malformed MAC index or a non-numeric port are
 * skipped. interfaceIndex is left undefined — bridge-port translation is a
 * separate step (applyBasePortMapping). Capped at MAX_FDB_ENTRIES
 * post-filter.
 */
export function parseFdbRowsQBridge(rows: SnmpTableRows): Array<FdbEntry> {
  const entries: Array<FdbEntry> = [];

  for (const rowKey of Object.keys(rows)) {
    if (entries.length >= MAX_FDB_ENTRIES) {
      break;
    }

    const row: Record<string, unknown> = rows[rowKey] || {};
    const indexParts: Array<string> = rowKey.split(".");

    // Row index is "fdbId.m1.m2.m3.m4.m5.m6".
    if (indexParts.length < 7) {
      continue;
    }

    const macAddress: string | undefined = macFromIndexParts(
      indexParts.slice(-6),
    );
    if (!macAddress) {
      continue;
    }

    const status: number | undefined = toCellNumber(
      row[DOT1Q_TP_FDB_COLUMNS.dot1qTpFdbStatus.toString()],
    );
    if (status !== FDB_STATUS_LEARNED) {
      continue;
    }

    const bridgePort: number | undefined = toCellNumber(
      row[DOT1Q_TP_FDB_COLUMNS.dot1qTpFdbPort.toString()],
    );
    if (bridgePort === undefined) {
      continue;
    }

    /*
     * The leading index component is the VLAN's forwarding-database id.
     * It equals the VLAN id on most gear, so expose it best-effort; a
     * longer-than-expected index makes the split ambiguous, so report
     * nothing rather than a guess.
     */
    const vlanId: number | undefined =
      indexParts.length === 7 ? toCellNumber(indexParts[0]) : undefined;

    entries.push({
      macAddress: macAddress,
      bridgePort: bridgePort,
      interfaceIndex: undefined,
      vlanId: vlanId,
      status: "learned",
    });
  }

  return entries;
}

/*
 * Parses dot1dTpFdbTable rows (the BRIDGE-MIB fallback). The MAC comes
 * from the address column when present and decodes cleanly, else from the
 * 6-octet row index. Same learned-only filter and cap as the Q-BRIDGE
 * parser; vlanId is unknowable here.
 */
export function parseFdbRowsDot1d(rows: SnmpTableRows): Array<FdbEntry> {
  const entries: Array<FdbEntry> = [];

  for (const rowKey of Object.keys(rows)) {
    if (entries.length >= MAX_FDB_ENTRIES) {
      break;
    }

    const row: Record<string, unknown> = rows[rowKey] || {};

    const macAddress: string | undefined =
      toSixOctetMac(row[DOT1D_TP_FDB_COLUMNS.dot1dTpFdbAddress.toString()]) ??
      macFromIndexParts(rowKey.split("."));
    if (!macAddress) {
      continue;
    }

    const status: number | undefined = toCellNumber(
      row[DOT1D_TP_FDB_COLUMNS.dot1dTpFdbStatus.toString()],
    );
    if (status !== FDB_STATUS_LEARNED) {
      continue;
    }

    const bridgePort: number | undefined = toCellNumber(
      row[DOT1D_TP_FDB_COLUMNS.dot1dTpFdbPort.toString()],
    );
    if (bridgePort === undefined) {
      continue;
    }

    entries.push({
      macAddress: macAddress,
      bridgePort: bridgePort,
      interfaceIndex: undefined,
      vlanId: undefined,
      status: "learned",
    });
  }

  return entries;
}

/*
 * Parses dot1dBasePortTable rows (index = bridge port, column 2 = the
 * ifIndex that port corresponds to) into a bridgePort -> ifIndex map.
 * Non-numeric rows are skipped. Capped at MAX_BASE_PORT_ENTRIES.
 */
export function parseBasePortMap(rows: SnmpTableRows): Map<number, number> {
  const basePortToIfIndex: Map<number, number> = new Map<number, number>();

  for (const rowKey of Object.keys(rows)) {
    if (basePortToIfIndex.size >= MAX_BASE_PORT_ENTRIES) {
      break;
    }

    const row: Record<string, unknown> = rows[rowKey] || {};

    const bridgePort: number | undefined = toCellNumber(rowKey);
    const interfaceIndex: number | undefined = toCellNumber(
      row[DOT1D_BASE_PORT_COLUMNS.dot1dBasePortIfIndex.toString()],
    );

    if (bridgePort === undefined || interfaceIndex === undefined) {
      continue;
    }

    basePortToIfIndex.set(bridgePort, interfaceIndex);
  }

  return basePortToIfIndex;
}

/*
 * Translates each FDB entry's bridgePort to an interfaceIndex where a
 * base-port mapping row exists. Bridge ports and ifIndexes are DIFFERENT
 * number spaces, so entries without a mapping keep interfaceIndex
 * undefined — inventing one from the bridge port number would attach
 * endpoints to the wrong interface. Returns new entries; never mutates.
 */
export function applyBasePortMapping(
  entries: Array<FdbEntry>,
  basePortToIfIndex: Map<number, number>,
): Array<FdbEntry> {
  return entries.map((entry: FdbEntry) => {
    const mappedIfIndex: number | undefined = basePortToIfIndex.get(
      entry.bridgePort,
    );

    return {
      ...entry,
      interfaceIndex:
        mappedIfIndex !== undefined ? mappedIfIndex : entry.interfaceIndex,
    };
  });
}
