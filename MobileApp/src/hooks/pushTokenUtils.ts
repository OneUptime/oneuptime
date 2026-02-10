import AsyncStorage from "@react-native-async-storage/async-storage";
import { unregisterPushDevice } from "../api/pushDevice";

export const PUSH_TOKEN_KEY: string = "oneuptime_expo_push_token";

export async function unregisterPushToken(): Promise<void> {
  try {
    const token: string | null = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await unregisterPushDevice(token);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }
  } catch {
    // Best-effort: don't block logout
  }
}
