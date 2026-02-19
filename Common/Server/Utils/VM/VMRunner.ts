import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../Types/JSON";
import axios, { AxiosResponse } from "axios";
import crypto from "crypto";
import http from "http";
import https from "https";
import ivm from "isolated-vm";
import CaptureSpan from "../Telemetry/CaptureSpan";

export default class VMRunner {
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
       * axios (get, post, put, patch, delete) - bridged via applySyncPromise
       *
       * For GET/DELETE:      args = [method, url, configJson?]
       * For POST/PUT/PATCH:  args = [method, url, bodyJson?, configJson?]
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

          // For POST/PUT/PATCH: arg1=body, arg2=config
          // For GET/DELETE: arg1=config
          const body: JSONObject | undefined =
            hasBody && arg1
              ? (JSON.parse(arg1) as JSONObject)
              : undefined;

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

          let response: AxiosResponse;

          switch (method) {
            case "get":
              response = await axios.get(url, config);
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
            default:
              throw new Error(`Unsupported HTTP method: ${method}`);
          }

          return JSON.stringify({
            status: response.status,
            headers: response.headers,
            data: response.data,
          });
        },
      );

      await jail.set("_axiosRef", axiosRef);

      await context.eval(`
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

          return {
            get: async (url, config) => {
              const merged = mergeConfig(config);
              const r = await _axiosRef.applySyncPromise(undefined, ['get', url, merged ? JSON.stringify(merged) : undefined]);
              return JSON.parse(r);
            },
            post: async (url, data, config) => {
              const merged = mergeConfig(config);
              const r = await _axiosRef.applySyncPromise(undefined, ['post', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
              return JSON.parse(r);
            },
            put: async (url, data, config) => {
              const merged = mergeConfig(config);
              const r = await _axiosRef.applySyncPromise(undefined, ['put', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
              return JSON.parse(r);
            },
            patch: async (url, data, config) => {
              const merged = mergeConfig(config);
              const r = await _axiosRef.applySyncPromise(undefined, ['patch', url, data ? JSON.stringify(data) : undefined, merged ? JSON.stringify(merged) : undefined]);
              return JSON.parse(r);
            },
            delete: async (url, config) => {
              const merged = mergeConfig(config);
              const r = await _axiosRef.applySyncPromise(undefined, ['delete', url, merged ? JSON.stringify(merged) : undefined]);
              return JSON.parse(r);
            },
            create: (instanceDefaults) => {
              const combinedDefaults = mergeConfig(instanceDefaults);
              return _makeAxiosInstance(combinedDefaults);
            },
          };
        }

        const axios = _makeAxiosInstance(null);
      `);

      // crypto (createHash, createHmac, randomBytes) - bridged via applySync
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
      };
    } finally {
      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  }
}
