import {
  clearAllSsoDenials,
  clearProjectSsoDenial,
  getSsoDeniedProjectIds,
  isProjectSsoDenied,
  markProjectSsoDenied,
  subscribeToSsoDenials,
} from "./ssoDenials";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * This module is the app's record of what the SERVER refused, and the screens
 * treat it as authoritative over anything in storage. That inversion is the
 * whole point: the app used to reason "a global SSO token exists, therefore
 * every project is satisfied", which is wrong for an expired token, wrong for a
 * disabled provider, and wrong when an admin has opted a provider into
 * restrictToAttachedProjects. The visible symptom was a project rendering a
 * green "Authenticated" badge with no re-authenticate button while every single
 * request to it came back 406.
 *
 * So the failure mode this file guards is not a crash. It is a denial that is
 * recorded but never announced (src/screens/settings/ProjectsScreen.tsx mirrors
 * this set into React state through subscribeToSsoDenials, so a missing
 * notification is a button that never appears), or a denial that outlives the
 * login that fixed it (src/sso/session.ts clears on a successful callback, so a
 * missed clear is a button demanding SSO the user has just completed).
 *
 * Both of those look identical to "working" from inside the module, which is
 * why almost every test below pairs a "nothing should happen" case with the
 * same setup where one detail is changed and something must happen. A
 * do-nothing implementation of markProjectSsoDenied, or a notify() wired to
 * fire on every call, has to fail one half of each pair.
 *
 * Nothing here is platform-specific - it is a Set and an array of callbacks -
 * so every assertion is expected to hold under both the "ios" and the "android"
 * Jest project.
 */

const PROJECT_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJECT_C: string = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/*
 * A listener that records the state it was able to OBSERVE at the moment it
 * ran, not merely that it ran. notify() firing before the Set is mutated would
 * be invisible to a call counter, and would make ProjectsScreen re-read stale
 * ids and paint the previous frame's badges.
 */
interface Recorder {
  listener: () => void;
  snapshots: Array<Array<string>>;
}

function recorder(): Recorder {
  const snapshots: Array<Array<string>> = [];

  return {
    snapshots,
    listener: (): void => {
      snapshots.push(getSsoDeniedProjectIds());
    },
  };
}

function callCount(subject: Recorder): number {
  return subject.snapshots.length;
}

function lastSnapshot(subject: Recorder): Array<string> {
  return subject.snapshots[subject.snapshots.length - 1]!;
}

/*
 * The listener list lives at module scope and nothing in the module's public
 * surface clears it, so a subscription leaked by one test would still be
 * attached during every test that follows. Registering through this helper
 * means afterEach can guarantee each test starts with no subscribers at all.
 */
let activeUnsubscribes: Array<() => void> = [];

function subscribe(subject: Recorder): () => void {
  const unsubscribe: () => void = subscribeToSsoDenials(subject.listener);

  activeUnsubscribes.push(unsubscribe);

  return unsubscribe;
}

/*
 * The denial Set is module scope too, and it is deliberately in-memory rather
 * than persisted - so importing the module twice in one process is the same
 * state. Reset it before every test, or a test inherits the previous one's
 * denials and passes for the wrong reason.
 */
beforeEach(() => {
  clearAllSsoDenials();
});

afterEach(() => {
  for (const unsubscribe of activeUnsubscribes) {
    unsubscribe();
  }

  activeUnsubscribes = [];
});

describe("recording a denial", () => {
  test("a marked project reads back as denied, and its neighbours do not", () => {
    markProjectSsoDenied(PROJECT_A);

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
  });

  test("several projects are tracked independently", () => {
    /*
     * A user can be refused by more than one project in the same session - the
     * dashboard polls several at once - and each has to keep its own answer.
     */
    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_B);
    markProjectSsoDenied(PROJECT_C);

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(true);
    expect(isProjectSsoDenied(PROJECT_C)).toBe(true);

    const ids: Array<string> = getSsoDeniedProjectIds();

    expect(ids).toHaveLength(3);
    expect(ids).toEqual(
      expect.arrayContaining([PROJECT_A, PROJECT_B, PROJECT_C]),
    );
  });

  test("a project nobody has been refused for is not denied", () => {
    markProjectSsoDenied(PROJECT_A);

    expect(isProjectSsoDenied(PROJECT_C)).toBe(false);
    expect(getSsoDeniedProjectIds()).not.toContain(PROJECT_C);
  });

  test("marking the same project twice neither duplicates it nor notifies twice", () => {
    /*
     * Every failing request to a denied project marks it again, so this is the
     * common case, not an edge case: a dashboard refreshing on a timer would
     * otherwise re-render the whole project list on a fixed interval forever.
     *
     * The paired assertion is the point - a DIFFERENT id under the same
     * subscription must still get through, so "notified once" cannot be
     * satisfied by a notify() that has simply stopped working.
     */
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_A);

    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
    expect(callCount(subject)).toBe(1);

    markProjectSsoDenied(PROJECT_B);

    expect(callCount(subject)).toBe(2);
    expect(getSsoDeniedProjectIds()).toHaveLength(2);
  });

  test("an empty project id is ignored, while a real one alongside it is not", () => {
    /*
     * The API client reads the id off the outgoing `tenantid` header
     * (src/api/client.ts), which is absent on instance-level calls. Recording
     * "" would put a denial in the set that no project can ever clear, because
     * no project is keyed by it.
     */
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied("");

    expect(getSsoDeniedProjectIds()).toEqual([]);
    expect(isProjectSsoDenied("")).toBe(false);
    expect(callCount(subject)).toBe(0);

    // Same call, same subscription - only the id is different.
    markProjectSsoDenied(PROJECT_A);

    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
    expect(callCount(subject)).toBe(1);
  });
});

describe("clearing a denial", () => {
  test("clearing one project leaves the others denied", () => {
    /*
     * A per-project SSO login satisfies exactly one project. Dropping the
     * others' denials here would hide the re-authenticate button on projects
     * the server is still refusing.
     */
    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_B);
    markProjectSsoDenied(PROJECT_C);

    clearProjectSsoDenial(PROJECT_B);

    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(isProjectSsoDenied(PROJECT_C)).toBe(true);

    const ids: Array<string> = getSsoDeniedProjectIds();

    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([PROJECT_A, PROJECT_C]));
    expect(ids).not.toContain(PROJECT_B);
  });

  test("clearing a project that was never denied does not notify, but clearing a denied one does", () => {
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(subject)).toBe(1);

    clearProjectSsoDenial(PROJECT_B);

    expect(callCount(subject)).toBe(1);
    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);

    // Same call, same subscription - only the id is different.
    clearProjectSsoDenial(PROJECT_A);

    expect(callCount(subject)).toBe(2);
    expect(getSsoDeniedProjectIds()).toEqual([]);
  });

  test("clearing an empty id does not notify and does not disturb the set", () => {
    const subject: Recorder = recorder();

    markProjectSsoDenied(PROJECT_A);
    subscribe(subject);

    clearProjectSsoDenial("");

    expect(callCount(subject)).toBe(0);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);

    clearProjectSsoDenial(PROJECT_A);

    expect(callCount(subject)).toBe(1);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
  });

  test("clearing the same project twice notifies only for the first", () => {
    const subject: Recorder = recorder();

    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_B);
    subscribe(subject);

    clearProjectSsoDenial(PROJECT_A);
    clearProjectSsoDenial(PROJECT_A);

    expect(callCount(subject)).toBe(1);

    // The second clear was a no-op, not a failure of clearing in general.
    clearProjectSsoDenial(PROJECT_B);

    expect(callCount(subject)).toBe(2);
    expect(getSsoDeniedProjectIds()).toEqual([]);
  });

  test("a project can be denied again after being cleared", () => {
    /*
     * Clearing is optimistic - it happens after a login that COULD have fixed
     * the denial, and lets the server answer again. If the server refuses once
     * more, that refusal has to stick.
     */
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);
    clearProjectSsoDenial(PROJECT_A);
    markProjectSsoDenied(PROJECT_A);

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
    expect(callCount(subject)).toBe(3);
  });
});

describe("clearing every denial at once", () => {
  test("a global login drops every project's denial", () => {
    /*
     * A Global SSO/OIDC login can satisfy any number of projects and the token
     * does not say which, so src/sso/session.ts drops them all and lets the
     * server re-answer per project.
     */
    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_B);
    markProjectSsoDenied(PROJECT_C);

    clearAllSsoDenials();

    expect(getSsoDeniedProjectIds()).toEqual([]);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_C)).toBe(false);
  });

  test("clearing an already-empty set does not notify, but clearing a populated one does", () => {
    const subject: Recorder = recorder();

    subscribe(subject);

    clearAllSsoDenials();

    expect(callCount(subject)).toBe(0);

    // Same call, same subscription - only the set is non-empty now.
    markProjectSsoDenied(PROJECT_A);
    clearAllSsoDenials();

    expect(callCount(subject)).toBe(2);
    expect(getSsoDeniedProjectIds()).toEqual([]);
  });

  test("clearing everything twice notifies only for the first", () => {
    const subject: Recorder = recorder();

    markProjectSsoDenied(PROJECT_A);
    subscribe(subject);

    clearAllSsoDenials();
    clearAllSsoDenials();

    expect(callCount(subject)).toBe(1);

    // Still functional: re-populating and clearing again does notify.
    markProjectSsoDenied(PROJECT_B);
    clearAllSsoDenials();

    expect(callCount(subject)).toBe(3);
  });
});

describe("subscribers", () => {
  test("a listener is notified on a mark, on a clear, and on a clear-all", () => {
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(subject)).toBe(1);

    clearProjectSsoDenial(PROJECT_A);

    expect(callCount(subject)).toBe(2);

    markProjectSsoDenied(PROJECT_B);
    clearAllSsoDenials();

    expect(callCount(subject)).toBe(4);
  });

  test("a listener sees the new state, not the state before the change", () => {
    /*
     * ProjectsScreen's listener does not receive the change - it re-reads
     * getSsoDeniedProjectIds(). Notifying before the mutation would hand it the
     * previous frame's ids and leave the UI exactly one event behind forever.
     */
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);

    expect(lastSnapshot(subject)).toEqual([PROJECT_A]);

    markProjectSsoDenied(PROJECT_B);

    expect(lastSnapshot(subject)).toHaveLength(2);
    expect(lastSnapshot(subject)).toEqual(
      expect.arrayContaining([PROJECT_A, PROJECT_B]),
    );

    clearProjectSsoDenial(PROJECT_A);

    expect(lastSnapshot(subject)).toEqual([PROJECT_B]);

    clearAllSsoDenials();

    expect(lastSnapshot(subject)).toEqual([]);
  });

  test("every subscriber is notified, not just the first", () => {
    /*
     * The projects list and the home screen can both be mounted at once, and
     * whichever subscribed second must not be the one left rendering a stale
     * badge.
     */
    const first: Recorder = recorder();
    const second: Recorder = recorder();
    const third: Recorder = recorder();

    subscribe(first);
    subscribe(second);
    subscribe(third);

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(first)).toBe(1);
    expect(callCount(second)).toBe(1);
    expect(callCount(third)).toBe(1);
    expect(lastSnapshot(third)).toEqual([PROJECT_A]);
  });

  test("the same listener subscribed twice is notified once per subscription", () => {
    /*
     * Subscriptions are not de-duplicated by callback identity. Worth pinning
     * because the alternative - silently collapsing them - would mean a screen
     * that remounts and re-subscribes before the old effect's cleanup runs ends
     * up with no subscription at all once that cleanup does run.
     */
    const subject: Recorder = recorder();

    subscribe(subject);
    subscribe(subject);

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(subject)).toBe(2);
  });

  test("unsubscribing stops that listener and leaves the others alone", () => {
    /*
     * The screens unsubscribe on unmount. A leak here is not a crash: it is a
     * setState on an unmounted screen for the rest of the process's life.
     */
    const staying: Recorder = recorder();
    const leaving: Recorder = recorder();
    const alsoStaying: Recorder = recorder();

    subscribe(staying);
    const unsubscribe: () => void = subscribe(leaving);
    subscribe(alsoStaying);

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(staying)).toBe(1);
    expect(callCount(leaving)).toBe(1);
    expect(callCount(alsoStaying)).toBe(1);

    unsubscribe();

    markProjectSsoDenied(PROJECT_B);

    expect(callCount(leaving)).toBe(1);
    expect(callCount(staying)).toBe(2);
    expect(callCount(alsoStaying)).toBe(2);
  });

  test("unsubscribing twice is harmless and does not take a second listener with it", () => {
    /*
     * React can invoke an effect's cleanup more than once across a Strict Mode
     * remount, so the second call has to be a no-op rather than popping
     * whatever is at that index now.
     */
    const leaving: Recorder = recorder();
    const staying: Recorder = recorder();

    const unsubscribe: () => void = subscribe(leaving);

    subscribe(staying);

    unsubscribe();

    expect((): void => {
      unsubscribe();
    }).not.toThrow();

    markProjectSsoDenied(PROJECT_A);

    expect(callCount(leaving)).toBe(0);
    expect(callCount(staying)).toBe(1);
  });

  test("a listener subscribed after a denial is not replayed the ones it missed", () => {
    /*
     * Subscribers read the current set at mount (ProjectsScreen seeds its state
     * from getSsoDeniedProjectIds()), so the subscription is for CHANGES only.
     */
    const late: Recorder = recorder();

    markProjectSsoDenied(PROJECT_A);
    subscribe(late);

    expect(callCount(late)).toBe(0);
    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);

    markProjectSsoDenied(PROJECT_B);

    expect(callCount(late)).toBe(1);
  });

  test("a mark with no subscribers at all is still recorded", () => {
    /*
     * The API client marks denials whether or not a screen is mounted; the
     * denial has to be waiting in the set when one finally is.
     */
    markProjectSsoDenied(PROJECT_A);

    const late: Recorder = recorder();

    subscribe(late);

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
    expect(callCount(late)).toBe(0);
  });
});

describe("getSsoDeniedProjectIds returns a copy", () => {
  test("mutating the returned array does not change module state", () => {
    /*
     * ProjectsScreen puts this array straight into React state, where it is
     * filtered and sorted by render code that has no idea it might be the
     * module's own storage. Handing out the live collection would let a screen
     * silently erase the app's record of what the server refused.
     */
    markProjectSsoDenied(PROJECT_A);
    markProjectSsoDenied(PROJECT_B);

    const ids: Array<string> = getSsoDeniedProjectIds();

    ids.push("injected-project-id");
    ids.splice(0, 1);

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(isProjectSsoDenied("injected-project-id")).toBe(false);

    const fresh: Array<string> = getSsoDeniedProjectIds();

    expect(fresh).toHaveLength(2);
    expect(fresh).toEqual(expect.arrayContaining([PROJECT_A, PROJECT_B]));
    expect(fresh).not.toContain("injected-project-id");
  });

  test("emptying the returned array does not empty the module", () => {
    markProjectSsoDenied(PROJECT_A);

    const ids: Array<string> = getSsoDeniedProjectIds();

    ids.length = 0;

    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
  });

  test("two calls hand back two different arrays", () => {
    markProjectSsoDenied(PROJECT_A);

    const first: Array<string> = getSsoDeniedProjectIds();
    const second: Array<string> = getSsoDeniedProjectIds();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  test("an already-returned array does not grow when a new denial arrives", () => {
    // The snapshot is a value, not a live view - React relies on that to diff.
    markProjectSsoDenied(PROJECT_A);

    const snapshot: Array<string> = getSsoDeniedProjectIds();

    markProjectSsoDenied(PROJECT_B);

    expect(snapshot).toEqual([PROJECT_A]);
    expect(getSsoDeniedProjectIds()).toHaveLength(2);
  });
});

describe("the module state does not leak between tests", () => {
  /*
   * These two are deliberately a matched pair: each denies a different project
   * and asserts the set was empty on entry. Run in either order, one of them
   * would see the other's project if beforeEach were not resetting the module.
   */
  test("first test starts from an empty set", () => {
    expect(getSsoDeniedProjectIds()).toEqual([]);

    markProjectSsoDenied(PROJECT_A);

    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_A]);
  });

  test("second test starts from an empty set too", () => {
    expect(getSsoDeniedProjectIds()).toEqual([]);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);

    markProjectSsoDenied(PROJECT_B);

    expect(getSsoDeniedProjectIds()).toEqual([PROJECT_B]);
  });

  test("a subscription taken out here is not visible to the next test", () => {
    /*
     * Nothing in the module's surface empties the listener list, so this file
     * unsubscribes in afterEach. Without that, every "notified once" assertion
     * elsewhere would be measuring a listener list that grows with the suite.
     */
    const subject: Recorder = recorder();

    subscribe(subject);

    markProjectSsoDenied(PROJECT_C);

    expect(callCount(subject)).toBe(1);
    expect(lastSnapshot(subject)).toEqual([PROJECT_C]);
  });
});
