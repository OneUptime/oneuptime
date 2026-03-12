import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../Types/JSON";
import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import ivm from "isolated-vm";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Dictionary from "../../../Types/Dictionary";

const MAX_LOG_BYTES: number = 1_000_000;

const BLOCKED_PLAYWRIGHT_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "mainModule",
  "process",
  "require",
  "module",
  "global",
  "globalThis",
  "browser",
  "browserType",
  "launch",
  "launchPersistentContext",
  "connectOverCDP",
  "newCDPSession",
]);

const BRIDGE_MARKER_KEY: string = "__oneuptimeBridgeType";
const BRIDGE_REF_TYPE: string = "ref";
const BRIDGE_CALLABLE_REF_TYPE: string = "callable-ref";
const BRIDGE_PROMISE_TYPE: string = "promise";
const BRIDGE_BUFFER_TYPE: string = "buffer";

interface SerializedBridgeError {
  message: string;
  stack?: string | undefined;
}

interface SerializedBridgeEnvelope {
  ok: boolean;
  value?: unknown;
  error?: SerializedBridgeError | undefined;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> | Record<string, never> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype: object | null = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as PromiseLike<unknown>).then === "function",
  );
}

function isCopyableToIsolate(value: unknown): boolean {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item: unknown) => {
      return isCopyableToIsolate(item);
    });
  }

  if (!isPlainObject(value)) {
    return false;
  }

  for (const key of Object.keys(value)) {
    if (!isCopyableToIsolate((value as Record<string, unknown>)[key])) {
      return false;
    }
  }

  return true;
}

function serializeError(error: unknown): SerializedBridgeError {
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown sandbox error",
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : String(error),
  };
}

function reviveBufferMarkers(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => {
      return reviveBufferMarkers(item);
    });
  }

  if (typeof value !== "object") {
    return value;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (record[BRIDGE_MARKER_KEY] === BRIDGE_BUFFER_TYPE) {
    return Buffer.from(String(record["base64"] || ""), "base64");
  }

  const revived: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    revived[key] = reviveBufferMarkers(record[key]);
  }

  return revived;
}

function buildWrappedUserCode(code: string): string {
  return `(async () => {
    const __result = await (async () => {
      ${code}
    })();
    try { return JSON.stringify(__result); }
    catch(_) { return undefined; }
  })()`;
}

async function executeWrappedUserCode(data: {
  context: ivm.Context;
  timeout: number;
  code: string;
  reviveBridgeBuffers?: boolean | undefined;
}): Promise<unknown> {
  const wrappedCode: string = buildWrappedUserCode(data.code);

  const resultPromise: Promise<unknown> = data.context.eval(wrappedCode, {
    promise: true,
    timeout: data.timeout,
  });

  const overallTimeout: Promise<never> = new Promise(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      global.setTimeout(() => {
        reject(new Error("Script execution timed out"));
      }, data.timeout + 5000);
    },
  );

  const result: unknown = await Promise.race([resultPromise, overallTimeout]);

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

  if (data.reviveBridgeBuffers) {
    return reviveBufferMarkers(returnValue);
  }

  return returnValue;
}

async function createBaseSandbox(data: {
  timeout: number;
  args?: JSONObject | undefined;
  logMessages: string[];
}): Promise<{
  isolate: ivm.Isolate;
  context: ivm.Context;
  jail: ivm.Reference<Record<string, unknown>>;
}> {
  const isolate: ivm.Isolate = new ivm.Isolate({ memoryLimit: 128 });
  const context: ivm.Context = await isolate.createContext();
  const jail: ivm.Reference<Record<string, unknown>> = context.global;

  let totalLogBytes: number = 0;

  await jail.set("global", jail.derefInto());

  await jail.set(
    "_log",
    new ivm.Callback((...args: string[]) => {
      const message: string = args.join(" ");
      totalLogBytes += message.length;

      if (totalLogBytes <= MAX_LOG_BYTES) {
        data.logMessages.push(message);
      }
    }),
  );

  await context.eval(`
    const console = { log: (...a) => _log(...a.map(v => {
      try { return typeof v === 'object' ? JSON.stringify(v) : String(v); }
      catch(_) { return String(v); }
    }))};
  `);

  if (data.args) {
    await jail.set("_args", new ivm.ExternalCopy(data.args).copyInto());
    await context.eval("const args = _args;");
  } else {
    await context.eval("const args = {};");
  }

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

      const body: JSONObject | undefined =
        hasBody && arg1 ? (JSON.parse(arg1) as JSONObject) : undefined;

      const configStr: string | undefined = hasBody ? arg2 : arg1;
      const config: JSONObject | undefined = configStr
        ? (JSON.parse(configStr) as JSONObject)
        : undefined;

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

      const toPlainHeaders: (
        headers: unknown,
      ) => Record<string, unknown> = (
        headers: unknown,
      ): Record<string, unknown> => {
        const plain: Record<string, unknown> = {};

        if (headers) {
          for (const headerKey of Object.keys(
            headers as Record<string, unknown>,
          )) {
            plain[headerKey] = (headers as Record<string, unknown>)[headerKey];
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

        return JSON.stringify({
          status: response.status,
          headers: toPlainHeaders(response.headers),
          data: response.data,
        });
      } catch (error: unknown) {
        const axiosError: {
          isAxiosError?: boolean;
          response?: AxiosResponse<any, any, Record<string, unknown>>;
          message?: string;
        } = error as {
          isAxiosError?: boolean;
          response?: AxiosResponse;
          message?: string;
        };

        if (axiosError.isAxiosError && axiosError.response) {
          return JSON.stringify({
            __isAxiosError: true,
            message: axiosError.message || "Request failed",
            status: axiosError.response.status,
            statusText: axiosError.response.statusText,
            headers: toPlainHeaders(axiosError.response.headers),
            data: axiosError.response.data,
          });
        }

        throw error;
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

    function _parseAxiosResult(result) {
      const parsed = JSON.parse(result);
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
        const response = await _axiosRef.applySyncPromise(undefined, ['request', '', merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      }

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
        const response = await _axiosRef.applySyncPromise(undefined, ['get', url, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.head = async (url, config) => {
        const merged = mergeConfig(config);
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['head', url, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.options = async (url, config) => {
        const merged = mergeConfig(config);
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['options', url, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.post = async (url, requestData, config) => {
        const merged = mergeConfig(config);
        if (requestData) _assertNoFunctions(requestData, 'data');
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['post', url, requestData ? JSON.stringify(requestData) : undefined, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.put = async (url, requestData, config) => {
        const merged = mergeConfig(config);
        if (requestData) _assertNoFunctions(requestData, 'data');
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['put', url, requestData ? JSON.stringify(requestData) : undefined, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.patch = async (url, requestData, config) => {
        const merged = mergeConfig(config);
        if (requestData) _assertNoFunctions(requestData, 'data');
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['patch', url, requestData ? JSON.stringify(requestData) : undefined, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
      };
      instance.delete = async (url, config) => {
        const merged = mergeConfig(config);
        if (merged) _assertNoFunctions(merged, 'config');
        const response = await _axiosRef.applySyncPromise(undefined, ['delete', url, merged ? JSON.stringify(merged) : undefined]);
        return _parseAxiosResult(response);
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

  const cryptoRef: ivm.Reference<
    (operation: string, ...args: string[]) => string
  > = new ivm.Reference((operation: string, ...args: string[]): string => {
    switch (operation) {
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
      case "randomUUID":
        return crypto.randomUUID();
      case "randomInt": {
        const [min, max] = args;
        return String(crypto.randomInt(parseInt(min!), parseInt(max!)));
      }
      default:
        throw new Error(`Unsupported crypto operation: ${operation}`);
    }
  });

  await jail.set("_cryptoRef", cryptoRef);

  await context.eval(`
    const crypto = {
      createHash: (algorithm) => ({
        _alg: algorithm, _data: '',
        update(data) { this._data = data; return this; },
        digest(encoding) { return _cryptoRef.applySync(undefined, ['createHash', this._alg, this._data, encoding || 'hex']); }
      }),
      createHmac: (algorithm, key) => ({
        _alg: algorithm, _key: key, _data: '',
        update(data) { this._data = data; return this; },
        digest(encoding) { return _cryptoRef.applySync(undefined, ['createHmac', this._alg, this._key, this._data, encoding || 'hex']); }
      }),
      randomBytes: (size) => ({
        toString() { return _cryptoRef.applySync(undefined, ['randomBytes', String(size)]); }
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

  const sleepRef: ivm.Reference<(ms: number) => Promise<void>> =
    new ivm.Reference((ms: number): Promise<void> => {
      return new Promise((resolve: () => void) => {
        global.setTimeout(resolve, Math.min(ms, data.timeout));
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

  return {
    isolate,
    context,
    jail,
  };
}

class PlaywrightBridge {
  private readonly refs: Map<number, unknown> = new Map();
  private readonly promises: Map<number, Promise<unknown>> = new Map();
  private nextRefId: number = 1;
  private nextPromiseId: number = 1;

  public addRoot(value: unknown): number {
    return this.registerReference(value);
  }

  public resolve(rootId: number, pathJson: string): string {
    return this.serializeEnvelope(() => {
      const path: string[] = this.parsePath(pathJson);
      const { value } = this.resolvePath(rootId, path);
      return this.serializeValue(value);
    });
  }

  public apply(rootId: number, pathJson: string, argsJson: string): string {
    return this.serializeEnvelope(() => {
      const path: string[] = this.parsePath(pathJson);
      const args: unknown[] = this.parseArgs(argsJson);
      const { owner, value } = this.resolvePath(rootId, path);

      if (typeof value !== "function") {
        throw new Error(
          `Bridge target "${path.join(".") || "<root>"}" is not callable`,
        );
      }

      return this.serializeValue(
        Reflect.apply(
          value as (...args: unknown[]) => unknown,
          owner,
          args,
        ),
      );
    });
  }

  public async awaitPromise(promiseId: number): Promise<string> {
    try {
      const promise: Promise<unknown> | undefined = this.promises.get(promiseId);

      if (!promise) {
        throw new Error(`Unknown bridge promise id: ${promiseId}`);
      }

      const result: unknown = await promise;

      return JSON.stringify({
        ok: true,
        value: this.serializeValue(result),
      } as SerializedBridgeEnvelope);
    } catch (error: unknown) {
      return JSON.stringify({
        ok: false,
        error: serializeError(error),
      } as SerializedBridgeEnvelope);
    } finally {
      this.promises.delete(promiseId);
    }
  }

  private serializeEnvelope(getValue: () => unknown): string {
    try {
      return JSON.stringify({
        ok: true,
        value: getValue(),
      } as SerializedBridgeEnvelope);
    } catch (error: unknown) {
      return JSON.stringify({
        ok: false,
        error: serializeError(error),
      } as SerializedBridgeEnvelope);
    }
  }

  private parsePath(pathJson: string): string[] {
    const parsed: unknown = JSON.parse(pathJson || "[]");

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid Playwright bridge path");
    }

    return parsed.map((segment: unknown) => {
      if (typeof segment !== "string") {
        throw new Error("Invalid Playwright bridge path segment");
      }

      this.assertPathSegment(segment);
      return segment;
    });
  }

  private parseArgs(argsJson: string): unknown[] {
    const parsed: unknown = JSON.parse(argsJson || "[]");

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid Playwright bridge argument payload");
    }

    return parsed.map((arg: unknown) => {
      return this.reviveArgument(arg);
    });
  }

  private resolvePath(rootId: number, path: string[]): {
    owner: unknown;
    value: unknown;
  } {
    let current: unknown = this.refs.get(rootId);
    let owner: unknown = undefined;

    if (current === undefined) {
      throw new Error(`Unknown Playwright bridge root id: ${rootId}`);
    }

    for (const segment of path) {
      this.assertPathSegment(segment);

      if (current === null || current === undefined) {
        throw new Error(`Cannot access "${segment}" on ${String(current)}`);
      }

      owner = current;
      current = Reflect.get(current as object, segment);
    }

    return {
      owner,
      value: current,
    };
  }

  private assertPathSegment(segment: string): void {
    if (segment.startsWith("_")) {
      throw new Error(`Access to "${segment}" is not allowed in sandbox`);
    }

    if (BLOCKED_PLAYWRIGHT_PROPERTIES.has(segment)) {
      throw new Error(`Access to "${segment}" is blocked in sandbox`);
    }
  }

  private registerReference(value: unknown): number {
    const id: number = this.nextRefId++;
    this.refs.set(id, value);
    return id;
  }

  private registerPromise(value: Promise<unknown>): number {
    const id: number = this.nextPromiseId++;
    this.promises.set(id, value);
    return id;
  }

  private serializeValue(
    value: unknown,
    visited?: WeakSet<Record<string, unknown>>,
  ): unknown {
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return {
        [BRIDGE_MARKER_KEY]: BRIDGE_BUFFER_TYPE,
        base64: value.toString("base64"),
      };
    }

    if (isPromiseLike(value)) {
      return {
        [BRIDGE_MARKER_KEY]: BRIDGE_PROMISE_TYPE,
        id: this.registerPromise(Promise.resolve(value)),
      };
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return this.serializeValue(item, visited);
      });
    }

    if (typeof value === "function") {
      return {
        [BRIDGE_MARKER_KEY]: BRIDGE_CALLABLE_REF_TYPE,
        id: this.registerReference(value),
      };
    }

    if (isPlainObject(value)) {
      const objectValue: Record<string, unknown> = value as Record<
        string,
        unknown
      >;

      if (
        Object.values(objectValue).some((item: unknown) => {
          return typeof item === "function";
        })
      ) {
        return {
          [BRIDGE_MARKER_KEY]: BRIDGE_REF_TYPE,
          id: this.registerReference(value),
        };
      }

      if (!visited) {
        visited = new WeakSet<Record<string, unknown>>();
      }

      if (visited.has(objectValue)) {
        return "[Circular]";
      }

      visited.add(objectValue);

      const serialized: Record<string, unknown> = {};

      for (const key of Object.keys(objectValue)) {
        serialized[key] = this.serializeValue(objectValue[key], visited);
      }

      return serialized;
    }
    if (typeof value === "object") {
      return {
        [BRIDGE_MARKER_KEY]: BRIDGE_REF_TYPE,
        id: this.registerReference(value),
      };
    }

    return String(value);
  }

  private reviveArgument(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return this.reviveArgument(item);
      });
    }

    if (typeof value !== "object") {
      return value;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    if (
      record[BRIDGE_MARKER_KEY] === BRIDGE_REF_TYPE ||
      record[BRIDGE_MARKER_KEY] === BRIDGE_CALLABLE_REF_TYPE
    ) {
      const refId: number = Number(record["id"]);
      const ref: unknown = this.refs.get(refId);

      if (ref === undefined) {
        throw new Error(`Unknown Playwright bridge ref id: ${refId}`);
      }

      return ref;
    }

    if (record[BRIDGE_MARKER_KEY] === BRIDGE_BUFFER_TYPE) {
      return Buffer.from(String(record["base64"] || ""), "base64");
    }

    const revived: Record<string, unknown> = {};

    for (const key of Object.keys(record)) {
      revived[key] = this.reviveArgument(record[key]);
    }

    return revived;
  }
}

async function attachPlaywrightBridge(data: {
  context: ivm.Context;
  jail: ivm.Reference<Record<string, unknown>>;
  bridge: PlaywrightBridge;
  contextValues?: Dictionary<unknown> | undefined;
}): Promise<void> {
  const resolveCallback: ivm.Callback = new ivm.Callback(
    (rootId: number, pathJson: string): string => {
      return data.bridge.resolve(rootId, pathJson);
    },
  );

  const applyCallback: ivm.Callback = new ivm.Callback(
    (rootId: number, pathJson: string, argsJson: string): string => {
      return data.bridge.apply(rootId, pathJson, argsJson);
    },
  );

  const awaitRef: ivm.Reference<(promiseId: number) => Promise<string>> =
    new ivm.Reference((promiseId: number): Promise<string> => {
      return data.bridge.awaitPromise(promiseId);
    });

  await data.jail.set("_pwResolve", resolveCallback);
  await data.jail.set("_pwApply", applyCallback);
  await data.jail.set("_pwAwaitRef", awaitRef);

  await data.context.eval(`
    function __oneuptimeParseBridgeResponse(payload) {
      const parsed = JSON.parse(payload);
      if (!parsed.ok) {
        const err = new Error(parsed.error && parsed.error.message ? parsed.error.message : 'Sandbox bridge call failed');
        if (parsed.error && parsed.error.stack) {
          err.stack = parsed.error.stack;
        }
        throw err;
      }
      return parsed.value;
    }

    function __oneuptimeUnwrapBridgeValue(value) {
      if (value === null || value === undefined) {
        return value;
      }

      if (Array.isArray(value)) {
        return value.map((item) => __oneuptimeUnwrapBridgeValue(item));
      }

      if (typeof value !== 'object') {
        return value;
      }

      if (value.__oneuptimeBridgeType === 'ref') {
        return __createBridgeProxy(Number(value.id), []);
      }

      if (value.__oneuptimeBridgeType === 'callable-ref') {
        return __createBridgeMethod(Number(value.id), []);
      }

      if (value.__oneuptimeBridgeType === 'promise') {
        return (async () => {
          const payload = await _pwAwaitRef.applySyncPromise(
            undefined,
            [Number(value.id)],
          );

          return __oneuptimeUnwrapBridgeValue(
            __oneuptimeParseBridgeResponse(payload)
          );
        })();
      }

      if (value.__oneuptimeBridgeType === 'buffer') {
        return value;
      }

      const unwrapped = {};
      for (const key of Object.keys(value)) {
        unwrapped[key] = __oneuptimeUnwrapBridgeValue(value[key]);
      }
      return unwrapped;
    }

    function __oneuptimeResolveBridgeValue(rootId, path) {
      const payload = _pwResolve(rootId, JSON.stringify(path));
      return __oneuptimeParseBridgeResponse(payload);
    }

    function __oneuptimeAssertNoFunctions(obj, path) {
      if (obj === null || obj === undefined) return;

      if (typeof obj === 'function') {
        if (obj.__oneuptimeIsBridgeProxy === true) {
          return;
        }
        throw new Error(
          'Functions are not supported in Playwright sandbox arguments for security reasons. ' +
          'Found a function at "' + path + '".'
        );
      }

      if (typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          __oneuptimeAssertNoFunctions(obj[i], path + '[' + i + ']');
        }
        return;
      }

      for (const key of Object.keys(obj)) {
        __oneuptimeAssertNoFunctions(
          obj[key],
          path ? path + '.' + key : key,
        );
      }
    }

    function __createBridgeMethod(rootId, path) {
      const proxyTarget = function() {};

      return new Proxy(proxyTarget, {
        get(_target, prop) {
          if (prop === '__oneuptimeIsBridgeProxy') {
            return true;
          }

          if (prop === 'then') {
            return undefined;
          }

          if (prop === 'toJSON') {
            return () => __oneuptimeResolveBridgeValue(rootId, path);
          }

          if (prop === 'toString') {
            return () => '[PlaywrightBridge]';
          }

          if (prop === Symbol.toPrimitive) {
            return () => '[PlaywrightBridge]';
          }

          if (typeof prop !== 'string') {
            return undefined;
          }

          if (prop === 'inspect') {
            return () => '[PlaywrightBridge]';
          }

          return __createBridgeMethod(rootId, path.concat(prop));
        },

        apply(_target, _thisArg, argsList) {
          __oneuptimeAssertNoFunctions(argsList, 'arguments');

          const payload = _pwApply(
            rootId,
            JSON.stringify(path),
            JSON.stringify(argsList),
          );

          return __oneuptimeUnwrapBridgeValue(
            __oneuptimeParseBridgeResponse(payload)
          );
        },
      });
    }

    function __createBridgeProxy(rootId, path) {
      return new Proxy({}, {
        get(_target, prop) {
          if (prop === '__oneuptimeIsBridgeProxy') {
            return true;
          }

          if (prop === 'then') {
            return undefined;
          }

          if (prop === 'toJSON') {
            return () => __oneuptimeResolveBridgeValue(rootId, path);
          }

          if (prop === 'toString') {
            return () => '[PlaywrightBridge]';
          }

          if (prop === Symbol.toPrimitive) {
            return () => '[PlaywrightBridge]';
          }

          if (typeof prop !== 'string') {
            return undefined;
          }

          if (prop === 'inspect') {
            return () => '[PlaywrightBridge]';
          }

          return __createBridgeMethod(rootId, path.concat(prop));
        },
      });
    }
  `);

  if (!data.contextValues) {
    return;
  }

  for (const key of Object.keys(data.contextValues)) {
    const value: unknown = data.contextValues[key];

    if (value === undefined) {
      continue;
    }

    if (isCopyableToIsolate(value)) {
      await data.jail.set(key, new ivm.ExternalCopy(value).copyInto());
      continue;
    }

    const refId: number = data.bridge.addRoot(value);

    await data.context.eval(
      `global[${JSON.stringify(key)}] = __createBridgeProxy(${refId}, []);`,
    );
  }
}

export default class VMRunner {
  @CaptureSpan()
  public static async runCodeInNodeVM(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
      context?: Dictionary<unknown> | undefined;
    };
  }): Promise<ReturnResult> {
    const { code, options } = data;
    const timeout: number = options.timeout || 5000;
    const logMessages: string[] = [];

    const { isolate, context, jail } = await createBaseSandbox({
      timeout,
      args: options.args,
      logMessages,
    });

    try {
      const bridge: PlaywrightBridge = new PlaywrightBridge();

      await attachPlaywrightBridge({
        context,
        jail,
        bridge,
        contextValues: options.context,
      });

      const returnValue: unknown = await executeWrappedUserCode({
        context,
        timeout,
        code,
        reviveBridgeBuffers: true,
      });

      return {
        returnValue,
        logMessages,
      };
    } finally {
      if (!isolate.isDisposed) {
        isolate.dispose();
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

    const { isolate, context } = await createBaseSandbox({
      timeout,
      args: options.args,
      logMessages,
    });

    try {
      const returnValue: unknown = await executeWrappedUserCode({
        context,
        timeout,
        code,
      });

      return {
        returnValue,
        logMessages,
      };
    } finally {
      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  }
}
