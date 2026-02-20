import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "oneuptime_sso_tokens";

// In-memory cache for fast synchronous access by the API client interceptor
let cachedSsoTokens: Record<string, string> = {};

export function getCachedSsoTokens(): Record<string, string> {
  return cachedSsoTokens;
}

export async function storeSsoToken(
  projectId: string,
  token: string,
): Promise<void> {
  const tokens: Record<string, string> = await getSsoTokens();
  tokens[projectId] = token;
  cachedSsoTokens = tokens;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function getSsoTokens(): Promise<Record<string, string>> {
  const value: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (!value) {
    cachedSsoTokens = {};
    return {};
  }

  try {
    const tokens: Record<string, string> = JSON.parse(value);
    cachedSsoTokens = tokens;
    return tokens;
  } catch {
    cachedSsoTokens = {};
    return {};
  }
}

export async function removeSsoToken(projectId: string): Promise<void> {
  const tokens: Record<string, string> = await getSsoTokens();
  delete tokens[projectId];
  cachedSsoTokens = tokens;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function clearAllSsoTokens(): Promise<void> {
  cachedSsoTokens = {};
  await AsyncStorage.removeItem(STORAGE_KEY);
}
