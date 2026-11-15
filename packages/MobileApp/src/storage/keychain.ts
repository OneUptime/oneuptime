import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "com.oneuptime.oncall.tokens";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

// In-memory cache for fast synchronous access
let cachedAccessToken: string | null = null;

// Counts every write of the tokens: a sign-in's, a renewal's and a sign-out's.
let tokenRevision: number = 0;

/*
 * Counts the sign-ins that stored tokens (storeTokens): every write but a
 * renewal's (storeRenewedTokens) and a sign-out's (clearTokens). A sign-out
 * closes renewals until the next sign-in (api/client.ts).
 */
let signInRevision: number = 0;

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

/*
 * The count of every write of the tokens so far. A renewal reads it before
 * it reads the tokens it renews, and stores what it brings back only while
 * it is unchanged (storeRenewedTokens).
 */
export function getTokenRevision(): number {
  return tokenRevision;
}

// The count of the sign-ins that stored tokens so far.
export function getSignInRevision(): number {
  return signInRevision;
}

// Writes the tokens; the count and the cache change before anything is awaited.
function writeTokens(tokens: StoredTokens): Promise<void> {
  tokenRevision++;
  cachedAccessToken = tokens.accessToken;
  return queueTokenMutation(async (): Promise<void> => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  });
}

// A sign-in's tokens: a password, a second factor, a passkey or single sign-on.
export async function storeTokens(tokens: StoredTokens): Promise<void> {
  const mutation: Promise<void> = writeTokens(tokens);
  signInRevision++;
  await mutation;
}

/*
 * A renewal's tokens, stored only when nothing has written the tokens since
 * `revision` (getTokenRevision, read before the renewal read the tokens it
 * renewed). Resolves with whether they were stored.
 *
 * The server rotates the refresh token at every renewal, so what a renewal
 * brings back belongs to the tokens it started from, and to nothing written
 * after them (issue #8382): a sign-out that cleared them while the renewal
 * was on its way, or a sign-in that replaced them. Stored over a sign-out, a
 * renewal's tokens would sign the next launch in again; over a sign-in, they
 * would replace the newer session with the older one. The comparison and the
 * write happen with nothing awaited in between, so no other write can come
 * between them.
 */
export async function storeRenewedTokens(
  tokens: StoredTokens,
  revision: number,
): Promise<boolean> {
  if (tokenRevision !== revision) {
    return false;
  }

  await writeTokens(tokens);

  return true;
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
