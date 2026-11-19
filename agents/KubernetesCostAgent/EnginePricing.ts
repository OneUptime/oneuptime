import { CostEngineClient } from "./CostEngineClient";
import { KubernetesCostPricingSource } from "./Types";

/*
 * WHERE A CLUSTER'S PRICES COME FROM (#9634).
 *
 * Cost monitoring is on by default, on every cluster: on AWS, Azure and
 * Google Cloud, OpenCost prices the nodes at the cloud's public list prices;
 * on-premises, on bare metal, on kind or k3s, at its built-in default rates,
 * which can be far from what the hardware costs; and anywhere, a rate card
 * someone set. The Costs page and the overview say which, so this asks the
 * engine itself:
 *
 *   - /clusterInfo names the provider the engine detected from the nodes
 *     ("AWS", "GCP", "Azure", ... or "custom" when it recognised none). A
 *     cloud provider means its list prices: OpenCost keeps a known instance
 *     type at the cloud's price even with a rate card, which only prices
 *     what the list lacks.
 *   - For "custom", /allNodePricing gives the rates in force. OpenCost's
 *     built-in defaults (configs/default.json, GCP us-central1's prices)
 *     mean nobody set any; anything else is a rate card. "CSV" is a price
 *     list someone supplied: a rate card.
 *
 * Kubecost answers the same APIs under /model on its frontend.
 *
 * When the engine cannot say (an older engine, a frontend that does not pass
 * the API on), the chart's hint about its own bundled engine decides, and
 * otherwise the source is unknown, which the pages leave unsaid.
 */

export interface EnginePricing {
  source: KubernetesCostPricingSource;
  // The cloud whose list prices apply, as the engine names it ("AWS").
  provider: string;
}

/*
 * The clouds OpenCost prices at public list prices, by the names its
 * /clusterInfo gives them (opencost core/pkg/opencost/assetprops.go).
 */
export const LIST_PRICE_PROVIDERS: ReadonlyArray<string> = [
  "AWS",
  "GCP",
  "Azure",
  "Alibaba",
  "Scaleway",
  "Oracle",
  "OTC",
  "DigitalOcean",
  "OVH",
  "STACKIT",
  "IBM",
];

const CUSTOM_PROVIDER: string = "custom";
const CSV_PROVIDER: string = "CSV";

/*
 * OpenCost's built-in rates per core-hour and GiB-hour (configs/default.json,
 * the same figures the chart's cost.opencost.customPricing starts from).
 */
export const OPENCOST_DEFAULT_CPU_RATE: number = 0.031611;
export const OPENCOST_DEFAULT_RAM_RATE: number = 0.004237;

const sameRate: (value: unknown, rate: number) => boolean = (
  value: unknown,
  rate: number,
): boolean => {
  const parsed: number =
    typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && Math.abs(parsed - rate) < 1e-9;
};

/*
 * Whether the rates /allNodePricing gave are OpenCost's own defaults: true
 * for the defaults, false for anything else, null when the answer has no
 * "default" rates to compare.
 */
export const isOpenCostDefaultRates: (
  nodePricing: unknown,
) => boolean | null = (nodePricing: unknown): boolean | null => {
  if (!nodePricing || typeof nodePricing !== "object") {
    return null;
  }

  const rates: unknown = (nodePricing as Record<string, unknown>)["default"];

  if (!rates || typeof rates !== "object") {
    return null;
  }

  const cpu: unknown = (rates as Record<string, unknown>)["CPU"];
  const ram: unknown = (rates as Record<string, unknown>)["RAM"];

  if (cpu === undefined && ram === undefined) {
    return null;
  }

  return (
    sameRate(cpu, OPENCOST_DEFAULT_CPU_RATE) &&
    sameRate(ram, OPENCOST_DEFAULT_RAM_RATE)
  );
};

const providerOf: (clusterInfo: unknown) => string = (
  clusterInfo: unknown,
): string => {
  if (!clusterInfo || typeof clusterInfo !== "object") {
    return "";
  }

  const provider: unknown = (clusterInfo as Record<string, unknown>)[
    "provider"
  ];

  return typeof provider === "string" ? provider.trim() : "";
};

/*
 * The pricing from what the engine said. Pure, so every case is tested
 * without an engine. `rateCardHint` is the chart's word about its own
 * bundled engine ("true", "false", or "" for another engine).
 */
export const describeEnginePricing: (data: {
  clusterInfo: unknown;
  nodePricing?: unknown;
  rateCardHint?: string | undefined;
}) => EnginePricing = (data: {
  clusterInfo: unknown;
  nodePricing?: unknown;
  rateCardHint?: string | undefined;
}): EnginePricing => {
  const provider: string = providerOf(data.clusterInfo);

  const listPriceProvider: string | undefined = LIST_PRICE_PROVIDERS.find(
    (name: string): boolean => {
      return name.toLowerCase() === provider.toLowerCase();
    },
  );

  if (listPriceProvider) {
    return { source: "list-prices", provider: listPriceProvider };
  }

  if (provider.toLowerCase() === CSV_PROVIDER.toLowerCase()) {
    return { source: "rate-card", provider: "" };
  }

  const hint: string = (data.rateCardHint || "").trim().toLowerCase();

  if (provider.toLowerCase() === CUSTOM_PROVIDER) {
    const defaults: boolean | null = isOpenCostDefaultRates(data.nodePricing);

    if (defaults === true) {
      return { source: "default-rates", provider: "" };
    }

    if (defaults === false) {
      return { source: "rate-card", provider: "" };
    }
  }

  /*
   * The engine did not say (or said "custom" with no rates to read): the
   * chart knows whether it gave its own bundled engine a rate card.
   */
  if (hint === "true") {
    return { source: "rate-card", provider: "" };
  }

  if (
    hint === "false" &&
    (provider === "" || provider.toLowerCase() === CUSTOM_PROVIDER)
  ) {
    return { source: "default-rates", provider: "" };
  }

  return { source: "unknown", provider: "" };
};

/*
 * Ask the engine. Two small reads, the second only for a cluster no cloud's
 * list prices cover; never throws.
 */
export const readEnginePricing: (data: {
  client: CostEngineClient;
  rateCardHint?: string | undefined;
}) => Promise<EnginePricing> = async (data: {
  client: CostEngineClient;
  rateCardHint?: string | undefined;
}): Promise<EnginePricing> => {
  const clusterInfo: unknown = await data.client.fetchApiData("clusterInfo");

  const nodePricing: unknown =
    providerOf(clusterInfo).toLowerCase() === CUSTOM_PROVIDER
      ? await data.client.fetchApiData("allNodePricing")
      : undefined;

  return describeEnginePricing({
    clusterInfo,
    nodePricing,
    rateCardHint: data.rateCardHint,
  });
};
