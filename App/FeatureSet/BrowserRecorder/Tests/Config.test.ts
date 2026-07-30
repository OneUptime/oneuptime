import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import Config, { LoaderConfig, RecorderInitOptions } from "../src/Config";

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
        recordCanvas: true,
        captureUserIdentity: true,
        respectDoNotTrack: false,
        configEpoch: 42,
        directive: "throttle",
        recorderIntegrity: "sha384-abc",
      });
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
      expect(Config.getConfigUrl(options)).toBe(
        "https://oneuptime.com/session-replay/v1/config",
      );
      expect(Config.getChunkUrl(options)).toBe(
        "https://oneuptime.com/session-replay/v1/chunk",
      );
      expect(Config.getArtifactUrl(options, "11.7.3")).toBe(
        "https://oneuptime.com/telemetry/session-replay/v11.7.3/recorder.js",
      );
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
