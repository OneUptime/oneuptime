import IP from "../../Types/IP/IP";
import { JSONObject } from "../../Types/JSON";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../SecurityCase/SecurityConnectionMatch";
import {
  ScrubbedAddress,
  ScrubbedAddressKind,
  readScrubbedAddress,
  readScrubbedValue,
} from "./ScrubbedAddress";

/*
 * WHICH ADDRESS A REQUEST CAME FROM, AND WHETHER ITS SENDER COULD HAVE
 * WRITTEN IT (#10416).
 *
 * A request names two kinds of address. The connection's own (the peer:
 * network.peer.address, net.sock.peer.addr, net.peer.ip) is the address the
 * TCP handshake came from, which nobody can write into a request. The
 * client's, as OpenTelemetry's HTTP conventions fill client.address and
 * http.client_ip, comes from the Forwarded or X-Forwarded-For header when a
 * request carries one, and instrumentations take its leftmost value: the
 * one whoever sent the request wrote. Blaming that address lets an attacker
 * choose who a case says to block.
 *
 * So an address is VERIFIED only when the sender could not have written it:
 *
 *   - peer           it is the connection's own address, and the connection
 *                    did not come through a proxy the project trusts;
 *   - trusted-proxy  the connection came through a trusted proxy, and it is
 *                    the rightmost address of the recorded X-Forwarded-For
 *                    (http.request.header.x-forwarded-for) that is no
 *                    trusted proxy: every proxy appends the address it took
 *                    the connection from, so everything right of it was
 *                    written by a proxy the project trusts.
 *
 * Every other address a request names is CLAIMED: kept on the event, with
 * where it was read, never its principalIp - so no rule groups by it, no
 * threat feed matches it, no campaign or risk score adds it up, and the
 * Response Plan never offers to block it.
 *
 * The trusted proxies are the addresses that are nobody's on the internet
 * (getSecurityAddressScope: private, loopback, link-local - a load
 * balancer, an ingress, a sidecar), and the project's own Trusted Proxies
 * (Security Events > Connections, under More settings): its CDN's or its
 * load balancer's public ranges.
 *
 * What a scrub rule left of an address (Utils/SecurityEvent/ScrubbedAddress)
 * is read in its place, and decides alike: a hidden peer with nothing
 * forwarded is the client, hidden (the #10397 marker, which the address
 * vault reads, #10395); a hidden entry of the recorded X-Forwarded-For,
 * reached from the right through trusted proxies, is the client, hidden.
 * A hidden peer of a request that carried a forwarded address is never the
 * client: OneUptime cannot tell whether it is a proxy, so nothing is
 * verified rather than a proxy blamed. The address vault resolves only the
 * verified address, never a claimed one: the claim is kept under its own
 * attribute (claimedClientAddress), which no lookup reads.
 *
 * Pure, and read in the browser too (Check a log line): every reading is an
 * indexOf or a slice over a bounded text - a header is whatever the sender
 * wrote.
 */

export enum ClientAddressTrust {
  // The connection's own address, which no request can write.
  Peer = "peer",
  // Forwarded by a proxy the project trusts.
  TrustedProxy = "trusted-proxy",
  // Written in the request, and not verified: the event names no address.
  Claimed = "claimed",
}

export const CLIENT_ADDRESS_TRUSTS: ReadonlyArray<ClientAddressTrust> =
  Object.values(ClientAddressTrust);

export function isClientAddressTrust(
  value: unknown,
): value is ClientAddressTrust {
  return (
    typeof value === "string" &&
    (CLIENT_ADDRESS_TRUSTS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * Where a request's addresses are recorded, newest OpenTelemetry convention
 * first: a span's attributes, and the attributes of a log line written
 * inside a request.
 */
export const CLIENT_ADDRESS_ATTRIBUTE_KEYS: {
  peer: ReadonlyArray<string>;
  forwardedClient: ReadonlyArray<string>;
  forwardedFor: ReadonlyArray<string>;
  forwarded: ReadonlyArray<string>;
} = {
  peer: ["network.peer.address", "net.sock.peer.addr", "net.peer.ip"],
  forwardedClient: ["client.address", "http.client_ip"],
  /*
   * A header an app records (OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_*):
   * the newer conventions keep its dashes, the older (before 1.20) wrote
   * them as underscores.
   */
  forwardedFor: [
    "http.request.header.x-forwarded-for",
    "http.request.header.x_forwarded_for",
  ],
  forwarded: ["http.request.header.forwarded"],
};

// Every attribute a request's addresses are read from, for a scan's SELECT.
export const CLIENT_ADDRESS_ATTRIBUTES_READ: ReadonlyArray<string> = [
  ...CLIENT_ADDRESS_ATTRIBUTE_KEYS.peer,
  ...CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwardedClient,
  ...CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwardedFor,
  ...CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwarded,
];

// How a claim names the header it was read from.
export const CLAIMED_FROM_X_FORWARDED_FOR: string = "x-forwarded-for";
export const CLAIMED_FROM_FORWARDED: string = "forwarded";

// The longest address a value is read as, with its brackets, port and IPv4-mapped prefix.
const MAX_ADDRESS_TEXT_LENGTH: number = 64;

/*
 * How much of a forwarding header is read: its last 4096 characters, from
 * a comma. A real one names a handful of hops, and its right end is the
 * part proxies wrote, so a sender who pads the left cannot push the hops
 * that verify the client out of reach - nor make a scan read a megabyte of
 * commas.
 */
export const MAX_FORWARDED_HEADER_LENGTH: number = 4096;

// The longest recorded header read at all: anything longer is no header.
export const MAX_FORWARDED_RECORDED_LENGTH: number = 64 * 1024;

// The most addresses and ranges a project's Trusted Proxies hold.
export const MAX_TRUSTED_PROXIES: number = 500;

// The longest Trusted Proxies text saved: each entry is at most 100 characters.
export const MAX_TRUSTED_PROXIES_TEXT_LENGTH: number = 64 * 1024;

const IPV4_MAPPED_PREFIX: string = "::ffff:";

/*
 * ---------------------------------------------------------------------------
 * The proxies a project trusts
 * ---------------------------------------------------------------------------
 */

export interface TrustedProxies {
  // The project's own Trusted Proxies: addresses and ranges.
  blocks: ReadonlyArray<NetworkAddressBlock>;
}

// Only what every project trusts: addresses that are nobody's on the internet.
export const NO_TRUSTED_PROXIES: TrustedProxies = { blocks: [] };

export interface TrustedProxyList {
  blocks: Array<NetworkAddressBlock>;
  // What was neither an address nor a range, as written.
  invalid: Array<string>;
}

/*
 * A project's Trusted Proxies as typed: one address or range a line, or
 * several on a line apart by commas or spaces. Each kept once.
 */
export function readTrustedProxyList(
  text: string | undefined | null,
): TrustedProxyList {
  const list: TrustedProxyList = { blocks: [], invalid: [] };
  const value: string = (text || "").slice(0, MAX_TRUSTED_PROXIES_TEXT_LENGTH);
  const seen: Set<string> = new Set<string>();
  let entry: string = "";

  const flush: () => void = (): void => {
    const written: string = entry.trim();
    entry = "";

    if (!written) {
      return;
    }

    const block: NetworkAddressBlock | null =
      NetworkAddressBlockUtil.parse(written);

    if (!block) {
      list.invalid.push(written);
      return;
    }

    if (!seen.has(block.text)) {
      seen.add(block.text);
      list.blocks.push(block);
    }
  };

  for (const character of value) {
    if (
      character === "\n" ||
      character === "\r" ||
      character === "," ||
      character === ";" ||
      character === " " ||
      character === "\t"
    ) {
      flush();
    } else {
      entry += character;
    }
  }

  flush();

  return list;
}

/*
 * What is wrong with a Trusted Proxies text, in a sentence, or null when
 * nothing is: the server refuses to save it, and the form says it first.
 */
export function getTrustedProxyListError(
  text: string | undefined | null,
): string | null {
  if ((text || "").length > MAX_TRUSTED_PROXIES_TEXT_LENGTH) {
    return "Trusted Proxies is too long. Use ranges, such as 203.0.113.0/24, for a block of addresses.";
  }

  const list: TrustedProxyList = readTrustedProxyList(text);

  if (list.invalid.length > 0) {
    const first: string = list.invalid[0]!;

    return `"${first.length > 60 ? `${first.slice(0, 59)}…` : first}" is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.`;
  }

  if (list.blocks.length > MAX_TRUSTED_PROXIES) {
    return `Trusted Proxies can hold ${MAX_TRUSTED_PROXIES} addresses and ranges. Use ranges, such as 203.0.113.0/24, for a block of addresses.`;
  }

  return null;
}

export function toTrustedProxies(
  text: string | undefined | null,
): TrustedProxies {
  return {
    blocks: readTrustedProxyList(text).blocks.slice(0, MAX_TRUSTED_PROXIES),
  };
}

/*
 * Whether an address is a proxy the project trusts to say who its client
 * was: an address that is nobody's on the internet, or one of its Trusted
 * Proxies.
 */
export function isTrustedProxy(
  address: string,
  proxies: TrustedProxies | undefined,
): boolean {
  const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

  if (!scope) {
    return false;
  }

  if (scope !== SecurityAddressScope.Public) {
    return true;
  }

  return (proxies?.blocks || []).some((block: NetworkAddressBlock): boolean => {
    return NetworkAddressBlockUtil.contains(block, address);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Reading an address
 * ---------------------------------------------------------------------------
 */

// One address as a record holds it: the address, or what a scrub rule left of one.
export interface AddressSlot {
  // As written, without its port or brackets; '' when a scrub rule hid it.
  address: string;
  scrubbed: ScrubbedAddress | null;
}

function isDigits(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function withoutQuotes(text: string): string {
  const value: string = text.trim();

  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).trim()
    : value;
}

/*
 * An address as a header or an attribute writes it - "203.0.113.7",
 * "203.0.113.7:51234", "[2001:db8::7]:443", "::ffff:203.0.113.7" - as the
 * address alone, an IPv4 address written as IPv6 read as the IPv4 one.
 * '' for anything else: a name, "unknown", RFC 7239's "_hidden".
 */
export function readAddressText(value: string | undefined | null): string {
  let text: string = withoutQuotes(value || "");

  if (!text || text.length > MAX_ADDRESS_TEXT_LENGTH) {
    return "";
  }

  if (text.startsWith("[")) {
    const close: number = text.indexOf("]");

    if (close === -1) {
      return "";
    }

    const after: string = text.slice(close + 1);

    if (after && !(after.startsWith(":") && isDigits(after.slice(1)))) {
      return "";
    }

    text = text.slice(1, close);
  } else {
    const colon: number = text.indexOf(":");

    // One colon is an IPv4 address and its port; more is IPv6.
    if (colon !== -1 && text.indexOf(":", colon + 1) === -1) {
      const port: string = text.slice(colon + 1);

      if (!isDigits(port) || port.length > 5) {
        return "";
      }

      text = text.slice(0, colon);
    }
  }

  if (text.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped: string = text.slice(IPV4_MAPPED_PREFIX.length);

    if (mapped.indexOf(":") === -1 && IP.isIP(mapped)) {
      text = mapped;
    }
  }

  return IP.isIP(text) ? text : "";
}

// An address, what a scrub rule left of one, or null for a value that is neither.
export function readAddressSlot(
  value: string | undefined | null,
): AddressSlot | null {
  const address: string = readAddressText(value);

  if (address) {
    return { address, scrubbed: null };
  }

  const scrubbed: ScrubbedAddress | null = readScrubbedAddress(
    withoutQuotes(value || ""),
  );

  return scrubbed ? { address: "", scrubbed } : null;
}

/*
 * Whether two slots name the same address: the same address however it is
 * written, or the same thing a scrub rule left - a Hash rule's token is one
 * per address in a project, so two equal tokens are one address. Two
 * "[REDACTED]" may be two addresses; read as one, since nothing tells them
 * apart.
 */
export function isSameAddressSlot(
  first: AddressSlot | null,
  second: AddressSlot | null,
): boolean {
  if (!first || !second) {
    return false;
  }

  if (first.address && second.address) {
    return (
      canonicalAddress(first.address) !== null &&
      canonicalAddress(first.address) === canonicalAddress(second.address)
    );
  }

  if (first.scrubbed && second.scrubbed) {
    return first.scrubbed.value === second.scrubbed.value;
  }

  return false;
}

// A slot as the event keeps it: the address, or what the scrub rule left.
export function getAddressSlotText(slot: AddressSlot): string {
  return slot.address || slot.scrubbed?.value || "";
}

/*
 * A forwarding header's text as recorded: as sent, or the JSON text of the
 * list OpenTelemetry records a header as (["203.0.113.7, 10.0.0.5"]), its
 * values joined in order. '' for one past MAX_FORWARDED_RECORDED_LENGTH.
 */
export function readForwardingHeaderText(
  value: string | undefined | null,
): string {
  const text: string = (value || "").trim();

  if (!text || text.length > MAX_FORWARDED_RECORDED_LENGTH) {
    return "";
  }

  if (text.startsWith("[") && text.endsWith("]") && text.indexOf('"') !== -1) {
    let parsed: unknown = null;

    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: unknown): boolean => {
          return typeof item === "string" && Boolean(item.trim());
        })
        .map((item: unknown): string => {
          return String(item).trim();
        })
        .join(", ");
    }
  }

  return text;
}

// A forwarding header's hops, and whether its left end was cut off to read it.
export interface ForwardingHops {
  hops: Array<AddressSlot | null>;
  isCut: boolean;
}

/*
 * A header's hops, read by `readHop`: its last MAX_FORWARDED_HEADER_LENGTH
 * characters, from the first comma in them. A header with no comma there is
 * one hop no address fits in.
 */
function readHops(
  value: string | undefined | null,
  readHop: (hop: string) => AddressSlot | null,
): ForwardingHops {
  let text: string = readForwardingHeaderText(value);
  let isCut: boolean = false;

  if (!text) {
    return { hops: [], isCut };
  }

  if (text.length > MAX_FORWARDED_HEADER_LENGTH) {
    const comma: number = text.indexOf(
      ",",
      text.length - MAX_FORWARDED_HEADER_LENGTH,
    );

    if (comma === -1) {
      return { hops: [null], isCut: true };
    }

    text = text.slice(comma + 1);
    isCut = true;
  }

  return { hops: text.split(",").map(readHop), isCut };
}

/*
 * The hops of an X-Forwarded-For, left - what the sender wrote - to right -
 * what the last proxy appended: each an address, what a scrub rule left of
 * one, or null for a hop that names neither ("unknown", a name, nothing
 * between two commas). Kept in place, never dropped: hops are counted from
 * the right, and dropping one the sender wrote would move the sender's next
 * one into a proxy's place.
 */
export function readForwardedForHops(
  value: string | undefined | null,
): ForwardingHops {
  return readHops(value, readAddressSlot);
}

export function readForwardedFor(
  value: string | undefined | null,
): Array<AddressSlot | null> {
  return readForwardedForHops(value).hops;
}

// One element's for= - a token or a quoted string - as an address, or null.
function readForwardedElement(element: string): AddressSlot | null {
  for (const pair of element.split(";")) {
    const equals: number = pair.indexOf("=");

    if (equals === -1) {
      continue;
    }

    if (pair.slice(0, equals).trim().toLowerCase() === "for") {
      return readAddressSlot(pair.slice(equals + 1));
    }
  }

  return null;
}

/*
 * The hops of a Forwarded header (RFC 7239), left to right: each element's
 * for= - a token or a quoted string, an IPv6 address bracketed - as an
 * address, what a scrub rule left of one, or null ("unknown", "_hidden", an
 * element with no for=).
 */
export function readForwardedHops(
  value: string | undefined | null,
): ForwardingHops {
  return readHops(value, readForwardedElement);
}

export function readForwarded(
  value: string | undefined | null,
): Array<AddressSlot | null> {
  return readForwardedHops(value).hops;
}

/*
 * ---------------------------------------------------------------------------
 * Deciding
 * ---------------------------------------------------------------------------
 */

// What a request records of where it came from, each as recorded ('' when it does not).
export interface ClientAddressEvidence {
  // The connection's own address.
  peer?: string | undefined;
  /*
   * The client's address as the instrumentation reported it - from a
   * forwarding header when the request carried one - and where it was read.
   */
  forwardedClient?: string | undefined;
  forwardedClientFrom?: string | undefined;
  // The X-Forwarded-For header, as the app recorded it.
  forwardedFor?: string | undefined;
  // The Forwarded header, as the app recorded it.
  forwarded?: string | undefined;
}

export interface ClientAddressReading {
  // The verified client address; '' when none is.
  address: string;
  // What a scrub rule left of the verified address, when it hid it.
  scrubbed: ScrubbedAddress | null;
  /*
   * How the verified address was known; Claimed when nothing is verified
   * and the request claimed an address; null when it names none.
   */
  trust: ClientAddressTrust | null;
  // An address the request claimed that is not the verified one, and where it was read.
  claimed: AddressSlot | null;
  claimedFrom: string;
}

export const NO_CLIENT_ADDRESS: ClientAddressReading = {
  address: "",
  scrubbed: null,
  trust: null,
  claimed: null,
  claimedFrom: "",
};

function firstSlot(
  hops: ReadonlyArray<AddressSlot | null>,
): AddressSlot | null {
  for (const hop of hops) {
    if (hop) {
      return hop;
    }
  }

  return null;
}

/*
 * The verified address of a connection that came through a trusted proxy:
 * the first hop of the recorded X-Forwarded-For, read from the right, that
 * is no trusted proxy. A hop a scrub rule hid cannot be checked, and is the
 * client (the trusted proxy right of it wrote it). A hop that names no
 * address ends the walk with none. Every hop trusted: the leftmost is the
 * client, a host inside the network.
 */
function readThroughTrustedProxies(
  hops: ReadonlyArray<AddressSlot | null>,
  proxies: TrustedProxies | undefined,
): AddressSlot | null {
  for (let index: number = hops.length - 1; index >= 0; index--) {
    const hop: AddressSlot | null = hops[index] || null;

    if (!hop) {
      return null;
    }

    if (hop.scrubbed || !isTrustedProxy(hop.address, proxies)) {
      return hop;
    }
  }

  return hops[0] || null;
}

/*
 * Which address a request came from, and how it is known (see the top of
 * this file):
 *
 *   - a peer that is no trusted proxy is the client;
 *   - a connection through a trusted proxy is the client the recorded
 *     X-Forwarded-For names, read from the right;
 *   - a peer, trusted proxy or hidden, of a request that forwarded nothing
 *     is the client (a host inside the network, a hidden public one);
 *   - anything else verifies nothing.
 *
 * The request's own claim - client.address as instrumentation reported it,
 * else X-Forwarded-For's leftmost hop, else Forwarded's first - is kept when
 * it is not the verified address.
 */
export function resolveClientAddress(
  evidence: ClientAddressEvidence,
  proxies?: TrustedProxies | undefined,
): ClientAddressReading {
  const peer: AddressSlot | null = readAddressSlot(evidence.peer);
  const forwardedClient: AddressSlot | null = readAddressSlot(
    evidence.forwardedClient,
  );
  const forwardedForHops: ForwardingHops = readForwardedForHops(
    evidence.forwardedFor,
  );
  const forwardedHops: ForwardingHops = readForwardedHops(evidence.forwarded);
  const forwardedFor: Array<AddressSlot | null> = forwardedForHops.hops;
  const forwarded: Array<AddressSlot | null> = forwardedHops.hops;

  const forwardedSomething: boolean =
    (forwardedClient !== null && !isSameAddressSlot(forwardedClient, peer)) ||
    forwardedFor.length > 0 ||
    forwarded.length > 0;

  let verified: AddressSlot | null = null;
  let trust: ClientAddressTrust | null = null;

  if (peer && peer.address && !isTrustedProxy(peer.address, proxies)) {
    verified = peer;
    trust = ClientAddressTrust.Peer;
  } else if (peer && peer.address && forwardedFor.length > 0) {
    verified = readThroughTrustedProxies(forwardedFor, proxies);
    trust = verified ? ClientAddressTrust.TrustedProxy : null;
  } else if (peer && !forwardedSomething) {
    verified = peer;
    trust = ClientAddressTrust.Peer;
  }

  let claimed: AddressSlot | null = null;
  let claimedFrom: string = "";

  // A header cut to be read lost its left end: what the sender wrote first.
  if (forwardedClient) {
    claimed = forwardedClient;
    claimedFrom = evidence.forwardedClientFrom || "";
  } else if (!forwardedForHops.isCut && firstSlot(forwardedFor)) {
    claimed = firstSlot(forwardedFor);
    claimedFrom = CLAIMED_FROM_X_FORWARDED_FOR;
  } else if (!forwardedHops.isCut && firstSlot(forwarded)) {
    claimed = firstSlot(forwarded);
    claimedFrom = CLAIMED_FROM_FORWARDED;
  }

  if (claimed && isSameAddressSlot(claimed, verified)) {
    claimed = null;
    claimedFrom = "";
  }

  if (!verified) {
    return {
      address: "",
      scrubbed: null,
      trust: claimed ? ClientAddressTrust.Claimed : null,
      claimed,
      claimedFrom: claimed ? claimedFrom : "",
    };
  }

  return {
    address: verified.address,
    scrubbed: verified.address ? null : verified.scrubbed,
    trust,
    claimed,
    claimedFrom: claimed ? claimedFrom : "",
  };
}

// The first non-empty text of a record's attributes among `keys`.
function readFirstAttribute(
  attributes: Record<string, unknown> | JSONObject,
  keys: ReadonlyArray<string>,
): { value: string; key: string } {
  for (const key of keys) {
    const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
      ? (attributes as Record<string, unknown>)[key]
      : undefined;

    if (typeof value === "string" && value.trim()) {
      return { value: value.trim(), key };
    }

    if (Array.isArray(value)) {
      const joined: string = value
        .filter((item: unknown): boolean => {
          return typeof item === "string" && Boolean(item.trim());
        })
        .join(", ");

      if (joined) {
        return { value: joined, key };
      }
    }
  }

  return { value: "", key: "" };
}

/*
 * What a span's attributes, or a log line's written inside a request,
 * record of where the request came from (CLIENT_ADDRESS_ATTRIBUTE_KEYS).
 * `peerKeys` adds names a source uses for the connection's address
 * (source.address on a log line).
 */
export function readClientAddressEvidence(
  attributes: Record<string, unknown> | JSONObject | undefined | null,
  options?: { extraPeerKeys?: ReadonlyArray<string> | undefined } | undefined,
): ClientAddressEvidence {
  const record: Record<string, unknown> = (attributes || {}) as Record<
    string,
    unknown
  >;
  const forwardedClient: { value: string; key: string } = readFirstAttribute(
    record,
    CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwardedClient,
  );

  return {
    peer: readFirstAttribute(record, [
      ...CLIENT_ADDRESS_ATTRIBUTE_KEYS.peer,
      ...(options?.extraPeerKeys || []),
    ]).value,
    forwardedClient: forwardedClient.value,
    forwardedClientFrom: forwardedClient.key,
    forwardedFor: readFirstAttribute(
      record,
      CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwardedFor,
    ).value,
    forwarded: readFirstAttribute(
      record,
      CLIENT_ADDRESS_ATTRIBUTE_KEYS.forwarded,
    ).value,
  };
}

/*
 * ---------------------------------------------------------------------------
 * On the event
 * ---------------------------------------------------------------------------
 */

// The attributes the trust is said by, cleared together.
const TRUST_ATTRIBUTES: ReadonlyArray<string> = [
  SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust,
  SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress,
  SECURITY_REQUEST_ATTRIBUTES.claimedClientAddressFrom,
];

export const CLIENT_ADDRESS_TRUST_ATTRIBUTES: ReadonlyArray<string> =
  TRUST_ATTRIBUTES;

/*
 * How the event's client address was known, and the address the request
 * claimed beside it: as request attributes, beside the verified address
 * (SECURITY_REQUEST_ATTRIBUTES.clientAddress), which the caller writes.
 */
export function markClientAddressTrust(
  attributes: JSONObject,
  reading: ClientAddressReading,
): void {
  if (reading.trust) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust] = reading.trust;
  }

  if (reading.claimed) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress] =
      getAddressSlotText(reading.claimed);

    if (reading.claimedFrom) {
      attributes[SECURITY_REQUEST_ATTRIBUTES.claimedClientAddressFrom] =
        reading.claimedFrom;
    }
  }
}

export function clearClientAddressTrust(attributes: JSONObject): void {
  for (const key of TRUST_ATTRIBUTES) {
    delete attributes[key];
  }
}

function readAttribute(attributes: unknown, key: string): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
    ? (attributes as Record<string, unknown>)[key]
    : undefined;

  return typeof value === "string" ? value.trim() : "";
}

// How an event's client address was known, as it says, or null.
export function readClientAddressTrust(event: {
  attributes?: unknown;
}): ClientAddressTrust | null {
  const trust: string = readAttribute(
    event.attributes,
    SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust,
  );

  return isClientAddressTrust(trust) ? trust : null;
}

// An address a request claimed, as an event says it.
export interface ClaimedClientAddress {
  // The address; '' when a scrub rule hid it.
  address: string;
  // What a scrub rule left of it, when it hid it.
  scrubbedKind: ScrubbedAddressKind | null;
  // Where it was read: client.address, http.client_ip, x-forwarded-for, forwarded.
  from: string;
  // Whether it is all the event has: no address of the event is verified.
  isOnlyAddress: boolean;
}

/*
 * The address an event's request claimed, or null when it claimed none
 * beside the one the event names. What the pages read, so an event says
 * "Claimed by the request, not verified" wherever it shows it.
 */
export function readClaimedClientAddress(event: {
  principalIp?: string | undefined;
  attributes?: unknown;
}): ClaimedClientAddress | null {
  const value: string = readAttribute(
    event.attributes,
    SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress,
  );

  if (!value) {
    return null;
  }

  const address: string = readAddressText(value);
  const scrubbed: ScrubbedAddress | null = address
    ? null
    : readScrubbedValue(value);

  if (!address && !scrubbed) {
    return null;
  }

  const principalIp: string = (event.principalIp || "").trim();

  if (
    address &&
    principalIp &&
    canonicalAddress(address) === canonicalAddress(principalIp)
  ) {
    return null;
  }

  return {
    address,
    scrubbedKind: scrubbed ? scrubbed.kind : null,
    from: readAttribute(
      event.attributes,
      SECURITY_REQUEST_ATTRIBUTES.claimedClientAddressFrom,
    ),
    isOnlyAddress:
      !principalIp &&
      readClientAddressTrust(event) === ClientAddressTrust.Claimed,
  };
}

/*
 * Whether an address the address vault resolved (#10395) may be named as
 * the event's client: only the verified address's token is ever resolved,
 * and a verified address that turns out to be a trusted proxy - a Hash
 * rule hid a CDN's edge - says only that the request came through it. The
 * vault calls this before it writes principalIp.
 */
export function canNameResolvedClientAddress(data: {
  attributes: unknown;
  address: string;
  proxies: TrustedProxies | undefined;
}): boolean {
  const trust: ClientAddressTrust | null = readClientAddressTrust({
    attributes: data.attributes,
  });

  if (trust === ClientAddressTrust.Claimed) {
    return false;
  }

  if (!readAddressText(data.address)) {
    return false;
  }

  // A peer of a request that forwarded nothing is the client, whatever it is.
  if (
    trust === ClientAddressTrust.Peer &&
    !readAttribute(
      data.attributes,
      SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress,
    )
  ) {
    return true;
  }

  return !isTrustedProxy(readAddressText(data.address), data.proxies);
}
