import * as Keychain from "react-native-keychain";

const SERVICE_NAME: string = "com.oneuptime.oncall.tokens";

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
  await Keychain.setGenericPassword("tokens", JSON.stringify(tokens), {
    service: SERVICE_NAME,
  });
}

export async function getTokens(): Promise<StoredTokens | null> {
  const credentials: false | Keychain.UserCredentials =
    await Keychain.getGenericPassword({
      service: SERVICE_NAME,
    });

  if (!credentials || typeof credentials === "boolean") {
    cachedAccessToken = null;
    return null;
  }

  try {
    const tokens: StoredTokens = JSON.parse(credentials.password);
    cachedAccessToken = tokens.accessToken;
    return tokens;
  } catch {
    cachedAccessToken = null;
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  cachedAccessToken = null;
  await Keychain.resetGenericPassword({ service: SERVICE_NAME });
}
