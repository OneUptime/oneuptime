import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hasSeenGetReady, markGetReadySeen } from "../storage/getReady";
import { PUSH_TOKEN_KEY } from "../hooks/pushTokenUtils";

/*
 * WHETHER THIS LAUNCH IS A NEW INSTALL'S FIRST (#7041): the one launch on
 * which the app opens its first steps by itself (GetReadyFirstRun).
 *
 * Decided once, as the app starts - before anybody signs in and before it
 * registers for pushes, which leaves the mark it reads:
 *
 *   - the first steps opened already (storage/getReady.ts): not first;
 *   - a push token kept: a phone already registered for pages, by a
 *     version from before the first steps - not first, and never after,
 *     so an update never surprises somebody already set up;
 *   - neither: a new install, or one that never got as far as receiving a
 *     page. The first steps open once it is signed in to a project.
 *
 * Never on the browser preview: it has no notifications to allow.
 */

let decision: Promise<boolean> | null = null;

async function decide(): Promise<boolean> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return false;
  }

  try {
    if (await hasSeenGetReady()) {
      return false;
    }

    if (await AsyncStorage.getItem(PUSH_TOKEN_KEY)) {
      await markGetReadySeen();
      return false;
    }

    return true;
  } catch {
    // Nothing could be read: say nothing rather than open it by surprise.
    return false;
  }
}

/*
 * Whether this is a new install's first launch. The first call decides -
 * make it as the app starts (RootNavigator) - and every later call gets
 * the same answer.
 */
export function isFirstRunOfThisInstall(): Promise<boolean> {
  if (!decision) {
    decision = decide();
  }

  return decision;
}

// Forgets the decision: tests only.
export function resetFirstRunDecision(): void {
  decision = null;
}
