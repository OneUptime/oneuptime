import { BrowserContext, Page } from "playwright";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import crypto from "crypto";
import {
  BinaryDescriptor,
  BigIntDescriptor,
  CapabilityDescriptor,
  LocatorChainStep,
  LocatorDescriptor,
  MAX_RPC_CALLS,
  MAX_RPC_IN_FLIGHT,
  MAX_RPC_REQUEST_BYTES,
  MAX_RPC_RESULT_BYTES,
  MAX_SANDBOX_LOG_BYTES,
  MAX_SANDBOX_LOG_MESSAGES,
  MAX_SANDBOX_METRICS,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  MAX_TOTAL_SCREENSHOT_BYTES,
  MapDescriptor,
  PlaywrightCapabilityType,
  PlaywrightRpcRequest,
  PlaywrightRpcResponse,
  RegExpDescriptor,
  RuntimeStateSnapshot,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  SandboxMetric,
  ScreenshotDescriptor,
  byteLengthOfJson,
  isBinaryDescriptor,
  isBigIntDescriptor,
  isCapabilityDescriptor,
  isFunctionDescriptor,
  isLocatorDescriptor,
  isMapDescriptor,
  isRecord,
  isRegExpDescriptor,
  isScreenshotDescriptor,
  validateRpcRequest,
} from "./RpcProtocol";

type HostObject = Record<string, unknown>;

interface CapabilityRecord {
  readonly id: string;
  readonly type: PlaywrightCapabilityType;
  readonly value: HostObject;
}

interface AxiosBridgeRequest {
  method: string;
  url: string;
  data?: unknown;
  config?: Record<string, unknown>;
}

interface BrokerOptions {
  executionId: string;
  page: Page;
  browserContext: BrowserContext;
  controllerPage: Page;
  signal: AbortSignal;
  onRuntimeReady: () => void;
}

const MAX_BROWSER_CONTEXT_PAGES: number = 8;
const MAX_VIEWPORT_DIMENSION: number = 4_096;
const MAX_VIEWPORT_PIXELS: number = 16_000_000;
const HTTP_URL_PATTERN: RegExp = /^https?:\/\//i;
const REGEXP_FLAGS_PATTERN: RegExp = /^[dgimsuvy]*$/;

const LOCATOR_CHAIN_METHODS: ReadonlySet<string> = new Set([
  "and",
  "filter",
  "first",
  "frameLocator",
  "getByAltText",
  "getByLabel",
  "getByPlaceholder",
  "getByRole",
  "getByTestId",
  "getByText",
  "getByTitle",
  "last",
  "locator",
  "nth",
  "or",
]);

const PAGE_METHODS: ReadonlySet<string> = new Set([
  "$",
  "$$",
  "$eval",
  "$$eval",
  "addInitScript",
  "addScriptTag",
  "addStyleTag",
  "bringToFront",
  "check",
  "click",
  "close",
  "content",
  "dblclick",
  "dispatchEvent",
  "dragAndDrop",
  "emulateMedia",
  "evaluate",
  "evaluateHandle",
  "fill",
  "focus",
  "getAttribute",
  "goBack",
  "goForward",
  "goto",
  "hover",
  "innerHTML",
  "innerText",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "opener",
  "press",
  "reload",
  "screenshot",
  "selectOption",
  "selectText",
  "setChecked",
  "setContent",
  "setDefaultNavigationTimeout",
  "setDefaultTimeout",
  "setExtraHTTPHeaders",
  "setInputFiles",
  "setViewportSize",
  "tap",
  "textContent",
  "title",
  "type",
  "uncheck",
  "waitForEvent",
  "waitForFunction",
  "waitForLoadState",
  "waitForNavigation",
  "waitForRequest",
  "waitForResponse",
  "waitForSelector",
  "waitForTimeout",
  "waitForURL",
]);

const LOCATOR_METHODS: ReadonlySet<string> = new Set([
  "all",
  "allInnerTexts",
  "allTextContents",
  "and",
  "ariaSnapshot",
  "blur",
  "boundingBox",
  "check",
  "clear",
  "click",
  "count",
  "dblclick",
  "dispatchEvent",
  "dragTo",
  "elementHandle",
  "elementHandles",
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "fill",
  "filter",
  "focus",
  "getAttribute",
  "highlight",
  "hover",
  "innerHTML",
  "innerText",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "or",
  "press",
  "pressSequentially",
  "screenshot",
  "scrollIntoViewIfNeeded",
  "selectOption",
  "selectText",
  "setChecked",
  "setInputFiles",
  "tap",
  "textContent",
  "type",
  "uncheck",
  "waitFor",
]);

const FRAME_METHODS: ReadonlySet<string> = new Set([
  "$",
  "$$",
  "$eval",
  "$$eval",
  "addScriptTag",
  "addStyleTag",
  "check",
  "click",
  "content",
  "dblclick",
  "dispatchEvent",
  "dragAndDrop",
  "evaluate",
  "evaluateHandle",
  "fill",
  "focus",
  "getAttribute",
  "goto",
  "hover",
  "innerHTML",
  "innerText",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "press",
  "selectOption",
  "setChecked",
  "setContent",
  "setInputFiles",
  "tap",
  "textContent",
  "title",
  "type",
  "uncheck",
  "waitForFunction",
  "waitForLoadState",
  "waitForNavigation",
  "waitForSelector",
  "waitForTimeout",
  "waitForURL",
]);

const BROWSER_CONTEXT_METHODS: ReadonlySet<string> = new Set([
  "addCookies",
  "addInitScript",
  "clearCookies",
  "clearPermissions",
  "cookies",
  "grantPermissions",
  "newPage",
  "setDefaultNavigationTimeout",
  "setDefaultTimeout",
  "setExtraHTTPHeaders",
  "setGeolocation",
  "setOffline",
  "storageState",
]);

const ELEMENT_HANDLE_METHODS: ReadonlySet<string> = new Set([
  "$",
  "$$",
  "$eval",
  "$$eval",
  "boundingBox",
  "check",
  "click",
  "contentFrame",
  "dblclick",
  "dispatchEvent",
  "dispose",
  "evaluate",
  "evaluateHandle",
  "fill",
  "focus",
  "getAttribute",
  "hover",
  "innerHTML",
  "innerText",
  "inputValue",
  "isChecked",
  "isDisabled",
  "isEditable",
  "isEnabled",
  "isHidden",
  "isVisible",
  "ownerFrame",
  "press",
  "screenshot",
  "scrollIntoViewIfNeeded",
  "selectOption",
  "selectText",
  "setChecked",
  "setInputFiles",
  "tap",
  "textContent",
  "type",
  "uncheck",
  "waitForElementState",
  "waitForSelector",
]);

const JS_HANDLE_METHODS: ReadonlySet<string> = new Set([
  "asElement",
  "dispose",
  "evaluate",
  "evaluateHandle",
  "getProperties",
  "getProperty",
  "jsonValue",
]);

const RESPONSE_METHODS: ReadonlySet<string> = new Set([
  "body",
  "finished",
  "json",
  "securityDetails",
  "serverAddr",
  "text",
]);

const REQUEST_METHODS: ReadonlySet<string> = new Set(["response"]);
const DIALOG_METHODS: ReadonlySet<string> = new Set(["accept", "dismiss"]);
const FILE_CHOOSER_METHODS: ReadonlySet<string> = new Set(["setFiles"]);

const KEYBOARD_METHODS: ReadonlySet<string> = new Set([
  "down",
  "insertText",
  "press",
  "type",
  "up",
]);

const MOUSE_METHODS: ReadonlySet<string> = new Set([
  "click",
  "dblclick",
  "down",
  "move",
  "up",
  "wheel",
]);

const TOUCHSCREEN_METHODS: ReadonlySet<string> = new Set(["tap"]);

const RUNTIME_METHODS: ReadonlySet<string> = new Set([
  "assignScreenshot",
  "axiosRequest",
  "captureMetric",
  "cryptoOperation",
  "log",
  "ready",
]);

const DENIED_METHODS: ReadonlySet<string> = new Set([
  "_browserType",
  "addLocatorHandler",
  "browser",
  "browserType",
  "connect",
  "connectOverCDP",
  "exposeBinding",
  "exposeFunction",
  "launch",
  "launchPersistentContext",
  "launchServer",
  "newCDPSession",
  "pause",
  "route",
  "routeFromHAR",
  "serviceWorkers",
  "tracing",
]);

export default class PlaywrightCapabilityBroker {
  private readonly executionId: string;
  private readonly browserContext: BrowserContext;
  private readonly controllerPage: Page;
  private readonly signal: AbortSignal;
  private readonly onRuntimeReady: () => void;
  private readonly capabilities: Map<string, CapabilityRecord> = new Map();
  private readonly capabilityIds: WeakMap<HostObject, string> = new WeakMap();
  private readonly screenshotsById: Map<string, Buffer> = new Map();
  private readonly screenshotAssignments: Map<string, string> = new Map();
  private readonly returnedScreenshotAssignments: Map<string, string> =
    new Map();
  private readonly logMessages: string[] = [];
  private readonly capturedMetrics: SandboxMetric[] = [];
  private readonly runtimeCapability: CapabilityDescriptor;
  private readonly pageCapability: CapabilityDescriptor;
  private readonly contextCapability: CapabilityDescriptor;
  private rpcCallCount: number = 0;
  private rpcInFlight: number = 0;
  private totalLogBytes: number = 0;
  private totalScreenshotBytes: number = 0;
  private hasReportedRuntimeReady: boolean = false;

  public constructor(options: BrokerOptions) {
    this.executionId = options.executionId;
    this.browserContext = options.browserContext;
    this.controllerPage = options.controllerPage;
    this.signal = options.signal;
    this.onRuntimeReady = options.onRuntimeReady;

    this.runtimeCapability = this.registerCapability(
      Object.create(null) as HostObject,
      "runtime",
    );
    this.contextCapability = this.registerCapability(
      options.browserContext as unknown as HostObject,
      "browser-context",
    );
    this.pageCapability = this.registerCapability(
      options.page as unknown as HostObject,
      "page",
    );

    this.browserContext.on("page", (page: Page): void => {
      if (this.monitoredPages().length > MAX_BROWSER_CONTEXT_PAGES) {
        void page.close().catch((): void => {
          // The context is torn down at the execution boundary.
        });
      }
    });
  }

  public getBootstrapCapabilities(): {
    runtime: CapabilityDescriptor;
    page: CapabilityDescriptor;
    browserContext: CapabilityDescriptor;
  } {
    return {
      runtime: this.runtimeCapability,
      page: this.describeCapability(this.pageCapability.id),
      browserContext: this.describeCapability(this.contextCapability.id),
    };
  }

  public getLogMessages(): string[] {
    return [...this.logMessages];
  }

  public getCapturedMetrics(): SandboxMetric[] {
    return this.capturedMetrics.map((metric: SandboxMetric) => {
      return {
        ...metric,
        ...(metric.attributes ? { attributes: { ...metric.attributes } } : {}),
      };
    });
  }

  public collectScreenshotsFromReturnValue(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const screenshots: unknown = value["screenshots"];
    if (!isRecord(screenshots)) {
      return;
    }

    for (const [name, screenshot] of Object.entries(screenshots)) {
      if (!isScreenshotDescriptor(screenshot)) {
        continue;
      }
      if (!this.screenshotsById.has(screenshot.id)) {
        continue;
      }
      const sanitizedName: string = this.sanitizeScreenshotName(name);
      if (
        !this.hasScreenshotAssignmentCapacity(
          sanitizedName,
          screenshot.id,
          "returned",
        )
      ) {
        continue;
      }
      this.returnedScreenshotAssignments.set(sanitizedName, screenshot.id);
    }
  }

  public collectScreenshotAssignments(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    for (const [name, screenshot] of Object.entries(value)) {
      this.assignScreenshot(name, screenshot);
    }
  }

  public getScreenshots(): Record<string, Buffer> {
    const result: Record<string, Buffer> = {};
    let resultBytes: number = 0;
    const assignments: Map<string, string> = new Map([
      ...this.screenshotAssignments,
      ...this.returnedScreenshotAssignments,
    ]);

    for (const [name, id] of assignments) {
      const screenshot: Buffer | undefined = this.screenshotsById.get(id);
      if (
        screenshot &&
        resultBytes + screenshot.byteLength <= MAX_TOTAL_SCREENSHOT_BYTES
      ) {
        result[name] = this.copyBytes(screenshot);
        resultBytes += screenshot.byteLength;
      }
    }

    return result;
  }

  public async dispatch(value: unknown): Promise<PlaywrightRpcResponse> {
    let requestId: string = "invalid";
    let invokedCapabilityId: string | undefined;

    try {
      const request: PlaywrightRpcRequest = validateRpcRequest(
        value,
        this.executionId,
      );
      requestId = request.requestId;
      invokedCapabilityId = request.capabilityId;
      this.assertAvailable();

      this.rpcCallCount += 1;
      if (this.rpcCallCount > MAX_RPC_CALLS) {
        throw new Error("Synthetic monitor exceeded the RPC call limit.");
      }

      if (this.rpcInFlight >= MAX_RPC_IN_FLIGHT) {
        throw new Error("Synthetic monitor exceeded the concurrent RPC limit.");
      }
      this.rpcInFlight += 1;

      try {
        const result: unknown = await this.invoke(request);
        const serialized: unknown = this.serializeResult(
          result,
          0,
          request.method === "screenshot",
        );
        if (byteLengthOfJson(serialized) > MAX_RPC_RESULT_BYTES) {
          throw new Error("Sandbox RPC result exceeded the size limit.");
        }

        return {
          version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
          requestId,
          ok: true,
          value: serialized,
          state: this.createRuntimeState(request.capabilityId),
        };
      } finally {
        this.rpcInFlight -= 1;
      }
    } catch (error: unknown) {
      return {
        version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: this.sanitizeError(error),
        state: this.createRuntimeState(invokedCapabilityId),
      };
    }
  }

  private assertAvailable(): void {
    if (this.signal.aborted) {
      throw new Error("Synthetic monitor execution was cancelled.");
    }
  }

  private async invoke(request: PlaywrightRpcRequest): Promise<unknown> {
    const capability: CapabilityRecord | undefined = this.capabilities.get(
      request.capabilityId,
    );

    if (!capability) {
      throw new Error("Unknown or expired sandbox capability.");
    }

    if (DENIED_METHODS.has(request.method) || request.method.startsWith("_")) {
      throw new Error(
        `Playwright method '${request.method}' is not available.`,
      );
    }

    const decodedArgs: unknown[] = request.args.map((arg: unknown) => {
      return this.deserializeArgument(arg);
    });

    if (capability.type === "runtime") {
      return this.invokeRuntime(request.method, decodedArgs);
    }

    let target: HostObject = capability.value;
    let targetType: PlaywrightCapabilityType = capability.type;

    if (request.locatorChain && request.locatorChain.length > 0) {
      if (request.locatorChain.length > 50) {
        throw new Error("Playwright locator chain is too long.");
      }
      for (const step of request.locatorChain) {
        target = this.applyLocatorChainStep(target, step);
      }
      targetType = "locator";
    }

    if (
      targetType === "browser-context" &&
      request.method === "newPage" &&
      this.monitoredPages().length >= MAX_BROWSER_CONTEXT_PAGES
    ) {
      throw new Error("Synthetic monitor exceeded the browser page limit.");
    }

    this.assertMethodAllowed(targetType, request.method, decodedArgs);
    this.assertSafeMethodArguments(targetType, request.method, decodedArgs);

    if (this.isEvaluationMethod(request.method)) {
      return this.invokeEvaluationMethod(target, request.method, decodedArgs);
    }
    if (this.containsFunctionDescriptor(request.args)) {
      throw new Error(
        `Playwright method '${request.method}' does not accept function callbacks in synthetic monitors.`,
      );
    }

    const method: unknown = target[request.method];
    if (typeof method !== "function") {
      throw new Error(`Playwright method '${request.method}' is unavailable.`);
    }

    return await Reflect.apply(
      method as (...args: unknown[]) => unknown,
      target,
      decodedArgs,
    );
  }

  private applyLocatorChainStep(
    target: HostObject,
    step: LocatorChainStep,
  ): HostObject {
    if (
      !isRecord(step) ||
      typeof step.method !== "string" ||
      !Array.isArray(step.args) ||
      !LOCATOR_CHAIN_METHODS.has(step.method)
    ) {
      throw new Error("Invalid Playwright locator chain operation.");
    }

    const method: unknown = target[step.method];
    if (typeof method !== "function") {
      throw new Error("Playwright locator chain operation is unavailable.");
    }

    const args: unknown[] = step.args.map((arg: unknown) => {
      return this.deserializeArgument(arg);
    });

    const next: unknown = Reflect.apply(
      method as (...methodArgs: unknown[]) => unknown,
      target,
      args,
    );

    if (!next || typeof next !== "object") {
      throw new Error("Playwright locator chain returned an invalid value.");
    }

    return next as HostObject;
  }

  private assertMethodAllowed(
    type: PlaywrightCapabilityType,
    method: string,
    args: unknown[],
  ): void {
    let allowed: ReadonlySet<string>;

    switch (type) {
      case "page":
        allowed = PAGE_METHODS;
        break;
      case "locator":
        allowed = LOCATOR_METHODS;
        break;
      case "frame":
        allowed = FRAME_METHODS;
        break;
      case "browser-context":
        allowed = BROWSER_CONTEXT_METHODS;
        break;
      case "element-handle":
        allowed = ELEMENT_HANDLE_METHODS;
        break;
      case "js-handle":
        allowed = JS_HANDLE_METHODS;
        break;
      case "response":
        allowed = RESPONSE_METHODS;
        break;
      case "request":
        allowed = REQUEST_METHODS;
        break;
      case "dialog":
        allowed = DIALOG_METHODS;
        break;
      case "file-chooser":
        allowed = FILE_CHOOSER_METHODS;
        break;
      case "keyboard":
        allowed = KEYBOARD_METHODS;
        break;
      case "mouse":
        allowed = MOUSE_METHODS;
        break;
      case "touchscreen":
        allowed = TOUCHSCREEN_METHODS;
        break;
      case "runtime":
        allowed = RUNTIME_METHODS;
        break;
    }

    if (!allowed.has(method)) {
      throw new Error(`Playwright method '${method}' is not available.`);
    }

    if (method === "waitForEvent") {
      const eventName: unknown = args[0];
      const allowedEvents: ReadonlySet<string> = new Set([
        "dialog",
        "domcontentloaded",
        "load",
        "popup",
        "request",
        "requestfailed",
        "requestfinished",
        "response",
      ]);
      if (typeof eventName !== "string" || !allowedEvents.has(eventName)) {
        throw new Error("This Playwright event is not available.");
      }
    }
  }

  private assertSafeMethodArguments(
    targetType: PlaywrightCapabilityType,
    method: string,
    args: unknown[],
  ): void {
    const singleOptionsArgumentMethods: ReadonlySet<string> = new Set([
      "addScriptTag",
      "addStyleTag",
      "pdf",
      "screenshot",
      "storageState",
    ]);
    if (singleOptionsArgumentMethods.has(method)) {
      if (args.length > 1) {
        throw new Error(
          `Playwright method '${method}' received too many arguments.`,
        );
      }
      const options: unknown = args[0];
      if (isRecord(options) && options["path"] !== undefined) {
        throw new Error(`Playwright method '${method}' cannot use host paths.`);
      }
      if (
        ["addScriptTag", "addStyleTag"].includes(method) &&
        isRecord(options) &&
        options["url"] !== undefined &&
        (typeof options["url"] !== "string" ||
          !HTTP_URL_PATTERN.test(options["url"]))
      ) {
        throw new Error(
          `Playwright method '${method}' requires an HTTP(S) URL.`,
        );
      }
      if (
        method === "screenshot" &&
        isRecord(options) &&
        options["fullPage"] === true
      ) {
        throw new Error("Full-page screenshots are not available.");
      }
      if (
        method === "screenshot" &&
        isRecord(options) &&
        options["clip"] !== undefined
      ) {
        this.assertSafeViewport(options["clip"], "screenshot clip");
      }
    }

    if (
      method === "addInitScript" &&
      isRecord(args[0]) &&
      args[0]["path"] !== undefined
    ) {
      throw new Error(
        "Playwright method 'addInitScript' cannot use host paths.",
      );
    }

    if (method === "setInputFiles" || method === "setFiles") {
      const maxArguments: number =
        method === "setInputFiles" && ["page", "frame"].includes(targetType)
          ? 3
          : 2;
      if (args.length > maxArguments) {
        throw new Error(
          `Playwright method '${method}' received too many arguments.`,
        );
      }
      const files: unknown =
        method === "setInputFiles" && ["page", "frame"].includes(targetType)
          ? args[1]
          : args[0];
      this.assertFilePayloads(files);
    }

    if (["goto"].includes(method)) {
      const url: unknown = args[0];
      if (typeof url !== "string" || !HTTP_URL_PATTERN.test(url)) {
        throw new Error(
          "Synthetic monitor navigation requires an HTTP(S) URL.",
        );
      }
    }

    if (method === "setViewportSize") {
      if (args.length !== 1) {
        throw new Error("Playwright viewport requires exactly one argument.");
      }
      this.assertSafeViewport(args[0], "viewport");
    }

    if (method === "grantPermissions") {
      if (
        args.length < 1 ||
        args.length > 2 ||
        !Array.isArray(args[0]) ||
        args[0].length > 2 ||
        !args[0].every((permission: unknown) => {
          return permission === "geolocation" || permission === "notifications";
        })
      ) {
        throw new Error(
          "Synthetic monitors can grant only geolocation and notification permissions.",
        );
      }
      if (
        isRecord(args[1]) &&
        args[1]["origin"] !== undefined &&
        (typeof args[1]["origin"] !== "string" ||
          !HTTP_URL_PATTERN.test(args[1]["origin"]))
      ) {
        throw new Error(
          "Synthetic monitor permission origin must use HTTP(S).",
        );
      }
    }
  }

  private assertSafeViewport(value: unknown, label: string): void {
    if (
      !isRecord(value) ||
      !Number.isSafeInteger(value["width"]) ||
      !Number.isSafeInteger(value["height"]) ||
      Number(value["width"]) <= 0 ||
      Number(value["height"]) <= 0 ||
      Number(value["width"]) > MAX_VIEWPORT_DIMENSION ||
      Number(value["height"]) > MAX_VIEWPORT_DIMENSION ||
      Number(value["width"]) * Number(value["height"]) > MAX_VIEWPORT_PIXELS
    ) {
      throw new Error(`Synthetic monitor ${label} is too large.`);
    }
  }

  private assertFilePayloads(files: unknown): void {
    const values: unknown[] = Array.isArray(files) ? files : [files];
    for (const value of values) {
      if (typeof value === "string") {
        throw new Error("Synthetic monitors cannot read host file paths.");
      }
      if (!isRecord(value)) {
        throw new Error("Synthetic monitor file payload is invalid.");
      }
      if (
        typeof value["name"] !== "string" ||
        typeof value["mimeType"] !== "string" ||
        !(
          Buffer.isBuffer(value["buffer"]) ||
          value["buffer"] instanceof Uint8Array
        )
      ) {
        throw new Error("Synthetic monitor file payload is invalid.");
      }
    }
  }

  private isEvaluationMethod(method: string): boolean {
    return [
      "$eval",
      "$$eval",
      "addInitScript",
      "evaluate",
      "evaluateAll",
      "evaluateHandle",
      "waitForFunction",
    ].includes(method);
  }

  private async invokeEvaluationMethod(
    target: HostObject,
    methodName: string,
    args: unknown[],
  ): Promise<unknown> {
    const method: unknown = target[methodName];
    if (typeof method !== "function") {
      throw new Error(`Playwright method '${methodName}' is unavailable.`);
    }

    const functionIndex: number = ["$eval", "$$eval"].includes(methodName)
      ? 1
      : 0;
    const candidate: unknown = args[functionIndex];

    if (!isFunctionDescriptor(candidate)) {
      if (typeof candidate === "string") {
        return await Reflect.apply(
          method as (...methodArgs: unknown[]) => unknown,
          target,
          args,
        );
      }
      throw new Error(
        `Playwright method '${methodName}' requires a function or expression string.`,
      );
    }

    if (candidate.source.length > 200_000) {
      throw new Error("Playwright evaluation function is too large.");
    }

    if (methodName === "addInitScript") {
      const argument: unknown = args[1];
      const content: string = `(${candidate.source})(${JSON.stringify(argument)});`;
      return await Reflect.apply(
        method as (...methodArgs: unknown[]) => unknown,
        target,
        [{ content }],
      );
    }

    const trustedPageFunction: (
      first: unknown,
      payload?: { source: string; argument: unknown },
    ) => unknown = (
      first: unknown,
      payload?: { source: string; argument: unknown },
    ): unknown => {
      const data: { source: string; argument: unknown } =
        payload || (first as { source: string; argument: unknown });
      const evaluated: unknown = (0, eval)(`(${data.source})`);
      if (typeof evaluated !== "function") {
        throw new Error("Evaluation source did not produce a function.");
      }
      if (payload) {
        return (evaluated as (element: unknown, arg: unknown) => unknown)(
          first,
          data.argument,
        );
      }
      return (evaluated as (arg: unknown) => unknown)(data.argument);
    };

    const argument: unknown = args[functionIndex + 1];
    const payload: { source: string; argument: unknown } = {
      source: candidate.source,
      argument,
    };

    const prefix: unknown[] = args.slice(0, functionIndex);
    const suffix: unknown[] = args.slice(functionIndex + 2);
    const playrightArgs: unknown[] = [
      ...prefix,
      trustedPageFunction,
      payload,
      ...suffix,
    ];

    return await Reflect.apply(
      method as (...methodArgs: unknown[]) => unknown,
      target,
      playrightArgs,
    );
  }

  private async invokeRuntime(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (!RUNTIME_METHODS.has(method)) {
      throw new Error(`Runtime method '${method}' is not available.`);
    }

    switch (method) {
      case "ready":
        if (!this.hasReportedRuntimeReady) {
          this.hasReportedRuntimeReady = true;
          this.onRuntimeReady();
        }
        return undefined;
      case "log":
        this.captureLog(args[0]);
        return undefined;
      case "captureMetric":
        this.captureMetric(args[0]);
        return undefined;
      case "assignScreenshot":
        this.assignScreenshot(args[0], args[1]);
        return undefined;
      case "axiosRequest":
        return this.executeAxiosRequest(args[0]);
      case "cryptoOperation":
        return this.executeCryptoOperation(args[0], args.slice(1));
    }

    throw new Error(`Runtime method '${method}' is not available.`);
  }

  private captureLog(value: unknown): void {
    if (this.logMessages.length >= MAX_SANDBOX_LOG_MESSAGES) {
      return;
    }
    const message: string = typeof value === "string" ? value : String(value);
    const bytes: number = Buffer.byteLength(message, "utf8");
    if (this.totalLogBytes + bytes > MAX_SANDBOX_LOG_BYTES) {
      return;
    }
    this.totalLogBytes += bytes;
    this.logMessages.push(message);
  }

  private captureMetric(value: unknown): void {
    if (
      this.capturedMetrics.length >= MAX_SANDBOX_METRICS ||
      !isRecord(value)
    ) {
      return;
    }
    const name: unknown = value["name"];
    const metricValue: unknown = value["value"];
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof metricValue !== "number" ||
      !Number.isFinite(metricValue)
    ) {
      return;
    }

    const metric: SandboxMetric = {
      name: name.substring(0, 200),
      value: metricValue,
    };
    const attributes: unknown = value["attributes"];
    if (isRecord(attributes)) {
      const safeAttributes: Record<string, string> = {};
      for (const [key, attribute] of Object.entries(attributes).slice(0, 50)) {
        if (
          typeof attribute === "string" ||
          typeof attribute === "number" ||
          typeof attribute === "boolean"
        ) {
          safeAttributes[key.substring(0, 200)] = String(attribute).substring(
            0,
            1_000,
          );
        }
      }
      if (Object.keys(safeAttributes).length > 0) {
        metric.attributes = safeAttributes;
      }
    }
    this.capturedMetrics.push(metric);
  }

  private assignScreenshot(name: unknown, descriptor: unknown): void {
    if (typeof name !== "string" || !isScreenshotDescriptor(descriptor)) {
      return;
    }
    if (!this.screenshotsById.has(descriptor.id)) {
      return;
    }
    const sanitizedName: string = this.sanitizeScreenshotName(name);
    if (
      !this.hasScreenshotAssignmentCapacity(
        sanitizedName,
        descriptor.id,
        "side-channel",
      )
    ) {
      return;
    }
    this.screenshotAssignments.set(sanitizedName, descriptor.id);
  }

  private hasScreenshotAssignmentCapacity(
    name: string,
    id: string,
    target: "returned" | "side-channel",
  ): boolean {
    const sideChannel: Map<string, string> = new Map(
      this.screenshotAssignments,
    );
    const returned: Map<string, string> = new Map(
      this.returnedScreenshotAssignments,
    );
    (target === "returned" ? returned : sideChannel).set(name, id);

    const combined: Map<string, string> = new Map([
      ...sideChannel,
      ...returned,
    ]);
    if (combined.size > MAX_SCREENSHOTS) {
      return false;
    }

    let bytes: number = 0;
    for (const screenshotId of combined.values()) {
      bytes += this.screenshotsById.get(screenshotId)?.byteLength || 0;
      if (bytes > MAX_TOTAL_SCREENSHOT_BYTES) {
        return false;
      }
    }
    return true;
  }

  private sanitizeScreenshotName(name: string): string {
    const normalized: string = name.trim().substring(0, 200);
    return normalized || "screenshot";
  }

  private async executeAxiosRequest(value: unknown): Promise<unknown> {
    if (!isRecord(value)) {
      throw new Error("Axios request is invalid.");
    }

    const method: unknown = value["method"];
    const url: unknown = value["url"];
    if (
      typeof method !== "string" ||
      !["delete", "get", "head", "options", "patch", "post", "put"].includes(
        method.toLowerCase(),
      ) ||
      typeof url !== "string" ||
      url.length > 8_192 ||
      !HTTP_URL_PATTERN.test(url)
    ) {
      throw new Error("Axios request requires an HTTP(S) URL and method.");
    }

    const bridgeRequest: AxiosBridgeRequest = {
      method: method.toLowerCase(),
      url,
    };
    if (value["data"] !== undefined) {
      bridgeRequest.data = value["data"];
    }
    if (isRecord(value["config"])) {
      bridgeRequest.config = value["config"];
    }

    const requestedConfig: Record<string, unknown> = bridgeRequest.config || {};
    const requestedResponseType: unknown = requestedConfig["responseType"];
    const config: AxiosRequestConfig = {
      method: bridgeRequest.method,
      url: bridgeRequest.url,
      signal: this.signal,
      maxBodyLength: 1_000_000,
      maxContentLength: MAX_RPC_RESULT_BYTES,
      maxRedirects: Math.min(
        Math.max(Number(requestedConfig["maxRedirects"] ?? 5), 0),
        5,
      ),
      responseType:
        requestedResponseType === "arraybuffer"
          ? "arraybuffer"
          : requestedResponseType === "text"
            ? "text"
            : "json",
      timeout: Math.min(
        Math.max(Number(requestedConfig["timeout"] ?? 30_000), 1),
        30_000,
      ),
    };

    if (bridgeRequest.data !== undefined) {
      config.data = bridgeRequest.data;
    }
    if (isRecord(requestedConfig["headers"])) {
      config.headers = requestedConfig["headers"] as NonNullable<
        AxiosRequestConfig["headers"]
      >;
    }
    if (isRecord(requestedConfig["params"])) {
      config.params = requestedConfig["params"];
    }
    if (
      isRecord(requestedConfig["auth"]) &&
      typeof requestedConfig["auth"]["username"] === "string" &&
      typeof requestedConfig["auth"]["password"] === "string"
    ) {
      config.auth = {
        username: requestedConfig["auth"]["username"],
        password: requestedConfig["auth"]["password"],
      };
    }

    try {
      const response: AxiosResponse = await axios.request(config);
      return {
        data: response.data,
        headers: this.copyHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        return {
          __oneuptimeAxiosError: true,
          data: error.response.data,
          headers: this.copyHeaders(error.response.headers),
          message: error.message,
          status: error.response.status,
          statusText: error.response.statusText,
        };
      }
      throw error;
    }
  }

  private copyHeaders(value: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (value && typeof value === "object") {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        result[key] = (value as Record<string, unknown>)[key];
      }
    }
    return result;
  }

  private executeCryptoOperation(operation: unknown, args: unknown[]): unknown {
    if (typeof operation !== "string") {
      throw new Error("Crypto operation is invalid.");
    }
    const strings: string[] = args.map((arg: unknown) => {
      const value: string = String(arg ?? "");
      if (Buffer.byteLength(value, "utf8") > 1_000_000) {
        throw new Error("Crypto input exceeded the size limit.");
      }
      return value;
    });

    switch (operation) {
      case "hash": {
        const [algorithm, data, encoding] = strings;
        return crypto
          .createHash(algorithm || "sha256")
          .update(data || "")
          .digest((encoding || "hex") as crypto.BinaryToTextEncoding);
      }
      case "hmac": {
        const [algorithm, key, data, encoding] = strings;
        return crypto
          .createHmac(algorithm || "sha256", key || "")
          .update(data || "")
          .digest((encoding || "hex") as crypto.BinaryToTextEncoding);
      }
      case "randomBytes": {
        const size: number = Math.min(
          Math.max(Number.parseInt(strings[0] || "0", 10), 0),
          1_000_000,
        );
        return {
          __oneuptimeBinary: true,
          base64: crypto.randomBytes(size).toString("base64"),
        } satisfies BinaryDescriptor;
      }
      case "randomInt": {
        const min: number = Number.parseInt(strings[0] || "0", 10);
        const max: number = Number.parseInt(strings[1] || "0", 10);
        return crypto.randomInt(min, max);
      }
      case "randomUUID":
        return crypto.randomUUID();
      default:
        throw new Error("Crypto operation is not available.");
    }
  }

  private deserializeArgument(value: unknown, depth: number = 0): unknown {
    if (depth > 30) {
      throw new Error("Sandbox argument nesting is too deep.");
    }
    if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (isFunctionDescriptor(value)) {
      return value;
    }
    if (isRegExpDescriptor(value)) {
      if (
        value.source.length > 10_000 ||
        value.flags.length > 10 ||
        !REGEXP_FLAGS_PATTERN.test(value.flags)
      ) {
        throw new Error("Sandbox regular expression is invalid.");
      }
      try {
        return new RegExp(value.source, value.flags);
      } catch {
        throw new Error("Sandbox regular expression is invalid.");
      }
    }
    if (isBinaryDescriptor(value)) {
      const buffer: Buffer = Buffer.from(value.base64, "base64");
      if (buffer.byteLength > MAX_RPC_REQUEST_BYTES) {
        throw new Error("Sandbox binary argument exceeded the size limit.");
      }
      return buffer;
    }
    if (isBigIntDescriptor(value)) {
      try {
        return BigInt(value.value);
      } catch {
        throw new Error("Sandbox bigint argument is invalid.");
      }
    }
    if (isMapDescriptor(value)) {
      return new Map<unknown, unknown>(
        value.entries.map((entry: [unknown, unknown]) => {
          return [
            this.deserializeArgument(entry[0], depth + 1),
            this.deserializeArgument(entry[1], depth + 1),
          ];
        }),
      );
    }
    if (isCapabilityDescriptor(value)) {
      const capability: CapabilityRecord | undefined = this.capabilities.get(
        value.id,
      );
      if (!capability || capability.type !== value.type) {
        throw new Error("Sandbox supplied an invalid capability.");
      }
      return capability.value;
    }
    if (isLocatorDescriptor(value)) {
      return this.resolveLocatorDescriptor(value);
    }
    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return this.deserializeArgument(item, depth + 1);
      });
    }
    if (isRecord(value)) {
      const result: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) {
          throw new Error("Sandbox argument contains a forbidden property.");
        }
        result[key] = this.deserializeArgument(item, depth + 1);
      }
      return result;
    }
    throw new Error("Sandbox argument type is not supported.");
  }

  private resolveLocatorDescriptor(descriptor: LocatorDescriptor): HostObject {
    const root: CapabilityRecord | undefined = this.capabilities.get(
      descriptor.rootCapabilityId,
    );
    if (!root) {
      throw new Error("Sandbox locator root is invalid.");
    }
    let target: HostObject = root.value;
    for (const step of descriptor.chain) {
      target = this.applyLocatorChainStep(target, step);
    }
    return target;
  }

  private serializeResult(
    value: unknown,
    depth: number = 0,
    binaryAsScreenshot: boolean = false,
  ): unknown {
    if (depth > 30) {
      throw new Error("Playwright result nesting is too deep.");
    }
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
      return {
        __oneuptimeBigInt: true,
        value: value.toString(),
      } satisfies BigIntDescriptor;
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const buffer: Buffer = this.copyBytes(value);
      if (binaryAsScreenshot && depth === 0) {
        return this.registerScreenshot(buffer);
      }
      return {
        __oneuptimeBinary: true,
        base64: buffer.toString("base64"),
      } satisfies BinaryDescriptor;
    }
    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return this.serializeResult(item, depth + 1, false);
      });
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof RegExp) {
      return {
        __oneuptimeRegExp: true,
        source: value.source,
        flags: value.flags,
      } satisfies RegExpDescriptor;
    }
    if (value instanceof Map) {
      if (value.size > 1_000) {
        throw new Error("Playwright map result exceeded the entry limit.");
      }
      const entries: [unknown, unknown][] = [];
      for (const [key, entryValue] of value.entries()) {
        entries.push([
          this.serializeResult(key, depth + 1, false),
          this.serializeResult(entryValue, depth + 1, false),
        ]);
      }
      return {
        __oneuptimeMap: true,
        entries,
      } satisfies MapDescriptor;
    }
    if (value && typeof value === "object") {
      const capabilityType: PlaywrightCapabilityType | null =
        this.inferCapabilityType(value as HostObject);
      if (capabilityType) {
        return this.registerCapability(value as HostObject, capabilityType);
      }

      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (["__proto__", "constructor", "prototype"].includes(key)) {
          continue;
        }
        result[key] = this.serializeResult(item, depth + 1, false);
      }
      return result;
    }
    throw new Error(
      "Playwright returned a value that cannot cross the sandbox.",
    );
  }

  private inferCapabilityType(
    value: HostObject,
  ): PlaywrightCapabilityType | null {
    const prototype: HostObject | null = Object.getPrototypeOf(
      value,
    ) as HostObject | null;
    const constructorValue: unknown = prototype
      ? (prototype as Record<string, unknown>)["constructor"]
      : undefined;
    const name: string =
      typeof constructorValue === "function" ? constructorValue.name : "";

    const names: Record<string, PlaywrightCapabilityType> = {
      BrowserContext: "browser-context",
      _BrowserContext: "browser-context",
      Dialog: "dialog",
      _Dialog: "dialog",
      ElementHandle: "element-handle",
      _ElementHandle: "element-handle",
      FileChooser: "file-chooser",
      _FileChooser: "file-chooser",
      Frame: "frame",
      _Frame: "frame",
      JSHandle: "js-handle",
      _JSHandle: "js-handle",
      Keyboard: "keyboard",
      _Keyboard: "keyboard",
      Locator: "locator",
      _Locator: "locator",
      Mouse: "mouse",
      _Mouse: "mouse",
      Page: "page",
      _Page: "page",
      Request: "request",
      _Request: "request",
      Response: "response",
      _Response: "response",
      Touchscreen: "touchscreen",
      _Touchscreen: "touchscreen",
    };

    return names[name] || null;
  }

  private registerScreenshot(buffer: Buffer): ScreenshotDescriptor {
    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error("Screenshot exceeded the per-image size limit.");
    }
    if (this.screenshotsById.size >= MAX_SCREENSHOTS) {
      throw new Error("Synthetic monitor exceeded the screenshot count limit.");
    }
    if (
      this.totalScreenshotBytes + buffer.byteLength >
      MAX_TOTAL_SCREENSHOT_BYTES
    ) {
      throw new Error("Synthetic monitor exceeded the screenshot byte limit.");
    }

    const id: string = crypto.randomUUID();
    this.screenshotsById.set(id, this.copyBytes(buffer));
    this.totalScreenshotBytes += buffer.byteLength;
    return {
      __oneuptimeScreenshot: true,
      id,
      byteLength: buffer.byteLength,
    };
  }

  private registerCapability(
    value: HostObject,
    type: PlaywrightCapabilityType,
  ): CapabilityDescriptor {
    const existing: string | undefined = this.capabilityIds.get(value);
    if (existing) {
      return this.describeCapability(existing);
    }

    if (this.capabilities.size >= 1_000) {
      throw new Error("Synthetic monitor exceeded the capability limit.");
    }

    const id: string = crypto.randomUUID();
    this.capabilities.set(id, { id, type, value });
    this.capabilityIds.set(value, id);
    return this.describeCapability(id);
  }

  private describeCapability(id: string): CapabilityDescriptor {
    const capability: CapabilityRecord | undefined = this.capabilities.get(id);
    if (!capability) {
      throw new Error("Capability no longer exists.");
    }
    return {
      __oneuptimeCapability: true,
      id,
      type: capability.type,
      snapshot: this.snapshotCapability(capability),
    };
  }

  private snapshotCapability(
    capability: CapabilityRecord,
  ): Record<string, unknown> {
    const value: HostObject = capability.value;
    try {
      switch (capability.type) {
        case "page": {
          const page: Page = value as unknown as Page;
          const keyboard: CapabilityDescriptor = this.registerCapability(
            page.keyboard as unknown as HostObject,
            "keyboard",
          );
          const mouse: CapabilityDescriptor = this.registerCapability(
            page.mouse as unknown as HostObject,
            "mouse",
          );
          const touchscreen: CapabilityDescriptor = this.registerCapability(
            page.touchscreen as unknown as HostObject,
            "touchscreen",
          );
          return {
            context: this.contextCapability,
            isClosed: page.isClosed(),
            keyboard,
            mouse,
            touchscreen,
            url: page.url(),
            viewportSize: page.viewportSize(),
          };
        }
        case "browser-context":
          return {
            pages: this.monitoredPages().map((page: Page) => {
              return this.registerCapability(
                page as unknown as HostObject,
                "page",
              );
            }),
          };
        case "response":
          return this.snapshotResponse(value);
        case "request":
          return this.snapshotRequest(value);
        case "dialog":
          return this.callSnapshotMethods(value, [
            "defaultValue",
            "message",
            "type",
          ]);
        case "file-chooser":
          return {
            isMultiple: this.callSync(value, "isMultiple"),
            page: this.serializeResult(this.callSync(value, "page")),
          };
        case "frame":
          return this.callSnapshotMethods(value, ["name", "url"]);
        default:
          return {};
      }
    } catch {
      return {};
    }
  }

  private snapshotResponse(value: HostObject): Record<string, unknown> {
    const snapshot: Record<string, unknown> = this.callSnapshotMethods(value, [
      "allHeaders",
      "headers",
      "headersArray",
      "ok",
      "status",
      "statusText",
      "url",
    ]);
    const request: unknown = this.callSync(value, "request");
    if (request && typeof request === "object") {
      snapshot["request"] = this.registerCapability(
        request as HostObject,
        "request",
      );
    }
    return snapshot;
  }

  private snapshotRequest(value: HostObject): Record<string, unknown> {
    return this.callSnapshotMethods(value, [
      "allHeaders",
      "failure",
      "frame",
      "headers",
      "headersArray",
      "isNavigationRequest",
      "method",
      "postData",
      "postDataJSON",
      "redirectedFrom",
      "resourceType",
      "url",
    ]);
  }

  private callSnapshotMethods(
    value: HostObject,
    methods: string[],
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const method of methods) {
      try {
        const result: unknown = this.callSync(value, method);
        if (!(result instanceof Promise)) {
          snapshot[method] = this.serializeResult(result);
        }
      } catch {
        // Snapshot fields are optional compatibility data.
      }
    }
    return snapshot;
  }

  private callSync(value: HostObject, methodName: string): unknown {
    const method: unknown = value[methodName];
    if (typeof method !== "function") {
      return undefined;
    }
    return Reflect.apply(method as () => unknown, value, []);
  }

  private createRuntimeState(
    invokedCapabilityId?: string | undefined,
  ): RuntimeStateSnapshot {
    const pages: CapabilityDescriptor[] = this.monitoredPages()
      .slice(0, MAX_BROWSER_CONTEXT_PAGES)
      .map((page: Page) => {
        return this.registerCapability(page as unknown as HostObject, "page");
      });
    const liveCapabilityIds: Set<string> = new Set(
      pages.map((descriptor: CapabilityDescriptor) => {
        return descriptor.id;
      }),
    );
    const invokedCapability: CapabilityRecord | undefined = invokedCapabilityId
      ? this.capabilities.get(invokedCapabilityId)
      : undefined;

    return {
      pages,
      ...(invokedCapability && !liveCapabilityIds.has(invokedCapability.id)
        ? { invokedCapability: this.describeCapability(invokedCapability.id) }
        : {}),
    };
  }

  private monitoredPages(): Page[] {
    return this.browserContext.pages().filter((page: Page) => {
      return page !== this.controllerPage;
    });
  }

  private sanitizeError(error: unknown): string {
    const message: string =
      error instanceof Error ? error.message : String(error || "Unknown error");
    return message.replace(/[\r\n\t]+/g, " ").substring(0, 2_000);
  }

  private containsFunctionDescriptor(
    value: unknown,
    depth: number = 0,
  ): boolean {
    if (depth > 30) {
      return true;
    }
    if (isFunctionDescriptor(value)) {
      return true;
    }
    if (Array.isArray(value)) {
      return value.some((item: unknown) => {
        return this.containsFunctionDescriptor(item, depth + 1);
      });
    }
    if (isRecord(value)) {
      return Object.values(value).some((item: unknown) => {
        return this.containsFunctionDescriptor(item, depth + 1);
      });
    }
    return false;
  }

  private copyBytes(value: Uint8Array): Buffer {
    const result: Buffer = Buffer.alloc(value.byteLength);
    result.set(value);
    return result;
  }
}
