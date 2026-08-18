import CapturedMetric from "../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../Types/JSON";
import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import ivm from "isolated-vm";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SSRFProtection from "../SSRFProtection";

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
    url: string;
    config?: JSONObject | undefined;
  }): string {
    const baseUrl: string =
      typeof data.config?.["baseURL"] === "string"
        ? (data.config["baseURL"] as string)
        : "";

    let target: string = data.url || "";

    if (data.method === "request" || !target) {
      const configUrl: unknown = data.config?.["url"];
      target = typeof configUrl === "string" ? configUrl : target;
    }

    let absolute: string = target;

    const absoluteUrlRegex: RegExp = /^https?:\/\//i;

    if (!absoluteUrlRegex.test(absolute)) {
      if (!baseUrl) {
        throw new Error("Request URL must be an absolute http or https URL.");
      }
      absolute = `${baseUrl.replace(/\/+$/, "")}/${absolute.replace(/^\/+/, "")}`;
    }

    if (!absoluteUrlRegex.test(absolute)) {
      throw new Error("Request URL must be an absolute http or https URL.");
    }

    return absolute;
  }

  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
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
    let logBytes: number = 0;

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
        url: string,
        arg1?: string,
        arg2?: string,
      ) => Promise<string> = async (
        signal: AbortSignal,
        method: string,
        url: string,
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

        // Reconstruct real http/https Agents from serialized markers
        if (config) {
          const httpsAgentConfig: JSONObject | undefined = config[
            "httpsAgent"
          ] as JSONObject | undefined;

          if (
            httpsAgentConfig &&
            httpsAgentConfig["__agentType"] === "__https_agent__"
          ) {
            config["httpsAgent"] = new https.Agent(
              httpsAgentConfig["options"] as https.AgentOptions,
            ) as unknown as JSONObject;
          }

          const httpAgentConfig: JSONObject | undefined = config[
            "httpAgent"
          ] as JSONObject | undefined;

          if (
            httpAgentConfig &&
            httpAgentConfig["__agentType"] === "__http_agent__"
          ) {
            config["httpAgent"] = new http.Agent(
              httpAgentConfig["options"] as http.AgentOptions,
            ) as unknown as JSONObject;
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

        await SSRFProtection.validateWebhookTargetIsSafe(effectiveUrl);

        /*
         * The URL that was just validated has to be the URL that gets
         * dialled. Each of these would otherwise steer the connection
         * somewhere else entirely, past the check above:
         *   proxy      - sends the request to an arbitrary host:port
         *   socketPath - connects to a unix socket (/var/run/docker.sock)
         *   transport / adapter - replaces the transport wholesale
         * and a redirect would let a validated public host nominate an
         * internal one on the second hop.
         */
        const safeConfig: JSONObject = config || {};
        delete safeConfig["proxy"];
        delete safeConfig["socketPath"];
        delete safeConfig["transport"];
        delete safeConfig["adapter"];
        safeConfig["maxRedirects"] = 0;
        Object.defineProperty(safeConfig, "signal", {
          value: signal,
          enumerable: true,
          configurable: true,
        });
        config = safeConfig;

        try {
          let response: AxiosResponse;

          switch (method) {
            case "get":
              response = await axios.get(url, config);
              break;
            case "head":
              response = await axios.head(url, config);
              break;
            case "options":
              response = await axios.options(url, config);
              break;
            case "post":
              response = await axios.post(url, body, config);
              break;
            case "put":
              response = await axios.put(url, body, config);
              break;
            case "patch":
              response = await axios.patch(url, body, config);
              break;
            case "delete":
              response = await axios.delete(url, config);
              break;
            case "request":
              response = await axios.request(
                config as Parameters<typeof axios.request>[0],
              );
              break;
            default:
              throw new Error(`Unsupported HTTP method: ${method}`);
          }

          /*
           * Convert AxiosHeaders to a plain object before serializing.
           * JSON.stringify calls AxiosHeaders.toJSON(key) with a truthy key,
           * which makes it join array headers (like set-cookie) with commas.
           * This produces invalid Cookie headers when user code forwards them.
           */
          return JSON.stringify({
            status: response.status,
            headers: toPlainHeaders(response.headers),
            data: response.data,
          });
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
          } = err as {
            isAxiosError?: boolean;
            response?: AxiosResponse;
            message?: string;
          };

          if (axiosErr.isAxiosError && axiosErr.response) {
            return JSON.stringify({
              __isAxiosError: true,
              message: axiosErr.message || "Request failed",
              status: axiosErr.response.status,
              statusText: axiosErr.response.statusText,
              headers: toPlainHeaders(axiosErr.response.headers),
              data: axiosErr.response.data,
            });
          }

          throw err;
        }
      };

      const axiosStartCallback: ivm.Callback<
        (method: string, url: string, arg1?: string, arg2?: string) => string
      > = new ivm.Callback(
        (method: string, url: string, arg1?: string, arg2?: string): string => {
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
              return JSON.stringify({
                status: "rejected",
                errorMessage: "HTTP request result is unavailable",
              });
            }

            if (operation.status !== "pending") {
              pendingAxiosOperations.delete(operationId);
            }

            return JSON.stringify(operation);
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

        async function hostAxios(method, url, arg1, arg2) {
          const operationId = await hostAxiosStart(method, url, arg1, arg2);

          while (true) {
            const operation = JSON.parse(await hostAxiosPoll(operationId));

            if (operation.status === 'pending') {
              Atomics.wait(axiosPollWaitArray, 0, 0, 1);
              continue;
            }

            if (operation.status === 'rejected') {
              throw new Error(operation.errorMessage);
            }

            return operation.value;
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

        function parseAxiosResult(r) {
          const parsed = JSON.parse(r);
          if (parsed && parsed.__isAxiosError) {
            const err = new Error(parsed.message);
            err.response = {
              status: parsed.status,
              statusText: parsed.statusText,
              headers: parsed.headers,
              data: parsed.data,
            };
            err.isAxiosError = true;
            err.status = parsed.status;
            throw err;
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
