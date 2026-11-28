import { describe, expect, test } from "@jest/globals";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import {
  AWS_CLASSIC_LOAD_BALANCER_TYPE,
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  GOOGLE_FRONT_END_RANGES,
} from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  AWS_PASS_ON_PROPERTIES,
  AwsClientIpPreservation,
  GCP_SUBNETWORK_TYPE,
  GoogleManagedProxyRule,
  GoogleProxyOnlyReading,
  GoogleProxyOnlySubnet,
  PASS_ON_LOAD_BALANCER_PRODUCT_NAMES,
  PassOnLoadBalancerKind,
  PassOnReason,
  PassOnRecord,
  doesRuleUseProxyOnlySubnet,
  isAwsNetworkLoadBalancer,
  isPassOnLoadBalancerKind,
  isPassOnReason,
  readAwsPassOnLoadBalancer,
  readGoogleFrontEndPassOnLoadBalancer,
  readGoogleManagedProxyRule,
  readGoogleProxyOnlySubnet,
  readGoogleProxyOnlySubnetUses,
} from "../../../Utils/SecurityEvent/PassOnLoadBalancers";

/*
 * #11389: THE PROJECT'S LOAD BALANCERS THAT PASS ON WHAT A CLIENT WROTE.
 *
 * A load balancer that works at the TCP level adds nothing to
 * X-Forwarded-For: it passes the header the client wrote on to the app,
 * from its own address. Where that address is private, every project
 * trusted it, and the client chose the address an attack was blamed on.
 * These hold each rule that finds one to the record the cloud inventory
 * keeps of it - an AWS Network Load Balancer with the facts the AWS
 * inventory worked out, a Classic one by its listeners, a Google Cloud
 * proxy Network Load Balancer by its forwarding rule and the proxy-only
 * subnet of its region and network - and says what is never trusted for
 * it: the ranges it connects from.
 */

const NLB_ARN: string =
  "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/tcp-ingress/50dc6c495c0c9188";
const ALB_ARN: string =
  "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/50dc6c495c0c9188";

const SUBNETS: Array<string> = ["10.0.1.0/24", "10.0.2.0/24", "2600:1f18:4000::/56"];

function nlb(properties: Record<string, unknown> = {}): PassOnRecord {
  return {
    cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
    providerResourceId: NLB_ARN,
    name: "tcp-ingress",
    where: "Production AWS",
    cloudProperties: {
      Type: "network",
      Scheme: "internet-facing",
      IpAddressType: "ipv4",
      [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: SUBNETS,
      ...properties,
    },
    cloudEndpoints: ["tcp-ingress-1.elb.us-east-1.amazonaws.com"],
  };
}

function classic(listeners: unknown, properties: Record<string, unknown> = {}): PassOnRecord {
  return {
    cloudResourceType: AWS_CLASSIC_LOAD_BALANCER_TYPE,
    providerResourceId: "legacy",
    name: "legacy",
    where: "Production AWS",
    cloudProperties: {
      Listeners: listeners,
      [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: ["10.0.5.0/24"],
      ...properties,
    },
  };
}

describe("an AWS Network Load Balancer", () => {
  test("whose target groups keep the client's address passes nothing on", () => {
    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.On,
        }),
      ),
    ).toBeNull();
  });

  test("one of whose target groups does not, passes on what the client wrote, from its subnets", () => {
    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
          [AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp]: [
            "ingress-ip",
          ],
        }),
      ),
    ).toEqual({
      kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
      name: "tcp-ingress",
      where: "Production AWS",
      reasons: [PassOnReason.ClientIpNotPreserved],
      targetGroups: ["ingress-ip"],
      ranges: SUBNETS,
      areRangesIncomplete: false,
    });
  });

  test("one read before OneUptime knew to ask, or whose target groups could not be read, is not trusted either", () => {
    for (const preservation of [
      undefined,
      AwsClientIpPreservation.Unknown,
      "",
      "maybe",
      7,
    ]) {
      expect(
        readAwsPassOnLoadBalancer(
          nlb({
            [AWS_PASS_ON_PROPERTIES.clientIpPreservation]: preservation,
          }),
        )?.reasons,
      ).toEqual([PassOnReason.ClientIpUnknown]);
    }
  });

  test("a dualstack one hands a client of the other family to its targets from its own address, whatever its target groups keep", () => {
    for (const type of ["dualstack", "dualstack-without-public-ipv4", "DualStack"]) {
      expect(
        readAwsPassOnLoadBalancer(
          nlb({
            IpAddressType: type,
            [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
              AwsClientIpPreservation.On,
          }),
        )?.reasons,
      ).toEqual([PassOnReason.Dualstack]);
    }

    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          IpAddressType: "dualstack",
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
        }),
      )?.reasons,
    ).toEqual([PassOnReason.ClientIpNotPreserved, PassOnReason.Dualstack]);
  });

  test("its ranges are its subnets', each once however written; none read is said, and so is one subnet unread", () => {
    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
          [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: [
            "10.0.1.0/24",
            "10.0.1.7/24",
            "not a range",
            7,
            "",
          ],
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        ranges: ["10.0.1.0/24"],
        areRangesIncomplete: false,
      }),
    );

    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
          [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: [],
        }),
      ),
    ).toEqual(expect.objectContaining({ ranges: [], areRangesIncomplete: true }));

    expect(
      readAwsPassOnLoadBalancer(
        nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
          [AWS_PASS_ON_PROPERTIES.unreadSubnets]: ["subnet-0b"],
        }),
      ),
    ).toEqual(
      expect.objectContaining({ ranges: SUBNETS, areRangesIncomplete: true }),
    );
  });

  test("is told from its Type, else its ARN; an Application Load Balancer never is one", () => {
    expect(isAwsNetworkLoadBalancer(nlb())).toBe(true);
    expect(
      isAwsNetworkLoadBalancer({ ...nlb(), cloudProperties: { Type: "NETWORK" } }),
    ).toBe(true);
    expect(isAwsNetworkLoadBalancer({ ...nlb(), cloudProperties: {} })).toBe(
      true,
    );
    expect(
      isAwsNetworkLoadBalancer({
        ...nlb(),
        providerResourceId: ALB_ARN,
        cloudProperties: {},
      }),
    ).toBe(false);
    expect(
      isAwsNetworkLoadBalancer({
        ...nlb(),
        cloudProperties: { Type: "application" },
      }),
    ).toBe(false);
    expect(
      isAwsNetworkLoadBalancer({ ...nlb(), cloudProperties: { Type: "gateway" } }),
    ).toBe(false);
    expect(
      readAwsPassOnLoadBalancer({
        ...nlb({
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
        }),
        providerResourceId: ALB_ARN,
        cloudProperties: {
          Type: "application",
          [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
            AwsClientIpPreservation.Off,
        },
      }),
    ).toBeNull();
  });
});

describe("an AWS Classic Load Balancer", () => {
  test("with a TCP or SSL listener passes on what the client wrote, from its subnets", () => {
    for (const listeners of [
      ["TCP:443 -> TCP:8443"],
      ["SSL:443 -> TCP:8080"],
      ["HTTPS:443 -> HTTP:8080", "TCP:22 -> TCP:22"],
    ]) {
      expect(readAwsPassOnLoadBalancer(classic(listeners))).toEqual({
        kind: PassOnLoadBalancerKind.AwsClassicLoadBalancer,
        name: "legacy",
        where: "Production AWS",
        reasons: [PassOnReason.TcpListener],
        targetGroups: [],
        ranges: ["10.0.5.0/24"],
        areRangesIncomplete: false,
      });
    }
  });

  test("whose every listener is HTTP or HTTPS forwards its clients, and passes nothing on", () => {
    expect(
      readAwsPassOnLoadBalancer(
        classic(["HTTPS:443 -> HTTP:8080", "HTTP:80 -> HTTP:8080"]),
      ),
    ).toBeNull();
  });

  test("one whose listeners were not read is not trusted: OneUptime cannot tell", () => {
    for (const listeners of [undefined, [], "TCP:443"]) {
      expect(readAwsPassOnLoadBalancer(classic(listeners))?.reasons).toEqual([
        PassOnReason.TcpListener,
      ]);
    }
  });
});

describe("anything else of the project's", () => {
  test("is no AWS load balancer that passes on", () => {
    for (const cloudResourceType of [
      "AWS::EC2::Instance",
      "AWS::EC2::NatGateway",
      GCP_FORWARDING_RULE_TYPE,
      GCP_SUBNETWORK_TYPE,
      "",
    ]) {
      expect(
        readAwsPassOnLoadBalancer({
          ...nlb({
            [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
              AwsClientIpPreservation.Off,
          }),
          cloudResourceType,
        }),
      ).toBeNull();
    }
  });
});

// Google Cloud, as Cloud Asset Inventory's records hold it (GcpInventory).
const FULL: string = "//compute.googleapis.com/projects/shop-prod";
const NETWORK: string = `${FULL}/global/networks/default`;
const OTHER_NETWORK: string = `${FULL}/global/networks/payments`;

function subnet(data: {
  name?: string;
  region?: string;
  purpose?: string;
  range?: string;
  network?: string | null;
  where?: string;
}): PassOnRecord {
  const region: string = data.region || "us-central1";

  return {
    cloudResourceType: GCP_SUBNETWORK_TYPE,
    providerResourceId: `${FULL}/regions/${region}/subnetworks/${data.name || "proxy-only"}`,
    name: data.name || "proxy-only",
    where: data.where === undefined ? "Google Cloud shop" : data.where,
    cloudProperties: {
      ipCidrRange: data.range || "10.129.0.0/23",
      purpose: data.purpose === undefined ? "REGIONAL_MANAGED_PROXY" : data.purpose,
    },
    cloudRelationships:
      data.network === null
        ? []
        : [
            {
              kind: CloudRelationshipKind.RunsIn,
              target: data.network || NETWORK,
              targetType: "compute.googleapis.com/Network",
            },
          ],
  };
}

function rule(data: {
  name: string;
  region?: string | null;
  scheme: string;
  // What it routes to: a URL map for an Application Load Balancer, a backend service through a TCP proxy for a proxy one.
  routesTo?: { target: string; targetType?: string } | null;
  network?: string | null;
}): PassOnRecord {
  const place: string =
    data.region === null ? "global" : `regions/${data.region || "us-central1"}`;

  return {
    cloudResourceType: GCP_FORWARDING_RULE_TYPE,
    providerResourceId: `${FULL}/${place}/forwardingRules/${data.name}`,
    name: data.name,
    where: "Google Cloud shop",
    cloudProperties: { loadBalancingScheme: data.scheme, IPAddress: "10.0.0.9" },
    cloudRelationships: [
      ...(data.routesTo
        ? [{ kind: CloudRelationshipKind.RoutesTo, ...data.routesTo }]
        : []),
      ...(data.network === null
        ? []
        : [
            {
              kind: CloudRelationshipKind.RunsIn,
              target: data.network || NETWORK,
              targetType: "compute.googleapis.com/Network",
            },
          ]),
    ],
  };
}

const TO_URL_MAP: { target: string; targetType: string } = {
  target: `${FULL}/regions/us-central1/urlMaps/orders`,
  targetType: "compute.googleapis.com/UrlMap",
};

const TO_BACKEND_SERVICE: { target: string; targetType: string } = {
  target: `${FULL}/regions/us-central1/backendServices/db`,
  targetType: "compute.googleapis.com/RegionBackendService",
};

const TO_TCP_PROXY: { target: string } = {
  target: `${FULL}/regions/us-central1/targetTcpProxies/db`,
};

describe("a Google Cloud proxy-only subnet", () => {
  test("is read from a subnet whose purpose names one: regional, its old name, and cross-region", () => {
    expect(readGoogleProxyOnlySubnet(subnet({}))).toEqual({
      name: "proxy-only",
      where: "Google Cloud shop",
      region: "us-central1",
      network: NETWORK.toLowerCase(),
      isGlobal: false,
      ranges: ["10.129.0.0/23"],
    });
    expect(
      readGoogleProxyOnlySubnet(subnet({ purpose: "INTERNAL_HTTPS_LOAD_BALANCER" }))
        ?.isGlobal,
    ).toBe(false);
    expect(
      readGoogleProxyOnlySubnet(subnet({ purpose: "global_managed_proxy" }))
        ?.isGlobal,
    ).toBe(true);
  });

  test("any other subnet is none: a private one, a Private Service Connect one, one with no purpose", () => {
    for (const purpose of ["PRIVATE", "PRIVATE_SERVICE_CONNECT", "PEER_MIGRATION", ""]) {
      expect(readGoogleProxyOnlySubnet(subnet({ purpose }))).toBeNull();
    }

    expect(
      readGoogleProxyOnlySubnet({
        ...subnet({}),
        cloudResourceType: GCP_FORWARDING_RULE_TYPE,
      }),
    ).toBeNull();
  });

  test("its range is kept only when it is a range", () => {
    expect(readGoogleProxyOnlySubnet(subnet({ range: "not a range" }))?.ranges).toEqual(
      [],
    );
    expect(
      readGoogleProxyOnlySubnet(subnet({ range: "10.129.0.1/23" }))?.ranges,
    ).toEqual(["10.129.0.0/23"]);
  });
});

describe("a Google Cloud forwarding rule that connects from a proxy-only subnet", () => {
  test("a regional Application Load Balancer's, external or internal, forwards its clients", () => {
    for (const scheme of ["EXTERNAL_MANAGED", "INTERNAL_MANAGED"]) {
      expect(
        readGoogleManagedProxyRule(
          rule({ name: "orders", scheme, routesTo: TO_URL_MAP }),
        ),
      ).toEqual({
        name: "orders",
        where: "Google Cloud shop",
        region: "us-central1",
        network: NETWORK.toLowerCase(),
        isGlobal: false,
        passesOn: false,
      });
    }
  });

  test("a regional proxy Network Load Balancer's passes on what the client wrote, through its TCP proxy or straight to its backend service", () => {
    for (const routesTo of [TO_BACKEND_SERVICE, TO_TCP_PROXY]) {
      expect(
        readGoogleManagedProxyRule(
          rule({ name: "db", scheme: "EXTERNAL_MANAGED", routesTo }),
        )?.passesOn,
      ).toBe(true);
      expect(
        readGoogleManagedProxyRule(
          rule({ name: "db", scheme: "INTERNAL_MANAGED", routesTo }),
        )?.passesOn,
      ).toBe(true);
    }
  });

  test("one OneUptime cannot tell is an Application Load Balancer is not trusted: it may pass on", () => {
    expect(
      readGoogleManagedProxyRule(
        rule({ name: "unknown", scheme: "INTERNAL_MANAGED", routesTo: null }),
      )?.passesOn,
    ).toBe(true);
  });

  test("a cross-region internal one's is global; a global external one connects from Google's front ends instead", () => {
    expect(
      readGoogleManagedProxyRule(
        rule({
          name: "orders-global",
          region: null,
          scheme: "INTERNAL_MANAGED",
          routesTo: TO_URL_MAP,
        }),
      ),
    ).toEqual(
      expect.objectContaining({ isGlobal: true, region: "", passesOn: false }),
    );
    expect(
      readGoogleManagedProxyRule(
        rule({
          name: "shop-https",
          region: null,
          scheme: "EXTERNAL_MANAGED",
          routesTo: TO_URL_MAP,
        }),
      ),
    ).toBeNull();
  });

  test("a passthrough or classic one connects from no proxy-only subnet", () => {
    for (const scheme of ["EXTERNAL", "INTERNAL", "INTERNAL_SELF_MANAGED", ""]) {
      expect(
        readGoogleManagedProxyRule(
          rule({ name: "lb", scheme, routesTo: TO_BACKEND_SERVICE }),
        ),
      ).toBeNull();
    }
  });
});

describe("whether a rule connects from a subnet", () => {
  function managed(data: Partial<GoogleManagedProxyRule>): GoogleManagedProxyRule {
    return {
      name: "db",
      where: "",
      region: "us-central1",
      network: NETWORK.toLowerCase(),
      isGlobal: false,
      passesOn: true,
      ...data,
    };
  }

  function only(data: Partial<GoogleProxyOnlySubnet>): GoogleProxyOnlySubnet {
    return {
      name: "proxy-only",
      where: "",
      region: "us-central1",
      network: NETWORK.toLowerCase(),
      isGlobal: false,
      ranges: ["10.129.0.0/23"],
      ...data,
    };
  }

  test("one of its region and network does; one of another region or network does not", () => {
    expect(doesRuleUseProxyOnlySubnet(managed({}), only({}))).toBe(true);
    expect(
      doesRuleUseProxyOnlySubnet(managed({}), only({ region: "europe-west1" })),
    ).toBe(false);
    expect(
      doesRuleUseProxyOnlySubnet(
        managed({}),
        only({ network: OTHER_NETWORK.toLowerCase() }),
      ),
    ).toBe(false);
  });

  test("a cross-region rule uses a cross-region subnet in any region of its network, and a regional one never does", () => {
    expect(
      doesRuleUseProxyOnlySubnet(
        managed({ isGlobal: true, region: "" }),
        only({ isGlobal: true, region: "europe-west1" }),
      ),
    ).toBe(true);
    expect(
      doesRuleUseProxyOnlySubnet(managed({}), only({ isGlobal: true })),
    ).toBe(false);
    expect(
      doesRuleUseProxyOnlySubnet(
        managed({ isGlobal: true, region: "" }),
        only({}),
      ),
    ).toBe(false);
  });

  test("a record that names no region or network matches, toward trusting less", () => {
    expect(doesRuleUseProxyOnlySubnet(managed({ network: "" }), only({}))).toBe(
      true,
    );
    expect(doesRuleUseProxyOnlySubnet(managed({}), only({ network: "" }))).toBe(
      true,
    );
    expect(doesRuleUseProxyOnlySubnet(managed({ region: "" }), only({}))).toBe(
      true,
    );
  });
});

describe("which proxy-only subnets the project's load balancers connect from", () => {
  test("one only Application Load Balancers use is theirs, and nothing passes on", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        subnet({}),
        rule({ name: "orders", scheme: "INTERNAL_MANAGED", routesTo: TO_URL_MAP }),
        rule({ name: "shop", scheme: "EXTERNAL_MANAGED", routesTo: TO_URL_MAP }),
      ],
    });

    expect(reading.passOn).toEqual([]);
    expect(reading.uses).toEqual([
      expect.objectContaining({
        passedOnBy: [],
        forwardedBy: ["orders", "shop"],
      }),
    ]);
  });

  test("one a proxy Network Load Balancer uses passes on, whatever Application Load Balancers use it too", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        subnet({}),
        rule({ name: "orders", scheme: "INTERNAL_MANAGED", routesTo: TO_URL_MAP }),
        rule({ name: "db", scheme: "INTERNAL_MANAGED", routesTo: TO_TCP_PROXY }),
      ],
    });

    expect(reading.uses).toEqual([
      expect.objectContaining({ passedOnBy: ["db"], forwardedBy: ["orders"] }),
    ]);
    expect(reading.passOn).toEqual([
      {
        kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
        name: "db",
        where: "Google Cloud shop",
        reasons: [PassOnReason.ProxyOnlySubnet],
        targetGroups: [],
        ranges: ["10.129.0.0/23"],
        areRangesIncomplete: false,
      },
    ]);
  });

  test("a proxy one with no proxy-only subnet of its region and network listed says its ranges could not be read", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        subnet({ region: "europe-west1" }),
        rule({ name: "db", scheme: "EXTERNAL_MANAGED", routesTo: TO_TCP_PROXY }),
      ],
    });

    expect(reading.passOn).toEqual([
      expect.objectContaining({ ranges: [], areRangesIncomplete: true }),
    ]);
    // The other region's subnet is used by nothing: neither trusted nor withheld.
    expect(reading.uses).toEqual([]);
  });

  test("a Shared VPC's subnet, in another connected project, meets the rule by its network", () => {
    const shared: string = "//compute.googleapis.com/projects/network-host/global/networks/shared";
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        {
          ...subnet({ network: shared, where: "Network host" }),
          providerResourceId:
            "//compute.googleapis.com/projects/network-host/regions/us-central1/subnetworks/proxy-only",
        },
        rule({
          name: "db",
          scheme: "INTERNAL_MANAGED",
          routesTo: TO_TCP_PROXY,
          network: shared,
        }),
      ],
    });

    expect(reading.passOn[0]?.ranges).toEqual(["10.129.0.0/23"]);
    expect(reading.uses[0]?.subnet.where).toBe("Network host");
  });

  test("each network's subnet is its own: a proxy one in one network leaves another's Application Load Balancers trusted", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        subnet({ name: "default-proxy" }),
        subnet({
          name: "payments-proxy",
          network: OTHER_NETWORK,
          range: "10.200.0.0/23",
        }),
        rule({ name: "db", scheme: "INTERNAL_MANAGED", routesTo: TO_TCP_PROXY }),
        rule({
          name: "payments",
          scheme: "INTERNAL_MANAGED",
          routesTo: TO_URL_MAP,
          network: OTHER_NETWORK,
        }),
      ],
    });

    expect(
      reading.uses.map(
        (use: GoogleProxyOnlyReading["uses"][0]): [string, Array<string>, Array<string>] => {
          return [use.subnet.name, use.passedOnBy, use.forwardedBy];
        },
      ),
    ).toEqual([
      ["default-proxy", ["db"], []],
      ["payments-proxy", [], ["payments"]],
    ]);
    expect(reading.passOn[0]?.ranges).toEqual(["10.129.0.0/23"]);
  });

  test("a cross-region proxy load balancer connects from every cross-region subnet of its network", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: [
        subnet({ name: "global-a", purpose: "GLOBAL_MANAGED_PROXY" }),
        subnet({
          name: "global-b",
          purpose: "GLOBAL_MANAGED_PROXY",
          region: "europe-west1",
          range: "10.130.0.0/23",
        }),
        subnet({ name: "regional", range: "10.131.0.0/23" }),
        rule({
          name: "db-global",
          region: null,
          scheme: "INTERNAL_MANAGED",
          routesTo: TO_TCP_PROXY,
        }),
      ],
    });

    expect(reading.passOn[0]?.ranges).toEqual(["10.129.0.0/23", "10.130.0.0/23"]);
  });
});

describe("a Google Cloud TCP or SSL proxy load balancer that connects from Google's front ends", () => {
  test("a global external or classic one passes on, from the front ends", () => {
    for (const data of [
      {
        scheme: "EXTERNAL",
        target: `${FULL}/global/targetTcpProxies/db`,
      },
      {
        scheme: "EXTERNAL",
        target: `${FULL}/global/targetSslProxies/mail`,
      },
      {
        scheme: "EXTERNAL_MANAGED",
        target: `${FULL}/global/targetTcpProxies/db`,
      },
    ]) {
      expect(
        readGoogleFrontEndPassOnLoadBalancer(
          rule({
            name: "db-tcp",
            region: null,
            scheme: data.scheme,
            routesTo: { target: data.target },
          }),
        ),
      ).toEqual({
        kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
        name: "db-tcp",
        where: "Google Cloud shop",
        reasons: [PassOnReason.GoogleFrontEnds],
        targetGroups: [],
        ranges: [...GOOGLE_FRONT_END_RANGES],
        areRangesIncomplete: false,
      });
    }
  });

  test("a global Application Load Balancer forwards its clients, and is none", () => {
    expect(
      readGoogleFrontEndPassOnLoadBalancer(
        rule({
          name: "shop-https",
          region: null,
          scheme: "EXTERNAL_MANAGED",
          routesTo: {
            target: `${FULL}/global/urlMaps/shop`,
            targetType: "https_lb_rule",
          },
        }),
      ),
    ).toBeNull();
  });

  test("a regional passthrough Network Load Balancer connects from no front end", () => {
    expect(
      readGoogleFrontEndPassOnLoadBalancer(
        rule({
          name: "game",
          scheme: "EXTERNAL",
          routesTo: TO_BACKEND_SERVICE,
        }),
      ),
    ).toBeNull();
  });
});

describe("the kinds and the reasons", () => {
  test("each kind as its cloud names the product", () => {
    expect(PASS_ON_LOAD_BALANCER_PRODUCT_NAMES).toEqual({
      [PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer]:
        "Google Cloud proxy Network Load Balancer",
      [PassOnLoadBalancerKind.AwsNetworkLoadBalancer]: "AWS Network Load Balancer",
      [PassOnLoadBalancerKind.AwsClassicLoadBalancer]: "AWS Classic Load Balancer",
    });
  });

  test("a kind or a reason is one of them, and nothing else is", () => {
    for (const kind of Object.values(PassOnLoadBalancerKind)) {
      expect(isPassOnLoadBalancerKind(kind)).toBe(true);
    }

    for (const reason of Object.values(PassOnReason)) {
      expect(isPassOnReason(reason)).toBe(true);
    }

    for (const value of ["haproxy", "", null, undefined, 7, {}]) {
      expect(isPassOnLoadBalancerKind(value)).toBe(false);
      expect(isPassOnReason(value)).toBe(false);
    }
  });
});
