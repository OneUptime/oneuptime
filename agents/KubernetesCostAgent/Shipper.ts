import { URL } from "url";
import {
  CLUSTER_NAME,
  COST_CURRENCY,
  EXPORT_MAX_RETRIES,
  ONEUPTIME_API_KEY,
  ONEUPTIME_URL,
  SHIP_BATCH_SIZE,
} from "./Config";
import { buildShipment, Shipment } from "./Shipment";
import { httpPostJson, HttpResult } from "./HttpClient";
import Logger from "./Logger";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
  ShipperStatus,
} from "./Types";

const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

export class Shipper {
  /*
   * The server mounts this route under both "/telemetry" and "/". Post to
   * the "/telemetry" prefix: it is the one every OneUptime ingress has
   * routed to the app since the OTLP endpoints shipped, so the agent
   * reaches instances whose reverse proxy has no /kubernetes-cost location
   * yet (on a billing-enabled deployment the catch-all serves the
   * marketing site, and a root-path POST 404s there).
   */
  private readonly endpoint: URL = new URL(
    `${ONEUPTIME_URL}/telemetry/kubernetes-cost/ingest`,
  );

  private lastShipOk: number = 0;
  private lastShipErr: string | null = null;

  /*
   * Facts only — no verdict. The shipper cannot tell healthy from broken on
   * its own: it is only ever handed rows the poller managed to fetch, so an
   * agent whose engine never answers leaves it untouched and, until this
   * became Health.ts's call, spotless. Health.ts reads this alongside the
   * poller's status, where "never shipped" and "never polled" are visible
   * together.
   */
  public status(): ShipperStatus {
    return {
      lastShipOkAtMs: this.lastShipOk,
      lastShipError: this.lastShipErr,
    };
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
    /*
     * Every chunk carries the same shipment id and its own index. The server
     * needs both to accept a multi-chunk window whole while still rejecting a
     * window an earlier shipment already delivered — see Shipment.ts. Rows are
     * shipped in the shipment's deterministic order so chunk N of a re-shipped
     * window holds exactly the rows it held the first time.
     */
    const shipment: Shipment = buildShipment(rows);

    for (let i: number = 0; i < shipment.rows.length; i += SHIP_BATCH_SIZE) {
      const chunk: Array<KubernetesCostAllocationIngestRow> =
        shipment.rows.slice(i, i + SHIP_BATCH_SIZE);
      const payload: KubernetesCostIngestPayload = {
        clusterName: CLUSTER_NAME,
        currency: COST_CURRENCY,
        shipmentId: shipment.id,
        shipmentChunk: i / SHIP_BATCH_SIZE,
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
