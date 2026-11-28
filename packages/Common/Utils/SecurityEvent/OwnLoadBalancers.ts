import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  readCloudEndpoints,
  readCloudRelationships,
} from "../../Types/Cloud/CloudInventory";
import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "../../Types/Cloud/CloudMonitoredResource";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../SecurityCase/SecurityConnectionMatch";
import { readAddressText } from "./ClientAddressTrust";

/*
 * THE PROJECT'S OWN LOAD BALANCERS THAT FORWARD ITS CLIENTS (#10546).
 *
 * Trusting an address as a proxy means believing the X-Forwarded-For it
 * passes on (Utils/SecurityEvent/ClientAddressTrust). That is right only
 * for an address every connection from which is a proxy's: one that
 * appends the address it took the connection from, so nothing left of that
 * can be the client's own words. An app server, a probe, a Kubernetes node
 * or a NAT gateway is no such address: whatever runs there - a request a
 * monitor sends with headers of its own, a pod, a laptop behind the NAT -
 * would name any client it likes, framing an innocent address or hiding
 * the real one. So OneUptime trusts none of the project's addresses because
 * they are its own (SecurityProtectedAddresses protects them all from a
 * block); it trusts only the load balancers that forward clients over HTTP,
 * as the project's connected cloud accounts list them:
 *
 *   - an AWS Application Load Balancer (an ELBv2 load balancer of Type
 *     "application"); never a Network or Gateway Load Balancer, which pass a
 *     connection on as it came, X-Forwarded-For and all;
 *   - an AWS Classic Load Balancer whose every listener is HTTP or HTTPS on
 *     both sides; one TCP or SSL listener passes a header through as sent;
 *   - a Google Cloud Application Load Balancer: a forwarding rule that sends
 *     to a URL map, through an HTTP or HTTPS proxy, whose address Google's
 *     proxies append to X-Forwarded-For after the client's; never a
 *     passthrough or TCP/SSL proxy load balancer, which sends to a backend
 *     service, a target pool or an instance;
 *   - an Azure Application Gateway, by the public IP address attached to it;
 *     never an Azure Load Balancer, whose address its virtual machines' own
 *     connections may leave through (outbound rules).
 *
 * Kubernetes Ingress objects are not in OneUptime's inventory, and an
 * Ingress's address is that of whatever is in front of its controller - as
 * often a layer 4 load balancer as an application one. A GKE, AKS or EKS
 * ingress that is a Google Cloud Application Load Balancer, an Application
 * Gateway or an AWS Application Load Balancer is trusted as that load
 * balancer, once its cloud account is connected; an ingress controller
 * inside the cluster forwards from a private address, which every project
 * trusts already.
 *
 * Their public and private addresses are both kept: a project may trust no
 * private address it was not told of (#11389), and an internal load
 * balancer's - an internal AWS Application Load Balancer's, a Google Cloud
 * internal Application Load Balancer's forwarding rule - is then trusted
 * because it is the load balancer's. So is a Google Cloud proxy-only
 * subnet that only the project's Application Load Balancers connect from
 * (PassOnLoadBalancers.readGoogleProxyOnlySubnetUses): nothing else can be
 * put in one. What is read here is what the inventory recorded: an AWS
 * load balancer is listed by its DNS name alone, which the server resolves
 * (Server/Utils/SecurityEvent/SecurityOwnLoadBalancers). Pure, so a test
 * holds every rule to its record.
 */

export const AWS_ELBV2_LOAD_BALANCER_TYPE: string =
  "AWS::ElasticLoadBalancingV2::LoadBalancer";
export const AWS_CLASSIC_LOAD_BALANCER_TYPE: string =
  "AWS::ElasticLoadBalancing::LoadBalancer";
export const GCP_FORWARDING_RULE_TYPE: string =
  "compute.googleapis.com/ForwardingRule";
export const AZURE_PUBLIC_IP_ADDRESS_TYPE: string =
  "Microsoft.Network/publicIPAddresses";

// The cloud resource types a load balancer that forwards clients is listed under.
export const OWN_LOAD_BALANCER_RESOURCE_TYPES: ReadonlyArray<string> = [
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  AWS_CLASSIC_LOAD_BALANCER_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  AZURE_PUBLIC_IP_ADDRESS_TYPE,
];

export enum OwnLoadBalancerKind {
  AwsApplicationLoadBalancer = "aws-application-load-balancer",
  AwsClassicLoadBalancer = "aws-classic-load-balancer",
  GoogleCloudApplicationLoadBalancer = "google-cloud-application-load-balancer",
  AzureApplicationGateway = "azure-application-gateway",
  /*
   * A Google Cloud proxy-only subnet only the project's Application Load
   * Balancers connect from (#11389): listed by its range.
   */
  GoogleCloudProxyOnlySubnet = "google-cloud-proxy-only-subnet",
}

/*
 * Each kind as its cloud names the product: drawn as written in every
 * language, never looked up (Docs/ux/README.md, a cloud's product name).
 */
export const OWN_LOAD_BALANCER_PRODUCT_NAMES: Readonly<
  Record<OwnLoadBalancerKind, string>
> = {
  [OwnLoadBalancerKind.AwsApplicationLoadBalancer]:
    "AWS Application Load Balancer",
  [OwnLoadBalancerKind.AwsClassicLoadBalancer]: "AWS Classic Load Balancer",
  [OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer]:
    "Google Cloud Application Load Balancer",
  [OwnLoadBalancerKind.AzureApplicationGateway]: "Azure Application Gateway",
  [OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet]:
    "Google Cloud proxy-only subnet",
};

export function isOwnLoadBalancerKind(
  value: unknown,
): value is OwnLoadBalancerKind {
  return (
    typeof value === "string" &&
    (Object.values(OwnLoadBalancerKind) as Array<string>).includes(value)
  );
}

// What a cloud resource row holds that says whether it is one.
export interface OwnLoadBalancerRecord {
  cloudResourceType?: string | null | undefined;
  providerResourceId?: string | null | undefined;
  name?: string | null | undefined;
  cloudProperties?: unknown;
  cloudEndpoints?: unknown;
  cloudRelationships?: unknown;
}

export interface OwnLoadBalancerReading {
  kind: OwnLoadBalancerKind;
  // The name it goes by: the load balancer's, the forwarding rule's, the gateway's.
  name: string;
  // Its addresses, public and private, as the record names them, each once.
  addresses: Array<string>;
  // The DNS names its addresses are behind, to resolve: an AWS load balancer's.
  hostNames: Array<string>;
}

// The protocols a load balancer speaks to forward a client in X-Forwarded-For.
const HTTP_PROTOCOLS: ReadonlyArray<string> = ["http", "https"];

// What a Google Cloud forwarding rule sends to when it is an Application Load Balancer's.
const GCP_APPLICATION_TARGET_TYPES: ReadonlyArray<string> = [
  "https_lb_rule",
  "internal_http_lb_rule",
  "compute.googleapis.com/urlmap",
  "compute.googleapis.com/targethttpproxy",
  "compute.googleapis.com/targethttpsproxy",
];

const GCP_APPLICATION_TARGET_COLLECTIONS: ReadonlyArray<string> = [
  "/urlmaps/",
  "/targethttpproxies/",
  "/targethttpsproxies/",
];

const AZURE_APPLICATION_GATEWAY_TYPE: string =
  "microsoft.network/applicationgateways";

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

/*
 * A record's addresses a connection can come from - on the internet or in
 * a private network - each once however it is written, as written (an IPv4
 * address an IPv6 one maps as the IPv4 one). A private one is kept too
 * (#11389): a project may trust no private address it was not told of.
 * Never a loopback, link-local or reserved one, which is nobody's load
 * balancer.
 */
function keepConnectable(values: ReadonlyArray<string>): Array<string> {
  const kept: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of values) {
    const address: string = readAddressText(value);
    const canonical: string | null = canonicalAddress(address);
    const scope: SecurityAddressScope | null = getSecurityAddressScope(address);

    if (
      !address ||
      !canonical ||
      seen.has(canonical) ||
      (scope !== SecurityAddressScope.Public &&
        scope !== SecurityAddressScope.Private)
    ) {
      continue;
    }

    seen.add(canonical);
    kept.push(address);
  }

  return kept;
}

// An endpoint list split into the addresses it names and the names behind them.
function splitEndpoints(value: unknown): {
  addresses: Array<string>;
  hostNames: Array<string>;
} {
  const addresses: Array<string> = [];
  const hostNames: Array<string> = [];

  for (const endpoint of readCloudEndpoints(value)) {
    if (readAddressText(endpoint)) {
      addresses.push(endpoint);
    } else {
      hostNames.push(endpoint);
    }
  }

  return { addresses, hostNames };
}

/*
 * Whether an AWS ELBv2 load balancer is an Application Load Balancer: its
 * Type, as Cloud Control lists it, else its ARN (":loadbalancer/app/"), as
 * a load balancer a metric named first is known by.
 */
export function isAwsApplicationLoadBalancer(
  record: OwnLoadBalancerRecord,
): boolean {
  if (!isType(record, AWS_ELBV2_LOAD_BALANCER_TYPE)) {
    return false;
  }

  const type: string = readText(
    readProperties(record.cloudProperties)["Type"],
  ).toLowerCase();

  if (type) {
    return type === "application";
  }

  return (record.providerResourceId || "")
    .toLowerCase()
    .includes(":loadbalancer/app/");
}

/*
 * Whether every listener of an AWS Classic Load Balancer is HTTP or HTTPS
 * on both sides - "HTTP:80 -> HTTP:8080", as the inventory writes one - so
 * it adds the client to X-Forwarded-For whichever listener a request comes
 * in on. One that lists no listener says nothing, and is not trusted.
 */
export function isAwsHttpClassicLoadBalancer(
  record: OwnLoadBalancerRecord,
): boolean {
  if (!isType(record, AWS_CLASSIC_LOAD_BALANCER_TYPE)) {
    return false;
  }

  const listeners: unknown = readProperties(record.cloudProperties)[
    "Listeners"
  ];

  if (!Array.isArray(listeners) || listeners.length === 0) {
    return false;
  }

  return listeners.every((listener: unknown): boolean => {
    const text: string = readText(listener);

    if (!text) {
      return false;
    }

    return text.split("->").every((side: string): boolean => {
      const protocol: string = (side.split(":")[0] || "").trim().toLowerCase();

      return HTTP_PROTOCOLS.includes(protocol);
    });
  });
}

/*
 * Whether a Google Cloud forwarding rule is an Application Load Balancer's:
 * it sends to a URL map, as the inventory resolves a target HTTP or HTTPS
 * proxy, or to such a proxy the listing did not hold.
 */
export function isGoogleCloudApplicationForwardingRule(
  record: OwnLoadBalancerRecord,
): boolean {
  if (!isType(record, GCP_FORWARDING_RULE_TYPE)) {
    return false;
  }

  return readCloudRelationships(record.cloudRelationships).some(
    (relationship: CloudResourceRelationship): boolean => {
      if (relationship.kind !== CloudRelationshipKind.RoutesTo) {
        return false;
      }

      const targetType: string = (relationship.targetType || "").toLowerCase();

      if (targetType) {
        return GCP_APPLICATION_TARGET_TYPES.includes(targetType);
      }

      const target: string = relationship.target.toLowerCase();

      return GCP_APPLICATION_TARGET_COLLECTIONS.some(
        (collection: string): boolean => {
          return target.includes(collection);
        },
      );
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * Google's front ends (#11047)
 * ---------------------------------------------------------------------------
 *
 * Behind a Google Cloud global external Application Load Balancer, or a
 * classic one, an app's connections come from Google's front ends (GFEs),
 * not from the load balancer's own address, and the front end forwards
 * `X-Forwarded-For: [<what the client sent>,] <client>, <load balancer>`.
 * The load balancer's address is trusted with the rest of the project's
 * own (#10546); the front ends' ranges must be too, or every attack through
 * one is blamed on a front end.
 *
 * Google publishes them on its load balancing firewall rules page
 * (GOOGLE_FRONT_END_RANGES_SOURCE), as the source ranges of the proxies of
 * these load balancers - not as a list a program reads. Checked there on
 * GOOGLE_FRONT_END_RANGES_CHECKED_ON, and against Google's own published
 * lists of that day: both IPv4 ranges are in Google's ranges (goog.json:
 * 35.184.0.0/13, 130.211.0.0/16) and in none Google Cloud lets a customer
 * hold (cloud.json), and the IPv6 one is in neither, an address only
 * Google's network writes. So nobody outside Google connects from them.
 *
 * Trusting them still never lets anyone outside Google name a client:
 *
 *   - through the project's own Application Load Balancer, the front end
 *     appends the client and then the load balancer's own address, both
 *     after anything the client wrote; walked from the right, the load
 *     balancer is trusted (it is the project's), the client is not, and the
 *     client is named;
 *   - through anyone else's, the header ends with that load balancer's
 *     address, which is not the project's, so the walk stops there and the
 *     event names that load balancer - never a forged address before it.
 *     (Another customer's load balancer reaches a backend outside its own
 *     network only through an internet NEG, whose traffic leaves Google
 *     from other ranges altogether: _cloud-eoips.googleusercontent.com.)
 *
 * But Google's TCP and SSL proxy load balancers - the global external proxy
 * Network Load Balancer and the classic one - connect from these same
 * ranges and pass a request on as the client sent it, X-Forwarded-For and
 * all. With one in front of the project's apps, trusting the ranges would
 * believe whatever a client wrote. So the ranges are trusted only while the
 * project's connected Google Cloud projects hold an Application Load
 * Balancer that uses them and no such proxy - and while every load
 * balancer could be read, so that none was missed.
 */

export const GOOGLE_FRONT_END_RANGES: ReadonlyArray<string> = [
  "35.191.0.0/16",
  "130.211.0.0/22",
  "2600:2d00:1:1::/64",
];

// Where Google publishes them, and when they were checked there.
export const GOOGLE_FRONT_END_RANGES_SOURCE: string =
  "https://cloud.google.com/load-balancing/docs/firewall-rules";
export const GOOGLE_FRONT_END_RANGES_CHECKED_ON: string = "2026-11-27";

/*
 * The ranges Google's health checks of a load balancer's backends come from
 * (#11388), beside the front ends' own (35.191.0.0/16 is both): the IPv6
 * probes of most load balancers, and the probes of the external passthrough
 * Network Load Balancers, regional and global. Google publishes them on its
 * health checks page (GOOGLE_HEALTH_CHECK_RANGES_SOURCE). Checked there on
 * GOOGLE_HEALTH_CHECK_RANGES_CHECKED_ON, and against that day's goog.json
 * and cloud.json: each is in Google's own ranges and in none a Google Cloud
 * customer can hold. Never trusted as a proxy - a health check forwards
 * nobody - and never blocked (SecurityProtectedAddresses): a block of one
 * fails the checks and takes the backends out of service.
 */
export const GOOGLE_HEALTH_CHECK_RANGES: ReadonlyArray<string> = [
  "2600:2d00:1:b029::/64",
  "209.85.152.0/22",
  "209.85.204.0/22",
  "2600:1901:8001::/48",
  "136.124.104.0/22",
  "136.124.108.0/22",
  "2600:1904:7::/48",
  "2600:1904:8::/48",
];

export const GOOGLE_HEALTH_CHECK_RANGES_SOURCE: string =
  "https://cloud.google.com/load-balancing/docs/health-check-concepts";
export const GOOGLE_HEALTH_CHECK_RANGES_CHECKED_ON: string = "2026-11-28";

/*
 * Every range Google's load balancers connect to a project's backends from:
 * their front ends and their health checks, which no block may cover
 * (#11388).
 */
export const GOOGLE_LOAD_BALANCER_SOURCE_RANGES: ReadonlyArray<string> = [
  ...GOOGLE_FRONT_END_RANGES,
  ...GOOGLE_HEALTH_CHECK_RANGES,
];

// How a Google Cloud forwarding rule's load balancer uses Google's front ends.
export enum GoogleFrontEndUse {
  // An Application Load Balancer: its front ends add the client to X-Forwarded-For.
  Forwards = "forwards",
  /*
   * A TCP or SSL proxy load balancer, or one OneUptime cannot tell is not:
   * its front ends pass a request on as the client sent it.
   */
  PassesOn = "passes-on",
}

// What a forwarding rule routes to through a TCP or SSL proxy, before the proxy is looked up.
const GCP_PASS_ON_TARGET_COLLECTIONS: ReadonlyArray<string> = [
  "/targettcpproxies/",
  "/targetsslproxies/",
];

/*
 * A global backend service: what a forwarding rule reaches only through a
 * target TCP or SSL proxy. A passthrough load balancer's rule names a
 * regional one, and an Application Load Balancer's a URL map.
 */
const GCP_GLOBAL_BACKEND_SERVICES: string = "/global/backendservices/";

function isGlobalForwardingRule(record: OwnLoadBalancerRecord): boolean {
  return (record.providerResourceId || "")
    .toLowerCase()
    .includes("/global/forwardingrules/");
}

function routesOn(record: OwnLoadBalancerRecord): boolean {
  return readCloudRelationships(record.cloudRelationships).some(
    (relationship: CloudResourceRelationship): boolean => {
      if (relationship.kind !== CloudRelationshipKind.RoutesTo) {
        return false;
      }

      const target: string = relationship.target.toLowerCase();

      return (
        target.includes(GCP_GLOBAL_BACKEND_SERVICES) ||
        GCP_PASS_ON_TARGET_COLLECTIONS.some((collection: string): boolean => {
          return target.includes(collection);
        })
      );
    },
  );
}

/*
 * Whether a Google Cloud forwarding rule's load balancer connects from
 * Google's front ends, and how; null for one that does not.
 *
 * Only an external one does: the scheme EXTERNAL (a classic load balancer,
 * global in the Premium Tier and regional in the Standard) or a global
 * EXTERNAL_MANAGED (a global external load balancer). A regional
 * EXTERNAL_MANAGED one connects from its region's proxy-only subnet, an
 * internal one from inside the network - private addresses, trusted
 * anyway - and a passthrough one passes the client's own connection on.
 *
 * Of those, one that routes to a URL map, through an HTTP or HTTPS proxy,
 * forwards; one that routes through a TCP or SSL proxy passes on. A global
 * external rule always routes through one of the four proxies, so one whose
 * target OneUptime cannot tell passes on, toward trusting less. A regional
 * EXTERNAL rule to a regional backend service or a target pool is a
 * passthrough load balancer, which uses no front end.
 */
export function readGoogleFrontEndUse(
  record: OwnLoadBalancerRecord,
): GoogleFrontEndUse | null {
  if (!isType(record, GCP_FORWARDING_RULE_TYPE)) {
    return null;
  }

  const scheme: string = readText(
    readProperties(record.cloudProperties)["loadBalancingScheme"],
  ).toUpperCase();
  const isGlobal: boolean = isGlobalForwardingRule(record);

  if (scheme !== "EXTERNAL" && !(scheme === "EXTERNAL_MANAGED" && isGlobal)) {
    return null;
  }

  if (isGoogleCloudApplicationForwardingRule(record)) {
    return GoogleFrontEndUse.Forwards;
  }

  if (routesOn(record) || isGlobal) {
    return GoogleFrontEndUse.PassesOn;
  }

  return null;
}

/*
 * The Application Gateway an Azure public IP address is attached to, by
 * its parsed ARM id, or null: one attached to a load balancer, a NAT
 * gateway, a virtual machine's interface or nothing is no gateway's.
 */
export function getAzureApplicationGatewayOf(
  record: OwnLoadBalancerRecord,
): ParsedAzureResourceId | null {
  if (!isType(record, AZURE_PUBLIC_IP_ADDRESS_TYPE)) {
    return null;
  }

  for (const relationship of readCloudRelationships(
    record.cloudRelationships,
  )) {
    if (relationship.kind !== CloudRelationshipKind.AttachedTo) {
      continue;
    }

    const parsed: ParsedAzureResourceId | null = parseAzureResourceId(
      relationship.target,
    );

    if (
      parsed &&
      parsed.type.toLowerCase() === AZURE_APPLICATION_GATEWAY_TYPE
    ) {
      return parsed;
    }
  }

  return null;
}

/*
 * A cloud resource read as one of the project's own load balancers that
 * forward its clients, with the public addresses it holds and the names to
 * resolve; null for any other resource, or one of them with no public
 * address and no name to look one up by.
 */
export function readOwnLoadBalancer(
  record: OwnLoadBalancerRecord,
): OwnLoadBalancerReading | null {
  const name: string = readText(record.name);

  if (
    isAwsApplicationLoadBalancer(record) ||
    isAwsHttpClassicLoadBalancer(record)
  ) {
    const endpoints: { addresses: Array<string>; hostNames: Array<string> } =
      splitEndpoints(record.cloudEndpoints);
    const addresses: Array<string> = keepConnectable(endpoints.addresses);

    if (addresses.length === 0 && endpoints.hostNames.length === 0) {
      return null;
    }

    return {
      kind: isAwsApplicationLoadBalancer(record)
        ? OwnLoadBalancerKind.AwsApplicationLoadBalancer
        : OwnLoadBalancerKind.AwsClassicLoadBalancer,
      name,
      addresses,
      hostNames: endpoints.hostNames,
    };
  }

  if (isGoogleCloudApplicationForwardingRule(record)) {
    const addresses: Array<string> = keepConnectable([
      readText(readProperties(record.cloudProperties)["IPAddress"]),
      ...splitEndpoints(record.cloudEndpoints).addresses,
    ]);

    return addresses.length > 0
      ? {
          kind: OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer,
          name,
          addresses,
          hostNames: [],
        }
      : null;
  }

  const gateway: ParsedAzureResourceId | null =
    getAzureApplicationGatewayOf(record);

  if (gateway) {
    const addresses: Array<string> = keepConnectable(
      splitEndpoints(record.cloudEndpoints).addresses,
    );

    return addresses.length > 0
      ? {
          kind: OwnLoadBalancerKind.AzureApplicationGateway,
          name: gateway.name || name,
          addresses,
          hostNames: [],
        }
      : null;
  }

  return null;
}

/*
 * The addresses a name resolved to that may join a load balancer's: public
 * and private ones (an internal load balancer's name resolves to these),
 * each once, beside the ones it already holds.
 */
export function addResolvedAddresses(
  reading: OwnLoadBalancerReading,
  resolved: ReadonlyArray<string>,
): Array<string> {
  return keepConnectable([...reading.addresses, ...resolved]);
}
