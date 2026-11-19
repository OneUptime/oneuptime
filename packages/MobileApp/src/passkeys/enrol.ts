import {
  LoginResponse,
  requestPasskeyEnrolment,
  verifySecurityKeyEnrolment,
} from "../api/auth";
import { getServerUrl } from "../storage/serverUrl";
import { openAppAuthSession, PasskeyAuthSessionOutcome } from "./authSession";
import {
  createPasskeyEnrolmentRequest,
  isPasskeyEnrolmentCallbackFor,
  PASSKEY_ENROLMENT_CALLBACK_URL,
  parsePasskeyEnrolmentCallback,
  PasskeyEnrolmentCallback,
  PasskeyEnrolmentRequest,
} from "./enrolment";

/*
 * The three steps of setting up a passkey when sign-in requires a second
 * step (#9817, passkeys/enrolment says why each is safe): the server's
 * hand-off, the phone's browser, and the verify that saves it and signs in.
 */

export type PasskeyEnrolmentProgress = "preparing" | "browser" | "verifying";

export type PasskeyEnrolmentOutcome =
  // Saved and signed in: the session is stored, the codes are in the response.
  | { status: "enrolled"; response: LoginResponse }
  // The person closed the browser, or pressed Cancel there.
  | { status: "cancelled" }
  // The browser cannot make a passkey: an authenticator app instead.
  | { status: "unsupported" };

export interface PasskeyEnrolmentOptions {
  signal: AbortSignal;
  onProgress: (progress: PasskeyEnrolmentProgress) => void;
}

export async function enrolPasskey(
  data: PasskeyEnrolmentOptions & { email: string; password: string },
): Promise<PasskeyEnrolmentOutcome> {
  const { signal, onProgress }: PasskeyEnrolmentOptions = data;

  if (signal.aborted) {
    return { status: "cancelled" };
  }

  onProgress("preparing");

  const handOffId: string = await requestPasskeyEnrolment({
    email: data.email,
    password: data.password,
  });

  const request: PasskeyEnrolmentRequest = await createPasskeyEnrolmentRequest(
    await getServerUrl(),
    handOffId,
  );

  if (signal.aborted) {
    return { status: "cancelled" };
  }

  onProgress("browser");

  const outcome: PasskeyAuthSessionOutcome = await openAppAuthSession({
    url: request.url,
    callbackUrl: PASSKEY_ENROLMENT_CALLBACK_URL,
    isOwnCallback: (url: string): boolean => {
      return isPasskeyEnrolmentCallbackFor(url, request);
    },
    signal: signal,
    failureMessage:
      "Could not open or complete the passkey setup. Please try again.",
  });

  if (outcome.status === "cancelled" || signal.aborted) {
    return { status: "cancelled" };
  }

  const callback: PasskeyEnrolmentCallback = parsePasskeyEnrolmentCallback(
    outcome.url,
    request,
  );

  if (callback.status !== "success") {
    return { status: callback.status };
  }

  onProgress("verifying");

  /*
   * From here on the passkey is being saved: once the server answers, the
   * account has it and the only copy of its recovery codes is in this
   * response, so a cancel no longer throws the answer away.
   */
  const response: LoginResponse = await verifySecurityKeyEnrolment({
    email: data.email,
    password: data.password,
    credential: callback.credential,
  });

  return { status: "enrolled", response };
}
