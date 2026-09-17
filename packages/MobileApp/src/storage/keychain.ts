import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "com.oneuptime.oncall.tokens";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

// In-memory cache for fast synchronous access
let cachedAccessToken: string | null = null;
let tokenRevision: number = 0;
let tokenMutations: Promise<void> = Promise.resolve();

function queueTokenMutation(operation: () => Promise<void>): Promise<void> {
  const mutation: Promise<void> = tokenMutations.then(operation);
  // A failed write must not prevent a later sign-out or replacement session.
  tokenMutations = mutation.catch((): void => {
    // The caller still receives the original rejection through `mutation`.
  });
  return mutation;
}

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  tokenRevision++;
  cachedAccessToken = tokens.accessToken;
  await queueTokenMutation(async (): Promise<void> => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  });
}

export async function getTokens(): Promise<StoredTokens | null> {
  const readRevision: number = tokenRevision;
  await tokenMutations;
  const value: string | null = await AsyncStorage.getItem(STORAGE_KEY);

  if (!value) {
    if (readRevision === tokenRevision) {
      cachedAccessToken = null;
    }
    return null;
  }

  try {
    const tokens: StoredTokens = JSON.parse(value);
    if (readRevision === tokenRevision) {
      cachedAccessToken = tokens.accessToken;
    }
    return tokens;
  } catch {
    if (readRevision === tokenRevision) {
      cachedAccessToken = null;
    }
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  tokenRevision++;
  cachedAccessToken = null;
  await queueTokenMutation(async (): Promise<void> => {
    await AsyncStorage.removeItem(STORAGE_KEY);
  });
}

/** Compare ownership and enqueue removal atomically before another login can write. */
export async function clearTokensIfCurrent(accessToken: string): Promise<void> {
  if (cachedAccessToken !== accessToken) {
    return;
  }
  /*
   * There is no await between the comparison, cache update and queued removal.
   * Any newer password, SSO or refresh write is ordered after this removal.
   */
  await clearTokens();
}
