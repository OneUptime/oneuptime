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
  ignoreErrorPatterns: [],
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

  /*
   * The page's explicit opt-out wins over the server default.
   *
   * The server always sends respectDoNotTrack: true as its default, so the
   * old "server insisting wins" rule made the documented
   * data-oneuptime-respect-do-not-track="false" attribute impossible to use -
   * a customer whose lawful basis does not depend on DNT could never record,
   * with no error to explain it. The customer owns the lawful basis for their
   * own site, so their explicit declaration is theirs to make.
   */
  it("records when the page explicitly opts out, even though the server default insists", async (): Promise<void> => {
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
    expect(bootstrapCalls).toHaveLength(1);
  });

  /* Doing nothing still honours the signal - the default must stay private. */
  it("does not record when the page says nothing and a signal is present", async (): Promise<void> => {
    setNavigatorSignal(true);

    (window as unknown as Record<string, unknown>)[
      "__ONEUPTIME_SESSION_REPLAY__"
    ] = {
      host: "https://oneuptime.com",
      token: "tok",
      appIdentifier: "app-1",
    };

    setConfigResponse({ ...CONFIG_BODY, respectDoNotTrack: true });

    await runLoader();

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

  /*
   * The pre-load error buffer: the window between the stub starting and
   * the artifact's first listener used to be a void for the most valuable
   * failure class an error-triggered recorder has.
   */
  describe("pre-load error buffer", (): void => {
    /*
     * The config response is released manually, so the test controls
     * exactly what happens inside the buffer's window.
     */
    const runLoaderWithHeldConfig: () => Promise<
      () => void
    > = async (): Promise<() => void> => {
      let release: () => void = (): void => {
        /* replaced below */
      };

      fetchMock.mockReturnValue(
        new Promise((resolve: (value: unknown) => void): void => {
          release = (): void => {
            resolve({
              ok: true,
              status: 200,
              json: async (): Promise<unknown> => {
                return CONFIG_BODY;
              },
            });
          };
        }),
      );

      jest.resetModules();
      await import("../src/Loader");

      return release;
    };

    it("hands errors captured during the config round trip to bootstrap", async (): Promise<void> => {
      const release: () => void = await runLoaderWithHeldConfig();

      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "boom during startup",
          filename: "https://shop.example.com/app.js",
        }),
      );

      release();
      await tick();
      await tick();

      expect(bootstrapCalls).toHaveLength(1);

      const earlyErrors: Array<{ message: string; source?: string }> = (
        bootstrapCalls[0] as Array<unknown>
      )[2] as Array<{ message: string; source?: string }>;

      expect(earlyErrors).toHaveLength(1);
      expect(earlyErrors[0]!.message).toBe("boom during startup");
      expect(earlyErrors[0]!.source).toBe("https://shop.example.com/app.js");
    });

    it("a fail-closed exit uninstalls the listeners and hands over nothing", async (): Promise<void> => {
      const removeSpy: jest.SpyInstance = jest.spyOn(
        window,
        "removeEventListener",
      );

      let release: () => void = (): void => {
        /* replaced below */
      };

      fetchMock.mockReturnValue(
        new Promise((resolve: (value: unknown) => void): void => {
          release = (): void => {
            resolve({
              ok: true,
              status: 200,
              json: async (): Promise<unknown> => {
                return { ...CONFIG_BODY, directive: "stop" };
              },
            });
          };
        }),
      );

      jest.resetModules();
      await import("../src/Loader");

      window.dispatchEvent(
        new ErrorEvent("error", { message: "captured then discarded" }),
      );

      release();
      await tick();
      await tick();

      expect(bootstrapCalls).toHaveLength(0);
      expect(removeSpy).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
        true,
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function),
        true,
      );
    });

    it("a user with a privacy signal never gets listeners at all", async (): Promise<void> => {
      setNavigatorSignal(true);

      const addSpy: jest.SpyInstance = jest.spyOn(window, "addEventListener");

      await runLoader();

      const errorListenerCalls: Array<unknown> = addSpy.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return call[0] === "error" || call[0] === "unhandledrejection";
        },
      );

      expect(errorListenerCalls).toHaveLength(0);
    });
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

    /*
     * The version names a path on the ingest origin. A server (or a
     * man-in-the-middle with a compromised config response) that answers with
     * a traversing version must not get a script tag pointing at whatever it
     * chose - and must not get a request for an artifact that was never
     * published either.
     */
    it("injects nothing when the advertised version is not a semver", async (): Promise<void> => {
      for (const version of ["../../../admin", "latest", "1.0"]) {
        document.head.innerHTML = "";
        setConfigResponse({ ...CONFIG_BODY, recorderVersion: version });

        await runLoader();

        expect(injectedScript()).toBeNull();
        expect(bootstrapCalls).toHaveLength(0);
      }
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
