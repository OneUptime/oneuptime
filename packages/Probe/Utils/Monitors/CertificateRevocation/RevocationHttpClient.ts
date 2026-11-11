import HttpMonitorRequest, {
  PreparedHttpMonitorRequest,
} from "../HttpMonitorRequest";
import Headers from "Common/Types/API/Headers";
import API from "Common/Utils/API";
import axios, { AxiosResponse } from "axios";

/*
 * Fetches an OCSP response or a CRL from the address a certificate names.
 *
 * That address comes from the certificate the monitored server presented, so
 * it goes through the same egress guard, DNS pinning and proxy settings as a
 * monitor's own URL (HttpMonitorRequest.prepare): a probe that may not reach
 * private addresses does not reach them this way either. Every request has a
 * deadline and a size limit, and redirects are followed only for GET, a few
 * hops, each hop guarded again.
 */

const REDIRECT_STATUS_CODES: ReadonlyArray<number> = [301, 302, 303, 307, 308];

export class RevocationFetchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RevocationFetchError";
  }
}

export interface RevocationFetchOptions {
  url: string;
  method: "GET" | "POST";
  body?: Buffer | undefined;
  headers: Headers;
  timeoutInMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
}

export default class RevocationHttpClient {
  public static async fetch(options: RevocationFetchOptions): Promise<Buffer> {
    const deadline: number = Date.now() + options.timeoutInMs;
    let currentUrl: string = options.url;

    for (let redirects: number = 0; ; redirects++) {
      const prepared: PreparedHttpMonitorRequest =
        await RevocationHttpClient.beforeDeadline(
          HttpMonitorRequest.prepare(currentUrl, {
            headers: options.headers,
            targetLabel: "Certificate revocation server",
          }),
          deadline,
          options.timeoutInMs,
        );

      const response: AxiosResponse<Buffer> =
        await RevocationHttpClient.request(prepared, options, deadline);

      if (REDIRECT_STATUS_CODES.includes(response.status)) {
        const location: unknown = response.headers["location"];

        if (
          options.method !== "GET" ||
          redirects >= options.maxRedirects ||
          typeof location !== "string" ||
          !location
        ) {
          throw new RevocationFetchError(
            `answered with a redirect (HTTP ${response.status})`,
          );
        }

        currentUrl = new globalThis.URL(location, currentUrl).toString();
        continue;
      }

      if (response.status !== 200) {
        throw new RevocationFetchError(`answered HTTP ${response.status}`);
      }

      return Buffer.from(response.data);
    }
  }

  /*
   * Why a fetch failed, worded to follow "The OCSP responder at <url>" or
   * "The CRL at <url>".
   */
  public static describeFailure(error: unknown): string {
    if (error instanceof RevocationFetchError) {
      return error.message;
    }

    if (axios.isAxiosError(error)) {
      if (error.message.includes("maxContentLength")) {
        return "sent more data than the probe accepts";
      }

      return `could not be reached (${API.getFriendlyErrorMessage(error)})`;
    }

    if (error instanceof Error) {
      return `could not be reached (${error.message})`;
    }

    return `could not be reached (${String(error)})`;
  }

  private static async request(
    prepared: PreparedHttpMonitorRequest,
    options: RevocationFetchOptions,
    deadline: number,
  ): Promise<AxiosResponse<Buffer>> {
    const remainingInMs: number = deadline - Date.now();

    if (remainingInMs <= 0) {
      throw RevocationHttpClient.timeoutError(options.timeoutInMs);
    }

    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort();
    }, remainingInMs);

    try {
      return await axios.request<Buffer>({
        url: prepared.dispatchUrl,
        method: options.method,
        headers: prepared.headers,
        data: options.body,
        responseType: "arraybuffer",
        timeout: remainingInMs,
        signal: controller.signal,
        maxRedirects: 0,
        maxContentLength: options.maxResponseBytes,
        maxBodyLength: prepared.maxBodyLength,
        proxy: false,
        httpAgent: prepared.httpAgent,
        httpsAgent: prepared.httpsAgent,
        validateStatus: (): boolean => {
          return true;
        },
      });
    } catch (error) {
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw RevocationHttpClient.timeoutError(options.timeoutInMs);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // The guard's own DNS budget is longer than ours; stop waiting at the deadline.
  private static async beforeDeadline<T>(
    promise: Promise<T>,
    deadline: number,
    timeoutInMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const expired: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        timer = setTimeout(
          () => {
            reject(RevocationHttpClient.timeoutError(timeoutInMs));
          },
          Math.max(0, deadline - Date.now()),
        );
      },
    );

    try {
      return await Promise.race([promise, expired]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      // The losing guard lookup may still settle; nothing is waiting on it.
      promise.catch(() => {});
    }
  }

  private static timeoutError(timeoutInMs: number): RevocationFetchError {
    return new RevocationFetchError(
      `did not answer within ${Math.round(timeoutInMs / 100) / 10} seconds`,
    );
  }
}
