import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import React, { ReactElement, useEffect } from "react";
import ObjectID from "../../../Types/ObjectID";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import { PlaylistEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import { PlaylistRound } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerState";
import PlaylistFakeClock from "./PlaylistFakeClock";

/*
 * The playlist player on a screen (issue #5235), rendered for real with the
 * playlist's reads, the clock and the dashboards handed in: a stand-in for
 * each dashboard that counts how often it is drawn, so the test sees the
 * next dashboard drawn out of sight ahead of its turn and kept - never
 * drawn again - when its turn comes. The keys, the bar, full screen, the
 * screen kept awake, and what the player says when there is nothing to
 * play.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return `Friendly: ${err.message}`;
      },
      getFriendlyMessage: (err: Error) => {
        return `Friendly: ${err.message}`;
      },
    },
  };
});

// The real board is DashboardViewer; every test hands in its own stand-in.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import PlaylistPlayer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayer";

const T0: number = Date.UTC(2026, 9, 27, 23, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const PLAYLIST_ID: ObjectID = new ObjectID(
  "91000000-0000-4000-8000-000000000001",
);

function entry(key: string, name: string): PlaylistEntry {
  return {
    key: key,
    dashboardId: `db000000-0000-4000-8000-${key.padStart(12, "0")}`,
    name: name,
  };
}

const OVERVIEW: PlaylistEntry = entry("1", "Production overview");
const CLUSTERS: PlaylistEntry = entry("2", "Kubernetes clusters");
const DATABASES: PlaylistEntry = entry("3", "Databases");

function round(
  entries: Array<PlaylistEntry>,
  intervalInSeconds: number = 60,
): PlaylistRound {
  return { name: "NOC wall", intervalInSeconds, entries };
}

// How often each dashboard was drawn, by its turn's key.
let mounts: Record<string, number> = {};

function Board(props: { entry: PlaylistEntry }): ReactElement {
  useEffect(() => {
    mounts[props.entry.key] = (mounts[props.entry.key] || 0) + 1;
  }, []);

  return <div data-testid={`board-${props.entry.key}`}>{props.entry.name}</div>;
}

type Callback = () => void;
type PromiseCall = () => Promise<void>;

interface Rendered {
  clock: PlaylistFakeClock;
  onExit: Mock<Callback>;
  onOpenPlaylist: Mock<Callback>;
  onOpenPlaylists: Mock<Callback>;
  reads: () => number;
  answer: (next: PlaylistRound | null | Error) => void;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 4; turn++) {
      await Promise.resolve();
    }
  });
}

async function renderPlayer(
  first: PlaylistRound | null | Error,
): Promise<Rendered> {
  const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
  const onExit: Mock<Callback> = jest.fn<Callback>();
  const onOpenPlaylist: Mock<Callback> = jest.fn<Callback>();
  const onOpenPlaylists: Mock<Callback> = jest.fn<Callback>();
  let current: PlaylistRound | null | Error = first;
  let count: number = 0;

  render(
    <PlaylistPlayer
      playlistId={PLAYLIST_ID}
      clock={clock}
      readRound={(): Promise<PlaylistRound | null> => {
        count++;
        return current instanceof Error
          ? Promise.reject(current)
          : Promise.resolve(current);
      }}
      renderDashboard={(playing: PlaylistEntry): ReactElement => {
        return <Board entry={playing} />;
      }}
      onExit={onExit}
      onOpenPlaylist={onOpenPlaylist}
      onOpenPlaylists={onOpenPlaylists}
    />,
  );

  await flush();

  return {
    clock,
    onExit,
    onOpenPlaylist,
    onOpenPlaylists,
    reads: (): number => {
      return count;
    },
    answer: (next: PlaylistRound | null | Error): void => {
      current = next;
    },
  };
}

async function advance(clock: PlaylistFakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms);
  });
  await flush();
}

async function key(
  name: string,
  options: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body,
): Promise<KeyboardEvent> {
  const event: KeyboardEvent = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...options,
  });

  await act(async () => {
    target.dispatchEvent(event);
  });
  await flush();

  return event;
}

function dashboardName(): string {
  return screen.getByTestId("playlist-player-dashboard-name").textContent || "";
}

function onScreen(): HTMLElement {
  return screen.getByTestId("playlist-player-on-screen");
}

function upNextBoard(): HTMLElement | null {
  return screen.queryByTestId("playlist-player-up-next-board");
}

beforeEach(() => {
  mounts = {};
  resetPageScrollLockForTesting();
  document.body.style.overflow = "";
  document.documentElement.setAttribute("dir", "ltr");
});

afterEach(() => {
  cleanup();
  document.documentElement.setAttribute("dir", "ltr");
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  delete (
    document.documentElement as unknown as { requestFullscreen?: unknown }
  ).requestFullscreen;
  delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: null,
  });
});

describe("the player on screen", () => {
  test("covers the whole window, as a labelled region, and names what is on screen", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    const player: HTMLElement = screen.getByTestId("playlist-player");

    expect(player).toHaveAttribute("role", "region");
    expect(player).toHaveAttribute("aria-label", "Playlist player");
    expect(player.className).toContain("fixed inset-0");
    expect(player).toHaveAttribute("data-status", "Playing");

    expect(dashboardName()).toBe("Production overview");

    const position: HTMLElement = screen.getByTestId(
      "playlist-player-position",
    );

    expect(position).toHaveTextContent("NOC wall");
    expect(position).toHaveTextContent("1 of 3");
    expect(screen.getByTestId("playlist-player-up-next")).toHaveTextContent(
      "Next: Kubernetes clusters",
    );
  });

  test("draws the dashboard on screen, and the next one out of sight ahead of its turn", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    expect(within(onScreen()).getByTestId("board-1")).toBeInTheDocument();
    expect(onScreen()).toHaveAttribute(
      "data-dashboard-id",
      OVERVIEW.dashboardId,
    );

    const upNext: HTMLElement = upNextBoard()!;

    expect(upNext).toHaveAttribute("aria-hidden", "true");
    expect(upNext.className).toContain("invisible");
    expect(upNext.className).toContain("pointer-events-none");
    expect(within(upNext).getByTestId("board-2")).toBeInTheDocument();
    expect(mounts).toEqual({ "1": 1, "2": 1 });
  });

  test("when its turn comes, the next dashboard - already drawn - is shown as it is, not drawn again", async () => {
    const rendered: Rendered = await renderPlayer(
      round([OVERVIEW, CLUSTERS, DATABASES]),
    );

    await advance(rendered.clock, MINUTE - 1);
    expect(dashboardName()).toBe("Production overview");

    await advance(rendered.clock, 1);

    expect(dashboardName()).toBe("Kubernetes clusters");
    expect(within(onScreen()).getByTestId("board-2")).toBeInTheDocument();
    expect(within(upNextBoard()!).getByTestId("board-3")).toBeInTheDocument();
    // Clusters was drawn once, ahead of its turn; the overview's board is gone.
    expect(mounts).toEqual({ "1": 1, "2": 1, "3": 1 });
    expect(screen.queryByTestId("board-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("playlist-player-position")).toHaveTextContent(
      "2 of 3",
    );
  });

  test("with two dashboards, the one that was on screen waits out of sight for its next turn", async () => {
    const rendered: Rendered = await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await advance(rendered.clock, MINUTE);

    expect(dashboardName()).toBe("Kubernetes clusters");
    expect(within(upNextBoard()!).getByTestId("board-1")).toBeInTheDocument();
    // The overview never left the page: drawn once in all.
    expect(mounts).toEqual({ "1": 1, "2": 1 });
  });

  test("one dashboard is drawn once, with no rotation to step through", async () => {
    await renderPlayer(round([OVERVIEW]));

    expect(upNextBoard()).toBeNull();
    expect(screen.queryByTestId("playlist-player-up-next")).toBeNull();
    expect(screen.getByTestId("playlist-player-previous")).toBeDisabled();
    expect(screen.getByTestId("playlist-player-next")).toBeDisabled();
    expect(screen.getByTestId("playlist-player-pause")).toBeEnabled();
  });

  test("the line under the bar fills over the turn, and stops while paused", async () => {
    const rendered: Rendered = await renderPlayer(
      round([OVERVIEW, CLUSTERS], 45),
    );
    const line: HTMLElement = screen.getByTestId("playlist-player-turn-line");

    expect(line.className).toContain("ou-playlist-turn-progress");
    expect(line.style.animationDuration).toBe("45000ms");
    expect(line.style.animationPlayState).toBe("running");
    expect(line).toHaveAttribute("data-paused", "false");

    await advance(rendered.clock, 10 * SECOND);
    await key(" ");

    const paused: HTMLElement = screen.getByTestId("playlist-player-turn-line");

    expect(paused.style.animationPlayState).toBe("paused");
    expect(paused).toHaveAttribute("data-paused", "true");
  });

  test("the line of a turn resumed part-way starts where the pause left it", async () => {
    const rendered: Rendered = await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await advance(rendered.clock, 20 * SECOND);
    await key(" ");
    await advance(rendered.clock, 5 * MINUTE);
    await key(" ");

    const line: HTMLElement = screen.getByTestId("playlist-player-turn-line");

    expect(line.style.animationDelay).toBe("-20000ms");
    expect(line.style.animationPlayState).toBe("running");
  });

  test("keeps the page under it still, and asks the display to stay on", async () => {
    const released: Mock<PromiseCall> = jest.fn<PromiseCall>(() => {
      return Promise.resolve();
    });
    const request: Mock<() => Promise<{ release: Mock<PromiseCall> }>> =
      jest.fn<() => Promise<{ release: Mock<PromiseCall> }>>(() => {
        return Promise.resolve({ release: released });
      });

    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    expect(document.body.style.overflow).toBe("hidden");
    expect(request).toHaveBeenCalledWith("screen");

    cleanup();
    await flush();

    expect(document.body.style.overflow).toBe("");
    expect(released).toHaveBeenCalled();
  });
});

describe("the controls", () => {
  test("Pause holds the dashboard, says Paused, and makes Play the button to press", async () => {
    const rendered: Rendered = await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });

    expect(screen.getByTestId("playlist-player-paused")).toHaveTextContent(
      "Paused",
    );

    const play: HTMLElement = screen.getByRole("button", { name: "Play" });

    expect(play.className).toContain("bg-indigo-600");

    await advance(rendered.clock, 30 * MINUTE);
    expect(dashboardName()).toBe("Production overview");

    await act(async () => {
      fireEvent.click(play);
    });

    expect(screen.queryByTestId("playlist-player-paused")).toBeNull();

    await advance(rendered.clock, MINUTE);
    expect(dashboardName()).toBe("Kubernetes clusters");
  });

  test("Next and Previous step through the playlist, round and round", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next dashboard" }));
    });
    expect(dashboardName()).toBe("Kubernetes clusters");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Previous dashboard" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Previous dashboard" }),
      );
    });
    expect(dashboardName()).toBe("Databases");
  });

  test("tells a screen reader the dashboard a press of Next or Previous went to", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    const status: HTMLElement = screen.getByRole("status");

    expect(status).toHaveTextContent("");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next dashboard" }));
    });

    expect(status).toHaveTextContent("Kubernetes clusters");
  });

  test("Exit leaves the player", async () => {
    const rendered: Rendered = await renderPlayer(round([OVERVIEW]));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Exit the player" }));
    });

    expect(rendered.onExit).toHaveBeenCalledTimes(1);
  });

  test("the tab's title names the playlist and the dashboard on screen, and follows the rotation", async () => {
    const rendered: Rendered = await renderPlayer(
      round([OVERVIEW, CLUSTERS, DATABASES]),
    );

    expect(document.title).toBe("OneUptime | NOC wall - Production overview");

    await advance(rendered.clock, MINUTE);

    expect(document.title).toBe("OneUptime | NOC wall - Kubernetes clusters");
  });

  test("with nothing on screen, the tab is titled by the playlist alone", async () => {
    await renderPlayer(round([]));
    expect(document.title).toBe("OneUptime | NOC wall");

    cleanup();

    await renderPlayer(null);
    expect(document.title).toBe("OneUptime | Playlist");
  });

  test("the controls sit in a labelled toolbar", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    const toolbar: HTMLElement = screen.getByRole("toolbar", {
      name: "Playlist controls",
    });

    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button: HTMLElement) => {
          return button.getAttribute("aria-label");
        }),
    ).toEqual([
      "Previous dashboard",
      "Pause",
      "Next dashboard",
      "Keyboard shortcuts",
      "Exit the player",
    ]);
  });
});

describe("full screen", () => {
  test("is offered only where the browser can, and takes the whole page full screen", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));
    expect(screen.queryByTestId("playlist-player-full-screen")).toBeNull();

    cleanup();

    const requestFullscreen: Mock<PromiseCall> = jest.fn<PromiseCall>(() => {
      return Promise.resolve();
    });

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test("follows the browser: Exit full screen once it is, and F or the button leaves it", async () => {
    const exitFullscreen: Mock<PromiseCall> = jest.fn<PromiseCall>(() => {
      return Promise.resolve();
    });

    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: jest.fn(() => {
        return Promise.resolve();
      }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    expect(
      screen.getByRole("button", { name: "Exit full screen" }),
    ).toBeInTheDocument();

    await key("f");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  test("Exit leaves full screen too, then the player", async () => {
    const exitFullscreen: Mock<PromiseCall> = jest.fn<PromiseCall>(() => {
      return Promise.resolve();
    });

    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });

    const rendered: Rendered = await renderPlayer(round([OVERVIEW]));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Exit the player" }));
    });

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(rendered.onExit).toHaveBeenCalledTimes(1);
  });
});

describe("the keys", () => {
  test("Space pauses and plays; the arrows go on and back", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    await key(" ");
    expect(screen.getByTestId("playlist-player-paused")).toBeInTheDocument();
    await key(" ");
    expect(screen.queryByTestId("playlist-player-paused")).toBeNull();

    await key("ArrowRight");
    expect(dashboardName()).toBe("Kubernetes clusters");
    await key("ArrowLeft");
    expect(dashboardName()).toBe("Production overview");
  });

  test("on a page read right to left, the left arrow goes on", async () => {
    document.documentElement.setAttribute("dir", "rtl");

    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    await key("ArrowLeft");
    expect(dashboardName()).toBe("Kubernetes clusters");
    await key("ArrowRight");
    expect(dashboardName()).toBe("Production overview");
  });

  test("a key the player takes is marked taken, so the Dashboard's own shortcuts leave it alone", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    expect((await key("?")).defaultPrevented).toBe(true);
    // The sheet is open now: its own keys come first.
    await key("Escape");
    expect((await key("ArrowRight")).defaultPrevented).toBe(true);
    expect((await key("g")).defaultPrevented).toBe(false);
  });

  test("keys typed into a field, or held with Ctrl, Cmd or Alt, are left alone", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    const input: HTMLInputElement = document.createElement("input");
    document.body.appendChild(input);

    await key("ArrowRight", {}, input);
    await key(" ", {}, input);
    await key("ArrowRight", { ctrlKey: true });
    await key("ArrowRight", { metaKey: true });
    await key("ArrowRight", { altKey: true });

    expect(dashboardName()).toBe("Production overview");
    expect(screen.queryByTestId("playlist-player-paused")).toBeNull();

    input.remove();
  });

  test("? lists the keys in a dialog; Escape closes the dialog, not the player", async () => {
    const rendered: Rendered = await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await key("?");

    const sheet: HTMLElement = screen.getByTestId("keyboard-shortcuts-modal");

    expect(within(sheet).getByText("Playback")).toBeInTheDocument();
    expect(within(sheet).getByText("Screen")).toBeInTheDocument();
    for (const description of [
      "Pause or play",
      "Next dashboard",
      "Previous dashboard",
      "Full screen",
      "Exit the player",
      "Show keyboard shortcuts",
    ]) {
      expect(within(sheet).getByText(description)).toBeInTheDocument();
    }

    // While the sheet is open the rotation's keys wait.
    await key("ArrowRight");
    expect(dashboardName()).toBe("Production overview");

    await key("Escape");

    expect(screen.queryByTestId("keyboard-shortcuts-modal")).toBeNull();
    expect(rendered.onExit).not.toHaveBeenCalled();

    await key("Escape");
    expect(rendered.onExit).toHaveBeenCalledTimes(1);
  });

  test("the keyboard button opens the same sheet", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Keyboard shortcuts" }),
      );
    });

    expect(screen.getByTestId("keyboard-shortcuts-modal")).toBeInTheDocument();
  });

  test("the sheet of six keys is a medium dialog, not one spread across the window", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    await key("?");

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog.className).toContain("sm:max-w-3xl");
    expect(dialog.className).not.toContain("sm:max-w-7xl");
  });

  test("a key held down steps once", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS, DATABASES]));

    await key("ArrowRight");
    await key("ArrowRight", { repeat: true });
    await key("ArrowRight", { repeat: true });

    expect(dashboardName()).toBe("Kubernetes clusters");
  });
});

describe("nothing to play", () => {
  test("a playlist with no dashboard the viewer can see says so, and leads to the playlist", async () => {
    const rendered: Rendered = await renderPlayer(round([]));

    expect(screen.getByTestId("playlist-player")).toHaveAttribute(
      "data-status",
      "Empty",
    );
    expect(screen.getByText("Nothing to show yet")).toBeInTheDocument();
    expect(dashboardName()).toBe("NOC wall");
    // No rotation, so no rotation's controls, no position and no line.
    expect(screen.queryByTestId("playlist-player-pause")).toBeNull();
    expect(screen.queryByTestId("playlist-player-shortcuts")).toBeNull();
    expect(screen.queryByTestId("playlist-player-position")).toBeNull();
    expect(screen.queryByTestId("playlist-player-turn-line")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Exit the player" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("playlist-player-open-playlist"));
    });

    expect(rendered.onOpenPlaylist).toHaveBeenCalledTimes(1);
  });

  test("a playlist that is gone says so, and leads to all playlists", async () => {
    const rendered: Rendered = await renderPlayer(null);

    expect(screen.getByText("Playlist not found")).toBeInTheDocument();
    expect(dashboardName()).toBe("Playlist");

    await act(async () => {
      fireEvent.click(screen.getByTestId("playlist-player-open-playlists"));
    });

    expect(rendered.onOpenPlaylists).toHaveBeenCalledTimes(1);
  });

  test("a read that failed says why, and Try again reads the playlist again", async () => {
    const rendered: Rendered = await renderPlayer(
      new Error("The network is down."),
    );

    expect(
      screen.getByText("Could not load this playlist"),
    ).toBeInTheDocument();
    // Why, and that the screen comes back by itself - read from across a room.
    expect(
      screen.getByTestId("playlist-player-error-description"),
    ).toHaveTextContent(
      "Friendly: The network is down. The player tries again in a minute.",
    );

    rendered.answer(round([OVERVIEW, CLUSTERS]));

    await act(async () => {
      fireEvent.click(screen.getByTestId("playlist-player-try-again"));
    });
    await flush();

    expect(rendered.reads()).toBe(2);
    expect(dashboardName()).toBe("Production overview");
  });

  test("Escape still leaves a player with nothing to play", async () => {
    const rendered: Rendered = await renderPlayer(round([]));

    await key("Escape");

    expect(rendered.onExit).toHaveBeenCalledTimes(1);
  });

  test("each message stands in the middle of the screen, not at its top", async () => {
    for (const first of [round([]), null, new Error("The network is down.")]) {
      await renderPlayer(first);

      const message: HTMLElement = screen.getByTestId(
        "playlist-player-message",
      );

      // Filling the stage and centring what it holds, both ways.
      expect(message.className).toContain("min-h-full");
      expect(message.className).toContain("items-center");
      expect(message.className).toContain("justify-center");
      expect(screen.getByTestId("playlist-player-stage")).toContainElement(
        message,
      );

      cleanup();
    }
  });

  test("with nothing playing, the bar keeps its two buttons on the name's line, on a phone too", async () => {
    await renderPlayer(null);

    const exit: HTMLElement = screen.getByRole("button", {
      name: "Exit the player",
    });
    const row: HTMLElement = exit.closest("[role='toolbar']")!
      .parentElement as HTMLElement;

    expect(row.className).toContain("flex-row");
    expect(row.className).not.toContain("flex-col");
  });

  test("while a playlist plays, a phone stacks the transport under the names", async () => {
    await renderPlayer(round([OVERVIEW, CLUSTERS]));

    const row: HTMLElement = screen.getByRole("toolbar", {
      name: "Playlist controls",
    }).parentElement as HTMLElement;

    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("sm:flex-row");
  });
});
