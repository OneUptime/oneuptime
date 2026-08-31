import axios, { AxiosResponse } from "axios";
import apiClient from "./client";
import { getServerUrl } from "../storage/serverUrl";
import {
  storeTokens,
  getTokens,
  clearTokens,
  type StoredTokens,
} from "../storage/keychain";

/**
 * One factor the account can be challenged on.
 *
 * The id is what /verify-totp-auth is quoted back -- the server refuses a
 * request that does not name which enrolment the code belongs to, because
 * without it "the newest row" is what would be checked.
 */
export interface TwoFactorMethod {
  _id: string;
  name: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: {
    _id: string;
    email: string;
    name: string;
    isMasterAdmin: boolean;
  };
  twoFactorRequired?: boolean;

  /*
   * The server is demanding two factor auth SETUP, not a code: an admin turned
   * the requirement on for an account that has nothing enrolled yet, so
   * /login answered with an otpauth:// URL instead of a session. Distinct from
   * `twoFactorRequired` because the remedy is different -- there is no code to
   * type until the user has added the secret to an authenticator app.
   */
  twoFactorEnrolmentRequired?: boolean;

  /* The authenticator apps this account can be challenged on. */
  totpAuthList?: Array<TwoFactorMethod>;

  /*
   * The security keys it can be challenged on. Listed so the app can SAY they
   * exist -- WebAuthn needs platform APIs this client does not have, so a key
   * is shown as unavailable here rather than silently omitted, which would
   * look to its owner like the key had been deleted.
   */
  webAuthnList?: Array<TwoFactorMethod>;

  /*
   * Unused recovery codes, or null when the server did not report one.
   *
   * NULL IS NOT ZERO. The server omits the count when it could not read it,
   * and zero is a claim the UI acts on -- it is what makes the app say "you
   * have no backup codes, ask an administrator". Making that claim on a
   * transient database fault would send a user holding ten printed codes to
   * find an administrator instead of typing one in.
   */
  backupCodeCount?: number | null;

  /* The pending enrolment to quote back with the first working code. */
  twoFactorAuthId?: string;
  twoFactorOtpUrl?: string;

  /*
   * Recovery codes the server minted behind an enrolment, in PLAINTEXT.
   *
   * This response is the only copy that will ever exist anywhere -- the server
   * stores keyed digests -- so a caller that drops it leaves the account
   * holding ten codes nobody has seen, which reads everywhere else as "you are
   * covered".
   */
  backupCodes?: Array<string>;

  /*
   * Sent only by the enrolment response, and only when the account already had
   * codes and so none were minted. Distinguishes "nothing to show you" from
   * "nothing to show you because you have nothing", which the app acts on
   * differently.
   */
  hasBackupCodes?: boolean;
}

export async function validateServerUrl(url: string): Promise<boolean> {
  try {
    const response: AxiosResponse = await axios.get(`${url}/api/status`, {
      timeout: 10000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/*
 * The serialized shape every identity route expects. The web client gets this
 * for free from `User.toJSON`; here it is written out, and it has to match --
 * a bare string lands as a string on a HashedString column and the server
 * refuses the login with "Email and password are required."
 */
function credentialPayload(
  email: string,
  password: string,
): Record<string, unknown> {
  return {
    email: {
      _type: "Email",
      value: email,
    },
    password: {
      _type: "HashedString",
      value: password,
    },
  };
}

/*
 * Every second step re-submits the email and password, because there is no
 * session yet: /login answered the password step with a list of factors and
 * nothing else. The server re-checks both before it looks at the factor.
 */
async function postIdentity(
  route: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await apiClient.post(
    `${serverUrl}/identity/${route}`,
    { data },
    {
      /*
       * The URL above is already absolute, so no base is needed. The empty
       * string is kept because the request interceptor fills in an ABSENT
       * baseURL from the stored server URL -- and "" is falsy, so it is
       * overwritten anyway. Harmless either way, and stated here because the
       * option reads like a guard that does something.
       */
      baseURL: "",
    },
  );

  return response.data as Record<string, unknown>;
}

type MiscData = Record<string, unknown>;

function miscDataOf(responseData: Record<string, unknown>): MiscData {
  return (responseData["_miscData"] as MiscData) || {};
}

function methodList(value: unknown): Array<TwoFactorMethod> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item: unknown): TwoFactorMethod => {
    const row: Record<string, unknown> = (item || {}) as Record<
      string,
      unknown
    >;

    return {
      _id: String(row["_id"] ?? ""),
      name: String(row["name"] ?? ""),
    };
  });
}

function codeList(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((code: unknown) => {
    return String(code);
  });
}

/*
 * Persist the session a completed second step returned, and shape it for the
 * caller.
 *
 * Shared by all three verify routes so there is exactly one place that decides
 * a login is finished. A route that stored tokens itself and forgot one of
 * them would sign the user in until the first refresh and then drop them.
 */
async function completeSession(
  responseData: Record<string, unknown>,
): Promise<LoginResponse> {
  const misc: MiscData = miscDataOf(responseData);

  const accessToken: string = String(misc["accessToken"] || "");
  const refreshToken: string = String(misc["refreshToken"] || "");
  const refreshTokenExpiresAt: string = String(
    misc["refreshTokenExpiresAt"] || "",
  );

  if (accessToken && refreshToken) {
    await storeTokens({
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
    });
  }

  const backupCodes: Array<string> = codeList(misc["backupCodes"]);

  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt,
    user: (responseData["data"] || {}) as LoginResponse["user"],
    ...(backupCodes.length > 0 ? { backupCodes } : {}),
    ...(misc["hasBackupCodes"] === true ? { hasBackupCodes: true } : {}),
  };
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const responseData: Record<string, unknown> = await postIdentity(
    "login",
    credentialPayload(email, password),
  );

  const misc: MiscData = miscDataOf(responseData);

  /*
   * Checked BEFORE the challenge lists below, and the order matters: a user
   * being forced to enrol has NO factors set up, so those lists are empty for
   * them. Without this branch the response would fall through to the success
   * path with an undefined access token, and the sign-in button would simply
   * do nothing.
   */
  if (misc["twoFactorEnrolmentRequired"]) {
    return {
      accessToken: "",
      refreshToken: "",
      refreshTokenExpiresAt: "",
      user: (responseData["data"] || {}) as LoginResponse["user"],
      twoFactorRequired: true,
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: String(misc["twoFactorAuthId"] || ""),
      twoFactorOtpUrl: String(misc["twoFactorOtpUrl"] || ""),
    };
  }

  const totpAuthList: Array<TwoFactorMethod> = methodList(misc["totpAuthList"]);
  const webAuthnList: Array<TwoFactorMethod> = methodList(misc["webAuthnList"]);

  if (totpAuthList.length > 0 || webAuthnList.length > 0) {
    const reportedCount: unknown = misc["backupCodeCount"];

    return {
      accessToken: "",
      refreshToken: "",
      refreshTokenExpiresAt: "",
      user: (responseData["data"] || {}) as LoginResponse["user"],
      twoFactorRequired: true,
      totpAuthList,
      webAuthnList,
      backupCodeCount: typeof reportedCount === "number" ? reportedCount : null,
    };
  }

  return await completeSession(responseData);
}

/**
 * Answer the challenge with a code from an authenticator app.
 *
 * `twoFactorAuthId` names WHICH enrolment the code belongs to and is not
 * optional: the server drops an undefined predicate rather than matching
 * nothing, so an omitted id stops meaning "this enrolment" and starts meaning
 * "whichever one this account happens to have".
 */
export async function verifyTotpAuth(data: {
  email: string;
  password: string;
  twoFactorAuthId: string;
  code: string;
}): Promise<LoginResponse> {
  const responseData: Record<string, unknown> = await postIdentity(
    "verify-totp-auth",
    {
      ...credentialPayload(data.email, data.password),
      code: data.code,
      twoFactorAuthId: data.twoFactorAuthId,
    },
  );

  return await completeSession(responseData);
}

/**
 * Sign in with one of the single-use recovery codes, for the day the
 * authenticator app is not available.
 *
 * The code is sent as typed. Hyphens, spacing and case are normalized on the
 * server, so nothing here has to guess at the formatting a password manager
 * pasted in.
 */
export async function verifyBackupCode(data: {
  email: string;
  password: string;
  backupCode: string;
}): Promise<LoginResponse> {
  const responseData: Record<string, unknown> = await postIdentity(
    "verify-backup-code",
    {
      ...credentialPayload(data.email, data.password),
      backupCode: data.backupCode,
    },
  );

  return await completeSession(responseData);
}

/**
 * Finish a two factor setup an administrator made mandatory, and sign in.
 *
 * The response carries the recovery codes the server minted behind the
 * enrolment -- see `backupCodes` on LoginResponse for why dropping them is the
 * worst thing a caller of this can do.
 */
export async function verifyTotpEnrolment(data: {
  email: string;
  password: string;
  twoFactorAuthId: string;
  code: string;
}): Promise<LoginResponse> {
  const responseData: Record<string, unknown> = await postIdentity(
    "verify-totp-enrolment",
    {
      ...credentialPayload(data.email, data.password),
      code: data.code,
      twoFactorAuthId: data.twoFactorAuthId,
    },
  );

  return await completeSession(responseData);
}

/**
 * Mint a fresh set of recovery codes for the user who is ALREADY signed in.
 *
 * An app-API route rather than an identity one, authenticated by the session
 * the login just stored -- which is why it can only be offered after the
 * second step has completed. Offering it during the challenge would mean
 * handing recovery codes to whoever is holding the password, which is exactly
 * what a second factor exists to stop.
 *
 * The returned array is the only copy. It is never persisted here.
 */
export async function generateBackupCodes(): Promise<Array<string>> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await apiClient.post(
    `${serverUrl}/api/user-two-factor-backup-code/generate`,
    {},
    { baseURL: "" },
  );

  /*
   * Guarded rather than indexed straight through. An empty body -- a 204, a
   * proxy that dropped it, an adapter that leaves `data` unset -- would
   * otherwise throw a TypeError on the property read, before `codeList` gets
   * to answer "no codes" the way this function's contract says it does. The
   * screen turns an empty array into an error the user can act on; a
   * TypeError it turns into "An unexpected error occurred".
   */
  const body: Record<string, unknown> =
    (response.data as Record<string, unknown> | null | undefined) || {};

  return codeList(body["codes"]);
}

/**
 * Ask the server to email a password reset link.
 *
 * ALWAYS RESOLVES for a well-formed address, whether or not an account exists.
 * That is the server's behaviour and it is deliberate -- an endpoint that
 * answered "no such user" differently would let anybody test whether an
 * address has an account on the instance -- so the screen has to say "if that
 * address has an account, we have sent it a link" rather than "sent" or "not
 * found".
 *
 * The reset itself is finished in a browser, from the link in the mail. This
 * app deliberately does not implement that half: the token in that URL is a
 * credential, and routing it through a deep link into a handset app is a
 * larger surface than the one screen it would save.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await postIdentity("forgot-password", {
    email: {
      _type: "Email",
      value: email,
    },
  });
}

/**
 * End the session: revoke it at the server, then sign out locally.
 *
 * The two halves are deliberately independent. The revoke is best effort - the
 * handset doing this has very often just lost the network, which is half of why
 * anybody reaches for Sign Out on a phone - while the local sign-out is the
 * part the user pressing the button is actually entitled to, so nothing the
 * server does or fails to do is allowed to stop it.
 *
 * getTokens is read off the static import above. It used to be pulled in with
 * `await import("../storage/keychain")` - the only dynamic import in the app,
 * of the module this file already imports - which throws under Jest
 * (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG) and landed straight in the
 * catch, so under test the revoke below was never even built and could not be
 * covered by anything.
 */
export async function logout(): Promise<void> {
  try {
    const serverUrl: string = await getServerUrl();
    const tokens: StoredTokens | null = await getTokens();

    if (tokens?.refreshToken) {
      await apiClient.post(
        `${serverUrl}/identity/logout`,
        { refreshToken: tokens.refreshToken },
        { baseURL: "" },
      );
    }
  } catch {
    /*
     * Best effort, as above: a server that could not be told is not a reason
     * to leave the user signed in on the handset.
     */
  }

  /*
   * In a try of its own rather than the `finally` of the one above, because
   * `finally` only guarantees that this RUNS - a rejection out of it still
   * rejects out of logout(). AuthProvider.logout awaits this call before it
   * drops the SSO tokens, the SSO denial set and the authenticated flag, so a
   * storage failure here used to skip all of that and leave the user on the
   * signed-in navigator with no feedback at all. clearTokens drops the
   * in-memory access token before it touches storage, so even the failing case
   * has stopped signing requests as the person who just left.
   */
  try {
    await clearTokens();
  } catch {
    /* There is nothing further to try; the caller finishes the sign-out. */
  }
}
