import {
  AZURE_COMMITMENT_ROLES,
  readAzureCommitmentInventory,
  readAzureCommitmentScope,
  readAzureCommitmentState,
  readAzureReservation,
  readAzureSavingsPlan,
  readAzureSubscriptionId,
  readAzureUtilization,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCommitmentInventory";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * An Azure tenant's reservations and savings plans (#11011), read from the
 * answers Microsoft's REST reference gives as its examples (Reservation -
 * List All, api-version 2022-11-01; Savings Plan - List All), with the
 * tenant's lists stood in.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const SUBSCRIPTION: string = "20000000-0000-0000-0000-000000000005";

// Microsoft's example reservation, its dates moved to run past today.
const RESERVATION: JSONObject = {
  name: "00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000000",
  type: "Microsoft.Capacity/reservationOrders/reservations",
  id: "/providers/microsoft.capacity/reservationOrders/00000000-0000-0000-0000-000000000001/reservations/00000000-0000-0000-0000-000000000000",
  location: "westus",
  properties: {
    appliedScopeType: "Shared",
    displayName: "VM_RI_07-21-2020_12-06",
    displayProvisioningState: "Succeeded",
    effectiveDateTime: "2024-12-21T22:46:32.7632798Z",
    expiryDate: "2026-12-21",
    expiryDateTime: "2026-12-21T22:46:32.7632798Z",
    provisioningState: "Succeeded",
    provisioningSubState: null,
    purchaseDate: "2023-12-21",
    purchaseDateTime: "2023-12-21T22:46:32.7632798Z",
    quantity: 2,
    renew: false,
    reservedResourceType: "VirtualMachines",
    skuDescription: null,
    term: "P3Y",
    userFriendlyAppliedScopeType: "Shared",
    userFriendlyRenewState: "Off",
    utilization: {
      aggregates: [
        { grain: 1, grainUnit: "days", value: 100, valueUnit: "percentage" },
        { grain: 7, grainUnit: "days", value: 55, valueUnit: "percentage" },
        { grain: 30, grainUnit: "days", value: 72.5, valueUnit: "percentage" },
      ],
      trend: "DOWN",
    },
  },
  sku: { name: "Standard_D1" },
};

// Microsoft's example savings plan, its dates moved to run past today.
const SAVINGS_PLAN: JSONObject = {
  name: "20000000-0000-0000-0000-000000000000/30000000-0000-0000-0000-000000000000",
  type: "Microsoft.BillingBenefits/savingsPlanOrders/savingsPlans",
  id: "/providers/microsoft.billingbenefits/savingsPlanOrders/20000000-0000-0000-0000-000000000000/savingsPlans/30000000-0000-0000-0000-000000000000",
  properties: {
    appliedScopeProperties: {
      displayName: "Azure subscription 1",
      subscriptionId: `/subscriptions/${SUBSCRIPTION}`,
    },
    appliedScopeType: "Single",
    billingScopeId:
      "/providers/Microsoft.Billing/billingAccounts/20000000-1000-0000-0000-000000000009",
    commitment: { amount: 0.5, currencyCode: "USD", grain: "Hourly" },
    displayName: "Compute_SavingsPlan_10-19-2025_11-03",
    displayProvisioningState: "Succeeded",
    effectiveDateTime: "2025-10-19T18:05:37.1034288Z",
    expiryDateTime: "2026-12-19T18:05:36.5252231Z",
    provisioningState: "Succeeded",
    purchaseDateTime: "2025-10-19T18:03:56.4032132Z",
    renew: false,
    term: "P1Y",
    userFriendlyAppliedScopeType: "Single",
    utilization: {
      aggregates: [
        { grain: 1, grainUnit: "days", value: 100, valueUnit: "percentage" },
        { grain: 7, grainUnit: "days", value: 78, valueUnit: "percentage" },
        { grain: 30, grainUnit: "days", value: 78.12, valueUnit: "percentage" },
      ],
      trend: "",
    },
  },
  sku: { name: "Compute_Savings_Plan" },
};

// The tenant's two lists, each answered or refused.
function arm(data: {
  reservations?: Array<JSONObject> | Error | undefined;
  savingsPlans?: Array<JSONObject> | Error | undefined;
}): AzureArm {
  return {
    getManagementBaseUrl: (): string => {
      return "https://management.azure.com";
    },
    listAll: async (
      url: string,
    ): Promise<{ items: Array<JSONObject>; complete: boolean }> => {
      const answer: Array<JSONObject> | Error | undefined = url.includes(
        "Microsoft.Capacity",
      )
        ? data.reservations
        : data.savingsPlans;

      if (answer instanceof Error) {
        throw answer;
      }

      return { items: answer || [], complete: true };
    },
  } as unknown as AzureArm;
}

function refusal(): LlmProviderError {
  return new LlmProviderError({
    message:
      "The client does not have authorization to perform action 'Microsoft.Capacity/reservations/read'.",
    kind: CloudConnectionFailureKind.Permission,
    statusCode: 403,
  });
}

describe("an Azure tenant's commitments", () => {
  test("its reservation and savings plan are listed with their end dates and use", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readAzureCommitmentInventory({
        arm: arm({ reservations: [RESERVATION], savingsPlans: [SAVINGS_PLAN] }),
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      });

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.complete).toBe(true);
    expect(inventory.message).toBeUndefined();
    expect(inventory.records).toHaveLength(2);

    const reservation: CloudCommitmentRecord = inventory.records[0]!;
    expect(reservation).toMatchObject({
      accountId: SUBSCRIPTION,
      kind: CloudCommitmentKind.Reservations,
      name: "VM_RI_07-21-2020_12-06",
      commitmentType: "VirtualMachines",
      covers: "2 × Standard_D1",
      region: "westus",
      scope: CloudCommitmentScope.Shared,
      appliesTo: "",
      termMonths: 36,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      state: CloudCommitmentState.Active,
      isAutoRenew: false,
      quantity: 2,
      utilizationPercent: 72.5,
      weekUtilizationPercent: 55,
      figures: null,
    });
    expect(reservation.endsAt!.toISOString()).toBe("2026-12-21T22:46:32.763Z");
    expect(reservation.commitmentId).toBe(
      String(RESERVATION["id"]).toLowerCase(),
    );

    const plan: CloudCommitmentRecord = inventory.records[1]!;
    expect(plan).toMatchObject({
      accountId: SUBSCRIPTION,
      kind: CloudCommitmentKind.SavingsPlans,
      name: "Compute_SavingsPlan_10-19-2025_11-03",
      commitmentType: "Compute_Savings_Plan",
      scope: CloudCommitmentScope.Account,
      appliesTo: "Azure subscription 1",
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      hourlyCommitment: 0.5,
      currency: "USD",
      utilizationPercent: 78.12,
      weekUtilizationPercent: 78,
    });
    // What a week of it cost, and what of that went unused: 22% of $84.
    expect(plan.figures!.weekCommitmentCost).toBe(84);
    expect(plan.figures!.weekUnusedCost).toBeCloseTo(18.48, 2);
    expect(plan.figures!.commitmentCost).toBe(360);
    expect(plan.figures!.coveredOnDemandCost).toBeNull();
  });

  test("a list the app may not read says which role it needs, and the other is still read", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readAzureCommitmentInventory({
        arm: arm({ reservations: refusal(), savingsPlans: [SAVINGS_PLAN] }),
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      });

    expect(inventory.state).toBe(CloudCostState.Reading);
    expect(inventory.complete).toBe(false);
    expect(inventory.records).toHaveLength(1);
    expect(inventory.message).toContain("Reservations Reader");
    expect(inventory.message).toContain("reservations");
  });

  test("neither list read: not allowed, with both roles named", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readAzureCommitmentInventory({
        arm: arm({ reservations: refusal(), savingsPlans: refusal() }),
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      });

    expect(inventory.state).toBe(CloudCostState.NotAllowed);
    for (const role of AZURE_COMMITMENT_ROLES) {
      expect(inventory.message).toContain(role);
    }
    expect(inventory.message).toContain("Global Administrator");
  });

  test("another failure is said, and what was read is kept", async () => {
    const inventory: CloudCommitmentInventoryRead =
      await readAzureCommitmentInventory({
        arm: arm({
          reservations: [RESERVATION],
          savingsPlans: new Error("Azure had a moment."),
        }),
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      });

    expect(inventory.state).toBe(CloudCostState.Failed);
    expect(inventory.records).toHaveLength(1);
    expect(inventory.message).toBe("Azure had a moment.");
  });

  test("a refused credential is thrown", async () => {
    await expect(
      readAzureCommitmentInventory({
        arm: arm({
          reservations: new LlmProviderError({
            message: "AADSTS7000215: Invalid client secret provided.",
            kind: CloudConnectionFailureKind.Authentication,
          }),
        }),
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe("a reservation and a savings plan, read", () => {
  test("an archived one is left out", () => {
    expect(
      readAzureReservation({
        item: {
          ...RESERVATION,
          properties: {
            ...(RESERVATION["properties"] as JSONObject),
            archived: true,
          },
        },
        subscriptions: [SUBSCRIPTION],
        now: NOW,
      }),
    ).toBeNull();
    expect(
      readAzureSavingsPlan({ item: {}, subscriptions: [], now: NOW }),
    ).toBeNull();
  });

  test("one billed monthly is paid as it runs, and one that renews says so", () => {
    const reservation: CloudCommitmentRecord | null = readAzureReservation({
      item: {
        ...RESERVATION,
        properties: {
          ...(RESERVATION["properties"] as JSONObject),
          billingPlan: "Monthly",
          renew: true,
        },
      },
      subscriptions: [SUBSCRIPTION],
      now: NOW,
    });

    expect(reservation!.paymentOption).toBe(
      CloudCommitmentPaymentOption.NoUpfront,
    );
    expect(reservation!.isAutoRenew).toBe(true);

    const plan: CloudCommitmentRecord | null = readAzureSavingsPlan({
      item: {
        ...SAVINGS_PLAN,
        properties: {
          ...(SAVINGS_PLAN["properties"] as JSONObject),
          billingPlan: "P1M",
        },
      },
      subscriptions: [SUBSCRIPTION],
      now: NOW,
    });

    expect(plan!.paymentOption).toBe(CloudCommitmentPaymentOption.NoUpfront);
  });

  test("a reservation of a subscription OneUptime does not hold is kept on the first it reads", () => {
    const reservation: CloudCommitmentRecord | null = readAzureReservation({
      item: RESERVATION,
      subscriptions: ["AAAA0000-0000-0000-0000-000000000001"],
      now: NOW,
    });

    expect(reservation!.accountId).toBe("aaaa0000-0000-0000-0000-000000000001");
  });
});

describe("an Azure commitment's words", () => {
  test("its scope: one subscription, a resource group, a management group, or shared", () => {
    expect(
      readAzureCommitmentScope({
        appliedScopeType: "Single",
        appliedScopes: [`/subscriptions/${SUBSCRIPTION}`],
      }),
    ).toEqual({
      scope: CloudCommitmentScope.Account,
      appliesTo: SUBSCRIPTION,
      subscriptionId: SUBSCRIPTION,
    });
    expect(
      readAzureCommitmentScope({
        appliedScopeType: "Single",
        appliedScopeProperties: {
          resourceGroupId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/web-prod`,
        },
      }),
    ).toEqual({
      scope: CloudCommitmentScope.ResourceGroup,
      appliesTo: "web-prod",
      subscriptionId: SUBSCRIPTION,
    });
    expect(
      readAzureCommitmentScope({
        appliedScopeType: "ManagementGroup",
        appliedScopeProperties: {
          managementGroupId:
            "/providers/Microsoft.Management/managementGroups/mg1",
          displayName: "Engineering",
        },
      }),
    ).toEqual({
      scope: CloudCommitmentScope.ManagementGroup,
      appliesTo: "Engineering",
      subscriptionId: "",
    });
    expect(readAzureCommitmentScope({ appliedScopeType: "Shared" }).scope).toBe(
      CloudCommitmentScope.Shared,
    );
  });

  test("its state: succeeded and started is active, later is queued", () => {
    expect(
      readAzureCommitmentState({
        provisioningState: "Succeeded",
        startsAt: new Date("2026-01-01T00:00:00Z"),
        now: NOW,
      }),
    ).toBe(CloudCommitmentState.Active);
    expect(
      readAzureCommitmentState({
        provisioningState: "Succeeded",
        startsAt: new Date("2027-01-01T00:00:00Z"),
        now: NOW,
      }),
    ).toBe(CloudCommitmentState.Queued);
    expect(
      readAzureCommitmentState({
        provisioningState: "Expired",
        startsAt: null,
        now: NOW,
      }),
    ).toBe(CloudCommitmentState.Expired);
    for (const state of ["Cancelled", "Split", "Merged", "BillingFailed"]) {
      expect(
        readAzureCommitmentState({
          provisioningState: state,
          startsAt: null,
          now: NOW,
        }),
      ).toBe(CloudCommitmentState.Retired);
    }
    expect(
      readAzureCommitmentState({
        provisioningState: "PendingBilling",
        startsAt: null,
        now: NOW,
      }),
    ).toBe(CloudCommitmentState.Pending);
  });

  test("utilization aggregates by grain, kept to a percent", () => {
    expect(
      readAzureUtilization(RESERVATION["properties"] as JSONObject, 30),
    ).toBe(72.5);
    expect(
      readAzureUtilization(RESERVATION["properties"] as JSONObject, 7),
    ).toBe(55);
    expect(readAzureUtilization({}, 7)).toBeNull();
    expect(
      readAzureUtilization(
        { utilization: { aggregates: [{ grain: 7, value: 140 }] } },
        7,
      ),
    ).toBe(100);
  });

  test("a subscription's id from an ARM path", () => {
    expect(readAzureSubscriptionId(`/subscriptions/${SUBSCRIPTION}/x`)).toBe(
      SUBSCRIPTION,
    );
    expect(readAzureSubscriptionId("/providers/Microsoft.Billing/x")).toBe("");
  });
});
