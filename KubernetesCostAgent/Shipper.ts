import { URL } from "url";
import {
  CLUSTER_NAME,
  COST_CURRENCY,
  EXPORT_MAX_RETRIES,
  ONEUPTIME_API_KEY,
  ONEUPTIME_URL,
  SHIP_BATCH_SIZE,
} from "./Config";
import { httpPostJson, HttpResult } from "./HttpClient";
import Logger from "./Logger";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
} from "./Types";

const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

export class Shipper {
  private readonly endpoint: URL = new URL(
    `${ONEUPTIME_URL}/kubernetes-cost/ingest`,
  );

  private lastShipOk: number = 0;
  private lastShipErr: string | null = null;

  public healthy(): boolean {
    if (this.lastShipOk === 0 && this.lastShipErr === null) {
      return true;
    }
    // Healthy if the last successful ship was within 3 poll windows (~3h).
    return Date.now() - this.lastShipOk < 3 * 60 * 60 * 1000;
  }

  public lastError(): string | null {
    return this.lastShipErr;
  }

  /**
   * Ship one window's rows, chunked. Throws if any chunk exhausts its
   * retries, so the caller does not advance its checkpoint past a window
   * that never landed.
   */
  public async ship(
    rows: Array<KubernetesCostAllocationIngestRow>,
  ): Promise<void> {
    for (let i: number = 0; i < rows.length; i += SHIP_BATCH_SIZE) {
      const chunk: Array<KubernetesCostAllocationIngestRow> = rows.slice(
        i,
        i + SHIP_BATCH_SIZE,
      );
      const payload: KubernetesCostIngestPayload = {
        clusterName: CLUSTER_NAME,
        currency: COST_CURRENCY,
        allocations: chunk,
      };
      await this.post(payload, chunk.length);
    }
  }

  private async post(
    payload: KubernetesCostIngestPayload,
    rowCount: number,
  ): Promise<void> {
    for (let attempt: number = 0; attempt <= EXPORT_MAX_RETRIES; attempt++) {
      try {
        const result: HttpResult = await httpPostJson(this.endpoint, payload, {
          "x-oneuptime-token": ONEUPTIME_API_KEY,
        });

        if (result.statusCode === 401) {
          /*
           * Non-retryable (mirrors the OTLP endpoints): the token is
           * missing/revoked, so retrying cannot help. Surface loudly.
           */
          throw new Error(
            "OneUptime rejected the ingestion token (HTTP 401). Create or copy a live key from Project Settings > Telemetry Ingestion Keys and redeploy the agent.",
          );
        }

        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(
            `OneUptime answered HTTP ${result.statusCode}: ${result.body.slice(0, 300)}`,
          );
        }

        this.lastShipOk = Date.now();
        this.lastShipErr = null;
        Logger.debug("shipped cost allocation batch", { rows: rowCount });
        return;
      } catch (err: unknown) {
        const message: string =
          err instanceof Error ? err.message : String(err);
        this.lastShipErr = message;

        const nonRetryable: boolean = message.includes("HTTP 401");
        if (nonRetryable || attempt >= EXPORT_MAX_RETRIES) {
          throw err instanceof Error ? err : new Error(message);
        }

        const backoff: number = Math.min(30000, 500 * Math.pow(2, attempt));
        Logger.warn("cost allocation ship failed; retrying", {
          rows: rowCount,
          attempt,
          backoffMs: backoff,
          error: message,
        });
        await sleep(backoff);
      }
    }
  }
}
