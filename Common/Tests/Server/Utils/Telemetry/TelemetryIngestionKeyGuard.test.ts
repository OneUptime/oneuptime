import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryIngestionKeyGuard, {
  TelemetryIngestionKeyRefusal,
  TelemetryIngestionKeyRefusalReason,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import TelemetryIngestionKeyPolicy from "../../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  getIngestSurfaceReadableName,
} from "../../../../Types/Telemetry/TelemetryIngestSurface";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The one place that answers "may this key write to this surface?", used by
 * every ingest entry point that is not an Express route - the gRPC OTLP
 * server, the MQTT broker and the key-validation probes. If it drifts from the
 * middleware's answer, a disabled or expired key keeps working on whichever
 * pipe nobody remembered to update, which is the exact failure the guard was
 * extracted to prevent.
 *
 * Four things are pinned:
 *
 *   1. ORDER. Disabled is checked before expiry, and expiry before the
 *      browser-surface rule. The kill switch is the one action an operator can
 *      take that must stop a leaked key whatever else is true of it, so a key
 *      that is disabled AND expired AND browser-on-a-forbidden-surface has to
 *      report Disabled - otherwise "I switched it off" produces a message
 *      about expiry and the operator cannot tell whether the switch worked.
 *   2. The EXPIRY BOUNDARY. expiresAt exactly equal to now is expired; a
 *      strict comparison would leave a key valid for one final millisecond
 *      and, worse, make the boundary untestable and therefore unnoticed.
 *   3. The BROWSER ALLOWLIST is an allowlist. The four surfaces a real browser
 *      agent emits pass; all ten of the others - server and infrastructure
 *      pipes, and the source map upload that a page could otherwise use to
 *      overwrite the maps de-obfuscating everyone else's stack traces - are
 *      refused with a message naming the surface and pointing at a server key.
 *   4. The messages LEAK NOTHING. They go back to whoever presented a dead
 *      credential, so they may not carry the secret, the expiry timestamp, the
 *      origin allowlist, the pinned service name or the project id.
 *
 * The default Server-key policy below is also the backwards-compatibility
 * shape: a key that predates this feature reads back enabled, unexpired and
 * Server, and must be refused on nothing.
 */

const ALL_SURFACES: Array<TelemetryIngestSurface> = Object.values(
  TelemetryIngestSurface,
);

const BROWSER_ALLOWED: Array<TelemetryIngestSurface> = ALL_SURFACES.filter(
  (surface: TelemetryIngestSurface) => {
    return BROWSER_ALLOWED_INGEST_SURFACES.has(surface);
  },
);

const BROWSER_FORBIDDEN: Array<TelemetryIngestSurface> = ALL_SURFACES.filter(
  (surface: TelemetryIngestSurface) => {
    return !BROWSER_ALLOWED_INGEST_SURFACES.has(surface);
  },
);

/* Values a refusal message must never echo back to the caller. */
const SECRET_VALUE: string = "opk_live_5f3c9a2b7e1d4c8a9b0e6f2d7a4c1b8e";
const ALLOWED_ORIGIN: string = "https://app.customer-example.com";
const PINNED_SERVICE_NAME: string = "customer-checkout-frontend";
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-3333-3333-333333333333",
);
const KEY_ID: ObjectID = new ObjectID("44444444-4444-4444-4444-444444444444");

describe("TelemetryIngestionKeyGuard.getRefusal", () => {
  /* Pinned so "expires exactly now" is a fact of the test, not of the clock. */
  const NOW: number = 1_700_000_000_000;

  let nowSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return NOW;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const buildPolicy: (
    overrides?: Partial<TelemetryIngestionKeyPolicy>,
  ) => TelemetryIngestionKeyPolicy = (
    overrides: Partial<TelemetryIngestionKeyPolicy> = {},
  ): TelemetryIngestionKeyPolicy => {
    return {
      ingestionKeyId: KEY_ID,
      projectId: PROJECT_ID,
      keyType: TelemetryIngestionKeyType.Server,
      allowedOrigins: [],
      pinnedServiceName: null,
      isEnabled: true,
      expiresAt: null,
      requestsPerMinuteLimit: null,
      ...overrides,
    };
  };

  const refusalFor: (data: {
    policy: TelemetryIngestionKeyPolicy;
    surface: TelemetryIngestSurface;
  }) => TelemetryIngestionKeyRefusal | null = (data: {
    policy: TelemetryIngestionKeyPolicy;
    surface: TelemetryIngestSurface;
  }): TelemetryIngestionKeyRefusal | null => {
    return TelemetryIngestionKeyGuard.getRefusal({
      policy: data.policy,
      surface: data.surface,
    });
  };

  describe("an enabled, unexpired server key", () => {
    /*
     * The backwards-compatibility contract: every key that existed before this
     * feature shipped resolves to exactly this policy, and must be refused on
     * nothing at all.
     */
    test.each(ALL_SURFACES)(
      "is refused on nothing when writing to %s",
      (surface: TelemetryIngestSurface) => {
        expect(refusalFor({ policy: buildPolicy(), surface })).toBeNull();
      },
    );

    test("covers all fourteen surfaces in the matrix above", () => {
      expect(ALL_SURFACES).toHaveLength(14);
      expect(BROWSER_ALLOWED).toHaveLength(4);
      expect(BROWSER_FORBIDDEN).toHaveLength(10);
    });
  });

  describe("the kill switch is checked first", () => {
    test.each(ALL_SURFACES)(
      "refuses a disabled server key on %s as Disabled",
      (surface: TelemetryIngestSurface) => {
        const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
          policy: buildPolicy({ isEnabled: false }),
          surface,
        });

        expect(refusal?.reason).toBe(
          TelemetryIngestionKeyRefusalReason.Disabled,
        );
      },
    );

    /*
     * Disabling a leaked key is the one action an operator has that must work
     * whatever else is true of that key. If expiry or the surface rule won the
     * race, the operator would press the switch and be told about something
     * else entirely, and could not tell whether the switch had taken effect.
     */
    test("reports Disabled for a key that is also expired and also a browser key on a forbidden surface", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({
          isEnabled: false,
          expiresAt: new Date(NOW - 60_000),
          keyType: TelemetryIngestionKeyType.Browser,
        }),
        surface: TelemetryIngestSurface.Mqtt,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Disabled);
    });

    test("reports Disabled even for a browser key on a surface it would otherwise be allowed on", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({
          isEnabled: false,
          keyType: TelemetryIngestionKeyType.Browser,
        }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Disabled);
    });
  });

  describe("expiry", () => {
    test("refuses a key whose expiry is in the past", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({ expiresAt: new Date(NOW - 1) }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Expired);
    });

    /*
     * The boundary. An expiry of exactly now has arrived; a strict comparison
     * would keep the key alive for one last millisecond and hide the fact that
     * nobody had decided which way the boundary falls.
     */
    test("refuses a key whose expiry is exactly now", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({ expiresAt: new Date(NOW) }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Expired);
    });

    test("admits a key that expires one millisecond from now", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({ expiresAt: new Date(NOW + 1) }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal).toBeNull();
    });

    test("admits a key that expires well in the future", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({
          expiresAt: new Date(NOW + 30 * 24 * 60 * 60 * 1000),
        }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal).toBeNull();
    });

    /*
     * Null is the historical shape of every key that existed before this
     * feature, and it means never expires - not "expired at the epoch".
     */
    test("admits a key with no expiry at all", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({ expiresAt: null }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal).toBeNull();
    });

    test("reports Expired ahead of the browser surface rule", () => {
      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({
          expiresAt: new Date(NOW - 1),
          keyType: TelemetryIngestionKeyType.Browser,
        }),
        surface: TelemetryIngestSurface.Syslog,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Expired);
    });
  });

  describe("the browser surface allowlist", () => {
    test.each(BROWSER_ALLOWED)(
      "lets a browser key write to %s",
      (surface: TelemetryIngestSurface) => {
        const policy: TelemetryIngestionKeyPolicy = buildPolicy({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: [ALLOWED_ORIGIN],
          pinnedServiceName: PINNED_SERVICE_NAME,
        });

        expect(refusalFor({ policy, surface })).toBeNull();
      },
    );

    test.each(BROWSER_FORBIDDEN)(
      "refuses a browser key on %s",
      (surface: TelemetryIngestSurface) => {
        const policy: TelemetryIngestionKeyPolicy = buildPolicy({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: [ALLOWED_ORIGIN],
        });

        const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
          policy,
          surface,
        });

        expect(refusal?.reason).toBe(
          TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForBrowserKey,
        );
      },
    );

    /*
     * A customer who pasted a browser key where a server key belongs needs to
     * be told which endpoint refused them and what to do instead. The raw
     * enum slug is not that, so the readable name has to appear.
     */
    test.each(BROWSER_FORBIDDEN)(
      "names %s and points the customer at a server ingestion key",
      (surface: TelemetryIngestSurface) => {
        const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
          policy: buildPolicy({ keyType: TelemetryIngestionKeyType.Browser }),
          surface,
        });

        expect(refusal?.message).toContain(
          getIngestSurfaceReadableName(surface),
        );
        expect(refusal?.message).toContain("server ingestion key");
      },
    );

    test("does not apply the surface rule to a server key", () => {
      for (const surface of BROWSER_FORBIDDEN) {
        expect(
          refusalFor({
            policy: buildPolicy({ keyType: TelemetryIngestionKeyType.Server }),
            surface,
          }),
        ).toBeNull();
      }
    });
  });

  describe("refusal messages leak nothing", () => {
    /*
     * Every refusal this guard can produce, built from a policy stuffed with
     * exactly the values a caller holding a dead credential is not entitled to
     * see.
     */
    const collectEveryMessage: () => Array<string> = (): Array<string> => {
      const loadedPolicy: Partial<TelemetryIngestionKeyPolicy> = {
        allowedOrigins: [
          ALLOWED_ORIGIN,
          "https://checkout.customer-example.com",
        ],
        pinnedServiceName: PINNED_SERVICE_NAME,
        requestsPerMinuteLimit: 6000,
      };

      const messages: Array<string> = [];

      for (const surface of ALL_SURFACES) {
        const policies: Array<TelemetryIngestionKeyPolicy> = [
          buildPolicy({ ...loadedPolicy, isEnabled: false }),
          buildPolicy({
            ...loadedPolicy,
            expiresAt: new Date(NOW - 1),
          }),
          buildPolicy({
            ...loadedPolicy,
            keyType: TelemetryIngestionKeyType.Browser,
          }),
          buildPolicy({
            ...loadedPolicy,
            keyType: TelemetryIngestionKeyType.Browser,
            isEnabled: false,
            expiresAt: new Date(NOW - 1),
          }),
        ];

        for (const policy of policies) {
          const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
            policy,
            surface,
          });

          if (refusal) {
            messages.push(refusal.message);
          }
        }
      }

      return messages;
    };

    test("produces a refusal for every reason so the checks below have something to inspect", () => {
      const messages: Array<string> = collectEveryMessage();

      expect(messages.length).toBeGreaterThan(0);
    });

    test("never says the word secret and never carries a token-like value", () => {
      for (const message of collectEveryMessage()) {
        expect(message.toLowerCase()).not.toContain("secret");
        expect(message).not.toContain(SECRET_VALUE);
        expect(message).not.toContain("opk_");
      }
    });

    test("never discloses the expiry timestamp", () => {
      const expiresAt: Date = new Date(NOW - 1);

      const refusal: TelemetryIngestionKeyRefusal | null = refusalFor({
        policy: buildPolicy({ expiresAt }),
        surface: TelemetryIngestSurface.OtelTraces,
      });

      expect(refusal?.reason).toBe(TelemetryIngestionKeyRefusalReason.Expired);
      expect(refusal?.message).not.toContain(expiresAt.toISOString());
      expect(refusal?.message).not.toContain(String(expiresAt.getTime()));
      expect(refusal?.message).not.toContain(String(expiresAt.getFullYear()));
    });

    test("never discloses the origin allowlist, the pinned service name, the project or the key id", () => {
      for (const message of collectEveryMessage()) {
        expect(message).not.toContain(ALLOWED_ORIGIN);
        expect(message).not.toContain("customer-example.com");
        expect(message).not.toContain(PINNED_SERVICE_NAME);
        expect(message).not.toContain(PROJECT_ID.toString());
        expect(message).not.toContain(KEY_ID.toString());
      }
    });

    test("still gives every refusal a non-empty explanation", () => {
      for (const message of collectEveryMessage()) {
        expect(message.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
