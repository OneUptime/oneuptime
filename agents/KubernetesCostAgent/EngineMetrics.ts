import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { KubernetesService, ListServices } from "./KubernetesApi";
import Logger from "./Logger";
import { EngineMetricsSource, ScrapeTargetGroup } from "./Types";

/*
 * WHERE THE COST ENGINE SERVES ITS PRICE METRICS (#9776).
 *
 * Besides the allocations this agent ships, the collector scrapes the
 * engine's prices (node_total_hourly_cost, pv_hourly_cost, ...) for the
 * Kubernetes Cost dashboard and Metric Explorer. Where an engine serves them
 * depends on which engine it is and which of its Services a URL names, and
 * for some only a different Service has them. Checked against Kubecost
 * 2.8.7, Kubecost 3.3.2 and OpenCost 1.121.4, each from its own chart:
 *
 *   - OpenCost's API (9003) and Kubecost 2's cost model (tcp-model, 9003):
 *     /metrics.
 *   - Kubecost 2's frontend (tcp-frontend, 9090) and OpenCost's UI (9090):
 *     /metrics is the web UI's page (HTTP 200, text/html), which the
 *     collector cannot parse; /model/metrics is the engine behind it.
 *   - Kubecost 3's frontend: /metrics is the web UI too, and /model/ leads
 *     to the aggregator, whose /metrics is 404 while it starts and then its
 *     own Go runtime series, with no price among them. The prices are on its
 *     finops agent's Service (<release>-finopsagent, port http), at
 *     /metrics. So an address only counts when a price series is in it:
 *     answering in Prometheus' format is not enough.
 *
 * The chart cannot tell these apart while it renders (Helm's lookup sees
 * nothing under helm template, Argo CD or a dry run), and the collector's
 * relabeling cannot weigh one Service against another. The agent already
 * knows which engine it reads, so it finds where that engine's prices are and
 * tells the collector, which asks it through http_sd (Health.ts,
 * /scrape-targets): the engine's /metrics, then its /model/metrics, then a
 * finops agent in the engine's namespace, the first that answers with price
 * series. A web page or a 404 is never taken.
 */

// The engine whose price metrics are wanted.
export interface MetricsEngine {
  // Its base URL: what its Allocation API is read under.
  url: string;
  // Its namespace, when it is an in-cluster Service.
  namespace: string | null;
}

export interface MetricsProbe {
  ok: boolean;
  // Why the address is not the one, for the log and /healthz.
  reason: string;
}

export type ProbeMetricsEndpoint = (url: string) => Promise<MetricsProbe>;

export interface FoundMetricsEndpoint {
  // Where the price metrics are, or null when no address had them.
  url: string | null;
  // Why each address tried was not the one.
  reasons: Array<string>;
}

/*
 * A sample of one of the engine's price series, at the start of a line: the
 * series the chart's cost.metrics.metricsAllowlist forwards. HELP and TYPE
 * lines do not count (an engine can declare a family it has no value for
 * yet), and neither does an HTML page or a 404 that mentions one.
 */
export const PRICE_SERIES_LINE: RegExp =
  /^(?:node_(?:cpu|gpu|ram|total)_hourly_cost|pv_hourly_cost|kubecost_cluster_management_cost|kubecost_load_balancer_cost|kubecost_network_(?:zone|region|internet)_egress_cost)[{ ]/m;

export const hasPriceSeries: (text: string) => boolean = (
  text: string,
): boolean => {
  return PRICE_SERIES_LINE.test(text);
};

/*
 * The Services of a Kubecost 3 finops agent, which carries the engine's price
 * series in Kubecost 3: its chart labels its Service part of finops-agent,
 * whatever the subchart's alias makes its name.
 */
export const FINOPS_AGENT_SELECTOR: string =
  "app.kubernetes.io/part-of=finops-agent";

const FINOPS_AGENT_PORT_NAME: string = "http";

// A DNS label, as Kubernetes allows a Service's name.
const SERVICE_NAME_PATTERN: RegExp = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

// How much of an answer is read looking for a price series.
const MAX_PROBE_BYTES: number = 64 * 1024 * 1024;

// A metrics endpoint answers in seconds; this only bounds one that hangs.
const PROBE_TIMEOUT_MS: number = 30000;

/*
 * Only the start of a line matters (the series' name), so a partial line
 * carried over from one chunk to the next is cut to this much.
 */
const MAX_CARRIED_LINE: number = 512;

// How often a missing endpoint is looked for again.
export const METRICS_RETRY_MS: number = 60 * 1000;

// How often a found endpoint is checked again (an engine upgraded since).
export const METRICS_REFRESH_MS: number = 60 * 60 * 1000;

/*
 * Where the engine itself may serve its prices: <url>/metrics, then
 * <url>/model/metrics, the path Kubecost 2's frontend and OpenCost's UI
 * proxy to the engine behind them. A URL that already ends in /metrics is
 * read as the engine's own base URL followed by it.
 */
export const engineMetricsCandidates: (engineUrl: string) => Array<string> = (
  engineUrl: string,
): Array<string> => {
  const base: string = engineUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/metrics$/, "");

  return [`${base}/metrics`, `${base}/model/metrics`];
};

/*
 * The /metrics of each finops agent Service in the namespace, in name order:
 * the port named http (the finops agent chart's), else the first port.
 */
export const finopsAgentMetricsUrls: (
  services: Array<KubernetesService>,
  namespace: string,
) => Array<string> = (
  services: Array<KubernetesService>,
  namespace: string,
): Array<string> => {
  const urls: Array<string> = [];

  const sorted: Array<KubernetesService> = [...services].sort(
    (a: KubernetesService, b: KubernetesService): number => {
      const left: string = a.metadata?.name || "";
      const right: string = b.metadata?.name || "";
      return left < right ? -1 : left > right ? 1 : 0;
    },
  );

  for (const service of sorted) {
    const name: string = (service.metadata?.name || "").trim();

    if (
      (service.metadata?.namespace || "").trim() !== namespace ||
      !SERVICE_NAME_PATTERN.test(name)
    ) {
      continue;
    }

    const ports: Array<{ name?: string; port?: number }> = (
      Array.isArray(service.spec?.ports) ? service.spec!.ports! : []
    ).filter((port: { name?: string; port?: number }): boolean => {
      return (
        typeof port.port === "number" &&
        Number.isInteger(port.port) &&
        port.port > 0 &&
        port.port < 65536
      );
    });

    const port: { name?: string; port?: number } | undefined =
      ports.find((candidate: { name?: string; port?: number }): boolean => {
        return (candidate.name || "").toLowerCase() === FINOPS_AGENT_PORT_NAME;
      }) || ports[0];

    if (port) {
      urls.push(`http://${name}.${namespace}.svc:${port.port}/metrics`);
    }
  }

  return urls;
};

/*
 * Whether an address serves the engine's price metrics: a 2xx answer with a
 * price series in it. The answer is read as it arrives and dropped as soon as
 * one is seen, so a cluster's worth of per-container series is never held in
 * memory. A web page is turned away on its content type, unread.
 */
export const probeMetricsEndpoint: ProbeMetricsEndpoint = (
  address: string,
): Promise<MetricsProbe> => {
  return new Promise((resolve: (probe: MetricsProbe) => void): void => {
    let url: URL;

    try {
      url = new URL(address);
    } catch {
      resolve({ ok: false, reason: "not a URL" });
      return;
    }

    let settled: boolean = false;

    const finish: (probe: MetricsProbe) => void = (
      probe: MetricsProbe,
    ): void => {
      if (!settled) {
        settled = true;
        resolve(probe);
      }
    };

    const isHttps: boolean = url.protocol === "https:";

    const req: http.ClientRequest = (isHttps ? https : http).request(
      {
        method: "GET",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          Accept: "text/plain;version=0.0.4;q=1,*/*;q=0.1",
        },
        timeout: PROBE_TIMEOUT_MS,
      },
      (res: http.IncomingMessage): void => {
        const status: number = res.statusCode || 0;
        const type: string = String(
          res.headers["content-type"] || "",
        ).toLowerCase();

        if (status < 200 || status >= 300) {
          finish({ ok: false, reason: `HTTP ${status}` });
          req.destroy();
          return;
        }

        if (type.includes("html")) {
          finish({
            ok: false,
            reason: `a web page (${type.split(";")[0]}), not metrics`,
          });
          req.destroy();
          return;
        }

        let carried: string = "";
        let bytes: number = 0;

        res.setEncoding("utf8");

        res.on("data", (chunk: string): void => {
          if (settled) {
            return;
          }

          bytes += Buffer.byteLength(chunk, "utf8");
          const text: string = carried + chunk;

          if (hasPriceSeries(text)) {
            finish({ ok: true, reason: "" });
            req.destroy();
            return;
          }

          if (bytes > MAX_PROBE_BYTES) {
            finish({
              ok: false,
              reason: `no price series in its first ${MAX_PROBE_BYTES / (1024 * 1024)} MiB`,
            });
            req.destroy();
            return;
          }

          // The partial line at the end, which the next chunk completes.
          carried = text
            .slice(text.lastIndexOf("\n") + 1)
            .slice(0, MAX_CARRIED_LINE);
        });

        res.on("end", (): void => {
          finish({
            ok: false,
            reason: "answers, but with none of the engine's price series",
          });
        });

        res.on("error", (err: Error): void => {
          finish({ ok: false, reason: err.message });
        });
      },
    );

    req.on("timeout", (): void => {
      finish({
        ok: false,
        reason: `no answer within ${PROBE_TIMEOUT_MS / 1000}s`,
      });
      req.destroy();
    });

    req.on("error", (err: Error): void => {
      finish({ ok: false, reason: err.message });
    });

    req.end();
  });
};

/*
 * Where the engine's price metrics are: the first address, in the order the
 * header comment gives, that answers with price series.
 */
export const findEngineMetricsEndpoint: (data: {
  engine: MetricsEngine;
  listServices: ListServices;
  probe: ProbeMetricsEndpoint;
}) => Promise<FoundMetricsEndpoint> = async (data: {
  engine: MetricsEngine;
  listServices: ListServices;
  probe: ProbeMetricsEndpoint;
}): Promise<FoundMetricsEndpoint> => {
  const reasons: Array<string> = [];

  const answers: (url: string) => Promise<boolean> = async (
    url: string,
  ): Promise<boolean> => {
    const probe: MetricsProbe = await data.probe(url);

    if (!probe.ok) {
      reasons.push(`${url}: ${probe.reason}`);
    }

    return probe.ok;
  };

  for (const url of engineMetricsCandidates(data.engine.url)) {
    if (await answers(url)) {
      return { url, reasons: [] };
    }
  }

  const namespace: string | null = data.engine.namespace;

  if (!namespace) {
    return { url: null, reasons };
  }

  let services: Array<KubernetesService> = [];

  try {
    services = await data.listServices({
      labelSelector: FINOPS_AGENT_SELECTOR,
      fieldSelector: `metadata.namespace=${namespace}`,
    });
  } catch (err: unknown) {
    reasons.push(
      `could not look for a Kubecost 3 finops agent in namespace ${namespace}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { url: null, reasons };
  }

  const finopsAgents: Array<string> = finopsAgentMetricsUrls(
    services,
    namespace,
  );

  if (finopsAgents.length === 0) {
    reasons.push(
      `no Kubecost 3 finops agent Service in namespace ${namespace}`,
    );
  }

  for (const url of finopsAgents) {
    if (await answers(url)) {
      return { url, reasons: [] };
    }
  }

  return { url: null, reasons };
};

/*
 * The http_sd answer for a metrics URL: its host:port as the target, its
 * scheme and path as the labels Prometheus scrapes it by. The port is always
 * written, the scheme's own when the URL has none (a URL drops :80 and :443),
 * so the target is a plain host:port. Nothing to scrape is an empty list,
 * which Prometheus reads as no targets.
 */
export const toScrapeTargetGroups: (
  metricsUrl: string | null,
) => Array<ScrapeTargetGroup> = (
  metricsUrl: string | null,
): Array<ScrapeTargetGroup> => {
  if (!metricsUrl) {
    return [];
  }

  let url: URL;

  try {
    url = new URL(metricsUrl);
  } catch {
    return [];
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname
  ) {
    return [];
  }

  const port: string = url.port || (url.protocol === "https:" ? "443" : "80");

  return [
    {
      targets: [`${url.hostname}:${port}`],
      labels: {
        __scheme__: url.protocol.slice(0, -1),
        __metrics_path__: url.pathname || "/metrics",
      },
    },
  ];
};

/*
 * The endpoint for the engine in use, found again when the engine changes,
 * hourly once found (an engine upgraded from Kubecost 2 to 3 moves it), and
 * every minute while it is not. One look at a time. A look that fails after
 * one succeeded keeps the endpoint it had: an engine that is down for a
 * moment shows as a failed scrape, not as a target that comes and goes.
 */
export class EngineMetricsTarget implements EngineMetricsSource {
  private readonly engine: () => MetricsEngine | null;
  private readonly listServices: ListServices;
  private readonly probe: ProbeMetricsEndpoint;
  private readonly now: () => number;
  private readonly retryMs: number;
  private readonly refreshMs: number;

  // The engine the endpoint below is for.
  private engineUrl: string | null = null;
  private metricsUrl: string | null = null;
  private reasons: Array<string> = [];
  private lastLookOk: boolean = false;
  private lookedAtMs: number = 0;
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  public constructor(options: {
    engine: () => MetricsEngine | null;
    listServices: ListServices;
    probe?: ProbeMetricsEndpoint | undefined;
    now?: (() => number) | undefined;
    retryMs?: number | undefined;
    refreshMs?: number | undefined;
  }) {
    this.engine = options.engine;
    this.listServices = options.listServices;
    this.probe = options.probe || probeMetricsEndpoint;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
    this.retryMs = options.retryMs ?? METRICS_RETRY_MS;
    this.refreshMs = options.refreshMs ?? METRICS_REFRESH_MS;
  }

  // Looks now, then whenever a look is due, until stopped.
  public start(intervalMs: number = METRICS_RETRY_MS): void {
    void this.refreshIfDue();
    this.timer = setInterval((): void => {
      void this.refreshIfDue();
    }, intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Where the engine in use serves its price metrics, when known.
  public url(): string | null {
    const engine: MetricsEngine | null = this.engine();

    return engine && engine.url === this.engineUrl ? this.metricsUrl : null;
  }

  // Why no endpoint is known, once a look has failed.
  public reason(): string {
    return this.url() ? "" : this.reasons.join("; ");
  }

  public targetGroups(): Array<ScrapeTargetGroup> {
    return toScrapeTargetGroups(this.url());
  }

  public refreshIfDue(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const engine: MetricsEngine | null = this.engine();

    if (!engine) {
      return Promise.resolve();
    }

    const sinceLookMs: number = this.now() - this.lookedAtMs;
    const due: boolean =
      engine.url !== this.engineUrl ||
      sinceLookMs >= (this.lastLookOk ? this.refreshMs : this.retryMs);

    if (!due) {
      return Promise.resolve();
    }

    this.inFlight = this.look(engine).finally((): void => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async look(engine: MetricsEngine): Promise<void> {
    const sameEngine: boolean = engine.url === this.engineUrl;
    this.lookedAtMs = this.now();

    let found: FoundMetricsEndpoint;

    try {
      found = await findEngineMetricsEndpoint({
        engine,
        listServices: this.listServices,
        probe: this.probe,
      });
    } catch (err: unknown) {
      found = {
        url: null,
        reasons: [err instanceof Error ? err.message : String(err)],
      };
    }

    if (found.url) {
      if (!sameEngine || found.url !== this.metricsUrl) {
        Logger.info("the cost engine serves its price metrics here", {
          costEngineUrl: engine.url,
          costEngineMetricsUrl: found.url,
        });
      }

      this.engineUrl = engine.url;
      this.metricsUrl = found.url;
      this.reasons = [];
      this.lastLookOk = true;
      return;
    }

    const reasonsChanged: boolean =
      found.reasons.join("; ") !== this.reasons.join("; ");

    if (!sameEngine) {
      // Another engine's endpoint is not this one's.
      this.metricsUrl = null;
    }

    if (!sameEngine || reasonsChanged) {
      Logger.warn(
        "found no price metrics for the cost engine; the collector has nothing of it to scrape until they are found. Set cost.metrics.endpoint to name them.",
        {
          costEngineUrl: engine.url,
          keptCostEngineMetricsUrl: this.metricsUrl || "",
          reasons: found.reasons,
        },
      );
    }

    this.engineUrl = engine.url;
    this.reasons = found.reasons;
    this.lastLookOk = false;
  }
}
