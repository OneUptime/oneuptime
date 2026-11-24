import { JSONObject, JSONValue } from "../JSON";
import {
  SECURITY_BLOCK_LARGEST_IPV4_PREFIX,
  SECURITY_BLOCK_LARGEST_IPV6_PREFIX,
  SecurityBlockValue,
  readSecurityBlockAsn,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAttackActivity,
  SecurityAttackCampaign,
  readSecurityAttackActivity,
} from "./SecurityAttackCampaign";
import SecurityEventRequestOutcome, {
  SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER,
} from "./SecurityEventRequestOutcome";

/*
 * CAMPAIGNS BY NETWORK (#10354): a rotating attacker sends from the next
 * address of its /24, or from anywhere in its hosting provider's network,
 * so blocking it an address at a time is whack-a-mole. Group by Network on
 * the Campaigns page puts the addresses of one network on one row:
 *
 *   - by its autonomous system, where the address's events carry one -
 *     Cloudflare's firewall events carry each request's ASN (#10339);
 *     OneUptime has no ASN data of its own (RequestLocation.ts);
 *   - else by its /24 (IPv4) or /48 (IPv6): the largest range anyone may
 *     block without a Security Admin (#10338), so a network row's range is
 *     one a person may challenge.
 *
 * An ASN's row names the ranges its addresses sent from too, so the person
 * may challenge one of them rather than the whole network. Requests with no
 * address stay one row of their own, as they are by address.
 *
 * Grouped here, from the window's campaigns by address (one read, the
 * worst first, at most SECURITY_ATTACK_NETWORK_ADDRESSES_MAX of them): pure,
 * so a test pins each rule.
 */

export enum SecurityAttackCampaignGrouping {
  Address = "address",
  Network = "network",
}

export enum SecurityAttackNetworkKind {
  // An IPv4 /24 or an IPv6 /48.
  Range = "Range",
  // An autonomous system, by its number: "AS14061".
  Asn = "Asn",
}

export const SECURITY_ATTACK_NETWORK_IPV4_PREFIX: number =
  SECURITY_BLOCK_LARGEST_IPV4_PREFIX;
export const SECURITY_ATTACK_NETWORK_IPV6_PREFIX: number =
  SECURITY_BLOCK_LARGEST_IPV6_PREFIX;

// The most addresses one grouping reads, the worst first.
export const SECURITY_ATTACK_NETWORK_ADDRESSES_MAX: number = 2000;

// The most network rows the page lists.
export const SECURITY_ATTACK_NETWORKS_MAX: number = 100;

// The most addresses a network row carries, the most serious first.
export const SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT: number = 20;

// One range of a network's addresses: an ASN row's /24s and /48s.
export interface SecurityAttackNetworkRange {
  // As blocks write it: "203.0.113.0/24".
  range: string;
  addressCount: number;
  requestCount: number;
}

export interface SecurityAttackNetwork extends SecurityAttackActivity {
  /*
   * As blocks write it: "203.0.113.0/24", "2001:db8:1::/48" or "AS14061";
   * '' for the requests whose address nobody knew.
   */
  network: string;
  kind: SecurityAttackNetworkKind | "";
  // An ASN's name, as its events carry it: "DIGITALOCEAN-ASN".
  asnName?: string | undefined;
  // How many addresses sent attacks from it in the window.
  addressCount: number;
  // Its addresses, the most serious first, at most SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT.
  addresses: Array<string>;
  // The ranges its addresses sent from, the most addresses first: a range's row holds itself.
  ranges: Array<SecurityAttackNetworkRange>;
}

export interface SecurityAttackNetworksResult {
  networks: Array<SecurityAttackNetwork>;
  // The window read, as ISO dates.
  startTime: string;
  endTime: string;
  /*
   * More addresses sent attacks in the window than were grouped, or more
   * networks than the page lists.
   */
  isTruncated: boolean;
}

/*
 * The /24 (IPv4) or /48 (IPv6) an address belongs to, as blocks write a
 * range; null for anything that is no single address.
 */
export function getSecurityAttackRangeOfAddress(
  address: string | null | undefined,
): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(address || "");

  if (!read || !NetworkAddressBlockUtil.isSingleAddress(read.block)) {
    return null;
  }

  const prefix: number =
    read.block.family === 4
      ? SECURITY_ATTACK_NETWORK_IPV4_PREFIX
      : SECURITY_ATTACK_NETWORK_IPV6_PREFIX;
  const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
    `${read.value}/${prefix}`,
  );

  return block ? block.text : null;
}

/*
 * The network a campaign's address belongs to: its ASN when its events
 * carry one, else its /24 or /48; null for no address, or text that is
 * none.
 */
export function getSecurityAttackNetworkOf(
  campaign: Pick<SecurityAttackCampaign, "sourceIp" | "asn">,
): { network: string; kind: SecurityAttackNetworkKind } | null {
  if (!campaign.sourceIp) {
    return null;
  }

  const range: string | null = getSecurityAttackRangeOfAddress(
    campaign.sourceIp,
  );

  if (!range) {
    return null;
  }

  const asn: string | null = readSecurityBlockAsn(campaign.asn || "");

  return asn
    ? { network: asn, kind: SecurityAttackNetworkKind.Asn }
    : { network: range, kind: SecurityAttackNetworkKind.Range };
}

function rankOf(outcome: SecurityEventRequestOutcome | ""): number {
  return outcome
    ? SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER.indexOf(outcome) + 1
    : 0;
}

function timeOf(value: string): number {
  const time: number = value ? new Date(value).getTime() : Number.NaN;

  return Number.isFinite(time) ? time : Number.NaN;
}

function addUnique(
  into: Array<string>,
  values: ReadonlyArray<string>,
  max: number,
): void {
  for (const value of values) {
    if (into.length >= max) {
      return;
    }

    if (value && !into.includes(value)) {
      into.push(value);
    }
  }
}

// The most kinds of attack, user agents and requests a network row names, as a campaign's row does.
const KINDS_KEPT: number = 5;
const USER_AGENTS_KEPT: number = 3;
const TARGETS_KEPT: number = 3;

interface NetworkBuilder {
  network: SecurityAttackNetwork;
  ranges: Map<string, SecurityAttackNetworkRange>;
  firstSeen: number;
  lastSeen: number;
}

function newNetwork(
  network: string,
  kind: SecurityAttackNetworkKind | "",
): NetworkBuilder {
  return {
    network: {
      network,
      kind,
      addressCount: 0,
      addresses: [],
      ranges: [],
      requestCount: 0,
      rejectedCount: 0,
      reachedAppCount: 0,
      erroredCount: 0,
      reachedDatabaseCount: 0,
      worstOutcome: "",
      maxSeverityId: 0,
      attackKinds: [],
      userAgents: [],
      targetCount: 0,
      sampleTargets: [],
      firstSeen: "",
      lastSeen: "",
    },
    ranges: new Map(),
    firstSeen: Number.NaN,
    lastSeen: Number.NaN,
  };
}

/*
 * Every network row the page lists, the worst first - the furthest any of
 * its requests got, then the most requests, then the most addresses - as
 * the rows by address are ordered. Its counts are its addresses' added
 * up; how many different requests it sent is at least the most any one of
 * its addresses sent (one read by address cannot say more).
 */
export function groupSecurityAttackCampaignsByNetwork(
  campaigns: ReadonlyArray<SecurityAttackCampaign>,
): Array<SecurityAttackNetwork> {
  const builders: Map<string, NetworkBuilder> = new Map();

  for (const campaign of campaigns) {
    const of: { network: string; kind: SecurityAttackNetworkKind } | null =
      getSecurityAttackNetworkOf(campaign);
    const key: string = of ? `${of.kind}:${of.network}` : "";
    let builder: NetworkBuilder | undefined = builders.get(key);

    if (!builder) {
      builder = newNetwork(of?.network || "", of?.kind || "");
      builders.set(key, builder);
    }

    const network: SecurityAttackNetwork = builder.network;

    network.requestCount += campaign.requestCount;
    network.rejectedCount += campaign.rejectedCount;
    network.reachedAppCount += campaign.reachedAppCount;
    network.erroredCount += campaign.erroredCount;
    network.reachedDatabaseCount += campaign.reachedDatabaseCount;
    network.maxSeverityId = Math.max(
      network.maxSeverityId,
      campaign.maxSeverityId,
    );
    network.targetCount = Math.max(network.targetCount, campaign.targetCount);

    if (rankOf(campaign.worstOutcome) > rankOf(network.worstOutcome)) {
      network.worstOutcome = campaign.worstOutcome;
    }

    if (campaign.hiddenAddressCount) {
      network.hiddenAddressCount =
        (network.hiddenAddressCount || 0) + campaign.hiddenAddressCount;
    }

    addUnique(network.attackKinds, campaign.attackKinds, KINDS_KEPT);
    addUnique(network.userAgents, campaign.userAgents, USER_AGENTS_KEPT);
    addUnique(network.sampleTargets, campaign.sampleTargets, TARGETS_KEPT);

    const firstSeen: number = timeOf(campaign.firstSeen);
    const lastSeen: number = timeOf(campaign.lastSeen);

    if (
      Number.isFinite(firstSeen) &&
      !(builder.firstSeen <= firstSeen) // also when NaN
    ) {
      builder.firstSeen = firstSeen;
      network.firstSeen = campaign.firstSeen;
    }

    if (Number.isFinite(lastSeen) && !(builder.lastSeen >= lastSeen)) {
      builder.lastSeen = lastSeen;
      network.lastSeen = campaign.lastSeen;
    }

    if (!of) {
      continue;
    }

    if (of.kind === SecurityAttackNetworkKind.Asn && !network.asnName) {
      const name: string = (campaign.asnName || "").trim();

      if (name) {
        network.asnName = name;
      }
    }

    const address: string =
      readSecurityBlockValue(campaign.sourceIp)?.value || campaign.sourceIp;

    if (network.addresses.includes(address)) {
      continue;
    }

    network.addressCount++;

    if (network.addresses.length < SECURITY_ATTACK_NETWORK_ADDRESSES_KEPT) {
      network.addresses.push(address);
    }

    const range: string =
      getSecurityAttackRangeOfAddress(campaign.sourceIp) || of.network;
    const known: SecurityAttackNetworkRange | undefined =
      builder.ranges.get(range);

    if (known) {
      known.addressCount++;
      known.requestCount += campaign.requestCount;
    } else {
      builder.ranges.set(range, {
        range,
        addressCount: 1,
        requestCount: campaign.requestCount,
      });
    }
  }

  return Array.from(builders.values())
    .map((builder: NetworkBuilder): SecurityAttackNetwork => {
      return {
        ...builder.network,
        ranges: Array.from(builder.ranges.values()).sort(
          (
            a: SecurityAttackNetworkRange,
            b: SecurityAttackNetworkRange,
          ): number => {
            return (
              b.addressCount - a.addressCount ||
              b.requestCount - a.requestCount ||
              a.range.localeCompare(b.range)
            );
          },
        ),
      };
    })
    .sort((a: SecurityAttackNetwork, b: SecurityAttackNetwork): number => {
      return (
        rankOf(b.worstOutcome) - rankOf(a.worstOutcome) ||
        b.requestCount - a.requestCount ||
        b.addressCount - a.addressCount ||
        // The row of no address last among equals, then as written.
        Number(a.network === "") - Number(b.network === "") ||
        a.network.localeCompare(b.network)
      );
    });
}

/*
 * What a network row may be challenged as (#10354): its own network - an
 * ASN, or a range - then, for an ASN, each range its addresses sent from,
 * the most addresses first, for a person who would rather not reach the
 * whole of it. None for the row of no address.
 */
export function getSecurityAttackNetworkChallengeValues(
  network: Pick<SecurityAttackNetwork, "network" | "kind" | "ranges">,
): Array<string> {
  if (!network.network || !network.kind) {
    return [];
  }

  const values: Array<string> = [network.network];

  if (network.kind === SecurityAttackNetworkKind.Asn) {
    for (const range of network.ranges) {
      if (range.range && !values.includes(range.range)) {
        values.push(range.range);
      }
    }
  }

  return values;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readCount(value: JSONValue | undefined): number {
  const number: number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// A network row from the wire.
export function readSecurityAttackNetwork(
  row: JSONObject,
): SecurityAttackNetwork {
  const kind: string = readText(row["kind"]);
  const network: string = readText(row["network"]);
  const asnName: string = readText(row["asnName"]);
  const addresses: Array<string> = Array.isArray(row["addresses"])
    ? (row["addresses"] as Array<JSONValue>)
        .map((value: JSONValue): string => {
          return readText(value);
        })
        .filter(Boolean)
    : [];
  const ranges: Array<SecurityAttackNetworkRange> = [];

  for (const value of Array.isArray(row["ranges"])
    ? (row["ranges"] as Array<JSONValue>)
    : []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const range: string = readText((value as JSONObject)["range"]);

    if (range) {
      ranges.push({
        range,
        addressCount: readCount((value as JSONObject)["addressCount"]),
        requestCount: readCount((value as JSONObject)["requestCount"]),
      });
    }
  }

  return {
    ...readSecurityAttackActivity(row),
    network,
    kind:
      kind === SecurityAttackNetworkKind.Asn ||
      kind === SecurityAttackNetworkKind.Range
        ? kind
        : "",
    ...(asnName ? { asnName } : {}),
    addressCount: readCount(row["addressCount"]),
    addresses,
    ranges,
  };
}
