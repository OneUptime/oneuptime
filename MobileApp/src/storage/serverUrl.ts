import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "oneuptime_server_url";
const DEFAULT_SERVER_URL = "https://oneuptime.com";

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getServerUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, normalizeUrl(url));
}

export async function hasServerUrl(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored !== null;
}

export async function clearServerUrl(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
