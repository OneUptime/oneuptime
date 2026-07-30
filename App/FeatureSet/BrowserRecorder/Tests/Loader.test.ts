import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";

/*
 * The loader stub.
 *
 * Every assertion here is about a gate. The stub's whole job is to decide
 * NOT to load the recorder, and to do so before any of the recorder's ~50 KB
 * has been fetched, parsed or executed.
 */

const CONFIG_BODY: Record<string, unknown> = {
  enabled: true,
  recorderVersion: "11.7.3",
  maskingMode: SessionReplayMaskingMode.MaskAllText,
  consentMode: "NotRequired",
  captureTrigger: "OnErrorOrFrustration",
  samplePercentage: 0,
  maskSelectors: [],
  blockSelectors: [],
  urlAllowlist: [],
  recordCanvas: false,
  captureUserIdentity: false,
  respectDoNotTrack: true,
  configEpoch: 1,
  directive: "continue",
  recorderIntegrity: "sha384-testhash",
};

describe("Loader", (): void => {
  let fetchMock: jest.Mock;
  let bootstrapCalls: Array<unknown> = [];

  const setNavigatorSignal: (value: boolean) => void = (
    value: boolean,
  ): void => {
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      configurable: true,
      value: value,
    });
  };

  const setConfigResponse: (body: Record<string, unknown> | null) => void = (
    body: Record<string, unknown> | null,
  ): void => {
    fetchMock.mockResolvedValue({
      ok: body !== null,
      status: body === null ? 404 : 200,
      json: async (): Promise<unknown> => {
        return body;
      },
    });
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  /*
   * The stub is a side effect, not a library: importing it runs it. Modules
   * are reset between cases so each one gets a fresh execution.
   */
  const runLoader: () => Promise<void> = async (): Promise<void> => {
    jest.resetModules();

    await import("../src/Loader");

    await tick();
    await tick();
  };

  const injectedScript: () => HTMLScriptElement | null =
    (): HTMLScriptElement | null => {
      return document.querySelector<HTMLScriptElement>(
        'script[src*="/telemetry/session-replay/"]',
      );
    };

  beforeEach((): void => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    bootstrapCalls = [];

    setNavigatorSignal(false);

    (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ] = {
      host: "https://oneuptime.com",
      token: "tok",
      appIdentifier: "app-1",
    };

    (globalThis as unknown as Record<string, unknown>)["OneUptimeReplay"] = {
      bootstrap: (...args: Array<unknown>): void => {
        bootstrapCalls.push(args);
      },
    };

    fetchMock = jest.fn();
    (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;

    setConfigResponse(CONFIG_BODY);
  });

  afterEach((): void => {
    delete (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ];
    delete (globalThis as unknown as Record<string, unknown>)[
      "OneUptimeReplay"
    ];

    jest.restoreAllMocks();
  });

  it("bootstraps the already-present artifact with the fetched policy", async (): Promise<void> => {
    await runLoader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bootstrapCalls).toHaveLength(1);
  });

  it("does nothing without init options", async (): Promise<void> => {
    delete (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ];

    await runLoader();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bootstrapCalls).toHaveLength(0);
  });

  /*
   * The signal is checked BEFORE the config request. A user who has asked not
   * to be tracked should not have a request made about them just to find out
   * whether we would have recorded them.
   */
  it("makes no request at all when GPC is set", async (): Promise<void> => {
    setNavigatorSignal(true);

    await runLoader();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bootstrapCalls).toHaveLength(0);
  });

  it("records when both sides opt out of honouring the signal", async (): Promise<void> => {
    setNavigatorSignal(true);

    (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ] = {
      host: "https://oneuptime.com",
      token: "tok",
      appIdentifier: "app-1",
      respectDoNotTrack: false,
    };

    setConfigResponse({ ...CONFIG_BODY, respectDoNotTrack: false });

    await runLoader();

    expect(bootstrapCalls).toHaveLength(1);
  });

  it("still honours the signal when only the server insists", async (): Promise<void> => {
    setNavigatorSignal(true);

    (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ] = {
      host: "https://oneuptime.com",
      token: "tok",
      appIdentifier: "app-1",
      respectDoNotTrack: false,
    };

    setConfigResponse({ ...CONFIG_BODY, respectDoNotTrack: true });

    await runLoader();

    expect(fetchMock).toHaveBeenCalled();
    expect(bootstrapCalls).toHaveLength(0);
  });

  /* No config, no recording. */
  it("fails closed when the config request fails", async (): Promise<void> => {
    setConfigResponse(null);

    await runLoader();

    expect(bootstrapCalls).toHaveLength(0);
  });

  it("does nothing when the application is disabled", async (): Promise<void> => {
    setConfigResponse({ ...CONFIG_BODY, enabled: false });

    await runLoader();

    expect(bootstrapCalls).toHaveLength(0);
  });

  /*
   * The kill switch stops RECORDING, not merely ingest. Without it, turning
   * the feature off would leave live browsers recording into a buffer for the
   * rest of the page's life.
   */
  it("does nothing when the directive is stop", async (): Promise<void> => {
    setConfigResponse({ ...CONFIG_BODY, directive: "stop" });

    await runLoader();

    expect(bootstrapCalls).toHaveLength(0);
  });

  describe("artifact injection", (): void => {
    beforeEach((): void => {
      delete (globalThis as unknown as Record<string, unknown>)[
        "OneUptimeReplay"
      ];
    });

    it("injects the pinned, version-addressed artifact with SRI", async (): Promise<void> => {
      await runLoader();

      const script: HTMLScriptElement | null = injectedScript();

      expect(script?.getAttribute("src")).toBe(
        "https://oneuptime.com/telemetry/session-replay/v11.7.3/recorder.js",
      );

      /* crossOrigin is required for integrity to be enforced cross-origin. */
      expect(script?.crossOrigin).toBe("anonymous");
      expect(script?.integrity).toBe("sha384-testhash");
      expect(script?.async).toBe(true);
    });

    it("omits integrity when the server does not publish a hash", async (): Promise<void> => {
      const body: Record<string, unknown> = { ...CONFIG_BODY };
      delete body["recorderIntegrity"];

      setConfigResponse(body);

      await runLoader();

      expect(injectedScript()?.getAttribute("integrity")).toBeNull();
    });

    /*
     * The usual cause is a customer CSP that does not list our origin in
     * script-src, which fails silently from the page's point of view. It must
     * not turn into an exception on their page.
     */
    it("survives a blocked script without throwing", async (): Promise<void> => {
      await runLoader();

      const script: HTMLScriptElement | null = injectedScript();

      expect(script).not.toBeNull();

      expect((): void => {
        if (script && script.onerror) {
          script.onerror(new Event("error"));
        }
      }).not.toThrow();
    });

    it("bootstraps from the script's onload, never before", async (): Promise<void> => {
      await runLoader();

      const script: HTMLScriptElement | null = injectedScript();

      expect(bootstrapCalls).toHaveLength(0);

      (globalThis as unknown as Record<string, unknown>)["OneUptimeReplay"] = {
        bootstrap: (...args: Array<unknown>): void => {
          bootstrapCalls.push(args);
        },
      };

      if (script && script.onload) {
        script.onload(new Event("load"));
      }

      expect(bootstrapCalls).toHaveLength(1);
    });
  });
});
