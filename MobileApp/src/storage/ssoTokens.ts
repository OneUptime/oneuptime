import AsyncStorage from "@react-native-async-storage/async-storage";
import { isJwtExpired } from "../utils/jwt";

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

/*
 * SSO tokens are signed for 30 days (Common/Server/Utils/Cookie.ts). Once one
 * lapses the server answers 406 for every request against an SSO-enforced
 * project, and it does not say why. Dropping an expired token on read means
 * the app can instead see the project as un-authenticated and offer the user
 * the one thing that fixes it: signing in again.
 */

export async function getSsoTokens(): Promise<Record<string, string>> {
  const value: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (!value) {
    cachedSsoTokens = {};
    return {};
  }

  let parsed: Record<string, string>;

  try {
    parsed = JSON.parse(value);
  } catch {
    cachedSsoTokens = {};
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    cachedSsoTokens = {};
    return {};
  }

  const live: Record<string, string> = {};
  let evictedAny: boolean = false;

  for (const projectId of Object.keys(parsed)) {
    const token: string = parsed[projectId]!;

    if (typeof token === "string" && !isJwtExpired(token)) {
      live[projectId] = token;
    } else {
      evictedAny = true;
    }
  }

  cachedSsoTokens = live;

  // Write back only when something actually lapsed, to keep reads cheap.
  if (evictedAny) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(live));
  }

  return live;
}

export async function getGlobalSsoToken(): Promise<string | null> {
  const value: string | null = await AsyncStorage.getItem(GLOBAL_STORAGE_KEY);

  if (!value || isJwtExpired(value)) {
    cachedGlobalSsoToken = null;

    if (value) {
      await AsyncStorage.removeItem(GLOBAL_STORAGE_KEY);
    }

    return null;
  }

  cachedGlobalSsoToken = value;
  return value;
}

export async function removeSsoToken(projectId: string): Promise<void> {
  const tokens: Record<string, string> = await getSsoTokens();
  delete tokens[projectId];
  cachedSsoTokens = tokens;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export async function removeGlobalSsoToken(): Promise<void> {
  cachedGlobalSsoToken = null;
  await AsyncStorage.removeItem(GLOBAL_STORAGE_KEY);
}

export async function clearAllSsoTokens(): Promise<void> {
  cachedSsoTokens = {};
  cachedGlobalSsoToken = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(GLOBAL_STORAGE_KEY);
}
