import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_TYPES,
  CLOUD_SERVICE_MODEL_LABELS,
  CLOUD_SERVICE_MODEL_WORDS,
  CloudNamedOnlyResourceType,
  CloudServiceModel,
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDisplayName,
  getCloudResourceTypeLabel,
  getReadableCloudResourceType,
  isInventoryOnlyCloudResourceType,
  NAMED_ONLY_RESOURCE_TYPES,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * What a page calls a cloud resource's type. A resource's Connected
 * Resources named the subnets and security groups an inventory points at by
 * the cloud's own type - "AWS::EC2::Subnet" - because the catalog lists
 * only the types OneUptime keeps as resources. A page now says the
 * catalog's label for those, a named-only type's label for the common ones
 * it only ever points at (Subnet, Security Group, Network Interface...), in
 * the reader's language, and any other type in words: "Transit Gateway
 * Attachment (EC2)". What is stored - a resource's name, the AI's facts -
 * keeps the type as the cloud spells it (getCloudResourceTypeLabel).
 */

describe("the types only ever named", () => {
  test("none is a type the catalog lists: those are resources", () => {
    for (const named of NAMED_ONLY_RESOURCE_TYPES) {
      const listed: CloudResourceTypeDescriptor | undefined =
        CLOUD_RESOURCE_TYPES.find(
          (descriptor: CloudResourceTypeDescriptor): boolean => {
            return (
              descriptor.provider === named.provider &&
              descriptor.type.toLowerCase() === named.type.toLowerCase()
            );
          },
        );

      expect({ type: named.type, listed: Boolean(listed) }).toEqual({
        type: named.type,
        listed: false,
      });
      // Named, never counted: no page says it has no metrics either.
      expect(isInventoryOnlyCloudResourceType(named.provider, named.type)).toBe(
        false,
      );
    }
  });

  test("each provider spells each once, the way its cloud does", () => {
    const seen: Set<string> = new Set<string>();

    for (const named of NAMED_ONLY_RESOURCE_TYPES) {
      const key: string = `${named.provider}|${named.type.toLowerCase()}`;

      expect(seen.has(key)).toBe(false);
      seen.add(key);

      if (named.provider === CloudProvider.AWS) {
        expect(named.type).toMatch(/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/);
      } else if (named.provider === CloudProvider.Azure) {
        expect(named.type).toMatch(/^Microsoft\.[A-Za-z]+(\/[A-Za-z]+)+$/);
      } else {
        expect(named.type).toMatch(/^[a-z]+\.googleapis\.com\/[A-Za-z]+$/);
      }

      expect(named.label.trim()).toBe(named.label);
      expect(named.label.length).toBeGreaterThan(0);
    }
  });

  test("the subnets and security groups the inventories point at are among them", () => {
    for (const [provider, type, label] of [
      [CloudProvider.AWS, "AWS::EC2::Subnet", "Subnet"],
      [CloudProvider.AWS, "AWS::EC2::SecurityGroup", "Security Group"],
      [
        CloudProvider.Azure,
        "Microsoft.Network/virtualNetworks/subnets",
        "Subnet",
      ],
      [
        CloudProvider.Azure,
        "Microsoft.Network/networkSecurityGroups",
        "Network Security Group",
      ],
      [CloudProvider.GCP, "compute.googleapis.com/Subnetwork", "Subnet"],
      [CloudProvider.GCP, "compute.googleapis.com/Firewall", "Firewall Rule"],
    ] as Array<[CloudProvider, string, string]>) {
      expect(getCloudResourceTypeDisplayName(provider, type)).toBe(label);
      // Whatever case it is spelled in.
      expect(
        getCloudResourceTypeDisplayName(provider, ` ${type.toUpperCase()} `),
      ).toBe(label);
    }
  });

  test("each label reads in every language the Dashboard speaks", () => {
    const labels: Array<string> = Array.from(
      new Set(
        NAMED_ONLY_RESOURCE_TYPES.map(
          (named: CloudNamedOnlyResourceType): string => {
            return named.label;
          },
        ),
      ),
    );
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const label of labels) {
        expect({ language, label, key: typeof words[label] }).toEqual({
          language,
          label,
          key: "string",
        });
        // Its own words, or the English a language keeps on purpose.
        expect({
          language,
          label,
          worded: isWordedInDashboardLocale(label, language),
        }).toEqual({ language, label, worded: true });
      }
    }
  });
});

describe("a resource's service model, in words", () => {
  test("each says what it means and keeps its short name", () => {
    for (const model of Object.values(CloudServiceModel)) {
      expect(CLOUD_SERVICE_MODEL_WORDS[model]).toContain(
        `(${CLOUD_SERVICE_MODEL_LABELS[model]})`,
      );
    }

    expect(CLOUD_SERVICE_MODEL_WORDS[CloudServiceModel.PaaS]).toBe(
      "Managed service (PaaS)",
    );
    /*
     * Infrastructure, never "self-managed": a load balancer, a network or
     * a disk is IaaS here, and its cloud runs it (#5702's review).
     */
    expect(CLOUD_SERVICE_MODEL_WORDS[CloudServiceModel.IaaS]).toBe(
      "Infrastructure (IaaS)",
    );
    for (const model of Object.values(CloudServiceModel)) {
      expect(CLOUD_SERVICE_MODEL_WORDS[model]).not.toMatch(/self/i);
    }
  });

  test("each reads in every language, its short name kept", () => {
    for (const model of Object.values(CloudServiceModel)) {
      const english: string = CLOUD_SERVICE_MODEL_WORDS[model];

      for (const language of DASHBOARD_LANGUAGES) {
        const worded: string | undefined =
          readDashboardLocale(language)[english];

        expect({
          language,
          english,
          worded: isWordedInDashboardLocale(english, language),
        }).toEqual({ language, english, worded: true });
        expect(worded).toContain(CLOUD_SERVICE_MODEL_LABELS[model]);
      }
    }
  });
});

describe("what a page calls a type", () => {
  test("a type the catalog lists: its label", () => {
    expect(
      getCloudResourceTypeDisplayName(CloudProvider.AWS, "AWS::EC2::Instance"),
    ).toBe(getCloudResourceTypeLabel(CloudProvider.AWS, "AWS::EC2::Instance"));
    expect(
      getCloudResourceTypeDisplayName(
        CloudProvider.Azure,
        "Microsoft.Compute/virtualMachines",
      ),
    ).toBe("Virtual Machine");
  });

  test("a type no catalog names: in words, never blank", () => {
    expect(
      getCloudResourceTypeDisplayName(
        CloudProvider.AWS,
        "AWS::EC2::TransitGatewayAttachment",
      ),
    ).toBe("Transit Gateway Attachment (EC2)");
    expect(getCloudResourceTypeDisplayName(CloudProvider.AWS, "")).toBe("");
    expect(getCloudResourceTypeDisplayName(undefined, undefined)).toBe("");
    // No provider: still in words.
    expect(
      getCloudResourceTypeDisplayName(
        null,
        "AWS::EC2::TransitGatewayAttachment",
      ),
    ).toBe("Transit Gateway Attachment (EC2)");
  });

  test("what is stored keeps the cloud's own spelling of a type it does not know", () => {
    expect(
      getCloudResourceTypeLabel(
        CloudProvider.AWS,
        "AWS::EC2::TransitGatewayAttachment",
      ),
    ).toBe("AWS::EC2::TransitGatewayAttachment");
    expect(
      getCloudResourceTypeLabel(CloudProvider.AWS, "AWS::EC2::Subnet"),
    ).toBe("AWS::EC2::Subnet");
  });
});

describe("any type in words", () => {
  test.each([
    ["AWS::EC2::TransitGatewayAttachment", "Transit Gateway Attachment (EC2)"],
    ["AWS::EC2::VPCPeeringConnection", "VPC Peering Connection (EC2)"],
    ["AWS::RDS::DBParameterGroup", "DB Parameter Group (RDS)"],
    ["AWS::EC2::EIP", "EIP (EC2)"],
    [
      "AWS::ElasticLoadBalancingV2::ListenerRule",
      "Listener Rule (Elastic Load Balancing V2)",
    ],
    ["AWS::Route53::RecordSet", "Record Set (Route53)"],
  ])("AWS %s reads %s", (type: string, words: string) => {
    expect(getReadableCloudResourceType(type)).toBe(words);
  });

  test.each([
    [
      "Microsoft.Network/loadBalancers/inboundNatRules",
      "Inbound Nat Rule (Network)",
    ],
    ["Microsoft.Network/publicIPPrefixes", "Public IP Prefix (Network)"],
    ["Microsoft.Web/sites/slots", "Slot (Web)"],
    ["Microsoft.Sql/servers/databases", "Database (Sql)"],
    ["Microsoft.Cache/Redis", "Redis (Cache)"],
    ["Microsoft.Network/dnsZones", "Dns Zone (Network)"],
    [
      "Microsoft.Authorization/policyAssignments",
      "Policy Assignment (Authorization)",
    ],
    [
      "Microsoft.Network/privateDnsZones/virtualNetworkLinks",
      "Virtual Network Link (Network)",
    ],
    ["Microsoft.Network/networkWatchers/flowLogs", "Flow Log (Network)"],
    ["Microsoft.Network/ipGroups", "Ip Group (Network)"],
    ["Microsoft.Compute/galleries/images/versions", "Version (Compute)"],
    [
      "Microsoft.Network/vpnGateways/vpnConnections",
      "Vpn Connection (Network)",
    ],
    ["Microsoft.Resources/deploymentScripts", "Deployment Script (Resources)"],
    [
      "Microsoft.Network/frontDoorWebApplicationFirewallPolicies",
      "Front Door Web Application Firewall Policy (Network)",
    ],
    [
      "Microsoft.Storage/storageAccounts/blobServices",
      "Blob Service (Storage)",
    ],
    ["Microsoft.Insights/actionGroups", "Action Group (Insights)"],
    ["Microsoft.Network/virtualHubs", "Virtual Hub (Network)"],
    ["Microsoft.Network/bastionHosts/boxes", "Box (Network)"],
    ["Microsoft.Network/expressRoutePorts/links/status", "Status (Network)"],
    [
      "Microsoft.Network/networkSecurityGroups/securityRules/accesses",
      "Access (Network)",
    ],
  ])("Azure %s reads %s", (type: string, words: string) => {
    expect(getReadableCloudResourceType(type)).toBe(words);
  });

  test.each([
    [
      "compute.googleapis.com/TargetHttpsProxy",
      "Target Https Proxy (Compute Engine)",
    ],
    ["sqladmin.googleapis.com/Instance", "Instance (Cloud SQL)"],
    ["pubsub.googleapis.com/Snapshot", "Snapshot (Pub/Sub)"],
    ["foo.googleapis.com/BarBaz", "Bar Baz (Foo)"],
    ["gce_router", "Gce Router"],
  ])("Google Cloud %s reads %s", (type: string, words: string) => {
    expect(getReadableCloudResourceType(type)).toBe(words);
  });

  test("a type of no shape it knows is returned as it came", () => {
    for (const type of [
      "AWS::Thing",
      "AWS::A::B::C",
      "Microsoft.Network",
      "Microsoft./x",
      "compute.googleapis.com/",
      "compute.googleapis.com/a/b",
      "SomethingElse",
      "a b_c",
    ]) {
      expect(getReadableCloudResourceType(type)).toBe(type.trim());
    }

    expect(getReadableCloudResourceType("  ")).toBe("");
    expect(getReadableCloudResourceType(null)).toBe("");
    expect(getReadableCloudResourceType(undefined)).toBe("");
  });

  test("reads a very long type in one pass", () => {
    const service: string = "A".repeat(50000);
    const resource: string = "Bb".repeat(50000);

    expect(
      getReadableCloudResourceType(`AWS::${service}::${resource}`).length,
    ).toBeGreaterThan(100000);
    expect(
      getReadableCloudResourceType(`Microsoft.${service}/${resource}s`).length,
    ).toBeGreaterThan(100000);
  });
});
