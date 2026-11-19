import { URL } from "url";
import { COST_ALLOCATION_PATH, COST_ENGINE_URL, INCLUDE_IDLE } from "./Config";
import { httpGetJson, HttpResult } from "./HttpClient";
import Logger from "./Logger";
import { EngineAllocation, EngineAllocationResponse } from "./Types";

/*
 * Allocation API paths, probed in order when COST_ALLOCATION_PATH is not
 * set explicitly:
 *   /model/allocation    — Kubecost frontend / aggregator (2.x, 3.x)
 *   /allocation/compute  — OpenCost
 *   /allocation          — older OpenCost builds
 */
const CANDIDATE_PATHS: Array<string> = [
  "/model/allocation",
  "/allocation/compute",
  "/allocation",
];

// The Kubecost frontend serves the cost model's API under /model.
const KUBECOST_PATH_PREFIX: string = "/model";

/*
 * RFC3339 to the SECOND — no fractional part. Both engines parse the
 * `window` bound with a fixed set of layouts and none of them accept
 * milliseconds, so a raw Date.toISOString() (which always emits `.sssZ`)
 * is rejected outright:
 *
 *   HTTP 400 Invalid 'window' parameter: illegal window:
 *     2026-07-25T16:00:00.000Z,2026-07-25T17:00:00.000Z
 *
 * Windows are floored to the window grid by the poller, so truncating the
 * millisecond field never loses information.
 */
const toEngineTimestamp: (date: Date) => string = (date: Date): string => {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
};

/*
 * The envelope OpenCost's API answers in (and Kubecost's, from the same
 * code): {"code": 200, "data": ...}.
 */
interface EngineEnvelope {
  code?: number;
  data?: unknown;
}

export class CostEngineClient {
  // Base URL of the engine, without a trailing slash.
  public readonly baseUrl: string;

  /** Detected (or configured) allocation path; null until first success. */
  private allocationPath: string | null;

  public constructor(data?: {
    baseUrl?: string | undefined;
    allocationPath?: string | undefined;
  }) {
    this.baseUrl = (data?.baseUrl ?? COST_ENGINE_URL).replace(/\/+$/, "");
    this.allocationPath =
      (data?.allocationPath ?? COST_ALLOCATION_PATH) || null;
  }

  public detectedPath(): string | null {
    return this.allocationPath;
  }

  /*
   * Which engine answers, read off the path its Allocation API answered on:
   * the Kubecost frontend serves the cost model under /model, OpenCost at
   * the root. Null until a fetch has detected the path.
   */
  public engineKind(): "Kubecost" | "OpenCost" | null {
    if (!this.allocationPath) {
      return null;
    }

    return this.allocationPath.startsWith(`${KUBECOST_PATH_PREFIX}/`)
      ? "Kubecost"
      : "OpenCost";
  }

  /**
   * Fetch container-granularity allocations for one closed window,
   * accumulated to a single allocation-set. Returns the flattened
   * allocation objects.
   */
  public async fetchAllocations(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<EngineAllocation>> {
    const window: string = `${toEngineTimestamp(data.windowStart)},${toEngineTimestamp(data.windowEnd)}`;

    const paths: Array<string> = this.allocationPath
      ? [this.allocationPath]
      : CANDIDATE_PATHS;

    let lastError: Error | null = null;

    for (const path of paths) {
      const url: URL = new URL(`${this.baseUrl}${path}`);
      url.searchParams.set("window", window);
      url.searchParams.set("accumulate", "true");
      if (INCLUDE_IDLE) {
        url.searchParams.set("includeIdle", "true");
      }

      try {
        const result: HttpResult = await httpGetJson(url);

        if (result.statusCode === 404 && !this.allocationPath) {
          // Wrong path for this engine flavour — try the next candidate.
          continue;
        }

        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(
            `Cost engine answered HTTP ${result.statusCode} for ${path}: ${result.body.slice(0, 300)}`,
          );
        }

        const parsed: EngineAllocationResponse = JSON.parse(
          result.body,
        ) as EngineAllocationResponse;

        if (!Array.isArray(parsed.data)) {
          throw new Error(
            `Cost engine response for ${path} has no data array: ${result.body.slice(0, 300)}`,
          );
        }

        if (!this.allocationPath) {
          this.allocationPath = path;
          Logger.info("detected cost engine allocation path", {
            path,
            costEngineUrl: this.baseUrl,
          });
        }

        const allocations: Array<EngineAllocation> = [];
        for (const set of parsed.data) {
          if (!set || typeof set !== "object") {
            continue;
          }
          for (const allocation of Object.values(set)) {
            if (allocation && typeof allocation === "object") {
              allocations.push(allocation);
            }
          }
        }
        return allocations;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw (
      lastError ||
      new Error(
        `Cost engine at ${this.baseUrl} did not answer any known allocation path (${CANDIDATE_PATHS.join(", ")}).`,
      )
    );
  }

  /*
   * The engine's own API besides allocations, beside the Allocation API it
   * answered on: /model/<name> on the Kubecost frontend, /<name> on
   * OpenCost. Resolves to the envelope's data, or null when the engine does
   * not answer it - an older engine, or a frontend that does not proxy it.
   * Never throws: what it reads only describes the prices.
   */
  public async fetchApiData(name: string): Promise<unknown> {
    const prefix: string =
      this.engineKind() === "Kubecost" ? KUBECOST_PATH_PREFIX : "";

    try {
      const result: HttpResult = await httpGetJson(
        new URL(`${this.baseUrl}${prefix}/${name}`),
      );

      if (result.statusCode < 200 || result.statusCode >= 300) {
        return null;
      }

      const parsed: EngineEnvelope = JSON.parse(result.body) as EngineEnvelope;

      return parsed && typeof parsed === "object" ? parsed.data ?? null : null;
    } catch (err: unknown) {
      Logger.debug("cost engine did not answer an API it may not have", {
        api: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
