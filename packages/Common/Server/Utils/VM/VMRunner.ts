import CapturedMetric from "../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../Types/JSON";
import HTTPResponseBodyReader, {
  HTTPResponseBodyBudget,
} from "../../../Utils/HTTPResponseBodyReader";
import axios, { AxiosError, AxiosResponse } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import ivm from "isolated-vm";
import DataSourceEgressGuard, {
  EgressLookupFunction,
} from "../DataSource/EgressGuard";
import SSRFProtection from "../SSRFProtection";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * How often to wake Node's event loop while sandboxed code is running. See
 * the comment on hostBridgeTicker in runCodeInSandbox: the isolate's host
 * bridges only advance on an event-loop turn, and a loop with nothing else
 * pending sleeps until its next timer. 5ms is small against any real host
 * operation and costs one empty callback per tick.
 */
const HOST_BRIDGE_TICK_MS: number = 5;

export default class VMRunner {
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
  private static resolveEffectiveRequestUrl(data: {
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

  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
      /*
       * Passed straight through to the SSRF guard on the axios bridge below.
       * Decided by the CALLER, never here: this runner is shared between the
       * workflow Custom JavaScript component, where the policy comes from the
       * API server's environment, and the Probe's custom code monitor, where
       * it comes from the probe's own environment — a different process on a
       * different machine, usually owned by a different person. Absent ⇒ the
       * strict policy, which is what a caller that says nothing should get.
       */
      allowPrivateNetworkRequests?: boolean | undefined;
      /*
       * A trusted caller's already-resolved egress policy. This is separate
       * from eligibility above because the workflow caller uses the API
       * server's webhook configuration, while the Probe has already resolved
       * its own local setting. When supplied, it is authoritative and the API
       * server's webhook policy is not consulted. Absent leaves the workflow
       * caller's webhook behavior unchanged.
       */
      privateNetworkAccessIsAllowed?: boolean | undefined;
      /*
       * Overrides the sentence a private-tier refusal appends, telling the
       * operator which setting would permit it. Whoever runs this sandbox
       * knows which process's environment that is; the guard does not.
       */
      privateNetworkHint?: string | undefined;
    };
  }): Promise<ReturnResult> {
    const { code, options } = data;
    const timeout: number = options.timeout || 5000;

    const logMessages: string[] = [];
    const capturedMetrics: CapturedMetric[] = [];
    const MAX_METRICS: number = 100;
    const MAX_LOG_MESSAGES: number = 1000;
    const MAX_LOG_BYTES: number = 1_000_000;
    const MAX_SCRIPT_ERROR_MESSAGE_LENGTH: number = 10_000;
    const MAX_HTTP_RESPONSE_BYTES: number = 10 * 1024 * 1024;
    const MAX_HTTP_REQUEST_BYTES: number = 10 * 1024 * 1024;
    const MAX_HTTP_CONFIG_BYTES: number = 256 * 1024;
    const MAX_HTTP_URL_BYTES: number = 16 * 1024;
    const MAX_BASE64_RESPONSE_SOURCE_BYTES: number = Math.floor(
      ((MAX_HTTP_RESPONSE_BYTES - 64 * 1024) * 3) / 4,
    );
    let logBytes: number = 0;
    let serializedHttpRequestBytes: number = 0;
    const httpResponseBodyBudget: HTTPResponseBodyBudget =
      new HTTPResponseBodyBudget(MAX_HTTP_RESPONSE_BYTES);

    const pendingHostTimeouts: Set<ReturnType<typeof global.setTimeout>> =
      new Set<ReturnType<typeof global.setTimeout>>();
    const pendingAxiosControllers: Set<AbortController> =
      new Set<AbortController>();
    let acceptingHostOperations: boolean = true;
    type PendingAxiosOperation =
      | { status: "pending" }
      | { status: "fulfilled"; value: string }
      | { status: "rejected"; errorMessage: string };
    const pendingAxiosOperations: Map<string, PendingAxiosOperation> = new Map<
      string,
      PendingAxiosOperation
    >();
    let nextAxiosOperationId: number = 0;

    type PendingSleepOperation = {
      settled: boolean;
    };
    const pendingSleepOperations: Map<string, PendingSleepOperation> = new Map<
      string,
      PendingSleepOperation
    >();
    let nextSleepOperationId: number = 0;

    const sanitizeScriptError: (error: unknown) => Error = (
      error: unknown,
    ): Error => {
      let message: string = "Sandbox script failed";

      try {
        if (typeof error === "string") {
          message = error;
        } else if (error && typeof error === "object") {
          const candidateMessage: unknown = (error as { message?: unknown })[
            "message"
          ];

          if (typeof candidateMessage === "string") {
            message = candidateMessage;
          }
        }
      } catch {
        // Do not invoke any attacker-controlled coercion while reporting errors.
      }

      let sanitizedMessage: string = "";

      for (const character of message) {
        const characterCode: number = character.charCodeAt(0);

        if (
          characterCode === 9 ||
          characterCode === 10 ||
          characterCode === 13 ||
          (characterCode >= 32 && characterCode !== 127)
        ) {
          sanitizedMessage += character;
        }

        if (sanitizedMessage.length >= MAX_SCRIPT_ERROR_MESSAGE_LENGTH) {
          break;
        }
      }

      message = sanitizedMessage.substring(0, MAX_SCRIPT_ERROR_MESSAGE_LENGTH);

      if (!message) {
        message = "Sandbox script failed";
      }

      /*
       * Deliberately create a fresh host Error so isolate-owned properties and
       * stack frames never escape with the result.
       */
      return new Error(message);
    };

    const isolate: ivm.Isolate = new ivm.Isolate({ memoryLimit: 128 });

    try {
      const context: ivm.Context = await isolate.createContext();
      const jail: ivm.Reference<Record<string, unknown>> = context.global;

      // Set up global object
      await jail.set("global", jail.derefInto());

      /*
       * Callback values become ordinary functions in the destination isolate.
       * Never expose ivm.Reference or ivm.ExternalCopy handles to user code:
       * their prototype methods can be used to cross the isolate boundary.
       */
      await jail.set(
        "__oneuptimeHostLogCallback",
        new ivm.Callback(
          (message: string) => {
            if (logMessages.length >= MAX_LOG_MESSAGES) {
              return;
            }

            const messageBytes: number = Buffer.byteLength(message, "utf8");

            if (logBytes + messageBytes > MAX_LOG_BYTES) {
              return;
            }

            logBytes += messageBytes;
            logMessages.push(message);
          },
          { sync: true },
        ),
      );

      await context.eval(`
        (() => {
          const hostLog = globalThis.__oneuptimeHostLogCallback;
          delete globalThis.__oneuptimeHostLogCallback;
          let sandboxLogCount = 0;
          let sandboxLogCharacters = 0;

          const sandboxConsole = Object.freeze({
            log: (...args) => {
              if (sandboxLogCount >= 1000 || sandboxLogCharacters >= 500000) {
                return;
              }

              const message = args.map(value => {
                try {
                  return typeof value === 'object' ? JSON.stringify(value) : String(value);
                } catch (_) {
                  return String(value);
                }
              }).join(' ').substring(0, 250000);

              if (sandboxLogCharacters + message.length > 500000) {
                return;
              }

              sandboxLogCount += 1;
              sandboxLogCharacters += message.length;
              hostLog(message);
            }
          });

          Object.defineProperty(globalThis, 'console', {
            value: sandboxConsole,
            writable: false,
            configurable: false,
          });
        })();
      `);

      await jail.set(
        "__oneuptimeHostMetricCallback",
        new ivm.Callback(
          (name: string, value: string, attributesJson?: string) => {
            if (capturedMetrics.length >= MAX_METRICS) {
              return;
            }
            const numValue: number = Number(value);
            if (isNaN(numValue)) {
              return;
            }
            const metric: CapturedMetric = {
              name: String(name).substring(0, 200),
              value: numValue,
            };
            if (attributesJson) {
              try {
                metric.attributes = JSON.parse(attributesJson) as JSONObject;
              } catch {
                // ignore invalid JSON
              }
            }
            capturedMetrics.push(metric);
          },
          { sync: true },
        ),
      );

      await context.eval(`
        (() => {
          const hostCaptureMetric = globalThis.__oneuptimeHostMetricCallback;
          delete globalThis.__oneuptimeHostMetricCallback;

          const sandboxOneUptime = Object.freeze({
            captureMetric: (name, value, attributes) => {
              if (typeof name !== 'string' || name.length === 0) return;
              if (typeof value !== 'number' || isNaN(value)) return;
              const attrJson = attributes ? JSON.stringify(attributes) : undefined;
              hostCaptureMetric(String(name), String(value), attrJson);
            }
          });

          Object.defineProperty(globalThis, 'oneuptime', {
            value: sandboxOneUptime,
            writable: false,
            configurable: false,
          });
        })();
      `);

      // args - deep copy into isolate
      await jail.set("__oneuptimeCopiedArgs", options.args || {}, {
        copy: true,
      });
      await context.eval(`
        (() => {
          const copiedArgs = globalThis.__oneuptimeCopiedArgs;
          delete globalThis.__oneuptimeCopiedArgs;
          Object.defineProperty(globalThis, 'args', {
            value: copiedArgs,
            writable: false,
            configurable: false,
          });
        })();
      `);

      /*
       * http / https - provide Agent constructors that serialize across the boundary.
       * The sandbox Agent is a plain object with a marker; the host-side axios bridge
       * reconstructs the real Node.js Agent before making the request.
       */
      await context.eval(`
        const https = {
          Agent: class Agent {
            constructor(options) {
              this.__agentType = '__https_agent__';
              this.options = options || {};
            }
          }
        };
        const http = {
          Agent: class Agent {
            constructor(options) {
              this.__agentType = '__http_agent__';
              this.options = options || {};
            }
          }
        };
      `);

      /*
       * axios (get, head, options, post, put, patch, delete, request)
       * bridged through a copied async callback.
       *
       * For GET/HEAD/OPTIONS/DELETE: args = [method, url, configJson?]
       * For POST/PUT/PATCH:         args = [method, url, bodyJson?, configJson?]
       * For REQUEST:                args = ['request', '', configJson]
       */
      const executeAxiosRequest: (
        signal: AbortSignal,
        method: string,
        url?: string,
        arg1?: string,
        arg2?: string,
      ) => Promise<string> = async (
        signal: AbortSignal,
        method: string,
        url?: string,
        arg1?: string,
        arg2?: string,
      ): Promise<string> => {
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
          const httpsAgentConfig: JSONObject | undefined = config[
            "httpsAgent"
          ] as JSONObject | undefined;

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
            for (const hKey of Object.keys(
              headers as Record<string, unknown>,
            )) {
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
        const effectiveUrl: string = VMRunner.resolveEffectiveRequestUrl({
          method,
          url,
          config,
        });

        const validatedTarget: Awaited<
          ReturnType<typeof SSRFProtection.validateAndResolveWebhookTarget>
        > = await SSRFProtection.validateAndResolveWebhookTarget(effectiveUrl, {
          allowPrivateNetworkTargets:
            options.allowPrivateNetworkRequests === true,
          privateNetworkAccessIsAllowed: options.privateNetworkAccessIsAllowed,
          /*
           * "Webhook URL" is wrong here in both directions: sandboxed code
           * requests whatever it likes, and one of this runner's two callers
           * is a monitor, not a webhook.
           */
          targetLabel: "Request URL",
          privateNetworkHint: options.privateNetworkHint,
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
        ) => number = (
          configuredLimit: unknown,
          securityLimit: number,
        ): number => {
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
          encoding:
            | "base64-arraybuffer"
            | "base64-json-or-text"
            | "base64-text";
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
          serializedResponseConfig["responseEncoding"] =
            requestedResponseEncoding;
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
              httpResponseBodyBudget.consume(body.length);
              return encodeResponseBody(body);
            } catch (error: unknown) {
              throw wrapResponseBodyReadError(error, response);
            }
          }

          let body: Buffer;
          try {
            body = await HTTPResponseBodyReader.read(responseData, {
              budget: httpResponseBodyBudget,
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
      };

      const axiosStartCallback: ivm.Callback<
        (method: string, url?: string, arg1?: string, arg2?: string) => string
      > = new ivm.Callback(
        (
          method: string,
          url?: string,
          arg1?: string,
          arg2?: string,
        ): string => {
          const operationId: string = String(++nextAxiosOperationId);

          if (!acceptingHostOperations) {
            return operationId;
          }

          if (pendingAxiosOperations.size >= 100) {
            pendingAxiosOperations.set(operationId, {
              status: "rejected",
              errorMessage: "Too many pending HTTP requests",
            });
            return operationId;
          }

          try {
            const urlBytes: number = Buffer.byteLength(url || "", "utf8");
            const arg1Bytes: number = Buffer.byteLength(arg1 || "", "utf8");
            const arg2Bytes: number = Buffer.byteLength(arg2 || "", "utf8");
            const hasBody: boolean = ["post", "put", "patch"].includes(method);

            if (urlBytes > MAX_HTTP_URL_BYTES) {
              throw new Error("HTTP request URL exceeded the allowed size.");
            }

            if (hasBody) {
              if (arg1Bytes > MAX_HTTP_REQUEST_BYTES) {
                throw new Error("HTTP request body exceeded the allowed size.");
              }
              if (arg2Bytes > MAX_HTTP_CONFIG_BYTES) {
                throw new Error(
                  "HTTP request config exceeded the allowed size.",
                );
              }
            } else if (method === "request") {
              if (arg1Bytes > MAX_HTTP_REQUEST_BYTES + MAX_HTTP_CONFIG_BYTES) {
                throw new Error("HTTP request data exceeded the allowed size.");
              }
            } else if (arg1Bytes > MAX_HTTP_CONFIG_BYTES) {
              throw new Error("HTTP request config exceeded the allowed size.");
            }

            const operationBytes: number = urlBytes + arg1Bytes + arg2Bytes;
            if (
              serializedHttpRequestBytes + operationBytes >
              MAX_HTTP_REQUEST_BYTES
            ) {
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
            serializedHttpRequestBytes += operationBytes;
          } catch (error: unknown) {
            pendingAxiosOperations.set(operationId, {
              status: "rejected",
              errorMessage: sanitizeScriptError(error).message,
            });
            return operationId;
          }

          pendingAxiosOperations.set(operationId, { status: "pending" });
          const abortController: AbortController = new AbortController();
          pendingAxiosControllers.add(abortController);
          void executeAxiosRequest(
            abortController.signal,
            method,
            url,
            arg1,
            arg2,
          )
            .then(
              (value: string) => {
                if (pendingAxiosOperations.has(operationId)) {
                  pendingAxiosOperations.set(operationId, {
                    status: "fulfilled",
                    value,
                  });
                }
              },
              (error: unknown) => {
                if (pendingAxiosOperations.has(operationId)) {
                  pendingAxiosOperations.set(operationId, {
                    status: "rejected",
                    errorMessage: sanitizeScriptError(error).message,
                  });
                }
              },
            )
            .finally(() => {
              pendingAxiosControllers.delete(abortController);
            });

          return operationId;
        },
        { async: true },
      );

      const axiosPollCallback: ivm.Callback<(operationId: string) => string> =
        new ivm.Callback(
          (operationId: string): string => {
            const operation: PendingAxiosOperation | undefined =
              pendingAxiosOperations.get(operationId);

            if (!operation) {
              return `E${JSON.stringify("HTTP request result is unavailable")}`;
            }

            if (operation.status === "pending") {
              return "P";
            }

            pendingAxiosOperations.delete(operationId);

            if (operation.status === "rejected") {
              return `E${JSON.stringify(operation.errorMessage)}`;
            }

            /*
             * The fulfilled value is already a bounded JSON envelope. Prefix
             * it instead of embedding it in another JSON document; otherwise
             * a response near the byte limit is copied and escaped a second
             * time while crossing into the isolate.
             */
            return `F${operation.value}`;
          },
          { async: true },
        );

      await jail.set("__oneuptimeHostAxiosStartCallback", axiosStartCallback);
      await jail.set("__oneuptimeHostAxiosPollCallback", axiosPollCallback);

      await context.eval(`
        (() => {
        const hostAxiosStart = globalThis.__oneuptimeHostAxiosStartCallback;
        const hostAxiosPoll = globalThis.__oneuptimeHostAxiosPollCallback;
        delete globalThis.__oneuptimeHostAxiosStartCallback;
        delete globalThis.__oneuptimeHostAxiosPollCallback;
        const axiosPollWaitArray = new Int32Array(new SharedArrayBuffer(4));
        let serializedRequestCharacters = 0;

        function assertSerializedRequestLength(method, url, arg1, arg2) {
          const urlCharacters = typeof url === 'string' ? url.length : 0;
          const arg1Characters = typeof arg1 === 'string' ? arg1.length : 0;
          const arg2Characters = typeof arg2 === 'string' ? arg2.length : 0;
          const hasBody = ['post', 'put', 'patch'].includes(method);

          if (urlCharacters > ${MAX_HTTP_URL_BYTES}) {
            throw new Error('HTTP request URL exceeded the allowed size.');
          }
          if (hasBody && arg1Characters > ${MAX_HTTP_REQUEST_BYTES}) {
            throw new Error('HTTP request body exceeded the allowed size.');
          }
          if (hasBody && arg2Characters > ${MAX_HTTP_CONFIG_BYTES}) {
            throw new Error('HTTP request config exceeded the allowed size.');
          }
          if (
            method === 'request' &&
            arg1Characters > ${MAX_HTTP_REQUEST_BYTES + MAX_HTTP_CONFIG_BYTES}
          ) {
            throw new Error('HTTP request data exceeded the allowed size.');
          }
          if (
            !hasBody &&
            method !== 'request' &&
            arg1Characters > ${MAX_HTTP_CONFIG_BYTES}
          ) {
            throw new Error('HTTP request config exceeded the allowed size.');
          }

          const operationCharacters =
            urlCharacters + arg1Characters + arg2Characters;
          if (
            serializedRequestCharacters + operationCharacters >
            ${MAX_HTTP_REQUEST_BYTES}
          ) {
            throw new Error(
              'Sandbox HTTP requests exceeded the allowed cumulative request size.'
            );
          }
          serializedRequestCharacters += operationCharacters;
        }

        async function hostAxios(method, url, arg1, arg2) {
          assertSerializedRequestLength(method, url, arg1, arg2);
          const operationId = await hostAxiosStart(method, url, arg1, arg2);

          while (true) {
            const operation = await hostAxiosPoll(operationId);

            if (operation === 'P') {
              Atomics.wait(axiosPollWaitArray, 0, 0, 1);
              continue;
            }

            if (operation[0] === 'E') {
              throw new Error(JSON.parse(operation.slice(1)));
            }

            if (operation[0] !== 'F') {
              throw new Error('HTTP request result is invalid');
            }

            return operation.slice(1);
          }
        }

        function assertNoFunctions(obj, path) {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
              const fullPath = path + '[' + i + ']';
              if (typeof obj[i] === 'function') {
                throw new Error(
                  'Functions are not supported in axios config because of security. ' +
                  'Found a function at "' + fullPath + '". Please remove it or replace it with a plain value.'
                );
              }
              if (obj[i] && typeof obj[i] === 'object') {
                assertNoFunctions(obj[i], fullPath);
              }
            }
            return;
          }
          for (const key of Object.keys(obj)) {
            const fullPath = path ? path + '.' + key : key;
            if (typeof obj[key] === 'function') {
              throw new Error(
                'Functions are not supported in axios config because of security. ' +
                'Found a function at "' + fullPath + '". Please remove it or replace it with a plain value.'
              );
            }
            if (obj[key] && typeof obj[key] === 'object') {
              assertNoFunctions(obj[key], fullPath);
            }
          }
        }

        const base64Alphabet =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const base64Lookup = new Int16Array(128);
        base64Lookup.fill(-1);
        for (let index = 0; index < base64Alphabet.length; index += 1) {
          base64Lookup[base64Alphabet.charCodeAt(index)] = index;
        }

        function decodeBase64(encoded) {
          const padding = encoded.endsWith('==')
            ? 2
            : encoded.endsWith('=')
              ? 1
              : 0;
          const decoded = new Uint8Array((encoded.length / 4) * 3 - padding);
          let outputIndex = 0;

          for (let index = 0; index < encoded.length; index += 4) {
            const first = base64Lookup[encoded.charCodeAt(index)];
            const second = base64Lookup[encoded.charCodeAt(index + 1)];
            const third = encoded[index + 2] === '='
              ? 0
              : base64Lookup[encoded.charCodeAt(index + 2)];
            const fourth = encoded[index + 3] === '='
              ? 0
              : base64Lookup[encoded.charCodeAt(index + 3)];
            const combined =
              (first << 18) | (second << 12) | (third << 6) | fourth;

            if (outputIndex < decoded.length) {
              decoded[outputIndex++] = (combined >> 16) & 0xff;
            }
            if (outputIndex < decoded.length) {
              decoded[outputIndex++] = (combined >> 8) & 0xff;
            }
            if (outputIndex < decoded.length) {
              decoded[outputIndex++] = combined & 0xff;
            }
          }

          return decoded;
        }

        function decodeUtf8(bytes) {
          const chunks = [];
          const codeUnits = new Uint16Array(8192);
          let codeUnitCount = 0;

          function flushCodeUnits() {
            if (codeUnitCount === 0) return;
            chunks.push(
              String.fromCharCode.apply(
                null,
                codeUnits.subarray(0, codeUnitCount)
              )
            );
            codeUnitCount = 0;
          }

          function appendCodePoint(codePoint) {
            if (codeUnitCount >= codeUnits.length - 1) {
              flushCodeUnits();
            }

            if (codePoint <= 0xffff) {
              codeUnits[codeUnitCount++] = codePoint;
            } else {
              const adjusted = codePoint - 0x10000;
              codeUnits[codeUnitCount++] = 0xd800 + (adjusted >> 10);
              codeUnits[codeUnitCount++] = 0xdc00 + (adjusted & 0x3ff);
            }
          }

          for (let index = 0; index < bytes.length;) {
            const first = bytes[index];
            let codePoint = 0xfffd;
            let width = 1;

            if (first <= 0x7f) {
              codePoint = first;
            } else if (
              first >= 0xc2 &&
              first <= 0xdf &&
              index + 1 < bytes.length &&
              (bytes[index + 1] & 0xc0) === 0x80
            ) {
              codePoint = ((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
              width = 2;
            } else if (
              first >= 0xe0 &&
              first <= 0xef &&
              index + 2 < bytes.length &&
              (bytes[index + 1] & 0xc0) === 0x80 &&
              (bytes[index + 2] & 0xc0) === 0x80 &&
              !(first === 0xe0 && bytes[index + 1] < 0xa0) &&
              !(first === 0xed && bytes[index + 1] >= 0xa0)
            ) {
              codePoint =
                ((first & 0x0f) << 12) |
                ((bytes[index + 1] & 0x3f) << 6) |
                (bytes[index + 2] & 0x3f);
              width = 3;
            } else if (
              first >= 0xf0 &&
              first <= 0xf4 &&
              index + 3 < bytes.length &&
              (bytes[index + 1] & 0xc0) === 0x80 &&
              (bytes[index + 2] & 0xc0) === 0x80 &&
              (bytes[index + 3] & 0xc0) === 0x80 &&
              !(first === 0xf0 && bytes[index + 1] < 0x90) &&
              !(first === 0xf4 && bytes[index + 1] >= 0x90)
            ) {
              codePoint =
                ((first & 0x07) << 18) |
                ((bytes[index + 1] & 0x3f) << 12) |
                ((bytes[index + 2] & 0x3f) << 6) |
                (bytes[index + 3] & 0x3f);
              width = 4;
            }

            appendCodePoint(codePoint);
            index += width;
          }

          flushCodeUnits();
          return chunks.join('');
        }

        function decodeSingleByte(bytes, asciiOnly) {
          const chunks = [];
          const codeUnits = new Uint16Array(8192);

          for (let offset = 0; offset < bytes.length; offset += 8192) {
            const chunkLength = Math.min(8192, bytes.length - offset);
            for (let index = 0; index < chunkLength; index += 1) {
              codeUnits[index] = asciiOnly
                ? bytes[offset + index] & 0x7f
                : bytes[offset + index];
            }
            chunks.push(
              String.fromCharCode.apply(
                null,
                codeUnits.subarray(0, chunkLength)
              )
            );
          }

          return chunks.join('');
        }

        function decodeUtf16Le(bytes) {
          const chunks = [];
          const codeUnits = new Uint16Array(8192);
          const codeUnitLength = Math.floor(bytes.length / 2);

          for (let offset = 0; offset < codeUnitLength; offset += 8192) {
            const chunkLength = Math.min(8192, codeUnitLength - offset);
            for (let index = 0; index < chunkLength; index += 1) {
              const byteOffset = (offset + index) * 2;
              codeUnits[index] =
                bytes[byteOffset] | (bytes[byteOffset + 1] << 8);
            }
            chunks.push(
              String.fromCharCode.apply(
                null,
                codeUnits.subarray(0, chunkLength)
              )
            );
          }

          return chunks.join('');
        }

        function encodeHex(bytes) {
          const alphabet = '0123456789abcdef';
          const chunks = [];

          for (let offset = 0; offset < bytes.length; offset += 4096) {
            const end = Math.min(offset + 4096, bytes.length);
            let chunk = '';
            for (let index = offset; index < end; index += 1) {
              const value = bytes[index];
              chunk += alphabet[value >> 4] + alphabet[value & 15];
            }
            chunks.push(chunk);
          }

          return chunks.join('');
        }

        function decodeResponseText(encoded, bytes, responseEncoding) {
          const normalizedEncoding = responseEncoding
            ? String(responseEncoding).toLowerCase()
            : 'utf8';

          switch (normalizedEncoding) {
            case 'utf8':
            case 'utf-8':
              return decodeUtf8(bytes);
            case 'latin1':
            case 'binary':
              return decodeSingleByte(bytes, false);
            case 'ascii':
              return decodeSingleByte(bytes, true);
            case 'utf16le':
            case 'utf-16le':
            case 'ucs2':
            case 'ucs-2':
              return decodeUtf16Le(bytes);
            case 'base64':
              return encoded;
            case 'base64url':
              return encoded
                .split('+').join('-')
                .split('/').join('_')
                .replace(/=+$/, '');
            case 'hex':
              return encodeHex(bytes);
            default:
              throw new TypeError(
                'Unknown encoding: ' + responseEncoding
              );
          }
        }

        function parseAxiosResult(r) {
          const metadataEnd = r.indexOf('\\n');
          if (metadataEnd < 0) {
            throw new Error('HTTP response envelope is invalid');
          }

          const parsed = JSON.parse(r.slice(0, metadataEnd));
          const dataEncoding = parsed.__oneuptimeDataEncoding;
          const responseEncoding = parsed.__oneuptimeResponseEncoding;
          const shouldParseJson = parsed.__oneuptimeShouldParseJson === true;
          const strictJsonParsing =
            parsed.__oneuptimeStrictJsonParsing === true;
          const responseConfig = parsed.__oneuptimeConfig || {};
          const hasRequest = parsed.__oneuptimeHasRequest === true;
          const isAxiosError = parsed.__isAxiosError === true;
          const errorMessage = parsed.message || 'Request failed';
          const errorCode = parsed.code;
          const errorName = parsed.name;
          const opaqueRequest = hasRequest
            ? Object.freeze({ __oneuptimeOpaqueRequest: true })
            : undefined;

          delete parsed.__oneuptimeDataEncoding;
          delete parsed.__oneuptimeResponseEncoding;
          delete parsed.__oneuptimeShouldParseJson;
          delete parsed.__oneuptimeStrictJsonParsing;
          delete parsed.__oneuptimeConfig;
          delete parsed.__oneuptimeHasRequest;
          delete parsed.__isAxiosError;
          delete parsed.message;
          delete parsed.code;
          delete parsed.name;

          parsed.config = responseConfig;
          if (opaqueRequest) parsed.request = opaqueRequest;

          function createAxiosError(message, code, name) {
            const err = new Error(message);
            err.name = name || 'AxiosError';
            err.code = code;
            err.config = responseConfig;
            err.request = opaqueRequest;
            err.response = parsed;
            err.isAxiosError = true;
            err.status = parsed.status;
            return err;
          }

          try {
            const encoded = r.slice(metadataEnd + 1);
            const decoded = decodeBase64(encoded);

            if (dataEncoding === 'base64-arraybuffer') {
              parsed.data = decoded;
            } else {
              let text = decodeResponseText(
                encoded,
                decoded,
                responseEncoding
              );

              if (
                (!responseEncoding || responseEncoding === 'utf8') &&
                text.charCodeAt(0) === 0xfeff
              ) {
                text = text.slice(1);
              }

              parsed.data = text;

              if (shouldParseJson && text) {
                try {
                  parsed.data = JSON.parse(text);
                } catch (error) {
                  if (strictJsonParsing) {
                    throw createAxiosError(
                      error.message,
                      'ERR_BAD_RESPONSE',
                      error.name
                    );
                  }
                }
              }
            }
          } catch (error) {
            if (error && error.isAxiosError) throw error;
            throw createAxiosError(
              error && error.message
                ? error.message
                : 'Response could not be decoded',
              error && error.code,
              error && error.name
            );
          }

          if (isAxiosError) {
            throw createAxiosError(errorMessage, errorCode, errorName);
          }

          return parsed;
        }

        function makeAxiosInstance(defaults) {
          function mergeConfig(overrides) {
            if (!defaults && !overrides) return undefined;
            if (!defaults) return overrides;
            if (!overrides) return Object.assign({}, defaults);
            const merged = Object.assign({}, defaults, overrides);
            if (defaults.headers && overrides.headers) {
              merged.headers = Object.assign({}, defaults.headers, overrides.headers);
            }
            if (defaults.transitional && overrides.transitional) {
              merged.transitional = Object.assign(
                {},
                defaults.transitional,
                overrides.transitional
              );
            }
            return merged;
          }

          async function _request(config) {
            const merged = mergeConfig(config);
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('request', '', merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          }

          // Make instance callable: axios(config) or axios(url, config)
          const instance = async function(urlOrConfig, config) {
            if (typeof urlOrConfig === 'object') {
              return _request(urlOrConfig);
            }
            return _request(Object.assign({}, config || {}, { url: urlOrConfig }));
          };

          instance.request = _request;
          instance.get = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('get', url, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.head = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('head', url, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.options = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('options', url, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.post = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) assertNoFunctions(data, 'data');
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('post', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.put = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) assertNoFunctions(data, 'data');
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('put', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.patch = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) assertNoFunctions(data, 'data');
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('patch', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.delete = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) assertNoFunctions(merged, 'config');
            const r = await hostAxios('delete', url, merged ? JSON.stringify(merged) : undefined);
            return parseAxiosResult(r);
          };
          instance.isAxiosError = (payload) => {
            return Boolean(payload && payload.isAxiosError === true);
          };
          instance.create = (instanceDefaults) => {
            if (instanceDefaults) assertNoFunctions(instanceDefaults, 'defaults');
            const combinedDefaults = mergeConfig(instanceDefaults);
            return makeAxiosInstance(combinedDefaults);
          };

          return instance;
        }

        Object.defineProperty(globalThis, 'axios', {
          value: makeAxiosInstance(null),
          writable: false,
          configurable: false,
        });
        })();
      `);

      // crypto (createHash, createHmac, randomBytes, randomUUID, randomInt)
      const cryptoCallback: ivm.Callback<
        (op: string, ...args: string[]) => string
      > = new ivm.Callback(
        (op: string, ...args: string[]): string => {
          switch (op) {
            case "createHash": {
              const [algorithm, inputData, encoding] = args;
              return crypto
                .createHash(algorithm!)
                .update(inputData!)
                .digest((encoding as crypto.BinaryToTextEncoding) || "hex");
            }
            case "createHmac": {
              const [algorithm, key, inputData, encoding] = args;
              return crypto
                .createHmac(algorithm!, key!)
                .update(inputData!)
                .digest((encoding as crypto.BinaryToTextEncoding) || "hex");
            }
            case "randomBytes": {
              const [size] = args;
              return crypto.randomBytes(parseInt(size!)).toString("hex");
            }
            case "randomUUID": {
              return crypto.randomUUID();
            }
            case "randomInt": {
              const [min, max] = args;
              return String(crypto.randomInt(parseInt(min!), parseInt(max!)));
            }
            default:
              throw new Error(`Unsupported crypto operation: ${op}`);
          }
        },
        { sync: true },
      );

      await jail.set("__oneuptimeHostCryptoCallback", cryptoCallback);

      await context.eval(`
        (() => {
        const hostCrypto = globalThis.__oneuptimeHostCryptoCallback;
        delete globalThis.__oneuptimeHostCryptoCallback;

        const sandboxCrypto = {
          createHash: (algorithm) => ({
            _alg: algorithm, _data: '',
            update(d) { this._data = d; return this; },
            digest(enc) { return hostCrypto('createHash', this._alg, this._data, enc || 'hex'); }
          }),
          createHmac: (algorithm, key) => ({
            _alg: algorithm, _key: key, _data: '',
            update(d) { this._data = d; return this; },
            digest(enc) { return hostCrypto('createHmac', this._alg, this._key, this._data, enc || 'hex'); }
          }),
          randomBytes: (size) => ({
            toString(enc) { return hostCrypto('randomBytes', String(size)); }
          }),
          randomUUID: () => {
            return hostCrypto('randomUUID');
          },
          randomInt: (minOrMax, max) => {
            if (max === undefined) { max = minOrMax; minOrMax = 0; }
            return Number(hostCrypto('randomInt', String(minOrMax), String(max)));
          },
        };

        Object.defineProperty(globalThis, 'crypto', {
          value: sandboxCrypto,
          writable: false,
          configurable: false,
        });
        })();
      `);

      // setTimeout / sleep - bridged through copied start/poll callbacks
      const sleepStartCallback: ivm.Callback<(ms: number) => string> =
        new ivm.Callback(
          (ms: number): string => {
            const operationId: string = String(++nextSleepOperationId);

            if (!acceptingHostOperations) {
              return operationId;
            }

            const numericDelay: number = Number(ms);
            const boundedDelay: number = Number.isFinite(numericDelay)
              ? Math.max(0, Math.min(numericDelay, timeout))
              : 0;
            const timeoutHandle: ReturnType<typeof global.setTimeout> =
              global.setTimeout(() => {
                const operation: PendingSleepOperation | undefined =
                  pendingSleepOperations.get(operationId);

                if (operation) {
                  operation.settled = true;
                }
                pendingHostTimeouts.delete(timeoutHandle);
              }, boundedDelay);

            pendingHostTimeouts.add(timeoutHandle);
            pendingSleepOperations.set(operationId, {
              settled: false,
            });

            return operationId;
          },
          { async: true },
        );

      const sleepPollCallback: ivm.Callback<(operationId: string) => boolean> =
        new ivm.Callback(
          (operationId: string): boolean => {
            const operation: PendingSleepOperation | undefined =
              pendingSleepOperations.get(operationId);

            if (!operation || operation.settled) {
              pendingSleepOperations.delete(operationId);
              return true;
            }

            return false;
          },
          { async: true },
        );

      await jail.set("__oneuptimeHostSleepStartCallback", sleepStartCallback);
      await jail.set("__oneuptimeHostSleepPollCallback", sleepPollCallback);

      await context.eval(`
        (() => {
          const hostSleepStart = globalThis.__oneuptimeHostSleepStartCallback;
          const hostSleepPoll = globalThis.__oneuptimeHostSleepPollCallback;
          delete globalThis.__oneuptimeHostSleepStartCallback;
          delete globalThis.__oneuptimeHostSleepPollCallback;
          const activeTimers = new WeakSet();
          const pollWaitArray = new Int32Array(new SharedArrayBuffer(4));

          async function hostSleep(ms) {
            const operationId = await hostSleepStart(ms || 0);

            while (!(await hostSleepPoll(operationId))) {
              // Pace polling on the isolate worker without blocking Node's
              // event loop.
              Atomics.wait(pollWaitArray, 0, 0, 1);
            }
          }

          function sandboxSetTimeout(fn, ms, ...args) {
            if (typeof fn !== 'function') {
              throw new TypeError('setTimeout callback must be a function');
            }

            const handle = {};
            activeTimers.add(handle);
            hostSleep(ms || 0).then(() => {
              if (activeTimers.delete(handle)) {
                fn(...args);
              }
            });
            return handle;
          }

          function sandboxClearTimeout(handle) {
            if (handle && typeof handle === 'object') {
              activeTimers.delete(handle);
            }
          }

          async function sandboxSleep(ms) {
            await hostSleep(ms || 0);
          }

          Object.defineProperties(globalThis, {
            setTimeout: {
              value: sandboxSetTimeout,
              writable: false,
              configurable: false,
            },
            clearTimeout: {
              value: sandboxClearTimeout,
              writable: false,
              configurable: false,
            },
            sleep: {
              value: sandboxSleep,
              writable: false,
              configurable: false,
            },
          });
        })();
      `);

      /*
       * Wrap user code in async IIFE. JSON.stringify the return value inside
       * the isolate so only a plain string crosses the boundary — this avoids
       * "A non-transferable value was passed" errors when user code returns
       * objects containing functions, class instances, or other non-cloneable types.
       */
      const wrappedCode: string = `(async () => {
        const __result = await (async () => {
          ${code}
        })();
        try { return JSON.stringify(__result); }
        catch(_) { return undefined; }
      })()`;

      let result: unknown;
      let scriptError: Error | undefined;

      /*
       * Keep Node's event loop turning for as long as sandboxed code is
       * running.
       *
       * Every host bridge the sandbox has - axios, sleep, the log sink - is an
       * isolated-vm async callback: the isolate posts a call onto THIS thread,
       * this thread answers it, and the isolate resumes. Each of those hops
       * only makes progress when the event loop takes a turn, and a loop with
       * nothing else to do parks until its next TIMER rather than spinning. On
       * an otherwise idle process the nearest timer is usually the overall
       * timeout armed just below, so a single `await sleep(0)` - or a request
       * the SSRF guard refuses synchronously, in microseconds - came back
       * 20 seconds later as "Script execution timed out". Under Jest the
       * nearest timer was whatever the runner happened to have queued, which
       * is why the same test took 100ms on one run and 900ms on the next, and
       * why the VMRunner suites failed on CI while passing locally.
       *
       * A no-op ticker gives the loop a reason to wake. It runs only while a
       * script is in flight and is cleared before this method returns.
       */
      const hostBridgeTicker: ReturnType<typeof global.setInterval> =
        global.setInterval((): void => {
          /*
           * Intentionally empty: existing only so libuv wakes on a known
           * cadence instead of sleeping until some unrelated timer.
           */
        }, HOST_BRIDGE_TICK_MS);

      try {
        // Run with overall timeout covering both CPU and I/O wait.
        const resultPromise: Promise<unknown> = context.eval(wrappedCode, {
          promise: true,
          timeout: timeout,
        });

        const overallTimeout: Promise<never> = new Promise(
          (
            _resolve: (value: never) => void,
            reject: (reason: Error) => void,
          ) => {
            const timeoutHandle: ReturnType<typeof global.setTimeout> =
              global.setTimeout(() => {
                pendingHostTimeouts.delete(timeoutHandle);
                reject(new Error("Script execution timed out"));
              }, timeout + 5000); // 5s grace period beyond isolate timeout

            pendingHostTimeouts.add(timeoutHandle);
          },
        );

        result = await Promise.race([resultPromise, overallTimeout]);
      } catch (error: unknown) {
        scriptError = sanitizeScriptError(error);
      } finally {
        global.clearInterval(hostBridgeTicker);
      }

      // Parse the JSON string returned from inside the isolate
      let returnValue: unknown;

      if (typeof result === "string") {
        try {
          returnValue = JSON.parse(result);
        } catch {
          returnValue = result;
        }
      } else {
        returnValue = result;
      }

      return {
        returnValue,
        logMessages,
        capturedMetrics,
        scriptError,
      };
    } finally {
      acceptingHostOperations = false;

      for (const timeoutHandle of pendingHostTimeouts) {
        global.clearTimeout(timeoutHandle);
      }
      for (const abortController of pendingAxiosControllers) {
        abortController.abort();
      }
      pendingHostTimeouts.clear();
      pendingAxiosControllers.clear();
      pendingSleepOperations.clear();
      pendingAxiosOperations.clear();

      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  }
}
