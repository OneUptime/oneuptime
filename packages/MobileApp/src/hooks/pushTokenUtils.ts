import AsyncStorage from "@react-native-async-storage/async-storage";
import { unregisterPushDevice } from "../api/pushDevice";

export const PUSH_TOKEN_KEY: string = "oneuptime_expo_push_token";

/*
 * The push token this app had before its current one, kept until every
 * project has been told about the change (getPreviousPushTokenToReport).
 */
export const PREVIOUS_PUSH_TOKEN_KEY: string =
  "oneuptime_expo_previous_push_token";

export async function unregisterPushToken(): Promise<void> {
  try {
    const token: string | null = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await unregisterPushDevice(token);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }

    /*
     * Signed out: a token change not yet told to every project is not this
     * account's to tell any more. Storage is touched only when there is one.
     */
    if (await AsyncStorage.getItem(PREVIOUS_PUSH_TOKEN_KEY)) {
      await AsyncStorage.removeItem(PREVIOUS_PUSH_TOKEN_KEY);
    }
  } catch {
    // Best-effort: don't block logout
  }
}

/*
 * The token to tell the server this app had before `token`, or null when it
 * has not changed. The app keeps its data on a phone set up from a backup of
 * the old one, but Expo gives it a new token there; the server then moves the
 * device registered with the old token - and its notification rules - to the
 * new one, instead of adding a new device beside one that can no longer be
 * reached.
 *
 * Read before the new token is stored, and kept until
 * previousPushTokenReported(): a registration that failed for a project tells
 * that project again on the next attempt.
 *
 * Never throws: storage that cannot be read reports nothing, and the phone
 * registers as it always did - registering must never depend on this.
 */
export async function getPreviousPushTokenToReport(
  token: string,
): Promise<string | null> {
  try {
    const storedToken: string | null =
      await AsyncStorage.getItem(PUSH_TOKEN_KEY);

    if (storedToken && storedToken !== token) {
      await AsyncStorage.setItem(PREVIOUS_PUSH_TOKEN_KEY, storedToken);
      return storedToken;
    }

    const pendingToken: string | null = await AsyncStorage.getItem(
      PREVIOUS_PUSH_TOKEN_KEY,
    );

    if (pendingToken && pendingToken !== token) {
      return pendingToken;
    }

    if (pendingToken) {
      await AsyncStorage.removeItem(PREVIOUS_PUSH_TOKEN_KEY);
    }
  } catch {
    // Unreadable storage: nothing to report.
  }

  return null;
}

/*
 * Every project was told about the token change: nothing is left to tell.
 * Never throws; a note that could not be cleared is told again, harmlessly.
 */
export async function previousPushTokenReported(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREVIOUS_PUSH_TOKEN_KEY);
  } catch {
    // Told again next time; the server renews nothing twice.
  }
}
