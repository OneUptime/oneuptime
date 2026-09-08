import {
  CLOUD_ENVIRONMENT_KEY_SEPARATOR,
  CLOUD_PLATFORM_ALIASES,
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
  FAAS_CLOUD_PLATFORM_VALUES,
  FaasCloudPlatform,
  MANAGED_CLOUD_PLATFORMS,
  MANAGED_CLOUD_PLATFORM_VALUES,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
  ParsedCloudEnvironmentKey,
  buildCloudEnvironmentKey,
  buildCloudEnvironmentName,
  getCloudProviderForPlatform,
  getCloudProviderLabel,
  getManagedCloudPlatformDescriptor,
  getManagedCloudPlatformLabel,
  isFaasCloudPlatform,
  isManagedCloudPlatform,
  normalizeCloudPlatform,
  parseCloudEnvironmentKey,
} from "../../../Types/Cloud/CloudPlatform";
import { CLOUD_INSTANCE_IDENTITY_ATTRIBUTES } from "../../../Utils/Telemetry/CloudInstanceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * The managed cloud platform registry is the one place the telemetry ingest
 * gate, the environment key / name ingest mints, the dashboard create form,
 * the connect guide and the docs all read from. These tests pin the parts
 * of it that other code (and stored data) depends on:
 *
 *   - the labels are the exact strings ingest used before the registry
 *     existed, so an environment discovered last month and one discovered
 *     today get the same name and do not split;
 *   - the key keeps empty segments, so a row created before the collector
 *     started sending cloud.account.id stays the same row afterwards;
 *   - raw VMs and Kubernetes never become a Cloud Environment (they are
 *     Hosts / Kubernetes clusters), and FaaS never overlaps with managed
 *     compute, so no batch can be claimed by two products at once.
 */

/*
 * The labels ingest minted before the registry existed. Changing one of
 * these renames every environment discovered after the change, so they
 * are pinned as literals rather than derived from the registry.
 */
const HISTORICAL_INGEST_LABELS: Readonly<Record<ManagedCloudPlatform, string>> =
  {
    [ManagedCloudPlatform.AwsEcs]: "AWS ECS",
    [ManagedCloudPlatform.AwsElasticBeanstalk]: "AWS Elastic Beanstalk",
    [ManagedCloudPlatform.AwsAppRunner]: "AWS App Runner",
    [ManagedCloudPlatform.GcpCloudRun]: "GCP Cloud Run",
    [ManagedCloudPlatform.GcpAppEngine]: "GCP App Engine",
    [ManagedCloudPlatform.AzureContainerApps]: "Azure Container Apps",
    [ManagedCloudPlatform.AzureContainerInstances]: "Azure Container Instances",
    [ManagedCloudPlatform.AzureAppService]: "Azure App Service",
  };

/*
 * cloud.platform values from the OpenTelemetry semantic conventions that
 * must NOT be a Cloud Environment: raw virtual machines stay Hosts, and
 * Kubernetes platforms route through the k8s.* attributes.
 */
const RAW_VM_PLATFORMS: ReadonlyArray<string> = [
  "aws_ec2",
  "gcp_compute_engine",
  "azure_vm",
  "alibaba_cloud_ecs",
  "tencent_cloud_cvm",
  "ibm_cloud",
];

const KUBERNETES_PLATFORMS: ReadonlyArray<string> = [
  "aws_eks",
  "gcp_kubernetes_engine",
  "azure_aks",
  "alibaba_cloud_ack",
  "tencent_cloud_eks",
  "aws_openshift",
  "gcp_openshift",
  "azure_openshift",
  "ibm_cloud_openshift",
];

describe("ManagedCloudPlatform registry", () => {
  test("every enum value has exactly one descriptor, and every descriptor is an enum value", () => {
    const enumValues: Array<string> = Object.values(ManagedCloudPlatform);
    const descriptorPlatforms: Array<string> = MANAGED_CLOUD_PLATFORMS.map(
      (descriptor: ManagedCloudPlatformDescriptor): string => {
        return descriptor.platform;
      },
    );

    expect([...descriptorPlatforms].sort()).toEqual([...enumValues].sort());
    expect(new Set(descriptorPlatforms).size).toBe(descriptorPlatforms.length);

    for (const value of enumValues) {
      const descriptor: ManagedCloudPlatformDescriptor | null =
        getManagedCloudPlatformDescriptor(value);
      expect(descriptor).not.toBeNull();
      expect(descriptor!.platform).toBe(value);
    }
  });

  test("MANAGED_CLOUD_PLATFORM_VALUES is exactly the descriptor set", () => {
    expect([...MANAGED_CLOUD_PLATFORM_VALUES].sort()).toEqual(
      Object.values(ManagedCloudPlatform).sort(),
    );
  });

  test.each(Object.values(ManagedCloudPlatform))(
    "%s keeps the label ingest has always minted",
    (platform: ManagedCloudPlatform) => {
      expect(getManagedCloudPlatformLabel(platform)).toBe(
        HISTORICAL_INGEST_LABELS[platform],
      );
      expect(getManagedCloudPlatformDescriptor(platform)!.label).toBe(
        HISTORICAL_INGEST_LABELS[platform],
      );
    },
  );

  test("every descriptor is fully populated", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect(descriptor.label.trim()).not.toBe("");
      expect(descriptor.productName.trim()).not.toBe("");
      expect(descriptor.description.trim()).not.toBe("");
      expect(["detector", "manual"]).toContain(descriptor.detection);
      expect(Object.values(CloudProvider)).toContain(descriptor.provider);
    }
  });

  test("every docsUrl is a telemetry docs page", () => {
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect(descriptor.docsUrl.startsWith("/docs/telemetry/")).toBe(true);
      expect(descriptor.docsUrl.length).toBeGreaterThan(
        "/docs/telemetry/".length,
      );
    }
  });

  test("every instanceAttribute is one the identity fallback chain actually reads", () => {
    /*
     * The docs name the descriptor's instanceAttribute as "what identifies a
     * task on this platform". If it were not in the chain, the docs would be
     * promising an Instances tab that never fills in.
     */
    for (const descriptor of MANAGED_CLOUD_PLATFORMS) {
      expect(CLOUD_INSTANCE_IDENTITY_ATTRIBUTES).toContain(
        descriptor.instanceAttribute,
      );
      expect(descriptor.instanceAttribute).not.toBe("service.instance.id");
    }
  });

  test("provider follows from platform", () => {
    expect(getCloudProviderForPlatform(ManagedCloudPlatform.AwsEcs)).toBe(
      CloudProvider.AWS,
    );
    expect(
      getCloudProviderForPlatform(ManagedCloudPlatform.AwsElasticBeanstalk),
    ).toBe(CloudProvider.AWS);
    expect(getCloudProviderForPlatform(ManagedCloudPlatform.AwsAppRunner)).toBe(
      CloudProvider.AWS,
    );
    expect(getCloudProviderForPlatform(ManagedCloudPlatform.GcpCloudRun)).toBe(
      CloudProvider.GCP,
    );
    expect(getCloudProviderForPlatform(ManagedCloudPlatform.GcpAppEngine)).toBe(
      CloudProvider.GCP,
    );
    expect(
      getCloudProviderForPlatform(ManagedCloudPlatform.AzureContainerApps),
    ).toBe(CloudProvider.Azure);
    expect(
      getCloudProviderForPlatform(ManagedCloudPlatform.AzureContainerInstances),
    ).toBe(CloudProvider.Azure);
    expect(
      getCloudProviderForPlatform(ManagedCloudPlatform.AzureAppService),
    ).toBe(CloudProvider.Azure);
  });

  test("provider is null for anything outside the registry", () => {
    expect(getCloudProviderForPlatform("aws_ec2")).toBeNull();
    expect(getCloudProviderForPlatform("aws_lambda")).toBeNull();
    expect(getCloudProviderForPlatform("")).toBeNull();
    expect(getCloudProviderForPlatform(null)).toBeNull();
    expect(getCloudProviderForPlatform(undefined)).toBeNull();
  });
});

describe("platform gates", () => {
  test("managed and FaaS platform sets are disjoint", () => {
    for (const platform of MANAGED_CLOUD_PLATFORM_VALUES) {
      expect(FAAS_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
    }
    for (const platform of FAAS_CLOUD_PLATFORM_VALUES) {
      expect(MANAGED_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
    }
  });

  test("FAAS_CLOUD_PLATFORM_VALUES is exactly the FaasCloudPlatform enum", () => {
    expect([...FAAS_CLOUD_PLATFORM_VALUES].sort()).toEqual(
      Object.values(FaasCloudPlatform).sort(),
    );
    expect(FAAS_CLOUD_PLATFORM_VALUES.has("aws_lambda")).toBe(true);
    expect(FAAS_CLOUD_PLATFORM_VALUES.has("gcp_cloud_functions")).toBe(true);
    expect(FAAS_CLOUD_PLATFORM_VALUES.has("azure_functions")).toBe(true);
    expect(FAAS_CLOUD_PLATFORM_VALUES.has("tencent_cloud_scf")).toBe(true);
    expect(FAAS_CLOUD_PLATFORM_VALUES.has("alibaba_cloud_fc")).toBe(true);
  });

  test.each([...RAW_VM_PLATFORMS])(
    "raw VM platform %s is not managed compute (it stays a Host)",
    (platform: string) => {
      expect(isManagedCloudPlatform(platform)).toBe(false);
      expect(MANAGED_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
    },
  );

  test.each([...KUBERNETES_PLATFORMS])(
    "Kubernetes platform %s is not managed compute (it routes via k8s.*)",
    (platform: string) => {
      expect(isManagedCloudPlatform(platform)).toBe(false);
      expect(MANAGED_CLOUD_PLATFORM_VALUES.has(platform)).toBe(false);
    },
  );

  test("isManagedCloudPlatform accepts every managed value and nothing else", () => {
    for (const platform of Object.values(ManagedCloudPlatform)) {
      expect(isManagedCloudPlatform(platform)).toBe(true);
    }
    for (const platform of Object.values(FaasCloudPlatform)) {
      expect(isManagedCloudPlatform(platform)).toBe(false);
    }
    expect(isManagedCloudPlatform("AWS_ECS")).toBe(false);
    expect(isManagedCloudPlatform(" aws_ecs")).toBe(false);
    expect(isManagedCloudPlatform("")).toBe(false);
    expect(isManagedCloudPlatform(null)).toBe(false);
    expect(isManagedCloudPlatform(undefined)).toBe(false);
  });

  test("isFaasCloudPlatform accepts every FaaS value and nothing else", () => {
    for (const platform of Object.values(FaasCloudPlatform)) {
      expect(isFaasCloudPlatform(platform)).toBe(true);
    }
    for (const platform of Object.values(ManagedCloudPlatform)) {
      expect(isFaasCloudPlatform(platform)).toBe(false);
    }
    expect(isFaasCloudPlatform("")).toBe(false);
    expect(isFaasCloudPlatform(null)).toBe(false);
    expect(isFaasCloudPlatform(undefined)).toBe(false);
  });
});

describe("labels", () => {
  test("getManagedCloudPlatformLabel falls back to the raw value so nothing renders blank", () => {
    expect(getManagedCloudPlatformLabel("some_future_platform")).toBe(
      "some_future_platform",
    );
    expect(getManagedCloudPlatformLabel("")).toBe("");
    expect(getManagedCloudPlatformLabel(null)).toBe("");
    expect(getManagedCloudPlatformLabel(undefined)).toBe("");
  });

  test("every CloudProvider has a label", () => {
    for (const provider of Object.values(CloudProvider)) {
      expect(CLOUD_PROVIDER_LABELS[provider].trim()).not.toBe("");
      expect(getCloudProviderLabel(provider)).toBe(
        CLOUD_PROVIDER_LABELS[provider],
      );
    }
    expect(getCloudProviderLabel(CloudProvider.AWS)).toBe("AWS");
    expect(getCloudProviderLabel(CloudProvider.GCP)).toBe("Google Cloud");
    expect(getCloudProviderLabel(CloudProvider.Azure)).toBe("Azure");
  });

  test("getCloudProviderLabel falls back to the raw value", () => {
    expect(getCloudProviderLabel("oracle")).toBe("oracle");
    expect(getCloudProviderLabel("")).toBe("");
    expect(getCloudProviderLabel(null)).toBe("");
    expect(getCloudProviderLabel(undefined)).toBe("");
  });
});

describe("buildCloudEnvironmentKey", () => {
  test("joins platform, account and region with the separator, in that order", () => {
    expect(CLOUD_ENVIRONMENT_KEY_SEPARATOR).toBe("|");
    expect(
      buildCloudEnvironmentKey({
        platform: "aws_ecs",
        accountId: "123456789012",
        region: "us-east-1",
      }),
    ).toBe("aws_ecs|123456789012|us-east-1");
  });

  test("keeps empty segments rather than dropping them", () => {
    /*
     * A row created before the collector sent cloud.account.id must stay
     * the same row afterwards; that only works if the key shape is fixed.
     */
    expect(buildCloudEnvironmentKey({ platform: "aws_ecs" })).toBe("aws_ecs||");
    expect(
      buildCloudEnvironmentKey({ platform: "aws_ecs", region: "us-east-1" }),
    ).toBe("aws_ecs||us-east-1");
    expect(
      buildCloudEnvironmentKey({
        platform: "aws_ecs",
        accountId: "123456789012",
      }),
    ).toBe("aws_ecs|123456789012|");
    expect(
      buildCloudEnvironmentKey({
        platform: "aws_ecs",
        accountId: null,
        region: undefined,
      }),
    ).toBe("aws_ecs||");
  });

  test("trims every segment", () => {
    expect(
      buildCloudEnvironmentKey({
        platform: "  aws_ecs ",
        accountId: " 123456789012\n",
        region: "\tus-east-1 ",
      }),
    ).toBe("aws_ecs|123456789012|us-east-1");
    expect(
      buildCloudEnvironmentKey({
        platform: "gcp_cloud_run",
        accountId: "   ",
        region: " ",
      }),
    ).toBe("gcp_cloud_run||");
  });
});

describe("parseCloudEnvironmentKey", () => {
  test.each([
    {
      platform: "aws_ecs",
      accountId: "123456789012",
      region: "us-east-1",
    },
    { platform: "aws_ecs", accountId: "", region: "" },
    { platform: "aws_ecs", accountId: "", region: "us-east-1" },
    { platform: "aws_ecs", accountId: "123456789012", region: "" },
    {
      platform: "gcp_cloud_run",
      accountId: "my-project",
      region: "europe-west1",
    },
    {
      platform: "azure_container_apps",
      accountId: "00000000-0000-0000-0000-000000000000",
      region: "westeurope",
    },
  ])(
    "round-trips %j through the builder",
    (identity: ParsedCloudEnvironmentKey) => {
      const key: string = buildCloudEnvironmentKey(identity);
      expect(parseCloudEnvironmentKey(key)).toEqual(identity);
    },
  );

  test("rejects keys that are not three segments with a platform", () => {
    expect(parseCloudEnvironmentKey(null)).toBeNull();
    expect(parseCloudEnvironmentKey(undefined)).toBeNull();
    expect(parseCloudEnvironmentKey("")).toBeNull();
    expect(parseCloudEnvironmentKey("aws_ecs")).toBeNull();
    expect(parseCloudEnvironmentKey("aws_ecs|123456789012")).toBeNull();
    expect(parseCloudEnvironmentKey("|123456789012|us-east-1")).toBeNull();
    expect(parseCloudEnvironmentKey("aws_ecs|a|b|c")).toBeNull();
    /*
     * A pre-registry row whose identifier was a service name is not an
     * environment key — the parser must say so rather than guess.
     */
    expect(parseCloudEnvironmentKey("checkout-service")).toBeNull();
  });
});

describe("buildCloudEnvironmentName", () => {
  test("is label · region · account", () => {
    expect(
      buildCloudEnvironmentName({
        platform: "aws_ecs",
        accountId: "123456789012",
        region: "us-east-1",
      }),
    ).toBe("AWS ECS · us-east-1 · 123456789012");
  });

  test("omits missing parts without leaving a dangling separator", () => {
    expect(buildCloudEnvironmentName({ platform: "aws_ecs" })).toBe("AWS ECS");
    expect(
      buildCloudEnvironmentName({ platform: "aws_ecs", region: "us-east-1" }),
    ).toBe("AWS ECS · us-east-1");
    expect(
      buildCloudEnvironmentName({
        platform: "aws_ecs",
        accountId: "123456789012",
      }),
    ).toBe("AWS ECS · 123456789012");
    expect(
      buildCloudEnvironmentName({
        platform: "gcp_cloud_run",
        accountId: "  ",
        region: null,
      }),
    ).toBe("GCP Cloud Run");
  });

  test("trims region and account", () => {
    expect(
      buildCloudEnvironmentName({
        platform: "azure_container_apps",
        accountId: " sub-1 ",
        region: " westeurope ",
      }),
    ).toBe("Azure Container Apps · westeurope · sub-1");
  });

  test("falls back to the raw platform string when it is not in the registry", () => {
    expect(
      buildCloudEnvironmentName({
        platform: "some_future_platform",
        region: "us-east-1",
      }),
    ).toBe("some_future_platform · us-east-1");
  });

  test.each(Object.values(ManagedCloudPlatform))(
    "%s names an environment after its historical label",
    (platform: ManagedCloudPlatform) => {
      expect(
        buildCloudEnvironmentName({
          platform,
          accountId: "acct",
          region: "region",
        }),
      ).toBe(`${HISTORICAL_INGEST_LABELS[platform]} · region · acct`);
    },
  );
});

/*
 * The Node and .NET Azure resource detectors emit "azure.container_apps" /
 * "azure.app_service" / "azure.functions" / "azure.vm" where the semantic
 * conventions (and every other detector) use underscores. Ingest rewrites
 * the attribute through normalizeCloudPlatform so both spellings land in
 * the same environment and the stored value matches what the rows carry.
 */
describe("normalizeCloudPlatform", () => {
  test("maps every dotted Azure alias to its underscore value", () => {
    expect(normalizeCloudPlatform("azure.container_apps")).toBe(
      ManagedCloudPlatform.AzureContainerApps,
    );
    expect(normalizeCloudPlatform("azure.container_instances")).toBe(
      ManagedCloudPlatform.AzureContainerInstances,
    );
    expect(normalizeCloudPlatform("azure.app_service")).toBe(
      ManagedCloudPlatform.AzureAppService,
    );
    expect(normalizeCloudPlatform("azure.functions")).toBe(
      FaasCloudPlatform.AzureFunctions,
    );
    expect(normalizeCloudPlatform("azure.vm")).toBe("azure_vm");
    expect(normalizeCloudPlatform("azure.aks")).toBe("azure_aks");
  });

  test("every alias is a dotted spelling of a value that is not itself an alias", () => {
    for (const [alias, canonical] of Object.entries(CLOUD_PLATFORM_ALIASES)) {
      expect(alias).toContain(".");
      expect(canonical).not.toContain(".");
      expect(alias.replace(/\./g, "_")).toBe(canonical);
      expect(CLOUD_PLATFORM_ALIASES[canonical]).toBeUndefined();
    }
  });

  test("aliases that name a managed or FaaS platform resolve into the matching set", () => {
    expect(
      isManagedCloudPlatform(normalizeCloudPlatform("azure.container_apps")),
    ).toBe(true);
    expect(
      isManagedCloudPlatform(normalizeCloudPlatform("azure.app_service")),
    ).toBe(true);
    expect(isFaasCloudPlatform(normalizeCloudPlatform("azure.functions"))).toBe(
      true,
    );
    // A VM stays a VM: neither managed nor FaaS, so it still becomes a Host.
    expect(isManagedCloudPlatform(normalizeCloudPlatform("azure.vm"))).toBe(
      false,
    );
    expect(isFaasCloudPlatform(normalizeCloudPlatform("azure.vm"))).toBe(false);
  });

  test.each(Object.values(ManagedCloudPlatform))(
    "leaves the canonical value %s untouched",
    (platform: ManagedCloudPlatform) => {
      expect(normalizeCloudPlatform(platform)).toBe(platform);
    },
  );

  test("leaves unknown values untouched apart from trimming", () => {
    expect(normalizeCloudPlatform("some_future_platform")).toBe(
      "some_future_platform",
    );
    expect(normalizeCloudPlatform("  aws_ecs  ")).toBe("aws_ecs");
    expect(normalizeCloudPlatform(" azure.container_apps ")).toBe(
      ManagedCloudPlatform.AzureContainerApps,
    );
  });

  test("is exact about spelling: only the documented aliases are rewritten", () => {
    // Not an alias we know: no guessing, the caller sees what was sent.
    expect(normalizeCloudPlatform("Azure.Container_Apps")).toBe(
      "Azure.Container_Apps",
    );
    expect(normalizeCloudPlatform("azure.containerapps")).toBe(
      "azure.containerapps",
    );
  });

  test("never resolves an Object.prototype member name into a function", () => {
    /*
     * The value is untrusted OTLP input. A plain-object lookup would return
     * Object.prototype.constructor / toString / __proto__ for these, and
     * ingest writes the result back into the resource attribute.
     */
    for (const hostile of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ]) {
      const result: string | null = normalizeCloudPlatform(hostile);
      expect(typeof result).toBe("string");
      expect(result).toBe(hostile);
    }
  });

  test("null, undefined and blank in give null out", () => {
    expect(normalizeCloudPlatform(null)).toBeNull();
    expect(normalizeCloudPlatform(undefined)).toBeNull();
    expect(normalizeCloudPlatform("")).toBeNull();
    expect(normalizeCloudPlatform("   ")).toBeNull();
  });
});

describe("Azure Container Apps descriptor", () => {
  test("is detector-backed and keys instances on the Collector detector's replica attribute", () => {
    /*
     * The Collector's azurecontainerapps detector (and the Node / .NET
     * ones) stamp the replica name as azure.container_app.instance.id. The
     * docs hub table and the in-app guide are generated from these two
     * fields, so they are pinned here.
     */
    const descriptor: ManagedCloudPlatformDescriptor | null =
      getManagedCloudPlatformDescriptor(
        ManagedCloudPlatform.AzureContainerApps,
      );
    expect(descriptor?.detection).toBe("detector");
    expect(descriptor?.instanceAttribute).toBe(
      "azure.container_app.instance.id",
    );
    expect(CLOUD_INSTANCE_IDENTITY_ATTRIBUTES).toContain(
      "azure.container_app.instance.id",
    );
  });
});
