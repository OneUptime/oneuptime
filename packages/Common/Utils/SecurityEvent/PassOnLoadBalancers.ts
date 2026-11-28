import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  readCloudRelationships,
} from "../../Types/Cloud/CloudInventory";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../NetworkTraffic/NetworkAddressBlock";
import {
  AWS_CLASSIC_LOAD_BALANCER_TYPE,
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  GOOGLE_FRONT_END_RANGES,
  GoogleFrontEndUse,
  OwnLoadBalancerRecord,
  isAwsHttpClassicLoadBalancer,
  isGoogleCloudApplicationForwardingRule,
  readGoogleFrontEndUse,
} from "./OwnLoadBalancers";

/*
 * THE PROJECT'S LOAD BALANCERS THAT PASS ON WHAT A CLIENT WROTE (#11389).
 *
 * A load balancer that works at the TCP level adds nothing to
 * X-Forwarded-For: it passes a request on as the client sent it, the
 * header included, and the app sees the connection come from the load
 * balancer. Where that is one of the load balancer's private addresses,
 * Security Events trusted it, as it trusted every private address, and
 * took the last address the client wrote for the verified client: a client
 * chose the address an attack is blamed on, and a block could be offered
 * for it, or made automatically.
 *
 * So the ranges such a load balancer connects from are never trusted,
 * whatever else trusts them (ClientAddressTrust's untrustedBlocks). These
 * are the ones the project's connected cloud accounts list:
 *
 *   - Google Cloud's proxy Network Load Balancers that connect from a
 *     proxy-only subnet: a regional external or regional internal one, from
 *     its region's REGIONAL_MANAGED_PROXY subnet of its VPC network, and a
 *     cross-region internal one, from the network's GLOBAL_MANAGED_PROXY
 *     subnets. Every Envoy-based load balancer of a region and network
 *     shares its proxy-only subnet - Application Load Balancers and proxy
 *     Network Load Balancers alike - so while one of them passes on, none of
 *     the subnet is trusted. While only Application Load Balancers use it,
 *     the subnet is theirs alone (nothing else can be put in one), and it is
 *     trusted as theirs (Your Load Balancers).
 *   - Google Cloud's global external and classic proxy Network Load
 *     Balancers, which connect from Google's front ends
 *     (OwnLoadBalancers.readGoogleFrontEndUse): the front ends are then not
 *     trusted even where Trusted Proxies lists them (#11388).
 *   - AWS Network Load Balancers that do not keep the client's own address
 *     on the connection: one with a target group of instances or IP
 *     addresses, over TCP or TLS, whose client IP preservation is off (IP
 *     targets have it off unless it is turned on); a dualstack one, which
 *     hands an IPv6 client to IPv4 targets from its own address, and an IPv4
 *     client to IPv6 ones; and one whose target groups could not be read.
 *     It connects from its private addresses, in its subnets.
 *   - AWS Classic Load Balancers with a TCP or SSL listener, which connect
 *     from their subnets too.
 *
 * An AWS load balancer's facts are worked out as its account is listed
 * (Server/Utils/CloudConnection/Aws/AwsInventoryCatalog.
 * addAwsPassOnLoadBalancerFacts) and kept on its record: whether it keeps
 * the client's address, and its subnets' ranges. A Google Cloud one's are
 * read from the project's forwarding rules and subnets as they are stored,
 * so a rule and a subnet in two connected projects - a Shared VPC's - meet.
 *
 * What OneUptime cannot see - HAProxy in mode tcp, nginx's stream module,
 * a Kubernetes Service that hands an ingress each connection from a node -
 * is why a project can stop trusting private addresses at all
 * (Project.securityTrustPrivateAddresses). Pure, so a test holds each rule
 * to its record.
 */

export const GCP_SUBNETWORK_TYPE: string = "compute.googleapis.com/Subnetwork";
const GCP_NETWORK_TYPE: string = "compute.googleapis.com/Network";

// The purposes of a proxy-only subnet of one region, the old name of the first one's last.
export const GCP_REGIONAL_PROXY_ONLY_PURPOSES: ReadonlyArray<string> = [
  "REGIONAL_MANAGED_PROXY",
  "INTERNAL_HTTPS_LOAD_BALANCER",
];

// The purpose of a proxy-only subnet a cross-region load balancer connects from.
export const GCP_GLOBAL_PROXY_ONLY_PURPOSE: string = "GLOBAL_MANAGED_PROXY";

/*
 * What the AWS inventory keeps on a load balancer's record for this
 * (addAwsPassOnLoadBalancerFacts), by the names its properties take.
 */
export const AWS_PASS_ON_PROPERTIES: Readonly<{
  // "On", "Off" or "Unknown": whether its target groups keep the client's address.
  clientIpPreservation: string;
  // The target groups that do not, by name.
  targetGroupsWithoutClientIp: string;
  // The ranges of the subnets it is in, IPv4 and IPv6.
  subnetCidrBlocks: string;
  // The subnets whose ranges could not be read.
  unreadSubnets: string;
}> = {
  clientIpPreservation: "ClientIpPreservation",
  targetGroupsWithoutClientIp: "TargetGroupsWithoutClientIp",
  subnetCidrBlocks: "SubnetCidrBlocks",
  unreadSubnets: "UnreadSubnets",
};

export enum AwsClientIpPreservation {
  On = "On",
  Off = "Off",
  Unknown = "Unknown",
}

export enum PassOnLoadBalancerKind {
  GoogleCloudProxyNetworkLoadBalancer = "google-cloud-proxy-network-load-balancer",
  AwsNetworkLoadBalancer = "aws-network-load-balancer",
  AwsClassicLoadBalancer = "aws-classic-load-balancer",
}

/*
 * Each kind as its cloud names the product: drawn as written in every
 * language, never looked up (Docs/ux/README.md, a cloud's product name).
 */
export const PASS_ON_LOAD_BALANCER_PRODUCT_NAMES: Readonly<
  Record<PassOnLoadBalancerKind, string>
> = {
  [PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer]:
    "Google Cloud proxy Network Load Balancer",
  [PassOnLoadBalancerKind.AwsNetworkLoadBalancer]: "AWS Network Load Balancer",
  [PassOnLoadBalancerKind.AwsClassicLoadBalancer]: "AWS Classic Load Balancer",
};

export function isPassOnLoadBalancerKind(
  value: unknown,
): value is PassOnLoadBalancerKind {
  return (
    typeof value === "string" &&
    (Object.values(PassOnLoadBalancerKind) as Array<string>).includes(value)
  );
}

// Why a load balancer's ranges are not trusted.
export enum PassOnReason {
  // A Google Cloud proxy Network Load Balancer that connects from a proxy-only subnet.
  ProxyOnlySubnet = "proxy-only-subnet",
  // A Google Cloud proxy Network Load Balancer that connects from Google's front ends.
  GoogleFrontEnds = "google-front-ends",
  // An AWS target group of it whose client IP preservation is off.
  ClientIpNotPreserved = "client-ip-not-preserved",
  // A dualstack AWS Network Load Balancer: a client of the other family reaches targets from its address.
  Dualstack = "dualstack",
  // AWS target groups whose client IP preservation could not be read.
  ClientIpUnknown = "client-ip-unknown",
  // An AWS Classic Load Balancer with a TCP or SSL listener.
  TcpListener = "tcp-listener",
}

export function isPassOnReason(value: unknown): value is PassOnReason {
  return (
    typeof value === "string" &&
    (Object.values(PassOnReason) as Array<string>).includes(value)
  );
}

/*
 * One load balancer that passes on what a client wrote, and the ranges it
 * connects from: what is not trusted for it.
 */
export interface PassOnLoadBalancerReading {
  kind: PassOnLoadBalancerKind;
  name: string;
  // The cloud account it is in, by its connection's name: '' when not known.
  where: string;
  reasons: Array<PassOnReason>;
  // AWS: its target groups that do not keep the client's address, by name.
  targetGroups: Array<string>;
  /*
   * The ranges it connects from, each once: never trusted. Empty when they
   * could not be read - its subnets were not listed, or no proxy-only
   * subnet of its region and network is.
   */
  ranges: Array<string>;
  // True when some of the ranges it connects from could not be read.
  areRangesIncomplete: boolean;
}

/*
 * A cloud resource's record, with the cloud account it is in (its
 * connection's name), which the server reads beside it.
 */
export interface PassOnRecord extends OwnLoadBalancerRecord {
  where?: string | null | undefined;
}

function isType(record: OwnLoadBalancerRecord, type: string): boolean {
  return (
    (record.cloudResourceType || "").trim().toLowerCase() === type.toLowerCase()
  );
}

function readProperties(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTexts(value: unknown): Array<string> {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): string => {
      return readText(item);
    })
    .filter(Boolean);
}

// Ranges as they are written, each once, however written: what parses as an address or a range.
function keepRanges(values: ReadonlyArray<string>): Array<string> {
  const kept: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of values) {
    const block: NetworkAddressBlock | null =
      NetworkAddressBlockUtil.parse(value);

    if (block && !seen.has(block.text)) {
      seen.add(block.text);
      kept.push(block.text);
    }
  }

  return kept;
}

/*
 * ---------------------------------------------------------------------------
 * AWS
 * ---------------------------------------------------------------------------
 */

// Whether an AWS ELBv2 load balancer is a Network Load Balancer: its Type, else its ARN.
export function isAwsNetworkLoadBalancer(
  record: OwnLoadBalancerRecord,
): boolean {
  if (!isType(record, AWS_ELBV2_LOAD_BALANCER_TYPE)) {
    return false;
  }

  const type: string = readText(
    readProperties(record.cloudProperties)["Type"],
  ).toLowerCase();

  if (type) {
    return type === "network";
  }

  return (record.providerResourceId || "")
    .toLowerCase()
    .includes(":loadbalancer/net/");
}

// The ranges an AWS load balancer's record says its subnets hold.
function readAwsSubnetRanges(record: OwnLoadBalancerRecord): {
  ranges: Array<string>;
  areRangesIncomplete: boolean;
} {
  const properties: Record<string, unknown> = readProperties(
    record.cloudProperties,
  );
  const ranges: Array<string> = keepRanges(
    readTexts(properties[AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]),
  );

  return {
    ranges,
    areRangesIncomplete:
      ranges.length === 0 ||
      readTexts(properties[AWS_PASS_ON_PROPERTIES.unreadSubnets]).length > 0,
  };
}

/*
 * An AWS load balancer of the project's that passes on what a client
 * wrote, from its own private addresses, read from its record; null for
 * one that keeps the client's address (an NLB whose every target group
 * keeps it, an IPv4 one) or forwards it (an Application Load Balancer, a
 * Classic one of HTTP listeners), and for any other resource.
 */
export function readAwsPassOnLoadBalancer(
  record: PassOnRecord,
): PassOnLoadBalancerReading | null {
  const properties: Record<string, unknown> = readProperties(
    record.cloudProperties,
  );
  const name: string = readText(record.name);
  const where: string = readText(record.where);

  if (isAwsNetworkLoadBalancer(record)) {
    const reasons: Array<PassOnReason> = [];
    const preservation: string = readText(
      properties[AWS_PASS_ON_PROPERTIES.clientIpPreservation],
    );
    const targetGroups: Array<string> = readTexts(
      properties[AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp],
    );

    if (preservation === AwsClientIpPreservation.Off) {
      reasons.push(PassOnReason.ClientIpNotPreserved);
    } else if (preservation !== AwsClientIpPreservation.On) {
      // Read before OneUptime knew to ask, or its target groups could not be read.
      reasons.push(PassOnReason.ClientIpUnknown);
    }

    if (
      readText(properties["IpAddressType"])
        .toLowerCase()
        .startsWith("dualstack")
    ) {
      reasons.push(PassOnReason.Dualstack);
    }

    if (reasons.length === 0) {
      return null;
    }

    return {
      kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
      name,
      where,
      reasons,
      targetGroups,
      ...readAwsSubnetRanges(record),
    };
  }

  if (
    isType(record, AWS_CLASSIC_LOAD_BALANCER_TYPE) &&
    !isAwsHttpClassicLoadBalancer(record)
  ) {
    return {
      kind: PassOnLoadBalancerKind.AwsClassicLoadBalancer,
      name,
      where,
      reasons: [PassOnReason.TcpListener],
      targetGroups: [],
      ...readAwsSubnetRanges(record),
    };
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Google Cloud
 * ---------------------------------------------------------------------------
 */

// The region a regional resource's full name names: ".../regions/europe-west1/..." -> "europe-west1".
function regionOf(record: OwnLoadBalancerRecord): string {
  const id: string = (record.providerResourceId || "").toLowerCase();
  const marker: string = "/regions/";
  const index: number = id.indexOf(marker);

  if (index === -1) {
    return "";
  }

  const rest: string = id.slice(index + marker.length);
  const slash: number = rest.indexOf("/");

  return slash === -1 ? rest : rest.slice(0, slash);
}

// The VPC network a resource runs in, by its full name in lower case; '' when the record names none.
function networkOf(record: OwnLoadBalancerRecord): string {
  const network: CloudResourceRelationship | undefined = readCloudRelationships(
    record.cloudRelationships,
  ).find((relationship: CloudResourceRelationship): boolean => {
    return (
      relationship.kind === CloudRelationshipKind.RunsIn &&
      ((relationship.targetType || "") === GCP_NETWORK_TYPE ||
        relationship.target.toLowerCase().includes("/global/networks/"))
    );
  });

  return network ? network.target.trim().toLowerCase() : "";
}

// A proxy-only subnet of the project's, as its record says.
export interface GoogleProxyOnlySubnet {
  name: string;
  // The cloud account it is in, by its connection's name: '' when not known.
  where: string;
  // Its region, in lower case.
  region: string;
  // Its VPC network's full name, in lower case; '' when the record names none.
  network: string;
  // A GLOBAL_MANAGED_PROXY subnet, which cross-region load balancers connect from.
  isGlobal: boolean;
  ranges: Array<string>;
}

// A Google Cloud subnet read as a proxy-only subnet, or null for any other.
export function readGoogleProxyOnlySubnet(
  record: PassOnRecord,
): GoogleProxyOnlySubnet | null {
  if (!isType(record, GCP_SUBNETWORK_TYPE)) {
    return null;
  }

  const properties: Record<string, unknown> = readProperties(
    record.cloudProperties,
  );
  const purpose: string = readText(properties["purpose"]).toUpperCase();
  const isGlobal: boolean = purpose === GCP_GLOBAL_PROXY_ONLY_PURPOSE;

  if (!isGlobal && !GCP_REGIONAL_PROXY_ONLY_PURPOSES.includes(purpose)) {
    return null;
  }

  return {
    name: readText(record.name),
    where: readText(record.where),
    region: regionOf(record),
    network: networkOf(record),
    isGlobal,
    ranges: keepRanges([
      readText(properties["ipCidrRange"]),
      readText(properties["ipv6CidrRange"]),
      readText(properties["internalIpv6Prefix"]),
    ]),
  };
}

/*
 * A Google Cloud load balancer that connects from a proxy-only subnet, by
 * its forwarding rule: an Envoy-based one, regional (EXTERNAL_MANAGED or
 * INTERNAL_MANAGED in a region) or cross-region (INTERNAL_MANAGED and
 * global). A global EXTERNAL_MANAGED one connects from Google's front ends
 * instead, and any other scheme from no proxy at all.
 */
export interface GoogleManagedProxyRule {
  name: string;
  // The cloud account it is in, by its connection's name: '' when not known.
  where: string;
  // Its region, in lower case; '' for a cross-region one.
  region: string;
  // Its VPC network's full name, in lower case; '' when the rule names none.
  network: string;
  isGlobal: boolean;
  /*
   * A proxy Network Load Balancer - one that routes through a target TCP
   * proxy - or one OneUptime cannot tell is an Application Load Balancer:
   * it passes a request on as the client sent it.
   */
  passesOn: boolean;
}

export function readGoogleManagedProxyRule(
  record: PassOnRecord,
): GoogleManagedProxyRule | null {
  if (!isType(record, GCP_FORWARDING_RULE_TYPE)) {
    return null;
  }

  const scheme: string = readText(
    readProperties(record.cloudProperties)["loadBalancingScheme"],
  ).toUpperCase();
  const isGlobal: boolean = (record.providerResourceId || "")
    .toLowerCase()
    .includes("/global/forwardingrules/");

  if (
    scheme !== "INTERNAL_MANAGED" &&
    !(scheme === "EXTERNAL_MANAGED" && !isGlobal)
  ) {
    return null;
  }

  return {
    name: readText(record.name),
    where: readText(record.where),
    region: isGlobal ? "" : regionOf(record),
    network: networkOf(record),
    isGlobal,
    passesOn: !isGoogleCloudApplicationForwardingRule(record),
  };
}

/*
 * Whether a load balancer connects from a proxy-only subnet: one of its
 * kind (regional or cross-region), of its region, in its network. A record
 * that names no region or network matches every one, toward trusting less.
 */
export function doesRuleUseProxyOnlySubnet(
  rule: GoogleManagedProxyRule,
  subnet: GoogleProxyOnlySubnet,
): boolean {
  if (rule.isGlobal !== subnet.isGlobal) {
    return false;
  }

  if (
    !rule.isGlobal &&
    rule.region &&
    subnet.region &&
    rule.region !== subnet.region
  ) {
    return false;
  }

  return !(rule.network && subnet.network && rule.network !== subnet.network);
}

// A proxy-only subnet, and the project's load balancers that connect from it.
export interface GoogleProxyOnlySubnetUse {
  subnet: GoogleProxyOnlySubnet;
  // The proxy Network Load Balancers, by name: while any does, the subnet is not trusted.
  passedOnBy: Array<string>;
  // The Application Load Balancers, by name: with none of the others, the subnet is theirs.
  forwardedBy: Array<string>;
}

export interface GoogleProxyOnlyReading {
  // Every proxy-only subnet a load balancer of the project's connects from.
  uses: Array<GoogleProxyOnlySubnetUse>;
  /*
   * Each proxy Network Load Balancer, with the ranges of the subnets it
   * connects from: none when no subnet of its region and network is listed.
   */
  passOn: Array<PassOnLoadBalancerReading>;
}

/*
 * Which of the project's proxy-only subnets its load balancers connect
 * from, from its subnets' and forwarding rules' records: a subnet a proxy
 * Network Load Balancer uses is not trusted, and one only Application Load
 * Balancers use is theirs.
 */
export function readGoogleProxyOnlySubnetUses(data: {
  records: ReadonlyArray<PassOnRecord>;
}): GoogleProxyOnlyReading {
  const subnets: Array<GoogleProxyOnlySubnet> = [];
  const rules: Array<GoogleManagedProxyRule> = [];

  for (const record of data.records) {
    const subnet: GoogleProxyOnlySubnet | null =
      readGoogleProxyOnlySubnet(record);

    if (subnet) {
      subnets.push(subnet);
      continue;
    }

    const rule: GoogleManagedProxyRule | null =
      readGoogleManagedProxyRule(record);

    if (rule) {
      rules.push(rule);
    }
  }

  const uses: Array<GoogleProxyOnlySubnetUse> = [];

  for (const subnet of subnets) {
    const using: Array<GoogleManagedProxyRule> = rules.filter(
      (rule: GoogleManagedProxyRule): boolean => {
        return doesRuleUseProxyOnlySubnet(rule, subnet);
      },
    );

    if (using.length === 0) {
      continue;
    }

    uses.push({
      subnet,
      passedOnBy: using
        .filter((rule: GoogleManagedProxyRule): boolean => {
          return rule.passesOn;
        })
        .map((rule: GoogleManagedProxyRule): string => {
          return rule.name;
        }),
      forwardedBy: using
        .filter((rule: GoogleManagedProxyRule): boolean => {
          return !rule.passesOn;
        })
        .map((rule: GoogleManagedProxyRule): string => {
          return rule.name;
        }),
    });
  }

  const passOn: Array<PassOnLoadBalancerReading> = rules
    .filter((rule: GoogleManagedProxyRule): boolean => {
      return rule.passesOn;
    })
    .map((rule: GoogleManagedProxyRule): PassOnLoadBalancerReading => {
      const ranges: Array<string> = keepRanges(
        subnets
          .filter((subnet: GoogleProxyOnlySubnet): boolean => {
            return doesRuleUseProxyOnlySubnet(rule, subnet);
          })
          .flatMap((subnet: GoogleProxyOnlySubnet): Array<string> => {
            return subnet.ranges;
          }),
      );

      return {
        kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
        name: rule.name,
        where: rule.where,
        reasons: [PassOnReason.ProxyOnlySubnet],
        targetGroups: [],
        ranges,
        areRangesIncomplete: ranges.length === 0,
      };
    });

  return { uses, passOn };
}

/*
 * A Google Cloud TCP or SSL proxy load balancer that connects from Google's
 * front ends (a global external or a classic proxy Network Load Balancer),
 * read from its forwarding rule; null for any other.
 */
export function readGoogleFrontEndPassOnLoadBalancer(
  record: PassOnRecord,
): PassOnLoadBalancerReading | null {
  if (readGoogleFrontEndUse(record) !== GoogleFrontEndUse.PassesOn) {
    return null;
  }

  return {
    kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
    name: readText(record.name),
    where: readText(record.where),
    reasons: [PassOnReason.GoogleFrontEnds],
    targetGroups: [],
    ranges: [...GOOGLE_FRONT_END_RANGES],
    areRangesIncomplete: false,
  };
}
