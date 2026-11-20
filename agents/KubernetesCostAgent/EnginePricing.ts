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
 * Kubecost 2 answers the same APIs under /model on its frontend.
 *
 * KUBECOST 3 (#9851) answers neither: its frontend sends /model/ to its
 * aggregator, which has its own APIs instead (checked against Kubecost
 * 3.3.2, the ones its own UI reads):
 *
 *   - /model/pricing/status says whether its Enterprise custom pricing (a
 *     CSV price list someone uploaded) is on: a rate card.
 *   - /model/clusters/status names each cluster's provider, as /clusterInfo
 *     does ("custom" on kind and on-premises).
 *   - For "custom", the rates in force are what its node assets cost per
 *     core-hour and GiB-hour (/model/assets): the finops agent prices them
 *     at OpenCost's defaults unless someone set its customPrices, a rate card.
 *
 * And for a cloud, any Kubecost says whether it reads that cloud's bill
 * (/model/cloudCost/status, its cloud integrations): then it reconciles its
 * prices with what was paid, a day and a half after each hour (its UI's
 * reconciliationHoursDelay). The cost agent ships each hour as it closes,
 * before that, so those hours are at list prices; the pages say both.
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
 * A Kubecost cloud integration that reads that cloud's bill, as
 * /model/cloudCost/status lists them: active, for the cluster's cloud, and
 * connected (Kubecost's own words for a working one; "No Connection",
 * "Failed Connection" and "Data Missing" are not).
 */
const CONNECTED_INTEGRATION_STATUSES: ReadonlyArray<string> = [
  "connection successful",
  "synced",
  "syncing",
  "rebuilding",
  "repairing",
];

export const hasBillingIntegration: (
  integrations: unknown,
  provider: string,
) => boolean = (integrations: unknown, provider: string): boolean => {
  if (!Array.isArray(integrations) || !provider) {
    return false;
  }

  return integrations.some((integration: unknown): boolean => {
    if (!integration || typeof integration !== "object") {
      return false;
    }

    const value: Record<string, unknown> = integration as Record<
      string,
      unknown
    >;
    const status: string =
      typeof value["connectionStatus"] === "string"
        ? value["connectionStatus"].trim().toLowerCase()
        : "";

    return (
      value["active"] === true &&
      typeof value["provider"] === "string" &&
      value["provider"].trim().toLowerCase() === provider.toLowerCase() &&
      CONNECTED_INTEGRATION_STATUSES.includes(status)
    );
  });
};

/*
 * This cluster's entry of Kubecost 3's /model/clusters/status: the one with
 * this cluster's ID (the cluster its allocations name), or the only one.
 */
export const kubecostClusterStatus: (
  clusters: unknown,
  clusterId: string,
) => Record<string, unknown> | null = (
  clusters: unknown,
  clusterId: string,
): Record<string, unknown> | null => {
  if (!Array.isArray(clusters)) {
    return null;
  }

  const entries: Array<Record<string, unknown>> = clusters.filter(
    (entry: unknown): entry is Record<string, unknown> => {
      return Boolean(entry) && typeof entry === "object";
    },
  );

  const named: Record<string, unknown> | undefined = clusterId
    ? entries.find((entry: Record<string, unknown>): boolean => {
        return entry["id"] === clusterId;
      })
    : undefined;

  if (named) {
    return named;
  }

  return entries.length === 1 ? entries[0]! : null;
};

const GIB: number = 1024 * 1024 * 1024;

/*
 * The rates a Kubecost 3 priced this cluster's on-demand nodes at, per
 * core-hour and GiB-hour, from its node assets (/model/assets): what they
 * cost over what they ran. Null when no node has run long enough to say.
 */
export const kubecostNodeRates: (
  assets: unknown,
  clusterId: string,
) => { cpu: number; ram: number } | null = (
  assets: unknown,
  clusterId: string,
): { cpu: number; ram: number } | null => {
  if (!Array.isArray(assets)) {
    return null;
  }

  let cpuCost: number = 0;
  let cpuCoreHours: number = 0;
  let ramCost: number = 0;
  let ramGiBHours: number = 0;

  const numberOf: (value: unknown) => number = (value: unknown): number => {
    const parsed: number =
      typeof value === "number" ? value : parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  for (const set of assets) {
    if (!set || typeof set !== "object") {
      continue;
    }

    for (const asset of Object.values(set as Record<string, unknown>)) {
      if (!asset || typeof asset !== "object") {
        continue;
      }

      const node: Record<string, unknown> = asset as Record<string, unknown>;
      const properties: Record<string, unknown> =
        node["properties"] && typeof node["properties"] === "object"
          ? (node["properties"] as Record<string, unknown>)
          : {};

      if (
        node["type"] !== "Node" ||
        (clusterId && properties["cluster"] !== clusterId) ||
        // A spot node is priced at the spot rates: compare on-demand ones.
        numberOf(node["preemptible"]) > 0
      ) {
        continue;
      }

      cpuCost += numberOf(node["cpuCost"]);
      cpuCoreHours += numberOf(node["cpuCoreHours"]);
      ramCost += numberOf(node["ramCost"]);
      ramGiBHours += numberOf(node["ramByteHours"]) / GIB;
    }
  }

  if (cpuCoreHours <= 0 || ramGiBHours <= 0) {
    return null;
  }

  return { cpu: cpuCost / cpuCoreHours, ram: ramCost / ramGiBHours };
};

// A rate within a tenth of a percent of another: rounding, not a choice.
const nearRate: (value: number, rate: number) => boolean = (
  value: number,
  rate: number,
): boolean => {
  return Math.abs(value - rate) <= rate * 1e-3;
};

/*
 * Where a Kubecost 3's prices come from, from what its aggregator said.
 * Pure, so every case is tested without an engine.
 */
export const describeKubecost3Pricing: (data: {
  pricingStatus: unknown;
  clusters: unknown;
  integrations: unknown;
  nodeAssets: unknown;
  clusterId: string;
}) => EnginePricing = (data: {
  pricingStatus: unknown;
  clusters: unknown;
  integrations: unknown;
  nodeAssets: unknown;
  clusterId: string;
}): EnginePricing => {
  // Its Enterprise custom pricing: a price list someone uploaded.
  if (
    data.pricingStatus &&
    typeof data.pricingStatus === "object" &&
    (data.pricingStatus as Record<string, unknown>)["enabled"] === true
  ) {
    return { source: "rate-card", provider: "" };
  }

  const cluster: Record<string, unknown> | null = kubecostClusterStatus(
    data.clusters,
    data.clusterId,
  );
  const provider: string =
    cluster && typeof cluster["provider"] === "string"
      ? cluster["provider"].trim()
      : "";

  const listPriceProvider: string | undefined = LIST_PRICE_PROVIDERS.find(
    (name: string): boolean => {
      return name.toLowerCase() === provider.toLowerCase();
    },
  );

  if (listPriceProvider) {
    return {
      source: hasBillingIntegration(data.integrations, listPriceProvider)
        ? "billing-integration"
        : "list-prices",
      provider: listPriceProvider,
    };
  }

  if (provider.toLowerCase() === CSV_PROVIDER.toLowerCase()) {
    return { source: "rate-card", provider: "" };
  }

  if (provider.toLowerCase() !== CUSTOM_PROVIDER) {
    return { source: "unknown", provider: "" };
  }

  const rates: { cpu: number; ram: number } | null = kubecostNodeRates(
    data.nodeAssets,
    cluster && typeof cluster["id"] === "string"
      ? cluster["id"]
      : data.clusterId,
  );

  if (!rates) {
    return { source: "unknown", provider: "" };
  }

  return nearRate(rates.cpu, OPENCOST_DEFAULT_CPU_RATE) &&
    nearRate(rates.ram, OPENCOST_DEFAULT_RAM_RATE)
    ? { source: "default-rates", provider: "" }
    : { source: "rate-card", provider: "" };
};

/*
 * The window a Kubecost's aggregator is asked about: yesterday and today, in
 * the daily store every Kubecost 3 keeps (the hourly one may not hold the
 * last hours yet).
 */
const KUBECOST_STATUS_WINDOW: string = "2d";

/*
 * Ask the engine; never throws. OpenCost and Kubecost 2: /clusterInfo, then,
 * for a cluster no cloud's list prices cover, /allNodePricing; and for a
 * Kubecost on a cloud, whether it reads that cloud's bill. Kubecost 3, which
 * answers no /clusterInfo: its aggregator's APIs. `clusterId` is the cluster
 * the engine's allocations name, for a Kubecost that answers for several.
 */
export const readEnginePricing: (data: {
  client: CostEngineClient;
  rateCardHint?: string | undefined;
  clusterId?: string | undefined;
}) => Promise<EnginePricing> = async (data: {
  client: CostEngineClient;
  rateCardHint?: string | undefined;
  clusterId?: string | undefined;
}): Promise<EnginePricing> => {
  const isKubecost: boolean = data.client.engineKind() === "Kubecost";
  const clusterInfo: unknown = await data.client.fetchApiData("clusterInfo");

  if (!clusterInfo && isKubecost) {
    const [pricingStatus, clusters, integrations, nodeAssets] =
      await Promise.all([
        data.client.fetchApiData("pricing/status"),
        data.client.fetchApiData("clusters/status", {
          window: KUBECOST_STATUS_WINDOW,
        }),
        data.client.fetchApiData("cloudCost/status"),
        data.client.fetchApiData("assets", {
          window: KUBECOST_STATUS_WINDOW,
          accumulate: "true",
          filter: 'assetType:"node"',
        }),
      ]);

    return describeKubecost3Pricing({
      pricingStatus,
      clusters,
      integrations,
      nodeAssets,
      clusterId: data.clusterId || "",
    });
  }

  const nodePricing: unknown =
    providerOf(clusterInfo).toLowerCase() === CUSTOM_PROVIDER
      ? await data.client.fetchApiData("allNodePricing")
      : undefined;

  const pricing: EnginePricing = describeEnginePricing({
    clusterInfo,
    nodePricing,
    rateCardHint: data.rateCardHint,
  });

  // A Kubecost 2 that reads its cloud's bill.
  if (isKubecost && pricing.source === "list-prices") {
    const integrations: unknown =
      await data.client.fetchApiData("cloudCost/status");

    if (hasBillingIntegration(integrations, pricing.provider)) {
      return { source: "billing-integration", provider: pricing.provider };
    }
  }

  return pricing;
};
