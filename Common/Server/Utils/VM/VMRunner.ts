import CapturedMetric from "../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import ivm from "isolated-vm";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Dictionary from "../../../Types/Dictionary";
import GenericObject from "../../../Types/GenericObject";
import vm, { Context } from "vm";

/**
 * Symbol used to retrieve the real (unwrapped) target from a sandbox proxy.
 * Hidden from user code via ownKeys / has traps.
 */
const PROXY_TARGET_SYMBOL: unique symbol = Symbol("sandboxProxyTarget");

/** Properties blocked on every host-realm object exposed to the sandbox. */
const BLOCKED_SANDBOX_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "mainModule",
  /*
   * Block Playwright methods that can spawn processes or access internals.
   * Prevents RCE via browser.browserType().launch({executablePath:"/bin/sh"})
   * and traversal via page.context().browser().browserType().launch(...)
   */
  "browserType", // Browser → BrowserType (which has launch/connect)
  "_browserType", // Internal alias for browserType — same escape vector
  "launch", // BrowserType.launch() spawns a child process
  "launchServer", // BrowserType.launchServer() spawns a browser server process
  "launchPersistentContext", // BrowserType.launchPersistentContext() spawns a child process
  "connectOverCDP", // BrowserType.connectOverCDP() connects via Chrome DevTools Protocol
  "connect", // BrowserType.connect() connects to a remote browser
  "newCDPSession", // BrowserContext/Page.newCDPSession() opens raw CDP sessions
]);

/**
 * Wraps a host-realm value in a Proxy that blocks prototype-chain traversal.
 * Primitives and null/undefined pass through unchanged.
 * Object proxies are cached to preserve identity; function proxies are created
 * per-access so they bind to the correct `this` (parent object).
 */
function createSandboxProxy(
  value: unknown,
  cache: WeakMap<GenericObject, unknown>,
  parentObj?: GenericObject,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const valueType: string = typeof value;

  if (valueType !== "object" && valueType !== "function") {
    return value;
  }

  const target: GenericObject = value as GenericObject;

  if (valueType === "function") {
    /*
     * Function proxies are NOT cached because the same function may be a method
     * on different parent objects and needs a different `this` binding each time.
     */
    const fnProxy: unknown = new Proxy(
      target as (...args: unknown[]) => unknown,
      {
        get(
          fnTarget: (...args: unknown[]) => unknown,
          prop: string | symbol,
        ): unknown {
          if (prop === PROXY_TARGET_SYMBOL) {
            return fnTarget;
          }
          if (
            typeof prop === "string" &&
            BLOCKED_SANDBOX_PROPERTIES.has(prop)
          ) {
            return undefined;
          }
          const val: unknown = Reflect.get(
            fnTarget,
            prop,
            fnTarget as GenericObject,
          );
          return createSandboxProxy(val, cache, fnTarget as GenericObject);
        },
        getPrototypeOf(): null {
          return null;
        },
        apply(
          fnTarget: (...args: unknown[]) => unknown,
          _thisArg: unknown,
          args: unknown[],
        ): unknown {
          const thisObj: GenericObject = (parentObj ||
            fnTarget) as GenericObject;
          try {
            const result: unknown = Reflect.apply(fnTarget, thisObj, args);
            if (result instanceof Promise) {
              return result.then(
                (v: unknown) => {
                  return createSandboxProxy(v, cache);
                },
                (err: unknown) => {
                  throw createSandboxProxy(err, cache);
                },
              );
            }
            return createSandboxProxy(result, cache);
          } catch (err: unknown) {
            throw createSandboxProxy(err, cache);
          }
        },
        has(
          fnTarget: (...args: unknown[]) => unknown,
          prop: string | symbol,
        ): boolean {
          if (
            typeof prop === "string" &&
            BLOCKED_SANDBOX_PROPERTIES.has(prop)
          ) {
            return false;
          }
          return Reflect.has(fnTarget, prop);
        },
        ownKeys(
          fnTarget: (...args: unknown[]) => unknown,
        ): (string | symbol)[] {
          return Reflect.ownKeys(fnTarget).filter((k: string | symbol) => {
            return !(
              typeof k === "string" && BLOCKED_SANDBOX_PROPERTIES.has(k)
            );
          });
        },
        getOwnPropertyDescriptor(
          fnTarget: (...args: unknown[]) => unknown,
          prop: string | symbol,
        ): PropertyDescriptor | undefined {
          if (
            typeof prop === "string" &&
            BLOCKED_SANDBOX_PROPERTIES.has(prop)
          ) {
            return undefined;
          }
          const desc: PropertyDescriptor | undefined =
            Reflect.getOwnPropertyDescriptor(fnTarget, prop);
          if (desc && "value" in desc) {
            desc.value = createSandboxProxy(
              desc.value,
              cache,
              fnTarget as GenericObject,
            );
          }
          return desc;
        },
      },
    );
    return fnProxy;
  }

  // Object — use cache to preserve identity and handle circular references
  if (cache.has(target)) {
    return cache.get(target);
  }

  const objProxy: GenericObject = new Proxy(target, {
    get(objTarget: GenericObject, prop: string | symbol): unknown {
      if (prop === PROXY_TARGET_SYMBOL) {
        return objTarget;
      }
      if (typeof prop === "string" && BLOCKED_SANDBOX_PROPERTIES.has(prop)) {
        return undefined;
      }
      const val: unknown = Reflect.get(objTarget, prop, objTarget);
      return createSandboxProxy(val, cache, objTarget);
    },
    getPrototypeOf(): null {
      return null;
    },
    set(
      objTarget: GenericObject,
      prop: string | symbol,
      newValue: unknown,
    ): boolean {
      return Reflect.set(objTarget, prop, newValue);
    },
    has(objTarget: GenericObject, prop: string | symbol): boolean {
      if (typeof prop === "string" && BLOCKED_SANDBOX_PROPERTIES.has(prop)) {
        return false;
      }
      return Reflect.has(objTarget, prop);
    },
    ownKeys(objTarget: GenericObject): (string | symbol)[] {
      return Reflect.ownKeys(objTarget).filter((k: string | symbol) => {
        return !(typeof k === "string" && BLOCKED_SANDBOX_PROPERTIES.has(k));
      });
    },
    getOwnPropertyDescriptor(
      objTarget: GenericObject,
      prop: string | symbol,
    ): PropertyDescriptor | undefined {
      if (typeof prop === "string" && BLOCKED_SANDBOX_PROPERTIES.has(prop)) {
        return undefined;
      }
      const desc: PropertyDescriptor | undefined =
        Reflect.getOwnPropertyDescriptor(objTarget, prop);
      if (desc && "value" in desc) {
        desc.value = createSandboxProxy(desc.value, cache, objTarget);
      }
      return desc;
    },
  });

  cache.set(target, objProxy);
  return objProxy;
}

/**
 * Recursively unwraps sandbox proxies in a return value so the host code
 * receives original objects (e.g. Buffers that pass `instanceof` checks).
 */
export function deepUnwrapProxies(
  value: unknown,
  visited?: WeakSet<GenericObject>,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const valueType: string = typeof value;

  if (valueType !== "object" && valueType !== "function") {
    return value;
  }

  const obj: Record<string | symbol, unknown> = value as Record<
    string | symbol,
    unknown
  >;

  // If it's one of our proxies, unwrap to the original target
  try {
    const underlying: unknown = obj[PROXY_TARGET_SYMBOL];
    if (underlying !== undefined) {
      return underlying;
    }
  } catch {
    // Not a proxy or symbol access failed — treat as a plain value
  }

  if (!visited) {
    visited = new WeakSet<GenericObject>();
  }

  if (visited.has(obj as GenericObject)) {
    return obj;
  }

  visited.add(obj as GenericObject);

  if (Array.isArray(obj)) {
    for (let i: number = 0; i < obj.length; i++) {
      (obj as unknown[])[i] = deepUnwrapProxies((obj as unknown[])[i], visited);
    }
  } else if (valueType === "object") {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      (obj as Record<string, unknown>)[key] = deepUnwrapProxies(
        (obj as Record<string, unknown>)[key],
        visited,
      );
    }
  }

  return obj;
}

/**
 * Unwraps a single value if it is a sandbox proxy, otherwise returns it as-is.
 */
function unwrapProxy<T>(value: T): T {
  if (value && typeof value === "object") {
    const underlying: unknown = (value as Record<symbol, unknown>)[
      PROXY_TARGET_SYMBOL
    ];
    if (underlying !== undefined) {
      return underlying as T;
    }
  }
  return value;
}

export default class VMRunner {
  @CaptureSpan()
  public static async runCodeInNodeVM(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
      context?: Dictionary<GenericObject | string> | undefined;
    };
  }): Promise<ReturnResult> {
    const { code, options } = data;
    const timeout: number = options.timeout || 5000;

    const logMessages: string[] = [];
    const MAX_LOG_BYTES: number = 1_000_000; // 1MB cap
    let totalLogBytes: number = 0;

    const capturedMetrics: CapturedMetric[] = [];
    const MAX_METRICS: number = 100;

    // Track timer handles so we can clean them up after execution
    type TimerHandle = ReturnType<typeof setTimeout>;
    const pendingTimeouts: TimerHandle[] = [];
    const pendingIntervals: TimerHandle[] = [];

    const wrappedSetTimeout: (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => TimerHandle = (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ): TimerHandle => {
      const handle: TimerHandle = setTimeout(fn, ms, ...rest);
      pendingTimeouts.push(handle);
      return handle;
    };

    const wrappedClearTimeout: (handle: TimerHandle) => void = (
      handle: TimerHandle,
    ): void => {
      const actual: TimerHandle = unwrapProxy(handle);
      clearTimeout(actual);
      const idx: number = pendingTimeouts.indexOf(actual);
      if (idx !== -1) {
        pendingTimeouts.splice(idx, 1);
      }
    };

    const wrappedSetInterval: (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => TimerHandle = (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ): TimerHandle => {
      const handle: TimerHandle = setInterval(fn, ms, ...rest);
      pendingIntervals.push(handle);
      return handle;
    };

    const wrappedClearInterval: (handle: TimerHandle) => void = (
      handle: TimerHandle,
    ): void => {
      const actual: TimerHandle = unwrapProxy(handle);
      clearInterval(actual);
      const idx: number = pendingIntervals.indexOf(actual);
      if (idx !== -1) {
        pendingIntervals.splice(idx, 1);
      }
    };

    // Proxy cache shared across all wrapped host objects in this execution
    const proxyCache: WeakMap<GenericObject, unknown> = new WeakMap();

    // Use null-prototype object to break this.constructor chain on the global
    const sandbox: Context = Object.create(null) as Context;
    sandbox["process"] = Object.freeze(Object.create(null));
    sandbox["console"] = createSandboxProxy(
      {
        log: (...args: JSONValue[]) => {
          const msg: string = args.join(" ");
          totalLogBytes += msg.length;
          if (totalLogBytes <= MAX_LOG_BYTES) {
            logMessages.push(msg);
          }
        },
      },
      proxyCache,
    );
    sandbox["http"] = createSandboxProxy(http, proxyCache);
    sandbox["https"] = createSandboxProxy(https, proxyCache);
    sandbox["axios"] = createSandboxProxy(axios, proxyCache);
    sandbox["crypto"] = createSandboxProxy(crypto, proxyCache);
    sandbox["setTimeout"] = createSandboxProxy(wrappedSetTimeout, proxyCache);
    sandbox["clearTimeout"] = createSandboxProxy(
      wrappedClearTimeout,
      proxyCache,
    );
    sandbox["setInterval"] = createSandboxProxy(wrappedSetInterval, proxyCache);
    sandbox["clearInterval"] = createSandboxProxy(
      wrappedClearInterval,
      proxyCache,
    );

    sandbox["oneuptime"] = createSandboxProxy(
      {
        captureMetric: (
          name: unknown,
          value: unknown,
          attributes?: unknown,
        ): void => {
          if (typeof name !== "string" || name.length === 0) {
            return;
          }
          if (typeof value !== "number" || isNaN(value)) {
            return;
          }
          if (capturedMetrics.length >= MAX_METRICS) {
            return;
          }
          const metric: CapturedMetric = {
            name: name.substring(0, 200),
            value: value,
          };
          if (attributes && typeof attributes === "object") {
            const safeAttrs: JSONObject = {};
            for (const [k, v] of Object.entries(
              attributes as Record<string, unknown>,
            )) {
              if (
                typeof v === "string" ||
                typeof v === "number" ||
                typeof v === "boolean"
              ) {
                safeAttrs[k] = String(v);
              }
            }
            metric.attributes = safeAttrs;
          }
          capturedMetrics.push(metric);
        },
      },
      proxyCache,
    );

    // Wrap any additional context (e.g. Playwright browser/page objects)
    if (options.context) {
      for (const key of Object.keys(options.context)) {
        const val: GenericObject | string | undefined = options.context[key];
        sandbox[key] =
          typeof val === "string" ? val : createSandboxProxy(val, proxyCache);
      }
    }

    if (options.args) {
      // args is plain JSON data — no host functions to protect against
      sandbox["args"] = options.args;
    }

    vm.createContext(sandbox, {
      codeGeneration: {
        strings: false,
        wasm: false,
      },
    });

    const script: string = `(async()=>{
        ${code}
      })()`;

    try {
      let returnVal: unknown;
      let scriptError: Error | undefined;

      try {
        /*
         * vm timeout only covers synchronous CPU time, so wrap with
         * Promise.race to also cover async operations (network, timers, etc.)
         */
        const vmPromise: Promise<unknown> = vm.runInContext(script, sandbox, {
          timeout: timeout,
        });

        const overallTimeout: Promise<never> = new Promise(
          (
            _resolve: (value: never) => void,
            reject: (reason: Error) => void,
          ) => {
            const handle: NodeJS.Timeout = global.setTimeout(() => {
              reject(new Error("Script execution timed out"));
            }, timeout + 5000);
            // Don't let this timer keep the process alive
            handle.unref();
          },
        );

        returnVal = await Promise.race([vmPromise, overallTimeout]);
      } catch (err: unknown) {
        /*
         * Capture user-thrown errors (including timeouts) so the caller can
         * still access side-channel data collected before the throw — e.g.
         * screenshots assigned to a host-realm object passed via `context`.
         * Rethrowing here would discard those partial results.
         */
        scriptError =
          err instanceof Error
            ? err
            : new Error(typeof err === "string" ? err : String(err));
      }

      return {
        returnValue: deepUnwrapProxies(returnVal),
        logMessages,
        capturedMetrics,
        scriptError,
      };
    } finally {
      // Clean up any lingering timers to prevent resource leaks
      for (const handle of pendingTimeouts) {
        clearTimeout(handle);
      }
      for (const handle of pendingIntervals) {
        clearInterval(handle);
      }
    }
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

    const isolate: ivm.Isolate = new ivm.Isolate({ memoryLimit: 128 });

    try {
      const context: ivm.Context = await isolate.createContext();
      const jail: ivm.Reference<Record<string, unknown>> = context.global;

      // Set up global object
      await jail.set("global", jail.derefInto());

      // console.log - fire-and-forget callback
      await jail.set(
        "_log",
        new ivm.Callback((...args: string[]) => {
          logMessages.push(args.join(" "));
        }),
      );

      await context.eval(`
        const console = { log: (...a) => _log(...a.map(v => {
          try { return typeof v === 'object' ? JSON.stringify(v) : String(v); }
          catch(_) { return String(v); }
        }))};
      `);

      // oneuptime.captureMetric - fire-and-forget callback
      await jail.set(
        "_captureMetric",
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
        ),
      );

      await context.eval(`
        const oneuptime = {
          captureMetric: (name, value, attributes) => {
            if (typeof name !== 'string' || name.length === 0) return;
            if (typeof value !== 'number' || isNaN(value)) return;
            const attrJson = attributes ? JSON.stringify(attributes) : undefined;
            _captureMetric(String(name), String(value), attrJson);
          }
        };
      `);

      // args - deep copy into isolate
      if (options.args) {
        await jail.set("_args", new ivm.ExternalCopy(options.args).copyInto());
        await context.eval("const args = _args;");
      } else {
        await context.eval("const args = {};");
      }

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
       * bridged via applySyncPromise.
       *
       * For GET/HEAD/OPTIONS/DELETE: args = [method, url, configJson?]
       * For POST/PUT/PATCH:         args = [method, url, bodyJson?, configJson?]
       * For REQUEST:                args = ['request', '', configJson]
       */
      const axiosRef: ivm.Reference<
        (
          method: string,
          url: string,
          arg1?: string,
          arg2?: string,
        ) => Promise<string>
      > = new ivm.Reference(
        async (
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
          const config: JSONObject | undefined = configStr
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
          const toPlainHeaders: (
            headers: unknown,
          ) => Record<string, unknown> = (
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
        },
      );

      await jail.set("_axiosRef", axiosRef);

      await context.eval(`
        function _assertNoFunctions(obj, path) {
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
                _assertNoFunctions(obj[i], fullPath);
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
              _assertNoFunctions(obj[key], fullPath);
            }
          }
        }

        function _parseAxiosResult(r) {
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

        function _makeAxiosInstance(defaults) {
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
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['request', '', merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
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
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['get', url, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.head = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['head', url, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.options = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['options', url, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.post = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) _assertNoFunctions(data, 'data');
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['post', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.put = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) _assertNoFunctions(data, 'data');
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['put', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.patch = async (url, data, config) => {
            const merged = mergeConfig(config);
            if (data) _assertNoFunctions(data, 'data');
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['patch', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.delete = async (url, config) => {
            const merged = mergeConfig(config);
            if (merged) _assertNoFunctions(merged, 'config');
            const r = await _axiosRef.applySyncPromise(undefined, ['delete', url, merged ? JSON.stringify(merged) : undefined]);
            return _parseAxiosResult(r);
          };
          instance.create = (instanceDefaults) => {
            if (instanceDefaults) _assertNoFunctions(instanceDefaults, 'defaults');
            const combinedDefaults = mergeConfig(instanceDefaults);
            return _makeAxiosInstance(combinedDefaults);
          };

          return instance;
        }

        const axios = _makeAxiosInstance(null);
      `);

      // crypto (createHash, createHmac, randomBytes, randomUUID, randomInt) - bridged via applySync
      const cryptoRef: ivm.Reference<
        (op: string, ...args: string[]) => string
      > = new ivm.Reference((op: string, ...args: string[]): string => {
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
      });

      await jail.set("_cryptoRef", cryptoRef);

      await context.eval(`
        const crypto = {
          createHash: (algorithm) => ({
            _alg: algorithm, _data: '',
            update(d) { this._data = d; return this; },
            digest(enc) { return _cryptoRef.applySync(undefined, ['createHash', this._alg, this._data, enc || 'hex']); }
          }),
          createHmac: (algorithm, key) => ({
            _alg: algorithm, _key: key, _data: '',
            update(d) { this._data = d; return this; },
            digest(enc) { return _cryptoRef.applySync(undefined, ['createHmac', this._alg, this._key, this._data, enc || 'hex']); }
          }),
          randomBytes: (size) => ({
            toString(enc) { return _cryptoRef.applySync(undefined, ['randomBytes', String(size)]); }
          }),
          randomUUID: () => {
            return _cryptoRef.applySync(undefined, ['randomUUID']);
          },
          randomInt: (minOrMax, max) => {
            if (max === undefined) { max = minOrMax; minOrMax = 0; }
            return Number(_cryptoRef.applySync(undefined, ['randomInt', String(minOrMax), String(max)]));
          },
        };
      `);

      // setTimeout / sleep - bridged via applySyncPromise
      const sleepRef: ivm.Reference<(ms: number) => Promise<void>> =
        new ivm.Reference((ms: number): Promise<void> => {
          return new Promise((resolve: () => void) => {
            global.setTimeout(resolve, Math.min(ms, timeout));
          });
        });

      await jail.set("_sleepRef", sleepRef);

      await context.eval(`
        function setTimeout(fn, ms) {
          _sleepRef.applySyncPromise(undefined, [ms || 0]);
          if (typeof fn === 'function') fn();
        }
        async function sleep(ms) {
          await _sleepRef.applySyncPromise(undefined, [ms || 0]);
        }
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

      // Run with overall timeout covering both CPU and I/O wait
      const resultPromise: Promise<unknown> = context.eval(wrappedCode, {
        promise: true,
        timeout: timeout,
      });

      const overallTimeout: Promise<never> = new Promise(
        (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
          global.setTimeout(() => {
            reject(new Error("Script execution timed out"));
          }, timeout + 5000); // 5s grace period beyond isolate timeout
        },
      );

      const result: unknown = await Promise.race([
        resultPromise,
        overallTimeout,
      ]);

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
      };
    } finally {
      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  }
}
