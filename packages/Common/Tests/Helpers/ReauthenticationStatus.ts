import {
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  reauthenticationStatusToJSON,
} from "../../Types/Accounts/Reauthentication";
import { JSONObject } from "../../Types/JSON";

/*
 * WHERE A SESSION STANDS ON CONFIRMING IT'S ITS PERSON'S (#10155), AS A
 * PAGE'S TEST ANSWERS IT.
 *
 * Adding a passkey or a security key opens the browser's prompt, which needs
 * the click that asked for it, so the Dashboard confirms the session first
 * (Common/UI/Utils/Reauthentication.ensureConfirmed): it reads
 * GET /api/user/reauthentication, and asks the person only when the
 * session has not confirmed. A page's test that stands in for the API
 * answers that read with this: a session that has confirmed, so the page
 * goes on as it always did, or one that has not, so it asks.
 */

// Whether a request the test stands in for reads where the session stands.
export const isReauthenticationStatusRequest: (url: string) => boolean = (
  url: string,
): boolean => {
  return url.endsWith(REAUTHENTICATION_ROUTE);
};

// The answer for an account with a password and no second step.
export const reauthenticationStatusAnswer: (
  isConfirmed: boolean,
) => JSONObject = (isConfirmed: boolean): JSONObject => {
  return reauthenticationStatusToJSON({
    isConfirmed: isConfirmed,
    confirmedUntil: isConfirmed
      ? new Date(Date.now() + REAUTHENTICATION_WINDOW_IN_MINUTES * 60 * 1000)
      : null,
    windowInMinutes: REAUTHENTICATION_WINDOW_IN_MINUTES,
    methods: {
      password: true,
      secondStep: null,
      passkey: false,
      signInAgain: false,
    },
    // An account with a password never signs in again to confirm.
    signInAgain: null,
  }) as unknown as JSONObject;
};
