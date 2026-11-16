import { JSONObject } from "../../../Types/JSON";
import HTTPResponseBodyReader, {
  HTTPResponseBodyBudget,
} from "../../../Utils/HTTPResponseBodyReader";
import axios, { AxiosError, AxiosResponse } from "axios";
import http from "http";
import https from "https";
import DataSourceEgressGuard, {
  EgressLookupFunction,
} from "../DataSource/EgressGuard";
import SSRFProtection from "../SSRFProtection";

/*
 * THE HTTP OF SANDBOXED CODE, AS THE HOST MAKES IT.
 *
 * Code in a VMRunner isolate has no network of its own. Its axios shim hands
 * each call to the host - the method, the URL, the body and the config, each
 * a string - and the host makes the request here: on THIS side of the
 * isolate boundary, through the SSRF guard with the caller's policy, to the
 * one address the guard validated (a pinned lookup), with no proxy, no
 * redirect and no socket path, and with every byte that crosses back counted
 * against the run's budgets.
 *
 * One bridge per run: its budgets are the run's. VMRunner makes one for each
 * run by default. A global Runner's JavaScript step runs its isolate in a
 * process of its own that may open no socket at all, so that process hands
 * each call to the Runner (VMRunner's httpRequester), and the Runner makes it
 * with a bridge of the step's own, with the policy the Runner decided
 * (packages/Runner/Utils/JavaScriptSandbox/SandboxHttp): the same checks,
 * made where the network is.
 */

// The most a run's HTTP may bring back, every response together.
export const MAX_HTTP_RESPONSE_BYTES: number = 10 * 1024 * 1024;
// The most a run's HTTP may send, every request together.
export const MAX_HTTP_REQUEST_BYTES: number = 10 * 1024 * 1024;
export const MAX_HTTP_CONFIG_BYTES: number = 256 * 1024;
export const MAX_HTTP_URL_BYTES: number = 16 * 1024;
// HTTP calls of one run in flight at once.
export const MAX_PENDING_HTTP_REQUESTS: number = 100;
export const TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE: string =
  "Too many pending HTTP requests";

const MAX_BASE64_RESPONSE_SOURCE_BYTES: number = Math.floor(
  ((MAX_HTTP_RESPONSE_BYTES - 64 * 1024) * 3) / 4,
);

// The calls the sandbox's axios shim makes.
export const VM_HTTP_METHODS: ReadonlyArray<string> = [
  "get",
  "head",
  "options",
  "post",
  "put",
  "patch",
  "delete",
  "request",
];

/*
 * One HTTP call of sandboxed code, as its axios shim hands it over:
 *
 *   GET/HEAD/OPTIONS/DELETE: url, arg1 = the config as JSON
 *   POST/PUT/PATCH:          url, arg1 = the body as JSON, arg2 = the config
 *   REQUEST:                 url = "", arg1 = the config as JSON
 */
export interface VMHttpCall {
  method: string;
  url?: string | undefined;
  arg1?: string | undefined;
  arg2?: string | undefined;
}

/*
 * Where sandboxed code's HTTP may go, decided by the caller, never here
 * (VMRunner.runCodeInSandbox says what each one means).
 */
export interface VMHttpPolicy {
  allowPrivateNetworkRequests?: boolean | undefined;
  privateNetworkAccessIsAllowed?: boolean | undefined;
  privateNetworkHint?: string | undefined;
  includeResolutionDetailInError?: boolean | undefined;
}

/*
 * Who makes a call: the response envelope the sandbox's shim reads, or a
 * rejection whose message the sandbox's code is given.
 */
export type VMHttpRequester = (
  call: VMHttpCall,
  signal: AbortSignal,
) => Promise<string>;

export default class VMHttpBridge {
  private serializedRequestBytes: number = 0;
  private readonly responseBodyBudget: HTTPResponseBodyBudget =
    new HTTPResponseBodyBudget(MAX_HTTP_RESPONSE_BYTES);

  public constructor(private readonly policy: VMHttpPolicy) {}

  /*
   * Works out which URL the sandbox's axios call will actually dial, so the
   * SSRF check and the request agree on the destination. axios accepts the
   * target three different ways - a positional url, config.url on a
   * `request()` call, and a relative url resolved against config.baseURL - and
   * a check that only looked at the positional argument would miss two of them.
   *
   * Anything that does not end up an absolute http(s) URL is rejected rather
   * than guessed at.
   */
  public static resolveEffectiveRequestUrl(data: {
    method: string;
    url?: string | undefined;
    config?: JSONObject | undefined;
  }): string {
    const baseUrl: unknown = data.config?.["baseURL"];
    const requestedUrl: unknown =
      data.method === "request" ? data.config?.["url"] : data.url;
    const allowAbsoluteUrls: unknown = data.config?.["allowAbsoluteUrls"];
    const axiosAbsoluteUrlPattern: RegExp = new RegExp(
      "^([a-z][a-z\\d+\\-.]*:)?//",
      "i",
    );
    const httpUrlPattern: RegExp = new RegExp("^https?://", "i");

    /*
     * Mirror Axios's buildFullPath/isAbsoluteURL decision exactly before the
     * SSRF guard sees the target. In particular, protocol-relative URLs and
     * every RFC 3986 scheme count as absolute to Axios, while
     * allowAbsoluteUrls:false deliberately combines even an absolute URL with
     * baseURL. Direct-method positional URLs remain authoritative when they
     * are the empty string; config.url must not silently replace them.
     */
    const isAxiosAbsoluteUrl: boolean =
      typeof requestedUrl === "string" &&
      axiosAbsoluteUrlPattern.test(requestedUrl);
    let effectiveUrl: unknown = requestedUrl;

    if (baseUrl && (!isAxiosAbsoluteUrl || allowAbsoluteUrls === false)) {
      if (typeof baseUrl !== "string") {
        throw new Error("Request URL must be an absolute http or https URL.");
      }

      effectiveUrl = requestedUrl
        ? `${baseUrl.replace(/\/?\/$/, "")}/${String(requestedUrl).replace(
            /^\/+/,
            "",
          )}`
        : baseUrl;
    }

    if (
      typeof effectiveUrl !== "string" ||
      !httpUrlPattern.test(effectiveUrl)
    ) {
      throw new Error("Request URL must be an absolute http or https URL.");
    }

    return effectiveUrl;
  }

  /*
   * Counts one call against the run's limits before it is made: its URL,
   * body and config each within theirs, and every request of the run within
   * MAX_HTTP_REQUEST_BYTES together. Throws the sentence the sandbox's code
   * is given when it does not fit. The total is never given back, so many
   * small requests cannot hold close to the limit at once while DNS or a
   * socket is pending.
   */
  public reserve(call: VMHttpCall): void {
    const urlBytes: number = Buffer.byteLength(call.url || "", "utf8");
    const arg1Bytes: number = Buffer.byteLength(call.arg1 || "", "utf8");
    const arg2Bytes: number = Buffer.byteLength(call.arg2 || "", "utf8");
    const hasBody: boolean = ["post", "put", "patch"].includes(call.method);

    if (urlBytes > MAX_HTTP_URL_BYTES) {
      throw new Error("HTTP request URL exceeded the allowed size.");
    }

    if (hasBody) {
      if (arg1Bytes > MAX_HTTP_REQUEST_BYTES) {
        throw new Error("HTTP request body exceeded the allowed size.");
      }
      if (arg2Bytes > MAX_HTTP_CONFIG_BYTES) {
        throw new Error("HTTP request config exceeded the allowed size.");
      }
    } else if (call.method === "request") {
      if (arg1Bytes > MAX_HTTP_REQUEST_BYTES + MAX_HTTP_CONFIG_BYTES) {
        throw new Error("HTTP request data exceeded the allowed size.");
      }
    } else if (arg1Bytes > MAX_HTTP_CONFIG_BYTES) {
      throw new Error("HTTP request config exceeded the allowed size.");
    }

    const operationBytes: number = urlBytes + arg1Bytes + arg2Bytes;
    if (this.serializedRequestBytes + operationBytes > MAX_HTTP_REQUEST_BYTES) {
      throw new Error(
        "Sandbox HTTP requests exceeded the allowed cumulative request size.",
      );
    }

    /*
     * This budget is deliberately never replenished. Keeping a
     * per-execution total prevents many individually legal requests
     * from retaining close to the full limit while DNS or sockets are
     * pending outside the isolate's memory limit.
     */
    this.serializedRequestBytes += operationBytes;
  }

  /*
   * Makes one call: the SSRF guard with the caller's policy, the validated
   * address pinned, and the response read within the run's budget, as the
   * envelope the sandbox's axios shim reads. A response of an HTTP error
   * status is an envelope too (the shim rebuilds error.response); anything
   * else that fails is a rejection.
   */
  public async execute(call: VMHttpCall, signal: AbortSignal): Promise<string> {
    const { method, url, arg1, arg2 } = call;

    const methodsWithBody: string[] = ["post", "put", "patch"];
    const hasBody: boolean = methodsWithBody.includes(method);

    /*
     * For POST/PUT/PATCH: arg1=body, arg2=config
     * For GET/HEAD/OPTIONS/DELETE/REQUEST: arg1=config
     */
    const body: JSONObject | undefined =
      hasBody && arg1 ? (JSON.parse(arg1) as JSONObject) : undefined;

    const configStr: string | undefined = hasBody ? arg2 : arg1;
    let config: JSONObject | undefined = configStr
      ? (JSON.parse(configStr) as JSONObject)
      : undefined;

    if (method === "request" && config) {
      const requestBody: unknown = config["data"];
      const configWithoutBody: JSONObject = { ...config };
      delete configWithoutBody["data"];

      if (
        Buffer.byteLength(JSON.stringify(requestBody) || "", "utf8") >
        MAX_HTTP_REQUEST_BYTES
      ) {
        throw new Error("HTTP request body exceeded the allowed size.");
      }

      if (
        Buffer.byteLength(JSON.stringify(configWithoutBody), "utf8") >
        MAX_HTTP_CONFIG_BYTES
      ) {
        throw new Error("HTTP request config exceeded the allowed size.");
      }
    }

    let suppliedHttpsAgentOptions: https.AgentOptions = {};

    const pickAgentOptions: (
      source: JSONObject | undefined,
      allowedKeys: Array<string>,
    ) => Record<string, unknown> = (
      source: JSONObject | undefined,
      allowedKeys: Array<string>,
    ): Record<string, unknown> => {
      const picked: Record<string, unknown> = {};
      if (!source) {
        return picked;
      }

      for (const key of allowedKeys) {
        if (source[key] !== undefined) {
          picked[key] = source[key];
        }
      }

      return picked;
    };

    /*
     * Preserve only TLS semantics from a serialized HTTPS Agent. Network
     * and pooling options are intentionally discarded: host/port/path and
     * custom socket hooks can steer around the validated URL, while a
     * per-request keep-alive agent would leave an idle socket behind.
     */
    if (config) {
      const httpsAgentConfig: JSONObject | undefined = config["httpsAgent"] as
        | JSONObject
        | undefined;

      if (
        httpsAgentConfig &&
        httpsAgentConfig["__agentType"] === "__https_agent__"
      ) {
        suppliedHttpsAgentOptions = pickAgentOptions(
          httpsAgentConfig["options"] as JSONObject | undefined,
          [
            "rejectUnauthorized",
            "ca",
            "cert",
            "key",
            "pfx",
            "passphrase",
            "ciphers",
            "minVersion",
            "maxVersion",
            "secureProtocol",
            "honorCipherOrder",
            "ALPNProtocols",
            "servername",
          ],
        ) as https.AgentOptions;
      }
    }

    /**
     * Helper: convert AxiosHeaders (or any header-like object) to a
     * plain record so it can be safely JSON-serialised.
     */
    const toPlainHeaders: (headers: unknown) => Record<string, unknown> = (
      headers: unknown,
    ): Record<string, unknown> => {
      const plain: Record<string, unknown> = {};
      if (headers) {
        for (const hKey of Object.keys(headers as Record<string, unknown>)) {
          plain[hKey] = (headers as Record<string, unknown>)[hKey];
        }
      }
      return plain;
    };

    /*
     * SSRF guard (GHSA-v5xh-rw9h-77fv).
     *
     * This bridge hands the host process's real axios to code the user
     * wrote - the Custom JavaScript workflow component documents "you can
     * use axios module" - so without a check here it is a strictly more
     * capable version of the hole that was reported against the API
     * components: arbitrary method, headers and body against the internal
     * network, with the full response marshalled back into the sandbox
     * and on into the workflow log.
     *
     * It has to live on THIS side of the isolate boundary. The
     * sandbox-side axios shim is attacker-editable - user code can simply
     * redefine it - so a check there guards nothing.
     */
    const effectiveUrl: string = VMHttpBridge.resolveEffectiveRequestUrl({
      method,
      url,
      config,
    });

    const validatedTarget: Awaited<
      ReturnType<typeof SSRFProtection.validateAndResolveWebhookTarget>
    > = await SSRFProtection.validateAndResolveWebhookTarget(effectiveUrl, {
      allowPrivateNetworkTargets:
        this.policy.allowPrivateNetworkRequests === true,
      privateNetworkAccessIsAllowed: this.policy.privateNetworkAccessIsAllowed,
      /*
       * "Webhook URL" is wrong here in both directions: sandboxed code
       * requests whatever it likes, and one of this runner's two callers
       * is a monitor, not a webhook.
       */
      targetLabel: "Request URL",
      privateNetworkHint: this.policy.privateNetworkHint,
      includeResolutionDetailInError:
        this.policy.includeResolutionDetailInError,
    });
    const canonicalUrl: string = validatedTarget.url.toString();
    const pinnedLookup: EgressLookupFunction =
      DataSourceEgressGuard.createPinnedLookup(validatedTarget.addresses);

    /*
     * The canonical URL that was just validated has to be the URL that
     * gets dialled. Each of these would otherwise steer the connection
     * somewhere else entirely, past the check above:
     *   proxy      - sends the request to an arbitrary host:port; setting
     *                it false also disables Axios's environment proxies
     *   socketPath - connects to a unix socket (/var/run/docker.sock)
     *   transport / adapter - replaces the transport wholesale
     *   HTTP/2 - uses Axios's shared session pool instead of these agents
     *   lookup - takes precedence over the pinned Agent lookup
     *   baseURL / config.url / allowAbsoluteUrls - reinterpret the URL
     * and a redirect would let a validated public host nominate an
     * internal one on the second hop. The pinned lookup closes the DNS
     * rebinding window between policy validation and socket creation.
     */
    const safeConfig: JSONObject = { ...(config || {}) };
    delete safeConfig["socketPath"];
    delete safeConfig["transport"];
    delete safeConfig["adapter"];
    delete safeConfig["http2Options"];
    delete safeConfig["lookup"];
    delete safeConfig["baseURL"];
    delete safeConfig["url"];
    delete safeConfig["allowAbsoluteUrls"];
    safeConfig["proxy"] = false;
    safeConfig["maxRedirects"] = 0;
    safeConfig["httpVersion"] = 1;

    const getEffectiveByteLimit: (
      configuredLimit: unknown,
      securityLimit: number,
    ) => number = (configuredLimit: unknown, securityLimit: number): number => {
      if (
        typeof configuredLimit === "number" &&
        Number.isFinite(configuredLimit) &&
        configuredLimit >= 0
      ) {
        return Math.min(Math.floor(configuredLimit), securityLimit);
      }

      return securityLimit;
    };
    const effectiveMaxContentLength: number = getEffectiveByteLimit(
      config?.["maxContentLength"],
      MAX_HTTP_RESPONSE_BYTES,
    );
    const effectiveMaxBodyLength: number = getEffectiveByteLimit(
      config?.["maxBodyLength"],
      MAX_HTTP_REQUEST_BYTES,
    );
    /*
     * The reader below is the sole response cap so every crossed byte is
     * charged to the execution-wide budget before a rejection.
     */
    safeConfig["maxContentLength"] = -1;
    safeConfig["maxBodyLength"] = effectiveMaxBodyLength;
    const requestedResponseType: string | undefined =
      typeof safeConfig["responseType"] === "string"
        ? (safeConfig["responseType"] as string)
        : undefined;
    const requestedResponseEncoding: string | undefined =
      typeof safeConfig["responseEncoding"] === "string"
        ? (safeConfig["responseEncoding"] as string)
        : undefined;
    const transitionalConfig: JSONObject | undefined =
      safeConfig["transitional"] &&
      typeof safeConfig["transitional"] === "object"
        ? (safeConfig["transitional"] as JSONObject)
        : undefined;
    const forcedJsonParsing: boolean =
      typeof transitionalConfig?.["forcedJSONParsing"] === "boolean"
        ? (transitionalConfig["forcedJSONParsing"] as boolean)
        : true;
    const silentJsonParsing: boolean =
      typeof transitionalConfig?.["silentJSONParsing"] === "boolean"
        ? (transitionalConfig["silentJSONParsing"] as boolean)
        : true;
    const shouldParseResponseAsJson: boolean =
      requestedResponseType === "json" ||
      (forcedJsonParsing && !requestedResponseType);
    const strictJsonParsing: boolean =
      requestedResponseType === "json" && !silentJsonParsing;
    safeConfig["responseType"] = "stream";
    safeConfig["httpAgent"] = new http.Agent({
      lookup: pinnedLookup as never,
    }) as unknown as JSONObject;
    safeConfig["httpsAgent"] = new https.Agent({
      ...suppliedHttpsAgentOptions,
      lookup: pinnedLookup as never,
    }) as unknown as JSONObject;
    Object.defineProperty(safeConfig, "signal", {
      value: signal,
      enumerable: true,
      configurable: true,
    });
    config = safeConfig;

    interface NormalizedResponseData {
      data: string;
      encoding: "base64-arraybuffer" | "base64-json-or-text" | "base64-text";
    }

    const responseDataEncoding:
      | "base64-arraybuffer"
      | "base64-json-or-text"
      | "base64-text" =
      requestedResponseType === "arraybuffer"
        ? "base64-arraybuffer"
        : shouldParseResponseAsJson
          ? "base64-json-or-text"
          : "base64-text";

    const serializedResponseConfig: Record<string, unknown> = {
      method:
        method === "request"
          ? String(safeConfig["method"] || "get").toLowerCase()
          : method,
      url: canonicalUrl,
      maxContentLength: effectiveMaxContentLength,
      maxBodyLength: effectiveMaxBodyLength,
    };
    if (requestedResponseType !== undefined) {
      serializedResponseConfig["responseType"] = requestedResponseType;
    }
    if (requestedResponseEncoding !== undefined) {
      serializedResponseConfig["responseEncoding"] = requestedResponseEncoding;
    }

    const encodeResponseBody: (body: Buffer) => NormalizedResponseData = (
      body: Buffer,
    ): NormalizedResponseData => {
      if (body.length > MAX_BASE64_RESPONSE_SOURCE_BYTES) {
        throw new Error(
          "Remote response exceeded the allowed serialized size.",
        );
      }

      return {
        data: body.toString("base64"),
        encoding: responseDataEncoding,
      };
    };

    type ResponseBodyReadAxiosError = AxiosError & {
      __oneuptimeResponseBodyReadFailed: true;
    };

    const wrapResponseBodyReadError: (
      error: unknown,
      response: AxiosResponse,
    ) => ResponseBodyReadAxiosError = (
      error: unknown,
      response: AxiosResponse,
    ): ResponseBodyReadAxiosError => {
      const wrappedError: AxiosError = AxiosError.from(
        error,
        AxiosError.ERR_BAD_RESPONSE,
        response.config,
        response.request,
        response,
        { __oneuptimeResponseBodyReadFailed: true },
      );

      /*
       * Axios's streamed maxContentLength wrapper can throw an AxiosError
       * before attaching its response. Restore the association here so
       * interceptors and catch handlers retain status, headers, config,
       * and request context just as they do for buffered responses.
       */
      wrappedError.response = response;
      wrappedError.config = response.config;
      wrappedError.request = response.request;

      return wrappedError as ResponseBodyReadAxiosError;
    };

    const normalizeResponseData: (
      response: AxiosResponse,
    ) => Promise<NormalizedResponseData> = async (
      response: AxiosResponse,
    ): Promise<NormalizedResponseData> => {
      const responseData: unknown = response.data;
      const isStream: boolean = Boolean(
        responseData &&
          typeof responseData === "object" &&
          typeof (responseData as Partial<AsyncIterable<unknown>>)[
            Symbol.asyncIterator
          ] === "function",
      );

      if (!isStream) {
        /*
         * Test adapters can return an already-decoded value. Convert that
         * value back to bounded bytes so every path uses the same base64
         * bridge and none can trigger host-side JSON escaping or Buffer's
         * decimal-array serialization.
         */
        let body: Buffer;

        if (Buffer.isBuffer(responseData)) {
          body = responseData;
        } else if (ArrayBuffer.isView(responseData)) {
          body = Buffer.from(
            responseData.buffer,
            responseData.byteOffset,
            responseData.byteLength,
          );
        } else if (responseData instanceof ArrayBuffer) {
          body = Buffer.from(responseData);
        } else {
          const serialized: string =
            typeof responseData === "string"
              ? responseData
              : JSON.stringify(responseData ?? "");
          body = Buffer.from(serialized, "utf8");
        }

        try {
          this.responseBodyBudget.consume(body.length);
          return encodeResponseBody(body);
        } catch (error: unknown) {
          throw wrapResponseBodyReadError(error, response);
        }
      }

      let body: Buffer;
      try {
        body = await HTTPResponseBodyReader.read(responseData, {
          budget: this.responseBodyBudget,
          statusCode: response.status,
          headers: response.headers,
          limitRedirectResponseBody: false,
          isHeadResponse:
            method === "head" ||
            (method === "request" &&
              String(safeConfig["method"] || "").toLowerCase() === "head"),
          maximumResponseBytes: effectiveMaxContentLength,
        });
      } catch (error: unknown) {
        throw wrapResponseBodyReadError(error, response);
      }

      /*
       * Never put raw bytes or decoded attacker text directly into the
       * host-side JSON envelope. Buffer.toJSON creates a decimal array,
       * while JSON escaping can turn one control byte into six characters;
       * either form multiplies memory outside the isolate. Base64 has a
       * fixed 4/3 expansion. The reserved 64 KiB covers status/headers and
       * wrapper fields, keeping the complete bridge string under 10 MiB.
       * Decoding and best-effort JSON parsing happen inside the isolate's
       * 128 MiB memory limit.
       */
      try {
        return encodeResponseBody(body);
      } catch (error: unknown) {
        throw wrapResponseBodyReadError(error, response);
      }
    };

    const serializeResponseEnvelope: (
      metadata: Record<string, unknown>,
      responseData: NormalizedResponseData,
    ) => string = (
      metadata: Record<string, unknown>,
      responseData: NormalizedResponseData,
    ): string => {
      /*
       * Keep the attacker-controlled body outside the JSON metadata.
       * Parsing a JSON object that contains a near-limit base64 string
       * otherwise allocates a second full copy inside the isolate. A JSON
       * line followed by base64 is unambiguous because JSON escapes any
       * newline found in metadata values.
       */
      const envelope: string = `${JSON.stringify({
        ...metadata,
        __oneuptimeDataEncoding: responseData.encoding,
        __oneuptimeResponseEncoding: requestedResponseEncoding,
        __oneuptimeShouldParseJson: shouldParseResponseAsJson,
        __oneuptimeStrictJsonParsing: strictJsonParsing,
        __oneuptimeConfig: serializedResponseConfig,
        __oneuptimeHasRequest: true,
      })}\n${responseData.data}`;

      if (Buffer.byteLength(envelope, "utf8") > MAX_HTTP_RESPONSE_BYTES) {
        throw new Error(
          "Remote response exceeded the allowed serialized size.",
        );
      }

      return envelope;
    };

    try {
      let response: AxiosResponse;

      switch (method) {
        case "get":
          response = await axios.get(canonicalUrl, config);
          break;
        case "head":
          response = await axios.head(canonicalUrl, config);
          break;
        case "options":
          response = await axios.options(canonicalUrl, config);
          break;
        case "post":
          response = await axios.post(canonicalUrl, body, config);
          break;
        case "put":
          response = await axios.put(canonicalUrl, body, config);
          break;
        case "patch":
          response = await axios.patch(canonicalUrl, body, config);
          break;
        case "delete":
          response = await axios.delete(canonicalUrl, config);
          break;
        case "request": {
          config["url"] = canonicalUrl;
          response = await axios.request(
            config as Parameters<typeof axios.request>[0],
          );
          break;
        }
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }

      const normalizedResponseData: NormalizedResponseData =
        await normalizeResponseData(response);

      /*
       * Convert AxiosHeaders to a plain object before serializing.
       * JSON.stringify calls AxiosHeaders.toJSON(key) with a truthy key,
       * which makes it join array headers (like set-cookie) with commas.
       * This produces invalid Cookie headers when user code forwards them.
       */
      return serializeResponseEnvelope(
        {
          status: response.status,
          statusText: response.statusText,
          headers: toPlainHeaders(response.headers),
        },
        normalizedResponseData,
      );
    } catch (err: unknown) {
      /*
       * If this is an axios error with a response (4xx, 5xx, etc.),
       * return the error details as JSON so the sandbox-side axios
       * wrapper can reconstruct error.response for user code.
       */
      const axiosErr: {
        isAxiosError?: boolean;
        response?: AxiosResponse<any, any, Record<string, unknown>>;
        message?: string;
        code?: string;
        name?: string;
        __oneuptimeResponseBodyReadFailed?: boolean;
      } = err as {
        isAxiosError?: boolean;
        response?: AxiosResponse;
        message?: string;
        code?: string;
        name?: string;
        __oneuptimeResponseBodyReadFailed?: boolean;
      };

      if (axiosErr.isAxiosError && axiosErr.response) {
        let errorForEnvelope: typeof axiosErr = axiosErr;
        let normalizedResponseData: NormalizedResponseData;

        if (axiosErr.__oneuptimeResponseBodyReadFailed) {
          normalizedResponseData = encodeResponseBody(Buffer.alloc(0));
        } else {
          try {
            normalizedResponseData = await normalizeResponseData(
              axiosErr.response,
            );
          } catch (responseReadError: unknown) {
            errorForEnvelope = responseReadError as typeof axiosErr;
            normalizedResponseData = encodeResponseBody(Buffer.alloc(0));
          }
        }

        return serializeResponseEnvelope(
          {
            __isAxiosError: true,
            message: errorForEnvelope.message || "Request failed",
            code: errorForEnvelope.code,
            name: errorForEnvelope.name,
            status: axiosErr.response.status,
            statusText: axiosErr.response.statusText,
            headers: toPlainHeaders(axiosErr.response.headers),
          },
          normalizedResponseData,
        );
      }

      throw err;
    }
  }
}
