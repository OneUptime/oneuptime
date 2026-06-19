import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "oneuptime_sso_tokens";
const GLOBAL_STORAGE_KEY: string = "oneuptime_global_sso_token";

// In-memory cache for fast synchronous access by the API client interceptor
let cachedSsoTokens: Record<string, string> = {};
let cachedGlobalSsoToken: string | null = null;

export function getCachedSsoTokens(): Record<string, string> {
  return cachedSsoTokens;
}

export function getCachedGlobalSsoToken(): string | null {
  return cachedGlobalSsoToken;
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

/**
 * Persist the single Global SSO token returned by a global SSO/OIDC login. It
 * is not bound to a project, so one token satisfies SSO enforcement for every
 * project the user belongs to (including ones created after login).
 */
export async function storeGlobalSsoToken(token: string): Promise<void> {
  cachedGlobalSsoToken = token;
  await AsyncStorage.setItem(GLOBAL_STORAGE_KEY, token);
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

export async function getGlobalSsoToken(): Promise<string | null> {
  const value: string | null = await AsyncStorage.getItem(GLOBAL_STORAGE_KEY);
  cachedGlobalSsoToken = value;
  return value;
}

export async function removeSsoToken(projectId: string): Promise<void> {
  const tokens: Record<string, string> = await getSsoTokens();
  delete tokens[projectId];
  cachedSsoTokens = tokens;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function clearAllSsoTokens(): Promise<void> {
  cachedSsoTokens = {};
  cachedGlobalSsoToken = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(GLOBAL_STORAGE_KEY);
}
