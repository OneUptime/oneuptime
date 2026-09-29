import { describe, expect, test } from "@jest/globals";
import { ReplayPhase } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/Engine/ReplayEngineTypes";
import { ReplayTabSummary } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";
import {
  REPLAY_AUTO_CONTINUE_MAX_HOPS,
  REPLAY_AUTO_CONTINUE_PLAYBACK_PHASES,
  ReplayAutoContinueDecision,
  ReplayAutoContinueInput,
  ReplayAutoContinueTracker,
  decideReplayAutoContinue,
  describeReplayAutoContinue,
  isReplayPlaybackPhase,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayAutoContinue";

/*
 * Continuous playback across the browser tabs of one recording
 * (github.com/OneUptime/oneuptime/issues/3865).
 *
 * The recorder mints a tab id per page load, so a four-page visit is four
 * "tabs" and the engine plays one of them: playback stopped at the end of
 * each, and moving on was a click on "Continue in Tab N" followed by a
 * click on Play. The shell now walks them by itself.
 *
 * Everything worth pinning about that is a rule for when NOT to move a
 * viewer somewhere they did not ask to go, so these tests are mostly
 * about the refusals: a viewer who paused at the end stays there; a tab
 * is never auto-entered twice, so overlapping tabs cannot loop; the hop
 * cap bounds a manifest whose offsets contradict its ordering; and the
 * preference is honoured. The decision is pure, so all of it is pinned
 * here without React, the engine or a DOM.
 */

const ALL_PHASES: ReadonlyArray<ReplayPhase> = [
  "loading",
  "seeking",
  "buffering",
  "paused",
  "playing",
  "ended",
  "error",
];

function tab(
  tabId: string,
  overrides?: Partial<ReplayTabSummary>,
): ReplayTabSummary {
  return {
    tabId: tabId,
    label: `Tab ${tabId.replace(/[^0-9]/g, "") || "1"}`,
    durationMs: 30000,
    openedAtMs: 0,
    hasFootage: true,
    isActive: false,
    status: "closed",
    ...overrides,
  };
}

/* The everyday case: a tab played out and another one follows. */
function input(
  overrides?: Partial<ReplayAutoContinueInput>,
): ReplayAutoContinueInput {
  return {
    isEnabled: true,
    phase: "ended",
    didPlayOut: true,
    nextTab: tab("tab-2"),
    enteredTabIds: [],
    hopCount: 0,
    ...overrides,
  };
}

describe("isReplayPlaybackPhase", () => {
  test("playing and buffering are the phases that mean playback was running", () => {
    expect([...REPLAY_AUTO_CONTINUE_PLAYBACK_PHASES].sort()).toEqual([
      "buffering",
      "playing",
    ]);
  });

  /*
   * "buffering" matters as much as "playing": derivePhase maps
   * stalled + playing to buffering, and a tab's last chunk is very often
   * fed out of a stall, so the phase just before "ended" is as likely to
   * be one as the other. Leaving buffering out made auto-continue fire on
   * some tabs and not others for no reason a viewer could see.
   */
  test("every other phase - including the paused ones - is not playback", () => {
    for (const phase of ALL_PHASES) {
      const isPlayback: boolean = isReplayPlaybackPhase(phase);

      expect(isPlayback).toBe(phase === "playing" || phase === "buffering");
    }
  });

  test("an absent phase is not playback", () => {
    expect(isReplayPlaybackPhase(null)).toBe(false);
    expect(isReplayPlaybackPhase(undefined)).toBe(false);
  });
});

describe("decideReplayAutoContinue", () => {
  test("continues into the tab that carries the session on", () => {
    const decision: ReplayAutoContinueDecision =
      decideReplayAutoContinue(input());

    expect(decision).toEqual({
      shouldContinue: true,
      tabId: "tab-2",
      reason: null,
    });
  });

  test("only at the end of a tab: every other phase refuses", () => {
    for (const phase of ALL_PHASES) {
      if (phase === "ended") {
        continue;
      }

      const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
        input({ phase: phase }),
      );

      expect(decision.shouldContinue).toBe(false);
      expect(decision.reason).toBe("not-ended");
      expect(decision.tabId).toBeNull();
    }
  });

  /*
   * The stop the viewer chose is the one case where moving them on would
   * be actively wrong: they paused a frame before the end to read
   * something. didPlayOut is the shell's latch on the transition into
   * "ended", so this is the whole of that guard.
   */
  test("a tab the viewer stopped at is left alone", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ didPlayOut: false }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("paused-by-viewer");
  });

  test("the preference is honoured", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ isEnabled: false }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("disabled");
  });

  /*
   * The preference is checked AFTER the two facts about this stop, so a
   * viewer who has auto-continue off still gets "paused-by-viewer" for a
   * stop they chose. The reason is what a diagnostic quotes, and
   * "disabled" would have said the wrong thing about why nothing moved.
   */
  test("a viewer's own stop outranks the preference in the reason", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ isEnabled: false, didPlayOut: false }),
    );

    expect(decision.reason).toBe("paused-by-viewer");
  });

  test("the last tab of a session stays at the ended card", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ nextTab: null }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("no-next-tab");
  });

  /*
   * A tab with no footage cannot be switched to - the engine would halt
   * with "No footage is stored for this tab" - so it is not a
   * continuation even if something upstream offered it.
   */
  test("a tab without footage is not a continuation", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ nextTab: tab("tab-2", { hasFootage: false }) }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("no-next-tab");
  });

  test("a tab with a blank id is not a continuation", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ nextTab: tab("", { label: "Tab 2" }) }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("no-next-tab");
  });

  /*
   * The loop guard. Tabs of one session can overlap in time (a duplicated
   * tab, a background tab that outlives the one in front), so "the tab
   * with footage after the playhead" can point back at a tab already
   * watched. Entering each tab at most once makes that a walk with an end.
   */
  test("a tab already entered automatically is never entered again", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ enteredTabIds: ["tab-9", "tab-2"] }),
    );

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("already-continued");
  });

  test("a tab entered by hand does not block the automatic walk", () => {
    /*
     * enteredTabIds is what the tracker recorded, and a manual switch
     * RESETS the tracker rather than adding to it, so an unrelated id in
     * the list cannot stand in the way of a different target.
     */
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ enteredTabIds: ["tab-7"] }),
    );

    expect(decision.shouldContinue).toBe(true);
    expect(decision.tabId).toBe("tab-2");
  });

  test("the hop cap is the backstop and stops exactly at it", () => {
    expect(
      decideReplayAutoContinue(
        input({ hopCount: REPLAY_AUTO_CONTINUE_MAX_HOPS - 1 }),
      ).shouldContinue,
    ).toBe(true);

    const capped: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ hopCount: REPLAY_AUTO_CONTINUE_MAX_HOPS }),
    );

    expect(capped.shouldContinue).toBe(false);
    expect(capped.reason).toBe("limit-reached");

    expect(
      decideReplayAutoContinue(
        input({ hopCount: REPLAY_AUTO_CONTINUE_MAX_HOPS + 5 }),
      ).reason,
    ).toBe("limit-reached");
  });

  test("the cap can be lowered by the caller, and a broken one falls back", () => {
    expect(
      decideReplayAutoContinue(input({ hopCount: 2, maxHops: 2 })).reason,
    ).toBe("limit-reached");

    expect(
      decideReplayAutoContinue(input({ hopCount: 2, maxHops: 3 }))
        .shouldContinue,
    ).toBe(true);

    /* NaN is not a cap; the default applies. */
    expect(
      decideReplayAutoContinue(input({ hopCount: 2, maxHops: NaN }))
        .shouldContinue,
    ).toBe(true);
  });

  /*
   * The cap is generous on purpose: a single-page app that routes on the
   * client mints a tab id per navigation, and a real session can carry
   * dozens. A cap a viewer could reach in ordinary use would leave them
   * parked mid-session for no visible reason.
   */
  test("the default cap is well past what an ordinary session produces", () => {
    expect(REPLAY_AUTO_CONTINUE_MAX_HOPS).toBeGreaterThanOrEqual(32);
  });

  /*
   * Idempotence: the shell calls this on every structural publish, and
   * the engine publishes many times while parked at the end (a manifest
   * poll appending rows, the rail's telemetry landing). Asking twice for
   * the same target - after the shell has recorded the hop it is about to
   * make - answers no the second time.
   */
  test("recording the hop before making it makes a second ask a no", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    const first: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({
        enteredTabIds: tracker.getEnteredTabIds(),
        hopCount: tracker.getHopCount(),
      }),
    );

    expect(first.shouldContinue).toBe(true);
    tracker.noteEntered(first.tabId as string);

    const second: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({
        enteredTabIds: tracker.getEnteredTabIds(),
        hopCount: tracker.getHopCount(),
      }),
    );

    expect(second.shouldContinue).toBe(false);
    expect(second.reason).toBe("already-continued");
  });

  /*
   * A whole session, walked. Four page loads is four tabs, and the viewer
   * pressed nothing after opening the recording.
   */
  test("walks a four-page visit end to end and then stops", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();
    const tabIds: Array<string> = ["tab-2", "tab-3", "tab-4"];
    const entered: Array<string> = [];

    for (const tabId of tabIds) {
      const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
        input({
          nextTab: tab(tabId),
          enteredTabIds: tracker.getEnteredTabIds(),
          hopCount: tracker.getHopCount(),
        }),
      );

      expect(decision.shouldContinue).toBe(true);
      tracker.noteEntered(decision.tabId as string);
      entered.push(decision.tabId as string);
    }

    expect(entered).toEqual(tabIds);

    /* The last tab: nothing follows it, so the ended card is the answer. */
    const last: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({
        nextTab: null,
        enteredTabIds: tracker.getEnteredTabIds(),
        hopCount: tracker.getHopCount(),
      }),
    );

    expect(last.shouldContinue).toBe(false);
    expect(last.reason).toBe("no-next-tab");
    expect(tracker.getHopCount()).toBe(3);
  });

  /*
   * Two tabs that each claim footage after the other - which a clock skew
   * between two page loads produces - is the shape that would spin. It
   * terminates after one hop each way rather than ping-ponging.
   */
  test("two tabs pointing at each other terminate instead of ping-ponging", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();
    const alternating: Array<string> = ["tab-2", "tab-1", "tab-2", "tab-1"];
    const hops: Array<string> = [];

    for (const tabId of alternating) {
      const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
        input({
          nextTab: tab(tabId),
          enteredTabIds: tracker.getEnteredTabIds(),
          hopCount: tracker.getHopCount(),
        }),
      );

      if (!decision.shouldContinue) {
        continue;
      }

      tracker.noteEntered(decision.tabId as string);
      hops.push(decision.tabId as string);
    }

    expect(hops).toEqual(["tab-2", "tab-1"]);
  });

  test("the input is never mutated", () => {
    const enteredTabIds: Array<string> = ["tab-7"];
    const args: ReplayAutoContinueInput = input({
      enteredTabIds: enteredTabIds,
    });
    const before: string = JSON.stringify(args);

    decideReplayAutoContinue(args);

    expect(JSON.stringify(args)).toBe(before);
    expect(enteredTabIds).toEqual(["tab-7"]);
  });

  /*
   * A live recording is a continuation case, not an exception: its first
   * tab closing while a second is still recording is exactly the
   * multi-page visit this exists for. Nothing here consults liveness -
   * the next tab having footage past the playhead is the whole test - and
   * this pins that, because the ended overlay DOES treat live specially
   * and a reader might assume the decision does too.
   */
  test("liveness is not part of the decision", () => {
    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue(
      input({ nextTab: tab("tab-2", { status: "open" }) }),
    );

    expect(decision.shouldContinue).toBe(true);
    expect(decision.tabId).toBe("tab-2");
  });
});

describe("describeReplayAutoContinue", () => {
  /*
   * The picture is about to change to another page. Said rather than not:
   * an unexplained jump reads as the player having lost its place.
   */
  test("names the tab the viewer is being taken to", () => {
    const notice: string = describeReplayAutoContinue(
      tab("tab-3", { label: "Tab 3" }),
    );

    expect(notice).toContain("Tab 3");
    expect(notice.length).toBeGreaterThan(0);
  });

  test("uses the same label the tab strip shows", () => {
    expect(
      describeReplayAutoContinue(tab("tab-12", { label: "Tab 12" })),
    ).toContain("Tab 12");
  });
});

describe("ReplayAutoContinueTracker", () => {
  test("starts empty", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    expect(tracker.getEnteredTabIds()).toEqual([]);
    expect(tracker.getHopCount()).toBe(0);
    expect(tracker.hasEntered("tab-1")).toBe(false);
  });

  test("remembers the tabs it entered, once each", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    tracker.noteEntered("tab-2");
    tracker.noteEntered("tab-3");

    expect(tracker.getEnteredTabIds().sort()).toEqual(["tab-2", "tab-3"]);
    expect(tracker.hasEntered("tab-2")).toBe(true);
    expect(tracker.hasEntered("tab-4")).toBe(false);
  });

  /*
   * The hop count moves even for a repeat, because it is a budget on WORK
   * done, not on distinct tabs: a shell that somehow re-entered the same
   * tab in a cycle must still run out.
   */
  test("the hop count counts hops, not distinct tabs", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    tracker.noteEntered("tab-2");
    tracker.noteEntered("tab-2");

    expect(tracker.getEnteredTabIds()).toEqual(["tab-2"]);
    expect(tracker.getHopCount()).toBe(2);
  });

  /* A blank id still costs a hop; it just cannot be remembered. */
  test("a blank tab id costs a hop and is not remembered", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    tracker.noteEntered("");

    expect(tracker.getEnteredTabIds()).toEqual([]);
    expect(tracker.getHopCount()).toBe(1);
  });

  /*
   * Reset is what hands the wheel back. A viewer who jumps to Tab 1 by
   * hand means "watch from here", and leaving the walk's memory in place
   * would have parked them at every end for the rest of the session.
   */
  test("reset forgets everything, so a manual jump re-arms the walk", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    tracker.noteEntered("tab-2");
    tracker.noteEntered("tab-3");
    tracker.reset();

    expect(tracker.getEnteredTabIds()).toEqual([]);
    expect(tracker.getHopCount()).toBe(0);

    expect(
      decideReplayAutoContinue(
        input({
          nextTab: tab("tab-2"),
          enteredTabIds: tracker.getEnteredTabIds(),
          hopCount: tracker.getHopCount(),
        }),
      ).shouldContinue,
    ).toBe(true);
  });

  test("the entered list is a copy, so a caller cannot edit the tracker", () => {
    const tracker: ReplayAutoContinueTracker = new ReplayAutoContinueTracker();

    tracker.noteEntered("tab-2");

    const ids: Array<string> = tracker.getEnteredTabIds();
    ids.push("tab-99");

    expect(tracker.hasEntered("tab-99")).toBe(false);
    expect(tracker.getEnteredTabIds()).toEqual(["tab-2"]);
  });
});
