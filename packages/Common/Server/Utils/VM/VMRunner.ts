import CapturedMetric from "../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import ReturnResult from "../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../Types/JSON";
import crypto from "crypto";
import ivm from "isolated-vm";
import CaptureSpan from "../Telemetry/CaptureSpan";
import VMHttpBridge, {
  MAX_HTTP_CONFIG_BYTES,
  MAX_HTTP_REQUEST_BYTES,
  MAX_HTTP_URL_BYTES,
  MAX_PENDING_HTTP_REQUESTS,
  TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
  VMHttpCall,
  VMHttpRequester,
} from "./VMHttpBridge";

/*
 * How often to wake Node's event loop while sandboxed code is running. See
 * the comment on hostBridgeTicker in runCodeInSandbox: the isolate's host
 * bridges only advance on an event-loop turn, and a loop with nothing else
 * pending sleeps until its next timer. 5ms is small against any real host
 * operation and costs one empty callback per tick.
 */
const HOST_BRIDGE_TICK_MS: number = 5;

// What the host answers a script's oneuptime.getTotpCode with.
export interface VMTotpCodeAnswer {
  code?: string | undefined;
  // The current code is about to expire: ask again after this long.
  waitInMs?: number | undefined;
  error?: string | undefined;
}

// Where a script's one-time codes come from (TotpCodeIssuer is one).
export interface VMTotpCodes {
  tryGetCode(name: unknown): VMTotpCodeAnswer;
}

const NO_TOTP_CODES_MESSAGE: string =
  "oneuptime.getTotpCode works only in a monitor's script, where the monitor's one-time code (TOTP) secrets are.";

/*
 * How many times a script asks before giving up: a code about to expire is
 * waited for once, and secrets of different periods may need a second wait.
 */
const MAX_TOTP_CODE_ASKS: number = 4;

const TOTP_CODE_NOT_MADE_MESSAGE: string =
  "A one-time code could not be made in time. Run the check again.";

export default class VMRunner {
  @CaptureSpan()
  public static async runCodeInSandbox(data: {
    code: string;
    options: {
      timeout?: number;
      args?: JSONObject | undefined;
      /*
       * Passed straight through to the SSRF guard on the axios bridge
       * (VMHttpBridge).
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
      /*
       * Whether a refusal decided by DNS may tell the script what DNS
       * answered (see SSRFProtection). Absent ⇒ the guard's deployment
       * default, which is right for the workflow caller on the API server.
       * The Probe passes false: a shared probe must not let one tenant's
       * script map the network it sits in.
       */
      includeResolutionDetailInError?: boolean | undefined;
      /*
       * Who makes the script's HTTP requests. Absent, this process does,
       * through the SSRF guard with the policy above (VMHttpBridge). A global
       * Runner's JavaScript step runs this isolate in a process that may open
       * no socket at all, and hands each request to the Runner, which makes
       * it through the same guard with the policy it decided; the policy
       * above then goes unread. Either way the request is first held to the
       * run's limits here.
       */
      httpRequester?: VMHttpRequester | undefined;
      /*
       * The one-time codes oneuptime.getTotpCode hands the script: a probe's
       * Custom JavaScript Code monitor passes its check's TotpCodeIssuer
       * (Utils/Monitor/MonitorSecretTotp). Absent, as for a workflow's
       * script, the function says it is a monitor script's.
       */
      totpCodes?: VMTotpCodes | undefined;
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

    // This run's HTTP: its limits, and, unless another makes them, its requests.
    const httpBridge: VMHttpBridge = new VMHttpBridge({
      allowPrivateNetworkRequests: options.allowPrivateNetworkRequests,
      privateNetworkAccessIsAllowed: options.privateNetworkAccessIsAllowed,
      privateNetworkHint: options.privateNetworkHint,
      includeResolutionDetailInError: options.includeResolutionDetailInError,
    });
    const requestHttp: VMHttpRequester =
      options.httpRequester ||
      ((call: VMHttpCall, signal: AbortSignal): Promise<string> => {
        return httpBridge.execute(call, signal);
      });

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

      /*
       * oneuptime.getTotpCode("NAME") (issue #9703): a fresh one-time code
       * from a TOTP monitor secret the script's monitor carries. The host
       * answers at once - the code, or how long to wait while the current
       * one is about to expire - and the script waits on the sandbox's own
       * sleep, so nothing blocks the host. A runner handed no codes (a
       * workflow's script) says the function is a monitor script's.
       */
      await jail.set(
        "__oneuptimeHostTotpCallback",
        new ivm.Callback(
          (name: string): string => {
            const answer: VMTotpCodeAnswer = options.totpCodes
              ? options.totpCodes.tryGetCode(name)
              : { error: NO_TOTP_CODES_MESSAGE };

            return JSON.stringify(answer);
          },
          { sync: true },
        ),
      );

      await context.eval(`
        (() => {
          const hostCaptureMetric = globalThis.__oneuptimeHostMetricCallback;
          delete globalThis.__oneuptimeHostMetricCallback;
          const hostTotpCode = globalThis.__oneuptimeHostTotpCallback;
          delete globalThis.__oneuptimeHostTotpCallback;

          const sandboxOneUptime = Object.freeze({
            captureMetric: (name, value, attributes) => {
              if (typeof name !== 'string' || name.length === 0) return;
              if (typeof value !== 'number' || isNaN(value)) return;
              const attrJson = attributes ? JSON.stringify(attributes) : undefined;
              hostCaptureMetric(String(name), String(value), attrJson);
            },
            getTotpCode: async (name) => {
              for (let attempt = 0; attempt < ${MAX_TOTP_CODE_ASKS}; attempt += 1) {
                const answer = JSON.parse(hostTotpCode(typeof name === 'string' ? name : ''));
                if (answer.error) throw new Error(answer.error);
                if (answer.code) return answer.code;
                // The bridge's own sleep, defined on the global below.
                await globalThis.sleep(answer.waitInMs);
              }
              throw new Error(${JSON.stringify(TOTP_CODE_NOT_MADE_MESSAGE)});
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
       * axios (get, head, options, post, put, patch, delete, request),
       * bridged through copied async start and poll callbacks: each call is
       * held to the run's limits (VMHttpBridge.reserve), then made by the run's
       * requester, and the isolate polls for its envelope.
       */
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

          if (pendingAxiosOperations.size >= MAX_PENDING_HTTP_REQUESTS) {
            pendingAxiosOperations.set(operationId, {
              status: "rejected",
              errorMessage: TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
            });
            return operationId;
          }

          const call: VMHttpCall = { method, url, arg1, arg2 };

          try {
            httpBridge.reserve(call);
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
          void requestHttp(call, abortController.signal)
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
