import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CLOUD_SAVINGS_SOURCE_AZURE,
  CloudCostState,
  CloudSavingKind,
  getCloudCostResourceKey,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import { CloudCostRecord, CloudSavingRecord } from "../CloudConnectorTypes";
import AzureArm from "./AzureArm";

/*
 * WHAT AN AZURE SUBSCRIPTION COSTS, AND HOW TO SPEND LESS IN IT.
 *
 *   Cost Management Query (POST {management}/subscriptions/{id}/providers/
 *   Microsoft.CostManagement/query?api-version=2023-11-01):
 *     { type: "ActualCost", timeframe: "Custom", timePeriod: { from, to },
 *       dataset: { granularity: "Daily",
 *         aggregation: { totalCost: { name: "Cost", function: "Sum" } },
 *         grouping: [ResourceId, ServiceName] } }
 *     -> { properties: { columns: [{ name }], rows: [[cost, 20261102,
 *          resourceId, service, currency]], nextLink } }
 *   A query groups by two dimensions at most: by resource and service. A
 *   resource's Region is the one OneUptime holds for it. Needs Cost
 *   Management Reader on the subscription; Cost Management answers a burst
 *   with 429, which is asked again within the read's budget.
 *
 *   Azure Advisor (GET {management}/subscriptions/{id}/providers/
 *   Microsoft.Advisor/recommendations?api-version=2023-01-01&$filter=
 *   Category eq 'Cost'): its cost recommendations - shut down or resize an
 *   underused VM, reservations and savings plans worth buying, unused
 *   resources - with what each saves (extendedProperties.savingsAmount, a
 *   month, or annualSavingsAmount). Monitoring Reader may read them.
 */

export const AZURE_COST_MANAGEMENT_API_VERSION: string = "2023-11-01";
export const AZURE_ADVISOR_API_VERSION: string = "2023-01-01";
// Pages of one subscription's costs at most.
export const AZURE_COST_MAX_PAGES: number = 10;

// "20261102" (Cost Management's UsageDate) -> "2026-11-02".
export function readAzureUsageDate(value: unknown): string {
  const text: string = readText(value);

  if (text.length !== 8) {
    return "";
  }

  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export async function readAzureCosts(data: {
  arm: AzureArm;
  subscriptionId: string;
  start: Date;
  end: Date;
  // A resource's id (as getCloudCostResourceKey keeps it) -> its Region.
  regionsByResource: Map<string, string>;
}): Promise<{ records: Array<CloudCostRecord>; complete: boolean }> {
  const records: Array<CloudCostRecord> = [];
  const lastDay: Date = new Date(data.end.getTime() - 1000);
  const body: JSONObject = {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: {
      from: `${toCloudCostDay(data.start)}T00:00:00Z`,
      to: `${toCloudCostDay(lastDay)}T23:59:59Z`,
    },
    dataset: {
      granularity: "Daily",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [
        { type: "Dimension", name: "ResourceId" },
        { type: "Dimension", name: "ServiceName" },
      ],
    },
  };

  let url: string = `${data.arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
    data.subscriptionId,
  )}/providers/Microsoft.CostManagement/query?api-version=${AZURE_COST_MANAGEMENT_API_VERSION}`;

  for (let page: number = 0; page < AZURE_COST_MAX_PAGES; page++) {
    const answer: JSONObject = await data.arm.post(url, body, "cost query");
    const properties: JSONObject = readObject(answer["properties"]);
    const columns: Array<string> = readArray(properties["columns"]).map(
      (column: unknown): string => {
        return readText(readObject(column)["name"]).toLowerCase();
      },
    );
    const at: (name: string) => number = (name: string): number => {
      return columns.indexOf(name.toLowerCase());
    };
    const costAt: number = at("Cost") >= 0 ? at("Cost") : at("PreTaxCost");
    const dayAt: number = at("UsageDate");
    const resourceAt: number = at("ResourceId");
    const serviceAt: number = at("ServiceName");
    const currencyAt: number = at("Currency");

    for (const rawRow of readArray(properties["rows"])) {
      const row: Array<unknown> = Array.isArray(rawRow)
        ? (rawRow as Array<unknown>)
        : [];
      const amount: number = Number(row[costAt]);
      const day: string = readAzureUsageDate(row[dayAt]);

      if (!day || !Number.isFinite(amount) || amount === 0) {
        continue;
      }

      const resourceId: string = getCloudCostResourceKey(
        "azure",
        readText(row[resourceAt]),
      );

      records.push({
        accountId: data.subscriptionId,
        day,
        service: readText(row[serviceAt]),
        region: data.regionsByResource.get(resourceId) || "",
        resourceId,
        currency: readText(row[currencyAt]) || CLOUD_COST_DEFAULT_CURRENCY,
        amount,
      });
    }

    const next: string = readText(properties["nextLink"]);

    if (!next || next === url) {
      return { records, complete: true };
    }

    url = next;
  }

  return { records, complete: false };
}

function readNumber(value: unknown): number {
  const number: number = Number(readText(value));
  return Number.isFinite(number) ? number : 0;
}

// What an Advisor cost recommendation asks, as one of OneUptime's kinds.
export function getAzureSavingKind(data: {
  recommendationType: string;
  solution: string;
}): CloudSavingKind {
  const type: string = data.recommendationType.trim().toLowerCase();
  const words: string = data.solution.toLowerCase();

  if (type === "skuchange") {
    return CloudSavingKind.Rightsize;
  }

  if (type === "shutdown") {
    return CloudSavingKind.Idle;
  }

  if (
    words.includes("reserved instance") ||
    words.includes("reservation") ||
    words.includes("savings plan")
  ) {
    return CloudSavingKind.Commitment;
  }

  if (
    words.includes("right-size") ||
    words.includes("right size") ||
    words.includes("resize")
  ) {
    return CloudSavingKind.Rightsize;
  }

  if (
    words.includes("delete") ||
    words.includes("unattached") ||
    words.includes("unused") ||
    words.includes("idle") ||
    words.includes("shut down")
  ) {
    return CloudSavingKind.Idle;
  }

  if (words.includes("upgrade") || words.includes("newer")) {
    return CloudSavingKind.Upgrade;
  }

  return CloudSavingKind.Other;
}

// One Advisor recommendation as OneUptime keeps it; null for one that saves nothing.
export function readAzureAdvisorRecommendation(data: {
  item: JSONObject;
  subscriptionId: string;
}): CloudSavingRecord | null {
  const id: string = readText(data.item["id"]);
  const properties: JSONObject = readObject(data.item["properties"]);

  if (!id || readText(properties["category"]).toLowerCase() !== "cost") {
    return null;
  }

  const extended: JSONObject = readObject(properties["extendedProperties"]);
  const monthly: number = readNumber(extended["savingsAmount"]);
  const annual: number = readNumber(extended["annualSavingsAmount"]);
  const savings: number = monthly > 0 ? monthly : annual > 0 ? annual / 12 : 0;

  if (savings <= 0) {
    return null;
  }

  const description: JSONObject = readObject(properties["shortDescription"]);
  const solution: string =
    readText(description["solution"]) || readText(description["problem"]);
  const resourceId: string =
    readText(readObject(properties["resourceMetadata"])["resourceId"]) || "";

  return {
    recommendationId: id,
    accountId: data.subscriptionId,
    region: readText(extended["regionId"]) || readText(extended["location"]),
    resourceId,
    resourceType: readText(properties["impactedField"]),
    resourceName: readText(properties["impactedValue"]),
    kind: getAzureSavingKind({
      recommendationType: readText(extended["recommendationType"]),
      solution,
    }),
    action: solution || "Review",
    currentConfiguration: readText(extended["currentSku"]),
    recommendedConfiguration: readText(extended["targetSku"]),
    monthlySavings: savings,
    monthlyCost: null,
    currency:
      readText(extended["savingsCurrency"]) || CLOUD_COST_DEFAULT_CURRENCY,
    effort: readText(properties["impact"]),
    source: CLOUD_SAVINGS_SOURCE_AZURE,
  };
}

export async function readAzureAdvisor(data: {
  arm: AzureArm;
  subscriptionId: string;
}): Promise<{ recommendations: Array<CloudSavingRecord>; complete: boolean }> {
  const listed: { items: Array<JSONObject>; complete: boolean } =
    await data.arm.listAll(
      `${data.arm.getManagementBaseUrl()}/subscriptions/${encodeURIComponent(
        data.subscriptionId,
      )}/providers/Microsoft.Advisor/recommendations?api-version=${AZURE_ADVISOR_API_VERSION}&$filter=${encodeURIComponent(
        "Category eq 'Cost'",
      )}`,
      "Advisor recommendations",
    );

  return {
    recommendations: listed.items
      .map((item: JSONObject): CloudSavingRecord | null => {
        return readAzureAdvisorRecommendation({
          item,
          subscriptionId: data.subscriptionId,
        });
      })
      .filter((record: CloudSavingRecord | null): boolean => {
        return record !== null;
      }) as Array<CloudSavingRecord>,
    complete: listed.complete,
  };
}

// Why costs or savings could not be read, in words the person can act on.
export function describeAzureCostFailure(data: {
  error: unknown;
  what: "costs" | "savings";
}): { state: CloudCostState; message: string } {
  const failure: LlmProviderError | null =
    data.error instanceof LlmProviderError ? data.error : null;
  const message: string =
    data.error instanceof Error ? data.error.message : String(data.error);
  const body: string = (failure?.responseBody || "").toLowerCase();

  if (failure && failure.kind === CloudConnectionFailureKind.Permission) {
    return data.what === "costs"
      ? {
          state: CloudCostState.NotAllowed,
          message:
            "The app may not read the subscription's costs: give it Cost Management Reader (run the setup command again).",
        }
      : {
          state: CloudCostState.NotAllowed,
          message:
            "The app may not read Azure Advisor's recommendations: run the setup command again.",
        };
  }

  if (
    data.what === "costs" &&
    (body.includes("not supported") || body.includes("offer"))
  ) {
    return {
      state: CloudCostState.NotSetUp,
      message:
        "Cost Management does not answer for this subscription's offer type (a sponsorship or a free trial, for one).",
    };
  }

  return { state: CloudCostState.Failed, message: message.slice(0, 500) };
}
