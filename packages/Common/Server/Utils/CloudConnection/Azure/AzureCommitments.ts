import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
  addUtcDays,
  getMostCommonCloudCurrency,
  roundCost,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import {
  CLOUD_COMMITMENT_WINDOW_DAYS,
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
  getCloudCommitmentWindow,
} from "../../../../Types/Cloud/CloudCommitments";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import { CloudReadBudgetSpent } from "../CloudConnectorTypes";
import { AzureCostReader, AzureCostThrottled } from "./AzureCostManagement";
import {
  AZURE_COST_MANAGEMENT_API_VERSION,
  AZURE_COST_MAX_PAGES,
  describeAzureCostFailure,
} from "./AzureCosts";

/*
 * HOW MUCH OF AN AZURE SUBSCRIPTION'S SPEND ITS RESERVATIONS AND SAVINGS
 * PLANS COVER, AND HOW MUCH OF THEM IS USED - from Cost Management, in
 * amortized cost, over the last 30 full days. Two queries a subscription,
 * free, with the Cost Management Reader role the costs are read with:
 *
 *   1. Usage by pricing model and service (ChargeType Usage):
 *        { type: "AmortizedCost", dataset: { granularity: "None",
 *          grouping: [PricingModel, ServiceName],
 *          filter: ChargeType in [Usage] } }
 *      A kind covers the usage priced by it (PricingModel Reservation or
 *      SavingsPlan); what it could cover is the same services' usage
 *      priced pay-as-you-go (OnDemand) - or, for a subscription without
 *      one, the services each kind is bought for most.
 *   2. Each kind's charges (PricingModel Reservation, SavingsPlan):
 *        grouping: [PricingModel, ChargeType]
 *      What the kind cost is all of them; what went unused is its
 *      UnusedReservation or UnusedSavingsPlan charge.
 *
 * Amortized cost is what the usage cost after its discount: the covered
 * usage is counted at that, not at pay-as-you-go rates.
 */

// The pricing models of each kind, as Cost Management names them.
const KIND_PRICING_MODELS: ReadonlyArray<{
  kind: CloudCommitmentKind;
  pricingModel: string;
  unusedChargeType: string;
  // The services the kind is bought for most, for a subscription without one.
  services: ReadonlyArray<string>;
}> = [
  {
    kind: CloudCommitmentKind.SavingsPlans,
    pricingModel: "SavingsPlan",
    unusedChargeType: "UnusedSavingsPlan",
    services: [
      "Virtual Machines",
      "Azure App Service",
      "Container Instances",
      "Functions",
    ],
  },
  {
    kind: CloudCommitmentKind.Reservations,
    pricingModel: "Reservation",
    unusedChargeType: "UnusedReservation",
    services: [
      "Virtual Machines",
      "SQL Database",
      "Azure Cosmos DB",
      "Azure App Service",
    ],
  },
];

const ON_DEMAND_PRICING_MODEL: string = "OnDemand";

// One query's body over the window, with its grouping and filter.
export function buildAzureCommitmentQuery(data: {
  window: { start: Date; end: Date };
  grouping: Array<string>;
  filter: { dimension: string; values: Array<string> };
}): JSONObject {
  return {
    type: "AmortizedCost",
    timeframe: "Custom",
    timePeriod: {
      from: `${toCloudCostDay(data.window.start)}T00:00:00Z`,
      to: `${toCloudCostDay(addUtcDays(data.window.end, -1))}T23:59:59Z`,
    },
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: data.grouping.map((name: string): JSONObject => {
        return { type: "Dimension", name };
      }),
      filter: {
        dimensions: {
          name: data.filter.dimension,
          operator: "In",
          values: data.filter.values,
        },
      },
    },
  };
}

/*
 * Every row of a query, followed to its last page, each as its columns
 * name it (lower case): { cost, pricingmodel, servicename, currency }.
 * Each page is asked at the pace the tenant's quotas allow
 * (AzureCostManagement).
 */
export async function queryAzureCostRows(data: {
  costs: AzureCostReader;
  subscriptionId: string;
  body: JSONObject;
  step: string;
}): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];

  await data.costs.query({
    scope: `/subscriptions/${encodeURIComponent(data.subscriptionId)}`,
    apiVersion: AZURE_COST_MANAGEMENT_API_VERSION,
    body: data.body,
    step: data.step,
    maxPages: AZURE_COST_MAX_PAGES,
    onPage: (properties: JSONObject): void => {
      const columns: Array<string> = readArray(properties["columns"]).map(
        (column: unknown): string => {
          return readText(readObject(column)["name"]).toLowerCase();
        },
      );

      for (const rawRow of readArray(properties["rows"])) {
        const cells: Array<unknown> = Array.isArray(rawRow)
          ? (rawRow as Array<unknown>)
          : [];
        const row: Record<string, unknown> = {};

        columns.forEach((column: string, index: number): void => {
          row[column] = cells[index];
        });

        rows.push(row);
      }
    },
  });

  return rows;
}

function readAmount(row: Record<string, unknown>): number {
  const amount: number = Number(
    row["cost"] !== undefined ? row["cost"] : row["pretaxcost"],
  );
  return Number.isFinite(amount) ? amount : 0;
}

function readWord(row: Record<string, unknown>, column: string): string {
  return readText(row[column]).trim();
}

function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/*
 * The kinds' figures from the two queries' rows (pure, so a test reads it
 * without Azure): each kind's covered usage against the pay-as-you-go
 * usage of the services it covers - or is bought for - and what it cost,
 * with what of it went unused.
 */
export function summarizeAzureCommitmentRows(data: {
  usageRows: Array<Record<string, unknown>>;
  chargeRows: Array<Record<string, unknown>>;
}): { kinds: Array<CloudCommitmentKindFigures>; currency: string } {
  const currencies: Map<string, number> = new Map();

  for (const row of [...data.usageRows, ...data.chargeRows]) {
    const currency: string = readWord(row, "currency").toUpperCase();

    if (currency) {
      currencies.set(currency, (currencies.get(currency) || 0) + 1);
    }
  }

  const currency: string =
    currencies.size > 0
      ? getMostCommonCloudCurrency(currencies)
      : CLOUD_COST_DEFAULT_CURRENCY;
  const inCurrency: (row: Record<string, unknown>) => boolean = (
    row: Record<string, unknown>,
  ): boolean => {
    const rowCurrency: string = readWord(row, "currency").toUpperCase();
    return !rowCurrency || rowCurrency === currency;
  };

  const kinds: Array<CloudCommitmentKindFigures> = KIND_PRICING_MODELS.map(
    (model: (typeof KIND_PRICING_MODELS)[number]) => {
      const covered: Array<Record<string, unknown>> = data.usageRows.filter(
        (row: Record<string, unknown>): boolean => {
          return (
            inCurrency(row) &&
            sameWord(readWord(row, "pricingmodel"), model.pricingModel)
          );
        },
      );
      const services: Set<string> = new Set<string>(
        (covered.length > 0
          ? covered.map((row: Record<string, unknown>): string => {
              return readWord(row, "servicename");
            })
          : [...model.services]
        ).map((service: string): string => {
          return service.toLowerCase();
        }),
      );
      const onDemand: number = data.usageRows
        .filter((row: Record<string, unknown>): boolean => {
          return (
            inCurrency(row) &&
            sameWord(readWord(row, "pricingmodel"), ON_DEMAND_PRICING_MODEL) &&
            services.has(readWord(row, "servicename").toLowerCase())
          );
        })
        .reduce((sum: number, row: Record<string, unknown>): number => {
          return sum + readAmount(row);
        }, 0);
      const charges: Array<Record<string, unknown>> = data.chargeRows.filter(
        (row: Record<string, unknown>): boolean => {
          return (
            inCurrency(row) &&
            sameWord(readWord(row, "pricingmodel"), model.pricingModel)
          );
        },
      );
      const commitment: number = charges.reduce(
        (sum: number, row: Record<string, unknown>): number => {
          return sum + readAmount(row);
        },
        0,
      );
      const unused: number = charges
        .filter((row: Record<string, unknown>): boolean => {
          return sameWord(readWord(row, "chargetype"), model.unusedChargeType);
        })
        .reduce((sum: number, row: Record<string, unknown>): number => {
          return sum + readAmount(row);
        }, 0);

      return {
        kind: model.kind,
        coveredSpend: roundCost(
          Math.max(
            0,
            covered.reduce(
              (sum: number, row: Record<string, unknown>): number => {
                return sum + readAmount(row);
              },
              0,
            ),
          ),
        ),
        onDemandSpend: roundCost(Math.max(0, onDemand)),
        commitmentSpend: roundCost(Math.max(0, commitment)),
        unusedSpend: roundCost(Math.max(0, unused)),
      };
    },
  );

  return { kinds, currency };
}

/*
 * A subscription's reservations and savings plans: read, or why not. A
 * refused credential is thrown, as every read throws it, and so is a read
 * put off - Cost Management's limits (AzureCostThrottled), or the read's own
 * (CloudReadBudgetSpent) - for the caller to stop at and read the rest
 * first next time, while the subscription keeps the figures it had.
 */
export async function readAzureCommitments(data: {
  costs: AzureCostReader;
  subscriptionId: string;
  now: Date;
}): Promise<CloudCommitmentSummary> {
  const window: { start: Date; end: Date } = getCloudCommitmentWindow(data.now);
  const base: Omit<CloudCommitmentSummary, "state" | "kinds" | "currency"> = {
    days: CLOUD_COMMITMENT_WINDOW_DAYS,
    readAt: data.now.toISOString(),
  };

  try {
    const usageRows: Array<Record<string, unknown>> = await queryAzureCostRows({
      costs: data.costs,
      subscriptionId: data.subscriptionId,
      body: buildAzureCommitmentQuery({
        window,
        grouping: ["PricingModel", "ServiceName"],
        filter: { dimension: "ChargeType", values: ["Usage"] },
      }),
      step: "commitment coverage query",
    });
    const chargeRows: Array<Record<string, unknown>> = await queryAzureCostRows(
      {
        costs: data.costs,
        subscriptionId: data.subscriptionId,
        body: buildAzureCommitmentQuery({
          window,
          grouping: ["PricingModel", "ChargeType"],
          filter: {
            dimension: "PricingModel",
            values: KIND_PRICING_MODELS.map(
              (model: (typeof KIND_PRICING_MODELS)[number]): string => {
                return model.pricingModel;
              },
            ),
          },
        }),
        step: "commitment utilization query",
      },
    );
    const summary: {
      kinds: Array<CloudCommitmentKindFigures>;
      currency: string;
    } = summarizeAzureCommitmentRows({ usageRows, chargeRows });

    return {
      ...base,
      state: CloudCostState.Reading,
      currency: summary.currency,
      kinds: summary.kinds,
    };
  } catch (error) {
    if (
      (error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication) ||
      error instanceof AzureCostThrottled ||
      error instanceof CloudReadBudgetSpent
    ) {
      throw error;
    }

    const failure: { state: CloudCostState; message: string } =
      describeAzureCostFailure({ error, what: "costs" });

    return {
      ...base,
      state: failure.state,
      message: failure.message,
      currency: CLOUD_COST_DEFAULT_CURRENCY,
      kinds: [],
    };
  }
}
