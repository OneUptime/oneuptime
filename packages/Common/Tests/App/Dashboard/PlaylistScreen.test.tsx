import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import React, { ReactElement } from "react";
import {
  PageFullScreen,
  canShowPageFullScreen,
  enterPageFullScreen,
  exitPageFullScreen,
  isPageFullScreen,
  usePageFullScreen,
  useScreenWakeLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistScreen";

/*
 * What a wall screen nobody touches needs from the browser (issue #5235):
 * the page full screen, and the display kept awake. Both may be refused or
 * missing - jsdom has neither - and a refusal changes nothing else. The
 * browser's own calls are stood in for here, as a browser that has them
 * would answer.
 */

interface FullScreenStandIn {
  requested: number;
  exited: number;
  refuse: boolean;
  restore: () => void;
}

function standInFullScreen(
  options: { refuse?: boolean } = {},
): FullScreenStandIn {
  const page: Record<string, unknown> = document as unknown as Record<
    string,
    unknown
  >;
  const root: Record<string, unknown> =
    document.documentElement as unknown as Record<string, unknown>;
  const state: FullScreenStandIn = {
    requested: 0,
    exited: 0,
    refuse: Boolean(options.refuse),
    restore: () => {},
  };
  let fullScreenElement: Element | null = null;

  Object.defineProperty(page, "fullscreenElement", {
    configurable: true,
    get: () => {
      return fullScreenElement;
    },
  });
  Object.defineProperty(page, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
  root["requestFullscreen"] = (): Promise<void> => {
    state.requested++;

    if (state.refuse) {
      return Promise.reject(new TypeError("Permissions check failed"));
    }

    fullScreenElement = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };
  page["exitFullscreen"] = (): Promise<void> => {
    state.exited++;
    fullScreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  };

  state.restore = (): void => {
    delete page["fullscreenElement"];
    delete page["fullscreenEnabled"];
    delete page["exitFullscreen"];
    delete root["requestFullscreen"];
  };

  return state;
}

interface WakeLockStandIn {
  requests: number;
  released: number;
  restore: () => void;
  refuse: boolean;
}

function standInWakeLock(options: { refuse?: boolean } = {}): WakeLockStandIn {
  const state: WakeLockStandIn = {
    requests: 0,
    released: 0,
    refuse: Boolean(options.refuse),
    restore: () => {},
  };

  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: (type: string): Promise<{ release: () => Promise<void> }> => {
        expect(type).toBe("screen");
        state.requests++;

        if (state.refuse) {
          return Promise.reject(new Error("NotAllowedError"));
        }

        return Promise.resolve({
          release: (): Promise<void> => {
            state.released++;
            return Promise.resolve();
          },
        });
      },
    },
  });

  state.restore = (): void => {
    delete (navigator as unknown as Record<string, unknown>)["wakeLock"];
  };

  return state;
}

function setVisibility(value: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => {
      return value;
    },
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 4; turn++) {
      await Promise.resolve();
    }
  });
}

const restores: Array<() => void> = [];

afterEach(() => {
  cleanup();

  while (restores.length > 0) {
    restores.pop()!();
  }

  delete (document as unknown as Record<string, unknown>)["visibilityState"];
});

describe("full screen", () => {
  test("a browser without it: the player offers no full screen, and asking does nothing", () => {
    expect(canShowPageFullScreen()).toBe(false);
    expect(isPageFullScreen()).toBe(false);
    expect(() => {
      enterPageFullScreen();
      exitPageFullScreen();
    }).not.toThrow();
  });

  test("a browser that may not (a page in a frame that forbids it) offers none either", () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });

    expect(canShowPageFullScreen()).toBe(false);
  });

  test("the whole page goes full screen, and comes back, and the hook follows it", async () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);
    let seen: PageFullScreen | null = null;

    function Probe(): ReactElement {
      seen = usePageFullScreen();
      return <></>;
    }

    render(<Probe />);

    expect(seen!.canGoFullScreen).toBe(true);
    expect(seen!.isFullScreen).toBe(false);

    await act(async () => {
      seen!.toggle();
    });
    await settle();

    expect(stand.requested).toBe(1);
    expect(seen!.isFullScreen).toBe(true);
    expect(isPageFullScreen()).toBe(true);

    await act(async () => {
      seen!.toggle();
    });
    await settle();

    expect(stand.exited).toBe(1);
    expect(seen!.isFullScreen).toBe(false);
  });

  test("leaving full screen when not in it asks nothing of the browser", () => {
    const stand: FullScreenStandIn = standInFullScreen();
    restores.push(stand.restore);

    exitPageFullScreen();

    expect(stand.exited).toBe(0);
  });

  test("a refusal leaves the page as it was, with no error thrown or left unhandled", async () => {
    const stand: FullScreenStandIn = standInFullScreen({ refuse: true });
    restores.push(stand.restore);

    enterPageFullScreen();
    await settle();

    expect(stand.requested).toBe(1);
    expect(isPageFullScreen()).toBe(false);
  });
});

describe("keeping the screen awake", () => {
  function Awake(props: { isActive: boolean }): ReactElement {
    useScreenWakeLock(props.isActive);
    return <></>;
  }

  test("a browser without a wake lock: nothing happens", () => {
    expect(() => {
      render(<Awake isActive={true} />);
    }).not.toThrow();
  });

  test("asks while playing, lets go when the player stops or closes", async () => {
    setVisibility("visible");
    const lock: WakeLockStandIn = standInWakeLock();
    restores.push(lock.restore);

    const view: ReturnType<typeof render> = render(<Awake isActive={true} />);
    await settle();

    expect(lock.requests).toBe(1);

    view.rerender(<Awake isActive={false} />);
    await settle();

    expect(lock.released).toBe(1);

    view.rerender(<Awake isActive={true} />);
    await settle();
    expect(lock.requests).toBe(2);

    view.unmount();
    await settle();
    expect(lock.released).toBe(2);
  });

  test("asks nothing while not playing", async () => {
    setVisibility("visible");
    const lock: WakeLockStandIn = standInWakeLock();
    restores.push(lock.restore);

    render(<Awake isActive={false} />);
    await settle();

    expect(lock.requests).toBe(0);
  });

  test("asks again each time the tab comes back into sight, since the browser lets go when it is hidden", async () => {
    setVisibility("visible");
    const lock: WakeLockStandIn = standInWakeLock();
    restores.push(lock.restore);

    render(<Awake isActive={true} />);
    await settle();
    expect(lock.requests).toBe(1);

    await act(async () => {
      setVisibility("hidden");
    });
    await settle();
    expect(lock.requests).toBe(1);

    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(lock.requests).toBe(2);
  });

  test("a tab opened out of sight waits until it is seen", async () => {
    setVisibility("hidden");
    const lock: WakeLockStandIn = standInWakeLock();
    restores.push(lock.restore);

    render(<Awake isActive={true} />);
    await settle();
    expect(lock.requests).toBe(0);

    await act(async () => {
      setVisibility("visible");
    });
    await settle();
    expect(lock.requests).toBe(1);
  });

  test("a lock granted after the player stopped is let go at once", async () => {
    setVisibility("visible");
    let grant: (value: { release: () => Promise<void> }) => void = () => {};
    let released: number = 0;

    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: (): Promise<{ release: () => Promise<void> }> => {
          return new Promise(
            (resolve: (value: { release: () => Promise<void> }) => void) => {
              grant = resolve;
            },
          );
        },
      },
    });
    restores.push(() => {
      delete (navigator as unknown as Record<string, unknown>)["wakeLock"];
    });

    const view: ReturnType<typeof render> = render(<Awake isActive={true} />);
    view.unmount();

    await act(async () => {
      grant({
        release: (): Promise<void> => {
          released++;
          return Promise.resolve();
        },
      });
    });
    await settle();

    expect(released).toBe(1);
  });

  test("a refusal (a battery saver, a policy) is quiet", async () => {
    setVisibility("visible");
    const lock: WakeLockStandIn = standInWakeLock({ refuse: true });
    restores.push(lock.restore);

    render(<Awake isActive={true} />);
    await settle();

    expect(lock.requests).toBe(1);
  });
});
