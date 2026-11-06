import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
  GcpCloudAiAgentHost,
} from "../ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_AI_AGENT_SIZES,
  CloudAiAgentSize,
  GCP_CLOUD_AI_AGENT_BOOT_DISK_GB,
  GCP_CLOUD_AI_AGENT_MACHINE_TYPE,
} from "./CloudAiAgentSetupCommands";

/*
 * WHAT THE CLOUD AI AGENT COSTS IN THE CUSTOMER'S OWN CLOUD BILL.
 *
 * The agent is one small container that runs all month in the customer's
 * cloud (CLOUD_AI_AGENT_SIZES), billed at the cloud's list prices:
 *
 *   - AWS: one ECS Fargate task of 0.25 vCPU and 0.5 GB, Linux/x86 in
 *     us-east-1, at $0.04048 per vCPU-hour and $0.004445 per GB-hour, and
 *     its public IPv4 address at $0.005 an hour. About $13 a month.
 *   - Azure: one Container Apps replica of 0.25 vCPU and 0.5 GiB on the
 *     consumption plan, at $0.000024 per vCPU-second and $0.000003 per
 *     GiB-second of active use, after the subscription's monthly free
 *     grant of 180,000 vCPU-seconds and 360,000 GiB-seconds. About $14 a
 *     month; less while the replica idles, whose vCPU-seconds cost
 *     $0.000003, and more when other apps of the subscription already use
 *     the free grant.
 *   - Google Cloud, on its default host: one e2-micro Compute Engine VM
 *     at $0.008376 an hour (us-central1), its 10 GB standard persistent
 *     boot disk at $0.04 per GB-month, and its external IPv4 address at
 *     $0.005 an hour. About $10 a month - and Google Cloud's free tier
 *     covers one e2-micro VM and 30 GB of standard disk a month in
 *     us-central1, us-west1 and us-east1, which can take most of it.
 *   - Google Cloud on Cloud Run: one instance of 1 vCPU and 0.5 GiB with
 *     CPU always allocated - Cloud Run keeps CPU allocated only for a
 *     whole vCPU or more - at the instance-based prices of a tier 1
 *     region, $0.000018 per vCPU-second and $0.000002 per GiB-second,
 *     after the monthly free tier of 240,000 vCPU-seconds and 450,000
 *     GiB-seconds. About $45 a month.
 *
 * A month is the 730 hours the clouds' own calculators count. The agent's
 * logs, its requests to OneUptime (one every few seconds) and the secret
 * that holds its key (Secrets Manager's $0.40 a month on AWS; Secret
 * Manager's free tier on Google Cloud; a Container Apps secret is free)
 * are left out: they fit the clouds' free allowances or cost cents.
 *
 * Shown in the setup dialog before the command, in whole dollars.
 */

export const CLOUD_AI_AGENT_HOURS_PER_MONTH: number = 730;
export const CLOUD_AI_AGENT_SECONDS_PER_MONTH: number =
  CLOUD_AI_AGENT_HOURS_PER_MONTH * 60 * 60;

export const AWS_FARGATE_USD_PER_VCPU_HOUR: number = 0.04048;
export const AWS_FARGATE_USD_PER_GB_HOUR: number = 0.004445;
export const AWS_PUBLIC_IPV4_USD_PER_HOUR: number = 0.005;

export const AZURE_CONTAINER_APPS_USD_PER_VCPU_SECOND: number = 0.000024;
export const AZURE_CONTAINER_APPS_USD_PER_GIB_SECOND: number = 0.000003;
export const AZURE_CONTAINER_APPS_FREE_VCPU_SECONDS: number = 180000;
export const AZURE_CONTAINER_APPS_FREE_GIB_SECONDS: number = 360000;

export const GCP_CLOUD_RUN_USD_PER_VCPU_SECOND: number = 0.000018;
export const GCP_CLOUD_RUN_USD_PER_GIB_SECOND: number = 0.000002;
export const GCP_CLOUD_RUN_FREE_VCPU_SECONDS: number = 240000;
export const GCP_CLOUD_RUN_FREE_GIB_SECONDS: number = 450000;

// An e2-micro VM, its standard disk and its external address, us-central1.
export const GCP_E2_MICRO_USD_PER_HOUR: number = 0.008376;
export const GCP_STANDARD_DISK_USD_PER_GB_MONTH: number = 0.04;
export const GCP_EXTERNAL_IPV4_USD_PER_HOUR: number = 0.005;

export interface CloudAiAgentCostEstimate {
  // US dollars a month at list prices, in whole dollars.
  usd: number;
  // What the figure counts, in a sentence.
  description: string;
}

// "180,000", as the description writes a count.
function written(value: number): string {
  return value.toLocaleString("en-US");
}

// What a month of one size costs where it is billed by the second past a free allowance.
function perSecondCost(data: {
  size: CloudAiAgentSize;
  usdPerVcpuSecond: number;
  usdPerGibSecond: number;
  freeVcpuSeconds: number;
  freeGibSeconds: number;
}): number {
  const vcpuSeconds: number = data.size.vcpu * CLOUD_AI_AGENT_SECONDS_PER_MONTH;
  const gibSeconds: number =
    data.size.memoryGiB * CLOUD_AI_AGENT_SECONDS_PER_MONTH;

  return (
    Math.max(0, vcpuSeconds - data.freeVcpuSeconds) * data.usdPerVcpuSecond +
    Math.max(0, gibSeconds - data.freeGibSeconds) * data.usdPerGibSecond
  );
}

export function estimateCloudAiAgentMonthlyCost(
  provider: CloudProvider,
  // Google Cloud only: what runs the agent.
  gcpHost: GcpCloudAiAgentHost = GCP_CLOUD_AI_AGENT_DEFAULT_HOST,
): CloudAiAgentCostEstimate {
  const size: CloudAiAgentSize = CLOUD_AI_AGENT_SIZES[provider];

  if (provider === CloudProvider.GCP && gcpHost === "compute-engine") {
    const usdPerHour: number =
      GCP_E2_MICRO_USD_PER_HOUR + GCP_EXTERNAL_IPV4_USD_PER_HOUR;

    return {
      usd: Math.round(
        usdPerHour * CLOUD_AI_AGENT_HOURS_PER_MONTH +
          GCP_CLOUD_AI_AGENT_BOOT_DISK_GB * GCP_STANDARD_DISK_USD_PER_GB_MONTH,
      ),
      description: `One ${GCP_CLOUD_AI_AGENT_MACHINE_TYPE} Compute Engine VM running all month, with its ${GCP_CLOUD_AI_AGENT_BOOT_DISK_GB} GB standard boot disk and its external IPv4 address, at us-central1 list prices. Google Cloud's free tier covers one ${GCP_CLOUD_AI_AGENT_MACHINE_TYPE} VM a month in us-central1, us-west1 and us-east1.`,
    };
  }

  if (provider === CloudProvider.AWS) {
    const usdPerHour: number =
      size.vcpu * AWS_FARGATE_USD_PER_VCPU_HOUR +
      size.memoryGiB * AWS_FARGATE_USD_PER_GB_HOUR +
      AWS_PUBLIC_IPV4_USD_PER_HOUR;

    return {
      usd: Math.round(usdPerHour * CLOUD_AI_AGENT_HOURS_PER_MONTH),
      description: `One ECS Fargate task of ${size.vcpu} vCPU and ${size.memoryGiB} GB running all month, and its public IPv4 address, at us-east-1 list prices.`,
    };
  }

  if (provider === CloudProvider.Azure) {
    return {
      usd: Math.round(
        perSecondCost({
          size,
          usdPerVcpuSecond: AZURE_CONTAINER_APPS_USD_PER_VCPU_SECOND,
          usdPerGibSecond: AZURE_CONTAINER_APPS_USD_PER_GIB_SECOND,
          freeVcpuSeconds: AZURE_CONTAINER_APPS_FREE_VCPU_SECONDS,
          freeGibSeconds: AZURE_CONTAINER_APPS_FREE_GIB_SECONDS,
        }),
      ),
      description: `One Container Apps replica of ${size.vcpu} vCPU and ${size.memoryGiB} GiB running all month, at the consumption plan's list prices for active use, after the subscription's monthly free grant of ${written(AZURE_CONTAINER_APPS_FREE_VCPU_SECONDS)} vCPU-seconds and ${written(AZURE_CONTAINER_APPS_FREE_GIB_SECONDS)} GiB-seconds.`,
    };
  }

  return {
    usd: Math.round(
      perSecondCost({
        size,
        usdPerVcpuSecond: GCP_CLOUD_RUN_USD_PER_VCPU_SECOND,
        usdPerGibSecond: GCP_CLOUD_RUN_USD_PER_GIB_SECOND,
        freeVcpuSeconds: GCP_CLOUD_RUN_FREE_VCPU_SECONDS,
        freeGibSeconds: GCP_CLOUD_RUN_FREE_GIB_SECONDS,
      }),
    ),
    description: `One Cloud Run instance of ${size.vcpu} vCPU and ${size.memoryGiB} GiB with CPU always allocated, running all month at the instance-based list prices of a tier 1 region, after the monthly free tier of ${written(GCP_CLOUD_RUN_FREE_VCPU_SECONDS)} vCPU-seconds and ${written(GCP_CLOUD_RUN_FREE_GIB_SECONDS)} GiB-seconds.`,
  };
}
