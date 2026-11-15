import { onUserActivity } from "../auth/userActivity";

/*
 * Listens for what the app counts as its person using it
 * (auth/userActivity), which the server's idle timeout counts from: for a
 * screen's suite to check that typing in its fields is counted. The tracker
 * announces an activity once it has read what the last launch kept, a few
 * microtasks after it happened, so a suite waits for it (waitFor).
 *
 * Deliberately not named *.test.ts: a helper, not a suite.
 */
export interface HeardUserActivity {
  heard: Array<number>;
  stop: () => void;
}

export function listenForUserActivity(): HeardUserActivity {
  const heard: Array<number> = [];

  const stop: () => void = onUserActivity((atMs: number): void => {
    heard.push(atMs);
  });

  return { heard, stop };
}
