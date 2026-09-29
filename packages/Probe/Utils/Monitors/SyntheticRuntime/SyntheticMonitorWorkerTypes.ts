import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import {
  MAX_RPC_RESULT_BYTES,
  MAX_SANDBOX_LOG_BYTES,
  MAX_SANDBOX_LOG_MESSAGES,
  MAX_SANDBOX_METRICS,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  MAX_TOTAL_SCREENSHOT_BYTES,
  SandboxMetric,
  byteLengthOfJson,
  isRecord,
} from "./RpcProtocol";
import { MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "./Limits";

const MAX_WORKER_SCRIPT_BYTES: number = 1_000_000;
const MAX_SCRIPT_ERROR_BYTES: number = 4_000;
const MAX_SCREENSHOT_NAME_LENGTH: number = 200;
const BASE64_PATTERN: RegExp =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HTTP_PROXY_URL_PATTERN: RegExp = /^https?:\/\//i;

export interface SyntheticMonitorWorkerProxy {
  server: string;
  username?: string | undefined;
  password?: string | undefined;
  bypass?: string | undefined;
}

export interface SyntheticMonitorWorkerConfig {
  code: string;
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
  executablePath: string;
  viewport: {
    width: number;
    height: number;
  };
  timeoutInMs: number;
  chromiumSandboxEnabled: boolean;
  proxy?: SyntheticMonitorWorkerProxy | undefined;
  args?: Record<string, unknown> | undefined;
}

export interface SyntheticMonitorWorkerResult {
  returnValue?: unknown;
  logMessages: string[];
  capturedMetrics: SandboxMetric[];
  screenshots: Record<string, string>;
  scriptError?: string | undefined;
}

export function isSyntheticMonitorWorkerConfig(
  value: unknown,
): value is SyntheticMonitorWorkerConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (
    Object.keys(value).some((key: string) => {
      return ![
        "code",
        "browserType",
        "screenSizeType",
        "executablePath",
        "viewport",
        "timeoutInMs",
        "chromiumSandboxEnabled",
        "proxy",
        "args",
      ].includes(key);
    })
  ) {
    return false;
  }

  const viewport: unknown = value["viewport"];
  const proxy: unknown = value["proxy"];
  const args: unknown = value["args"];
  return (
    typeof value["code"] === "string" &&
    Buffer.byteLength(value["code"], "utf8") <= MAX_WORKER_SCRIPT_BYTES &&
    (value["browserType"] === BrowserType.Chromium ||
      value["browserType"] === BrowserType.Firefox) &&
    (value["screenSizeType"] === ScreenSizeType.Desktop ||
      value["screenSizeType"] === ScreenSizeType.Mobile ||
      value["screenSizeType"] === ScreenSizeType.Tablet) &&
    typeof value["executablePath"] === "string" &&
    value["executablePath"].length <= 4_096 &&
    value["executablePath"].startsWith("/") &&
    isRecord(viewport) &&
    Object.keys(viewport).every((key: string) => {
      return key === "width" || key === "height";
    }) &&
    Number.isSafeInteger(viewport["width"]) &&
    Number(viewport["width"]) > 0 &&
    Number(viewport["width"]) <= 10_000 &&
    Number.isSafeInteger(viewport["height"]) &&
    Number(viewport["height"]) > 0 &&
    Number(viewport["height"]) <= 10_000 &&
    Number.isSafeInteger(value["timeoutInMs"]) &&
    Number(value["timeoutInMs"]) > 0 &&
    Number(value["timeoutInMs"]) <=
      MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS &&
    typeof value["chromiumSandboxEnabled"] === "boolean" &&
    (proxy === undefined || isSyntheticMonitorWorkerProxy(proxy)) &&
    (args === undefined ||
      (isRecord(args) && byteLengthOfJson(args) <= MAX_RPC_RESULT_BYTES))
  );
}

export function isSyntheticMonitorWorkerResult(
  value: unknown,
): value is SyntheticMonitorWorkerResult {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key: string) => {
      return ![
        "returnValue",
        "logMessages",
        "capturedMetrics",
        "screenshots",
        "scriptError",
      ].includes(key);
    }) ||
    byteLengthOfJson(value["returnValue"]) > MAX_RPC_RESULT_BYTES ||
    !Array.isArray(value["logMessages"]) ||
    value["logMessages"].length > MAX_SANDBOX_LOG_MESSAGES ||
    !value["logMessages"].every((entry: unknown) => {
      return typeof entry === "string";
    }) ||
    value["logMessages"].reduce((total: number, entry: string) => {
      return total + Buffer.byteLength(entry, "utf8");
    }, 0) > MAX_SANDBOX_LOG_BYTES ||
    !Array.isArray(value["capturedMetrics"]) ||
    value["capturedMetrics"].length > MAX_SANDBOX_METRICS ||
    !isRecord(value["screenshots"]) ||
    !hasValidScreenshots(value["screenshots"]) ||
    (value["scriptError"] !== undefined &&
      (typeof value["scriptError"] !== "string" ||
        Buffer.byteLength(value["scriptError"], "utf8") >
          MAX_SCRIPT_ERROR_BYTES))
  ) {
    return false;
  }

  return value["capturedMetrics"].every((metric: unknown) => {
    if (
      !isRecord(metric) ||
      Object.keys(metric).some((key: string) => {
        return !["name", "value", "attributes"].includes(key);
      }) ||
      typeof metric["name"] !== "string" ||
      metric["name"].length < 1 ||
      metric["name"].length > 200 ||
      typeof metric["value"] !== "number" ||
      !Number.isFinite(metric["value"])
    ) {
      return false;
    }

    const attributes: unknown = metric["attributes"];
    return attributes === undefined || hasValidMetricAttributes(attributes);
  });
}

function hasValidMetricAttributes(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const entries: [string, unknown][] = Object.entries(value);
  return (
    entries.length <= 50 &&
    entries.every(([key, attribute]: [string, unknown]) => {
      return (
        key.length > 0 &&
        key.length <= 200 &&
        typeof attribute === "string" &&
        attribute.length <= 1_000
      );
    })
  );
}

function hasValidScreenshots(value: Record<string, unknown>): boolean {
  const entries: [string, unknown][] = Object.entries(value);
  if (entries.length > MAX_SCREENSHOTS) {
    return false;
  }

  let totalBytes: number = 0;
  for (const [name, encoded] of entries) {
    if (
      name.length < 1 ||
      name.length > MAX_SCREENSHOT_NAME_LENGTH ||
      typeof encoded !== "string" ||
      encoded.length === 0 ||
      !BASE64_PATTERN.test(encoded)
    ) {
      return false;
    }

    const bytes: Buffer = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64") !== encoded ||
      bytes.byteLength > MAX_SCREENSHOT_BYTES
    ) {
      return false;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_SCREENSHOT_BYTES) {
      return false;
    }
  }

  return true;
}

function isSyntheticMonitorWorkerProxy(
  value: unknown,
): value is SyntheticMonitorWorkerProxy {
  if (!isRecord(value)) {
    return false;
  }

  const keys: string[] = Object.keys(value);
  if (
    keys.some((key: string) => {
      return !["server", "username", "password", "bypass"].includes(key);
    })
  ) {
    return false;
  }

  return (
    typeof value["server"] === "string" &&
    value["server"].length <= 8_192 &&
    HTTP_PROXY_URL_PATTERN.test(value["server"]) &&
    (value["username"] === undefined ||
      (typeof value["username"] === "string" &&
        value["username"].length <= 1_000)) &&
    (value["password"] === undefined ||
      (typeof value["password"] === "string" &&
        value["password"].length <= 4_000)) &&
    (value["bypass"] === undefined ||
      (typeof value["bypass"] === "string" && value["bypass"].length <= 8_192))
  );
}
