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

export class CostEngineClient {
  /** Detected (or configured) allocation path; null until first success. */
  private allocationPath: string | null = COST_ALLOCATION_PATH || null;

  public detectedPath(): string | null {
    return this.allocationPath;
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
    const window: string = `${data.windowStart.toISOString()},${data.windowEnd.toISOString()}`;

    const paths: Array<string> = this.allocationPath
      ? [this.allocationPath]
      : CANDIDATE_PATHS;

    let lastError: Error | null = null;

    for (const path of paths) {
      const url: URL = new URL(`${COST_ENGINE_URL}${path}`);
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
          Logger.info("detected cost engine allocation path", { path });
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
        `Cost engine at ${COST_ENGINE_URL} did not answer any known allocation path (${CANDIDATE_PATHS.join(", ")}).`,
      )
    );
  }
}
