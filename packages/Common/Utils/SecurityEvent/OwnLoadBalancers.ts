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
 * Only public addresses are kept: a private one is trusted anyway. What is
 * read here is what the inventory recorded: an AWS load balancer is listed
 * by its DNS name alone, which the server resolves
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
  // Its public addresses as the record names them, each once.
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
 * A record's addresses that are on the internet, each once however it is
 * written, as written (an IPv4 address an IPv6 one maps as the IPv4 one): a
 * private one is trusted without being listed.
 */
function keepPublic(values: ReadonlyArray<string>): Array<string> {
  const kept: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const value of values) {
    const address: string = readAddressText(value);
    const canonical: string | null = canonicalAddress(address);

    if (
      !address ||
      !canonical ||
      seen.has(canonical) ||
      getSecurityAddressScope(address) !== SecurityAddressScope.Public
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
    const addresses: Array<string> = keepPublic(endpoints.addresses);

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
    const addresses: Array<string> = keepPublic([
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
    const addresses: Array<string> = keepPublic(
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
 * ones only, each once, beside the ones it already holds.
 */
export function addResolvedAddresses(
  reading: OwnLoadBalancerReading,
  resolved: ReadonlyArray<string>,
): Array<string> {
  return keepPublic([...reading.addresses, ...resolved]);
}
