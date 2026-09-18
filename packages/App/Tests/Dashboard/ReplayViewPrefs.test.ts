import { describe, expect, test } from "@jest/globals";
import {
  REPLAY_LIST_URL_STORAGE_KEY,
  REPLAY_RAIL_DEFAULT_WIDTH_REM,
  REPLAY_RAIL_MAX_WIDTH_REM,
  REPLAY_RAIL_MIN_WIDTH_REM,
  REPLAY_STAGE_FIT_PREFS,
  REPLAY_VIEW_PREFS_STORAGE_KEY,
  ReplayPrefsStorageLike,
  ReplayStageFitPref,
  ReplayViewPrefs,
  ReplayViewPrefsStore,
  cycleReplayStageFit,
  getDefaultReplayViewPrefs,
  parseReplayViewPrefs,
  readReplayListUrl,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayViewPrefs";

/*
 * Per-viewer player preferences. What is pinned: the defaults (wide ON,
 * follow ON, skip idle OFF, 1x), that every read and write survives a
 * storage that throws, that a malformed stored field costs that field
 * only, that out-of-range values are clamped on the way in AND out, and
 * that the list-URL restore never becomes an open redirect.
 */

class FakeStorage implements ReplayPrefsStorageLike {
  public readonly values: Map<string, string> = new Map<string, string>();
  public writes: number = 0;

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
}

class ThrowingStorage implements ReplayPrefsStorageLike {
  public getItem(): string | null {
    throw new Error("SecurityError: storage is disabled");
  }

  public setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

describe("defaults", () => {
  test("wide, follow and mouse trail are on; skip idle is off; 1x; rail on All", () => {
    const defaults: ReplayViewPrefs = getDefaultReplayViewPrefs();

    expect(defaults.wide).toBe(true);
    expect(defaults.follow).toBe(true);
    expect(defaults.mouseTrail).toBe(true);
    expect(defaults.skipIdle).toBe(false);
    expect(defaults.speed).toBe(1);
    expect(defaults.railTab).toBe("all");
    expect(defaults.railWidthRem).toBe(REPLAY_RAIL_DEFAULT_WIDTH_REM);
    expect(defaults.railCollapsed).toBe(false);
    expect(defaults.detailsTab).toBe("session");
    /* The recording is fitted whole by default, and the lanes are shown. */
    expect(defaults.stageFit).toBe("contain");
    expect(defaults.timelineLanes).toBe(true);
  });

  /*
   * Continuous playback across the browser tabs of a session is ON out of
   * the box (github.com/OneUptime/oneuptime/issues/3865). The recorder
   * mints a tab id per page load, so a four-page visit is four tabs, and
   * the default before this left playback stopped at each of them for a
   * click on Continue and another on Play.
   */
  test("playback carries on across tabs by default", () => {
    expect(getDefaultReplayViewPrefs().autoContinue).toBe(true);
  });

  /*
   * The rail's default width is part of how big the recording is drawn:
   * the player now fills the viewport and the rail takes its width out of
   * the stage, so the default came down from 30rem to 26rem (still inside
   * the drag range, which did not change).
   */
  test("the rail starts at 26rem, inside the 22-44rem drag range", () => {
    expect(REPLAY_RAIL_DEFAULT_WIDTH_REM).toBe(26);
    expect(REPLAY_RAIL_MIN_WIDTH_REM).toBe(22);
    expect(REPLAY_RAIL_MAX_WIDTH_REM).toBe(44);
    expect(REPLAY_RAIL_DEFAULT_WIDTH_REM).toBeGreaterThanOrEqual(
      REPLAY_RAIL_MIN_WIDTH_REM,
    );
    expect(REPLAY_RAIL_DEFAULT_WIDTH_REM).toBeLessThanOrEqual(
      REPLAY_RAIL_MAX_WIDTH_REM,
    );
  });

  test("the store starts from the defaults when storage is empty or absent", () => {
    expect(new ReplayViewPrefsStore(new FakeStorage()).getSnapshot()).toEqual(
      getDefaultReplayViewPrefs(),
    );
    expect(new ReplayViewPrefsStore(null).getSnapshot()).toEqual(
      getDefaultReplayViewPrefs(),
    );
  });
});

describe("parseReplayViewPrefs", () => {
  test("merges stored fields onto the defaults, field by field", () => {
    const parsed: ReplayViewPrefs = parseReplayViewPrefs({
      speed: 4,
      wide: false,
      railTab: "errors",
    });

    expect(parsed.speed).toBe(4);
    expect(parsed.wide).toBe(false);
    expect(parsed.railTab).toBe("errors");
    expect(parsed.follow).toBe(true);
    expect(parsed.skipIdle).toBe(false);
  });

  test("a malformed field costs that field only", () => {
    const parsed: ReplayViewPrefs = parseReplayViewPrefs({
      speed: "fast",
      wide: "yes",
      railTab: "devtools",
      railWidthRem: null,
      follow: false,
      detailsTab: "logs",
    });

    expect(parsed.speed).toBe(1);
    expect(parsed.wide).toBe(true);
    expect(parsed.railTab).toBe("all");
    expect(parsed.railWidthRem).toBe(REPLAY_RAIL_DEFAULT_WIDTH_REM);
    expect(parsed.follow).toBe(false);
    /* The retired details tabs (logs / errors / correlation) fall back. */
    expect(parsed.detailsTab).toBe("session");
  });

  test("clamps the speed and the rail width into their ranges", () => {
    expect(parseReplayViewPrefs({ speed: 64 }).speed).toBe(8);
    expect(parseReplayViewPrefs({ speed: 0 }).speed).toBe(0.25);
    expect(parseReplayViewPrefs({ railWidthRem: 5 }).railWidthRem).toBe(
      REPLAY_RAIL_MIN_WIDTH_REM,
    );
    expect(parseReplayViewPrefs({ railWidthRem: 500 }).railWidthRem).toBe(
      REPLAY_RAIL_MAX_WIDTH_REM,
    );
  });

  test("reads a stored stage fit, and falls back to contain for anything else", () => {
    expect(parseReplayViewPrefs({ stageFit: "width" }).stageFit).toBe("width");
    expect(parseReplayViewPrefs({ stageFit: "actual" }).stageFit).toBe(
      "actual",
    );
    expect(parseReplayViewPrefs({ stageFit: "contain" }).stageFit).toBe(
      "contain",
    );
    /* A retired or hand-edited value costs that field only. */
    expect(parseReplayViewPrefs({ stageFit: "cover" }).stageFit).toBe(
      "contain",
    );
    expect(parseReplayViewPrefs({ stageFit: 2 }).stageFit).toBe("contain");
    expect(parseReplayViewPrefs({ stageFit: null }).stageFit).toBe("contain");
    expect(parseReplayViewPrefs({}).stageFit).toBe("contain");
  });

  test("reads the timeline lanes flag, and only a real boolean", () => {
    expect(parseReplayViewPrefs({ timelineLanes: false }).timelineLanes).toBe(
      false,
    );
    expect(parseReplayViewPrefs({ timelineLanes: true }).timelineLanes).toBe(
      true,
    );
    expect(parseReplayViewPrefs({ timelineLanes: "no" }).timelineLanes).toBe(
      true,
    );
    expect(parseReplayViewPrefs({ timelineLanes: 0 }).timelineLanes).toBe(true);
    expect(parseReplayViewPrefs({}).timelineLanes).toBe(true);
  });

  test("reads the auto-continue flag, and only a real boolean", () => {
    expect(parseReplayViewPrefs({ autoContinue: false }).autoContinue).toBe(
      false,
    );
    expect(parseReplayViewPrefs({ autoContinue: true }).autoContinue).toBe(
      true,
    );
    /*
     * A truthy non-boolean is NOT a preference. Falling back to the
     * default is the rule the whole parser follows: one hand-edited or
     * older-Dashboard field costs that field only.
     */
    expect(parseReplayViewPrefs({ autoContinue: "no" }).autoContinue).toBe(
      true,
    );
    expect(parseReplayViewPrefs({ autoContinue: 0 }).autoContinue).toBe(true);
    expect(parseReplayViewPrefs({ autoContinue: null }).autoContinue).toBe(
      true,
    );
    expect(parseReplayViewPrefs({}).autoContinue).toBe(true);
  });

  test("non-objects read as the defaults", () => {
    expect(parseReplayViewPrefs(null)).toEqual(getDefaultReplayViewPrefs());
    expect(parseReplayViewPrefs("wide")).toEqual(getDefaultReplayViewPrefs());
    expect(parseReplayViewPrefs([1, 2])).toEqual(getDefaultReplayViewPrefs());
  });
});

describe("ReplayViewPrefsStore", () => {
  test("reads a stored value on construction", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ speed: 2, wide: false }),
    );

    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);

    expect(store.getSnapshot().speed).toBe(2);
    expect(store.getSnapshot().wide).toBe(false);
  });

  test("malformed JSON in storage reads as the defaults instead of throwing", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(REPLAY_VIEW_PREFS_STORAGE_KEY, "{not json");

    expect(new ReplayViewPrefsStore(storage).getSnapshot()).toEqual(
      getDefaultReplayViewPrefs(),
    );
  });

  test("update writes through, notifies subscribers, and keeps identity when nothing changed", () => {
    const storage: FakeStorage = new FakeStorage();
    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);
    const seen: Array<ReplayViewPrefs> = [];
    const unsubscribe: () => void = store.subscribe(
      (prefs: ReplayViewPrefs): void => {
        seen.push(prefs);
      },
    );

    const before: ReplayViewPrefs = store.getSnapshot();
    const after: ReplayViewPrefs = store.update({ wide: false, speed: 2 });

    expect(after).not.toBe(before);
    expect(after.wide).toBe(false);
    expect(after.speed).toBe(2);
    expect(seen).toHaveLength(1);
    expect(
      JSON.parse(storage.values.get(REPLAY_VIEW_PREFS_STORAGE_KEY) as string),
    ).toMatchObject({ wide: false, speed: 2 });

    /* Same values again: no write, no notification, same snapshot object. */
    const unchanged: ReplayViewPrefs = store.update({ wide: false });

    expect(unchanged).toBe(after);
    expect(seen).toHaveLength(1);
    expect(storage.writes).toBe(1);

    unsubscribe();
    store.update({ wide: true });
    expect(seen).toHaveLength(1);
  });

  test("update validates through the parser so an out-of-range value is clamped before it is stored", () => {
    const storage: FakeStorage = new FakeStorage();
    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);

    expect(store.update({ railWidthRem: 999 }).railWidthRem).toBe(
      REPLAY_RAIL_MAX_WIDTH_REM,
    );
    expect(
      JSON.parse(storage.values.get(REPLAY_VIEW_PREFS_STORAGE_KEY) as string)
        .railWidthRem,
    ).toBe(REPLAY_RAIL_MAX_WIDTH_REM);
  });

  test("a storage that throws on read and write leaves the in-memory prefs working", () => {
    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(
      new ThrowingStorage(),
    );

    expect(store.getSnapshot()).toEqual(getDefaultReplayViewPrefs());
    expect((): ReplayViewPrefs => {
      return store.update({ wide: false });
    }).not.toThrow();
    expect(store.getSnapshot().wide).toBe(false);
    expect((): ReplayViewPrefs => {
      return store.reload();
    }).not.toThrow();
  });

  test("reload picks up what another tab wrote", () => {
    const storage: FakeStorage = new FakeStorage();
    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);

    storage.values.set(
      REPLAY_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ follow: false }),
    );

    expect(store.reload().follow).toBe(false);
  });
});

describe("readReplayListUrl", () => {
  test("returns a stored same-origin path", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_LIST_URL_STORAGE_KEY,
      "/dashboard/p/rum/a/session-replay?signal=errors&range=24h",
    );

    expect(readReplayListUrl(storage)).toBe(
      "/dashboard/p/rum/a/session-replay?signal=errors&range=24h",
    );
  });

  /*
   * integration-002: SessionReplayTable stamps window.location.href (and
   * buildFilteredUrl's absolute result), so a reader that only accepted a
   * relative path dropped every stamp and the "Sessions" back link never
   * restored the viewer's filters. The absolute form is now accepted and
   * reduced to a path - but only when it is this origin.
   */
  test("accepts the absolute same-origin href the list actually stamps", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_LIST_URL_STORAGE_KEY,
      "https://app.oneuptime.com/dashboard/p/rum/a/session-replay?signal=errors&sortBy=errors&page=3",
    );

    expect(readReplayListUrl(storage, "https://app.oneuptime.com")).toBe(
      "/dashboard/p/rum/a/session-replay?signal=errors&sortBy=errors&page=3",
    );
  });

  test("keeps the hash of an absolute same-origin href", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_LIST_URL_STORAGE_KEY,
      "https://app.oneuptime.com/dashboard/list?a=1#row-7",
    );

    expect(readReplayListUrl(storage, "https://app.oneuptime.com")).toBe(
      "/dashboard/list?a=1#row-7",
    );
  });

  test("refuses anything that could leave the origin", () => {
    for (const value of [
      "https://evil.example/phish",
      "//evil.example/phish",
      "javascript:alert(1)",
      "/dashboard\\evil",
      "https://app.oneuptime.com.evil.example/dashboard",
      "http://app.oneuptime.com/dashboard",
      "",
    ]) {
      const storage: FakeStorage = new FakeStorage();

      storage.values.set(REPLAY_LIST_URL_STORAGE_KEY, value);

      /* An explicit origin, so the rejection is the origin check itself. */
      expect([
        value,
        readReplayListUrl(storage, "https://app.oneuptime.com"),
      ]).toEqual([value, null]);
    }
  });

  test("refuses an absolute URL when no origin is known", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_LIST_URL_STORAGE_KEY,
      "https://app.oneuptime.com/dashboard/list",
    );

    expect(readReplayListUrl(storage, null)).toBeNull();
  });

  test("returns null without a storage or when reading throws", () => {
    expect(readReplayListUrl(null)).toBeNull();
    expect(readReplayListUrl(new ThrowingStorage())).toBeNull();
    expect(readReplayListUrl(new FakeStorage())).toBeNull();
  });
});

/*
 * The fit cycle behind the stage's toggle and the "z" shortcut. One
 * direction, three stops, and any unknown value restarts at "contain" so
 * a stale stored pref cannot strand the key.
 */
describe("cycleReplayStageFit", () => {
  test("steps contain -> width -> actual -> contain", () => {
    expect(cycleReplayStageFit("contain")).toBe("width");
    expect(cycleReplayStageFit("width")).toBe("actual");
    expect(cycleReplayStageFit("actual")).toBe("contain");
  });

  test("three presses return to where it started, from every stop", () => {
    for (const fit of REPLAY_STAGE_FIT_PREFS) {
      expect(
        cycleReplayStageFit(cycleReplayStageFit(cycleReplayStageFit(fit))),
      ).toBe(fit);
    }
  });

  test("an unrecognised value restarts the cycle at contain", () => {
    expect(cycleReplayStageFit("cover" as ReplayStageFitPref)).toBe("contain");
    expect(cycleReplayStageFit("" as ReplayStageFitPref)).toBe("contain");
  });

  test("the cycle only ever yields values the parser accepts", () => {
    let fit: ReplayStageFitPref = "contain";

    for (let step: number = 0; step < 7; step++) {
      fit = cycleReplayStageFit(fit);
      expect(parseReplayViewPrefs({ stageFit: fit }).stageFit).toBe(fit);
    }
  });
});

/* The new fields round-trip through the store like every other pref. */
describe("stage fit, timeline lanes and auto-continue in the store", () => {
  test("updates are validated, written and announced", () => {
    const storage: FakeStorage = new FakeStorage();
    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);

    expect(store.update({ stageFit: "width" }).stageFit).toBe("width");
    expect(store.update({ timelineLanes: false }).timelineLanes).toBe(false);
    expect(store.update({ autoContinue: false }).autoContinue).toBe(false);

    const stored: ReplayViewPrefs = JSON.parse(
      storage.values.get(REPLAY_VIEW_PREFS_STORAGE_KEY) as string,
    ) as ReplayViewPrefs;

    expect(stored.stageFit).toBe("width");
    expect(stored.timelineLanes).toBe(false);
    expect(stored.autoContinue).toBe(false);

    /* An invalid write is clamped to the default rather than stored. */
    expect(
      store.update({ stageFit: "zoom" as ReplayStageFitPref }).stageFit,
    ).toBe("contain");
  });

  test("a store built on a pref set from before the fields reads the defaults", () => {
    const storage: FakeStorage = new FakeStorage();

    storage.values.set(
      REPLAY_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ speed: 2, railWidthRem: 30 }),
    );

    const store: ReplayViewPrefsStore = new ReplayViewPrefsStore(storage);

    expect(store.getSnapshot().stageFit).toBe("contain");
    expect(store.getSnapshot().timelineLanes).toBe(true);
    /*
     * A viewer upgrading into this build gets continuous playback, which
     * is the point of shipping it as the default rather than as an
     * opt-in nobody would find.
     */
    expect(store.getSnapshot().autoContinue).toBe(true);
    /* A width stored under the old 30rem default is still inside the range. */
    expect(store.getSnapshot().railWidthRem).toBe(30);
  });
});
