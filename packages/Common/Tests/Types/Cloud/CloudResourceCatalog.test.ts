import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_CLOUDWATCH_DISCOVERY_NAMESPACES,
  AWS_CLOUDWATCH_RESOURCE_RULES,
  AWS_RESOURCE_TYPES,
  AZURE_RESOURCE_TYPES,
  AwsCloudWatchResourceRule,
  CLOUD_RESOURCE_CATEGORY_LABELS,
  CLOUD_RESOURCE_TYPES,
  CLOUD_SERVICE_MODEL_LABELS,
  CloudResourceCategory,
  CloudResourceTypeDescriptor,
  CloudServiceModel,
  GCP_MONITORED_RESOURCE_RULES,
  GcpMonitoredResourceRule,
  getAwsCloudWatchRulesForNamespace,
  getAwsPartitionForRegion,
  getCanonicalCloudResourceType,
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeLabel,
  getGcpMonitoredResourceRule,
} from "../../../Types/Cloud/CloudResourceCatalog";
import { findAwsCloudWatchRule } from "../../../Types/Cloud/CloudMonitoredResource";
import { describe, expect, test } from "@jest/globals";

/*
 * The catalog is what decides which cloud resources exist in OneUptime and
 * what they are called. These tests pin the properties the rest of the
 * product relies on: one spelling per type, a rule behind every AWS type
 * and a type behind every rule, every rule reachable in the order rules
 * are tried, identity always including the account, and ARNs that are
 * ARNs.
 */

function sampleDimensions(
  rule: AwsCloudWatchResourceRule,
): Record<string, string> {
  const dimensions: Record<string, string> = {};
  for (const name of rule.identityDimensions) {
    dimensions[name] = `sample-${name.replace(/\s+/g, "-").toLowerCase()}`;
  }
  return dimensions;
}

describe("resource types", () => {
  test("each provider spells each type once, whatever the case", () => {
    const seen: Set<string> = new Set<string>();
    for (const descriptor of CLOUD_RESOURCE_TYPES) {
      const key: string = `${descriptor.provider}|${descriptor.type.toLowerCase()}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("labels are unique within a provider, and never blank", () => {
    for (const provider of Object.values(CloudProvider)) {
      const labels: Array<string> = CLOUD_RESOURCE_TYPES.filter(
        (descriptor: CloudResourceTypeDescriptor): boolean => {
          return descriptor.provider === provider;
        },
      ).map((descriptor: CloudResourceTypeDescriptor): string => {
        return descriptor.label;
      });
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(labels.length);
      for (const label of labels) {
        expect(label.trim()).toBe(label);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  test("every descriptor has a known service model and category, with a label each", () => {
    for (const descriptor of CLOUD_RESOURCE_TYPES) {
      expect(Object.values(CloudServiceModel)).toContain(
        descriptor.serviceModel,
      );
      expect(Object.values(CloudResourceCategory)).toContain(
        descriptor.category,
      );
    }
    for (const model of Object.values(CloudServiceModel)) {
      expect(CLOUD_SERVICE_MODEL_LABELS[model]).toBeTruthy();
    }
    for (const category of Object.values(CloudResourceCategory)) {
      expect(CLOUD_RESOURCE_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  test("both IaaS and PaaS are covered for every provider", () => {
    for (const provider of Object.values(CloudProvider)) {
      const models: Set<CloudServiceModel> = new Set(
        CLOUD_RESOURCE_TYPES.filter(
          (descriptor: CloudResourceTypeDescriptor): boolean => {
            return descriptor.provider === provider;
          },
        ).map((descriptor: CloudResourceTypeDescriptor): CloudServiceModel => {
          return descriptor.serviceModel;
        }),
      );
      expect(models.has(CloudServiceModel.IaaS)).toBe(true);
      expect(models.has(CloudServiceModel.PaaS)).toBe(true);
    }
  });

  test("Azure types are Resource Manager types", () => {
    for (const descriptor of AZURE_RESOURCE_TYPES) {
      expect(descriptor.provider).toBe(CloudProvider.Azure);
      expect(descriptor.type).toMatch(/^Microsoft\.[A-Za-z]+(\/[A-Za-z]+)+$/);
    }
  });

  test("AWS types are CloudFormation resource types", () => {
    for (const descriptor of AWS_RESOURCE_TYPES) {
      expect(descriptor.provider).toBe(CloudProvider.AWS);
      expect(descriptor.type).toMatch(/^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/);
    }
  });

  test("Google Cloud types are Cloud Monitoring monitored-resource types", () => {
    for (const rule of GCP_MONITORED_RESOURCE_RULES) {
      expect(rule.provider).toBe(CloudProvider.GCP);
      expect(rule.type).toMatch(
        /^([a-z][a-z0-9_]*|[a-z]+\.googleapis\.com\/[A-Za-z]+)$/,
      );
    }
  });
});

describe("lookups", () => {
  test("a type is found whatever case it is spelled in", () => {
    for (const spelling of [
      "Microsoft.ServiceBus/namespaces",
      "Microsoft.ServiceBus/Namespaces",
      "MICROSOFT.SERVICEBUS/NAMESPACES",
      "  microsoft.servicebus/namespaces  ",
    ]) {
      expect(
        getCloudResourceTypeDescriptor(CloudProvider.Azure, spelling)?.label,
      ).toBe("Service Bus Namespace");
      expect(getCanonicalCloudResourceType(CloudProvider.Azure, spelling)).toBe(
        "Microsoft.ServiceBus/namespaces",
      );
    }
  });

  test("a type is only found under its own provider", () => {
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.AWS, "gce_instance"),
    ).toBeNull();
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.GCP, "gce_instance")?.label,
    ).toBe("Compute Engine VM Instance");
  });

  test("an unlisted type is labelled by itself and kept as it came", () => {
    expect(
      getCloudResourceTypeLabel(
        CloudProvider.Azure,
        "Microsoft.Fabric/capacities",
      ),
    ).toBe("Microsoft.Fabric/capacities");
    expect(
      getCanonicalCloudResourceType(
        CloudProvider.Azure,
        " Microsoft.Fabric/capacities ",
      ),
    ).toBe("Microsoft.Fabric/capacities");
    expect(getCloudResourceTypeDescriptor(CloudProvider.Azure, "")).toBeNull();
    expect(
      getCloudResourceTypeDescriptor(null, "AWS::EC2::Instance"),
    ).toBeNull();
    expect(getCloudResourceTypeLabel(undefined, undefined)).toBe("");
  });
});

describe("AWS rules", () => {
  test("every rule discovers a listed type, and every listed type has a rule", () => {
    const listed: Set<string> = new Set(
      AWS_RESOURCE_TYPES.map(
        (descriptor: CloudResourceTypeDescriptor): string => {
          return descriptor.type;
        },
      ),
    );
    const discovered: Set<string> = new Set<string>();
    for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
      expect(listed.has(rule.type)).toBe(true);
      discovered.add(rule.type);
    }
    expect(discovered).toEqual(listed);
  });

  test("namespaces are CloudWatch's AWS namespaces, listed once each for discovery", () => {
    for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
      expect(rule.namespace).toMatch(/^AWS\/[A-Za-z0-9]+$/);
      expect(rule.identityDimensions.length).toBeGreaterThan(0);
    }
    expect(new Set(AWS_CLOUDWATCH_DISCOVERY_NAMESPACES).size).toBe(
      AWS_CLOUDWATCH_DISCOVERY_NAMESPACES.length,
    );
    expect(AWS_CLOUDWATCH_DISCOVERY_NAMESPACES).toContain("AWS/EC2");
  });

  test("every rule is reachable: its own identity finds it, not an earlier rule", () => {
    for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
      expect(
        findAwsCloudWatchRule(rule.namespace, sampleDimensions(rule)),
      ).toBe(rule);
    }
  });

  test("a rule's excluded dimensions send the datapoint to another rule, or none", () => {
    for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
      for (const excluded of rule.excludedDimensions || []) {
        expect(
          findAwsCloudWatchRule(rule.namespace, {
            ...sampleDimensions(rule),
            [excluded]: "present",
          }),
        ).not.toBe(rule);
      }
    }
  });

  test("ARNs are ARNs in the region's partition, built only from what the rule names", () => {
    for (const rule of AWS_CLOUDWATCH_RESOURCE_RULES) {
      if (!rule.getArn) {
        continue;
      }
      const dimensions: Record<string, string> = sampleDimensions(rule);
      // A rule whose dimension already is the ARN.
      for (const name of rule.identityDimensions) {
        if (name.endsWith("Arn")) {
          dimensions[name] = "arn:aws:service:us-east-1:123456789012:thing/x";
        }
      }
      const arn: string | null = rule.getArn({
        partition: "aws",
        region: "us-east-1",
        accountId: "123456789012",
        dimensions: dimensions,
      });
      if (rule.type === "AWS::AppRunner::Service") {
        // Needs ServiceID, which the sample does not carry.
        expect(arn).toBeNull();
        continue;
      }
      expect(arn).toMatch(/^arn:aws:[a-z0-9-]+:/);
      expect(arn).not.toContain("undefined");
    }
  });

  test("rules are found by namespace without regard to case", () => {
    expect(getAwsCloudWatchRulesForNamespace("aws/rds").length).toBe(2);
    expect(getAwsCloudWatchRulesForNamespace("AWS/RDS").length).toBe(2);
    expect(getAwsCloudWatchRulesForNamespace("AWS/Unknown")).toEqual([]);
  });

  test("the partition follows the region", () => {
    expect(getAwsPartitionForRegion("us-east-1")).toBe("aws");
    expect(getAwsPartitionForRegion("eu-central-1")).toBe("aws");
    expect(getAwsPartitionForRegion("cn-northwest-1")).toBe("aws-cn");
    expect(getAwsPartitionForRegion("us-gov-east-1")).toBe("aws-us-gov");
    expect(getAwsPartitionForRegion("")).toBe("aws");
  });
});

describe("Google Cloud rules", () => {
  test("the project is always part of the identity", () => {
    for (const rule of GCP_MONITORED_RESOURCE_RULES) {
      expect(rule.identityLabels).toContain(rule.accountLabel || "project_id");
      expect(new Set(rule.identityLabels).size).toBe(
        rule.identityLabels.length,
      );
    }
  });

  test("Kubernetes types are left to the Kubernetes product", () => {
    for (const rule of GCP_MONITORED_RESOURCE_RULES) {
      expect(rule.type.startsWith("k8s_")).toBe(false);
      expect(rule.type.startsWith("gke_")).toBe(false);
    }
  });

  test("every rule names a resource from its identity alone", () => {
    for (const rule of GCP_MONITORED_RESOURCE_RULES) {
      const labels: Record<string, string> = {};
      for (const key of rule.identityLabels) {
        labels[key] = `sample-${key}`;
      }
      expect(rule.getName(labels).length).toBeGreaterThan(0);
      if (rule.getFullResourceName) {
        const name: string | null = rule.getFullResourceName(labels);
        if (name !== null) {
          expect(name).toMatch(/^\/\/[a-z]+\.googleapis\.com\//);
          // No empty path segment after the scheme.
          expect(name.slice(2)).not.toContain("//");
        }
      }
    }
  });

  test("rules are found by type without regard to case", () => {
    const rule: GcpMonitoredResourceRule | null =
      getGcpMonitoredResourceRule("CloudSQL_Database");
    expect(rule?.type).toBe("cloudsql_database");
    expect(getGcpMonitoredResourceRule("k8s_container")).toBeNull();
  });
});
