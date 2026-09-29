import { ReplayPhase } from "./Engine/ReplayEngineTypes";
import { ReplayTabSummary } from "./ReplayTabs";

/*
 * Whether playback carries on into the next browser tab on its own, as a
 * pure decision.
 *
 * The browser recorder mints a NEW tab id on every page load
 * (SessionId.rotateTabId), so in a multi-page app every navigation starts
 * another "tab" and one ten-minute visit is a dozen of them. The engine
 * plays exactly one tab: when that tab's last chunk has been fed rrweb
 * emits Finish, the engine parks at buffer "ended" with intent "paused",
 * and the shell offers "Continue in Tab 2". Watching a whole session was
 * therefore N clicks of Continue - and, because the switch preserved the
 * paused intent it landed on, N clicks of Play after them
 * (github.com/OneUptime/oneuptime/issues/3865).
 *
 * The rules live here rather than in the shell's effect because every one
 * of them is a judgement about when NOT to move the viewer somewhere they
 * did not ask to go, and those are exactly the cases worth pinning:
 *
 *  - a tab the viewer PAUSED at the end of is a stopping point they chose;
 *  - the same tab is never auto-entered twice, so a session whose tabs
 *    overlap in time cannot become a loop;
 *  - a hop cap is the backstop for a manifest whose offsets disagree with
 *    its ordering (a clock skew, a chunk sealed after the session was),
 *    so the worst case is a bounded walk, not a spin;
 *  - and the preference is honoured, because a viewer auditing one page
 *    load at a time wants the player to stop where that page stopped.
 *
 * Nothing here touches React, the engine or the DOM: App's Jest project
 * runs it in the node environment.
 */

/*
 * The phases that mean playback was running when the tab played out.
 *
 * "buffering" belongs here with "playing": derivePhase maps
 * stalled + playing to buffering, and the last chunk of a tab is very
 * often fed out of a stall, so the phase immediately before "ended" is as
 * likely to be buffering as playing. Treating buffering as "the viewer
 * was not watching" would have made auto-continue fire on some tabs and
 * not others for no reason a viewer could see.
 */
export const REPLAY_AUTO_CONTINUE_PLAYBACK_PHASES: ReadonlyArray<ReplayPhase> =
  ["playing", "buffering"];

/*
 * The most tabs one mount will walk into automatically. A recorder that
 * mints a tab per page load can legitimately produce dozens, so this is
 * generous - it exists only so a manifest whose per-tab offsets contradict
 * its ordering cannot turn the shell into an endless switcher. Reaching it
 * leaves the viewer at the ended card with the Continue chip, which is
 * where they were before any of this existed.
 */
export const REPLAY_AUTO_CONTINUE_MAX_HOPS: number = 64;

/* Why an end-of-tab stop did not continue anywhere. */
export type ReplayAutoContinueSkipReason =
  /* The viewer turned auto-continue off. */
  | "disabled"
  /* The engine is not at the end of a tab at all. */
  | "not-ended"
  /* Nothing was playing: the viewer stopped here on purpose. */
  | "paused-by-viewer"
  /* No other tab has footage past this point. */
  | "no-next-tab"
  /* This tab was already entered automatically once. */
  | "already-continued"
  /* The hop cap. */
  | "limit-reached";

export interface ReplayAutoContinueDecision {
  shouldContinue: boolean;
  /* The tab to switch to; null whenever shouldContinue is false. */
  tabId: string | null;
  /* Null exactly when shouldContinue is true. */
  reason: ReplayAutoContinueSkipReason | null;
}

export interface ReplayAutoContinueInput {
  /* The viewer's preference. */
  isEnabled: boolean;
  /* The phase the engine has just reached. */
  phase: ReplayPhase;
  /*
   * The engine reached "ended" while playback was running - the tab played
   * out - rather than the viewer stopping there.
   *
   * A boolean the shell HOLDS for as long as the phase stays "ended",
   * not the previous phase read off this publish: the tab that continues
   * the session is not always known at the moment the current one ends. A
   * live recording learns about the page the user navigated to from the
   * next 30-second manifest poll, and a decision that could only fire on
   * the exact transition would have missed every one of those.
   */
  didPlayOut: boolean;
  /*
   * The tab that continues the session after the playhead, as
   * findTabContinuingAfter picked it. Null when nothing follows.
   */
  nextTab: ReplayTabSummary | null;
  /* Tabs already entered automatically during this mount. */
  enteredTabIds: ReadonlyArray<string>;
  /* Hops already taken during this mount. */
  hopCount: number;
  /* Defaults to REPLAY_AUTO_CONTINUE_MAX_HOPS. */
  maxHops?: number | undefined;
}

/* True when `phase` means the engine had playback intent. */
export function isReplayPlaybackPhase(
  phase: ReplayPhase | null | undefined,
): boolean {
  return (
    typeof phase === "string" &&
    (REPLAY_AUTO_CONTINUE_PLAYBACK_PHASES as ReadonlyArray<string>).includes(
      phase,
    )
  );
}

function skip(
  reason: ReplayAutoContinueSkipReason,
): ReplayAutoContinueDecision {
  return { shouldContinue: false, tabId: null, reason: reason };
}

/*
 * Whether the shell should switch tabs and keep playing, and where to.
 *
 * The order of the checks is part of the contract, because the reason is
 * what the tests (and a future diagnostic) read: the cheap facts about
 * where the engine is come first ("is this even the end of a tab?"), then
 * the viewer's own choices, then the loop guards.
 *
 * It is a pure function of its arguments and is safe to call on every
 * structural publish. Idempotence is NOT a transition check - the tab
 * that continues a live session can appear several polls after the
 * current one ended, so the answer has to stay available while the engine
 * sits at "ended". It comes from `enteredTabIds` instead: the shell
 * records a hop before it makes it, so a second evaluation for the same
 * target answers "already-continued".
 */
export function decideReplayAutoContinue(
  input: ReplayAutoContinueInput,
): ReplayAutoContinueDecision {
  if (input.phase !== "ended") {
    return skip("not-ended");
  }

  if (!input.didPlayOut) {
    return skip("paused-by-viewer");
  }

  if (!input.isEnabled) {
    return skip("disabled");
  }

  const nextTab: ReplayTabSummary | null = input.nextTab;

  if (!nextTab || !nextTab.tabId || !nextTab.hasFootage) {
    return skip("no-next-tab");
  }

  if (input.enteredTabIds.includes(nextTab.tabId)) {
    return skip("already-continued");
  }

  const maxHops: number =
    typeof input.maxHops === "number" && Number.isFinite(input.maxHops)
      ? input.maxHops
      : REPLAY_AUTO_CONTINUE_MAX_HOPS;

  if (input.hopCount >= maxHops) {
    return skip("limit-reached");
  }

  return { shouldContinue: true, tabId: nextTab.tabId, reason: null };
}

/*
 * The transient notice the stage shows as the switch happens: without it
 * the picture changes to another page for no stated reason, which reads as
 * the player having lost its place. Named after the tab the viewer will
 * see in the strip a moment later, so the two agree.
 */
export function describeReplayAutoContinue(tab: ReplayTabSummary): string {
  return `The recording carried on in ${tab.label} - continuing there.`;
}

/*
 * What one mount remembers: which tabs it walked into on its own, and how
 * many hops that took. Held by the shell in a ref and reset whenever the
 * viewer takes the wheel (a tab pill, the picker), so going back to Tab 1
 * by hand arms auto-continue for that stretch again rather than leaving
 * the viewer parked at every end for the rest of the session.
 */
export class ReplayAutoContinueTracker {
  private readonly enteredTabIds: Set<string>;
  private hopCount: number;

  public constructor() {
    this.enteredTabIds = new Set<string>();
    this.hopCount = 0;
  }

  public getEnteredTabIds(): Array<string> {
    return [...this.enteredTabIds];
  }

  public getHopCount(): number {
    return this.hopCount;
  }

  public hasEntered(tabId: string): boolean {
    return this.enteredTabIds.has(tabId);
  }

  /* One completed hop. The count moves even if the tab repeats. */
  public noteEntered(tabId: string): void {
    if (typeof tabId === "string" && tabId.length > 0) {
      this.enteredTabIds.add(tabId);
    }

    this.hopCount += 1;
  }

  public reset(): void {
    this.enteredTabIds.clear();
    this.hopCount = 0;
  }
}
