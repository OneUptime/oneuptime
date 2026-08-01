import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import Config, {
  LoaderConfig,
  RecorderInitOptions,
  getChunkUrl,
} from "../src/Config";

describe("Config", (): void => {
  const validBody: Record<string, unknown> = {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 12.5,
    maskSelectors: [".pii", 7],
    blockSelectors: [],
    urlAllowlist: ["coupon"],
    ignoreErrorPatterns: ["ResizeObserver loop"],
    recordCanvas: true,
    captureUserIdentity: true,
    respectDoNotTrack: false,
    configEpoch: 42,
    directive: "throttle",
    recorderIntegrity: "sha384-abc",
  };

  afterEach((): void => {
    document.head.innerHTML = "";
    delete (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ];
  });

  describe("readInitOptions", (): void => {
    it("reads a global config object", (): void => {
      (window as unknown as Record<string, unknown>)[
        "__ONEUPTIME_SESSION_REPLAY__"
      ] = {
        host: "https://oneuptime.com/",
        token: "tok",
        appIdentifier: "app",
        userRef: "user-1",
      };

      const options: RecorderInitOptions | null = Config.readInitOptions();

      expect(options).toEqual({
        host: "https://oneuptime.com",
        token: "tok",
        appIdentifier: "app",
        userRef: "user-1",
        respectDoNotTrack: true,
      });
    });

    it("reads script tag data attributes", (): void => {
      document.head.innerHTML =
        '<script data-oneuptime-host="https://x.example.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      const options: RecorderInitOptions | null = Config.readInitOptions();

      expect(options?.host).toBe("https://x.example.com");
      expect(options?.appIdentifier).toBe("a");
      expect(options?.respectDoNotTrack).toBe(true);
    });

    it("allows the page to opt out of honouring DNT explicitly", (): void => {
      document.head.innerHTML =
        '<script data-oneuptime-host="https://x.example.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a" data-oneuptime-respect-do-not-track="false"></script>';

      expect(Config.readInitOptions()?.respectDoNotTrack).toBe(false);
    });

    /*
     * No options means do nothing. Guessing an ingest host would mean posting
     * end-user screen content to an endpoint nobody configured.
     */
    it("returns null when a required field is missing", (): void => {
      document.head.innerHTML = '<script data-oneuptime-token="t"></script>';

      expect(Config.readInitOptions()).toBeNull();
    });

    /*
     * The documented install snippet is only token + app-identifier + src. It
     * has to work exactly as written: requiring an undocumented
     * data-oneuptime-host made the recorder silently do nothing for anyone
     * following the docs, which is how this was found - by running the demo
     * page against a real server and getting no recording and no error.
     */
    it("defaults the host to the origin the script was served from", (): void => {
      document.head.innerHTML =
        '<script src="https://replay.example.com/telemetry/session-replay/v1/recorder.js" data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      const options: RecorderInitOptions | null = Config.readInitOptions();

      expect(options).not.toBeNull();
      expect(options?.host).toBe("https://replay.example.com");
    });

    it("lets an explicit host win, for customers proxying the script", (): void => {
      document.head.innerHTML =
        '<script src="https://cdn.example.com/recorder.js" data-oneuptime-host="https://oneuptime.example.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      expect(Config.readInitOptions()?.host).toBe(
        "https://oneuptime.example.com",
      );
    });

    it("resolves a relative src against the page origin", (): void => {
      document.head.innerHTML =
        '<script src="/proxy/recorder.js" data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      const options: RecorderInitOptions | null = Config.readInitOptions();

      expect(options?.host).toBe(window.location.origin);
    });

    it("still returns null for an inline tag with no src and no host", (): void => {
      /*
       * Nothing to derive a host from, so recording must not start - the
       * fallback must never invent a destination for screen content.
       */
      document.head.innerHTML =
        '<script data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      expect(Config.readInitOptions()).toBeNull();
    });
  });

  describe("validateConfig", (): void => {
    it("accepts a complete body", (): void => {
      const config: LoaderConfig | null = Config.validateConfig(validBody);

      expect(config).toEqual({
        enabled: true,
        recorderVersion: "11.7.3",
        maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
        captureTrigger: SessionReplayCaptureTrigger.Always,
        consentMode: SessionReplayConsentMode.NotRequired,
        samplePercentage: 12.5,

        /* The numeric entry is dropped, not coerced. */
        maskSelectors: [".pii"],
        blockSelectors: [],
        urlAllowlist: ["coupon"],
        ignoreErrorPatterns: ["ResizeObserver loop"],
        recordCanvas: true,
        captureUserIdentity: true,
        respectDoNotTrack: false,
        configEpoch: 42,
        directive: "throttle",
        recorderIntegrity: "sha384-abc",

        /*
         * The unvalidated body rides along for the ARTIFACT to normalise
         * the fields the loader does not spend bytes validating. Same
         * object, not a copy - the loader must not pay for a clone.
         */
        raw: validBody,
      });

      expect(config?.raw).toBe(validBody);
    });

    it("refuses a body that does not say enabled", (): void => {
      expect(Config.validateConfig({ recorderVersion: "1.0.0" })).toBeNull();
      expect(
        Config.validateConfig({ enabled: false, recorderVersion: "1.0.0" }),
      ).toBeNull();
      expect(
        Config.validateConfig({ enabled: "true", recorderVersion: "1.0.0" }),
      ).toBeNull();
    });

    it("refuses a body with no pinned recorder version", (): void => {
      expect(Config.validateConfig({ enabled: true })).toBeNull();
    });

    /*
     * recorderVersion is interpolated straight into an artifact URL path, so
     * "non-empty string" was not enough: a config value of "../../../admin"
     * produced a <script src> pointing somewhere else entirely on the ingest
     * origin. Only a semver the build could have stamped is accepted.
     */
    it("refuses a recorder version that is not a plain semver", (): void => {
      const rejected: Array<string> = [
        "../../../admin",
        "1.0.0/../../evil",
        "1.0.0?x=1",
        "1.0.0#frag",
        "v1.0.0",
        "1.0",
        "latest",
        "1.0.0 ",
        "1.0.0/recorder.js",
        "//evil.example.com/x",
      ];

      for (const version of rejected) {
        expect(
          Config.validateConfig({ enabled: true, recorderVersion: version }),
        ).toBeNull();
        expect(Config.isValidRecorderVersion(version)).toBe(false);
      }
    });

    it("accepts the semver shapes the build can actually stamp", (): void => {
      for (const version of ["1.0.0", "11.7.3", "12.0.0-beta.1"]) {
        expect(Config.isValidRecorderVersion(version)).toBe(true);
        expect(
          Config.validateConfig({ enabled: true, recorderVersion: version })
            ?.recorderVersion,
        ).toBe(version);
      }
    });

    it("refuses a non-object body", (): void => {
      expect(Config.validateConfig(null)).toBeNull();
      expect(Config.validateConfig("enabled")).toBeNull();
    });

    /*
     * Every unrecognised value resolves to the SAFE option, never the useful
     * one. A garbled config must not be able to turn masking off.
     */
    it("defaults an unknown masking mode to MaskAllText", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
        maskingMode: "MaskNothing",
      });

      expect(config?.maskingMode).toBe(SessionReplayMaskingMode.MaskAllText);
    });

    it("defaults an unknown consent mode to RequireExplicit", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
        consentMode: "Whatever",
      });

      expect(config?.consentMode).toBe(
        SessionReplayConsentMode.RequireExplicit,
      );
    });

    it("defaults a missing sample percentage to 0", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
      });

      expect(config?.samplePercentage).toBe(0);
    });

    it("defaults respectDoNotTrack to true when absent", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
      });

      expect(config?.respectDoNotTrack).toBe(true);
    });

    it("defaults an unknown directive to continue", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
        directive: "explode",
      });

      expect(config?.directive).toBe("continue");
    });

    it("omits recorderIntegrity rather than setting it to undefined", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: true,
        recorderVersion: "1.0.0",
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          config as unknown as Record<string, unknown>,
          "recorderIntegrity",
        ),
      ).toBe(false);
    });
  });

  describe("urls and headers", (): void => {
    const options: RecorderInitOptions = {
      host: "https://oneuptime.com",
      token: "secret-token",
      appIdentifier: "app-1",
    };

    it("builds the config, chunk and artifact urls", (): void => {
      /*
       * All three carry the /telemetry prefix. The bare paths resolve on the
       * server (the router is mounted at "/" too) but NOT in a browser against
       * a real deployment: nginx's catch-all sends /session-replay/... to the
       * Home app, which 404s, while the CORS preflight still succeeds. The
       * recorder then stops with no error. Verified against a live server.
       */
      expect(Config.getConfigUrl(options)).toBe(
        "https://oneuptime.com/telemetry/session-replay/v1/config",
      );
      expect(getChunkUrl(options)).toBe(
        "https://oneuptime.com/telemetry/session-replay/v1/chunk",
      );
      expect(Config.getArtifactUrl(options, "11.7.3")).toBe(
        "https://oneuptime.com/telemetry/session-replay/v11.7.3/recorder.js",
      );
    });

    it("prefixes every server path with /telemetry", (): void => {
      /*
       * A guard rather than three separate assertions: any new endpoint added
       * here must carry the prefix, or it will 404 in production only.
       */
      for (const url of [
        Config.getConfigUrl(options),
        getChunkUrl(options),
        Config.getArtifactUrl(options, "11.7.3"),
      ]) {
        expect(url).toContain("/telemetry/session-replay");
      }
    });

    /*
     * Defence in depth behind validateConfig: nothing may assemble a script
     * URL from a version that is not a semver, whatever path it arrived by.
     */
    it("refuses to build an artifact url from a traversing version", (): void => {
      expect(Config.getArtifactUrl(options, "../../../admin")).toBeNull();
      expect(Config.getArtifactUrl(options, "")).toBeNull();
      expect(
        Config.getArtifactUrl(options, "1.0.0/../../../etc/passwd"),
      ).toBeNull();
    });

    /*
     * The app identifier travels as a HEADER because all three ingest-time
     * gates need it while the body is still an undecoded gzip buffer.
     */
    it("sends the token and the app identifier as headers", (): void => {
      expect(Config.getIngestHeaders(options)).toEqual({
        "x-oneuptime-token": "secret-token",
        "x-oneuptime-app-identifier": "app-1",
      });
    });
  });

  describe("fetchConfig", (): void => {
    afterEach((): void => {
      jest.restoreAllMocks();
    });

    const options: RecorderInitOptions = {
      host: "https://oneuptime.com",
      token: "t",
      appIdentifier: "a",
    };

    it("returns the validated config on success", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const config: LoaderConfig | null = await Config.fetchConfig(options);

      expect(config?.recorderVersion).toBe("11.7.3");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      /* No page userRef means no user-ref header at all. */
      expect(
        (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[
          "x-oneuptime-user-ref"
        ],
      ).toBeUndefined();
    });

    /*
     * The targeted-capture handshake: the reference rides the CONFIG fetch
     * as a header, URI-component-encoded because fetch() THROWS on a
     * non-ISO-8859-1 header value - an emoji in a customer's user id must
     * not disable recording wholesale.
     */
    it("sends the userRef percent-encoded on the config fetch only", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const config: LoaderConfig | null = await Config.fetchConfig({
        ...options,
        userRef: "jane+prod@例え.jp",
      });

      expect(config).not.toBeNull();

      const headers: Record<string, string> = fetchMock.mock.calls[0]?.[1]
        ?.headers as Record<string, string>;

      expect(headers["x-oneuptime-user-ref"]).toBe(
        encodeURIComponent("jane+prod@例え.jp"),
      );

      /* And the chunk-POST header set is untouched by the feature. */
      expect(Config.getIngestHeaders({ ...options, userRef: "jane" })).toEqual({
        "x-oneuptime-token": "t",
        "x-oneuptime-app-identifier": "a",
      });
    });

    /*
     * A LONE surrogate — a page that truncated a string through an emoji
     * — makes encodeURIComponent itself throw. That must skip targeting,
     * not reject fetchConfig: this function's contract is "resolves to
     * null on any failure", and an unhandled URIError here would surface
     * as an unhandled rejection on the customer's page.
     */
    it("a lone-surrogate userRef skips the header instead of throwing", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const config: LoaderConfig | null = await Config.fetchConfig({
        ...options,
        userRef: "user-\ud800-truncated",
      });

      /* The fetch still happened and recording still configures... */
      expect(config).not.toBeNull();

      /* ...just without the targeting header. */
      expect(
        (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[
          "x-oneuptime-user-ref"
        ],
      ).toBeUndefined();
    });

    /*
     * The server caps refs at 512 chars, and an unbounded page value can
     * push the request past HTTP header-size limits — killing the config
     * fetch and with it ALL recording. The loader slices before encoding.
     */
    it("truncates an oversized userRef to the server's 512-char cap", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      await Config.fetchConfig({
        ...options,
        userRef: "u".repeat(5000),
      });

      const sent: string = (
        fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
      )["x-oneuptime-user-ref"] as string;

      expect(sent).toBe("u".repeat(512));
    });

    it("a non-ASCII userRef cannot make the config fetch throw", async (): Promise<void> => {
      /*
       * Real fetch rejects invalid header values synchronously; emulate
       * that so the encoding regression would be caught here.
       */
      const fetchMock: jest.Mock = jest.fn(
        (_url: string, init?: RequestInit): Promise<unknown> => {
          const headers: Record<string, string> = (init?.headers ||
            {}) as Record<string, string>;

          for (const value of Object.values(headers)) {
            for (let i: number = 0; i < value.length; i++) {
              /* Outside ISO-8859-1: real fetch throws a TypeError. */
              if (value.charCodeAt(i) > 0xff) {
                throw new TypeError("Invalid header value");
              }
            }
          }

          return Promise.resolve({
            ok: true,
            status: 200,
            json: async (): Promise<unknown> => {
              return validBody;
            },
          });
        },
      );

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      const config: LoaderConfig | null = await Config.fetchConfig({
        ...options,
        userRef: "😀-user-42",
      });

      expect(config).not.toBeNull();
    });

    it("fails closed on a non-2xx response", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503 });

      expect(await Config.fetchConfig(options)).toBeNull();
    });

    it("fails closed on a network error", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("offline"));

      expect(await Config.fetchConfig(options)).toBeNull();
    });

    it("fails closed on an unparseable body", async (): Promise<void> => {
      (globalThis as unknown as Record<string, unknown>)["fetch"] = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async (): Promise<unknown> => {
            throw new Error("not json");
          },
        });

      expect(await Config.fetchConfig(options)).toBeNull();
    });

    it("never sends credentials", async (): Promise<void> => {
      const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

      await Config.fetchConfig(options);

      const init: Record<string, unknown> = fetchMock.mock
        .calls[0]?.[1] as Record<string, unknown>;

      expect(init["credentials"]).toBe("omit");
    });
  });
});
