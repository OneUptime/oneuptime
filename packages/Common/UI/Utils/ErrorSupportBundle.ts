import UrlScrubber from "../../Utils/Rum/UrlScrubber";
import { AppVersion, GitSha, IS_ENTERPRISE_EDITION, env } from "../Config";
import downloadFile from "./DownloadFile";
import React from "react";

export const ERROR_SUPPORT_BUNDLE_SCHEMA_VERSION: number = 1;
export const MAX_SUPPORT_ERROR_MESSAGE_LENGTH: number = 4000;
export const MAX_SUPPORT_ERROR_STACK_LENGTH: number = 16000;
export const MAX_SUPPORT_COMPONENT_STACK_LENGTH: number = 16000;

const MAX_DOCUMENT_TITLE_LENGTH: number = 500;
const MAX_DIAGNOSTIC_PROPERTY_LENGTH: number = 500;
const MAX_PAGE_URL_LENGTH: number = 4000;
const MAX_RUNTIME_STRING_LENGTH: number = 2000;
const MAX_ERROR_CAUSE_DEPTH: number = 3;
const TRUNCATED_MARKER: string = "\n...[truncated]";

/*
 * Stack traces sometimes contain the document URL (including reset or login
 * tokens) when an inline script throws. Scrub those URLs before the bundle is
 * written. This deliberately mirrors the session-replay error recorder.
 */
const URL_IN_TEXT: RegExp = /https?:\/\/[^\s)'"]+/gi;

interface SensitiveTextRedactionRule {
  regex: RegExp;
  replacement: string;
}

/*
 * Error messages are application-authored free-form text and occasionally
 * quote request headers, credentials, or customer identifiers. These patterns
 * are intentionally best-effort: the bundle still asks the user to review it,
 * but common high-risk values should never survive by default.
 */
const SENSITIVE_TEXT_REDACTION_RULES: Array<SensitiveTextRedactionRule> = [
  {
    regex:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
    replacement: "[redacted-private-key]",
  },
  {
    regex: /\beyJ[A-Za-z0-9_-]{3,}(?:\.[A-Za-z0-9_-]*){0,2}\b/g,
    replacement: "[redacted-jwt]",
  },
  {
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "Bearer [redacted-token]",
  },
  {
    regex:
      /\b(authorization|proxy-authorization|x-api-key|x-auth-token|x-functions-key|api[-_]?key|access[-_]?token)\b(\s*[:=]\s*)(bearer\s+|basic\s+|token\s+)?([^\s,;"']+)/gi,
    replacement: "$1$2$3[redacted]",
  },
  {
    regex:
      /\b(password|passwd|secret|token|auth[_-]?token|credential|set[-_]?cookie|cookie|signature|client[_-]?secret|private[_-]?key|session[_-]?id)\b(\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,;&]+)/gi,
    replacement: "$1$2[redacted]",
  },
  {
    regex: /([a-z][a-z0-9+.-]{0,31}:\/\/[^:@\s/]+):[^\s/]+@/gi,
    replacement: "$1:[redacted]@",
  },
  {
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{4,}\b/g,
    replacement: "[redacted-aws-key]",
  },
  {
    regex:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{4,}\b|\bgithub_pat_[A-Za-z0-9_]{4,}\b/g,
    replacement: "[redacted-github-token]",
  },
  {
    regex: /\bxox[baprs]-[A-Za-z0-9-]{4,}\b/g,
    replacement: "[redacted-slack-token]",
  },
  {
    regex: /\bAIza[0-9A-Za-z_-]{4,}\b/g,
    replacement: "[redacted-google-api-key]",
  },
  {
    regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g,
    replacement: "[redacted-email]",
  },
  {
    regex: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g,
    replacement: "[redacted-card]",
  },
];

type DiagnosticPrimitive = string | number | boolean | null;

export interface SerializedSupportError {
  name: string;
  message: string;
  stack: string | null;
  code: DiagnosticPrimitive;
  status: DiagnosticPrimitive;
  statusCode: DiagnosticPrimitive;
  cause: SerializedSupportError | null;
  causeTruncated: boolean;
}

export interface ErrorSupportBundleApplicationDetails {
  appVersion: string;
  gitSha: string;
  edition: "Community" | "Enterprise";
  nodeEnvironment: string;
  reactVersion: string;
}

export interface ErrorSupportBundlePageDetails {
  url: string;
  pathname: string;
  documentTitle: string;
  hadQueryString: boolean;
  hadFragment: boolean;
  visibilityState: string;
  documentReadyState: string;
  historyLength: number;
}

export interface ErrorSupportBundleBrowserDetails {
  userAgent: string;
  platform: string;
  vendor: string;
  language: string;
  languages: Array<string>;
  onLine: boolean;
  cookieEnabled: boolean;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  timeZone: string;
  timeZoneOffsetMinutes: number;
}

export interface ErrorSupportBundleDisplayDetails {
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  availableScreenWidth: number;
  availableScreenHeight: number;
  devicePixelRatio: number;
  colorDepth: number;
  pixelDepth: number;
}

export interface ErrorSupportBundleServiceWorkerDetails {
  isSupported: boolean;
  isControlled: boolean;
  scriptUrl: string | null;
  state: string | null;
}

export interface ErrorSupportBundleNavigationDetails {
  type: string;
  durationInMilliseconds: number;
  domContentLoadedInMilliseconds: number;
  pageLoadInMilliseconds: number;
  transferSizeInBytes: number;
  encodedBodySizeInBytes: number;
  decodedBodySizeInBytes: number;
  serviceWorkerStartInMilliseconds: number;
}

export interface ErrorSupportBundleRuntimeDetails {
  application: ErrorSupportBundleApplicationDetails;
  page: ErrorSupportBundlePageDetails;
  browser: ErrorSupportBundleBrowserDetails;
  display: ErrorSupportBundleDisplayDetails;
  serviceWorker: ErrorSupportBundleServiceWorkerDetails;
  navigation: ErrorSupportBundleNavigationDetails | null;
}

export interface ErrorSupportBundle {
  schemaVersion: number;
  type: "oneuptime-browser-error";
  generatedAt: string;
  errorCapturedAt: string;
  application: ErrorSupportBundleApplicationDetails;
  error: SerializedSupportError;
  react: {
    component: string | null;
    componentStack: string | null;
    digest: string | null;
  };
  page: ErrorSupportBundlePageDetails;
  browser: ErrorSupportBundleBrowserDetails;
  display: ErrorSupportBundleDisplayDetails;
  serviceWorker: ErrorSupportBundleServiceWorkerDetails;
  navigation: ErrorSupportBundleNavigationDetails | null;
  privacy: {
    reviewBeforeSharing: string;
    urlHandling: string;
    excluded: Array<string>;
  };
}

export interface CreateErrorSupportBundleOptions {
  error: unknown;
  componentStack?: string | null | undefined;
  digest?: string | null | undefined;
  capturedAt?: string | undefined;
  generatedAt?: Date | undefined;
  runtimeDetails?: ErrorSupportBundleRuntimeDetails | undefined;
}

type ReadSafelyFunction = <T>(reader: () => T, fallback: T) => T;

const readSafely: ReadSafelyFunction = <T>(reader: () => T, fallback: T): T => {
  try {
    return reader();
  } catch {
    return fallback;
  }
};

type TruncateFunction = (value: string, maximumLength: number) => string;

const truncate: TruncateFunction = (
  value: string,
  maximumLength: number,
): string => {
  if (value.length <= maximumLength) {
    return value;
  }

  return `${value.slice(0, maximumLength - TRUNCATED_MARKER.length)}${TRUNCATED_MARKER}`;
};

export type ScrubUrlsInSupportTextFunction = (value: string) => string;

export const scrubUrlsInSupportText: ScrubUrlsInSupportTextFunction = (
  value: string,
): string => {
  URL_IN_TEXT.lastIndex = 0;

  return value.replace(URL_IN_TEXT, (url: string): string => {
    return UrlScrubber.scrub(url);
  });
};

export type RedactSensitiveSupportTextFunction = (value: string) => string;

export const redactSensitiveSupportText: RedactSensitiveSupportTextFunction = (
  value: string,
): string => {
  let redacted: string = value;

  for (const rule of SENSITIVE_TEXT_REDACTION_RULES) {
    rule.regex.lastIndex = 0;
    redacted = redacted.replace(rule.regex, rule.replacement);
  }

  return redacted;
};

type SanitizeSupportTextFunction = (
  value: string,
  maximumLength: number,
) => string;

const sanitizeSupportText: SanitizeSupportTextFunction = (
  value: string,
  maximumLength: number,
): string => {
  return truncate(
    redactSensitiveSupportText(scrubUrlsInSupportText(value)),
    maximumLength,
  );
};

type ReadErrorPropertyFunction = (
  error: unknown,
  propertyName: string,
) => unknown;

const readErrorProperty: ReadErrorPropertyFunction = (
  error: unknown,
  propertyName: string,
): unknown => {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return undefined;
  }

  return readSafely<unknown>(() => {
    return (error as { [key: string]: unknown })[propertyName];
  }, undefined);
};

type GetDiagnosticPrimitiveFunction = (value: unknown) => DiagnosticPrimitive;

const getDiagnosticPrimitive: GetDiagnosticPrimitiveFunction = (
  value: unknown,
): DiagnosticPrimitive => {
  if (typeof value === "string") {
    return sanitizeSupportText(value, MAX_DIAGNOSTIC_PROPERTY_LENGTH);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return null;
};

type DescribeThrownValueFunction = (error: unknown) => string;

const describeThrownValue: DescribeThrownValueFunction = (
  error: unknown,
): string => {
  if (error === null) {
    return "A null value was thrown.";
  }

  if (error === undefined) {
    return "An undefined value was thrown.";
  }

  if (
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return String(error);
  }

  return "A non-Error value was thrown.";
};

type SerializeSupportErrorInternalFunction = (
  error: unknown,
  depth: number,
  seen: Set<unknown>,
) => SerializedSupportError;

const serializeSupportErrorInternal: SerializeSupportErrorInternalFunction = (
  error: unknown,
  depth: number,
  seen: Set<unknown>,
): SerializedSupportError => {
  const isObjectLike: boolean =
    error !== null &&
    (typeof error === "object" || typeof error === "function");

  if (isObjectLike && seen.has(error)) {
    return {
      name: "CircularErrorCause",
      message: "The error cause referred back to an earlier error.",
      stack: null,
      code: null,
      status: null,
      statusCode: null,
      cause: null,
      causeTruncated: false,
    };
  }

  if (isObjectLike) {
    seen.add(error);
  }

  const nameProperty: unknown = readErrorProperty(error, "name");
  const messageProperty: unknown = readErrorProperty(error, "message");
  const stackProperty: unknown = readErrorProperty(error, "stack");

  const name: string =
    typeof nameProperty === "string" && nameProperty
      ? sanitizeSupportText(nameProperty, 200)
      : error instanceof Error
        ? "Error"
        : "NonErrorThrownValue";

  const rawMessage: string =
    typeof messageProperty === "string" && messageProperty
      ? messageProperty
      : describeThrownValue(error);

  const message: string = sanitizeSupportText(
    rawMessage,
    MAX_SUPPORT_ERROR_MESSAGE_LENGTH,
  );

  const stack: string | null =
    typeof stackProperty === "string" && stackProperty
      ? sanitizeSupportText(stackProperty, MAX_SUPPORT_ERROR_STACK_LENGTH)
      : null;

  const causeValue: unknown = readErrorProperty(error, "cause");
  const hasCause: boolean = causeValue !== null && causeValue !== undefined;
  const causeTruncated: boolean = hasCause && depth >= MAX_ERROR_CAUSE_DEPTH;
  const cause: SerializedSupportError | null =
    hasCause && !causeTruncated
      ? serializeSupportErrorInternal(causeValue, depth + 1, seen)
      : null;

  return {
    name: name,
    message: message,
    stack: stack,
    code: getDiagnosticPrimitive(readErrorProperty(error, "code")),
    status: getDiagnosticPrimitive(readErrorProperty(error, "status")),
    statusCode: getDiagnosticPrimitive(readErrorProperty(error, "statusCode")),
    cause: cause,
    causeTruncated: causeTruncated,
  };
};

export type SerializeSupportErrorFunction = (
  error: unknown,
) => SerializedSupportError;

export const serializeSupportError: SerializeSupportErrorFunction = (
  error: unknown,
): SerializedSupportError => {
  return serializeSupportErrorInternal(error, 0, new Set<unknown>());
};

export type GetComponentFromStackFunction = (
  componentStack: string | null | undefined,
) => string | null;

export const getComponentFromStack: GetComponentFromStackFunction = (
  componentStack: string | null | undefined,
): string | null => {
  if (!componentStack) {
    return null;
  }

  const match: RegExpMatchArray | null = componentStack.match(
    /^\s*(?:at|in)\s+([^\s(]+)/m,
  );

  return match?.[1] || null;
};

type GetNavigationDetailsFunction =
  () => ErrorSupportBundleNavigationDetails | null;

const getNavigationDetails: GetNavigationDetailsFunction =
  (): ErrorSupportBundleNavigationDetails | null => {
    if (typeof performance === "undefined") {
      return null;
    }

    const navigationEntry: PerformanceNavigationTiming | undefined = readSafely<
      PerformanceNavigationTiming | undefined
    >(() => {
      return performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
    }, undefined);

    if (!navigationEntry) {
      return null;
    }

    return {
      type: navigationEntry.type || "unknown",
      durationInMilliseconds: navigationEntry.duration || 0,
      domContentLoadedInMilliseconds:
        navigationEntry.domContentLoadedEventEnd || 0,
      pageLoadInMilliseconds: navigationEntry.loadEventEnd || 0,
      transferSizeInBytes: navigationEntry.transferSize || 0,
      encodedBodySizeInBytes: navigationEntry.encodedBodySize || 0,
      decodedBodySizeInBytes: navigationEntry.decodedBodySize || 0,
      serviceWorkerStartInMilliseconds: navigationEntry.workerStart || 0,
    };
  };

export type CollectErrorSupportBundleRuntimeDetailsFunction =
  () => ErrorSupportBundleRuntimeDetails;

export const collectErrorSupportBundleRuntimeDetails: CollectErrorSupportBundleRuntimeDetailsFunction =
  (): ErrorSupportBundleRuntimeDetails => {
    const hasWindow: boolean = typeof window !== "undefined";
    const hasDocument: boolean = typeof document !== "undefined";
    const hasNavigator: boolean = typeof navigator !== "undefined";

    const rawUrl: string = hasWindow
      ? readSafely<string>(() => {
          return window.location.href;
        }, "")
      : "";

    const serviceWorkerController: ServiceWorker | null = hasNavigator
      ? readSafely<ServiceWorker | null>(() => {
          return navigator.serviceWorker?.controller || null;
        }, null)
      : null;

    const serviceWorkerScriptUrl: string | null = serviceWorkerController
      ? readSafely<string | null>(() => {
          return serviceWorkerController.scriptURL
            ? truncate(
                UrlScrubber.scrub(serviceWorkerController.scriptURL),
                MAX_PAGE_URL_LENGTH,
              )
            : null;
        }, null)
      : null;

    const serviceWorkerState: string | null = serviceWorkerController
      ? readSafely<string | null>(() => {
          return serviceWorkerController.state
            ? sanitizeSupportText(
                serviceWorkerController.state,
                MAX_RUNTIME_STRING_LENGTH,
              )
            : null;
        }, null)
      : null;

    const timeZone: string = readSafely<string>(() => {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    }, "unknown");

    return {
      application: {
        appVersion: sanitizeSupportText(
          AppVersion || env("VERSION") || "unknown",
          MAX_RUNTIME_STRING_LENGTH,
        ),
        gitSha: sanitizeSupportText(
          GitSha || "unknown",
          MAX_RUNTIME_STRING_LENGTH,
        ),
        edition: IS_ENTERPRISE_EDITION ? "Enterprise" : "Community",
        nodeEnvironment: sanitizeSupportText(
          env("NODE_ENV") || "unknown",
          MAX_RUNTIME_STRING_LENGTH,
        ),
        reactVersion: sanitizeSupportText(
          React.version || "unknown",
          MAX_RUNTIME_STRING_LENGTH,
        ),
      },
      page: {
        url: truncate(UrlScrubber.scrub(rawUrl), MAX_PAGE_URL_LENGTH),
        pathname: truncate(
          UrlScrubber.getScrubbedPathname(rawUrl),
          MAX_PAGE_URL_LENGTH,
        ),
        documentTitle: hasDocument
          ? sanitizeSupportText(
              readSafely<string>(() => {
                return document.title || "";
              }, ""),
              MAX_DOCUMENT_TITLE_LENGTH,
            )
          : "",
        hadQueryString: hasWindow
          ? readSafely<boolean>(() => {
              return Boolean(window.location.search);
            }, false)
          : false,
        hadFragment: hasWindow
          ? readSafely<boolean>(() => {
              return Boolean(window.location.hash);
            }, false)
          : false,
        visibilityState: hasDocument
          ? readSafely<string>(() => {
              return document.visibilityState || "unknown";
            }, "unknown")
          : "unknown",
        documentReadyState: hasDocument
          ? readSafely<string>(() => {
              return document.readyState || "unknown";
            }, "unknown")
          : "unknown",
        historyLength: hasWindow
          ? readSafely<number>(() => {
              return window.history.length || 0;
            }, 0)
          : 0,
      },
      browser: {
        userAgent: hasNavigator
          ? sanitizeSupportText(
              readSafely<string>(() => {
                return navigator.userAgent || "unknown";
              }, "unknown"),
              MAX_RUNTIME_STRING_LENGTH,
            )
          : "unknown",
        platform: hasNavigator
          ? sanitizeSupportText(
              readSafely<string>(() => {
                return navigator.platform || "unknown";
              }, "unknown"),
              MAX_RUNTIME_STRING_LENGTH,
            )
          : "unknown",
        vendor: hasNavigator
          ? sanitizeSupportText(
              readSafely<string>(() => {
                return navigator.vendor || "unknown";
              }, "unknown"),
              MAX_RUNTIME_STRING_LENGTH,
            )
          : "unknown",
        language: hasNavigator
          ? sanitizeSupportText(
              readSafely<string>(() => {
                return navigator.language || "unknown";
              }, "unknown"),
              MAX_RUNTIME_STRING_LENGTH,
            )
          : "unknown",
        languages: hasNavigator
          ? readSafely<Array<string>>(() => {
              return Array.from(navigator.languages || [])
                .slice(0, 20)
                .map((language: string): string => {
                  return sanitizeSupportText(
                    language,
                    MAX_RUNTIME_STRING_LENGTH,
                  );
                });
            }, [])
          : [],
        onLine: hasNavigator
          ? readSafely<boolean>(() => {
              return navigator.onLine;
            }, false)
          : false,
        cookieEnabled: hasNavigator
          ? readSafely<boolean>(() => {
              return navigator.cookieEnabled;
            }, false)
          : false,
        hardwareConcurrency: hasNavigator
          ? readSafely<number>(() => {
              return navigator.hardwareConcurrency || 0;
            }, 0)
          : 0,
        maxTouchPoints: hasNavigator
          ? readSafely<number>(() => {
              return navigator.maxTouchPoints || 0;
            }, 0)
          : 0,
        timeZone: sanitizeSupportText(timeZone, MAX_RUNTIME_STRING_LENGTH),
        timeZoneOffsetMinutes: new Date().getTimezoneOffset(),
      },
      display: {
        viewportWidth: hasWindow
          ? readSafely<number>(() => {
              return window.innerWidth || 0;
            }, 0)
          : 0,
        viewportHeight: hasWindow
          ? readSafely<number>(() => {
              return window.innerHeight || 0;
            }, 0)
          : 0,
        screenWidth: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.width || 0;
            }, 0)
          : 0,
        screenHeight: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.height || 0;
            }, 0)
          : 0,
        availableScreenWidth: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.availWidth || 0;
            }, 0)
          : 0,
        availableScreenHeight: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.availHeight || 0;
            }, 0)
          : 0,
        devicePixelRatio: hasWindow
          ? readSafely<number>(() => {
              return window.devicePixelRatio || 1;
            }, 1)
          : 1,
        colorDepth: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.colorDepth || 0;
            }, 0)
          : 0,
        pixelDepth: hasWindow
          ? readSafely<number>(() => {
              return window.screen?.pixelDepth || 0;
            }, 0)
          : 0,
      },
      serviceWorker: {
        isSupported: hasNavigator
          ? readSafely<boolean>(() => {
              return "serviceWorker" in navigator;
            }, false)
          : false,
        isControlled: Boolean(serviceWorkerController),
        scriptUrl: serviceWorkerScriptUrl,
        state: serviceWorkerState,
      },
      navigation: getNavigationDetails(),
    };
  };

export type CreateErrorSupportBundleFunction = (
  options: CreateErrorSupportBundleOptions,
) => ErrorSupportBundle;

export const createErrorSupportBundle: CreateErrorSupportBundleFunction = (
  options: CreateErrorSupportBundleOptions,
): ErrorSupportBundle => {
  const generatedAt: Date = options.generatedAt || new Date();
  const generatedAtIso: string = generatedAt.toISOString();
  const runtimeDetails: ErrorSupportBundleRuntimeDetails =
    options.runtimeDetails || collectErrorSupportBundleRuntimeDetails();
  const componentStack: string | null = options.componentStack
    ? sanitizeSupportText(
        options.componentStack,
        MAX_SUPPORT_COMPONENT_STACK_LENGTH,
      )
    : null;

  return {
    schemaVersion: ERROR_SUPPORT_BUNDLE_SCHEMA_VERSION,
    type: "oneuptime-browser-error",
    generatedAt: generatedAtIso,
    errorCapturedAt: options.capturedAt || generatedAtIso,
    application: runtimeDetails.application,
    error: serializeSupportError(options.error),
    react: {
      component: getComponentFromStack(componentStack),
      componentStack: componentStack,
      digest: options.digest
        ? sanitizeSupportText(options.digest, MAX_DIAGNOSTIC_PROPERTY_LENGTH)
        : null,
    },
    page: runtimeDetails.page,
    browser: runtimeDetails.browser,
    display: runtimeDetails.display,
    serviceWorker: runtimeDetails.serviceWorker,
    navigation: runtimeDetails.navigation,
    privacy: {
      reviewBeforeSharing:
        "Review this diagnostics file before sharing it with OneUptime Support because error messages and the page title can contain application data.",
      urlHandling:
        "Query strings and fragments are removed, identifier-like path segments are redacted, URLs inside error stacks are scrubbed, and common credential or personal-data patterns are masked.",
      excluded: [
        "Direct reads of cookie contents or browser authentication state",
        "Direct reads of local storage or session storage contents",
        "Direct reads of the page body or form values",
        "Direct reads of request or response headers and bodies",
        "Direct reads of console history",
        "Raw environment-variable collection",
        "Direct user or project identity collection",
      ],
    },
  };
};

export type GetErrorSupportBundleFilenameFunction = (
  generatedAt: Date,
) => string;

export const getErrorSupportBundleFilename: GetErrorSupportBundleFilenameFunction =
  (generatedAt: Date): string => {
    const timestamp: string = generatedAt
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    return `oneuptime-error-support-bundle-${timestamp}.json`;
  };

export type DownloadErrorSupportBundleFunction = (
  options: CreateErrorSupportBundleOptions,
) => ErrorSupportBundle;

export const downloadErrorSupportBundle: DownloadErrorSupportBundleFunction = (
  options: CreateErrorSupportBundleOptions,
): ErrorSupportBundle => {
  const generatedAt: Date = options.generatedAt || new Date();
  const bundle: ErrorSupportBundle = createErrorSupportBundle({
    ...options,
    generatedAt: generatedAt,
  });

  downloadFile({
    content: `${JSON.stringify(bundle, null, 2)}\n`,
    filename: getErrorSupportBundleFilename(generatedAt),
    mimeType: "application/json;charset=utf-8;",
  });

  return bundle;
};
