import { act, renderHook, RenderHookResult } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";
import { PlaylistEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import {
  PlaylistPlayerStatus,
  PlaylistRound,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerState";
import usePlaylistPlayer, {
  PLAYLIST_PLAYER_READ_AGAIN_IN_MS,
  PlaylistPlayer,
  PlaylistRoundReader,
  SYSTEM_PLAYLIST_CLOCK,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/UsePlaylistPlayer";
import PlaylistFakeClock from "./PlaylistFakeClock";

/*
 * The playlist player's clock and reads (issue #5235), with a clock the test
 * turns by hand: a turn ends exactly when its interval has passed and no
 * sooner, a pause holds it however long, the playlist is read again in each
 * round's last turn and its answer played from the next, a read that fails
 * keeps the round on screen, and a player with nothing on screen reads the
 * playlist again after a while - so a wall comes back by itself. No real
 * time passes in any of it.
 */

const T0: number = Date.UTC(2026, 9, 27, 21, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

function entry(key: string, name: string): PlaylistEntry {
  return {
    key: key,
    dashboardId: `5f8b9c0d-e1a2-4b3c-8d5e-${key.padStart(12, "0")}`,
    name: name,
  };
}

const OVERVIEW: PlaylistEntry = entry("1", "Production overview");
const CLUSTERS: PlaylistEntry = entry("2", "Kubernetes clusters");
const DATABASES: PlaylistEntry = entry("3", "Databases");
const QUEUES: PlaylistEntry = entry("4", "Queues");

function round(
  entries: Array<PlaylistEntry>,
  intervalInSeconds: number = 60,
): PlaylistRound {
  return { name: "NOC wall", intervalInSeconds, entries };
}

/*
 * A playlist reader that answers with the rounds it is given, one per read
 * (the last again once they run out), and counts its reads.
 */
interface FakeReader {
  read: PlaylistRoundReader;
  reads: () => number;
  answer: (next: PlaylistRound | null | Error) => void;
}

function fakeReader(first: PlaylistRound | null | Error): FakeReader {
  let current: PlaylistRound | null | Error = first;
  let count: number = 0;

  return {
    read: (): Promise<PlaylistRound | null> => {
      count++;

      return current instanceof Error
        ? Promise.reject(current)
        : Promise.resolve(current);
    },
    reads: (): number => {
      return count;
    },
    answer: (next: PlaylistRound | null | Error): void => {
      current = next;
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 3; turn++) {
      await Promise.resolve();
    }
  });
}

async function start(
  reader: FakeReader,
  clock: PlaylistFakeClock,
): Promise<RenderHookResult<PlaylistPlayer, unknown>> {
  const hook: RenderHookResult<PlaylistPlayer, unknown> = renderHook(() => {
    return usePlaylistPlayer({ readRound: reader.read, clock: clock });
  });

  await flush();

  return hook;
}

async function advance(clock: PlaylistFakeClock, ms: number): Promise<void> {
  await act(async () => {
    clock.advance(ms);
  });
  await flush();
}

function onScreen(hook: RenderHookResult<PlaylistPlayer, unknown>): string {
  return hook.result.current.current?.name || "";
}

describe("the system clock", () => {
  test("reads Date.now and sets and clears the browser's own timers", () => {
    expect(Math.abs(SYSTEM_PLAYLIST_CLOCK.now() - Date.now())).toBeLessThan(
      1000,
    );

    let fired: boolean = false;
    const handle: unknown = SYSTEM_PLAYLIST_CLOCK.setTimeout(() => {
      fired = true;
    }, 60000);

    SYSTEM_PLAYLIST_CLOCK.clearTimeout(handle);
    expect(fired).toBe(false);
  });
});

describe("a playlist playing", () => {
  test("reads the playlist once and shows its first dashboard", async () => {
    const reader: FakeReader = fakeReader(
      round([OVERVIEW, CLUSTERS, DATABASES]),
    );
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(onScreen(hook)).toBe("Production overview");
    expect(hook.result.current.upcoming).toBe(CLUSTERS);
    expect(reader.reads()).toBe(1);
  });

  test("moves on when the interval has passed - not a moment before", async () => {
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      fakeReader(round([OVERVIEW, CLUSTERS, DATABASES])),
      clock,
    );

    await advance(clock, MINUTE - 1);
    expect(onScreen(hook)).toBe("Production overview");

    await advance(clock, 1);
    expect(onScreen(hook)).toBe("Kubernetes clusters");

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Databases");
  });

  test("keeps one timer at a time, set for the end of the turn on screen", async () => {
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);

    await start(fakeReader(round([OVERVIEW, CLUSTERS], 30)), clock);

    expect(clock.pending()).toEqual([{ at: T0 + 30 * SECOND }]);

    await advance(clock, 30 * SECOND);

    expect(clock.pending()).toEqual([{ at: T0 + 60 * SECOND }]);
  });

  test("a pause holds the dashboard however long, and play gives it the rest of its turn", async () => {
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      fakeReader(round([OVERVIEW, CLUSTERS])),
      clock,
    );

    await advance(clock, 20 * SECOND);
    await act(async () => {
      hook.result.current.togglePause();
    });

    expect(hook.result.current.state.playback?.isPaused).toBe(true);
    expect(clock.pending()).toEqual([]);

    await advance(clock, 3 * 60 * MINUTE);
    expect(onScreen(hook)).toBe("Production overview");

    await act(async () => {
      hook.result.current.togglePause();
    });

    await advance(clock, 40 * SECOND - 1);
    expect(onScreen(hook)).toBe("Production overview");

    await advance(clock, 1);
    expect(onScreen(hook)).toBe("Kubernetes clusters");
  });

  test("Next and Previous move at once, and the new dashboard gets a whole turn", async () => {
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      fakeReader(round([OVERVIEW, CLUSTERS, DATABASES])),
      clock,
    );

    await advance(clock, 50 * SECOND);
    await act(async () => {
      hook.result.current.next();
    });
    expect(onScreen(hook)).toBe("Kubernetes clusters");

    // The old turn's timer is gone: ten seconds on, still clusters.
    await advance(clock, 10 * SECOND);
    expect(onScreen(hook)).toBe("Kubernetes clusters");

    await act(async () => {
      hook.result.current.previous();
    });
    expect(onScreen(hook)).toBe("Production overview");

    await act(async () => {
      hook.result.current.previous();
    });
    expect(onScreen(hook)).toBe("Databases");

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Production overview");
  });
});

describe("reading the playlist again, each round", () => {
  test("is read again once in the round's last turn, and the answer plays from the next turn", async () => {
    const reader: FakeReader = fakeReader(round([OVERVIEW, CLUSTERS]));
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    // Someone adds Queues and moves it first, while the wall plays.
    reader.answer(round([QUEUES, OVERVIEW, CLUSTERS], 30));

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Kubernetes clusters");
    expect(reader.reads()).toBe(2);
    // The next round's first is what comes next.
    expect(hook.result.current.upcoming).toBe(QUEUES);

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Queues");
    expect(hook.result.current.state.playback?.count).toBe(3);
    expect(hook.result.current.state.playback?.intervalMs).toBe(30 * SECOND);

    await advance(clock, 30 * SECOND);
    expect(onScreen(hook)).toBe("Production overview");
    // Not read again until this round's last turn.
    expect(reader.reads()).toBe(2);

    await advance(clock, 30 * SECOND);
    expect(onScreen(hook)).toBe("Kubernetes clusters");
    expect(reader.reads()).toBe(3);
  });

  test("a read again that fails keeps the round on screen, and the next round's last turn asks again", async () => {
    const reader: FakeReader = fakeReader(round([OVERVIEW, CLUSTERS]));
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    reader.answer(new Error("The network is down."));

    await advance(clock, MINUTE);
    await advance(clock, MINUTE);

    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(onScreen(hook)).toBe("Production overview");

    reader.answer(round([DATABASES]));

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Kubernetes clusters");
    expect(hook.result.current.upcoming).toBe(DATABASES);

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Databases");
  });

  test("a playlist deleted while it plays ends with the round", async () => {
    const reader: FakeReader = fakeReader(round([OVERVIEW]));
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    // One dashboard: its every turn is the round's last, so it was read again at once.
    expect(reader.reads()).toBe(2);

    reader.answer(null);

    await advance(clock, MINUTE);
    expect(onScreen(hook)).toBe("Production overview");

    await advance(clock, MINUTE);
    expect(hook.result.current.state.status).toBe(
      PlaylistPlayerStatus.NotFound,
    );
  });
});

describe("nothing to play", () => {
  test("an empty playlist is read again after a while, and plays once it has a dashboard", async () => {
    const reader: FakeReader = fakeReader(round([]));
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Empty);
    expect(clock.pending()).toEqual([
      { at: T0 + PLAYLIST_PLAYER_READ_AGAIN_IN_MS },
    ]);

    await advance(clock, PLAYLIST_PLAYER_READ_AGAIN_IN_MS);
    expect(reader.reads()).toBe(2);
    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Empty);

    reader.answer(round([CLUSTERS]));

    await advance(clock, PLAYLIST_PLAYER_READ_AGAIN_IN_MS);
    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Playing);
    expect(onScreen(hook)).toBe("Kubernetes clusters");
  });

  test("a failed first read says why, is read again after a while, and on Try again at once", async () => {
    const reader: FakeReader = fakeReader(new Error("The network is down."));
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Error);
    expect(hook.result.current.state.errorMessage).toBe("The network is down.");

    await advance(clock, PLAYLIST_PLAYER_READ_AGAIN_IN_MS);
    expect(reader.reads()).toBe(2);

    reader.answer(round([OVERVIEW, CLUSTERS]));

    await act(async () => {
      hook.result.current.readAgain();
    });
    await flush();

    expect(reader.reads()).toBe(3);
    expect(hook.result.current.state.status).toBe(PlaylistPlayerStatus.Playing);
  });

  test("a playlist not found is not read again by itself", async () => {
    const reader: FakeReader = fakeReader(null);
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = await start(
      reader,
      clock,
    );

    expect(hook.result.current.state.status).toBe(
      PlaylistPlayerStatus.NotFound,
    );
    expect(clock.pending()).toEqual([]);

    await advance(clock, 10 * PLAYLIST_PLAYER_READ_AGAIN_IN_MS);
    expect(reader.reads()).toBe(1);
  });

  test("the error's words come from the page's own reader of errors", async () => {
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = renderHook(() => {
      return usePlaylistPlayer({
        readRound: fakeReader(new Error("raw")).read,
        clock: clock,
        getErrorMessage: (): string => {
          return "Friendly words.";
        },
      });
    });

    await flush();

    expect(hook.result.current.state.errorMessage).toBe("Friendly words.");
  });
});

describe("leaving the player", () => {
  test("unmounting clears the timer and drops answers that arrive after", async () => {
    let resolveRead: ((value: PlaylistRound | null) => void) | null = null;
    const clock: PlaylistFakeClock = new PlaylistFakeClock(T0);
    const hook: RenderHookResult<PlaylistPlayer, unknown> = renderHook(() => {
      return usePlaylistPlayer({
        readRound: (): Promise<PlaylistRound | null> => {
          return new Promise(
            (resolve: (value: PlaylistRound | null) => void) => {
              resolveRead = resolve;
            },
          );
        },
        clock: clock,
      });
    });

    hook.unmount();

    await act(async () => {
      resolveRead!(round([OVERVIEW]));
    });

    expect(clock.pending()).toEqual([]);
  });
});
