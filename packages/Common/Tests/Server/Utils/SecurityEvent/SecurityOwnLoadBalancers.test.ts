import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import DnsResolutionCache from "../../../../Server/Utils/Monitor/DnsResolutionCache";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers, {
  OWN_LOAD_BALANCER_NAMES_RESOLVED,
  OWN_LOAD_BALANCER_ROWS_READ,
  OWN_PROXY_ONLY_SUBNET_ROWS_READ,
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
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import WebAttackLogParser from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  AWS_CLASSIC_LOAD_BALANCER_TYPE,
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  AZURE_PUBLIC_IP_ADDRESS_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  OWN_LOAD_BALANCER_RESOURCE_TYPES,
  OwnLoadBalancerKind,
} from "../../../../Utils/SecurityEvent/OwnLoadBalancers";
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

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * #10546: THE PROJECT'S OWN LOAD BALANCERS ARE TRUSTED AS PROXIES - AND
 * NOTHING ELSE OF ITS OWN IS.
 *
 * A project whose application load balancer has a public address had that
 * address blamed for every attack it forwarded - a Google Cloud Application
 * Load Balancer appends its own address to X-Forwarded-For after the
 * client's, an Azure Application Gateway connects to a public backend from
 * its own - unless someone listed it under Trusted Proxies. Now the load
 * balancers a project's connected cloud accounts list are trusted, unless
 * the project turns that off.
 *
 * Trusting an address is believing the X-Forwarded-For it passes on. So
 * these suites forge that header through every one of the project's own
 * addresses that must not be trusted - a host, a Kubernetes node, a probe,
 * an EC2 instance, a NAT gateway, a Network Load Balancer, an Azure Load
 * Balancer - and check that nothing the sender wrote is ever blamed. The
 * database is stubbed; the reading, the trust and the trace scan's own
 * reading of a span are real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10546000-0000-4000-8000-000000000001",
);

// What a sender wrote, and the client a load balancer forwarded.
const SENDERS_CLAIM: string = "192.0.2.44";
const CLIENT: string = "203.0.113.7";

// The project's own load balancers' public addresses.
const ALB_DNS: string = "web-1234567890.us-east-1.elb.amazonaws.com";
const ALB_ADDRESS: string = "52.1.2.3";
const ALB_IPV6_ADDRESS: string = "2600:1f18:4000::7";
// What its name resolves to inside the VPC as well.
const ALB_PRIVATE_ADDRESS: string = "10.0.1.20";
const CLASSIC_DNS: string = "legacy-1.us-east-1.elb.amazonaws.com";
const CLASSIC_ADDRESS: string = "52.1.9.9";
const GOOGLE_LB_ADDRESS: string = "34.120.1.2";
const GATEWAY_ADDRESS: string = "20.50.1.7";

// The project's own addresses that must never be trusted.
const NLB_DNS: string = "tcp-1.elb.us-east-1.amazonaws.com";
const NLB_ADDRESS: string = "52.7.7.7";
const NAT_GATEWAY_ADDRESS: string = "52.8.8.8";
const INSTANCE_ADDRESS: string = "54.9.9.9";
const AZURE_LOAD_BALANCER_ADDRESS: string = "20.60.6.6";
const HOST_ADDRESS: string = "198.51.100.20";
const NODE_ADDRESS: string = "198.51.100.30";
const PROBE_ADDRESS: string = "198.51.100.40";

const AZURE_PREFIX: string =
  "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network";

function resource(data: Record<string, unknown>): CloudResource {
  const row: CloudResource = new CloudResource();

  Object.assign(row, {
    _id: ObjectID.generate().toString(),
    cloudConnection: { name: data["where"] || "Production" },
    ...data,
  });

  return row;
}

// The project's cloud inventory: every kind of resource, the load balancers among them.
function inventory(): Array<CloudResource> {
  return [
    resource({
      name: "web",
      cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
      providerResourceId:
        "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/50dc6c495c0c9188",
      cloudProperties: { Type: "application", Scheme: "internet-facing" },
      cloudEndpoints: [ALB_DNS],
      where: "AWS production",
    }),
    resource({
      name: "legacy-web",
      cloudResourceType: AWS_CLASSIC_LOAD_BALANCER_TYPE,
      cloudProperties: { Listeners: ["HTTPS:443 -> HTTP:8080"] },
      cloudEndpoints: [CLASSIC_DNS],
    }),
    resource({
      name: "web-https",
      cloudResourceType: GCP_FORWARDING_RULE_TYPE,
      cloudProperties: { IPAddress: GOOGLE_LB_ADDRESS },
      cloudRelationships: [
        {
          kind: CloudRelationshipKind.RoutesTo,
          target: "//compute.googleapis.com/projects/shop/global/urlMaps/web",
          targetType: "https_lb_rule",
        },
      ],
      where: "Google Cloud shop",
    }),
    resource({
      name: "web-pip",
      cloudResourceType: AZURE_PUBLIC_IP_ADDRESS_TYPE,
      cloudEndpoints: [GATEWAY_ADDRESS],
      cloudRelationships: [
        {
          kind: CloudRelationshipKind.AttachedTo,
          target: `${AZURE_PREFIX}/applicationGateways/web-agw`,
        },
      ],
      where: "Azure subscription",
    }),
    // Never trusted: a layer 4 load balancer, a NAT gateway, a machine, an Azure Load Balancer.
    resource({
      name: "tcp",
      cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
      cloudProperties: { Type: "network" },
      cloudEndpoints: [NLB_DNS, NLB_ADDRESS],
    }),
    resource({
      name: "egress",
      cloudResourceType: "AWS::EC2::NatGateway",
      cloudEndpoints: [NAT_GATEWAY_ADDRESS],
    }),
    resource({
      name: "app-server",
      cloudResourceType: "AWS::EC2::Instance",
      cloudEndpoints: [INSTANCE_ADDRESS],
    }),
    resource({
      name: "kubernetes-pip",
      cloudResourceType: AZURE_PUBLIC_IP_ADDRESS_TYPE,
      cloudEndpoints: [AZURE_LOAD_BALANCER_ADDRESS],
      cloudRelationships: [
        {
          kind: CloudRelationshipKind.AttachedTo,
          target: `${AZURE_PREFIX}/loadBalancers/kubernetes`,
        },
      ],
    }),
  ];
}

// DNS as the test says it: each name's addresses, or a lookup that fails.
function useDns(answers: Record<string, Array<string> | "fail">): {
  asked: Array<string>;
} {
  const asked: Array<string> = [];

  SecurityOwnLoadBalancers.setDnsCacheForTests(
    new DnsResolutionCache({
      resolver: async (hostname: string): Promise<Array<string>> => {
        asked.push(hostname);
        const answer: Array<string> | "fail" | undefined = answers[hostname];

        if (answer === "fail" || answer === undefined) {
          throw new Error(`DNS lookup for ${hostname} timed out`);
        }

        return answer;
      },
    }),
  );

  return { asked };
}

let findResources: SpyInstance;

function useInventory(rows: Array<CloudResource>): void {
  findResources = getJestSpyOn(
    CloudResourceService,
    "findBy",
  ).mockResolvedValue(rows as never);
}

function useProject(columns: Partial<Project>): void {
  const project: Project = new Project();
  Object.assign(project, columns);

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
    project as never,
  );
}

function useEdges(edges: Array<typeof CLOUDFLARE_EDGE>): void {
  getJestSpyOn(SecurityEdgeRanges, "findConnectedEdges").mockResolvedValue(
    edges as never,
  );
  getJestSpyOn(SecurityEdgeRanges, "getRanges").mockResolvedValue([
    "104.16.0.0/13",
  ] as never);
}

// A request with an attack in it, through a connection from `peer`, carrying `forwardedFor`.
function span(peer: string, forwardedFor?: string): TraceScanSpan {
  return {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-20T10:00:00.000Z"),
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
      ...(forwardedFor
        ? { "http.request.header.x-forwarded-for": forwardedFor }
        : {}),
    },
  };
}

async function readSpan(
  peer: string,
  forwardedFor?: string,
): Promise<NormalizedSecurityEvent> {
  const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
    span(peer, forwardedFor),
    {
      trustedProxies: await SecurityTrustedProxies.getForProject(PROJECT_ID),
    },
  );

  expect(events).toHaveLength(1);

  return events[0]!;
}

function blockTexts(proxies: TrustedProxies): Array<string> {
  return proxies.blocks.map((block: NetworkAddressBlock): string => {
    return block.text;
  });
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  useInventory(inventory());
  useDns({
    [ALB_DNS]: [ALB_ADDRESS, ALB_IPV6_ADDRESS, ALB_PRIVATE_ADDRESS],
    [CLASSIC_DNS]: [CLASSIC_ADDRESS],
    [NLB_DNS]: [NLB_ADDRESS],
  });
  useProject({});
  useEdges([]);

  SecurityTrustedProxies.clearCache();
});

afterEach(() => {
  SecurityTrustedProxies.clearCache();
  SecurityOwnLoadBalancers.setDnsCacheForTests(new DnsResolutionCache());
  jest.restoreAllMocks();
});

/*
 * The queries one read makes: the load balancers of the four types, and
 * the project's Google Cloud proxy-only subnets, by the two purposes that
 * name one (#11389).
 */
const QUERIES_A_READ: number = 3;

describe("reading the project's own load balancers", () => {
  test("one bounded query of the four types, and two of the proxy-only subnets, as the reader reads", async () => {
    await SecurityOwnLoadBalancers.read({
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });

    expect(findResources).toHaveBeenCalledTimes(QUERIES_A_READ);

    const asked: {
      query: Record<string, unknown>;
      limit: number;
      props: unknown;
      select: Record<string, unknown>;
    } = findResources.mock.calls[0]![0] as never;

    // The proxy-only subnets: of Google Cloud's subnet type, bounded, as the reader reads.
    for (const call of findResources.mock.calls.slice(1)) {
      const subnets: {
        query: Record<string, unknown>;
        limit: number;
        props: unknown;
      } = call[0] as never;

      expect(subnets.query["projectId"]).toEqual(PROJECT_ID);
      expect(subnets.query["isArchived"]).toBe(false);
      expect(subnets.query["cloudResourceType"]).toBe(
        "compute.googleapis.com/Subnetwork",
      );
      expect(subnets.limit).toBe(OWN_PROXY_ONLY_SUBNET_ROWS_READ + 1);
      expect(subnets.props).toEqual({ isRoot: true });
    }

    expect(
      findResources.mock.calls.slice(1).map((call: Array<unknown>): string => {
        return JSON.stringify(
          (call[0] as { query: Record<string, unknown> }).query[
            "cloudProperties"
          ],
        );
      }),
    ).toEqual([
      expect.stringContaining("managed\\\\_proxy"),
      expect.stringContaining("internal\\\\_https\\\\_load\\\\_balancer"),
    ]);

    expect(asked.query["projectId"]).toEqual(PROJECT_ID);
    expect(asked.query["isArchived"]).toBe(false);
    expect(JSON.stringify(asked.query["cloudResourceType"])).toContain(
      AWS_ELBV2_LOAD_BALANCER_TYPE,
    );
    for (const type of OWN_LOAD_BALANCER_RESOURCE_TYPES) {
      expect(JSON.stringify(asked.query["cloudResourceType"])).toContain(type);
    }
    expect(asked.limit).toBe(OWN_LOAD_BALANCER_ROWS_READ + 1);
    expect(asked.props).toEqual({ isRoot: true });
    expect(Object.keys(asked.select).sort()).toEqual(
      [
        "_id",
        "cloudConnection",
        "cloudEndpoints",
        "cloudProperties",
        "cloudRelationships",
        "cloudResourceType",
        "name",
        "providerResourceId",
      ].sort(),
    );
  });

  // #11389: its private addresses too, which a project that stops trusting private addresses still trusts.
  test("each that forwards clients, with its addresses, its kind and its cloud account", async () => {
    const read: SecurityOwnLoadBalancersRead =
      await SecurityOwnLoadBalancers.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      });

    expect(read.isComplete).toBe(true);
    expect(
      read.loadBalancers.map(
        (loadBalancer: SecurityOwnLoadBalancersRead["loadBalancers"][0]) => {
          return {
            kind: loadBalancer.kind,
            name: loadBalancer.name,
            where: loadBalancer.where,
            addresses: loadBalancer.addresses,
          };
        },
      ),
    ).toEqual([
      {
        kind: OwnLoadBalancerKind.AwsApplicationLoadBalancer,
        name: "web",
        where: "AWS production",
        addresses: [ALB_ADDRESS, ALB_IPV6_ADDRESS, ALB_PRIVATE_ADDRESS],
      },
      {
        kind: OwnLoadBalancerKind.AwsClassicLoadBalancer,
        name: "legacy-web",
        where: "Production",
        addresses: [CLASSIC_ADDRESS],
      },
      {
        kind: OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer,
        name: "web-https",
        where: "Google Cloud shop",
        addresses: [GOOGLE_LB_ADDRESS],
      },
      {
        kind: OwnLoadBalancerKind.AzureApplicationGateway,
        name: "web-agw",
        where: "Azure subscription",
        addresses: [GATEWAY_ADDRESS],
      },
    ]);
  });

  test("a layer 4 load balancer, a NAT gateway, a machine and an Azure Load Balancer are never among them, nor is a name of theirs looked up", async () => {
    const dns: { asked: Array<string> } = useDns({
      [ALB_DNS]: [ALB_ADDRESS],
      [CLASSIC_DNS]: [CLASSIC_ADDRESS],
      [NLB_DNS]: [NLB_ADDRESS],
    });
    const read: SecurityOwnLoadBalancersRead =
      await SecurityOwnLoadBalancers.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      });
    const addresses: Array<string> = read.loadBalancers.flatMap(
      (loadBalancer: SecurityOwnLoadBalancersRead["loadBalancers"][0]) => {
        return loadBalancer.addresses;
      },
    );

    for (const notAProxy of [
      NLB_ADDRESS,
      NAT_GATEWAY_ADDRESS,
      INSTANCE_ADDRESS,
      AZURE_LOAD_BALANCER_ADDRESS,
    ]) {
      expect(addresses).not.toContain(notAProxy);
    }

    expect(dns.asked).not.toContain(NLB_DNS);
  });

  test("a name whose lookup failed adds no address, and the read says it is not complete", async () => {
    useDns({ [ALB_DNS]: "fail", [CLASSIC_DNS]: [CLASSIC_ADDRESS] });

    const read: SecurityOwnLoadBalancersRead =
      await SecurityOwnLoadBalancers.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      });

    expect(read.isComplete).toBe(false);
    expect(
      read.loadBalancers.map((loadBalancer: { name: string }): string => {
        return loadBalancer.name;
      }),
    ).toEqual(["legacy-web", "web-https", "web-agw"]);
  });

  test("more rows than one read takes: what was read, said not to be complete", async () => {
    const rows: Array<CloudResource> = Array.from(
      { length: OWN_LOAD_BALANCER_ROWS_READ + 1 },
      (): CloudResource => {
        return inventory()[2]!;
      },
    );

    useInventory(rows);

    const read: SecurityOwnLoadBalancersRead =
      await SecurityOwnLoadBalancers.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      });

    expect(read.isComplete).toBe(false);
    expect(read.loadBalancers).toHaveLength(OWN_LOAD_BALANCER_ROWS_READ);
  });

  test("no more names are looked up than one read allows", async () => {
    const answers: Record<string, Array<string>> = {};
    const rows: Array<CloudResource> = Array.from(
      { length: OWN_LOAD_BALANCER_NAMES_RESOLVED + 5 },
      (_value: unknown, index: number): CloudResource => {
        const name: string = `alb-${index}.elb.amazonaws.com`;
        answers[name] = [`52.10.${Math.floor(index / 200)}.${index % 200}`];

        return resource({
          name: `alb-${index}`,
          cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
          cloudProperties: { Type: "application" },
          cloudEndpoints: [name],
        });
      },
    );

    useInventory(rows);
    const dns: { asked: Array<string> } = useDns(answers);

    const read: SecurityOwnLoadBalancersRead =
      await SecurityOwnLoadBalancers.read({
        projectId: PROJECT_ID,
        props: { isRoot: true },
      });

    expect(dns.asked).toHaveLength(OWN_LOAD_BALANCER_NAMES_RESOLVED);
    expect(read.loadBalancers).toHaveLength(OWN_LOAD_BALANCER_NAMES_RESOLVED);
    expect(read.isComplete).toBe(false);
  });
});

describe("what the scans trust", () => {
  test("the load balancers' addresses, read as OneUptime, kept for five minutes", async () => {
    const blocks: Array<NetworkAddressBlock> =
      await SecurityOwnLoadBalancers.getTrustedBlocks(PROJECT_ID);

    expect(
      blocks.map((block: NetworkAddressBlock): string => {
        return block.text;
      }),
    ).toEqual([
      `${ALB_ADDRESS}`,
      ALB_IPV6_ADDRESS,
      ALB_PRIVATE_ADDRESS,
      `${CLASSIC_ADDRESS}`,
      `${GOOGLE_LB_ADDRESS}`,
      `${GATEWAY_ADDRESS}`,
    ]);

    await SecurityOwnLoadBalancers.getTrustedBlocks(PROJECT_ID);

    expect(findResources).toHaveBeenCalledTimes(QUERIES_A_READ);
    for (const call of findResources.mock.calls) {
      expect((call[0] as { props: unknown }).props).toEqual({ isRoot: true });
    }
  });

  test("a read that fails throws, and keeps nothing: the next scan reads again", async () => {
    findResources.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      SecurityOwnLoadBalancers.getTrustedBlocks(PROJECT_ID),
    ).rejects.toThrow("connection refused");

    expect(
      (await SecurityOwnLoadBalancers.getTrustedBlocks(PROJECT_ID)).length,
    ).toBe(6);
    // The failed read stopped at its first query; the next read made all of its own.
    expect(findResources).toHaveBeenCalledTimes(1 + QUERIES_A_READ);
  });

  test("a proxy-only subnet search that fails throws as well: what passes on a client's words is never guessed at", async () => {
    findResources
      .mockResolvedValueOnce(inventory() as never)
      .mockRejectedValueOnce(new Error("connection refused") as never);

    await expect(
      SecurityOwnLoadBalancers.getTrusted(PROJECT_ID),
    ).rejects.toThrow("connection refused");
  });

  test("on for a project that never said, beside its Trusted Proxies and edges", async () => {
    useProject({ securityTrustedProxies: "198.18.0.0/15" });
    useEdges([CLOUDFLARE_EDGE]);

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(blockTexts(proxies)).toEqual([
      "198.18.0.0/15",
      "104.16.0.0/13",
      `${ALB_ADDRESS}`,
      ALB_IPV6_ADDRESS,
      ALB_PRIVATE_ADDRESS,
      `${CLASSIC_ADDRESS}`,
      `${GOOGLE_LB_ADDRESS}`,
      `${GATEWAY_ADDRESS}`,
    ]);
  });

  /*
   * #11389: the inventory is still read, for where a load balancer of the
   * project's that passes on what a client wrote connects from - which is
   * never trusted, whether or not its own load balancers are.
   */
  test("turned off, none of them is trusted, and the inventory is read only for what is never trusted", async () => {
    useProject({ securityTrustOwnLoadBalancers: false });

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(proxies.blocks).toEqual([]);
    expect(findResources).toHaveBeenCalledTimes(QUERIES_A_READ);
    expect(isTrustedProxy(GATEWAY_ADDRESS, proxies)).toBe(false);
    expect(isTrustedProxy(ALB_ADDRESS, proxies)).toBe(false);
  });

  test("a load balancer read that fails trusts the rest, and is read again on the next scan", async () => {
    useProject({ securityTrustedProxies: "198.18.0.0/15" });
    findResources.mockRejectedValueOnce(new Error("connection refused"));

    const first: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(blockTexts(first)).toEqual(["198.18.0.0/15"]);

    const second: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(blockTexts(second)).toContain(`${GATEWAY_ADDRESS}`);
    expect(findResources).toHaveBeenCalledTimes(1 + QUERIES_A_READ);
  });

  test("the project's hosts, nodes and probes are never read for it", async () => {
    const hosts: SpyInstance = getJestSpyOn(HostService, "findBy");
    const nodes: SpyInstance = getJestSpyOn(
      KubernetesResourceService,
      "findBy",
    );
    const probes: SpyInstance = getJestSpyOn(ProbeService, "findBy");

    await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(hosts).not.toHaveBeenCalled();
    expect(nodes).not.toHaveBeenCalled();
    expect(probes).not.toHaveBeenCalled();
  });

  test("whether the access logs end with X-Forwarded-For is the project's to say, off unless it does", async () => {
    expect(
      (await SecurityTrustedProxies.getForProject(PROJECT_ID))
        .readsAccessLogForwardedFor,
    ).toBe(false);

    SecurityTrustedProxies.clearCache();
    useProject({ securityReadAccessLogForwardedFor: true });

    expect(
      (await SecurityTrustedProxies.getForProject(PROJECT_ID))
        .readsAccessLogForwardedFor,
    ).toBe(true);
  });

  /*
   * #11389: not even a private address, which the project may have turned
   * off. A read that fails trusts less, never more: every address a proxy
   * forwarded is claimed until the next scan reads the project again.
   */
  test("a project read that fails trusts nothing, not even a private address", async () => {
    getJestSpyOn(ProjectService, "findOneById").mockRejectedValue(
      new Error("connection refused") as never,
    );

    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    expect(proxies.blocks).toEqual([]);
    expect(proxies.trustsPrivateAddresses).toBe(false);
    expect(isTrustedProxy("10.0.0.5", proxies)).toBe(false);
    expect(proxies.readsAccessLogForwardedFor).toBeFalsy();
    expect(findResources).not.toHaveBeenCalled();
  });
});

describe("a request through one of the project's load balancers", () => {
  test("an Application Gateway that connects from its public address: the client it forwarded, verified (the issue's first test)", async () => {
    const event: NormalizedSecurityEvent = await readSpan(
      GATEWAY_ADDRESS,
      `${SENDERS_CLAIM}, ${CLIENT}`,
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
    expect(readClaimedClientAddress(event)?.address).toBe(SENDERS_CLAIM);
  });

  test("a Google Cloud load balancer whose address its proxy appended after the client's, behind a private proxy subnet", async () => {
    const event: NormalizedSecurityEvent = await readSpan(
      "10.129.0.5",
      `${SENDERS_CLAIM}, ${CLIENT}, ${GOOGLE_LB_ADDRESS}`,
    );

    expect(event.principalIp).toBe(CLIENT);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("an Application Load Balancer's IPv6 address, forwarding an IPv6 client", async () => {
    const event: NormalizedSecurityEvent = await readSpan(
      ALB_IPV6_ADDRESS,
      "2001:db8::44, 2001:db8::7",
    );

    expect(event.principalIp).toBe("2001:db8::7");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.TrustedProxy);
  });

  test("the same request when the load balancers cannot be read: the gateway's own address, and nothing the sender wrote blamed (the issue's second test)", async () => {
    findResources.mockRejectedValue(new Error("connection refused"));

    const event: NormalizedSecurityEvent = await readSpan(
      GATEWAY_ADDRESS,
      `${SENDERS_CLAIM}, ${CLIENT}`,
    );

    expect(event.principalIp).toBe(GATEWAY_ADDRESS);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(event.observables).not.toContain(SENDERS_CLAIM);
    expect(event.observables).not.toContain(CLIENT);
  });

  test("with the switch off: the gateway's own address, and the sender's words a claim", async () => {
    useProject({ securityTrustOwnLoadBalancers: false });

    const event: NormalizedSecurityEvent = await readSpan(
      GATEWAY_ADDRESS,
      `${SENDERS_CLAIM}, ${CLIENT}`,
    );

    expect(event.principalIp).toBe(GATEWAY_ADDRESS);
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
    expect(readClaimedClientAddress(event)?.address).toBe(SENDERS_CLAIM);
  });

  test("with the switch off, a Google Cloud load balancer's own address is what the walk stops at, as before", async () => {
    useProject({ securityTrustOwnLoadBalancers: false });

    const event: NormalizedSecurityEvent = await readSpan(
      "10.129.0.5",
      `${SENDERS_CLAIM}, ${CLIENT}, ${GOOGLE_LB_ADDRESS}`,
    );

    expect(event.principalIp).toBe(GOOGLE_LB_ADDRESS);
  });
});

describe("a header forged through the project's own addresses that must not be trusted names nobody but them", () => {
  const notProxies: Array<[string, string]> = [
    ["a host's public address", HOST_ADDRESS],
    ["a Kubernetes node's ExternalIP", NODE_ADDRESS],
    ["a probe's address", PROBE_ADDRESS],
    ["an EC2 instance", INSTANCE_ADDRESS],
    ["a NAT gateway", NAT_GATEWAY_ADDRESS],
    ["a Network Load Balancer", NLB_ADDRESS],
    ["an Azure Load Balancer", AZURE_LOAD_BALANCER_ADDRESS],
  ];

  test.each(notProxies)("%s", async (_what: string, address: string) => {
    for (const forged of [
      SENDERS_CLAIM,
      `${SENDERS_CLAIM}, ${CLIENT}`,
      `${SENDERS_CLAIM}, ${GATEWAY_ADDRESS}`,
      `${SENDERS_CLAIM}, 10.0.0.9`,
    ]) {
      SecurityTrustedProxies.clearCache();

      const event: NormalizedSecurityEvent = await readSpan(address, forged);

      expect(event.principalIp).toBe(address);
      expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
      expect(readClaimedClientAddress(event)?.address).toBe(SENDERS_CLAIM);
      expect(event.observables).not.toContain(SENDERS_CLAIM);
    }
  });

  test("none of them is among the proxies the scans trust", async () => {
    const proxies: TrustedProxies =
      await SecurityTrustedProxies.getForProject(PROJECT_ID);

    for (const [, address] of notProxies) {
      expect(isTrustedProxy(address, proxies)).toBe(false);
    }
  });

  test("a sender who writes a load balancer's address left of its own is blamed for its own", async () => {
    const event: NormalizedSecurityEvent = await readSpan(
      "10.0.0.5",
      `${SENDERS_CLAIM}, ${GATEWAY_ADDRESS}, 198.51.100.66`,
    );

    expect(event.principalIp).toBe("198.51.100.66");
    expect(event.observables).not.toContain(SENDERS_CLAIM);
  });

  test("a sender that reaches the app straight from a host no proxy, naming a load balancer in its header, is that host", async () => {
    const event: NormalizedSecurityEvent = await readSpan(
      "203.0.113.50",
      `${SENDERS_CLAIM}, ${GATEWAY_ADDRESS}`,
    );

    expect(event.principalIp).toBe("203.0.113.50");
    expect(readClientAddressTrust(event)).toBe(ClientAddressTrust.Peer);
  });
});

describe("an access log line behind one of the project's load balancers (#10548)", () => {
  const LINE: string = `${GATEWAY_ADDRESS} - - [20/Nov/2026:10:00:05 +0000] "GET /download?file=../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.4.0" "${SENDERS_CLAIM}, ${CLIENT}"`;

  async function parseLine(): Promise<NormalizedSecurityEvent> {
    const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse({
      body: LINE,
      attributes: {},
      time: new Date("2026-11-20T10:00:05.000Z"),
      trustedProxies: await SecurityTrustedProxies.getForProject(PROJECT_ID),
    });

    expect(events).toHaveLength(1);

    return events[0]!;
  }

  test("read when the project says its access logs end with X-Forwarded-For", async () => {
    useProject({ securityReadAccessLogForwardedFor: true });

    expect((await parseLine()).principalIp).toBe(CLIENT);
  });

  test("not read when it has not said so", async () => {
    expect((await parseLine()).principalIp).toBe(GATEWAY_ADDRESS);
  });

  test("not read when it said so but turned its load balancers off: the gateway is then no proxy", async () => {
    useProject({
      securityReadAccessLogForwardedFor: true,
      securityTrustOwnLoadBalancers: false,
    });

    expect((await parseLine()).principalIp).toBe(GATEWAY_ADDRESS);
  });
});
