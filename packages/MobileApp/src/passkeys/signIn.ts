import { exchangePasskeyCode, LoginResponse } from "../api/auth";
import { clearTokensIfCurrent, storeTokens } from "../storage/keychain";
import { getServerUrl } from "../storage/serverUrl";
import {
  openPasskeyAuthSession,
  PasskeyAuthSessionOutcome,
} from "./authSession";
import {
  createPasskeyRequest,
  parsePasskeyCallback,
  passkeyServerOrigin,
  PasskeyCallback,
  PasskeyRequest,
} from "./request";

export type PasskeyProgress = "preparing" | "browser" | "verifying";

export interface PasskeySignInOptions {
  signal: AbortSignal;
  onProgress: (progress: PasskeyProgress) => void;
}

/** A request remains valid only while its screen and selected server remain active. */
export async function signInWithPasskey(
  options: PasskeySignInOptions,
): Promise<LoginResponse | null> {
  const { signal, onProgress }: PasskeySignInOptions = options;
  if (signal.aborted) {
    return null;
  }
  onProgress("preparing");
  const request: PasskeyRequest = await createPasskeyRequest(
    await getServerUrl(),
  );

  const isCurrent: () => Promise<boolean> = async (): Promise<boolean> => {
    if (signal.aborted) {
      return false;
    }
    const serverOrigin: string = passkeyServerOrigin(await getServerUrl());
    if (serverOrigin !== request.serverOrigin) {
      throw new Error(
        "Your server changed during sign-in. Please try again on the selected server.",
      );
    }
    return !signal.aborted;
  };

  if (!(await isCurrent())) {
    return null;
  }
  onProgress("browser");
  const outcome: PasskeyAuthSessionOutcome = await openPasskeyAuthSession(
    request,
    signal,
  );
  if (outcome.status === "cancelled" || !(await isCurrent())) {
    return null;
  }
  const callback: PasskeyCallback = parsePasskeyCallback(outcome.url, request);
  if (callback.status === "cancelled") {
    return null;
  }
  onProgress("verifying");
  const response: LoginResponse = await exchangePasskeyCode({
    serverOrigin: request.serverOrigin,
    code: callback.code,
    codeVerifier: request.codeVerifier,
    state: request.state,
    signal,
  });

  if (!(await isCurrent())) {
    return null;
  }
  try {
    await storeTokens({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      refreshTokenExpiresAt: response.refreshTokenExpiresAt,
    });
  } catch (error: unknown) {
    await discardPasskeySession(response.accessToken);
    throw error;
  }

  try {
    if (await isCurrent()) {
      return response;
    }
  } catch (error: unknown) {
    await discardPasskeySession(response.accessToken);
    throw error;
  }
  await discardPasskeySession(response.accessToken);
  return null;
}

export async function discardPasskeySession(
  accessToken: string,
): Promise<void> {
  await clearTokensIfCurrent(accessToken);
}
