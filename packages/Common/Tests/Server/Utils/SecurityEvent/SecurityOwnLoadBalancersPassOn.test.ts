import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import DnsResolutionCache from "../../../../Server/Utils/Monitor/DnsResolutionCache";
import SecurityEdgeRanges from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers, {
  OWN_PROXY_ONLY_SUBNET_ROWS_READ,
  SecurityOwnLoadBalancerBlocks,
  SecurityOwnLoadBalancersRead,
} from "../../../../Server/Utils/SecurityEvent/SecurityOwnLoadBalancers";
import SecurityTrustedProxies from "../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Project from "../../../../Models/DatabaseModels/Project";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { NetworkAddressBlock } from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  ClientAddressTrust,
  TrustedProxies,
  isTrustedProxy,
  readClaimedClientAddress,
  readClientAddressTrust,
  readUnvouchedForwarding,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import {
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  GOOGLE_FRONT_END_RANGES,
  OwnLoadBalancerKind,
} from "../../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  AWS_PASS_ON_PROPERTIES,
  AwsClientIpPreservation,
  GCP_SUBNETWORK_TYPE,
  PassOnLoadBalancerKind,
  PassOnReason,
} from "../../../../Utils/SecurityEvent/PassOnLoadBalancers";
import {
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * #11388, #11389: WHAT THE SCANS NEVER TRUST OF THE PROJECT'S OWN LOAD
 * BALANCERS, AND THE PROXY-ONLY SUBNETS THEY DO.
 *
 * The project's connected clouds list its load balancers that pass on what
 * a client wrote: a Google Cloud proxy Network Load Balancer, from its
 * region's proxy-only subnet or from Google's front ends, an AWS Network
 * Load Balancer that does not keep the client's address, from its subnets.
 * Where they connect from is never trusted - listed, private, or brought
 * by another load balancer - and a proxy-only subnet only Application Load
 * Balancers use is trusted as theirs, so a project that stops trusting
 * private addresses still verifies the client one of them forwards. The
 * database is stubbed; the reading, the trust and the trace scan's own
 * reading of a span are real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11389000-0000-4000-8000-000000000001",
);

const VICTIM: string = "198.51.100.7";
const CLIENT: string = "203.0.113.7";

const FULL: string = "//compute.googleapis.com/projects/shop-prod";
const NETWORK: string = `${FULL}/global/networks/default`;
const PROXY_ONLY_RANGE: string = "10.129.0.0/23";
const PROXY_ONLY_PEER: string = "10.129.0.12";

function resource(data: Record<string, unknown>): CloudResource {
  const row: CloudResource = new CloudResource();

  Object.assign(row, {
    _id: ObjectID.generate().toString(),
    cloudConnection: { name: data["where"] || "Google Cloud shop" },
    ...data,
  });

  return row;
}

function inNetwork(): Array<Record<string, unknown>> {
  return [
    {
      kind: CloudRelationshipKind.RunsIn,
      target: NETWORK,
      targetType: "compute.googleapis.com/Network",
    },
  ];
}

const PROXY_ONLY_SUBNET: CloudResource = resource({
  name: "proxy-only",
  cloudResourceType: GCP_SUBNETWORK_TYPE,
  providerResourceId: `${FULL}/regions/us-central1/subnetworks/proxy-only`,
  cloudProperties: {
    ipCidrRange: PROXY_ONLY_RANGE,
    purpose: "REGIONAL_MANAGED_PROXY",
  },
  cloudRelationships: inNetwork(),
});

// A regional internal Application Load Balancer: it adds the client it forwards.
const ORDERS_RULE: CloudResource = resource({
  name: "orders",
  cloudResourceType: GCP_FORWARDING_RULE_TYPE,
  providerResourceId: `${FULL}/regions/us-central1/forwardingRules/orders`,
  cloudProperties: {
    IPAddress: "10.128.0.9",
    loadBalancingScheme: "INTERNAL_MANAGED",
  },
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: `${FULL}/regions/us-central1/urlMaps/orders`,
      targetType: "internal_http_lb_rule",
    },
    ...inNetwork(),
  ],
});

// A regional proxy Network Load Balancer: it passes on what the client wrote.
const DB_RULE: CloudResource = resource({
  name: "db-tcp",
  cloudResourceType: GCP_FORWARDING_RULE_TYPE,
  providerResourceId: `${FULL}/regions/us-central1/forwardingRules/db-tcp`,
  cloudProperties: {
    IPAddress: "34.41.10.20",
    loadBalancingScheme: "EXTERNAL_MANAGED",
  },
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: `${FULL}/regions/us-central1/backendServices/db`,
      targetType: "compute.googleapis.com/RegionBackendService",
    },
    ...inNetwork(),
  ],
});

// A global external Application Load Balancer, which brings Google's front ends.
const SHOP_RULE: CloudResource = resource({
  name: "shop-https",
  cloudResourceType: GCP_FORWARDING_RULE_TYPE,
  providerResourceId: `${FULL}/global/forwardingRules/shop-https`,
  cloudProperties: {
    IPAddress: "34.120.1.2",
    loadBalancingScheme: "EXTERNAL_MANAGED",
  },
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: `${FULL}/global/urlMaps/shop`,
      targetType: "https_lb_rule",
    },
  ],
});

// A global external TCP proxy, from the same front ends: it passes on.
const MAIL_RULE: CloudResource = resource({
  name: "mail-tcp",
  cloudResourceType: GCP_FORWARDING_RULE_TYPE,
  providerResourceId: `${FULL}/global/forwardingRules/mail-tcp`,
  cloudProperties: { IPAddress: "34.120.9.9", loadBalancingScheme: "EXTERNAL" },
  cloudRelationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: `${FULL}/global/targetTcpProxies/mail-tcp`,
    },
  ],
});

// An AWS Network Load Balancer, with the facts the AWS inventory kept on it.
function nlb(
  name: string,
  preservation: AwsClientIpPreservation,
  subnets: Array<string>,
): CloudResource {
  return resource({
    name,
    cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
    providerResourceId: `arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/${name}/50dc6c495c0c9188`,
    cloudProperties: {
      Type: "network",
      IpAddressType: "ipv4",
      [AWS_PASS_ON_PROPERTIES.clientIpPreservation]: preservation,
      ...(preservation === AwsClientIpPreservation.Off
        ? {
            [AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp]: [
              `${name}-ip`,
            ],
          }
        : {}),
      [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: subnets,
    },
    cloudEndpoints: [`${name}-1.elb.us-east-1.amazonaws.com`],
    where: "Production AWS",
  });
}

/*
 * The project's cloud inventory: its load balancers and forwarding rules by
 * the first query, its Google Cloud subnets by the proxy-only subnet
 * searches - as the database would answer each.
 */
function useInventory(data: {
  loadBalancers: Array<CloudResource>;
  subnets?: Array<CloudResource>;
}): void {
  getJestSpyOn(CloudResourceService, "findBy").mockImplementation(
    (async (args: { query: Record<string, unknown> }) => {
      if (args.query["cloudResourceType"] === GCP_SUBNETWORK_TYPE) {
        return data.subnets || [];
      }

      return data.loadBalancers;
    }) as never,
  );
}

function useProject(columns: Partial<Project>): void {
  const project: Project = new Project();
  Object.assign(project, columns);

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project as never,
  );
}

// A request with an attack in it, through a connection from `peer`, carrying `forwardedFor`.
function span(peer: string, forwardedFor: string): TraceScanSpan {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-28T10:00:00.000Z"),
    serviceId: "0192f1a0-0000-7000-8000-00000000c001",
    serviceType: "OpenTelemetry",
    isLlmSpan: false,
    llmUserMessagePreview: "",
    llmUserId: "",
    llmSystem: "",
    llmRequestModel: "",
    llmOperation: "",
    attributes: {
      "http.request.method": "GET",
      "url.path": "/download",
      "url.query": "file=../../../../etc/passwd",
      "http.response.status_code": "404",
      "network.peer.address": peer,
      "http.request.header.x-forwarded-for": forwardedFor,
    },
  };
}

async function readSpan(
  peer: string,
  forwardedFor: string,
): Promise<{ event: NormalizedSecurityEvent; proxies: TrustedProxies }> {
  const proxies: TrustedProxies =
    await SecurityTrustedProxies.getForProject(PROJECT_ID);
  const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
    span(peer, forwardedFor),
    { trustedProxies: proxies },
  );

  expect(events).toHaveLength(1);

  return { event: events[0]!, proxies };
}

function texts(blocks: Array<NetworkAddressBlock>): Array<string> {
  return blocks.map((block: NetworkAddressBlock): string => {
    return block.text;
  });
}

async function readAll(): Promise<SecurityOwnLoadBalancersRead> {
  return await SecurityOwnLoadBalancers.read({
    projectId: PROJECT_ID,
    props: { isRoot: true },
  });
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  SecurityOwnLoadBalancers.setDnsCacheForTests(
    new DnsResolutionCache({
      resolver: async (): Promise<Array<string>> => {
        return [];
      },
    }),
  );
  getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue(
    [] as never,
  );
  useProject({ securityTrustPrivateAddresses: false });
  SecurityTrustedProxies.clearCache();
});

afterEach(() => {
  SecurityTrustedProxies.clearCache();
  SecurityOwnLoadBalancers.setDnsCacheForTests(new DnsResolutionCache());
  jest.restoreAllMocks();
});

describe("a Google Cloud proxy-only subnet", () => {
  test("only an Application Load Balancer uses: listed among the project's load balancers, and trusted as its own", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE],
      subnets: [PROXY_ONLY_SUBNET],
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(
      read.loadBalancers.find(
        (loadBalancer: SecurityOwnLoadBalancersRead["loadBalancers"][0]) => {
          return (
            loadBalancer.kind === OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet
          );
        },
      ),
    ).toEqual(
      expect.objectContaining({
        name: "proxy-only",
        where: "Google Cloud shop",
        addresses: [PROXY_ONLY_RANGE],
      }),
    );
    expect(read.passOnLoadBalancers).toEqual([]);

    const blocks: SecurityOwnLoadBalancerBlocks =
      await SecurityOwnLoadBalancers.getTrusted(PROJECT_ID);

    expect(texts(blocks.loadBalancers)).toContain(PROXY_ONLY_RANGE);
    expect(blocks.untrusted).toEqual([]);
  });

  test("so a project that stopped trusting private addresses still verifies the client the load balancer forwarded", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE],
      subnets: [PROXY_ONLY_SUBNET],
    });

    const { event } = await readSpan(
      PROXY_ONLY_PEER,
      `${VICTIM}, ${CLIENT}, 10.128.0.9`,
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readClaimedClientAddress(event)?.address).toBe(VICTIM);
  });

  test("a proxy Network Load Balancer uses too: never trusted, whatever lists it, and said with why", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE, DB_RULE],
      subnets: [PROXY_ONLY_SUBNET],
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(
      read.loadBalancers.map(
        (loadBalancer: SecurityOwnLoadBalancersRead["loadBalancers"][0]) => {
          return loadBalancer.kind;
        },
      ),
    ).not.toContain(OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet);
    expect(read.passOnLoadBalancers).toEqual([
      {
        kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
        name: "db-tcp",
        where: "Google Cloud shop",
        reasons: [PassOnReason.ProxyOnlySubnet],
        targetGroups: [],
        ranges: [PROXY_ONLY_RANGE],
        areRangesIncomplete: false,
      },
    ]);

    // Listed, and private addresses trusted: the subnet is still never trusted.
    useProject({
      securityTrustPrivateAddresses: true,
      securityTrustedProxies: "10.0.0.0/8",
    });

    const { event, proxies } = await readSpan(PROXY_ONLY_PEER, VICTIM);

    expect(isTrustedProxy(PROXY_ONLY_PEER, proxies)).toBe(false);
    expect(event.principalIp).toBe(PROXY_ONLY_PEER);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)?.address).toBe(VICTIM);
    expect(event.observables).not.toContain(VICTIM);
  });

  test("never trusted with Your Load Balancers off either: it is not a load balancer of the project's that is untrusted, but where one passes on", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE, DB_RULE],
      subnets: [PROXY_ONLY_SUBNET],
    });
    useProject({
      securityTrustOwnLoadBalancers: false,
      securityTrustPrivateAddresses: true,
    });

    const { proxies } = await readSpan(PROXY_ONLY_PEER, VICTIM);

    expect(isTrustedProxy(PROXY_ONLY_PEER, proxies)).toBe(false);
    expect(isTrustedProxy("10.128.0.9", proxies)).toBe(true);
  });

  test("a subnet both searches find is read once, and what is no subnet is dropped", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE],
      subnets: [PROXY_ONLY_SUBNET, PROXY_ONLY_SUBNET, ORDERS_RULE],
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(
      read.loadBalancers.filter(
        (loadBalancer: SecurityOwnLoadBalancersRead["loadBalancers"][0]) => {
          return (
            loadBalancer.kind === OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet
          );
        },
      ),
    ).toHaveLength(1);
  });

  test("more subnets than a search takes: the read says it is not complete", async () => {
    useInventory({
      loadBalancers: [ORDERS_RULE],
      subnets: Array.from(
        { length: OWN_PROXY_ONLY_SUBNET_ROWS_READ + 1 },
        (): CloudResource => {
          return PROXY_ONLY_SUBNET;
        },
      ),
    });

    expect((await readAll()).isComplete).toBe(false);
  });
});

describe("Google's front ends, while a TCP or SSL proxy load balancer connects from them (#11388)", () => {
  test("are never trusted: not brought by the Application Load Balancer, and not listed", async () => {
    useInventory({ loadBalancers: [SHOP_RULE, MAIL_RULE] });
    useProject({
      securityTrustPrivateAddresses: false,
      // As the old docs said to list them.
      securityTrustedProxies: "35.191.0.0/16\n130.211.0.0/22",
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(read.googleFrontEnds?.isTrusted).toBe(false);
    expect(read.googleFrontEnds?.withheldBy).toEqual([
      { name: "mail-tcp", where: "Google Cloud shop" },
    ]);
    expect(read.passOnLoadBalancers).toEqual([
      expect.objectContaining({
        name: "mail-tcp",
        reasons: [PassOnReason.GoogleFrontEnds],
        ranges: [...GOOGLE_FRONT_END_RANGES],
      }),
    ]);

    const { event, proxies } = await readSpan("35.191.4.8", VICTIM);

    expect(isTrustedProxy("35.191.4.8", proxies)).toBe(false);
    expect(isTrustedProxy("130.211.1.1", proxies)).toBe(false);
    expect(event.principalIp).toBe("35.191.4.8");
    expect(readClaimedClientAddress(event)?.address).toBe(VICTIM);
  });

  test("with no such load balancer, the Application Load Balancer brings them, and its client is verified", async () => {
    useInventory({ loadBalancers: [SHOP_RULE] });

    const { event, proxies } = await readSpan(
      "35.191.4.8",
      `${VICTIM}, ${CLIENT}, 34.120.1.2`,
    );

    expect(isTrustedProxy("35.191.4.8", proxies)).toBe(true);
    expect(event.principalIp).toBe(CLIENT);
    // Vouched for: the front ends and the load balancer are the project's own.
    expect(readUnvouchedForwarding(event, proxies)).toBeNull();
  });
});

describe("an AWS Network Load Balancer", () => {
  test("that drops the client's address: never trusted from its subnets", async () => {
    useInventory({
      loadBalancers: [
        nlb("tcp-ingress", AwsClientIpPreservation.Off, [
          "10.0.1.0/24",
          "10.0.2.0/24",
        ]),
      ],
    });
    useProject({
      securityTrustPrivateAddresses: true,
      securityTrustedProxies: "10.0.0.0/16",
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(read.passOnLoadBalancers).toEqual([
      {
        kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
        name: "tcp-ingress",
        where: "Production AWS",
        reasons: [PassOnReason.ClientIpNotPreserved],
        targetGroups: ["tcp-ingress-ip"],
        ranges: ["10.0.1.0/24", "10.0.2.0/24"],
        areRangesIncomplete: false,
      },
    ]);

    const { event, proxies } = await readSpan("10.0.1.57", VICTIM);

    expect(event.principalIp).toBe("10.0.1.57");
    expect(readClaimedClientAddress(event)?.address).toBe(VICTIM);
    // The rest of the listed range is still the project's proxies.
    expect(isTrustedProxy("10.0.9.4", proxies)).toBe(true);
  });

  test("that keeps it: nothing untrusted, and its client's own connection is the address", async () => {
    useInventory({
      loadBalancers: [nlb("game", AwsClientIpPreservation.On, ["10.0.3.0/24"])],
    });

    const blocks: SecurityOwnLoadBalancerBlocks =
      await SecurityOwnLoadBalancers.getTrusted(PROJECT_ID);

    expect(blocks.untrusted).toEqual([]);
    expect((await readAll()).passOnLoadBalancers).toEqual([]);
  });

  test("a read of them that fails trusts no private address meanwhile: what passes on is what was not read", async () => {
    getJestSpyOn(CloudResourceService, "findBy").mockRejectedValue(
      new Error("connection refused") as never,
    );
    useProject({
      securityTrustPrivateAddresses: true,
      securityTrustedProxies: "198.18.0.0/15",
    });

    const { event, proxies } = await readSpan("10.0.1.57", VICTIM);

    expect(proxies.trustsPrivateAddresses).toBe(false);
    expect(isTrustedProxy("198.18.0.9", proxies)).toBe(true);
    expect(event.principalIp).toBe("10.0.1.57");
    expect(readClaimedClientAddress(event)?.address).toBe(VICTIM);
  });

  test("an edge read that fails trusts no private address meanwhile either", async () => {
    useInventory({ loadBalancers: [] });
    getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockRejectedValue(
      new Error("connection refused") as never,
    );
    useProject({ securityTrustPrivateAddresses: true });

    const { proxies } = await readSpan("10.0.1.57", VICTIM);

    expect(proxies.trustsPrivateAddresses).toBe(false);
    expect(isTrustedProxy("10.0.1.57", proxies)).toBe(false);
  });

  test("whose target groups could not be read is not trusted either, and says so", async () => {
    useInventory({
      loadBalancers: [
        nlb("legacy-tcp", AwsClientIpPreservation.Unknown, ["10.0.4.0/24"]),
      ],
    });

    const read: SecurityOwnLoadBalancersRead = await readAll();

    expect(read.passOnLoadBalancers[0]?.reasons).toEqual([
      PassOnReason.ClientIpUnknown,
    ]);
    expect(
      texts((await SecurityOwnLoadBalancers.getTrusted(PROJECT_ID)).untrusted),
    ).toEqual(["10.0.4.0/24"]);
  });
});
