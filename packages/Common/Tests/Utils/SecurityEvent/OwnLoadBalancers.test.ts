import { describe, expect, test } from "@jest/globals";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import {
  AWS_CLASSIC_LOAD_BALANCER_TYPE,
  AWS_ELBV2_LOAD_BALANCER_TYPE,
  AZURE_PUBLIC_IP_ADDRESS_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  OWN_LOAD_BALANCER_PRODUCT_NAMES,
  OWN_LOAD_BALANCER_RESOURCE_TYPES,
  OwnLoadBalancerKind,
  OwnLoadBalancerReading,
  OwnLoadBalancerRecord,
  addResolvedAddresses,
  getAzureApplicationGatewayOf,
  isAwsApplicationLoadBalancer,
  isAwsHttpClassicLoadBalancer,
  isGoogleCloudApplicationForwardingRule,
  isOwnLoadBalancerKind,
  readOwnLoadBalancer,
} from "../../../Utils/SecurityEvent/OwnLoadBalancers";

/*
 * #10546: WHICH OF THE PROJECT'S OWN ADDRESSES FORWARD ITS CLIENTS.
 *
 * Trusting an address as a proxy is believing the X-Forwarded-For it passes
 * on. Only a load balancer that adds the client it forwards may be: an app
 * server, a probe, a node, a NAT gateway or a layer 4 load balancer would
 * let whatever runs behind it name any client. These hold each rule to the
 * record the cloud inventory keeps.
 */

const ALB_DNS: string = "web-1234567890.us-east-1.elb.amazonaws.com";

function albRecord(
  overrides: Partial<OwnLoadBalancerRecord> = {},
): OwnLoadBalancerRecord {
  return {
    cloudResourceType: AWS_ELBV2_LOAD_BALANCER_TYPE,
    providerResourceId:
      "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/web/50dc6c495c0c9188",
    name: "web",
    cloudProperties: {
      Type: "application",
      Scheme: "internet-facing",
      DNSName: ALB_DNS,
    },
    cloudEndpoints: [ALB_DNS],
    ...overrides,
  };
}

function classicRecord(listeners: unknown): OwnLoadBalancerRecord {
  return {
    cloudResourceType: AWS_CLASSIC_LOAD_BALANCER_TYPE,
    providerResourceId: "legacy-web",
    name: "legacy-web",
    cloudProperties: { Listeners: listeners, Scheme: "internet-facing" },
    cloudEndpoints: ["legacy-web-1.us-east-1.elb.amazonaws.com"],
  };
}

function forwardingRule(data: {
  ipAddress: string;
  routesTo: { target: string; targetType?: string };
}): OwnLoadBalancerRecord {
  return {
    cloudResourceType: GCP_FORWARDING_RULE_TYPE,
    providerResourceId:
      "//compute.googleapis.com/projects/shop/global/forwardingRules/web-https",
    name: "web-https",
    cloudProperties: {
      IPAddress: data.ipAddress,
      IPProtocol: "TCP",
      loadBalancingScheme: "EXTERNAL_MANAGED",
    },
    cloudEndpoints: [],
    cloudRelationships: [
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: data.routesTo.target,
        ...(data.routesTo.targetType
          ? { targetType: data.routesTo.targetType }
          : {}),
      },
    ],
  };
}

function azurePublicIp(attachedTo: string | null): OwnLoadBalancerRecord {
  return {
    cloudResourceType: AZURE_PUBLIC_IP_ADDRESS_TYPE,
    providerResourceId:
      "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/publicIPAddresses/web-pip",
    name: "web-pip",
    cloudEndpoints: ["web.westeurope.cloudapp.azure.com", "20.50.1.7"],
    cloudRelationships: attachedTo
      ? [{ kind: CloudRelationshipKind.AttachedTo, target: attachedTo }]
      : [],
  };
}

const URL_MAP: string =
  "//compute.googleapis.com/projects/shop/global/urlMaps/web-map";

describe("an AWS ELBv2 load balancer", () => {
  test("an Application Load Balancer is one: by its name, which the server resolves", () => {
    expect(readOwnLoadBalancer(albRecord())).toEqual({
      kind: OwnLoadBalancerKind.AwsApplicationLoadBalancer,
      name: "web",
      addresses: [],
      hostNames: [ALB_DNS],
    });
  });

  test("a Network or a Gateway Load Balancer passes a connection on as it came: never one", () => {
    for (const type of ["network", "gateway", "NETWORK"]) {
      const record: OwnLoadBalancerRecord = albRecord({
        cloudProperties: { Type: type, DNSName: ALB_DNS },
      });

      expect(isAwsApplicationLoadBalancer(record)).toBe(false);
      expect(readOwnLoadBalancer(record)).toBeNull();
    }
  });

  test("with no Type recorded, its ARN says which it is", () => {
    expect(readOwnLoadBalancer(albRecord({ cloudProperties: {} }))?.kind).toBe(
      OwnLoadBalancerKind.AwsApplicationLoadBalancer,
    );
    expect(
      readOwnLoadBalancer(
        albRecord({
          cloudProperties: {},
          providerResourceId:
            "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/tcp/50dc6c495c0c9188",
        }),
      ),
    ).toBeNull();
    expect(
      readOwnLoadBalancer(
        albRecord({ cloudProperties: {}, providerResourceId: "" }),
      ),
    ).toBeNull();
  });

  /*
   * #11389: a private address is kept too. A project that stops trusting
   * private addresses still trusts an internal load balancer's, by its
   * being the load balancer's.
   */
  test("an address the record names is kept when public or private, never one that is no load balancer's to have", () => {
    const reading: OwnLoadBalancerReading | null = readOwnLoadBalancer(
      albRecord({
        cloudEndpoints: [
          ALB_DNS,
          "52.1.2.3",
          "10.0.1.20",
          "127.0.0.1",
          "169.254.169.254",
        ],
      }),
    );

    expect(reading?.addresses).toEqual(["52.1.2.3", "10.0.1.20"]);
    expect(reading?.hostNames).toEqual([ALB_DNS]);
  });

  test("an internal one, at a private address only, is one", () => {
    expect(
      readOwnLoadBalancer(
        albRecord({
          cloudProperties: { Type: "application", Scheme: "internal" },
          cloudEndpoints: ["10.0.1.20"],
        }),
      ),
    ).toEqual({
      kind: OwnLoadBalancerKind.AwsApplicationLoadBalancer,
      name: "web",
      addresses: ["10.0.1.20"],
      hostNames: [],
    });
  });

  test("one with no address and no name to look one up by is none", () => {
    expect(readOwnLoadBalancer(albRecord({ cloudEndpoints: [] }))).toBeNull();
    expect(
      readOwnLoadBalancer(albRecord({ cloudEndpoints: ["127.0.0.1"] })),
    ).toBeNull();
  });
});

describe("an AWS Classic Load Balancer", () => {
  test("every listener HTTP or HTTPS on both sides: one", () => {
    const record: OwnLoadBalancerRecord = classicRecord([
      "HTTP:80 -> HTTP:8080",
      "HTTPS:443 -> HTTP:8080",
      "HTTPS:8443 -> HTTPS:8443",
    ]);

    expect(isAwsHttpClassicLoadBalancer(record)).toBe(true);
    expect(readOwnLoadBalancer(record)?.kind).toBe(
      OwnLoadBalancerKind.AwsClassicLoadBalancer,
    );
  });

  test("a listener with no instance side is read by its own protocol", () => {
    expect(isAwsHttpClassicLoadBalancer(classicRecord(["HTTP:80"]))).toBe(true);
    expect(isAwsHttpClassicLoadBalancer(classicRecord(["TCP:443"]))).toBe(
      false,
    );
  });

  test("one TCP or SSL listener passes a header through as sent: never one", () => {
    for (const listeners of [
      ["HTTP:80 -> HTTP:8080", "TCP:443 -> TCP:443"],
      ["SSL:443 -> TCP:8080"],
      ["HTTPS:443 -> TCP:8080"],
      ["TCP:80 -> HTTP:8080"],
    ]) {
      expect(readOwnLoadBalancer(classicRecord(listeners))).toBeNull();
    }
  });

  test("one that lists no listener says nothing, and is not trusted", () => {
    for (const listeners of [undefined, [], "HTTP:80 -> HTTP:80", [""], [7]]) {
      expect(readOwnLoadBalancer(classicRecord(listeners))).toBeNull();
    }
  });
});

describe("a Google Cloud forwarding rule", () => {
  test("one that sends to a URL map is an Application Load Balancer's", () => {
    for (const targetType of [
      "https_lb_rule",
      "internal_http_lb_rule",
      "compute.googleapis.com/UrlMap",
    ]) {
      expect(
        readOwnLoadBalancer(
          forwardingRule({
            ipAddress: "34.120.1.2",
            routesTo: { target: URL_MAP, targetType },
          }),
        ),
      ).toEqual({
        kind: OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer,
        name: "web-https",
        addresses: ["34.120.1.2"],
        hostNames: [],
      });
    }
  });

  test("one that sends to an HTTP or HTTPS proxy the listing did not hold, too", () => {
    for (const proxy of ["targetHttpsProxies", "targetHttpProxies"]) {
      expect(
        isGoogleCloudApplicationForwardingRule(
          forwardingRule({
            ipAddress: "34.120.1.2",
            routesTo: {
              target: `//compute.googleapis.com/projects/shop/global/${proxy}/web-proxy`,
            },
          }),
        ),
      ).toBe(true);
    }
  });

  test("a passthrough or TCP/SSL proxy load balancer's never is", () => {
    for (const routesTo of [
      {
        target:
          "//compute.googleapis.com/projects/shop/regions/us-central1/backendServices/tcp",
        targetType: "compute.googleapis.com/BackendService",
      },
      {
        target:
          "//compute.googleapis.com/projects/shop/regions/us-central1/targetPools/pool",
        targetType: "compute.googleapis.com/TargetPool",
      },
      {
        target:
          "//compute.googleapis.com/projects/shop/zones/us-central1-a/targetInstances/one",
        targetType: "compute.googleapis.com/TargetInstance",
      },
      {
        target:
          "//compute.googleapis.com/projects/shop/global/targetSslProxies/ssl",
      },
      {
        target:
          "//compute.googleapis.com/projects/shop/global/targetTcpProxies/tcp",
      },
    ]) {
      expect(
        readOwnLoadBalancer(
          forwardingRule({ ipAddress: "34.120.1.2", routesTo }),
        ),
      ).toBeNull();
    }
  });

  /*
   * #11389: an internal one appends its private address to X-Forwarded-For
   * as an external one does its public one, and is trusted for being the
   * load balancer, not only for being private.
   */
  test("an internal one's private address is listed as its own", () => {
    expect(
      readOwnLoadBalancer(
        forwardingRule({
          ipAddress: "10.128.0.9",
          routesTo: { target: URL_MAP, targetType: "internal_http_lb_rule" },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        kind: OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer,
        addresses: ["10.128.0.9"],
      }),
    );
  });

  test("a rule that sends nowhere, or only runs in a network, is none", () => {
    const record: OwnLoadBalancerRecord = forwardingRule({
      ipAddress: "34.120.1.2",
      routesTo: { target: URL_MAP, targetType: "https_lb_rule" },
    });

    expect(
      readOwnLoadBalancer({ ...record, cloudRelationships: [] }),
    ).toBeNull();
    expect(
      readOwnLoadBalancer({
        ...record,
        cloudRelationships: [
          { kind: CloudRelationshipKind.RunsIn, target: URL_MAP },
        ],
      }),
    ).toBeNull();
  });
});

describe("an Azure public IP address", () => {
  const GATEWAY: string =
    "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/applicationGateways/web-agw";

  test("attached to an Application Gateway: the gateway, by its name and the address", () => {
    expect(getAzureApplicationGatewayOf(azurePublicIp(GATEWAY))?.name).toBe(
      "web-agw",
    );
    expect(readOwnLoadBalancer(azurePublicIp(GATEWAY))).toEqual({
      kind: OwnLoadBalancerKind.AzureApplicationGateway,
      name: "web-agw",
      addresses: ["20.50.1.7"],
      hostNames: [],
    });
  });

  test("the gateway's id is matched whatever its case", () => {
    expect(
      readOwnLoadBalancer(
        azurePublicIp(
          GATEWAY.replace("applicationGateways", "APPLICATIONGATEWAYS"),
        ),
      )?.kind,
    ).toBe(OwnLoadBalancerKind.AzureApplicationGateway);
  });

  test("attached to a load balancer, a NAT gateway, a machine's interface or nothing: never one", () => {
    for (const attachedTo of [
      "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/loadBalancers/kubernetes",
      "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/natGateways/egress",
      "/subscriptions/1111/resourceGroups/web/providers/Microsoft.Network/networkInterfaces/vm-1-nic",
      "not an id",
      null,
    ]) {
      expect(readOwnLoadBalancer(azurePublicIp(attachedTo))).toBeNull();
    }
  });

  test("a gateway's address must be one it can be reached at to be listed", () => {
    for (const address of ["127.0.0.1", "169.254.0.4", "::1", "fe80::4"]) {
      expect(
        readOwnLoadBalancer({
          ...azurePublicIp(GATEWAY),
          cloudEndpoints: [address],
        }),
      ).toBeNull();
    }
  });
});

describe("what is never a proxy", () => {
  test("hosts, machines, nodes, NAT gateways, elastic IPs and Azure load balancers", () => {
    for (const cloudResourceType of [
      "AWS::EC2::Instance",
      "AWS::EC2::NatGateway",
      "AWS::EC2::EIP",
      "AWS::ECS::Service",
      "compute.googleapis.com/Instance",
      "compute.googleapis.com/BackendService",
      "Microsoft.Compute/virtualMachines",
      "Microsoft.Network/loadBalancers",
      "Microsoft.Network/applicationGateways",
      "",
    ]) {
      expect(
        readOwnLoadBalancer({
          cloudResourceType,
          name: "x",
          cloudProperties: { Type: "application", IPAddress: "34.120.1.2" },
          cloudEndpoints: ["34.120.1.2", ALB_DNS],
          cloudRelationships: [
            {
              kind: CloudRelationshipKind.RoutesTo,
              target: URL_MAP,
              targetType: "https_lb_rule",
            },
          ],
        }),
      ).toBeNull();
    }
  });

  test("the types read are exactly the four a load balancer that forwards clients is listed under", () => {
    expect([...OWN_LOAD_BALANCER_RESOURCE_TYPES].sort()).toEqual(
      [
        AWS_CLASSIC_LOAD_BALANCER_TYPE,
        AWS_ELBV2_LOAD_BALANCER_TYPE,
        AZURE_PUBLIC_IP_ADDRESS_TYPE,
        GCP_FORWARDING_RULE_TYPE,
      ].sort(),
    );
  });
});

describe("addresses", () => {
  test("IPv6 addresses are kept, each once however written: public and private, never link-local", () => {
    const reading: OwnLoadBalancerReading | null = readOwnLoadBalancer(
      albRecord({
        cloudEndpoints: [
          ALB_DNS,
          "2600:1f18:4000::7",
          "2600:1F18:4000:0:0:0:0:7",
          "fd00::7",
          "fe80::7",
        ],
      }),
    );

    expect(reading?.addresses).toEqual(["2600:1f18:4000::7", "fd00::7"]);
  });

  test("a name's resolved addresses join the record's: public and private ones, each once", () => {
    const reading: OwnLoadBalancerReading = readOwnLoadBalancer(albRecord())!;

    expect(
      addResolvedAddresses(reading, [
        "52.1.2.3",
        "52.1.2.3",
        "10.0.1.20",
        "::ffff:52.1.2.4",
        "127.0.0.1",
        "not an address",
      ]),
    ).toEqual(["52.1.2.3", "10.0.1.20", "52.1.2.4"]);
  });
});

describe("the kinds", () => {
  test("each named as its cloud names the product", () => {
    expect(OWN_LOAD_BALANCER_PRODUCT_NAMES).toEqual({
      [OwnLoadBalancerKind.AwsApplicationLoadBalancer]:
        "AWS Application Load Balancer",
      [OwnLoadBalancerKind.AwsClassicLoadBalancer]: "AWS Classic Load Balancer",
      [OwnLoadBalancerKind.GoogleCloudApplicationLoadBalancer]:
        "Google Cloud Application Load Balancer",
      [OwnLoadBalancerKind.AzureApplicationGateway]:
        "Azure Application Gateway",
      [OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet]:
        "Google Cloud proxy-only subnet",
    });
  });

  test("a kind is one of them, and nothing else is", () => {
    for (const kind of Object.values(OwnLoadBalancerKind)) {
      expect(isOwnLoadBalancerKind(kind)).toBe(true);
    }

    for (const value of ["host", "", null, 7, "AWS::EC2::Instance"]) {
      expect(isOwnLoadBalancerKind(value)).toBe(false);
    }
  });
});
