import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
  roundCost,
} from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentFigures,
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
  readCloudCommitmentTermMonths,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudCommitmentInventoryRead,
  CloudCommitmentRecord,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import AzureArm from "./AzureArm";

/*
 * EVERY RESERVATION AND SAVINGS PLAN OF AN AZURE TENANT (#11011).
 *
 *   Reservation - List All (GET {management}/providers/Microsoft.Capacity/
 *   reservations?api-version=2022-11-01)
 *     -> { value: [{ id, name, location, sku: { name }, properties: {
 *          displayName, appliedScopeType, appliedScopeProperties,
 *          appliedScopes, reservedResourceType, quantity, provisioningState,
 *          displayProvisioningState, effectiveDateTime, benefitStartTime,
 *          expiryDateTime, term, billingPlan, billingScopeId, renew,
 *          archived, utilization: { aggregates: [{ grain: 1 | 7 | 30,
 *          grainUnit: "days", value, valueUnit: "percentage" }] } } }],
 *          nextLink }
 *   Savings Plan - List All (GET {management}/providers/
 *   Microsoft.BillingBenefits/savingsPlans?api-version=2022-11-01)
 *     -> { value: [{ id, sku: { name }, properties: { displayName,
 *          provisioningState, appliedScopeType, appliedScopeProperties,
 *          commitment: { grain: "Hourly", currencyCode, amount }, term,
 *          billingPlan, effectiveDateTime, expiryDateTime, renew,
 *          utilization: { aggregates } } }], nextLink }
 *
 * Both are free. Reservations and savings plans are tenant resources that
 * do not take their roles from a subscription: the app needs Reservations
 * Reader (at /providers/Microsoft.Capacity) and Savings plan Reader (at
 * /providers/Microsoft.BillingBenefits), which only a Global Administrator
 * with elevated access may grant - the setup command's optional step. Each
 * list says when it may not be read; the other is still read.
 *
 * Azure says how much of each was used (its utilization's 7- and 30-day
 * aggregates), not what it cost: a savings plan's cost is its hourly
 * commitment, a reservation's is not on it.
 */

export const AZURE_RESERVATIONS_API_VERSION: string = "2022-11-01";
export const AZURE_SAVINGS_PLANS_API_VERSION: string = "2022-11-01";

// The roles the lists are read with, as the setup command grants them.
export const AZURE_COMMITMENT_ROLES: ReadonlyArray<string> = [
  "Reservations Reader",
  "Savings plan Reader",
];

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readDate(value: unknown): Date | null {
  const time: number = Date.parse(readText(value));
  return Number.isFinite(time) ? new Date(time) : null;
}

/*
 * A utilization aggregate of a grain, in percent: Azure gives 1, 7 and 30
 * days. Null when it gives none of that grain.
 */
export function readAzureUtilization(
  properties: JSONObject,
  grainDays: number,
): number | null {
  for (const raw of readArray(
    readObject(properties["utilization"])["aggregates"],
  )) {
    const aggregate: JSONObject = readObject(raw);

    if (readNumber(aggregate["grain"]) === grainDays) {
      const value: number | null = readNumber(aggregate["value"]);
      return value === null ? null : Math.min(100, Math.max(0, value));
    }
  }

  return null;
}

// A subscription's id from an ARM path: "/subscriptions/abc" -> "abc".
export function readAzureSubscriptionId(value: string): string {
  const match: RegExpMatchArray | null = (value || "").match(
    /\/subscriptions\/([^/]+)/i,
  );
  return match ? match[1]!.toLowerCase() : "";
}

// A provisioning state as OneUptime's state: one that starts later is queued.
export function readAzureCommitmentState(data: {
  provisioningState: string;
  startsAt: Date | null;
  now: Date;
}): CloudCommitmentState {
  const state: string = data.provisioningState.trim().toLowerCase();

  if (state === "expired") {
    return CloudCommitmentState.Expired;
  }

  if (
    state === "cancelled" ||
    state === "failed" ||
    state === "billingfailed" ||
    state === "split" ||
    state === "merged"
  ) {
    return CloudCommitmentState.Retired;
  }

  if (state !== "succeeded") {
    return CloudCommitmentState.Pending;
  }

  return data.startsAt && data.startsAt.getTime() > data.now.getTime()
    ? CloudCommitmentState.Queued
    : CloudCommitmentState.Active;
}

/*
 * Who a reservation or savings plan applies to: one subscription (Single,
 * which may be narrowed to a resource group), a management group, or every
 * subscription of its billing scope (Shared).
 */
export function readAzureCommitmentScope(properties: JSONObject): {
  scope: CloudCommitmentScope;
  appliesTo: string;
  subscriptionId: string;
} {
  const type: string = readText(properties["appliedScopeType"]).toLowerCase();
  const scopeProperties: JSONObject = readObject(
    properties["appliedScopeProperties"],
  );
  const subscriptionId: string =
    readAzureSubscriptionId(readText(scopeProperties["subscriptionId"])) ||
    readAzureSubscriptionId(readText(readArray(properties["appliedScopes"])[0]));

  if (type === "managementgroup") {
    return {
      scope: CloudCommitmentScope.ManagementGroup,
      appliesTo:
        readText(scopeProperties["displayName"]) ||
        readText(scopeProperties["managementGroupId"]),
      subscriptionId: "",
    };
  }

  if (type === "single") {
    const resourceGroup: string = readText(scopeProperties["resourceGroupId"]);

    return resourceGroup
      ? {
          scope: CloudCommitmentScope.ResourceGroup,
          appliesTo: resourceGroup.split("/").pop() || resourceGroup,
          subscriptionId:
            subscriptionId || readAzureSubscriptionId(resourceGroup),
        }
      : {
          scope: CloudCommitmentScope.Account,
          appliesTo:
            readText(scopeProperties["displayName"]) || subscriptionId,
          subscriptionId,
        };
  }

  return { scope: CloudCommitmentScope.Shared, appliesTo: "", subscriptionId };
}

/*
 * The subscription a commitment is kept on: the one it applies to, else
 * the one that pays for it, when the connection holds either - else the
 * first the connection reads.
 */
function pickAccount(data: {
  appliesTo: string;
  billingScopeId: string;
  subscriptions: Array<string>;
}): string {
  const held: Set<string> = new Set<string>(
    data.subscriptions.map((subscription: string): string => {
      return subscription.toLowerCase();
    }),
  );

  for (const candidate of [
    data.appliesTo,
    readAzureSubscriptionId(data.billingScopeId),
  ]) {
    if (candidate && held.has(candidate.toLowerCase())) {
      return candidate.toLowerCase();
    }
  }

  return (data.subscriptions[0] || "").toLowerCase();
}

// One reservation as OneUptime keeps it; null for one archived.
export function readAzureReservation(data: {
  item: JSONObject;
  subscriptions: Array<string>;
  now: Date;
}): CloudCommitmentRecord | null {
  const properties: JSONObject = readObject(data.item["properties"]);
  const id: string = readText(data.item["id"]).toLowerCase();

  if (!id || properties["archived"] === true) {
    return null;
  }

  const startsAt: Date | null =
    readDate(properties["benefitStartTime"]) ||
    readDate(properties["effectiveDateTime"]);
  const endsAt: Date | null =
    readDate(properties["expiryDateTime"]) ||
    readDate(properties["expiryDate"]);
  const where: {
    scope: CloudCommitmentScope;
    appliesTo: string;
    subscriptionId: string;
  } = readAzureCommitmentScope(properties);
  const quantity: number | null = readNumber(properties["quantity"]);
  const sku: string = readText(readObject(data.item["sku"])["name"]);

  return {
    accountId: pickAccount({
      appliesTo: where.subscriptionId,
      billingScopeId: readText(properties["billingScopeId"]),
      subscriptions: data.subscriptions,
    }),
    commitmentId: id,
    kind: CloudCommitmentKind.Reservations,
    name: readText(properties["displayName"]) || readText(data.item["name"]),
    commitmentType: readText(properties["reservedResourceType"]),
    covers: quantity !== null && sku ? `${quantity} × ${sku}` : sku,
    region: readText(data.item["location"]),
    scope: where.scope,
    appliesTo: where.appliesTo,
    termMonths: readCloudCommitmentTermMonths(readText(properties["term"])),
    paymentOption:
      readText(properties["billingPlan"]).toLowerCase() === "monthly"
        ? CloudCommitmentPaymentOption.NoUpfront
        : CloudCommitmentPaymentOption.AllUpfront,
    startsAt,
    endsAt,
    state: readAzureCommitmentState({
      provisioningState:
        readText(properties["provisioningState"]) ||
        readText(properties["displayProvisioningState"]),
      startsAt,
      now: data.now,
    }),
    isAutoRenew: properties["renew"] === true,
    hourlyCommitment: null,
    quantity,
    upfrontCost: null,
    recurringHourlyCost: null,
    currency: CLOUD_COST_DEFAULT_CURRENCY,
    utilizationPercent: readAzureUtilization(properties, 30),
    weekUtilizationPercent: readAzureUtilization(properties, 7),
    figures: null,
  };
}

/*
 * One savings plan as OneUptime keeps it; null for one archived. Its cost
 * is its hourly commitment, so what it cost and left unused over 30 and 7
 * days follows from its utilization.
 */
export function readAzureSavingsPlan(data: {
  item: JSONObject;
  subscriptions: Array<string>;
  now: Date;
}): CloudCommitmentRecord | null {
  const properties: JSONObject = readObject(data.item["properties"]);
  const id: string = readText(data.item["id"]).toLowerCase();

  if (!id || properties["archived"] === true) {
    return null;
  }

  const startsAt: Date | null =
    readDate(properties["benefitStartTime"]) ||
    readDate(properties["effectiveDateTime"]);
  const where: {
    scope: CloudCommitmentScope;
    appliesTo: string;
    subscriptionId: string;
  } = readAzureCommitmentScope(properties);
  const commitment: JSONObject = readObject(properties["commitment"]);
  const amount: number | null = readNumber(commitment["amount"]);
  const grain: string = readText(commitment["grain"]).toLowerCase();
  const hourly: number | null =
    amount !== null && (grain === "hourly" || grain === "") ? amount : null;
  const utilization: number | null = readAzureUtilization(properties, 30);
  const weekUtilization: number | null = readAzureUtilization(properties, 7);
  const figures: CloudCommitmentFigures | null =
    hourly !== null
      ? {
          days: 30,
          commitmentCost: roundCost(hourly * 24 * 30),
          usedCost:
            utilization !== null
              ? roundCost(((hourly * 24 * 30) * utilization) / 100)
              : null,
          unusedCost:
            utilization !== null
              ? roundCost(((hourly * 24 * 30) * (100 - utilization)) / 100)
              : null,
          coveredOnDemandCost: null,
          netSavings: null,
          weekCommitmentCost: roundCost(hourly * 24 * 7),
          weekUnusedCost:
            weekUtilization !== null
              ? roundCost(((hourly * 24 * 7) * (100 - weekUtilization)) / 100)
              : null,
        }
      : null;

  return {
    accountId: pickAccount({
      appliesTo: where.subscriptionId,
      billingScopeId: readText(properties["billingScopeId"]),
      subscriptions: data.subscriptions,
    }),
    commitmentId: id,
    kind: CloudCommitmentKind.SavingsPlans,
    name: readText(properties["displayName"]) || readText(data.item["name"]),
    commitmentType: readText(readObject(data.item["sku"])["name"]),
    covers: "",
    region: "",
    scope: where.scope,
    appliesTo: where.appliesTo,
    termMonths: readCloudCommitmentTermMonths(readText(properties["term"])),
    // A billing plan of P1M is paid monthly; none is paid up front.
    paymentOption: readText(properties["billingPlan"])
      ? CloudCommitmentPaymentOption.NoUpfront
      : CloudCommitmentPaymentOption.AllUpfront,
    startsAt,
    endsAt: readDate(properties["expiryDateTime"]),
    state: readAzureCommitmentState({
      provisioningState:
        readText(properties["provisioningState"]) ||
        readText(properties["displayProvisioningState"]),
      startsAt,
      now: data.now,
    }),
    isAutoRenew: properties["renew"] === true,
    hourlyCommitment: hourly,
    quantity: null,
    upfrontCost: null,
    recurringHourlyCost: null,
    currency:
      readText(commitment["currencyCode"]) || CLOUD_COST_DEFAULT_CURRENCY,
    utilizationPercent: utilization,
    weekUtilizationPercent: weekUtilization,
    figures,
  };
}

// Whether a list was refused: the app has not been given its reader role.
function isRefused(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Permission
  );
}

/*
 * The tenant's reservations and savings plans. A list the app may not read
 * says what to grant, and the other is read anyway; when neither may be
 * read, the commitments are said not allowed. A refused credential is
 * thrown, as every read throws it.
 */
export async function readAzureCommitmentInventory(data: {
  arm: AzureArm;
  subscriptions: Array<string>;
  now: Date;
}): Promise<CloudCommitmentInventoryRead> {
  const records: Array<CloudCommitmentRecord> = [];
  const refused: Array<string> = [];
  let complete: boolean = true;
  let failure: string = "";
  const base: string = data.arm.getManagementBaseUrl();
  const lists: Array<{
    url: string;
    step: string;
    role: string;
    read: (item: JSONObject) => CloudCommitmentRecord | null;
  }> = [
    {
      url: `${base}/providers/Microsoft.Capacity/reservations?api-version=${AZURE_RESERVATIONS_API_VERSION}`,
      step: "reservations",
      role: AZURE_COMMITMENT_ROLES[0]!,
      read: (item: JSONObject): CloudCommitmentRecord | null => {
        return readAzureReservation({
          item,
          subscriptions: data.subscriptions,
          now: data.now,
        });
      },
    },
    {
      url: `${base}/providers/Microsoft.BillingBenefits/savingsPlans?api-version=${AZURE_SAVINGS_PLANS_API_VERSION}`,
      step: "savings plans",
      role: AZURE_COMMITMENT_ROLES[1]!,
      read: (item: JSONObject): CloudCommitmentRecord | null => {
        return readAzureSavingsPlan({
          item,
          subscriptions: data.subscriptions,
          now: data.now,
        });
      },
    },
  ];

  for (const list of lists) {
    try {
      const listed: { items: Array<JSONObject>; complete: boolean } =
        await data.arm.listAll(list.url, list.step);

      complete = complete && listed.complete;

      for (const item of listed.items) {
        const record: CloudCommitmentRecord | null = list.read(item);

        if (record) {
          records.push(record);
        }
      }
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      complete = false;

      if (isRefused(error)) {
        refused.push(list.role);
        continue;
      }

      failure =
        error instanceof CloudReadBudgetSpent
          ? "The read reached its limit before every commitment was listed: they are listed again tomorrow."
          : (error instanceof Error ? error.message : String(error)).slice(
              0,
              500,
            );
    }
  }

  if (refused.length === lists.length) {
    return {
      records,
      complete: false,
      state: CloudCostState.NotAllowed,
      message: `The app may not list the tenant's reservations and savings plans. Give it ${AZURE_COMMITMENT_ROLES.join(
        " and ",
      )} at the tenant: run the setup command's optional step as a Global Administrator with elevated access.`,
    };
  }

  if (failure) {
    return {
      records,
      complete: false,
      state: CloudCostState.Failed,
      message: failure,
    };
  }

  return {
    records,
    complete,
    state: CloudCostState.Reading,
    ...(refused.length > 0
      ? {
          message: `The app may not list the tenant's ${
            refused[0] === AZURE_COMMITMENT_ROLES[0]
              ? "reservations"
              : "savings plans"
          }. Give it ${refused.join(" and ")} at the tenant: run the setup command's optional step as a Global Administrator with elevated access.`,
        }
      : {}),
  };
}
