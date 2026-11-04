import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_FARGATE_USD_PER_GB_HOUR,
  AWS_FARGATE_USD_PER_VCPU_HOUR,
  AWS_PUBLIC_IPV4_USD_PER_HOUR,
  AZURE_CONTAINER_APPS_FREE_GIB_SECONDS,
  AZURE_CONTAINER_APPS_FREE_VCPU_SECONDS,
  AZURE_CONTAINER_APPS_USD_PER_GIB_SECOND,
  AZURE_CONTAINER_APPS_USD_PER_VCPU_SECOND,
  CLOUD_AI_AGENT_HOURS_PER_MONTH,
  CLOUD_AI_AGENT_SECONDS_PER_MONTH,
  CloudAiAgentCostEstimate,
  GCP_CLOUD_RUN_FREE_GIB_SECONDS,
  GCP_CLOUD_RUN_FREE_VCPU_SECONDS,
  GCP_CLOUD_RUN_USD_PER_GIB_SECOND,
  GCP_CLOUD_RUN_USD_PER_VCPU_SECOND,
  GCP_E2_MICRO_USD_PER_HOUR,
  GCP_EXTERNAL_IPV4_USD_PER_HOUR,
  GCP_STANDARD_DISK_USD_PER_GB_MONTH,
  estimateCloudAiAgentMonthlyCost,
} from "../../../Types/CloudConnection/CloudAiAgentCost";
import {
  CLOUD_AI_AGENT_SIZES,
  CloudAiAgentSetupOptions,
  GCP_CLOUD_AI_AGENT_BOOT_DISK_GB,
  GCP_CLOUD_AI_AGENT_BOOT_DISK_TYPE,
  GCP_CLOUD_AI_AGENT_MACHINE_TYPE,
  getAwsCloudAiAgentTemplate,
  getAzureCloudAiAgentSetupCommand,
  getGcpCloudAiAgentSetupCommand,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Cloud AI agent costs in the customer's own cloud bill, shown
 * before setup: one small container running all month, at each cloud's
 * list prices and past its free allowance, in whole dollars - for the size
 * each cloud's command actually asks for.
 */

const BASE: Omit<CloudAiAgentSetupOptions, "provider" | "accountId"> = {
  oneuptimeUrl: "https://oneuptime.com",
  ingestionKey: "0b5f2c1e-1111-4111-8111-222233334444",
  cloudAccountId: "33333333-3333-4333-8333-333333333333",
  fixesMode: "RequireApproval",
};

describe("the month and the list prices", () => {
  test("a month is the 730 hours the clouds' calculators count", () => {
    expect(CLOUD_AI_AGENT_HOURS_PER_MONTH).toBe(730);
    expect(CLOUD_AI_AGENT_HOURS_PER_MONTH).toBe((365 * 24) / 12);
    expect(CLOUD_AI_AGENT_SECONDS_PER_MONTH).toBe(2628000);
  });

  test("are the clouds' list prices and free allowances", () => {
    // AWS Fargate, Linux/x86 in us-east-1, and a public IPv4 address.
    expect(AWS_FARGATE_USD_PER_VCPU_HOUR).toBe(0.04048);
    expect(AWS_FARGATE_USD_PER_GB_HOUR).toBe(0.004445);
    expect(AWS_PUBLIC_IPV4_USD_PER_HOUR).toBe(0.005);
    // Azure Container Apps' consumption plan, active use.
    expect(AZURE_CONTAINER_APPS_USD_PER_VCPU_SECOND).toBe(0.000024);
    expect(AZURE_CONTAINER_APPS_USD_PER_GIB_SECOND).toBe(0.000003);
    expect(AZURE_CONTAINER_APPS_FREE_VCPU_SECONDS).toBe(180000);
    expect(AZURE_CONTAINER_APPS_FREE_GIB_SECONDS).toBe(360000);
    // Cloud Run with CPU always allocated (instance-based), tier 1.
    expect(GCP_CLOUD_RUN_USD_PER_VCPU_SECOND).toBe(0.000018);
    expect(GCP_CLOUD_RUN_USD_PER_GIB_SECOND).toBe(0.000002);
    expect(GCP_CLOUD_RUN_FREE_VCPU_SECONDS).toBe(240000);
    expect(GCP_CLOUD_RUN_FREE_GIB_SECONDS).toBe(450000);
    // Compute Engine in us-central1: an e2-micro, standard disk, an external IPv4 address.
    expect(GCP_E2_MICRO_USD_PER_HOUR).toBe(0.008376);
    expect(GCP_STANDARD_DISK_USD_PER_GB_MONTH).toBe(0.04);
    expect(GCP_EXTERNAL_IPV4_USD_PER_HOUR).toBe(0.005);
  });
});

describe("estimateCloudAiAgentMonthlyCost", () => {
  test("AWS: a quarter vCPU and half a GB of Fargate all month, and the public IPv4 address", () => {
    const exact: number = 730 * (0.25 * 0.04048 + 0.5 * 0.004445 + 0.005);

    expect(exact).toBeCloseTo(12.660025, 6);
    expect(estimateCloudAiAgentMonthlyCost(CloudProvider.AWS).usd).toBe(13);
  });

  test("Azure: a quarter vCPU and half a GiB of Container Apps all month, past the subscription's free grant", () => {
    const vcpuSeconds: number = 0.25 * 2628000;
    const gibSeconds: number = 0.5 * 2628000;
    const exact: number =
      (vcpuSeconds - 180000) * 0.000024 + (gibSeconds - 360000) * 0.000003;

    expect(vcpuSeconds).toBe(657000);
    expect(gibSeconds).toBe(1314000);
    expect(exact).toBeCloseTo(11.448 + 2.862, 6);
    expect(estimateCloudAiAgentMonthlyCost(CloudProvider.Azure).usd).toBe(14);
  });

  test("Google Cloud on Cloud Run: a whole vCPU and half a GiB with CPU always allocated, past the free tier", () => {
    const exact: number =
      (2628000 - 240000) * 0.000018 + (0.5 * 2628000 - 450000) * 0.000002;

    expect(exact).toBeCloseTo(42.984 + 1.728, 6);
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "cloud-run").usd,
    ).toBe(45);
  });

  test("Google Cloud on its VM, the default: an e2-micro, its 10 GB standard disk and its external address all month", () => {
    const exact: number = 730 * (0.008376 + 0.005) + 10 * 0.04;

    expect(exact).toBeCloseTo(6.11448 + 3.65 + 0.4, 6);
    expect(estimateCloudAiAgentMonthlyCost(CloudProvider.GCP).usd).toBe(10);
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "compute-engine"),
    ).toEqual(estimateCloudAiAgentMonthlyCost(CloudProvider.GCP));
  });

  test("the VM is the cheaper host, by far: what the follow-up asked for", () => {
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "compute-engine").usd,
    ).toBeLessThan(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "cloud-run").usd / 4,
    );
  });

  test("a host is Google Cloud's choice alone: the other clouds' figures ignore it", () => {
    for (const provider of [CloudProvider.AWS, CloudProvider.Azure]) {
      expect(estimateCloudAiAgentMonthlyCost(provider, "cloud-run")).toEqual(
        estimateCloudAiAgentMonthlyCost(provider),
      );
      expect(
        estimateCloudAiAgentMonthlyCost(provider, "compute-engine"),
      ).toEqual(estimateCloudAiAgentMonthlyCost(provider));
    }
  });

  test("every figure is whole dollars, and above nothing: an always-on agent is never free at list prices", () => {
    for (const [provider, host] of [
      [CloudProvider.AWS, undefined],
      [CloudProvider.Azure, undefined],
      [CloudProvider.GCP, "compute-engine"],
      [CloudProvider.GCP, "cloud-run"],
    ] as Array<[CloudProvider, "compute-engine" | "cloud-run" | undefined]>) {
      const estimate: CloudAiAgentCostEstimate =
        estimateCloudAiAgentMonthlyCost(provider, host);

      expect(Number.isInteger(estimate.usd)).toBe(true);
      expect(estimate.usd).toBeGreaterThan(0);
      expect(estimate.usd).toBeLessThan(100);
    }
  });

  test("says what it counts: the size, the time, and the free allowance it took off", () => {
    expect(estimateCloudAiAgentMonthlyCost(CloudProvider.AWS).description).toBe(
      "One ECS Fargate task of 0.25 vCPU and 0.5 GB running all month, and its public IPv4 address, at us-east-1 list prices.",
    );
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.Azure).description,
    ).toBe(
      "One Container Apps replica of 0.25 vCPU and 0.5 GiB running all month, at the consumption plan's list prices for active use, after the subscription's monthly free grant of 180,000 vCPU-seconds and 360,000 GiB-seconds.",
    );
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "cloud-run")
        .description,
    ).toBe(
      "One Cloud Run instance of 1 vCPU and 0.5 GiB with CPU always allocated, running all month at the instance-based list prices of a tier 1 region, after the monthly free tier of 240,000 vCPU-seconds and 450,000 GiB-seconds.",
    );
    expect(estimateCloudAiAgentMonthlyCost(CloudProvider.GCP).description).toBe(
      "One e2-micro Compute Engine VM running all month, with its 10 GB standard boot disk and its external IPv4 address, at us-central1 list prices. Google Cloud's free tier covers one e2-micro VM a month in us-central1, us-west1 and us-east1.",
    );
  });

  test("prices the size each cloud's command asks for", () => {
    const task: { Cpu: string; Memory: string } = JSON.parse(
      getAwsCloudAiAgentTemplate({
        ...BASE,
        provider: CloudProvider.AWS,
        accountId: "123456789012",
      }),
    ).Resources.TaskDefinition.Properties;
    const azure: string = getAzureCloudAiAgentSetupCommand({
      ...BASE,
      provider: CloudProvider.Azure,
      accountId: "0b1f6471-1bf0-4dda-aec3-111122223333",
    });
    const gcp: string = getGcpCloudAiAgentSetupCommand({
      ...BASE,
      provider: CloudProvider.GCP,
      accountId: "my-project-123",
      gcpHost: "cloud-run",
    });
    const gcpVm: string = getGcpCloudAiAgentSetupCommand({
      ...BASE,
      provider: CloudProvider.GCP,
      accountId: "my-project-123",
    });

    expect(Number(task.Cpu) / 1024).toBe(
      CLOUD_AI_AGENT_SIZES[CloudProvider.AWS].vcpu,
    );
    expect(Number(task.Memory) / 1024).toBe(
      CLOUD_AI_AGENT_SIZES[CloudProvider.AWS].memoryGiB,
    );
    expect(azure).toContain(
      `--cpu ${CLOUD_AI_AGENT_SIZES[CloudProvider.Azure].vcpu} --memory ${CLOUD_AI_AGENT_SIZES[CloudProvider.Azure].memoryGiB}Gi `,
    );
    expect(gcp).toContain(
      `--cpu ${CLOUD_AI_AGENT_SIZES[CloudProvider.GCP].vcpu} --memory ${CLOUD_AI_AGENT_SIZES[CloudProvider.GCP].memoryGiB * 1024}Mi `,
    );
    // The VM priced is the VM the command makes.
    expect(gcpVm).toContain(`--machine-type ${GCP_CLOUD_AI_AGENT_MACHINE_TYPE} `);
    expect(gcpVm).toContain(
      `--boot-disk-size ${GCP_CLOUD_AI_AGENT_BOOT_DISK_GB}GB --boot-disk-type ${GCP_CLOUD_AI_AGENT_BOOT_DISK_TYPE}`,
    );
    expect(GCP_CLOUD_AI_AGENT_BOOT_DISK_TYPE).toBe("pd-standard");
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP).description,
    ).toContain(
      `${GCP_CLOUD_AI_AGENT_MACHINE_TYPE} Compute Engine VM running all month, with its ${GCP_CLOUD_AI_AGENT_BOOT_DISK_GB} GB standard boot disk`,
    );
  });

  test("the free allowances are what bring Azure and Google Cloud down", () => {
    const withoutAzureGrant: number =
      0.25 * 2628000 * 0.000024 + 0.5 * 2628000 * 0.000003;
    const withoutGcpTier: number =
      2628000 * 0.000018 + 0.5 * 2628000 * 0.000002;

    expect(Math.round(withoutAzureGrant)).toBe(20);
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.Azure).usd,
    ).toBeLessThan(Math.round(withoutAzureGrant));
    expect(Math.round(withoutGcpTier)).toBe(50);
    expect(
      estimateCloudAiAgentMonthlyCost(CloudProvider.GCP, "cloud-run").usd,
    ).toBeLessThan(Math.round(withoutGcpTier));
  });
});
