import ErrorBoundary, {
  CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS,
  CHUNK_LOAD_RELOAD_STORAGE_KEY,
  handleChunkLoadError,
  hasRecentlyReloadedForChunkLoadError,
  isChunkLoadError,
  markChunkLoadErrorReload,
} from "../../../UI/Components/ErrorBoundary";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * The blank white screen users hit is React unmounting the entire tree when a
 * render throws and nothing catches it. These tests pin down the containment
 * contract: a throwing subtree must degrade to a readable, recoverable fallback
 * while everything around it keeps rendering — never to an empty document.
 *
 * Assertions here deliberately use plain DOM checks rather than jest-dom
 * matchers (toBeInTheDocument etc). Common's tsconfig does not list
 * testing-library__jest-dom in "types", so those matchers do not type-check.
 */

const ORIGINAL_LOCATION: Location = window.location;

let reloadMock: jest.Mock;

function mockReload(): void {
  reloadMock = jest.fn();

  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...ORIGINAL_LOCATION, reload: reloadMock },
  });
}

function restoreLocation(): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
}

/** Throws while rendering — the failure mode that blanks the screen. */
const ThrowOnRender: FunctionComponent<{ message?: string }> = (props: {
  message?: string;
}): ReactElement => {
  throw new Error(props.message || "Render exploded");
};

/** Throws from an effect, after the first paint. */
const ThrowInEffect: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    throw new Error("Effect exploded");
  }, []);

  return <div>Effect Throwing Component</div>;
};

const FALLBACK_TEXT: string =
  "An unexpected error has occurred. Please reload the page to continue";

describe("ErrorBoundary", () => {
  const consoleErrorSpy: jest.SpyInstance = jest.spyOn(console, "error");

  beforeAll(() => {
    consoleErrorSpy.mockImplementation(() => {});
  });

  beforeEach(() => {
    consoleErrorSpy.mockClear();
    window.sessionStorage.clear();
    mockReload();
  });

  afterEach(() => {
    restoreLocation();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("happy path", () => {
    test("renders children when no error is thrown", () => {
      render(
        <ErrorBoundary>
          <div>Child Component</div>
        </ErrorBoundary>,
      );

      expect(screen.queryByText("Child Component")).not.toBeNull();
      expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
    });

    test("renders multiple children", () => {
      render(
        <ErrorBoundary>
          <div>First</div>
          <div>Second</div>
        </ErrorBoundary>,
      );

      expect(screen.queryByText("First")).not.toBeNull();
      expect(screen.queryByText("Second")).not.toBeNull();
    });

    test("does not reload the page when nothing goes wrong", () => {
      render(
        <ErrorBoundary>
          <div>Child Component</div>
        </ErrorBoundary>,
      );

      expect(reloadMock).not.toHaveBeenCalled();
    });
  });

  describe("containment", () => {
    test("renders the fallback when a child throws during render", () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
      expect(screen.queryByTestId("error-boundary-fallback")).not.toBeNull();
    });

    test("renders the fallback when a child throws from an effect", () => {
      render(
        <ErrorBoundary>
          <ThrowInEffect />
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
    });

    test("THE BLANK SCREEN: the document is never left empty", () => {
      const { container } = render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      /*
       * Before the boundary was wired up this subtree rendered to nothing at
       * all — the whole app painted white, with no text and no way back.
       */
      expect(container.textContent!.trim().length).toBeGreaterThan(0);
      expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
    });

    test("siblings outside the boundary keep rendering", () => {
      render(
        <div>
          <div>Navigation Bar</div>
          <ErrorBoundary>
            <ThrowOnRender />
          </ErrorBoundary>
          <div>Footer</div>
        </div>,
      );

      // One broken page must not take the shell down with it.
      expect(screen.queryByText("Navigation Bar")).not.toBeNull();
      expect(screen.queryByText("Footer")).not.toBeNull();
      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
    });

    test("an inner boundary keeps the error away from an outer one", () => {
      render(
        <ErrorBoundary>
          <div>
            <div>Outer Content</div>
            <ErrorBoundary>
              <ThrowOnRender />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>,
      );

      expect(screen.queryByText("Outer Content")).not.toBeNull();
      expect(screen.getAllByTestId("error-boundary-fallback")).toHaveLength(1);
    });

    test("the fallback is announced to assistive technology", () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      expect(screen.queryByRole("alert")).not.toBeNull();
    });

    test("shows the underlying error message for support", () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender message="Cannot read properties of undefined (reading 'queryConfigs')" />
        </ErrorBoundary>,
      );

      expect(
        screen.getByTestId("error-boundary-error-message").textContent,
      ).toContain("reading 'queryConfigs'");
    });
  });

  describe("reporting", () => {
    test("calls the onError callback with the thrown error", () => {
      const onError: jest.Mock = jest.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowOnRender message="Boom" />
        </ErrorBoundary>,
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]![0] as Error).message).toBe("Boom");
    });

    test("logs the error so it still reaches the console and RUM", () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender message="Boom" />
        </ErrorBoundary>,
      );

      const loggedOurMessage: boolean = consoleErrorSpy.mock.calls.some(
        (call: Array<unknown>) => {
          return call[0] === "Uncaught error rendering the app:";
        },
      );

      expect(loggedOurMessage).toBe(true);
    });

    test("does not call onError when nothing throws", () => {
      const onError: jest.Mock = jest.fn();

      render(
        <ErrorBoundary onError={onError}>
          <div>Fine</div>
        </ErrorBoundary>,
      );

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("recovery", () => {
    test("'Try again' re-renders the children", () => {
      let shouldThrow: boolean = true;

      const SometimesThrows: FunctionComponent = (): ReactElement => {
        if (shouldThrow) {
          throw new Error("Transient failure");
        }

        return <div>Recovered Content</div>;
      };

      render(
        <ErrorBoundary>
          <SometimesThrows />
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();

      shouldThrow = false;
      fireEvent.click(screen.getByTestId("error-boundary-try-again"));

      expect(screen.queryByText("Recovered Content")).not.toBeNull();
      expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
    });

    test("'Reload page' reloads the browser", () => {
      render(
        <ErrorBoundary>
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      fireEvent.click(screen.getByTestId("error-boundary-reload"));

      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    test("changing the resetKey clears the error (navigating away)", () => {
      const { rerender } = render(
        <ErrorBoundary resetKey="/dashboard/monitors/broken">
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();

      // The user clicks another nav item; the route key changes.
      rerender(
        <ErrorBoundary resetKey="/dashboard/incidents">
          <div>Incidents Page</div>
        </ErrorBoundary>,
      );

      expect(screen.queryByText("Incidents Page")).not.toBeNull();
      expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
    });

    test("keeping the same resetKey keeps showing the fallback", () => {
      const { rerender } = render(
        <ErrorBoundary resetKey="/dashboard/monitors/broken">
          <ThrowOnRender />
        </ErrorBoundary>,
      );

      rerender(
        <ErrorBoundary resetKey="/dashboard/monitors/broken">
          <div>Should Not Show</div>
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
      expect(screen.queryByText("Should Not Show")).toBeNull();
    });

    test("catches a second error after recovering from the first", () => {
      const MaybeThrows: FunctionComponent<{ shouldThrow: boolean }> = (props: {
        shouldThrow: boolean;
      }): ReactElement => {
        if (props.shouldThrow) {
          throw new Error("Transient failure");
        }

        return <div>Recovered Content</div>;
      };

      const { rerender } = render(
        <ErrorBoundary>
          <MaybeThrows shouldThrow={true} />
        </ErrorBoundary>,
      );

      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();

      // The underlying cause clears, and the user retries.
      rerender(
        <ErrorBoundary>
          <MaybeThrows shouldThrow={false} />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByTestId("error-boundary-try-again"));
      expect(screen.queryByText("Recovered Content")).not.toBeNull();

      // It breaks again. A boundary that only catches once is a blank screen.
      rerender(
        <ErrorBoundary>
          <MaybeThrows shouldThrow={true} />
        </ErrorBoundary>,
      );
      expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
    });
  });
});

describe("isChunkLoadError", () => {
  test.each([
    ["webpack", "Loading chunk 472 failed."],
    ["webpack css", "Loading CSS chunk 12 failed."],
    ["vite", "Failed to fetch dynamically imported module: /assets/App.js"],
    ["safari", "Importing a module script failed."],
    ["firefox", "error loading dynamically imported module"],
    ["vite preload", "Unable to preload CSS for /assets/index.css"],
  ])("detects the %s wording", (_browser: string, message: string) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  test("detects errors identified only by name", () => {
    const error: Error = new Error("Something went wrong");
    error.name = "ChunkLoadError";

    expect(isChunkLoadError(error)).toBe(true);
  });

  test.each([
    ["the blank-screen TypeError", "Cannot read properties of undefined"],
    ["a network failure", "Network request failed"],
    ["an empty message", ""],
  ])("does not misfire on %s", (_label: string, message: string) => {
    expect(isChunkLoadError(new Error(message))).toBe(false);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 0],
    ["an empty string", ""],
  ])("is false for %s", (_label: string, value: unknown) => {
    expect(isChunkLoadError(value)).toBe(false);
  });

  test("handles non-Error throwables without blowing up", () => {
    expect(isChunkLoadError("Loading chunk 3 failed.")).toBe(true);
    expect(isChunkLoadError({ nope: true })).toBe(false);
  });
});

describe("chunk load reload throttling", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockReload();
  });

  afterEach(() => {
    restoreLocation();
    jest.restoreAllMocks();
  });

  test("has not reloaded when storage is empty", () => {
    expect(hasRecentlyReloadedForChunkLoadError(Date.now())).toBe(false);
  });

  test("reports a reload inside the cooldown window", () => {
    const now: number = 1_000_000;
    markChunkLoadErrorReload(now);

    expect(hasRecentlyReloadedForChunkLoadError(now)).toBe(true);
    expect(
      hasRecentlyReloadedForChunkLoadError(
        now + CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS - 1,
      ),
    ).toBe(true);
  });

  test("the cooldown expires", () => {
    const now: number = 1_000_000;
    markChunkLoadErrorReload(now);

    expect(
      hasRecentlyReloadedForChunkLoadError(
        now + CHUNK_LOAD_RELOAD_COOLDOWN_IN_MS,
      ),
    ).toBe(false);
  });

  test("ignores a corrupt timestamp", () => {
    window.sessionStorage.setItem(
      CHUNK_LOAD_RELOAD_STORAGE_KEY,
      "not-a-number",
    );

    expect(hasRecentlyReloadedForChunkLoadError(Date.now())).toBe(false);
  });

  test("survives sessionStorage being unavailable", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => {
      markChunkLoadErrorReload(Date.now());
    }).not.toThrow();
    expect(hasRecentlyReloadedForChunkLoadError(Date.now())).toBe(false);
  });
});

describe("handleChunkLoadError", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockReload();
  });

  afterEach(() => {
    restoreLocation();
  });

  test("reloads once for a stale bundle", () => {
    expect(handleChunkLoadError(new Error("Loading chunk 5 failed."))).toBe(
      true,
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("NO RELOAD LOOP: does not reload again inside the cooldown", () => {
    handleChunkLoadError(new Error("Loading chunk 5 failed."));
    expect(reloadMock).toHaveBeenCalledTimes(1);

    /*
     * If the asset is genuinely gone the reload will not fix it. Reloading
     * again would spin forever, so the second attempt must fall through to the
     * fallback UI instead.
     */
    expect(handleChunkLoadError(new Error("Loading chunk 5 failed."))).toBe(
      false,
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  test("never reloads for an ordinary render error", () => {
    expect(
      handleChunkLoadError(
        new Error(
          "Cannot read properties of undefined (reading 'queryConfigs')",
        ),
      ),
    ).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  test("records the attempt so a later boundary sees it", () => {
    handleChunkLoadError(new Error("Loading chunk 5 failed."));

    expect(
      window.sessionStorage.getItem(CHUNK_LOAD_RELOAD_STORAGE_KEY),
    ).not.toBeNull();
  });
});

describe("ErrorBoundary chunk load recovery", () => {
  const consoleErrorSpy: jest.SpyInstance = jest.spyOn(console, "error");

  beforeAll(() => {
    consoleErrorSpy.mockImplementation(() => {});
  });

  beforeEach(() => {
    window.sessionStorage.clear();
    mockReload();
  });

  afterEach(() => {
    restoreLocation();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  test("auto-reloads when a lazy route fails to load", () => {
    const ThrowChunkError: FunctionComponent = (): ReactElement => {
      throw new Error(
        "Failed to fetch dynamically imported module: /assets/AllRoutes.js",
      );
    };

    render(
      <ErrorBoundary>
        <ThrowChunkError />
      </ErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
    // The fallback still renders so the user is never looking at a blank page.
    expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
  });

  test("shows the fallback without reloading when a reload already happened", () => {
    markChunkLoadErrorReload(Date.now());

    const ThrowChunkError: FunctionComponent = (): ReactElement => {
      throw new Error("Loading chunk 9 failed.");
    };

    render(
      <ErrorBoundary>
        <ThrowChunkError />
      </ErrorBoundary>,
    );

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText(FALLBACK_TEXT)).not.toBeNull();
  });
});
