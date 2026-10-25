import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Mock, SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement } from "react";
import ContainedErrorBoundary, {
  ContainedErrorFallbackProps,
} from "../../../../UI/Components/ContainedErrorBoundary/ContainedErrorBoundary";
import ErrorBoundary from "../../../../UI/Components/ErrorBoundary";
import {
  ChunkLoadRecoveryInput,
  ChunkLoadRecoveryStep,
  CHUNK_LOAD_RETRY_INTERVAL_IN_MS,
  decideChunkLoadRecovery,
} from "../../../../UI/Components/NewVersion/ChunkLoadRecovery";
import {
  CHUNK_LOAD_RELOAD_STORAGE_KEY,
  markChunkLoadErrorReload,
} from "../../../../UI/Utils/NewVersion/ChunkLoadError";
import NewVersion, {
  NEW_VERSION_PLACE_KEY,
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import {
  FetchFunction,
  ServerBuildStatus,
} from "../../../../UI/Utils/NewVersion/ServerBuildCheck";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * A page whose code will not download after a deploy: what the reader sees
 * in place of "Something went wrong" and a sudden reload. The decision is
 * pinned as a table first; then the screens themselves, through the app's
 * own boundaries (ErrorBoundary for a page, ContainedErrorBoundary for a
 * part), against a fake server that answers - or does not - the way a real
 * one does after a deploy.
 */

const RUNNING: string = "14.0.89-aaaa-0001";
const NEWER: string = "14.0.90-bbbb-0002";

const CHUNK_ERROR: string =
  "Failed to fetch dynamically imported module: https://oneuptime.example/dashboard/dist/MonitorsRoutes-ABCDEFGH.js";

describe("decideChunkLoadRecovery", () => {
  const base: ChunkLoadRecoveryInput = {
    isPageBeingLeft: false,
    isReloadInProgress: false,
    isOffline: false,
    check: { status: ServerBuildStatus.New, serverBuildId: NEWER },
    hasRecentlyReloaded: false,
    hasUnsavedChanges: false,
  };

  test.each<
    [string, Partial<ChunkLoadRecoveryInput>, ChunkLoadRecoveryStep, boolean]
  >([
    [
      "a new version: updating, and reload",
      {},
      ChunkLoadRecoveryStep.Updating,
      true,
    ],
    [
      "the server answers with no manifest: it serves another build, updating",
      { check: { status: ServerBuildStatus.NoManifest, serverBuildId: null } },
      ChunkLoadRecoveryStep.Updating,
      true,
    ],
    [
      "the same version: a download cut short, reload behind the loader",
      { check: { status: ServerBuildStatus.Same, serverBuildId: RUNNING } },
      ChunkLoadRecoveryStep.Reloading,
      true,
    ],
    [
      "no build to compare (no answer asked for): reload, as before",
      { check: null },
      ChunkLoadRecoveryStep.Reloading,
      true,
    ],
    [
      "reloaded for it a moment ago: gone for good, it says so",
      { hasRecentlyReloaded: true },
      ChunkLoadRecoveryStep.Failed,
      false,
    ],
    [
      "unsaved changes: asks before the reload",
      { hasUnsavedChanges: true },
      ChunkLoadRecoveryStep.NeedsReload,
      false,
    ],
    [
      "offline: never a reload into the browser's error page",
      { isOffline: true, check: null },
      ChunkLoadRecoveryStep.Offline,
      false,
    ],
    [
      "the server does not answer",
      { check: { status: ServerBuildStatus.Unreachable, serverBuildId: null } },
      ChunkLoadRecoveryStep.Unreachable,
      false,
    ],
    [
      "the server is restarting (5xx)",
      { check: { status: ServerBuildStatus.Unavailable, serverBuildId: null } },
      ChunkLoadRecoveryStep.Unreachable,
      false,
    ],
    [
      "the page is being left: the next one is on its way",
      { isPageBeingLeft: true },
      ChunkLoadRecoveryStep.Checking,
      false,
    ],
    [
      "another part is reloading already: updating, no second reload",
      { isReloadInProgress: true, hasRecentlyReloaded: true },
      ChunkLoadRecoveryStep.Updating,
      false,
    ],
    [
      "offline wins over a recent reload: it is not gone, it is offline",
      { isOffline: true, hasRecentlyReloaded: true },
      ChunkLoadRecoveryStep.Offline,
      false,
    ],
    [
      "a server that does not answer wins over unsaved changes: nothing to reload into",
      {
        hasUnsavedChanges: true,
        check: { status: ServerBuildStatus.Unreachable, serverBuildId: null },
      },
      ChunkLoadRecoveryStep.Unreachable,
      false,
    ],
    [
      "a recent reload wins over unsaved changes: a reload would not help",
      { hasUnsavedChanges: true, hasRecentlyReloaded: true },
      ChunkLoadRecoveryStep.Failed,
      false,
    ],
  ])(
    "%s",
    (
      _label: string,
      overrides: Partial<ChunkLoadRecoveryInput>,
      step: ChunkLoadRecoveryStep,
      reload: boolean,
    ) => {
      expect(decideChunkLoadRecovery({ ...base, ...overrides })).toEqual({
        step,
        reload,
      });
    },
  );
});

interface FakeServer {
  fetchFunction: FetchFunction;
  requests: () => number;
  serve: (buildId: string) => void;
  answerWith: (status: number) => void;
  fail: () => void;
}

const makeServer: () => FakeServer = (): FakeServer => {
  let requests: number = 0;
  let status: number = 200;
  let body: string = JSON.stringify({ buildId: NEWER });
  let isFailing: boolean = false;

  return {
    fetchFunction: (): Promise<Response> => {
      requests++;

      if (isFailing) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }

      return Promise.resolve({
        status: status,
        ok: status >= 200 && status < 300,
        text: (): Promise<string> => {
          return Promise.resolve(body);
        },
      } as unknown as Response);
    },
    requests: (): number => {
      return requests;
    },
    serve: (buildId: string): void => {
      status = 200;
      isFailing = false;
      body = JSON.stringify({ buildId });
    },
    answerWith: (nextStatus: number): void => {
      status = nextStatus;
      isFailing = false;
    },
    fail: (): void => {
      isFailing = true;
    },
  };
};

const ORIGINAL_LOCATION: Location = window.location;
let reloadMock: Mock<() => void>;
let server: FakeServer;
let consoleErrorSpy: SpyInstance<typeof console.error>;
let consoleWarnSpy: SpyInstance<typeof console.warn>;

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

const start: (audience?: NewVersionAudience) => void = (
  audience?: NewVersionAudience,
): void => {
  NewVersion.start({
    audience: audience || NewVersionAudience.Members,
    runningBuild: {
      buildId: RUNNING,
      manifestUrl: "/dashboard/dist/build.json",
    },
    fetchFunction: server.fetchFunction,
    // Out of the way: these tests ask the server only through the recovery.
    firstCheckDelayInMs: 24 * 60 * 60 * 1000,
  });
};

const ChunkFailure: FunctionComponent = (): ReactElement => {
  throw new Error(CHUNK_ERROR);
};

const renderPage: () => void = (): void => {
  render(
    <div>
      <nav data-testid="side-menu">Side menu</nav>
      <ErrorBoundary resetKey="/dashboard/project/monitors">
        <ChunkFailure />
      </ErrorBoundary>
    </div>,
  );
};

const recovery: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("chunk-load-recovery");
};

const stepOf: () => string | null = (): string | null => {
  return (
    screen.queryByTestId("chunk-load-recovery")?.getAttribute("data-step") ||
    null
  );
};

beforeEach(() => {
  NewVersion.reset();
  UnsavedChanges.reset();
  UnsavedChanges.install();
  window.sessionStorage.clear();
  window.name = "";
  setOnline(true);
  server = makeServer();

  reloadMock = jest.fn<() => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      ...ORIGINAL_LOCATION,
      href: "https://oneuptime.example/dashboard/project/monitors?status=down",
      reload: reloadMock,
    },
  });

  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
  consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  NewVersion.reset();
  UnsavedChanges.reset();
  setOnline(true);
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  window.dispatchEvent(new Event("pageshow"));
  jest.useRealTimers();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("a page whose code did not download (the app's ErrorBoundary)", () => {
  test("NO 'SOMETHING WENT WRONG' FOR A DEPLOY: says it is updating to the new version, and reloads once", async () => {
    start();
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(stepOf()).toBe(ChunkLoadRecoveryStep.Updating);
    expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
      "Updating to the new version",
    );
    expect(recovery()).toHaveTextContent(
      "OneUptime was updated while you had it open. This page will open in the new version in a moment.",
    );
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
    // The menus outside the page stay put.
    expect(screen.getByTestId("side-menu")).toBeInTheDocument();
    // Asked the server once, and remembered the reload for the cooldown.
    expect(server.requests()).toBe(1);
    expect(TabMemory.get(CHUNK_LOAD_RELOAD_STORAGE_KEY)).not.toBeNull();
  });

  test("the reload keeps the address, the query and the place", async () => {
    start();
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(JSON.parse(TabMemory.get(NEW_VERSION_PLACE_KEY) || "{}")).toEqual(
      expect.objectContaining({
        href: "https://oneuptime.example/dashboard/project/monitors?status=down",
      }),
    );
  });

  test("a status page or public dashboard says it in words that never name OneUptime", async () => {
    start(NewVersionAudience.Visitors);
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
      "Loading the latest version",
    );
    expect(recovery()).toHaveTextContent(
      "A newer version of this page is available. It's loading now.",
    );
    expect(recovery().textContent || "").not.toContain("OneUptime");
  });

  test("the same version on the server: one reload behind the page's own loader, no message", async () => {
    server.serve(RUNNING);
    start();
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(stepOf()).toBe(ChunkLoadRecoveryStep.Reloading);
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("chunk-load-recovery-title")).toBeNull();
  });

  test("a tab whose code names no build reloads once, as it always did", async () => {
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(server.requests()).toBe(0);
  });

  test("NO RELOAD LOOP: reloaded for it a moment ago, it says the page couldn't be loaded", async () => {
    markChunkLoadErrorReload(Date.now());
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
    });

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("error-boundary-title")).toHaveTextContent(
      "This page couldn't be loaded",
    );
    expect(screen.getByTestId("error-boundary-fallback")).toHaveTextContent(
      "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
    );
    expect(screen.queryByText("Something went wrong")).toBeNull();
    // Drawing it again would fail the same way: no Try again.
    expect(screen.queryByTestId("error-boundary-try-again")).toBeNull();
    // Reload, the support bundle and the details are there for the reader.
    expect(screen.getByTestId("error-boundary-reload")).toBeInTheDocument();
    expect(
      screen.getByTestId("error-boundary-download-support-bundle"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("error-boundary-error-message"),
    ).toHaveTextContent("Failed to fetch dynamically imported module");
    // A real failure still reaches the console (and RUM).
    expect(
      consoleErrorSpy.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("could not be downloaded");
      }),
    ).toBe(true);
  });

  test("a visitor's failed page has no support bundle to send to OneUptime", async () => {
    markChunkLoadErrorReload(Date.now());
    start(NewVersionAudience.Visitors);
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
    });

    expect(
      screen.queryByTestId("error-boundary-download-support-bundle"),
    ).toBeNull();
    expect(screen.getByTestId("error-boundary-reload")).toBeInTheDocument();
  });

  test("Reload page on the failed screen reloads", async () => {
    markChunkLoadErrorReload(Date.now());
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
    });

    fireEvent.click(screen.getByTestId("error-boundary-reload"));

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("OFFLINE: says so, asks nothing, and loads as soon as the browser is back online", async () => {
    setOnline(false);
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Offline);
    });

    expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
      "You're offline",
    );
    expect(recovery()).toHaveTextContent(
      "This page needs an internet connection to load. It will load as soon as you're back online.",
    );
    expect(screen.getByTestId("chunk-load-recovery-retry")).toHaveTextContent(
      "Try again",
    );
    expect(server.requests()).toBe(0);
    expect(reloadMock).not.toHaveBeenCalled();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  test("Try again while still offline keeps saying it is offline", async () => {
    setOnline(false);
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Offline);
    });

    fireEvent.click(screen.getByTestId("chunk-load-recovery-retry"));

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Offline);
    });
    expect(reloadMock).not.toHaveBeenCalled();
  });

  test.each<[string, (s: FakeServer) => void]>([
    [
      "does not answer",
      (s: FakeServer): void => {
        s.fail();
      },
    ],
    [
      "answers 503 while it restarts",
      (s: FakeServer): void => {
        s.answerWith(503);
      },
    ],
  ])(
    "a server that %s: it says so, and loads once the server is back",
    async (_label: string, setUp: (s: FakeServer) => void) => {
      jest.useFakeTimers();
      setUp(server);
      start();
      renderPage();

      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(stepOf()).toBe(ChunkLoadRecoveryStep.Unreachable);
      });

      expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
        "Can't reach the server",
      );
      expect(recovery()).toHaveTextContent(
        "It may be restarting after an update. This page will load as soon as the server is back.",
      );
      expect(screen.getByTestId("chunk-load-recovery-retry")).toHaveTextContent(
        "Try now",
      );
      expect(reloadMock).not.toHaveBeenCalled();

      // Still down at the next try: the same screen, no reload.
      await act(async () => {
        jest.advanceTimersByTime(CHUNK_LOAD_RETRY_INTERVAL_IN_MS);
      });
      await waitFor(() => {
        expect(server.requests()).toBe(2);
      });
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Unreachable);
      expect(reloadMock).not.toHaveBeenCalled();

      // Back, with the new version.
      server.serve(NEWER);
      await act(async () => {
        jest.advanceTimersByTime(CHUNK_LOAD_RETRY_INTERVAL_IN_MS);
      });

      await waitFor(() => {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      });
    },
  );

  test("Try now asks again at once", async () => {
    server.fail();
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Unreachable);
    });

    server.serve(NEWER);
    fireEvent.click(screen.getByTestId("chunk-load-recovery-retry"));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  test("UNSAVED CHANGES: asks before the reload that would lose them, and reloads when told to", async () => {
    const release: () => void = UnsavedChanges.hold();
    start();
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.NeedsReload);
    });

    expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
      "A new version of OneUptime is ready",
    );
    expect(recovery()).toHaveTextContent(
      "This page needs the new version to open. Reloading discards changes you haven't saved.",
    );
    expect(reloadMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chunk-load-recovery-reload"));

    expect(reloadMock).toHaveBeenCalledTimes(1);
    release();
  });

  test("a visitor with unsaved changes is told the page has a newer version, not OneUptime", async () => {
    const release: () => void = UnsavedChanges.hold();
    start(NewVersionAudience.Visitors);
    renderPage();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.NeedsReload);
    });

    expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
      "A newer version of this page is ready",
    );
    release();
  });

  test("leaving the page cut the download off: no reload, no cooldown handed to the next page", async () => {
    start();
    window.dispatchEvent(new Event("beforeunload"));
    renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    expect(stepOf()).toBe(ChunkLoadRecoveryStep.Checking);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(TabMemory.get(CHUNK_LOAD_RELOAD_STORAGE_KEY)).toBeNull();
    expect(server.requests()).toBe(0);
  });

  test("logs a warning, not an error, for a part that will be loaded", async () => {
    start();
    renderPage();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(
      consoleWarnSpy.mock.calls.some((call: Array<unknown>) => {
        return call[0] === "A part of this page did not download:";
      }),
    ).toBe(true);
    expect(
      consoleErrorSpy.mock.calls.some((call: Array<unknown>) => {
        return call[0] === "Uncaught error rendering the app:";
      }),
    ).toBe(false);
  });

  test("a page saying it itself keeps the notice away while it shows, and lets go after", async () => {
    const release: () => void = UnsavedChanges.hold();
    start();
    const { unmount } = render(
      <ErrorBoundary>
        <ChunkFailure />
      </ErrorBoundary>,
    );

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.NeedsReload);
    });
    expect(NewVersion.isNoticeHeld()).toBe(true);

    unmount();
    expect(NewVersion.isNoticeHeld()).toBe(false);
    release();
  });

  test("an ordinary render error still shows Something went wrong, with Try again", () => {
    const Broken: FunctionComponent = (): ReactElement => {
      throw new Error("Cannot read properties of undefined (reading 'x')");
    };

    start();
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByTestId("error-boundary-try-again")).toBeInTheDocument();
    expect(screen.queryByTestId("chunk-load-recovery")).toBeNull();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(server.requests()).toBe(0);
  });
});

describe("a part of a page whose code did not download (ContainedErrorBoundary)", () => {
  const fallback: (data: ContainedErrorFallbackProps) => ReactElement = (
    data: ContainedErrorFallbackProps,
  ): ReactElement => {
    return <div data-testid="widget-fallback">{data.error.message}</div>;
  };

  const renderPart: () => void = (): void => {
    render(
      <div>
        <p data-testid="rest-of-page">Rest of the page</p>
        <ContainedErrorBoundary renderFallback={fallback}>
          <ChunkFailure />
        </ContainedErrorBoundary>
      </div>,
    );
  };

  test("says it is loading the latest version in its own place, and the page reloads into it", async () => {
    start();
    renderPart();

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    expect(recovery()).toHaveAttribute("data-variant", "part");
    expect(recovery()).toHaveTextContent("Loading the latest version...");
    expect(screen.getByTestId("rest-of-page")).toBeInTheDocument();
    // Not the caller's fallback: the part did nothing wrong.
    expect(screen.queryByTestId("widget-fallback")).toBeNull();
  });

  test("with unsaved changes elsewhere on the page it asks, and nothing reloads", async () => {
    const release: () => void = UnsavedChanges.hold();
    start();
    renderPart();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.NeedsReload);
    });

    expect(recovery()).toHaveTextContent(
      "This needs the latest version. Save your changes, then reload the page.",
    );
    expect(reloadMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("chunk-load-recovery-reload"));
    expect(reloadMock).toHaveBeenCalledTimes(1);
    release();
  });

  test("reloaded for it a moment ago: it says it couldn't be loaded, with Reload page", async () => {
    markChunkLoadErrorReload(Date.now());
    start();
    renderPart();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
    });

    expect(recovery()).toHaveTextContent("This couldn't be loaded.");
    expect(screen.getByTestId("chunk-load-recovery-reload")).toHaveTextContent(
      "Reload page",
    );
    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("offline: it says so in its place, with Try again", async () => {
    setOnline(false);
    start();
    renderPart();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Offline);
    });

    expect(recovery()).toHaveTextContent(
      "You're offline. This will load when you're back online.",
    );
    expect(screen.getByTestId("chunk-load-recovery-retry")).toBeInTheDocument();
  });

  test("a server that does not answer: it says it is trying again", async () => {
    server.fail();
    start();
    renderPart();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.Unreachable);
    });

    expect(recovery()).toHaveTextContent(
      "Can't reach the server. Trying again automatically.",
    );
  });

  test("leaves the notice to speak for the whole app", async () => {
    const release: () => void = UnsavedChanges.hold();
    start();
    renderPart();

    await waitFor(() => {
      expect(stepOf()).toBe(ChunkLoadRecoveryStep.NeedsReload);
    });

    expect(NewVersion.isNoticeHeld()).toBe(false);
    release();
  });

  test("several parts failing at once ask the server once and reload the page once", async () => {
    start();
    render(
      <div>
        {[1, 2, 3].map((index: number) => {
          return (
            <ContainedErrorBoundary key={index} renderFallback={fallback}>
              <ChunkFailure />
            </ContainedErrorBoundary>
          );
        })}
      </div>,
    );

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(server.requests()).toBe(1);
    expect(
      screen
        .getAllByTestId("chunk-load-recovery")
        .map((element: HTMLElement) => {
          return element.getAttribute("data-step");
        }),
    ).toEqual([
      ChunkLoadRecoveryStep.Updating,
      ChunkLoadRecoveryStep.Updating,
      ChunkLoadRecoveryStep.Updating,
    ]);
  });

  describe("drawn as the part draws its own states, never as a box of its own", () => {
    const CSS_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;

    const icon: () => HTMLElement | null = (): HTMLElement | null => {
      return screen.queryByTestId("chunk-load-recovery-icon");
    };

    const buttonsOf: () => Array<HTMLElement> = (): Array<HTMLElement> => {
      return Array.from(recovery().querySelectorAll("button"));
    };

    test("an icon in a soft circle above its words, in the middle of the part", async () => {
      start();
      renderPart();

      await waitFor(() => {
        expect(stepOf()).toBe(ChunkLoadRecoveryStep.Updating);
      });

      // One centred column: the circle, then the words.
      const body: Element | null = recovery().querySelector(".oueb-part-body");
      expect(body).not.toBeNull();
      expect(body!.firstElementChild).toBe(icon());
      expect(icon()).toHaveClass("oueb-part-icon");
      expect(icon()!.nextElementSibling).toHaveTextContent(
        "Loading the latest version...",
      );
      // On the part's own surface: no border, no background of its own.
      const css: string = (
        recovery().querySelector("style")!.textContent || ""
      ).replace(CSS_COMMENT, "");
      const ruleFor: (selector: string) => string = (
        selector: string,
      ): string => {
        for (const rule of css.split("}")) {
          const [head, body] = rule.split("{");

          if ((head || "").trim() === selector) {
            return body || "";
          }
        }

        return "";
      };

      expect(ruleFor(".oueb-part")).toContain("overflow: auto");
      expect(ruleFor(".oueb-part")).not.toContain("border");
      expect(ruleFor(".oueb-part")).not.toContain("background");
      expect(ruleFor(".oueb-part-body")).toContain("margin: auto");
      expect(ruleFor(".oueb-part-body")).toContain("text-align: center");
      expect(ruleFor(".oueb-part-icon")).toContain("border-radius: 9999px");
    });

    test.each<[string, () => void, ChunkLoadRecoveryStep, string]>([
      [
        "loading the new version: the accent",
        (): void => {},
        ChunkLoadRecoveryStep.Updating,
        "oueb-part-icon-info",
      ],
      [
        "waiting for a reload the reader allows: the accent",
        (): void => {
          UnsavedChanges.hold();
        },
        ChunkLoadRecoveryStep.NeedsReload,
        "oueb-part-icon-info",
      ],
      [
        "could not be loaded: the amber of a widget that cannot be drawn",
        (): void => {
          markChunkLoadErrorReload(Date.now());
        },
        ChunkLoadRecoveryStep.Failed,
        "oueb-part-icon-warning",
      ],
    ])(
      "the circle's colour says which moment it is - %s",
      async (
        _name: string,
        arrange: () => void,
        step: ChunkLoadRecoveryStep,
        toneClassName: string,
      ) => {
        arrange();
        start();
        renderPart();

        await waitFor(() => {
          expect(stepOf()).toBe(step);
        });

        expect(icon()).toHaveClass(toneClassName);
      },
    );

    test.each<[string, () => void, ChunkLoadRecoveryStep]>([
      [
        "offline",
        (): void => {
          setOnline(false);
        },
        ChunkLoadRecoveryStep.Offline,
      ],
      [
        "no answer from the server",
        (): void => {
          server.fail();
        },
        ChunkLoadRecoveryStep.Unreachable,
      ],
    ])(
      "%s: a quiet grey circle - nothing is wrong with the part",
      async (
        _name: string,
        arrange: () => void,
        step: ChunkLoadRecoveryStep,
      ) => {
        arrange();
        start();
        renderPart();

        await waitFor(() => {
          expect(stepOf()).toBe(step);
        });

        expect(icon()).toHaveClass("oueb-part-icon");
        expect(icon()).not.toHaveClass("oueb-part-icon-info");
        expect(icon()).not.toHaveClass("oueb-part-icon-warning");
      },
    );

    test.each<[string, () => void, ChunkLoadRecoveryStep, string]>([
      [
        "Reload page, unsaved changes elsewhere",
        (): void => {
          UnsavedChanges.hold();
        },
        ChunkLoadRecoveryStep.NeedsReload,
        "Reload page",
      ],
      [
        "Reload page, once it could not be loaded",
        (): void => {
          markChunkLoadErrorReload(Date.now());
        },
        ChunkLoadRecoveryStep.Failed,
        "Reload page",
      ],
      [
        "Try again, offline",
        (): void => {
          setOnline(false);
        },
        ChunkLoadRecoveryStep.Offline,
        "Try again",
      ],
    ])(
      "its one button is small and plain, as a widget's own Try again - %s",
      async (
        _name: string,
        arrange: () => void,
        step: ChunkLoadRecoveryStep,
        label: string,
      ) => {
        arrange();
        start();
        renderPart();

        await waitFor(() => {
          expect(stepOf()).toBe(step);
        });

        const buttons: Array<HTMLElement> = buttonsOf();
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveTextContent(label);
        expect(buttons[0]).toHaveClass("oueb-button-small");
        expect(buttons[0]).toHaveClass("oueb-button-secondary");
        expect(buttons[0]).not.toHaveClass("oueb-button-primary");
      },
    );

    test("a short part leaves the icon out, so its words and button fit", async () => {
      markChunkLoadErrorReload(Date.now());
      start();
      render(
        <ContainedErrorBoundary renderFallback={fallback} isCompact={true}>
          <ChunkFailure />
        </ContainedErrorBoundary>,
      );

      await waitFor(() => {
        expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
      });

      expect(icon()).toBeNull();
      expect(recovery()).toHaveTextContent("This couldn't be loaded.");
      expect(
        screen.getByTestId("chunk-load-recovery-reload"),
      ).toHaveTextContent("Reload page");
    });

    test("a part that is not short keeps it", async () => {
      markChunkLoadErrorReload(Date.now());
      start();
      render(
        <ContainedErrorBoundary renderFallback={fallback} isCompact={false}>
          <ChunkFailure />
        </ContainedErrorBoundary>,
      );

      await waitFor(() => {
        expect(stepOf()).toBe(ChunkLoadRecoveryStep.Failed);
      });

      expect(icon()).not.toBeNull();
    });
  });

  test("an ordinary error still gets the caller's fallback", () => {
    const Broken: FunctionComponent = (): ReactElement => {
      throw new Error("Widget exploded");
    };

    start();
    render(
      <ContainedErrorBoundary renderFallback={fallback}>
        <Broken />
      </ContainedErrorBoundary>,
    );

    expect(screen.getByTestId("widget-fallback")).toHaveTextContent(
      "Widget exploded",
    );
    expect(screen.queryByTestId("chunk-load-recovery")).toBeNull();
  });
});
