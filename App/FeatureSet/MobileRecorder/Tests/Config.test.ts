import {
  CONFIG_FETCH_TIMEOUT_MS,
  ReplayFetch,
  ResolvedReplayConfig,
  ValidatedStartOptions,
  fetchReplayConfig,
  mobileRequestHeaders,
  normalizeIngestHost,
  normalizeMobileAppIdentifier,
  normalizeRumAppIdentifier,
  normalizeReplayConfig,
  validateStartOptions,
} from "../src/Config";
import {
  MOBILE_RECORDER_KIND,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SessionReplayConsentMode,
  SessionReplayMaskingMode,
} from "../src/Contract";
import { enabledConfig, response, startOptions } from "./TestUtils";
import { sanitizeRoute } from "../src/Sanitize";

describe("mobile recorder configuration", () => {
  test.each([
    ["com.example.checkout", "com.example.checkout"],
    ["  COM.Example.Checkout-Beta  ", "com.example.checkout-beta"],
    ["io.oneuptime.app_beta", "io.oneuptime.app_beta"],
    ["1.example.app2", "1.example.app2"],
  ])(
    "normalizes valid package/bundle id %s",
    (input: string, expected: string) => {
      expect(normalizeMobileAppIdentifier(input)).toBe(expected);
    },
  );

  test.each([
    "",
    "checkout",
    ".com.example",
    "com.example.",
    "com..example",
    "com.example/app",
    "com.example:443",
    "com.example app",
    "com.*.example",
    "com._example.app",
    "com.example_.app",
    "com.-example.app",
    "com.example-.app",
    "cøm.example.app",
  ])("rejects backend-invalid mobile identifier %j", (identifier: string) => {
    expect(normalizeMobileAppIdentifier(identifier)).toBeNull();
  });

  test("accepts only a deterministic ingest origin", () => {
    expect(normalizeIngestHost("https://example.com/")).toBe(
      "https://example.com",
    );
    expect(normalizeIngestHost("http://localhost:3002")).toBe(
      "http://localhost:3002",
    );
    expect(normalizeIngestHost("https://example.com/path")).toBeNull();
    expect(normalizeIngestHost("https://user@example.com")).toBeNull();
    expect(normalizeIngestHost("https://example.com?next=evil")).toBeNull();
    expect(normalizeIngestHost("javascript:alert(1)")).toBeNull();
  });

  test("validates, trims, and canonicalizes startup options", () => {
    const validated: ValidatedStartOptions | null = validateStartOptions(
      startOptions({
        host: "https://oneuptime.example/",
        mobileAppIdentifier: "COM.Example.Checkout",
      }),
    );
    expect(validated?.host).toBe("https://oneuptime.example");
    expect(validated?.mobileAppIdentifier).toBe("com.example.checkout");
    expect(
      validateStartOptions(null as unknown as ReturnType<typeof startOptions>),
    ).toBeNull();
  });

  test("accepts the server's broader RUM application identifier grammar", () => {
    expect(normalizeRumAppIdentifier("  Checkout Mobile Production  ")).toBe(
      "Checkout Mobile Production",
    );
    expect(normalizeRumAppIdentifier("service/name:mobile")).toBe(
      "service/name:mobile",
    );
    expect(normalizeRumAppIdentifier("bad\nheader")).toBeNull();
  });

  test("sends both mobile routing headers and never sets browser Origin", async () => {
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string, init?: { headers?: Record<string, string> }) => {
        expect(init?.headers?.[SESSION_REPLAY_APP_IDENTIFIER_HEADER]).toBe(
          "rum-app",
        );
        expect(init?.headers?.[SESSION_REPLAY_RECORDER_KIND_HEADER]).toBe(
          MOBILE_RECORDER_KIND,
        );
        expect(
          init?.headers?.[SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER],
        ).toBe("com.example.checkout");
        expect(init?.headers).not.toHaveProperty("Origin");
        expect(init?.headers).not.toHaveProperty("origin");
        return response(200, enabledConfig());
      },
    );
    const validated: ValidatedStartOptions | null = validateStartOptions(
      startOptions({ fetch }),
    );
    expect(validated).not.toBeNull();
    const config: ResolvedReplayConfig = await fetchReplayConfig(validated!);
    expect(config.enabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://oneuptime.example/telemetry/session-replay/v1/config",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mobileRequestHeaders(validated!)).not.toHaveProperty("Origin");
  });

  test("sends an encoded user reference on config only for targeted capture", async () => {
    const observedUserRefs: Array<string | undefined> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        observedUserRefs.push(init.headers?.[SESSION_REPLAY_USER_REF_HEADER]);
        return response(200, enabledConfig({ isTargeted: true }));
      },
    );
    const validated: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch, userRef: "jane+prod@例え.jp" }),
    )!;
    expect((await fetchReplayConfig(validated)).isTargeted).toBe(true);
    expect((await fetchReplayConfig(validated, true)).isTargeted).toBe(true);
    expect(observedUserRefs).toEqual([
      undefined,
      "jane%2Bprod%40%E4%BE%8B%E3%81%88.jp",
    ]);
    expect(mobileRequestHeaders(validated)).not.toHaveProperty(
      SESSION_REPLAY_USER_REF_HEADER,
    );
  });

  test("bypasses HTTP caches only for an explicit policy revalidation", async () => {
    const observedHeaders: Array<Record<string, string> | undefined> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        observedHeaders.push(init.headers);
        return response(200, enabledConfig());
      },
    );
    const validated: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch }),
    )!;

    await fetchReplayConfig(validated);
    await fetchReplayConfig(validated, false, true);

    expect(observedHeaders[0]).not.toHaveProperty("Cache-Control");
    expect(observedHeaders[0]).not.toHaveProperty("Pragma");
    expect(observedHeaders[1]).toEqual(
      expect.objectContaining({
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      }),
    );
  });

  test("an unencodable user reference cannot break the policy fetch", async () => {
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        expect(init.headers).not.toHaveProperty(SESSION_REPLAY_USER_REF_HEADER);
        return response(200, enabledConfig());
      },
    );
    await expect(
      fetchReplayConfig(
        validateStartOptions(startOptions({ fetch, userRef: "user-\ud800" }))!,
        true,
      ),
    ).resolves.toEqual(expect.objectContaining({ enabled: true }));
  });

  test("always collapses server masking to strict mobile wireframes", () => {
    const config: ResolvedReplayConfig = normalizeReplayConfig(enabledConfig());
    expect(config.maskingMode).toBe(SessionReplayMaskingMode.MaskAllText);
  });

  test("fails closed on unknown consent/trigger/sample values and fetch errors", async () => {
    const normalized: ResolvedReplayConfig = normalizeReplayConfig(
      enabledConfig({
        consentMode: "FutureMode",
        captureTrigger: "FutureTrigger",
        samplePercentage: 101,
      }),
    );
    expect(normalized.consentMode).toBe(
      SessionReplayConsentMode.RequireExplicit,
    );
    expect(normalized.samplePercentage).toBe(0);

    const validated: ValidatedStartOptions | null = validateStartOptions(
      startOptions({
        fetch: jest.fn(async () => {
          throw new Error("offline");
        }),
      }),
    );
    expect((await fetchReplayConfig(validated!)).enabled).toBe(false);
  });

  test("settles fail-closed at the deadline when custom fetch ignores AbortSignal", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (
        _url: string,
        init: NonNullable<Parameters<ReplayFetch>[1]> = {},
      ) => {
        return await new Promise<never>(() => {
          requestSignal = init.signal;
        });
      },
    );
    const pending: Promise<ReturnType<typeof normalizeReplayConfig>> =
      fetchReplayConfig(validateStartOptions(startOptions({ fetch }))!);
    for (
      let step: number = 0;
      step < 20 && fetch.mock.calls.length === 0;
      step += 1
    ) {
      await Promise.resolve();
    }
    expect(fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(CONFIG_FETCH_TIMEOUT_MS);
    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        enabled: false,
        disabledReason: "config-fetch-failed",
      }),
    );
    expect(requestSignal?.aborted).toBe(true);
    jest.useRealTimers();
  });

  test("scrubs identifier-shaped route segments as well as query and fragment", () => {
    expect(sanitizeRoute("/users/alice%40example.com?token=private#x")).toBe(
      "/users/[redacted]",
    );
    expect(sanitizeRoute("/orders/123456789012/summary")).toBe(
      "/orders/[redacted]/summary",
    );
    expect(sanitizeRoute("/reset/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/reset/[redacted]",
    );
  });
});
