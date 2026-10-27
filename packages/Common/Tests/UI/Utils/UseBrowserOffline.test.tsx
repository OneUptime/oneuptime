import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import NewVersion, {
  NewVersionAudience,
} from "../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../UI/Utils/NewVersion/ServerBuildCheck";
import useBrowserOffline, {
  BrowserOffline,
  IsServerReachableFunction,
  isServerReachable,
} from "../../../UI/Utils/UseBrowserOffline";

/*
 * Whether the browser is offline under an open page, as the page treats
 * it (MasterPage shows "You're offline" in the page's place and keeps the
 * page as it was): offline from the browser's offline event, or a first
 * render while it already is, until its online event - or until Try again
 * finds the server answering, which a browser that is wrong about being
 * offline would otherwise never let the reader see.
 */

const setOnline: (isOnline: boolean) => void = (isOnline: boolean): void => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: (): boolean => {
      return isOnline;
    },
  });
};

const goOffline: () => void = (): void => {
  setOnline(false);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
};

const goOnline: () => void = (): void => {
  setOnline(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
};

interface ProbeControl {
  probe: IsServerReachableFunction;
  calls: () => number;
  answer: (value: boolean | null | Error) => void;
}

// A server check whose answer the test decides, and which it can hold.
const makeProbe: () => ProbeControl = (): ProbeControl => {
  let calls: number = 0;
  let next: boolean | null | Error = false;

  return {
    probe: (): Promise<boolean | null> => {
      calls++;

      if (next instanceof Error) {
        return Promise.reject(next);
      }

      return Promise.resolve(next);
    },
    calls: (): number => {
      return calls;
    },
    answer: (value: boolean | null | Error): void => {
      next = value;
    },
  };
};

let probe: ProbeControl;
let latest: BrowserOffline | null = null;

const Probe: FunctionComponent<{ checkMinimumInMs?: number }> = (props: {
  checkMinimumInMs?: number;
}): ReactElement => {
  const offline: BrowserOffline = useBrowserOffline({
    isServerReachable: probe.probe,
    checkMinimumInMs: props.checkMinimumInMs ?? 0,
  });

  latest = offline;

  return (
    <div>
      <span data-testid="offline">{offline.isOffline ? "yes" : "no"}</span>
      <span data-testid="checking">{offline.isChecking ? "yes" : "no"}</span>
    </div>
  );
};

const isOffline: () => string = (): string => {
  return screen.getByTestId("offline").textContent || "";
};

const isChecking: () => string = (): string => {
  return screen.getByTestId("checking").textContent || "";
};

beforeEach(() => {
  setOnline(true);
  probe = makeProbe();
  latest = null;
});

afterEach(() => {
  cleanup();
  setOnline(true);
  NewVersion.reset();
});

describe("useBrowserOffline", () => {
  test("online: nothing to say", () => {
    render(<Probe />);

    expect(isOffline()).toBe("no");
    expect(isChecking()).toBe("no");
  });

  test("a page drawn while the browser is already offline is offline at once", () => {
    setOnline(false);

    render(<Probe />);

    expect(isOffline()).toBe("yes");
  });

  test("the browser going offline, then coming back", () => {
    render(<Probe />);

    goOffline();
    expect(isOffline()).toBe("yes");

    goOnline();
    expect(isOffline()).toBe("no");
  });

  test("Try again with the browser back online brings the page back without asking the server", async () => {
    render(<Probe />);
    goOffline();

    setOnline(true);
    act(() => {
      latest!.checkNow();
    });

    await waitFor(() => {
      expect(isOffline()).toBe("no");
    });
    expect(probe.calls()).toBe(0);
  });

  test("Try again while the browser says offline but the server answers: the page comes back", async () => {
    render(<Probe />);
    goOffline();
    probe.answer(true);

    act(() => {
      latest!.checkNow();
    });

    await waitFor(() => {
      expect(isOffline()).toBe("no");
    });
    expect(probe.calls()).toBe(1);
    expect(isChecking()).toBe("no");
  });

  test.each<[string, boolean | null | Error]>([
    ["no answer", false],
    ["no manifest to ask for", null],
    ["a check that throws", new Error("network down")],
  ])(
    "Try again with %s stays offline, and stops checking",
    async (_label: string, answer: boolean | null | Error) => {
      render(<Probe />);
      goOffline();
      probe.answer(answer);

      act(() => {
        latest!.checkNow();
      });

      await waitFor(() => {
        expect(probe.calls()).toBe(1);
        expect(isChecking()).toBe("no");
      });
      expect(isOffline()).toBe("yes");
    },
  );

  test("a Try again spins at least as long as it is asked to, so it is seen", async () => {
    render(<Probe checkMinimumInMs={150} />);
    goOffline();
    probe.answer(false);

    const startedAt: number = Date.now();

    act(() => {
      latest!.checkNow();
    });

    expect(isChecking()).toBe("yes");

    await waitFor(() => {
      expect(isChecking()).toBe("no");
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
  });

  test("a second press while one is asking waits for the first", async () => {
    render(<Probe checkMinimumInMs={50} />);
    goOffline();

    act(() => {
      latest!.checkNow();
      latest!.checkNow();
      latest!.checkNow();
    });

    await waitFor(() => {
      expect(isChecking()).toBe("no");
    });

    expect(probe.calls()).toBe(1);
  });

  test("a page that leaves while Try again asks is left alone", async () => {
    const { unmount } = render(<Probe checkMinimumInMs={20} />);
    goOffline();

    act(() => {
      latest!.checkNow();
    });
    unmount();

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 60);
      });
    });

    expect(probe.calls()).toBe(1);
  });

  test("stops listening once the page leaves", () => {
    const { unmount } = render(<Probe />);
    const before: BrowserOffline = latest!;

    unmount();
    setOnline(false);
    window.dispatchEvent(new Event("offline"));

    expect(latest).toBe(before);
  });
});

describe("isServerReachable", () => {
  const answering: (status: number) => FetchFunction = (
    status: number,
  ): FetchFunction => {
    return (): Promise<Response> => {
      return Promise.resolve({
        status: status,
        ok: status >= 200 && status < 300,
        text: (): Promise<string> => {
          return Promise.resolve(JSON.stringify({ buildId: "b" }));
        },
      } as unknown as Response);
    };
  };

  const start: (fetchFunction: FetchFunction) => void = (
    fetchFunction: FetchFunction,
  ): void => {
    NewVersion.start({
      audience: NewVersionAudience.Members,
      runningBuild: { buildId: "a", manifestUrl: "/dashboard/dist/build.json" },
      fetchFunction: fetchFunction,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });
  };

  test("null when this tab's code names no build to ask about", async () => {
    NewVersion.reset();

    await expect(isServerReachable()).resolves.toBeNull();
  });

  test.each<[string, number]>([
    ["a new build", 200],
    ["a server starting again (503)", 503],
    ["a page in place of the manifest (404)", 404],
  ])(
    "true when the server answers at all: %s",
    async (_label: string, status: number) => {
      start(answering(status));

      await expect(isServerReachable()).resolves.toBe(true);
    },
  );

  test("false when nothing answers", async () => {
    start((): Promise<Response> => {
      return Promise.reject(new TypeError("Failed to fetch"));
    });

    await expect(isServerReachable()).resolves.toBe(false);
  });
});
