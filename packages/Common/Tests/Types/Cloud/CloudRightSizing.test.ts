import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_DAYS_IN_AVERAGE_MONTH,
  CLOUD_RIGHT_SIZING_CPU_HOT_PERCENT,
  CLOUD_RIGHT_SIZING_CPU_TARGET_PERCENT,
  CLOUD_RIGHT_SIZING_MEMORY_HOT_PERCENT,
  CLOUD_RIGHT_SIZING_MEMORY_TARGET_PERCENT,
  CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS,
  CLOUD_RIGHT_SIZING_MIN_SAMPLES,
  CLOUD_RIGHT_SIZING_PROFILES,
  CLOUD_RIGHT_SIZING_RECOMMENDATION_PREFIX,
  CLOUD_SIZE_RECOMMENDATION_KINDS,
  CloudRightSizing,
  CloudRightSizingProfile,
  CloudRightSizingSkipReason,
  CloudRightSizingVerdict,
  CloudSizeLadder,
  CloudSizeSteps,
  CloudUsageObservation,
  MEMORY_NEEDS_CLOUDWATCH_AGENT,
  MEMORY_NEEDS_OPS_AGENT,
  MEMORY_NOT_REPORTED,
  MEMORY_REPORTED_AS_FREE,
  buildCloudRightSizing,
  getCloudReadingsP95,
  getCloudRightSizingProfile,
  getCloudRightSizingRecommendationId,
  getCloudSizeSteps,
  hasCloudRightSizingChange,
  isCloudRightSizingRecommendationId,
  isRecommenderSizeRecommendation,
  readCloudResourceSize,
  readCloudRightSizingEvidence,
  toCloudRightSizingEvidence,
} from "../../../Types/Cloud/CloudRightSizing";
import {
  CloudResourceTypeDescriptor,
  getCloudResourceTypeDescriptor,
} from "../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import { getCloudReadingKey } from "../../../Types/Cloud/CloudResourceHealth";

/*
 * Right-sizing a cloud resource from OneUptime's own readings of its CPU and
 * memory: the sizes each cloud names, a step down or up its ladder, and the
 * verdict - what to change, why, and what it saves once its cost is known.
 */

function profileOf(provider: string, type: string): CloudRightSizingProfile {
  const profile: CloudRightSizingProfile | null = getCloudRightSizingProfile(
    provider,
    type,
  );
  expect(profile).not.toBeNull();
  return profile!;
}

const EC2: CloudRightSizingProfile = profileOf("aws", "AWS::EC2::Instance");
const RDS: CloudRightSizingProfile = profileOf("aws", "AWS::RDS::DBInstance");
const CACHE: CloudRightSizingProfile = profileOf(
  "aws",
  "AWS::ElastiCache::CacheCluster",
);
const AZURE_VM: CloudRightSizingProfile = profileOf(
  "azure",
  "Microsoft.Compute/virtualMachines",
);
const PLAN: CloudRightSizingProfile = profileOf(
  "azure",
  "Microsoft.Web/serverfarms",
);
const GCE: CloudRightSizingProfile = profileOf("gcp", "gce_instance");
const CLOUD_SQL: CloudRightSizingProfile = profileOf(
  "gcp",
  "cloudsql_database",
);

// A fortnight of five-minute readings.
const FORTNIGHT: { samples: number; observedHours: number } = {
  samples: 14 * 24 * 12,
  observedHours: 14 * 24,
};

function observation(
  fields: Partial<CloudUsageObservation>,
): CloudUsageObservation {
  return {
    cpuP95Percent: null,
    cpuMaxPercent: null,
    memoryPeakPercent: null,
    ...FORTNIGHT,
    ...fields,
  };
}

function steps(ladder: CloudSizeLadder, size: string): CloudSizeSteps {
  return getCloudSizeSteps(ladder, size);
}

describe("the resources it sizes", () => {
  test("each profile is a type the catalog knows, read under a key its cloud's readings are kept by", () => {
    for (const profile of CLOUD_RIGHT_SIZING_PROFILES) {
      const descriptor: CloudResourceTypeDescriptor | null =
        getCloudResourceTypeDescriptor(profile.provider, profile.type);
      expect({ type: profile.type, known: Boolean(descriptor) }).toEqual({
        type: profile.type,
        known: true,
      });

      for (const metric of [profile.cpu, profile.memory]) {
        if (!metric) {
          continue;
        }
        expect(metric.names.length).toBeGreaterThan(0);
        for (const name of metric.names) {
          // Stored in lower case, as the ingest stores every name.
          expect(name).toBe(name.toLowerCase());
          expect(getCloudReadingKey(profile.provider, name)).not.toBeNull();
        }
        expect([1, 100]).toContain(metric.toPercent);
      }

      // A type sized by CPU only says why its memory is not read.
      if (!profile.memory) {
        expect(profile.memoryNotRead).toBeTruthy();
      }
    }
  });

  test("the profiles are the compute, database and cache types each cloud doubles in size", () => {
    expect(
      CLOUD_RIGHT_SIZING_PROFILES.map((profile: CloudRightSizingProfile) => {
        return `${profile.provider} ${profile.type}`;
      }),
    ).toEqual([
      "aws AWS::EC2::Instance",
      "aws AWS::RDS::DBInstance",
      "aws AWS::ElastiCache::CacheCluster",
      "aws AWS::ElastiCache::ReplicationGroup",
      "azure Microsoft.Compute/virtualMachines",
      "azure Microsoft.DBforPostgreSQL/flexibleServers",
      "azure Microsoft.DBforMySQL/flexibleServers",
      "azure Microsoft.Web/serverfarms",
      "gcp gce_instance",
      "gcp cloudsql_database",
    ]);
  });

  test("a profile is found whatever the case its provider and type are written in, and none for another type", () => {
    expect(getCloudRightSizingProfile("AWS", "aws::ec2::instance")).toBe(EC2);
    expect(getCloudRightSizingProfile("aws", "AWS::S3::Bucket")).toBeNull();
    expect(getCloudRightSizingProfile("", "")).toBeNull();
    expect(getCloudRightSizingProfile(null, undefined)).toBeNull();
  });

  test("CPU and memory are read as each cloud stores them: CloudWatch and Azure in percent, Google Cloud as a share", () => {
    expect(EC2.cpu.names).toEqual(["amazonaws.com/aws/ec2/cpuutilization"]);
    expect(EC2.cpu.toPercent).toBe(1);
    expect(CACHE.memory?.names).toEqual([
      "amazonaws.com/aws/elasticache/databasememoryusagepercentage",
    ]);
    // Azure Monitor's receiver names a metric by the aggregation it read.
    expect(AZURE_VM.cpu.names).toEqual([
      "azure_percentage_cpu_average",
      "azure_percentage_cpu_maximum",
      "azure_percentage_cpu_minimum",
      "azure_percentage_cpu_total",
    ]);
    expect(PLAN.memory?.names).toContain("azure_memorypercentage_average");
    expect(GCE.cpu).toEqual({
      names: ["compute.googleapis.com/instance/cpu/utilization"],
      toPercent: 100,
    });
    expect(CLOUD_SQL.memory?.toPercent).toBe(100);
  });

  test("a type whose cloud reports no share of memory says why, in its cloud's words", () => {
    expect(EC2.memory).toBeNull();
    expect(EC2.memoryNotRead).toBe(MEMORY_NEEDS_CLOUDWATCH_AGENT);
    expect(RDS.memoryNotRead).toBe(MEMORY_REPORTED_AS_FREE);
    expect(AZURE_VM.memoryNotRead).toBe(MEMORY_REPORTED_AS_FREE);
    expect(GCE.memoryNotRead).toBe(MEMORY_NEEDS_OPS_AGENT);
  });

  test("a database's bill holds its storage too; a machine's is its size", () => {
    expect(RDS.billHoldsMoreThanSize).toBe(true);
    expect(CLOUD_SQL.billHoldsMoreThanSize).toBe(true);
    expect(
      profileOf("azure", "Microsoft.DBforPostgreSQL/flexibleServers")
        .billHoldsMoreThanSize,
    ).toBe(true);
    expect(EC2.billHoldsMoreThanSize).toBe(false);
    expect(GCE.billHoldsMoreThanSize).toBe(false);
    expect(CACHE.billHoldsMoreThanSize).toBe(false);
  });
});

describe("a resource's size, from its inventory", () => {
  test("each cloud's property, a machine type's URL by its last part", () => {
    expect(readCloudResourceSize(EC2, { InstanceType: "m5.2xlarge" })).toBe(
      "m5.2xlarge",
    );
    expect(
      readCloudResourceSize(AZURE_VM, { vmSize: " Standard_D8s_v5 " }),
    ).toBe("Standard_D8s_v5");
    expect(
      readCloudResourceSize(GCE, {
        machineType:
          "https://www.googleapis.com/compute/v1/projects/acme/zones/europe-west1-b/machineTypes/n2-standard-16",
      }),
    ).toBe("n2-standard-16");
    expect(
      readCloudResourceSize(CLOUD_SQL, {
        "settings.tier": "db-custom-4-16384",
      }),
    ).toBe("db-custom-4-16384");
  });

  test("nothing when the inventory keeps none, or keeps something that is not a name", () => {
    expect(readCloudResourceSize(EC2, null)).toBeNull();
    expect(readCloudResourceSize(EC2, [])).toBeNull();
    expect(readCloudResourceSize(EC2, {})).toBeNull();
    expect(readCloudResourceSize(EC2, { InstanceType: 5 })).toBeNull();
    expect(readCloudResourceSize(EC2, { InstanceType: "  " })).toBeNull();
    expect(readCloudResourceSize(GCE, { machineType: "zones/x/" })).toBeNull();
    expect(
      readCloudResourceSize(EC2, { InstanceType: "m".repeat(101) }),
    ).toBeNull();
  });
});

describe("a step down or up each cloud's sizes", () => {
  test("AWS: the 2x chain from large up, for instances, databases and caches alike", () => {
    expect(steps(CloudSizeLadder.Aws, "m5.2xlarge")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "m5.xlarge",
      larger: "m5.4xlarge",
    });
    expect(steps(CloudSizeLadder.Aws, "m5.xlarge").smaller).toBe("m5.large");
    expect(steps(CloudSizeLadder.Aws, "db.r6g.4xlarge").smaller).toBe(
      "db.r6g.2xlarge",
    );
    expect(steps(CloudSizeLadder.Aws, "cache.r6g.xlarge").smaller).toBe(
      "cache.r6g.large",
    );
    expect(steps(CloudSizeLadder.Aws, "c6i.16xlarge")).toMatchObject({
      smaller: "c6i.8xlarge",
      larger: "c6i.32xlarge",
    });
  });

  test("AWS: the pairs that leave the chain, and no step from a size outside them", () => {
    expect(steps(CloudSizeLadder.Aws, "m5.24xlarge").smaller).toBe(
      "m5.12xlarge",
    );
    expect(steps(CloudSizeLadder.Aws, "m5.12xlarge")).toMatchObject({
      isKnown: true,
      smaller: null,
      larger: "m5.24xlarge",
    });
    expect(steps(CloudSizeLadder.Aws, "c5.18xlarge").smaller).toBe(
      "c5.9xlarge",
    );
    // A large is a family's smallest named step; a medium steps up to it.
    expect(steps(CloudSizeLadder.Aws, "m5.large")).toMatchObject({
      smaller: null,
      larger: "m5.xlarge",
    });
    expect(steps(CloudSizeLadder.Aws, "m6g.medium")).toMatchObject({
      isKnown: true,
      smaller: null,
      larger: "m6g.large",
    });
    expect(steps(CloudSizeLadder.Aws, "m5.3xlarge")).toMatchObject({
      isKnown: true,
      smaller: null,
      larger: null,
    });
    expect(steps(CloudSizeLadder.Aws, "m5.metal").isKnown).toBe(false);
    expect(steps(CloudSizeLadder.Aws, "db.serverless").isKnown).toBe(false);
    expect(steps(CloudSizeLadder.Aws, "m5").isKnown).toBe(false);
  });

  test("AWS: t-family sizes are burstable, as instances, databases and caches", () => {
    for (const size of [
      "t2.micro",
      "t3.large",
      "t3a.xlarge",
      "t4g.medium",
      "db.t3.medium",
      "cache.t4g.small",
    ]) {
      expect({ size, steps: steps(CloudSizeLadder.Aws, size) }).toEqual({
        size,
        steps: {
          isKnown: true,
          isBurstable: true,
          smaller: null,
          larger: null,
        },
      });
    }
  });

  test("Azure: the vCPUs halved and doubled on the series whose number is them, the features and generation kept", () => {
    expect(steps(CloudSizeLadder.AzureVm, "Standard_D8s_v5")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "Standard_D4s_v5",
      larger: "Standard_D16s_v5",
    });
    expect(steps(CloudSizeLadder.AzureVm, "Standard_E16ads_v5").smaller).toBe(
      "Standard_E8ads_v5",
    );
    expect(steps(CloudSizeLadder.AzureVm, "Standard_F8s_v2").smaller).toBe(
      "Standard_F4s_v2",
    );
    expect(steps(CloudSizeLadder.AzureVm, "Standard_D96s_v5")).toMatchObject({
      smaller: "Standard_D48s_v5",
      larger: null,
    });
    expect(steps(CloudSizeLadder.AzureVm, "Standard_D2s_v5")).toMatchObject({
      smaller: null,
      larger: "Standard_D4s_v5",
    });
    // A flexible server's SKU is one of the same sizes.
    expect(steps(CloudSizeLadder.AzureVm, "Standard_D4ds_v4").smaller).toBe(
      "Standard_D2ds_v4",
    );
  });

  test("Azure: older generations numbered by index, constrained vCPUs and other series are not stepped from; B-series is burstable", () => {
    for (const size of [
      "Standard_D3_v2",
      "Standard_DS3_v2",
      "Standard_E16-4s_v5",
      "Standard_NC6s_v3",
      "Standard_M64ms",
      "Basic_A1",
    ]) {
      expect({
        size,
        known: steps(CloudSizeLadder.AzureVm, size).isKnown,
      }).toEqual({ size, known: false });
    }
    expect(steps(CloudSizeLadder.AzureVm, "Standard_B2ms").isBurstable).toBe(
      true,
    );
    expect(
      steps(CloudSizeLadder.AzureVm, "Standard_B2ats_v2").isBurstable,
    ).toBe(true);
  });

  test("an App Service plan's tier, a size at a time, and none from Free, Shared or Elastic Premium", () => {
    expect(steps(CloudSizeLadder.AzureAppServicePlan, "P2v3")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "P1v3",
      larger: "P3v3",
    });
    expect(steps(CloudSizeLadder.AzureAppServicePlan, "p1v3").smaller).toBe(
      "P0v3",
    );
    expect(steps(CloudSizeLadder.AzureAppServicePlan, "S1")).toMatchObject({
      smaller: null,
      larger: "S2",
    });
    expect(steps(CloudSizeLadder.AzureAppServicePlan, "P5mv3")).toMatchObject({
      smaller: "P4mv3",
      larger: null,
    });
    for (const sku of ["F1", "D1", "EP1", "Y1", "WS1"]) {
      expect(steps(CloudSizeLadder.AzureAppServicePlan, sku).isKnown).toBe(
        false,
      );
    }
  });

  test("Compute Engine: predefined types on the 2x chain within what each family offers", () => {
    expect(steps(CloudSizeLadder.GcpMachine, "n2-standard-16")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "n2-standard-8",
      larger: "n2-standard-32",
    });
    expect(steps(CloudSizeLadder.GcpMachine, "n1-standard-2").smaller).toBe(
      "n1-standard-1",
    );
    expect(
      steps(CloudSizeLadder.GcpMachine, "n2-standard-2").smaller,
    ).toBeNull();
    expect(
      steps(CloudSizeLadder.GcpMachine, "e2-standard-32").larger,
    ).toBeNull();
    expect(
      steps(CloudSizeLadder.GcpMachine, "e2-highmem-16").larger,
    ).toBeNull();
    expect(steps(CloudSizeLadder.GcpMachine, "e2-highcpu-16").larger).toBe(
      "e2-highcpu-32",
    );
    // Not on the chain, or a family whose sizes do not double.
    expect(steps(CloudSizeLadder.GcpMachine, "n2-standard-48").isKnown).toBe(
      false,
    );
    expect(steps(CloudSizeLadder.GcpMachine, "c2-standard-16").isKnown).toBe(
      false,
    );
    expect(steps(CloudSizeLadder.GcpMachine, "c3-standard-22").isKnown).toBe(
      false,
    );
  });

  test("Compute Engine: custom types halved and doubled whole, and shared-core types burstable", () => {
    expect(steps(CloudSizeLadder.GcpMachine, "n2-custom-8-32768")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "n2-custom-4-16384",
      larger: "n2-custom-16-65536",
    });
    // Half of 6 vCPUs is not a count a custom type takes.
    expect(
      steps(CloudSizeLadder.GcpMachine, "n2-custom-6-24576").smaller,
    ).toBeNull();
    expect(
      steps(CloudSizeLadder.GcpMachine, "e2-custom-2-4096").smaller,
    ).toBeNull();
    expect(
      steps(CloudSizeLadder.GcpMachine, "n2-custom-8-32768-ext").isKnown,
    ).toBe(false);
    for (const type of ["e2-micro", "e2-small", "e2-medium", "f1-micro"]) {
      expect(steps(CloudSizeLadder.GcpMachine, type).isBurstable).toBe(true);
    }
  });

  test("Cloud SQL: custom tiers to one vCPU or an even number, legacy tiers on the chain, shared-core burstable", () => {
    expect(steps(CloudSizeLadder.GcpCloudSql, "db-custom-4-16384")).toEqual({
      isKnown: true,
      isBurstable: false,
      smaller: "db-custom-2-8192",
      larger: "db-custom-8-32768",
    });
    expect(steps(CloudSizeLadder.GcpCloudSql, "db-custom-2-7680").smaller).toBe(
      "db-custom-1-3840",
    );
    expect(
      steps(CloudSizeLadder.GcpCloudSql, "db-custom-1-3840"),
    ).toMatchObject({ smaller: null, larger: "db-custom-2-7680" });
    expect(steps(CloudSizeLadder.GcpCloudSql, "db-custom-3-7680").isKnown).toBe(
      false,
    );
    expect(steps(CloudSizeLadder.GcpCloudSql, "db-n1-standard-4").smaller).toBe(
      "db-n1-standard-2",
    );
    expect(
      steps(CloudSizeLadder.GcpCloudSql, "db-n1-highmem-64").larger,
    ).toBeNull();
    expect(steps(CloudSizeLadder.GcpCloudSql, "db-f1-micro").isBurstable).toBe(
      true,
    );
    expect(
      steps(CloudSizeLadder.GcpCloudSql, "db-perf-optimized-N-8").isKnown,
    ).toBe(false);
  });

  test("an empty size is no size on any ladder", () => {
    for (const ladder of Object.values(CloudSizeLadder)) {
      expect(getCloudSizeSteps(ladder, "")).toMatchObject({ isKnown: false });
      expect(getCloudSizeSteps(ladder, null)).toMatchObject({
        isKnown: false,
      });
    }
  });
});

describe("the verdict", () => {
  test("over-provisioned: half its size would do, and with its cost known, what that saves a month", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.2xlarge",
      observation: observation({ cpuP95Percent: 24, cpuMaxPercent: 41 }),
      dailyCost: { amount: 9.2, currency: "USD", days: 30 },
    });

    expect(sizing).toMatchObject({
      verdict: CloudRightSizingVerdict.Overprovisioned,
      currentSize: "m5.2xlarge",
      recommendedSize: "m5.xlarge",
      factor: 2,
      projectedCpuP95Percent: 48,
      isMemoryRead: false,
      memoryNotRead: MEMORY_NEEDS_CLOUDWATCH_AGENT,
      observedDays: 14,
      currency: "USD",
      isSavingUpperBound: false,
    });
    const monthlyCost: number =
      Math.round(9.2 * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 100;
    expect(sizing.monthlyCost).toBe(monthlyCost);
    expect(sizing.monthlySavings).toBe(Math.round(monthlyCost * 50) / 100);
    expect(sizing.monthlyIncrease).toBe(0);
    expect(hasCloudRightSizingChange(sizing)).toBe(true);
  });

  test("a quarter of its size when even that has room, never less", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.8xlarge",
      observation: observation({ cpuP95Percent: 4, cpuMaxPercent: 9 }),
      dailyCost: { amount: 40, currency: "USD", days: 30 },
    });

    expect(sizing.recommendedSize).toBe("m5.2xlarge");
    expect(sizing.factor).toBe(4);
    expect(sizing.projectedCpuP95Percent).toBe(16);
    expect(sizing.monthlySavings).toBe(
      Math.round(40 * CLOUD_DAYS_IN_AVERAGE_MONTH * 0.75 * 100) / 100,
    );
  });

  test("a quarter is not taken when its peak, or its memory, would not fit", () => {
    // Half fits, a quarter's CPU peak would pass 100%.
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "m5.8xlarge",
        observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 40 }),
      }).factor,
    ).toBe(2);
    // A cache's memory: 30% fits at half (60%), not a quarter (120%).
    expect(
      buildCloudRightSizing({
        profile: CACHE,
        size: "cache.r6g.4xlarge",
        observation: observation({
          cpuP95Percent: 5,
          cpuMaxPercent: 8,
          memoryPeakPercent: 30,
        }),
      }),
    ).toMatchObject({
      recommendedSize: "cache.r6g.2xlarge",
      factor: 2,
      projectedMemoryPeakPercent: 60,
      isMemoryRead: true,
    });
  });

  test("the limits it is judged at: a 95th percentile of 60% and a memory peak of 70% at the smaller size", () => {
    const atLimit: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.xlarge",
      observation: observation({
        cpuP95Percent: CLOUD_RIGHT_SIZING_CPU_TARGET_PERCENT / 2,
        cpuMaxPercent: 50,
        memoryPeakPercent: CLOUD_RIGHT_SIZING_MEMORY_TARGET_PERCENT / 2,
      }),
    });
    expect(atLimit.verdict).toBe(CloudRightSizingVerdict.Overprovisioned);

    const overCpu: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.xlarge",
      observation: observation({
        cpuP95Percent: CLOUD_RIGHT_SIZING_CPU_TARGET_PERCENT / 2 + 0.1,
        cpuMaxPercent: 50,
        memoryPeakPercent: 10,
      }),
    });
    expect(overCpu.verdict).toBe(CloudRightSizingVerdict.RightSized);

    const overMemory: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.xlarge",
      observation: observation({
        cpuP95Percent: 5,
        cpuMaxPercent: 10,
        memoryPeakPercent: CLOUD_RIGHT_SIZING_MEMORY_TARGET_PERCENT / 2 + 0.1,
      }),
    });
    expect(overMemory.verdict).toBe(CloudRightSizingVerdict.RightSized);

    // Its highest reading must still fit the smaller size.
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "m5.xlarge",
        observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 51 }),
      }).verdict,
    ).toBe(CloudRightSizingVerdict.RightSized);
  });

  test("a memory-bound resource is right-sized however idle its CPU", () => {
    expect(
      buildCloudRightSizing({
        profile: PLAN,
        size: "P2v3",
        observation: observation({
          cpuP95Percent: 3,
          cpuMaxPercent: 6,
          memoryPeakPercent: 82,
        }),
      }).verdict,
    ).toBe(CloudRightSizingVerdict.RightSized);
  });

  test("under-provisioned: a 95th percentile of 85% CPU, or a memory peak of 90%, wants the size twice as big", () => {
    const hotCpu: CloudRightSizing = buildCloudRightSizing({
      profile: RDS,
      size: "db.r6g.xlarge",
      observation: observation({
        cpuP95Percent: CLOUD_RIGHT_SIZING_CPU_HOT_PERCENT,
        cpuMaxPercent: 100,
      }),
      dailyCost: { amount: 12, currency: "USD", days: 30 },
    });
    expect(hotCpu).toMatchObject({
      verdict: CloudRightSizingVerdict.Underprovisioned,
      recommendedSize: "db.r6g.2xlarge",
      factor: 2,
      projectedCpuP95Percent: CLOUD_RIGHT_SIZING_CPU_HOT_PERCENT / 2,
      monthlySavings: 0,
      monthlyIncrease: Math.round(12 * CLOUD_DAYS_IN_AVERAGE_MONTH * 100) / 100,
    });

    const hotMemory: CloudRightSizing = buildCloudRightSizing({
      profile: CLOUD_SQL,
      size: "db-custom-2-7680",
      observation: observation({
        cpuP95Percent: 20,
        cpuMaxPercent: 30,
        memoryPeakPercent: CLOUD_RIGHT_SIZING_MEMORY_HOT_PERCENT,
      }),
    });
    expect(hotMemory).toMatchObject({
      verdict: CloudRightSizingVerdict.Underprovisioned,
      recommendedSize: "db-custom-4-15360",
      projectedMemoryPeakPercent: CLOUD_RIGHT_SIZING_MEMORY_HOT_PERCENT / 2,
      monthlyIncrease: 0,
    });
  });

  test("over or under, with no size to name: the verdict without a change", () => {
    const idleAtSmallest: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.large",
      observation: observation({ cpuP95Percent: 2, cpuMaxPercent: 5 }),
      dailyCost: { amount: 3, currency: "USD", days: 30 },
    });
    expect(idleAtSmallest).toMatchObject({
      verdict: CloudRightSizingVerdict.Overprovisioned,
      recommendedSize: null,
      factor: 1,
      monthlySavings: 0,
    });
    expect(hasCloudRightSizingChange(idleAtSmallest)).toBe(false);

    const hotAtLargest: CloudRightSizing = buildCloudRightSizing({
      profile: GCE,
      size: "e2-standard-32",
      observation: observation({ cpuP95Percent: 96, cpuMaxPercent: 100 }),
    });
    expect(hotAtLargest).toMatchObject({
      verdict: CloudRightSizingVerdict.Underprovisioned,
      recommendedSize: null,
      factor: 1,
    });
    expect(hasCloudRightSizingChange(hotAtLargest)).toBe(false);
  });

  test("right-sized: neither room to spare nor running out", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: AZURE_VM,
      size: "Standard_D8s_v5",
      observation: observation({ cpuP95Percent: 55, cpuMaxPercent: 78 }),
    });
    expect(sizing).toMatchObject({
      verdict: CloudRightSizingVerdict.RightSized,
      recommendedSize: null,
      factor: 1,
    });
    expect(hasCloudRightSizingChange(sizing)).toBe(false);
  });

  test("not enough readings yet: under 6 days, or under a day's worth of readings, or no CPU at all", () => {
    for (const fields of [
      {
        observedHours: CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS - 1,
        samples: 5000,
      },
      { observedHours: 14 * 24, samples: CLOUD_RIGHT_SIZING_MIN_SAMPLES - 1 },
      { observedHours: 14 * 24, samples: 5000, cpuP95Percent: null },
    ]) {
      expect(
        buildCloudRightSizing({
          profile: EC2,
          size: "m5.2xlarge",
          observation: observation({
            cpuP95Percent: 2,
            cpuMaxPercent: 3,
            ...fields,
          }),
        }).verdict,
      ).toBe(CloudRightSizingVerdict.NotEnoughHistory);
    }

    // Exactly the least it needs is enough.
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "m5.2xlarge",
        observation: observation({
          cpuP95Percent: 2,
          cpuMaxPercent: 3,
          observedHours: CLOUD_RIGHT_SIZING_MIN_OBSERVED_HOURS,
          samples: CLOUD_RIGHT_SIZING_MIN_SAMPLES,
        }),
      }).verdict,
    ).toBe(CloudRightSizingVerdict.Overprovisioned);
  });

  test("not sized: its size not known, burstable, or on no ladder - whatever its readings", () => {
    const quiet: CloudUsageObservation = observation({
      cpuP95Percent: 1,
      cpuMaxPercent: 2,
    });

    expect(
      buildCloudRightSizing({ profile: EC2, size: null, observation: quiet }),
    ).toMatchObject({
      verdict: CloudRightSizingVerdict.NotSized,
      skipReason: CloudRightSizingSkipReason.SizeNotKnown,
    });
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "t3.large",
        observation: quiet,
      }),
    ).toMatchObject({
      verdict: CloudRightSizingVerdict.NotSized,
      skipReason: CloudRightSizingSkipReason.Burstable,
    });
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "m5.metal",
        observation: quiet,
      }),
    ).toMatchObject({
      verdict: CloudRightSizingVerdict.NotSized,
      skipReason: CloudRightSizingSkipReason.SizeNotOnLadder,
    });
  });

  test("a type that reports memory as a share, with none come in, is sized by CPU and says none came", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.xlarge",
      observation: observation({ cpuP95Percent: 10, cpuMaxPercent: 20 }),
    });
    expect(sizing).toMatchObject({
      verdict: CloudRightSizingVerdict.Overprovisioned,
      isMemoryRead: false,
      memoryNotRead: MEMORY_NOT_REPORTED,
    });
  });

  test("a memory reading of a type sized by CPU only is never used", () => {
    expect(
      buildCloudRightSizing({
        profile: EC2,
        size: "m5.2xlarge",
        observation: observation({
          cpuP95Percent: 10,
          cpuMaxPercent: 20,
          memoryPeakPercent: 99,
        }),
      }),
    ).toMatchObject({
      verdict: CloudRightSizingVerdict.Overprovisioned,
      memoryPeakPercent: null,
      isMemoryRead: false,
    });
  });

  test("a database's saving is 'up to': its bill holds its storage too", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: RDS,
      size: "db.r6g.2xlarge",
      observation: observation({ cpuP95Percent: 12, cpuMaxPercent: 30 }),
      dailyCost: { amount: 27.4, currency: "USD", days: 14 },
    });
    expect(sizing.isSavingUpperBound).toBe(true);
    expect(sizing.monthlySavings).toBeGreaterThan(0);
  });

  test("the month is made from the days billed, however few: fourteen days of resource costs make the same month as thirty", () => {
    const fourteen: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.2xlarge",
      observation: observation({ cpuP95Percent: 12, cpuMaxPercent: 30 }),
      dailyCost: { amount: 10, currency: "EUR", days: 14 },
    });
    const thirty: CloudRightSizing = buildCloudRightSizing({
      profile: EC2,
      size: "m5.2xlarge",
      observation: observation({ cpuP95Percent: 12, cpuMaxPercent: 30 }),
      dailyCost: { amount: 10, currency: "EUR", days: 30 },
    });
    expect(fourteen.monthlySavings).toBe(thirty.monthlySavings);
    expect(fourteen.currency).toBe("EUR");
  });

  test("no cost, or a cost of nothing, or no days: the change without a saving", () => {
    for (const dailyCost of [
      null,
      undefined,
      { amount: 0, currency: "USD", days: 30 },
      { amount: 5, currency: "USD", days: 0 },
      { amount: Number.NaN, currency: "USD", days: 30 },
    ]) {
      const sizing: CloudRightSizing = buildCloudRightSizing({
        profile: EC2,
        size: "m5.2xlarge",
        observation: observation({ cpuP95Percent: 12, cpuMaxPercent: 30 }),
        dailyCost,
      });
      expect(sizing).toMatchObject({
        recommendedSize: "m5.xlarge",
        monthlyCost: null,
        currency: null,
        monthlySavings: 0,
      });
    }
  });

  test("readings that are not numbers, or below zero, are read as none or as zero", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.xlarge",
      observation: {
        cpuP95Percent: Number.POSITIVE_INFINITY,
        cpuMaxPercent: -4,
        memoryPeakPercent: Number.NaN,
        samples: Number.NaN,
        observedHours: -10,
      },
    });
    expect(sizing).toMatchObject({
      verdict: CloudRightSizingVerdict.NotEnoughHistory,
      cpuP95Percent: null,
      cpuMaxPercent: 0,
      memoryPeakPercent: null,
      samples: 0,
      observedDays: 0,
    });
  });
});

describe("the readings", () => {
  test("the 95th percentile is the reading at or above 95% of the others", () => {
    const readings: Array<number> = Array.from(
      { length: 100 },
      (_value: unknown, index: number): number => {
        return index + 1;
      },
    );
    expect(getCloudReadingsP95(readings)).toBe(96);
    expect(getCloudReadingsP95([7])).toBe(7);
    expect(getCloudReadingsP95([3, 1, 2])).toBe(3);
    expect(getCloudReadingsP95([])).toBeNull();
    expect(getCloudReadingsP95([Number.NaN, 4])).toBe(4);
  });
});

describe("what a right-sizing is kept as among the ways to spend less", () => {
  test("its id names the resource, and is told from a recommender's", () => {
    const id: string = getCloudRightSizingRecommendationId(
      "82000000-0000-4000-8000-000000000001",
    );
    expect(id).toBe(
      `${CLOUD_RIGHT_SIZING_RECOMMENDATION_PREFIX}82000000-0000-4000-8000-000000000001`,
    );
    expect(isCloudRightSizingRecommendationId(id)).toBe(true);
    expect(isCloudRightSizingRecommendationId("rec-1")).toBe(false);
    expect(isCloudRightSizingRecommendationId(null)).toBe(false);
  });

  test("its evidence: the readings to a tenth of a percent, read back as stored", () => {
    const sizing: CloudRightSizing = buildCloudRightSizing({
      profile: CACHE,
      size: "cache.r6g.2xlarge",
      observation: observation({
        cpuP95Percent: 11.234,
        cpuMaxPercent: 19.987,
        memoryPeakPercent: 21.05,
      }),
    });
    const evidence: ReturnType<typeof toCloudRightSizingEvidence> =
      toCloudRightSizingEvidence(sizing);
    expect(evidence).toEqual({
      cpuP95Percent: 11.2,
      cpuMaxPercent: 20,
      memoryPeakPercent: 21.1,
      observedDays: 14,
      factor: 2,
      isSavingUpperBound: false,
    });
    expect(
      readCloudRightSizingEvidence(JSON.parse(JSON.stringify(evidence))),
    ).toEqual(evidence);
  });

  test("evidence that is missing or malformed reads as none", () => {
    for (const value of [
      null,
      undefined,
      "x",
      [],
      {},
      { cpuP95Percent: "a", observedDays: 14 },
      { cpuP95Percent: 10, observedDays: 0 },
      { cpuP95Percent: -1, observedDays: 14 },
    ]) {
      expect(readCloudRightSizingEvidence(value)).toBeNull();
    }
    expect(
      readCloudRightSizingEvidence({
        cpuP95Percent: 10,
        observedDays: 7.9,
        factor: "x",
        memoryPeakPercent: "",
      }),
    ).toEqual({
      cpuP95Percent: 10,
      cpuMaxPercent: null,
      memoryPeakPercent: null,
      observedDays: 7,
      factor: 1,
      isSavingUpperBound: false,
    });
  });
});

describe("what a recommender's recommendation says of a resource's size", () => {
  test("a resize, a stop and a newer generation speak for its size; a commitment does not, nor OneUptime's own", () => {
    for (const kind of [
      CloudSavingKind.Rightsize,
      CloudSavingKind.Idle,
      CloudSavingKind.Upgrade,
    ]) {
      expect(
        isRecommenderSizeRecommendation({ kind, recommendationId: "rec-1" }),
      ).toBe(true);
    }
    expect(CLOUD_SIZE_RECOMMENDATION_KINDS).toHaveLength(3);
    expect(
      isRecommenderSizeRecommendation({
        kind: CloudSavingKind.Commitment,
        recommendationId: "rec-2",
      }),
    ).toBe(false);
    expect(
      isRecommenderSizeRecommendation({
        kind: CloudSavingKind.Other,
        recommendationId: "rec-3",
      }),
    ).toBe(false);
    expect(
      isRecommenderSizeRecommendation({
        kind: CloudSavingKind.Rightsize,
        recommendationId: getCloudRightSizingRecommendationId(
          "82000000-0000-4000-8000-000000000001",
        ),
      }),
    ).toBe(false);
    expect(
      isRecommenderSizeRecommendation({ kind: null, recommendationId: null }),
    ).toBe(false);
  });
});

describe("every profile's provider is one OneUptime connects", () => {
  test("AWS, Azure and Google Cloud only", () => {
    const providers: Set<string> = new Set(
      CLOUD_RIGHT_SIZING_PROFILES.map((profile: CloudRightSizingProfile) => {
        return profile.provider;
      }),
    );
    expect(Array.from(providers).sort()).toEqual(
      [CloudProvider.AWS, CloudProvider.Azure, CloudProvider.GCP].sort(),
    );
  });
});
