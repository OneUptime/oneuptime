import AsyncStorage from "@react-native-async-storage/async-storage";

/*
 * What this phone keeps of its first steps (onboarding/getReady.ts):
 *
 *   - that the app has opened them by itself once, so it never does again;
 *   - that a test page sent from this app was acknowledged, per person and
 *     project, so the step stays done the next time the screen opens.
 *
 * Reads never throw: storage that cannot be read reads as nothing kept.
 */

export const GET_READY_SEEN_KEY: string = "oneuptime_get_ready_seen";

export const GET_READY_TEST_PAGE_KEY_PREFIX: string =
  "oneuptime_get_ready_test_page_acknowledged:";

function testPageKey(projectId: string, userId: string): string {
  return `${GET_READY_TEST_PAGE_KEY_PREFIX}${projectId}:${userId}`;
}

export async function hasSeenGetReady(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(GET_READY_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markGetReadySeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(GET_READY_SEEN_KEY, "true");
  } catch {
    // Not kept: the first steps may open by themselves once more.
  }
}

export async function hasAcknowledgedTestPageFromApp(
  projectId: string,
  userId: string,
): Promise<boolean> {
  try {
    return (
      (await AsyncStorage.getItem(testPageKey(projectId, userId))) === "true"
    );
  } catch {
    return false;
  }
}

export async function rememberTestPageAcknowledged(
  projectId: string,
  userId: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(testPageKey(projectId, userId), "true");
  } catch {
    // Not kept: the step reads as to do the next time.
  }
}
