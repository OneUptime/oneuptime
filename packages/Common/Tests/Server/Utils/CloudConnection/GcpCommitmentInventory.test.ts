import {
  GCP_COMMITMENT_ASSET_TYPE,
  describeGcpCommitmentResources,
  readGcpCommitment,
  readGcpCommitmentInventory,
  readGcpCommitmentState,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCommitmentInventory";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentState,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import { describe, expect, test } from "@jest/globals";

/*
 * A Google Cloud project's Compute Engine commitments (#11011), each as
 * Cloud Asset Inventory gives its resource's data - the commitment as
 * Compute Engine's regionCommitments resource writes it.
 */

// A three-year commitment to 96 vCPUs and 384 GB of E2, as Compute Engine writes one.
const COMMITMENT: JSONObject = {
  kind: "compute#commitment",
  id: "1234567890123456789",
  creationTimestamp: "2024-01-15T09:00:00.000-08:00",
  name: "e2-commitment-web",
  region:
    "https://www.googleapis.com/compute/v1/projects/web-prod/regions/us-central1",
  selfLink:
    "https://www.googleapis.com/compute/v1/projects/web-prod/regions/us-central1/commitments/e2-commitment-web",
  status: "ACTIVE",
  statusMessage:
    "The commitment is active, and so will apply to current resource usage.",
  plan: "THIRTY_SIX_MONTH",
  startTimestamp: "2024-01-15T00:00:00.000-08:00",
  endTimestamp: "2027-01-15T00:00:00.000-08:00",
  resources: [
    { type: "VCPU", amount: "96" },
    { type: "MEMORY", amount: "393216" },
  ],
  type: "GENERAL_PURPOSE_E2",
  category: "MACHINE",
  autoRenew: false,
};

describe("a Google Cloud commitment, read", () => {
  test("keeps its name, resources, Region, term, dates and state", () => {
    const record: CloudCommitmentRecord | null = readGcpCommitment({
      commitment: COMMITMENT,
      project: "web-prod",
    });

    expect(record).toMatchObject({
      accountId: "web-prod",
      commitmentId: String(COMMITMENT["selfLink"]),
      kind: CloudCommitmentKind.CommittedUseDiscounts,
      name: "e2-commitment-web",
      commitmentType: "GENERAL_PURPOSE_E2",
      covers: `96${NO_BREAK_SPACE}vCPU, 384${NO_BREAK_SPACE}GB memory`,
      region: "us-central1",
      termMonths: 36,
      paymentOption: CloudCommitmentPaymentOption.NoUpfront,
      state: CloudCommitmentState.Active,
      isAutoRenew: false,
      quantity: 96,
      utilizationPercent: null,
      weekUtilizationPercent: null,
      figures: null,
    });
    expect(record!.endsAt!.toISOString()).toBe("2027-01-15T08:00:00.000Z");
  });

  test("with no URL of its own, it is kept by its project, Region and name", () => {
    const record: CloudCommitmentRecord | null = readGcpCommitment({
      commitment: { ...COMMITMENT, selfLink: undefined },
      project: "web-prod",
    });

    expect(record!.commitmentId).toBe(
      "projects/web-prod/regions/us-central1/commitments/e2-commitment-web",
    );
    expect(
      readGcpCommitment({ commitment: { status: "ACTIVE" }, project: "p" }),
    ).toBeNull();
  });

  test("its resources, said as people read them", () => {
    expect(
      describeGcpCommitmentResources({
        resources: [
          { type: "VCPU", amount: "8" },
          { type: "MEMORY", amount: "32768" },
          { type: "LOCAL_SSD", amount: "375" },
          {
            type: "ACCELERATOR",
            amount: "2",
            acceleratorType:
              "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/acceleratorTypes/nvidia-tesla-t4",
          },
          { type: "VCPU", amount: "0" },
        ],
      }),
    ).toBe(
      // Each number held to its unit, for the page that draws it.
      `8${NO_BREAK_SPACE}vCPU, 32${NO_BREAK_SPACE}GB memory, 375${NO_BREAK_SPACE}GB local SSD, 2 × nvidia-tesla-t4`,
    );
    expect(
      describeGcpCommitmentResources({
        category: "LICENSE",
        licenseResource: {
          license:
            "https://www.googleapis.com/compute/v1/projects/suse-cloud/global/licenses/sles-12",
          amount: "4",
        },
      }),
    ).toBe("4 × sles-12");
  });

  test("its status as OneUptime's state", () => {
    expect(readGcpCommitmentState("ACTIVE")).toBe(CloudCommitmentState.Active);
    expect(readGcpCommitmentState("NOT_YET_ACTIVE")).toBe(
      CloudCommitmentState.Queued,
    );
    expect(readGcpCommitmentState("EXPIRED")).toBe(
      CloudCommitmentState.Expired,
    );
    expect(readGcpCommitmentState("CANCELLED")).toBe(
      CloudCommitmentState.Retired,
    );
  });
});

describe("every project's commitments", () => {
  test("from Cloud Asset Inventory's Compute Engine commitments", async () => {
    const asked: Array<string> = [];
    const inventory: CloudCommitmentInventoryRead =
      await readGcpCommitmentInventory({
        listCommitments: async (project: string) => {
          asked.push(project);
          return {
            commitments: project === "web-prod" ? [COMMITMENT] : [],
            complete: true,
          };
        },
        projects: ["web-prod", "data-prod"],
      });

    expect(GCP_COMMITMENT_ASSET_TYPE).toBe("compute.googleapis.com/Commitment");
    expect(asked).toEqual(["web-prod", "data-prod"]);
    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.complete).toBe(true);
    expect(inventory.records).toHaveLength(1);
  });

  test("a project whose list is refused is named, and the others are read", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readGcpCommitmentInventory({
        listCommitments: async (project: string) => {
          if (project === "data-prod") {
            throw new LlmProviderError({
              message: "Permission 'cloudasset.assets.listResource' denied",
              kind: CloudConnectionFailureKind.Permission,
              statusCode: 403,
            });
          }

          return { commitments: [COMMITMENT], complete: true };
        },
        projects: ["web-prod", "data-prod"],
      });

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.complete).toBe(false);
    expect(inventory.records).toHaveLength(1);
    expect(inventory.message).toContain("data-prod");
    expect(inventory.message).toContain("roles/cloudasset.viewer");
  });

  test("every project refused: not allowed", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readGcpCommitmentInventory({
        listCommitments: async () => {
          throw new LlmProviderError({
            message: "denied",
            kind: CloudConnectionFailureKind.Permission,
          });
        },
        projects: ["web-prod"],
      });

    expect(inventory.state).toBe(CloudCostState.NotAllowed);
  });

  test("a list cut short at its page limit is not complete", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readGcpCommitmentInventory({
        listCommitments: async () => {
          return { commitments: [COMMITMENT], complete: false };
        },
        projects: ["web-prod"],
      });

    expect(inventory.complete).toBe(false);
    expect(inventory.state).toBe(CloudCostState.Reading);
  });

  test("a refused credential is thrown; another failure stops and is said", async () => {
    await expect(
      readGcpCommitmentInventory({
        listCommitments: async () => {
          throw new LlmProviderError({
            message: "invalid_grant",
            kind: CloudConnectionFailureKind.Authentication,
          });
        },
        projects: ["web-prod"],
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);

    const failed: CloudCommitmentInventoryRead =
      await readGcpCommitmentInventory({
        listCommitments: async () => {
          throw new Error("Cloud Asset API has not been used in project 1");
        },
        projects: ["web-prod", "data-prod"],
      });

    expect(failed.state).toBe(CloudCostState.Failed);
    expect(failed.message).toContain("Cloud Asset API");
  });
});
