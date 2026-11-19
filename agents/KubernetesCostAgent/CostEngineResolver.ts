import { floorToWindow } from "./AllocationMapper";
import {
  COST_ENGINE_FAILURES_BEFORE_REDISCOVERY,
  COST_ENGINE_RATE_CARD,
  COST_ENGINE_REDISCOVERY_SECONDS,
  COST_ENGINE_URL,
  COST_PREFER_EXISTING_ENGINE,
  IS_COST_ENGINE_AUTO,
  WINDOW_SECONDS,
} from "./Config";
import { CostEngineClient } from "./CostEngineClient";
import {
  EngineCandidate,
  EngineKind,
  discoverEngineCandidates,
  engineKindOfService,
  serviceOfUrl,
} from "./EngineDiscovery";
import { MetricsEngine } from "./EngineMetrics";
import { EnginePricing, readEnginePricing } from "./EnginePricing";
import { KubernetesService, ListServices, listServices } from "./KubernetesApi";
import Logger from "./Logger";
import {
  CostEngineSource,
  EngineAllocation,
  KubernetesCostEngineInfo,
} from "./Types";

/*
 * WHICH COST ENGINE THE AGENT READS (#9633).
 *
 *   configured - cost.engine.url names an engine: read it, look for nothing
 *                else. The Service it names, if it names one, is read once
 *                to say which engine it is.
 *   bundled    - the chart bundled OpenCost (cost.engine.url empty, the
 *                default) and the cluster may already run an engine of its
 *                own: read that one when it answers, so the cluster is priced
 *                as its owner set it up, and the bundled one otherwise. The
 *                pages then say the bundled one is not needed, and how to
 *                stop running it (cost.engine.url=auto).
 *   auto       - cost.engine.url is auto and nothing was bundled: find the
 *                cluster's own engine, and keep looking until there is one.
 *
 * An engine is looked for when the agent starts, then hourly, so one
 * installed later is found; and again soon after the engine in use fails
 * a few ticks in a row, so one that was uninstalled or moved is replaced.
 * A found engine is used only once it answers the Allocation API for the
 * last closed window, and never one that answers for several clusters (a
 * Kubecost that federates others would price them all under this one).
 */

export type CostEngineMode = "configured" | "bundled" | "auto";

type EngineOrigin = "configured" | "bundled" | "discovered";

interface SelectedEngine {
  client: CostEngineClient;
  origin: EngineOrigin;
  // The Service it was found as, when it was found.
  candidate: EngineCandidate | null;
  pricing: EnginePricing | null;
  pricingReadAtMs: number;
}

type Discovery =
  | { status: "found"; engine: SelectedEngine }
  | { status: "none"; reasons: Array<string> }
  | { status: "error"; error: string };

// How often the prices are asked about again while one engine is in use.
const PRICING_REFRESH_MS: number = 60 * 60 * 1000;

export interface CostEngineResolverOptions {
  mode: CostEngineMode;
  // The configured or bundled engine's URL; unused in auto mode.
  engineUrl: string;
  // The chart's word about its bundled engine's rate card ("true"/"false").
  rateCardHint: string;
  listServices: ListServices;
  rediscoveryMs: number;
  failuresBeforeRediscovery: number;
  windowSeconds: number;
  now?: (() => number) | undefined;
  createClient?: ((url: string) => CostEngineClient) | undefined;
}

export class CostEngineResolver implements CostEngineSource {
  private readonly options: CostEngineResolverOptions;
  private selected: SelectedEngine | null = null;
  private lastDiscoveryAtMs: number = 0;
  private consecutiveFailures: number = 0;
  private lastNoneReasons: Array<string> = [];
  // Which engine cost.engine.url's Service belongs to, once read.
  private configuredKind: EngineKind | null = null;
  private configuredKindRead: boolean = false;

  public constructor(options: CostEngineResolverOptions) {
    this.options = options;
  }

  // The resolver the agent runs with, from its environment.
  public static fromConfig(): CostEngineResolver {
    return new CostEngineResolver({
      mode: IS_COST_ENGINE_AUTO
        ? "auto"
        : COST_PREFER_EXISTING_ENGINE
          ? "bundled"
          : "configured",
      engineUrl: IS_COST_ENGINE_AUTO ? "" : COST_ENGINE_URL,
      rateCardHint: COST_ENGINE_RATE_CARD,
      listServices: listServices,
      rediscoveryMs: COST_ENGINE_REDISCOVERY_SECONDS * 1000,
      failuresBeforeRediscovery: COST_ENGINE_FAILURES_BEFORE_REDISCOVERY,
      windowSeconds: WINDOW_SECONDS,
    });
  }

  public mode(): CostEngineMode {
    return this.options.mode;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private createClient(url: string): CostEngineClient {
    return this.options.createClient
      ? this.options.createClient(url)
      : new CostEngineClient({ baseUrl: url });
  }

  private ownEngine(origin: "configured" | "bundled"): SelectedEngine {
    return {
      client: this.createClient(this.options.engineUrl),
      origin: origin,
      candidate: null,
      pricing: null,
      pricingReadAtMs: 0,
    };
  }

  /*
   * Whether a found engine answers for this cluster: the Allocation API for
   * the last closed window, naming at most one cluster. The reason it is
   * passed over otherwise.
   */
  private async verify(
    candidate: EngineCandidate,
  ): Promise<{ client: CostEngineClient } | { reason: string }> {
    const client: CostEngineClient = this.createClient(candidate.url);
    const windowMs: number = this.options.windowSeconds * 1000;
    const windowEnd: number = floorToWindow(
      this.now(),
      this.options.windowSeconds,
    );

    try {
      const allocations: Array<EngineAllocation> =
        await client.fetchAllocations({
          windowStart: new Date(windowEnd - windowMs),
          windowEnd: new Date(windowEnd),
        });

      const clusters: Set<string> = new Set<string>();

      for (const allocation of allocations) {
        const cluster: string = (allocation.properties?.cluster || "").trim();
        if (cluster) {
          clusters.add(cluster);
        }
      }

      if (clusters.size > 1) {
        return {
          reason: `${candidate.kind} at ${candidate.namespace}/${candidate.name} reports ${clusters.size} clusters, so it is a primary that federates others; set cost.engine.url to read it on purpose`,
        };
      }

      return { client };
    } catch (err: unknown) {
      return {
        reason: `${candidate.kind} at ${candidate.namespace}/${candidate.name} did not answer: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async discover(): Promise<Discovery> {
    let candidates: Array<EngineCandidate>;

    try {
      candidates = await discoverEngineCandidates({
        listServices: this.options.listServices,
        excludeUrls:
          this.options.mode === "bundled" ? [this.options.engineUrl] : [],
      });
    } catch (err: unknown) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const reasons: Array<string> = [];

    for (const candidate of candidates) {
      const verified: { client: CostEngineClient } | { reason: string } =
        await this.verify(candidate);

      if ("client" in verified) {
        return {
          status: "found",
          engine: {
            client: verified.client,
            origin: "discovered",
            candidate: candidate,
            pricing: null,
            pricingReadAtMs: 0,
          },
        };
      }

      reasons.push(verified.reason);
      Logger.warn("passed over a cost engine the cluster runs", {
        reason: verified.reason,
      });
    }

    return { status: "none", reasons };
  }

  private isDiscoveryDue(): boolean {
    if (this.options.mode === "configured") {
      return false;
    }

    // Nothing found yet in auto mode: every tick looks again.
    if (!this.selected) {
      return true;
    }

    return this.now() - this.lastDiscoveryAtMs >= this.options.rediscoveryMs;
  }

  private sameEngine(a: SelectedEngine | null, b: SelectedEngine): boolean {
    if (!a) {
      return false;
    }

    return a.origin === b.origin && a.client.baseUrl === b.client.baseUrl;
  }

  /*
   * Which engine cost.engine.url names, by its Service's labels, when the
   * URL names an in-cluster Service. The path the Allocation API answered on
   * only says whether the URL serves the API under /model, which OpenCost's
   * UI does as well as Kubecost's frontend, and which Kubecost's cost model
   * does not: read alone, it called Kubecost's cost model OpenCost and
   * OpenCost's UI Kubecost. One read of that one Service, nothing looked for
   * beyond it; a read that fails is tried again at the next window, and the
   * path decides meanwhile.
   */
  private async readConfiguredKind(): Promise<void> {
    if (this.configuredKindRead) {
      return;
    }

    const named: { name: string; namespace: string } | null = serviceOfUrl(
      this.options.engineUrl,
    );

    if (!named) {
      this.configuredKindRead = true;
      return;
    }

    try {
      const services: Array<KubernetesService> =
        await this.options.listServices({
          fieldSelector: `metadata.name=${named.name},metadata.namespace=${named.namespace}`,
        });

      const service: KubernetesService | undefined = services.find(
        (candidate: KubernetesService): boolean => {
          return (
            candidate.metadata?.name === named.name &&
            candidate.metadata?.namespace === named.namespace
          );
        },
      );

      this.configuredKind = service ? engineKindOfService(service) : null;
      this.configuredKindRead = true;
    } catch (err: unknown) {
      Logger.debug("could not read which engine cost.engine.url names", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The engine to read the next window from, looking for one when it is time.
  private async resolve(): Promise<SelectedEngine> {
    if (this.options.mode === "configured") {
      if (!this.selected) {
        this.selected = this.ownEngine("configured");
      }
      await this.readConfiguredKind();
      return this.selected;
    }

    if (this.isDiscoveryDue()) {
      this.lastDiscoveryAtMs = this.now();

      const discovery: Discovery = await this.discover();
      let next: SelectedEngine | null = this.selected;

      if (discovery.status === "found") {
        next = discovery.engine;
      } else if (discovery.status === "none") {
        this.lastNoneReasons = discovery.reasons;
        next =
          this.options.mode === "bundled" ? this.ownEngine("bundled") : null;
      } else {
        /*
         * The Kubernetes API did not answer: keep what is in use rather than
         * drop an engine that works, and in bundled mode start on the
         * bundled one.
         */
        Logger.warn("could not look for the cluster's own cost engine", {
          error: discovery.error,
        });
        this.lastNoneReasons = [discovery.error];

        if (!next && this.options.mode === "bundled") {
          next = this.ownEngine("bundled");
        }
      }

      if (next && !this.sameEngine(this.selected, next)) {
        Logger.info("reading cost from this engine", {
          origin: next.origin,
          engine: next.candidate?.kind || "",
          service: next.candidate
            ? `${next.candidate.namespace}/${next.candidate.name}`
            : "",
          costEngineUrl: next.client.baseUrl,
          bundledEngineUnused:
            this.options.mode === "bundled" && next.origin === "discovered",
        });
        this.selected = next;
        this.consecutiveFailures = 0;
      } else if (!next) {
        this.selected = null;
      }
    }

    if (!this.selected) {
      throw new Error(
        `No OpenCost or Kubecost answers in this cluster, and cost.engine.url is auto, so nothing was bundled. Install one, set cost.engine.url to an engine's URL, or leave cost.engine.url empty to bundle OpenCost.${
          this.lastNoneReasons.length > 0
            ? ` (${this.lastNoneReasons.join("; ")})`
            : ""
        }`,
      );
    }

    return this.selected;
  }

  /*
   * Ask the engine where its prices come from, when they are not known yet
   * or an hour has passed. Best effort: the window's rows ship either way.
   */
  private async refreshPricing(engine: SelectedEngine): Promise<void> {
    if (
      engine.pricing &&
      this.now() - engine.pricingReadAtMs < PRICING_REFRESH_MS
    ) {
      return;
    }

    try {
      engine.pricing = await readEnginePricing({
        client: engine.client,
        rateCardHint:
          engine.origin === "bundled" ? this.options.rateCardHint : "",
      });
      engine.pricingReadAtMs = this.now();
    } catch (err: unknown) {
      Logger.debug("could not read where the cost engine's prices come from", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public async fetchAllocations(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<EngineAllocation>> {
    const engine: SelectedEngine = await this.resolve();

    try {
      const allocations: Array<EngineAllocation> =
        await engine.client.fetchAllocations(data);

      this.consecutiveFailures = 0;
      await this.refreshPricing(engine);

      return allocations;
    } catch (err: unknown) {
      this.consecutiveFailures++;

      /*
       * An engine that keeps failing is looked for again on the next tick:
       * a found one may have gone (back to the bundled one, or to none), and
       * one may have appeared beside a bundled one that broke.
       */
      if (
        this.options.mode !== "configured" &&
        this.consecutiveFailures >= this.options.failuresBeforeRediscovery
      ) {
        this.lastDiscoveryAtMs = 0;

        if (engine.origin === "discovered") {
          this.selected =
            this.options.mode === "bundled" ? this.ownEngine("bundled") : null;
        }
      }

      throw err;
    }
  }

  // What the next shipment says priced its rows; undefined before any engine.
  public engineUrl(): string | undefined {
    return this.selected?.client.baseUrl;
  }

  /*
   * The engine whose price metrics the collector should scrape (#9776): the
   * one the allocations are read from, so the Cost dashboard and the Costs
   * pages are priced alike. The engine cost.engine.url names from the start;
   * otherwise the one in use, the bundled one before the first look, and in
   * auto mode none until one is found. Its namespace, when it is an
   * in-cluster Service, is where a Kubecost 3 finops agent would be.
   */
  public metricsEngine(): MetricsEngine | null {
    if (this.options.mode === "configured") {
      return this.metricsEngineAt(this.options.engineUrl, null);
    }

    if (this.selected) {
      return this.metricsEngineAt(
        this.selected.client.baseUrl,
        this.selected.candidate,
      );
    }

    return this.options.mode === "bundled"
      ? this.metricsEngineAt(this.options.engineUrl, null)
      : null;
  }

  private metricsEngineAt(
    url: string,
    candidate: EngineCandidate | null,
  ): MetricsEngine | null {
    const trimmed: string = url.trim().replace(/\/+$/, "");

    if (!trimmed) {
      return null;
    }

    return {
      url: trimmed,
      namespace:
        candidate?.namespace || serviceOfUrl(trimmed)?.namespace || null,
    };
  }

  public describe(): KubernetesCostEngineInfo | undefined {
    const engine: SelectedEngine | null = this.selected;

    if (!engine) {
      return undefined;
    }

    const kind: EngineKind | null =
      engine.candidate?.kind ||
      (engine.origin === "configured" ? this.configuredKind : null) ||
      engine.client.engineKind();

    return {
      engine: kind || "",
      service: engine.candidate
        ? `${engine.candidate.namespace}/${engine.candidate.name}`
        : "",
      bundledEngineUnused:
        this.options.mode === "bundled" && engine.origin === "discovered",
      pricingSource: engine.pricing?.source || "unknown",
      pricingProvider: engine.pricing?.provider || "",
    };
  }
}
