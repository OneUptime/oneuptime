import BadDataException from "../Types/Exception/BadDataException";

interface StreamedResponseBody extends AsyncIterable<unknown> {
  destroy?: (() => unknown) | undefined;
}

interface ResponseBodyReadOptions {
  budget: HTTPResponseBodyBudget;
  statusCode: number;
  headers?: unknown;
  limitRedirectResponseBody: boolean;
  isHeadResponse?: boolean | undefined;
  maximumResponseBytes?: number | undefined;
  signal?: AbortSignal | undefined;
}

const DEFAULT_MAX_REDIRECT_RESPONSE_BYTES: number = 64 * 1024;

export class HTTPResponseBodyBudget {
  private remainingByteCount: number;
  public readonly maxRedirectResponseBytes: number;

  public constructor(
    maximumBytes: number,
    maxRedirectResponseBytes: number = DEFAULT_MAX_REDIRECT_RESPONSE_BYTES,
  ) {
    this.remainingByteCount = this.normalizeMaximumBytes(maximumBytes);
    this.maxRedirectResponseBytes = this.normalizeMaximumBytes(
      maxRedirectResponseBytes,
    );
  }

  public get remainingBytes(): number {
    return this.remainingByteCount;
  }

  public getResponseLimit(
    statusCode: number,
    limitRedirectResponseBody: boolean,
  ): number {
    if (this.remainingByteCount <= 0) {
      throw new BadDataException(
        "Remote response exceeded the allowed cumulative size.",
      );
    }

    if (
      limitRedirectResponseBody &&
      [301, 302, 303, 307, 308].includes(statusCode)
    ) {
      return Math.min(this.remainingByteCount, this.maxRedirectResponseBytes);
    }

    return this.remainingByteCount;
  }

  public consume(byteCount: number): void {
    if (
      !Number.isFinite(byteCount) ||
      byteCount < 0 ||
      byteCount > this.remainingByteCount
    ) {
      throw new BadDataException(
        "Remote response exceeded the allowed cumulative size.",
      );
    }

    this.remainingByteCount -= byteCount;
  }

  private normalizeMaximumBytes(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.floor(value));
  }
}

export default class HTTPResponseBodyReader {
  /*
   * Axios removes a leading UTF-8 BOM before returning text or parsing JSON.
   * Bounded callers request a raw stream so they can enforce a cumulative
   * byte budget themselves; keep Axios-compatible decoding in one shared
   * place for every streamed response path.
   */
  public static decodeUtf8(body: Buffer): string {
    const text: string = body.toString("utf8");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  public static async read(
    responseBody: unknown,
    options: ResponseBodyReadOptions,
  ): Promise<Buffer> {
    if (!this.isStreamedResponseBody(responseBody)) {
      throw new BadDataException("Remote response body could not be read.");
    }

    const signal: AbortSignal | undefined = options.signal;
    if (!signal) {
      return await this.readStream(responseBody, options);
    }

    let onAbort: (() => void) | undefined;
    const aborted: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        onAbort = (): void => {
          reject(this.abortError());
          responseBody.destroy?.();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      },
    );

    try {
      if (signal.aborted) {
        onAbort!();
        return await aborted;
      }

      /*
       * Axios detaches its signal listener when an HTTP error rejects at
       * headers, before the error body is read. Own cancellation here too,
       * so a timed-out attempt closes that stream before retrying. Racing
       * also settles readers whose async iterator does not expose destroy.
       */
      return await Promise.race([
        this.readStream(responseBody, options),
        aborted,
      ]);
    } finally {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  private static async readStream(
    responseBody: StreamedResponseBody,
    options: ResponseBodyReadOptions,
  ): Promise<Buffer> {
    let limit: number;
    try {
      limit = options.budget.getResponseLimit(
        options.statusCode,
        options.limitRedirectResponseBody,
      );

      if (options.maximumResponseBytes !== undefined) {
        limit = Math.min(
          limit,
          this.normalizeMaximumBytes(options.maximumResponseBytes),
        );
      }
    } catch (error) {
      responseBody.destroy?.();
      throw error;
    }

    const contentLength: number | null = this.getContentLength(options.headers);

    /*
     * HEAD and 304 Content-Length values describe a selected representation,
     * not bytes carried by this response. A 204 cannot carry a body either.
     * Still stream-count any non-compliant bytes actually sent for all three.
     *
     * Keep this utility browser-bundle-safe: API.ts is shared by the web
     * frontends, so the streamed body is deliberately duck-typed instead of
     * importing Node's `stream` module at runtime.
     */
    const responseHasNoBody: boolean =
      Boolean(options.isHeadResponse) ||
      options.statusCode === 204 ||
      options.statusCode === 304;

    if (!responseHasNoBody && contentLength !== null && contentLength > limit) {
      responseBody.destroy?.();
      throw new BadDataException("Remote response exceeded the allowed size.");
    }

    const chunks: Array<Buffer> = [];
    let byteCount: number = 0;

    for await (const rawChunk of responseBody) {
      if (options.signal?.aborted) {
        throw this.abortError();
      }

      const chunk: Buffer = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk as Uint8Array);
      byteCount += chunk.length;

      if (byteCount > limit) {
        /*
         * The bytes have already crossed the socket boundary, so charge them
         * even though this response is rejected. Otherwise a peer can send a
         * near-limit partial response, reset the stream, and reclaim the
         * entire cumulative budget on every monitor retry.
         */
        options.budget.consume(
          Math.min(chunk.length, options.budget.remainingBytes),
        );
        responseBody.destroy?.();
        throw new BadDataException(
          "Remote response exceeded the allowed size.",
        );
      }

      options.budget.consume(chunk.length);
      chunks.push(chunk);
    }

    return Buffer.concat(chunks, byteCount);
  }

  private static abortError(): Error {
    const error: Error = new Error("Response body read was aborted.");
    error.name = "AbortError";
    return error;
  }

  private static normalizeMaximumBytes(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.floor(value));
  }

  private static isStreamedResponseBody(
    responseBody: unknown,
  ): responseBody is StreamedResponseBody {
    return Boolean(
      responseBody &&
        typeof responseBody === "object" &&
        typeof (responseBody as Partial<AsyncIterable<unknown>>)[
          Symbol.asyncIterator
        ] === "function",
    );
  }

  private static getContentLength(headers: unknown): number | null {
    if (!headers || typeof headers !== "object") {
      return null;
    }

    const getHeader: unknown = (headers as { get?: unknown }).get;
    let value: unknown;

    if (typeof getHeader === "function") {
      value = (getHeader as (name: string) => unknown).call(
        headers,
        "content-length",
      );
    } else {
      const headerRecord: Record<string, unknown> = headers as Record<
        string,
        unknown
      >;
      const name: string | undefined = Object.keys(headerRecord).find(
        (headerName: string) => {
          return headerName.toLowerCase() === "content-length";
        },
      );
      value = name ? headerRecord[name] : undefined;
    }

    if (Array.isArray(value)) {
      value = value[0];
    }

    const parsed: number = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
}
