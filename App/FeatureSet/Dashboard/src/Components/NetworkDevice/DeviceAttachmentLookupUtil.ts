import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import DeviceReachabilityUtil from "Common/Utils/NetworkDevice/DeviceReachabilityUtil";
import { normalizeMac } from "Common/Utils/Monitor/EndpointAttachmentUtil";

/*
 * Finds the switch port a device is plugged into, for the "Connected to"
 * card on the device Overview.
 *
 * The map already knows: NetworkTopologyUtil's endpoint adoption pass
 * recognises a managed device among the endpoints the walked switches and
 * routers learned (forwarding tables, ARP) and draws the cable from it.
 * This util answers the same question for ONE device, from the browser,
 * and it has to give the same answer the map gives - a card that names a
 * different switch than the cable on the map would be worse than no card.
 * So the matching below is the builder's rules restated, not a new set:
 *
 *  - by MAC when the endpoint's MAC is the device's declared MAC, in any
 *    spelling;
 *  - else by IP when the endpoint's ARP-bound address is the device's
 *    hostname AS AN IPv4 LITERAL, and both sides are at the same site
 *    (no site on either side counts as the same site, so a project that
 *    never set sites up still matches);
 *  - among the matches, the most recently seen one is the cable; at equal
 *    freshness a MAC match beats an address match, and the lowest MAC
 *    settles the rest, so the answer never depends on query order.
 *
 * A plain .ts module rather than part of the card for the reason
 * DeviceMonitorLookupUtil is: App/tsconfig excludes the Dashboard's .tsx,
 * so this is what App/Tests can import and pin.
 */

/** What the card renders: the switch end of the cable, and the evidence. */
export interface DeviceAttachment {
  endpointId: string;
  /** The endpoint's MAC as the switch learned it, normalised. */
  macAddress: string;
  ipAddress?: string | undefined;
  matchedBy: "mac" | "ip";
  switchDeviceId?: string | undefined;
  switchName?: string | undefined;
  portName?: string | undefined;
  interfaceIndex?: number | undefined;
  vlanId?: number | undefined;
  lastSeenAt?: Date | undefined;
}

/** The three device columns the match keys come from, plus its own id. */
export interface AttachmentDeviceInput {
  /*
   * The device's own id, so a row learned from the device's OWN tables - a
   * router that lists its own address in ARP - is recognised as a sighting
   * of itself rather than a cable to itself. The builder adopts such a row
   * and draws nothing; this returns nothing for it too.
   */
  id?: string | undefined;
  hostname?: string | undefined;
  siteId?: string | undefined;
  macAddress?: string | undefined;
}

/** One learned endpoint, as the card's query returns it. */
export interface AttachmentEndpointRow {
  _id?: string | undefined;
  macAddress?: string | undefined;
  ipAddress?: string | undefined;
  siteId?: string | undefined;
  attachedNetworkDeviceId?: string | undefined;
  attachedNetworkDevice?:
    | { _id?: string | undefined; name?: string | undefined }
    | undefined;
  attachedPortName?: string | undefined;
  attachedInterfaceIndex?: number | undefined;
  vlanId?: number | undefined;
  lastSeenAt?: Date | undefined;
}

export interface DeviceAttachmentLookupResult {
  device: NetworkDevice;
  attachment: DeviceAttachment | undefined;
  /*
   * False when the device has neither a MAC nor an IPv4 hostname: there is
   * nothing any switch could have learned it by, and the card says so
   * instead of reporting a search that could never have found anything.
   */
  isLookupPossible: boolean;
}

interface AttachmentCandidate {
  row: AttachmentEndpointRow;
  macAddress: string;
  matchedByMac: boolean;
}

/*
 * A page of endpoints per key. A MAC is unique per project among endpoints
 * so that query returns at most one row; the address query is unscoped by
 * site server-side (the "same site or both none" rule cannot be expressed
 * as a filter), so every branch's 10.0.0.5 comes back and the site rule is
 * applied here. Fifty is far more than any fleet has sites.
 */
const ENDPOINT_PAGE_SIZE: number = 50;

/*
 * Hoisted so the literal is not the object of a member expression, which
 * `wrap-regex` and Prettier cannot agree on.
 */
const IPV4_PATTERN: RegExp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/*
 * Strictly a v4 literal, octet bounds included - the same test the builder
 * applies before it treats a hostname as an address. A DNS name is not an
 * address a router's ARP table could have bound a MAC to.
 */
function isIpv4Address(value: string | undefined): boolean {
  if (!value || !IPV4_PATTERN.test(value)) {
    return false;
  }

  return value.split(".").every((octet: string): boolean => {
    return parseInt(octet, 10) <= 255;
  });
}

function normalizeKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed: string = value.trim().toLowerCase();

  return trimmed.length > 0 ? trimmed : undefined;
}

/*
 * null, undefined, "" and whitespace all normalise to the same "no site"
 * key - the convention the builder (and NetworkDeviceLinkRuleUtil before
 * it) uses.
 */
function siteKey(siteId: string | undefined): string {
  return (siteId || "").trim();
}

/*
 * The device's hostname when it is usable as an ARP match key, else
 * undefined. hostname only, never `name`: a name that happens to be an IP
 * literal is an operator's label, not a claim the device answers there.
 */
function ipAddressKeyForDevice(
  device: AttachmentDeviceInput,
): string | undefined {
  const hostname: string | undefined = normalizeKey(device.hostname);

  return isIpv4Address(hostname) ? hostname : undefined;
}

/*
 * Strictly fresher: later lastSeenAt, then a MAC match over an address
 * match. Equal on both keeps the incumbent, which - because candidates are
 * visited in MAC order - is the lower MAC.
 */
function isFreshSighting(row: AttachmentEndpointRow, now: Date): boolean {
  if (!row.lastSeenAt) {
    return false;
  }
  const ageMs: number = now.getTime() - new Date(row.lastSeenAt).getTime();
  return ageMs <= ADDRESS_MATCH_FRESH_WINDOW_MS;
}

function isFresherSighting(
  candidate: AttachmentCandidate,
  incumbent: AttachmentCandidate,
): boolean {
  const candidateSeen: number = candidate.row.lastSeenAt
    ? new Date(candidate.row.lastSeenAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const incumbentSeen: number = incumbent.row.lastSeenAt
    ? new Date(incumbent.row.lastSeenAt).getTime()
    : Number.NEGATIVE_INFINITY;

  if (candidateSeen !== incumbentSeen) {
    return candidateSeen > incumbentSeen;
  }

  return candidate.matchedByMac && !incumbent.matchedByMac;
}

function toAttachment(candidate: AttachmentCandidate): DeviceAttachment {
  const row: AttachmentEndpointRow = candidate.row;

  return {
    endpointId: row._id || "",
    macAddress: candidate.macAddress,
    ipAddress: normalizeKey(row.ipAddress),
    matchedBy: candidate.matchedByMac ? "mac" : "ip",
    switchDeviceId:
      row.attachedNetworkDeviceId || row.attachedNetworkDevice?._id,
    switchName: row.attachedNetworkDevice?.name,
    portName: row.attachedPortName,
    interfaceIndex: row.attachedInterfaceIndex,
    vlanId: row.vlanId,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : undefined,
  };
}

/**
 * Pure: the builder's adoption rules applied to one device and the rows
 * the card fetched. Undefined when no row is this device - or when the
 * freshest one was learned from the device's own tables, which the map
 * draws nothing for either.
 */
/*
 * How long an address-matched row stays evidence. A MAC names a box for
 * good; an address is re-leased, so a row nothing has seen inside the
 * window the map ages endpoints out on is left alone - the same rule the
 * builder applies. The default interval's window, as the map uses.
 */
const ADDRESS_MATCH_FRESH_WINDOW_MS: number =
  DeviceReachabilityUtil.getStaleWindowInMinutes(undefined) * 60 * 1000;

/*
 * Which of several devices a row belongs to, by the builder's rules.
 *
 * The map resolves a row against EVERY device on it: the MAC against every
 * declared MAC, the address against every device registered at it in the
 * same site, and a key two devices claim is dropped rather than guessed
 * at. A card that judged its own device alone would say "Connected to" on
 * two devices for one cable, or on the device an address match names when
 * the row's MAC is some other device's. So the other devices that could
 * claim the same rows are handed in, and the same index is built here.
 */
function buildClaimIndex(
  devices: Array<AttachmentDeviceInput>,
): Map<string, AttachmentDeviceInput> {
  const index: Map<string, AttachmentDeviceInput> = new Map<
    string,
    AttachmentDeviceInput
  >();
  const ambiguous: Set<string> = new Set<string>();

  for (const device of devices) {
    const keys: Array<string> = [];
    const mac: string | undefined = normalizeMac(device.macAddress);
    if (mac) {
      keys.push(`mac:${mac}`);
    }
    const ip: string | undefined = ipAddressKeyForDevice(device);
    if (ip) {
      keys.push(`ip:${siteKey(device.siteId)}:${ip}`);
    }
    for (const key of keys) {
      const existing: AttachmentDeviceInput | undefined = index.get(key);
      if (existing && existing.id !== device.id) {
        ambiguous.add(key);
        continue;
      }
      index.set(key, device);
    }
  }

  for (const key of ambiguous) {
    index.delete(key);
  }

  return index;
}

export function chooseDeviceAttachment(
  device: AttachmentDeviceInput,
  rows: Array<AttachmentEndpointRow>,
  otherDevices: Array<AttachmentDeviceInput> = [],
  now: Date = new Date(),
): DeviceAttachment | undefined {
  const deviceMac: string | undefined = normalizeMac(device.macAddress);
  const deviceIp: string | undefined = ipAddressKeyForDevice(device);

  if (!deviceMac && !deviceIp) {
    return undefined;
  }

  const claimIndex: Map<string, AttachmentDeviceInput> = buildClaimIndex([
    device,
    ...otherDevices.filter((other: AttachmentDeviceInput) => {
      return other.id !== device.id;
    }),
  ]);

  const candidates: Array<AttachmentCandidate> = [];

  for (const row of rows) {
    const rowMac: string | undefined = normalizeMac(row.macAddress);
    if (!rowMac) {
      continue;
    }

    /*
     * The builder's precedence: the row's MAC first, against every device;
     * only a row no device claims by MAC is matched by address, and then
     * within the site that learned it.
     */
    const byMac: AttachmentDeviceInput | undefined = claimIndex.get(
      `mac:${rowMac}`,
    );
    let candidate: AttachmentCandidate | undefined = undefined;

    if (byMac) {
      if (byMac.id === device.id || (!device.id && byMac === device)) {
        candidate = { row, macAddress: rowMac, matchedByMac: true };
      }
    } else {
      const rowIp: string | undefined = normalizeKey(row.ipAddress);
      if (isIpv4Address(rowIp)) {
        const byIp: AttachmentDeviceInput | undefined = claimIndex.get(
          `ip:${siteKey(row.siteId)}:${rowIp}`,
        );
        if (
          byIp &&
          (byIp.id === device.id || (!device.id && byIp === device)) &&
          isFreshSighting(row, now)
        ) {
          candidate = { row, macAddress: rowMac, matchedByMac: false };
        }
      }
    }

    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  /*
   * MAC order first, so "equal on everything keeps the incumbent" below
   * comes out as "the lowest MAC wins" whatever order the two queries
   * returned the rows in.
   */
  candidates.sort((a: AttachmentCandidate, b: AttachmentCandidate): number => {
    return a.macAddress.localeCompare(b.macAddress);
  });

  let chosen: AttachmentCandidate = candidates[0]!;

  for (const candidate of candidates.slice(1)) {
    if (isFresherSighting(candidate, chosen)) {
      chosen = candidate;
    }
  }

  const attachment: DeviceAttachment = toAttachment(chosen);

  if (
    device.id &&
    attachment.switchDeviceId &&
    attachment.switchDeviceId === device.id
  ) {
    return undefined;
  }

  return attachment;
}

/*
 * The endpoint row as ModelAPI hydrates it, flattened to the strings the
 * pure half compares. Ids arrive as ObjectID instances or as plain strings
 * depending on the column, and toString() is the same on both.
 */
function toEndpointRow(endpoint: NetworkEndpoint): AttachmentEndpointRow {
  return {
    _id: endpoint._id?.toString(),
    macAddress: endpoint.macAddress,
    ipAddress: endpoint.ipAddress,
    siteId: endpoint.siteId?.toString(),
    attachedNetworkDeviceId: endpoint.attachedNetworkDeviceId?.toString(),
    attachedNetworkDevice: endpoint.attachedNetworkDevice
      ? {
          _id: endpoint.attachedNetworkDevice._id?.toString(),
          name: endpoint.attachedNetworkDevice.name,
        }
      : undefined,
    attachedPortName: endpoint.attachedPortName,
    attachedInterfaceIndex: endpoint.attachedInterfaceIndex,
    vlanId: endpoint.vlanId,
    lastSeenAt: endpoint.lastSeenAt,
  };
}

/*
 * One page of endpoints matching a single column. The two keys are two
 * queries rather than one OR because the client query language has no OR,
 * and because the MAC one is exact while the address one still has the site
 * rule to pass client-side.
 */
async function listEndpointsBy(
  query:
    | { macAddress: string }
    | { ipAddress: string }
    | { ipAddress: string; siteId: ObjectID },
): Promise<Array<NetworkEndpoint>> {
  const result: ListResult<NetworkEndpoint> =
    await ModelAPI.getList<NetworkEndpoint>({
      modelType: NetworkEndpoint,
      query: query,
      limit: ENDPOINT_PAGE_SIZE,
      skip: 0,
      select: {
        _id: true,
        macAddress: true,
        ipAddress: true,
        siteId: true,
        attachedNetworkDeviceId: true,
        attachedNetworkDevice: {
          name: true,
          _id: true,
        },
        attachedPortName: true,
        attachedInterfaceIndex: true,
        vlanId: true,
        lastSeenAt: true,
      },
      sort: {},
    });

  return result.data;
}

/**
 * The device's row, the endpoints that could be it, and the one that is.
 * Throws the way the other Overview cards' fetches do, so the card can hand
 * the failure to API.getFriendlyMessage.
 */
export async function getDeviceAttachment(
  modelId: ObjectID,
): Promise<DeviceAttachmentLookupResult> {
  const device: NetworkDevice | null = await ModelAPI.getItem<NetworkDevice>({
    modelType: NetworkDevice,
    id: modelId,
    select: {
      _id: true,
      hostname: true,
      macAddress: true,
      siteId: true,
    },
  });

  if (!device) {
    throw new BadDataException("This device no longer exists.");
  }

  const deviceInput: AttachmentDeviceInput = {
    id: modelId.toString(),
    hostname: device.hostname,
    siteId: device.siteId?.toString(),
    macAddress: device.macAddress,
  };

  const deviceMac: string | undefined = normalizeMac(deviceInput.macAddress);
  const deviceIp: string | undefined = ipAddressKeyForDevice(deviceInput);

  if (!deviceMac && !deviceIp) {
    return { device, attachment: undefined, isLookupPossible: false };
  }

  const pages: Array<Promise<Array<NetworkEndpoint>>> = [];

  if (deviceMac) {
    pages.push(listEndpointsBy({ macAddress: deviceMac }));
  }

  if (deviceIp) {
    /*
     * Scoped to the site on the server when the device has one: an
     * address is only a key inside a site, and every branch has a
     * 10.0.0.5 - a page of rows from other sites' registers would crowd
     * out this site's row. A device with no site matches rows with no
     * site, which no client query can say, so those are filtered here.
     */
    pages.push(
      listEndpointsBy(
        device.siteId
          ? { ipAddress: deviceIp, siteId: device.siteId }
          : { ipAddress: deviceIp },
      ),
    );
  }

  /*
   * Deduped by id: the row a MAC query finds is very often the row the
   * address query finds too - the same endpoint, once by each key - and
   * two copies of it would only make the tie-break work for nothing.
   */
  const rowsById: Map<string, AttachmentEndpointRow> = new Map<
    string,
    AttachmentEndpointRow
  >();

  for (const page of await Promise.all(pages)) {
    for (const endpoint of page) {
      const row: AttachmentEndpointRow = toEndpointRow(endpoint);
      const key: string = row._id || `${row.macAddress} ${row.ipAddress}`;

      if (!rowsById.has(key)) {
        rowsById.set(key, row);
      }
    }
  }

  const rows: Array<AttachmentEndpointRow> = Array.from(rowsById.values());

  return {
    device,
    attachment: chooseDeviceAttachment(
      deviceInput,
      rows,
      await listOtherClaimants(deviceInput, rows),
    ),
    isLookupPossible: true,
  };
}

/*
 * The other devices that could claim the rows in hand: one registered at
 * the same address, one declaring the same MAC, or one declaring the MAC
 * of a row this device would otherwise match by address. Read so the card
 * can refuse exactly what the map refuses.
 */
async function listOtherClaimants(
  device: AttachmentDeviceInput,
  rows: Array<AttachmentEndpointRow>,
): Promise<Array<AttachmentDeviceInput>> {
  const macs: Set<string> = new Set<string>();
  const deviceMac: string | undefined = normalizeMac(device.macAddress);
  if (deviceMac) {
    macs.add(deviceMac);
  }
  for (const row of rows) {
    const rowMac: string | undefined = normalizeMac(row.macAddress);
    if (rowMac) {
      macs.add(rowMac);
    }
  }

  const queries: Array<Promise<Array<NetworkDevice>>> = [];
  const select: {
    _id: true;
    hostname: true;
    siteId: true;
    macAddress: true;
  } = { _id: true, hostname: true, siteId: true, macAddress: true };

  if (macs.size > 0) {
    queries.push(
      ModelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: { macAddress: new Includes(Array.from(macs)) },
        limit: ENDPOINT_PAGE_SIZE,
        skip: 0,
        select: select,
        sort: {},
      }).then((result: ListResult<NetworkDevice>) => {
        return result.data;
      }),
    );
  }

  const hostname: string | undefined = normalizeKey(device.hostname);
  if (hostname) {
    queries.push(
      ModelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: { hostname: hostname },
        limit: ENDPOINT_PAGE_SIZE,
        skip: 0,
        select: select,
        sort: {},
      }).then((result: ListResult<NetworkDevice>) => {
        return result.data;
      }),
    );
  }

  const others: Map<string, AttachmentDeviceInput> = new Map<
    string,
    AttachmentDeviceInput
  >();
  for (const page of await Promise.all(queries)) {
    for (const other of page) {
      const id: string | undefined = other._id?.toString();
      if (!id || id === device.id || others.has(id)) {
        continue;
      }
      others.set(id, {
        id: id,
        hostname: other.hostname,
        siteId: other.siteId?.toString(),
        macAddress: other.macAddress,
      });
    }
  }

  return Array.from(others.values());
}
