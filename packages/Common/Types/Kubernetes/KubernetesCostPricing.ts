/*
 * WHICH ENGINE PRICED A CLUSTER'S COSTS, AND WHERE ITS PRICES COME FROM
 * (#9633, #9634).
 *
 * Cost monitoring is on by default on every cluster. On AWS, Azure and
 * Google Cloud OpenCost prices the nodes at the cloud's public list prices;
 * on-premises, on bare metal, on kind or k3s, at its built-in default rates,
 * which can be far from what the hardware costs; and anywhere, at a rate
 * card someone set. The Costs page and the overview's Cost card say which,
 * and, when the cluster already ran an engine of its own, that the agent
 * read it and the bundled one is not needed.
 *
 * The cost agent asks its engine (agents/KubernetesCostAgent/EnginePricing,
 * CostEngineResolver) and says so with every shipment; ingest stamps it on
 * each row it stores (KubernetesCostAllocation), so every hour says how it
 * was priced, and the pages read the newest row's. The agent is mirrored in
 * KubernetesCostAgent/Types.ts - keep the two in sync.
 */

export enum KubernetesCostPricingSource {
  // A cloud's public list prices (AWS, Google Cloud, Azure, ...).
  ListPrices = "list-prices",
  /*
   * The same list prices, priced by a Kubecost that reads the cloud's bill
   * (#9851): it reconciles them with what was paid about two days after
   * each hour, after the cost agent shipped it, and the agent reads the hour
   * again then (#9969, KubernetesCostCorrection): the change arrives as rows
   * of its own (KubernetesCostAllocation.isCostAdjustment).
   */
  BillingIntegration = "billing-integration",
  // Rates someone set: a rate card, or a CSV price list.
  RateCard = "rate-card",
  // The engine's built-in defaults: no cloud recognised, no rates set.
  DefaultRates = "default-rates",
  // The engine could not say.
  Unknown = "unknown",
}

export const KUBERNETES_COST_PRICING_SOURCES: ReadonlyArray<KubernetesCostPricingSource> =
  [
    KubernetesCostPricingSource.ListPrices,
    KubernetesCostPricingSource.BillingIntegration,
    KubernetesCostPricingSource.RateCard,
    KubernetesCostPricingSource.DefaultRates,
    KubernetesCostPricingSource.Unknown,
  ];

// The sources that name the cloud whose list prices apply.
export const KUBERNETES_COST_PRICING_SOURCES_WITH_PROVIDER: ReadonlyArray<KubernetesCostPricingSource> =
  [
    KubernetesCostPricingSource.ListPrices,
    KubernetesCostPricingSource.BillingIntegration,
  ];

/*
 * Where the memory peaks right-sizing sizes memory requests from come from
 * (#9970), as the cost agent says it with each shipment. The note that
 * advises stopping the bundled engine reads it: with "bundled", stopping it
 * stops the Prometheus the peaks come from too (Kubecost 3 reads none).
 */
export enum KubernetesCostMemoryPeaksSource {
  // The Prometheus the cluster's own engine reads.
  Engine = "engine",
  // The Prometheus the chart bundled beside its OpenCost.
  Bundled = "bundled",
  // The Prometheus cost.engine.prometheusUrl names.
  Configured = "configured",
  // None: no Prometheus to read, or an agent older than #9970.
  None = "",
}

export const KUBERNETES_COST_MEMORY_PEAKS_SOURCES: ReadonlyArray<KubernetesCostMemoryPeaksSource> =
  [
    KubernetesCostMemoryPeaksSource.Engine,
    KubernetesCostMemoryPeaksSource.Bundled,
    KubernetesCostMemoryPeaksSource.Configured,
    KubernetesCostMemoryPeaksSource.None,
  ];

export type KubernetesCostEngineName = "OpenCost" | "Kubecost";

export const KUBERNETES_COST_ENGINE_NAMES: ReadonlyArray<KubernetesCostEngineName> =
  ["OpenCost", "Kubecost"];

// What a shipment says about the engine that priced its rows.
export interface KubernetesCostEngineInfo {
  // "OpenCost" or "Kubecost"; empty when the agent cannot tell.
  engine: KubernetesCostEngineName | "";
  /*
   * The cluster's own engine the agent found and read, as
   * "<namespace>/<service>"; empty for the bundled engine or one named in
   * cost.engine.url.
   */
  service: string;
  /*
   * The chart bundled an engine the agent did not read, because it found
   * the cluster's own: a second engine the cluster need not run.
   */
  bundledEngineUnused: boolean;
  pricingSource: KubernetesCostPricingSource;
  /*
   * The cloud whose list prices apply, as the engine names it ("AWS"), with
   * list-prices and billing-integration; empty otherwise.
   */
  pricingProvider: string;
  // Where the memory peaks come from (#9970); None from an older agent.
  memoryPeaksFrom: KubernetesCostMemoryPeaksSource;
}

// A namespace and a Service's name, as Kubernetes allows each.
const SERVICE_REFERENCE: RegExp =
  /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\/[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

// A provider's name as OpenCost writes one: a word, never markup.
const PROVIDER_NAME: RegExp = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/;

/*
 * What a payload says about its engine, keeping only what can be what the
 * agent sends: anything else is dropped, never stored or shown. Null when
 * the payload says nothing (an agent older than #9633).
 */
export function readKubernetesCostEngineInfo(
  value: unknown,
): KubernetesCostEngineInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  const engine: string = typeof raw["engine"] === "string" ? raw["engine"] : "";
  const service: string =
    typeof raw["service"] === "string" ? raw["service"].trim() : "";
  const source: string =
    typeof raw["pricingSource"] === "string" ? raw["pricingSource"] : "";
  const provider: string =
    typeof raw["pricingProvider"] === "string"
      ? raw["pricingProvider"].trim()
      : "";

  const pricingSource: KubernetesCostPricingSource =
    KUBERNETES_COST_PRICING_SOURCES.find(
      (candidate: KubernetesCostPricingSource): boolean => {
        return candidate === source;
      },
    ) || KubernetesCostPricingSource.Unknown;

  const peaks: string =
    typeof raw["memoryPeaksFrom"] === "string" ? raw["memoryPeaksFrom"] : "";

  const memoryPeaksFrom: KubernetesCostMemoryPeaksSource =
    KUBERNETES_COST_MEMORY_PEAKS_SOURCES.find(
      (candidate: KubernetesCostMemoryPeaksSource): boolean => {
        return candidate === peaks;
      },
    ) || KubernetesCostMemoryPeaksSource.None;

  return {
    engine: KUBERNETES_COST_ENGINE_NAMES.includes(
      engine as KubernetesCostEngineName,
    )
      ? (engine as KubernetesCostEngineName)
      : "",
    service: SERVICE_REFERENCE.test(service) ? service : "",
    bundledEngineUnused: raw["bundledEngineUnused"] === true,
    pricingSource: pricingSource,
    pricingProvider:
      KUBERNETES_COST_PRICING_SOURCES_WITH_PROVIDER.includes(pricingSource) &&
      PROVIDER_NAME.test(provider)
        ? provider
        : "",
    memoryPeaksFrom: memoryPeaksFrom,
  };
}

/*
 * A cloud's name as people say it, from the name OpenCost gives it
 * (opencost core/pkg/opencost/assetprops.go). A name it does not list reads
 * as the engine wrote it.
 */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  AWS: "AWS",
  GCP: "Google Cloud",
  Azure: "Azure",
  Alibaba: "Alibaba Cloud",
  Scaleway: "Scaleway",
  Oracle: "Oracle Cloud",
  OTC: "Open Telekom Cloud",
  DigitalOcean: "DigitalOcean",
  OVH: "OVHcloud",
  STACKIT: "STACKIT",
  IBM: "IBM Cloud",
};

export function getKubernetesCostProviderDisplayName(provider: string): string {
  const trimmed: string = provider.trim();
  const known: string | undefined = Object.keys(PROVIDER_DISPLAY_NAMES).find(
    (name: string): boolean => {
      return name.toLowerCase() === trimmed.toLowerCase();
    },
  );

  return known ? PROVIDER_DISPLAY_NAMES[known]! : trimmed;
}
