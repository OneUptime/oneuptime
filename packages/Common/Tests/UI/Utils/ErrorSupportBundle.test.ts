import downloadFile from "../../../UI/Utils/DownloadFile";
import {
  ERROR_SUPPORT_BUNDLE_SCHEMA_VERSION,
  ErrorSupportBundle,
  ErrorSupportBundleRuntimeDetails,
  SerializedSupportError,
  MAX_SUPPORT_COMPONENT_STACK_LENGTH,
  MAX_SUPPORT_ERROR_MESSAGE_LENGTH,
  MAX_SUPPORT_ERROR_STACK_LENGTH,
  collectErrorSupportBundleRuntimeDetails,
  createErrorSupportBundle,
  downloadErrorSupportBundle,
  getComponentFromStack,
  getErrorSupportBundleFilename,
  redactSensitiveSupportText,
  scrubUrlsInSupportText,
  serializeSupportError,
} from "../../../UI/Utils/ErrorSupportBundle";

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const downloadFileMock: jest.MockedFunction<typeof downloadFile> =
  downloadFile as jest.MockedFunction<typeof downloadFile>;

function getRuntimeDetails(): ErrorSupportBundleRuntimeDetails {
  return {
    application: {
      appVersion: "8.2.1",
      gitSha: "0123456789abcdef",
      edition: "Enterprise",
      nodeEnvironment: "production",
      reactVersion: "18.3.1",
    },
    page: {
      url: "https://oneuptime.example/dashboard/traces",
      pathname: "/dashboard/traces",
      documentTitle: "Traces | OneUptime",
      hadQueryString: true,
      hadFragment: false,
      visibilityState: "visible",
      documentReadyState: "complete",
      historyLength: 4,
    },
    browser: {
      userAgent: "Test Browser/1.0",
      platform: "Test OS",
      vendor: "Test Vendor",
      language: "en-GB",
      languages: ["en-GB", "en"],
      onLine: true,
      cookieEnabled: true,
      hardwareConcurrency: 8,
      maxTouchPoints: 2,
      timeZone: "Europe/London",
      timeZoneOffsetMinutes: -60,
    },
    display: {
      viewportWidth: 1440,
      viewportHeight: 900,
      screenWidth: 2560,
      screenHeight: 1440,
      availableScreenWidth: 2560,
      availableScreenHeight: 1400,
      devicePixelRatio: 2,
      colorDepth: 24,
      pixelDepth: 24,
    },
    serviceWorker: {
      isSupported: true,
      isControlled: true,
      scriptUrl: "https://oneuptime.example/sw.js",
      state: "activated",
    },
    navigation: {
      type: "navigate",
      durationInMilliseconds: 1250,
      domContentLoadedInMilliseconds: 900,
      pageLoadInMilliseconds: 1200,
      transferSizeInBytes: 1024,
      encodedBodySizeInBytes: 900,
      decodedBodySizeInBytes: 2400,
      serviceWorkerStartInMilliseconds: 5,
    },
  };
}

describe("createErrorSupportBundle", () => {
  test("creates a structured diagnostic snapshot with the error and runtime context", () => {
    const cause: Error = new Error("Database connection closed");
    const error: Error = new Error("Unable to render trace chart");
    error.stack =
      "Error: Unable to render trace chart\n    at TraceChart (chart.tsx:42:7)";
    Object.defineProperty(error, "cause", { value: cause });
    Object.assign(error, {
      code: "TRACE_RENDER_FAILED",
      status: 500,
      statusCode: 502,
    });

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      componentStack:
        "\n    at TraceChart (chart.tsx:42:7)\n    at TracesPage (Traces.tsx:20:3)",
      digest: "react-digest-1",
      capturedAt: "2026-08-07T11:59:58.000Z",
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.schemaVersion).toBe(ERROR_SUPPORT_BUNDLE_SCHEMA_VERSION);
    expect(bundle.type).toBe("oneuptime-browser-error");
    expect(bundle.generatedAt).toBe("2026-08-07T12:00:00.000Z");
    expect(bundle.errorCapturedAt).toBe("2026-08-07T11:59:58.000Z");
    expect(bundle.application.appVersion).toBe("8.2.1");
    expect(bundle.application.gitSha).toBe("0123456789abcdef");
    expect(bundle.error.name).toBe("Error");
    expect(bundle.error.message).toBe("Unable to render trace chart");
    expect(bundle.error.stack).toContain("TraceChart");
    expect(bundle.error.code).toBe("TRACE_RENDER_FAILED");
    expect(bundle.error.status).toBe(500);
    expect(bundle.error.statusCode).toBe(502);
    expect(bundle.error.cause?.message).toBe("Database connection closed");
    expect(bundle.react.component).toBe("TraceChart");
    expect(bundle.react.componentStack).toContain("TracesPage");
    expect(bundle.react.digest).toBe("react-digest-1");
    expect(bundle.page.url).toBe("https://oneuptime.example/dashboard/traces");
    expect(bundle.browser.timeZone).toBe("Europe/London");
    expect(bundle.display.devicePixelRatio).toBe(2);
    expect(bundle.serviceWorker.state).toBe("activated");
    expect(bundle.navigation?.transferSizeInBytes).toBe(1024);
  });

  test("keeps Error fields that JSON.stringify(Error) normally loses", () => {
    const error: Error = new TypeError("Cannot read queryConfigs");

    expect(JSON.stringify(error)).toBe("{}");

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.error.name).toBe("TypeError");
    expect(bundle.error.message).toBe("Cannot read queryConfigs");
    expect(bundle.error.stack).toContain("TypeError: Cannot read queryConfigs");
  });

  test("uses the generation time when the capture time is unavailable", () => {
    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: new Error("Boom"),
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.errorCapturedAt).toBe(bundle.generatedAt);
  });

  test("supports errors without stacks or React component information", () => {
    const error: Error = new Error("Stack unavailable");
    delete error.stack;

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      componentStack: null,
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.error.stack).toBeNull();
    expect(bundle.react.component).toBeNull();
    expect(bundle.react.componentStack).toBeNull();
    expect(bundle.react.digest).toBeNull();
  });

  test("scrubs secrets from the page and absolute URLs in error stacks", () => {
    const runtimeDetails: ErrorSupportBundleRuntimeDetails =
      getRuntimeDetails();
    runtimeDetails.page.url =
      "https://oneuptime.example/reset-password/[redacted]";
    runtimeDetails.page.pathname = "/reset-password/[redacted]";

    const error: Error = new Error(
      "Failed at https://oneuptime.example/verify?token=message-secret",
    );
    error.stack =
      "Error: failed\n    at submit (https://oneuptime.example/reset-password?token=stack-secret:12:5)";

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      componentStack:
        "\n    at ResetPassword (https://oneuptime.example/reset-password?token=component-secret:9:2)",
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: runtimeDetails,
    });
    const serialized: string = JSON.stringify(bundle);

    expect(serialized).not.toContain("message-secret");
    expect(serialized).not.toContain("stack-secret");
    expect(serialized).not.toContain("component-secret");
    expect(bundle.error.message).toContain("https://oneuptime.example/verify");
    expect(bundle.error.stack).toContain(
      "https://oneuptime.example/reset-password",
    );
  });

  test("redacts common credentials and personal data from free-form fields", () => {
    const error: Error = new Error(
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=abc token=my-reset-token authToken=short credential=x Cookie: session=abc signature=sig alice@example.com",
    );
    error.stack =
      "Error from postgres://admin:database-password@db.example.com/app";
    Object.assign(error, {
      code: "api_key=code-secret-value",
    });

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      digest: "Bearer digest-secret-value",
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });
    const serialized: string = JSON.stringify(bundle);

    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("password=abc");
    expect(serialized).not.toContain("my-reset-token");
    expect(serialized).not.toContain("authToken=short");
    expect(serialized).not.toContain("credential=x");
    expect(serialized).not.toContain("session=abc");
    expect(serialized).not.toContain("signature=sig");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("database-password");
    expect(serialized).not.toContain("code-secret-value");
    expect(serialized).not.toContain("digest-secret-value");
    expect(bundle.error.message).toContain("[redacted");
  });

  test("truncates pathological messages and stacks without losing the marker", () => {
    const error: Error = new Error("m".repeat(20000));
    error.stack = "s".repeat(50000);

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: error,
      componentStack: "c".repeat(50000),
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.error.message.length).toBeLessThanOrEqual(
      MAX_SUPPORT_ERROR_MESSAGE_LENGTH,
    );
    expect(bundle.error.stack?.length).toBeLessThanOrEqual(
      MAX_SUPPORT_ERROR_STACK_LENGTH,
    );
    expect(bundle.react.componentStack?.length).toBeLessThanOrEqual(
      MAX_SUPPORT_COMPONENT_STACK_LENGTH,
    );
    expect(bundle.error.message).toContain("[truncated]");
    expect(bundle.error.stack).toContain("[truncated]");
    expect(bundle.react.componentStack).toContain("[truncated]");
  });

  test("redacts oversized credentials before truncating diagnostics", () => {
    const privateKeyMaterial: string = "a".repeat(
      MAX_SUPPORT_ERROR_MESSAGE_LENGTH * 2,
    );
    const error: Error = new Error(
      `-----BEGIN PRIVATE KEY-----\n${privateKeyMaterial}\n-----END PRIVATE KEY-----`,
    );
    error.stack = `Error: eyJ${"b".repeat(
      MAX_SUPPORT_ERROR_STACK_LENGTH * 2,
    )}.payload.signature`;

    const serializedError: SerializedSupportError =
      serializeSupportError(error);

    expect(serializedError.message).toBe("[redacted-private-key]");
    expect(serializedError.message).not.toContain(
      privateKeyMaterial.slice(0, 100),
    );
    expect(serializedError.stack).toBe("Error: [redacted-jwt]");
  });

  test("documents the privacy contract in every bundle", () => {
    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: new Error("Boom"),
      generatedAt: new Date("2026-08-07T12:00:00.000Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(bundle.privacy.reviewBeforeSharing).toContain("Review");
    expect(bundle.privacy.urlHandling).toContain("Query strings");
    expect(
      bundle.privacy.excluded.some((item: string): boolean => {
        return item.includes("local storage");
      }),
    ).toBe(true);
    expect(
      bundle.privacy.excluded.some((item: string): boolean => {
        return item.includes("environment-variable");
      }),
    ).toBe(true);
  });
});

describe("serializeSupportError", () => {
  test.each([
    ["a string", "render exploded", "render exploded"],
    ["a number", 42, "42"],
    ["null", null, "A null value was thrown."],
    ["undefined", undefined, "An undefined value was thrown."],
  ])(
    "safely serializes %s throwable",
    (_label: string, throwable: unknown, expectedMessage: string) => {
      expect(serializeSupportError(throwable).message).toBe(expectedMessage);
    },
  );

  test("does not serialize arbitrary custom properties or response bodies", () => {
    const error: Error & { responseBody?: string } = new Error(
      "Request failed",
    );
    error.responseBody = "customer-secret-response-body";

    const serialized: string = JSON.stringify(serializeSupportError(error));

    expect(serialized).not.toContain("customer-secret-response-body");
    expect(serialized).not.toContain("responseBody");
  });

  test("survives hostile property getters", () => {
    const throwable: Record<string, unknown> = {};

    for (const propertyName of ["name", "message", "stack", "cause"]) {
      Object.defineProperty(throwable, propertyName, {
        configurable: true,
        get: () => {
          throw new Error("getter exploded");
        },
      });
    }

    expect(() => {
      serializeSupportError(throwable);
    }).not.toThrow();
    expect(serializeSupportError(throwable).message).toBe(
      "A non-Error value was thrown.",
    );
  });

  test("survives an Error whose name getter throws", () => {
    const error: Error = new Error("Boom");
    Object.defineProperty(error, "name", {
      configurable: true,
      get: () => {
        throw new Error("name getter exploded");
      },
    });

    expect(serializeSupportError(error).name).toBe("Error");
  });

  test("normalizes non-finite diagnostic numbers before JSON serialization", () => {
    const error: Error = new Error("Boom");
    Object.assign(error, {
      code: Number.NaN,
      status: Number.POSITIVE_INFINITY,
      statusCode: Number.NEGATIVE_INFINITY,
    });

    const serialized: SerializedSupportError = serializeSupportError(error);

    expect(serialized.code).toBeNull();
    expect(serialized.status).toBeNull();
    expect(serialized.statusCode).toBeNull();
  });

  test("detects circular error causes", () => {
    const error: Error = new Error("Root error");
    Object.defineProperty(error, "cause", { value: error });

    const serialized: SerializedSupportError = serializeSupportError(error);

    expect(serialized.cause?.name).toBe("CircularErrorCause");
    expect(() => {
      JSON.stringify(serialized);
    }).not.toThrow();
  });

  test("caps deeply nested cause chains", () => {
    const root: Error = new Error("level-0");
    const levelOne: Error = new Error("level-1");
    const levelTwo: Error = new Error("level-2");
    const levelThree: Error = new Error("level-3");
    const levelFour: Error = new Error("level-4");
    Object.defineProperty(root, "cause", { value: levelOne });
    Object.defineProperty(levelOne, "cause", { value: levelTwo });
    Object.defineProperty(levelTwo, "cause", { value: levelThree });
    Object.defineProperty(levelThree, "cause", { value: levelFour });

    const serialized: SerializedSupportError = serializeSupportError(root);

    expect(serialized.cause?.cause?.cause?.message).toBe("level-3");
    expect(serialized.cause?.cause?.cause?.cause).toBeNull();
    expect(serialized.cause?.cause?.cause?.causeTruncated).toBe(true);
  });
});

describe("React component stack helpers", () => {
  test("extracts the first component from modern and legacy stack formats", () => {
    expect(getComponentFromStack("\n    at TraceChart (chart.tsx:1:2)")).toBe(
      "TraceChart",
    );
    expect(getComponentFromStack("\n    in LegacyChart (created by App)")).toBe(
      "LegacyChart",
    );
  });

  test("returns null when no component stack is available", () => {
    expect(getComponentFromStack(null)).toBeNull();
    expect(getComponentFromStack("")).toBeNull();
  });

  test("scrubs every call even though the URL matcher is global", () => {
    const first: string = scrubUrlsInSupportText(
      "at a (https://example.com/a?token=first)",
    );
    const second: string = scrubUrlsInSupportText(
      "at b (https://example.com/b?token=second)",
    );
    const uppercaseScheme: string = scrubUrlsInSupportText(
      "at c (HTTPS://example.com/oauth?code=uppercase-secret)",
    );

    expect(first).not.toContain("first");
    expect(second).not.toContain("second");
    expect(uppercaseScheme).not.toContain("uppercase-secret");
  });

  test("redacts private keys, provider tokens, JWTs, and payment cards", () => {
    const sensitiveText: string = [
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ123456",
      "eyJabcdefghijk.eyJabcdefghijk.signature123",
      "4111 1111 1111 1111",
    ].join("\n");
    const redacted: string = redactSensitiveSupportText(sensitiveText);

    expect(redacted).not.toContain("private-material");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("eyJabcdefghijk");
    expect(redacted).not.toContain("4111 1111 1111 1111");
  });
});

describe("collectErrorSupportBundleRuntimeDetails", () => {
  const originalUrl: string = window.location.href;
  const originalTitle: string = document.title;
  const originalEnvironmentSecret: string | undefined =
    process.env["SUPPORT_BUNDLE_SECRET"];

  afterEach(() => {
    window.history.replaceState({}, "", originalUrl);
    document.title = originalTitle;
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.cookie = "supportBundleCookie=; Max-Age=0; path=/";
    if (originalEnvironmentSecret === undefined) {
      delete process.env["SUPPORT_BUNDLE_SECRET"];
    } else {
      process.env["SUPPORT_BUNDLE_SECRET"] = originalEnvironmentSecret;
    }
  });

  test("collects browser context while scrubbing identifiers, query, and fragment", () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/48aa764b-b3a4-4995-b5f8-0d0c35fc1226/traces?token=page-secret#private-fragment",
    );
    document.title = "Traces | OneUptime";

    const runtimeDetails: ErrorSupportBundleRuntimeDetails =
      collectErrorSupportBundleRuntimeDetails();

    expect(runtimeDetails.page.url).toContain("/dashboard/[redacted]/traces");
    expect(runtimeDetails.page.url).not.toContain("page-secret");
    expect(runtimeDetails.page.url).not.toContain("private-fragment");
    expect(runtimeDetails.page.pathname).toBe("/dashboard/[redacted]/traces");
    expect(runtimeDetails.page.hadQueryString).toBe(true);
    expect(runtimeDetails.page.hadFragment).toBe(true);
    expect(runtimeDetails.page.documentTitle).toBe("Traces | OneUptime");
    expect(runtimeDetails.browser.userAgent.length).toBeGreaterThan(0);
    expect(runtimeDetails.browser.timeZone.length).toBeGreaterThan(0);
    expect(runtimeDetails.application.reactVersion.length).toBeGreaterThan(0);
  });

  test("never includes cookie, storage, or arbitrary environment contents", () => {
    document.cookie = "supportBundleCookie=cookie-secret; path=/";
    window.localStorage.setItem("support-secret", "local-storage-secret");
    window.sessionStorage.setItem("support-secret", "session-storage-secret");

    process.env["SUPPORT_BUNDLE_SECRET"] = "environment-secret";

    const bundle: ErrorSupportBundle = createErrorSupportBundle({
      error: new Error("Boom"),
      runtimeDetails: collectErrorSupportBundleRuntimeDetails(),
    });
    const serialized: string = JSON.stringify(bundle);

    expect(serialized).not.toContain("cookie-secret");
    expect(serialized).not.toContain("local-storage-secret");
    expect(serialized).not.toContain("session-storage-secret");
    expect(serialized).not.toContain("environment-secret");
    expect(serialized).not.toContain("SUPPORT_BUNDLE_SECRET");
  });

  test("survives an unavailable service worker API", () => {
    const originalDescriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });

    try {
      const runtimeDetails: ErrorSupportBundleRuntimeDetails =
        collectErrorSupportBundleRuntimeDetails();

      expect(runtimeDetails.serviceWorker.isControlled).toBe(false);
      expect(runtimeDetails.serviceWorker.scriptUrl).toBeNull();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "serviceWorker", originalDescriptor);
      } else {
        delete (navigator as { serviceWorker?: ServiceWorkerContainer })
          .serviceWorker;
      }
    }
  });
});

describe("error support bundle download", () => {
  beforeEach(() => {
    downloadFileMock.mockClear();
  });

  test("uses a deterministic filesystem-safe filename", () => {
    expect(
      getErrorSupportBundleFilename(new Date("2026-08-07T12:34:56.789Z")),
    ).toBe("oneuptime-error-support-bundle-2026-08-07T12-34-56.json");
  });

  test("downloads pretty-printed JSON with the correct MIME type", () => {
    const bundle: ErrorSupportBundle = downloadErrorSupportBundle({
      error: new Error("Download me"),
      componentStack: "\n    at BrokenPage (BrokenPage.tsx:4:2)",
      generatedAt: new Date("2026-08-07T12:34:56.789Z"),
      runtimeDetails: getRuntimeDetails(),
    });

    expect(downloadFileMock).toHaveBeenCalledTimes(1);

    const download: Parameters<typeof downloadFile>[0] =
      downloadFileMock.mock.calls[0]![0];
    expect(download.filename).toBe(
      "oneuptime-error-support-bundle-2026-08-07T12-34-56.json",
    );
    expect(download.mimeType).toBe("application/json;charset=utf-8;");
    expect(download.content).toContain('\n  "schemaVersion": 1');
    expect(JSON.parse(download.content as string)).toEqual(bundle);
  });
});
