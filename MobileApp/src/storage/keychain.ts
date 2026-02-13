import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "com.oneuptime.oncall.tokens";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

// In-memory cache for fast synchronous access
let cachedAccessToken: string | null = null;

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  cachedAccessToken = tokens.accessToken;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function getTokens(): Promise<StoredTokens | null> {
  const value: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (!value) {
    cachedAccessToken = null;
    return null;
  }

  try {
    const tokens: StoredTokens = JSON.parse(value);
    cachedAccessToken = tokens.accessToken;
    return tokens;
  } catch {
    cachedAccessToken = null;
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  cachedAccessToken = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
}
