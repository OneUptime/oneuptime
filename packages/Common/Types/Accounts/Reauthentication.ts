import { translationKey } from "../Translator";

/*
 * CONFIRM IT'S YOU BEFORE YOU CHANGE HOW YOU SIGN IN (#10155).
 *
 * A signed-in session alone used to be enough to take an account over:
 * User Profile set a new password without the current one, moved the
 * account to a new address once a link sent there was opened - from the
 * mailbox of whoever asked - and added a passkey, an authenticator app or
 * backup codes, or turned two-factor authentication off. Somebody on a
 * shared computer, or holding a stolen session cookie, could do all of it.
 *
 * Now every change to how an account signs in waits until the session has
 * confirmed, in the last REAUTHENTICATION_WINDOW_IN_MINUTES, that the person
 * holding it is the account's owner: re-authentication, as GitHub's sudo
 * mode asks for it. The server holds every path to it
 * (Server/Utils/Reauthentication): the Dashboard, the API, the mobile app.
 *
 * WHAT IT GUARDS, for the account's own changes (a master admin's changes
 * to other accounts are the Admin Dashboard's, outside this rule):
 *
 *   - a new password, or a first one;
 *   - a new email address (asking for it, and Send Link Again);
 *   - adding or removing a passkey, a security key or an authenticator app;
 *   - a new set of backup codes in place of codes still unused;
 *   - turning two-factor authentication off.
 *
 * WHAT CONFIRMS IT - the way the account signs in, done again in place:
 *
 *   - an account with a password: the password, and - while two-factor
 *     authentication is on and set up - its second step as well: a code
 *     from an authenticator app, a security key (or passkey), or a backup
 *     code. Or a passkey alone, which signs in on its own;
 *   - an account with no password but a passkey: the passkey;
 *   - an account with neither, which signs in through single sign-on,
 *     Google, Microsoft or a sign-in link only: a sign-in of this session
 *     in the last REAUTHENTICATION_WINDOW_IN_MINUTES. Sign In Again signs
 *     out and back in.
 *
 * Confirming holds for this session only, for the window: a session
 * somebody else holds confirms nothing for the owner's, and the other way
 * round. REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT wrong attempts in one
 * session end that session - never the account's sign-in, so nobody can
 * lock its owner out by getting the password wrong.
 *
 * React-free and server-safe: the server answers with these words, and the
 * Dashboard's prompt reads them in the reader's language (they are keys of
 * its locales).
 */

// How long a confirmation, or a sign-in standing in for one, holds.
export const REAUTHENTICATION_WINDOW_IN_MINUTES: number = 10;

// Wrong attempts in one session before that session is signed out.
export const REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT: number = 5;

/*
 * The code of the refusal a change to how you sign in gets before the
 * session has confirmed it's its owner's, beside the refusal's message in
 * the answer's body (REFUSAL_CODE_FIELD, Types/Exception/NameTakenException).
 * A client asks for the confirmation and sends the change again; the
 * Dashboard does both on its own (Common/UI/Utils/Reauthentication).
 */
export const REAUTHENTICATION_REQUIRED_REFUSAL_CODE: string =
  "reauthentication_required";

// Under the API's address (APP_API_URL): GET the status, POST a confirmation.
export const REAUTHENTICATION_ROUTE: string = "/user/reauthentication";

// POST: the options for a security key's or a passkey's prompt.
export const REAUTHENTICATION_WEBAUTHN_OPTIONS_ROUTE: string =
  "/user/reauthentication/webauthn-options";

/*
 * WHAT A CONFIRMATION IS ASKED FOR, beside the refusal's code
 * (REAUTHENTICATION_PURPOSE_FIELD), so the refusal and the prompt say what
 * the person is about to do:
 *
 *   - OwnSignIn: a change to how they sign in (#10155);
 *   - DeleteAccount: deleting their own account (#10220), the one change
 *     nobody recovers from;
 *   - AdminChange: a master admin's change to how someone else signs in,
 *     or to how anyone signs in to the server (#10216): another person's
 *     password, email address, two-factor authentication or sign-in
 *     settings, who is a master admin, the server's own single sign-on,
 *     the server's email settings, and the master API key.
 */
export enum ReauthenticationPurpose {
  OwnSignIn = "OwnSignIn",
  DeleteAccount = "DeleteAccount",
  AdminChange = "AdminChange",
}

// The refusal's field that names its purpose.
export const REAUTHENTICATION_PURPOSE_FIELD: string = "reauthenticationPurpose";

// A purpose as a refusal's body names it, or OwnSignIn for any other value.
export const readReauthenticationPurpose: (
  value: unknown,
) => ReauthenticationPurpose = (value: unknown): ReauthenticationPurpose => {
  return Object.values(ReauthenticationPurpose).includes(
    value as ReauthenticationPurpose,
  )
    ? (value as ReauthenticationPurpose)
    : ReauthenticationPurpose.OwnSignIn;
};

/*
 * SIGN IN AGAIN, WHICH HAS THE IDENTITY PROVIDER ASK AGAIN (#10217).
 *
 * An account with neither a password nor a passkey confirms by signing in
 * again. Its identity provider usually remembers its own session and signs
 * a browser that still has one straight back in, asking nothing - so a
 * sign-in counts as a confirmation only when it proved, just now, that its
 * person was asked:
 *
 *   - a sign-in started by Sign In Again (this query parameter on the
 *     sign-in's start) asks the provider to authenticate the person again:
 *     SAML's ForceAuthn, OpenID Connect's prompt=login and max_age=0 (Google
 *     takes neither, and is asked for auth_time instead; Microsoft Entra
 *     ID is sent prompt=login alone, #10529);
 *   - and counts only when the provider says it authenticated them at or
 *     after the moment Sign In Again sent them there, give or take
 *     SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS: the assertion's AuthnInstant, or
 *     the ID token's auth_time, checked by OneUptime, never by trusting that
 *     the provider honoured the request;
 *   - a sign-in link always counts: opening it, minutes after it was sent,
 *     is the proof.
 *
 * A provider that cannot prove it - it reused its session, or did not say
 * when the person signed in - still signs them in, and the confirmation is
 * refused with why (SignInAgainRefusal) and what their administrator can
 * change. Nothing is accepted silently.
 */
export const REAUTHENTICATE_QUERY_PARAM: string = "reauthenticate";

// How far the provider's clock and this server's may disagree, either way.
export const SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS: number = 60;

// Why a Sign In Again did not confirm it's you.
export enum SignInAgainRefusal {
  // The provider signed the person in with a session it already had.
  ReusedSession = "ReusedSession",
  // The provider did not say when the person signed in.
  NoSignInTime = "NoSignInTime",
}

// Who a Sign In Again goes through, for what the prompt says to do.
export enum SignInAgainProvider {
  // A project's or the server's own SAML or OpenID Connect provider.
  SingleSignOn = "SingleSignOn",
  Google = "Google",
  Microsoft = "Microsoft",
  /*
   * Sign in with Vercel (#10331), which can never confirm it's someone. It
   * is the Vercel Marketplace integration's single sign-on, which Vercel
   * starts ("Vercel initiated SSO", or the "Provider initiated SSO" URL
   * https://vercel.com/sso/integrations/{URLSlug}/{installationId}): it
   * takes no prompt=login and no max_age (Vercel documents only its
   * context parameters, and its OpenID configuration at
   * https://marketplace.vercel.com/.well-known/openid-configuration lists
   * no prompt values), and the ID token it answers with says nothing of
   * when the person signed in - its claims are iss, sub, aud, type,
   * account_id, installation_id and the user's own, with
   * "additionalProperties": false and no auth_time (the user OIDC token's
   * claims schema, Marketplace Partner API Reference); its iat is when the
   * token was issued. So nothing can tell a person who signed in to Vercel
   * just now from a Vercel session remembered for weeks. Vercel's separate
   * "Sign in with Vercel" apps take prompt=login, but their ID token has no
   * auth_time either, so OneUptime could not check that Vercel asked. The
   * prompt says so, and offers what does confirm: an emailed sign-in link,
   * or a password.
   */
  Vercel = "Vercel",
  // A sign-in link, or a sign-in OneUptime cannot send back by itself.
  SignInPage = "SignInPage",
}

/*
 * What a sign-in Sign In Again started proved, from when its provider says
 * it authenticated the person (`authenticatedAt`: SAML's AuthnInstant,
 * OpenID Connect's auth_time; null when it said nothing) and when Sign In
 * Again sent them there (`requestedAt`):
 *
 *   - authenticated at or after it was asked, give or take the skew, and
 *     inside the window: confirmed from then (never from a time ahead of
 *     now), for the window;
 *   - authenticated before: the provider reused a session it had;
 *   - no time, or one that has not happened yet: it said nothing usable.
 *
 * Pure: every sign-in route holds what its provider said to it.
 */
export const judgeSignInAgain: (data: {
  requestedAt: Date;
  authenticatedAt: Date | null;
  now: Date;
}) => { reauthenticatedAt: Date } | { refusal: SignInAgainRefusal } = (data: {
  requestedAt: Date;
  authenticatedAt: Date | null;
  now: Date;
}): { reauthenticatedAt: Date } | { refusal: SignInAgainRefusal } => {
  const skewInMs: number = SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS * 1000;
  const windowInMs: number = REAUTHENTICATION_WINDOW_IN_MINUTES * 60 * 1000;
  const now: number = data.now.getTime();
  const authenticatedAt: number | null =
    data.authenticatedAt && !isNaN(data.authenticatedAt.getTime())
      ? data.authenticatedAt.getTime()
      : null;

  if (authenticatedAt === null || authenticatedAt > now + skewInMs) {
    return { refusal: SignInAgainRefusal.NoSignInTime };
  }

  if (
    authenticatedAt < data.requestedAt.getTime() - skewInMs ||
    authenticatedAt + windowInMs <= now
  ) {
    return { refusal: SignInAgainRefusal.ReusedSession };
  }

  return { reauthenticatedAt: new Date(Math.min(authenticatedAt, now)) };
};

// Where Sign In Again takes a session, and why the last one did not confirm.
export interface ReauthenticationSignInAgain {
  /*
   * The start of the session's own sign-in, under Identity's address
   * ("/sso/<project>/<provider>", "/google/sign-in"), which the prompt
   * opens with REAUTHENTICATE_QUERY_PARAM; null for the sign-in page.
   */
  route: string | null;
  provider: SignInAgainProvider;
  // The provider's name as the session's sign-in kept it, or null.
  providerName: string | null;
  // Why this session's own Sign In Again did not confirm it's you, or null.
  refusal: SignInAgainRefusal | null;
  // Whether an emailed sign-in link can sign this person in instead.
  canUseSignInLink: boolean;
}

// Which kind of key a WebAuthn prompt is for.
export enum ReauthenticationWebAuthnKind {
  // A security key or passkey as the second step, after the password.
  SecurityKey = "SecurityKey",
  // A passkey on its own, with the device's own check of its person.
  Passkey = "Passkey",
}

// The fields of a confirmation's body.
export const REAUTHENTICATION_FIELDS: {
  password: "password";
  code: "code";
  backupCode: "backupCode";
  securityKeyCredential: "securityKeyCredential";
  passkeyCredential: "passkeyCredential";
  webAuthnKind: "kind";
} = {
  password: "password",
  code: "code",
  backupCode: "backupCode",
  securityKeyCredential: "securityKeyCredential",
  passkeyCredential: "passkeyCredential",
  webAuthnKind: "kind",
};

// The second step an account with two-factor authentication confirms with.
export interface ReauthenticationSecondStep {
  authenticatorApp: boolean;
  securityKey: boolean;
  // Unused backup codes are left.
  backupCode: boolean;
}

// What an account can confirm it's its owner's with.
export interface ReauthenticationMethods {
  password: boolean;
  // While two-factor authentication is on and set up, beside the password.
  secondStep: ReauthenticationSecondStep | null;
  passkey: boolean;
  // Neither a password nor a passkey: a new sign-in is the confirmation.
  signInAgain: boolean;
}

// GET REAUTHENTICATION_ROUTE's answer.
export interface ReauthenticationStatus {
  isConfirmed: boolean;
  // When the confirmation stops holding, or null while there is none.
  confirmedUntil: Date | null;
  windowInMinutes: number;
  methods: ReauthenticationMethods;
  // For an account that confirms by signing in again (methods.signInAgain).
  signInAgain: ReauthenticationSignInAgain | null;
}

/*
 * What a confirmation is answered with when it does not confirm, and the
 * refusal of a change that needs one. Each says what happened and what to
 * do next.
 */
export const REAUTHENTICATION_MESSAGES: {
  required: string;
  notFromASession: string;
  passwordRequired: string;
  secondStepRequired: string;
  wrongPassword: string;
  wrongCode: string;
  wrongBackupCode: string;
  securityKeyNotAccepted: string;
  passkeyNotAccepted: string;
  noPassword: string;
  noPasskey: string;
  noSecurityKey: string;
  signInAgain: string;
  signedOut: string;
  tooManyAttempts: string;
  unavailable: string;
} = {
  required: translationKey(
    "Confirm it's you before you change how you sign in, then try again.",
  ),
  notFromASession: translationKey(
    "How you sign in can only be changed from a session you signed in to, after you confirm it's you.",
  ),
  passwordRequired: translationKey("Enter your password to confirm it's you."),
  secondStepRequired: translationKey(
    "Two-factor authentication is on, so also enter a code from your authenticator app, or use your security key or a backup code.",
  ),
  wrongPassword: translationKey(
    "That password is not right. Check it and try again.",
  ),
  wrongCode: translationKey(
    "That code is not right. Enter the 6-digit code your authenticator app shows now.",
  ),
  wrongBackupCode: translationKey(
    "That backup code is not right, or it was already used. Each backup code works once.",
  ),
  securityKeyNotAccepted: translationKey(
    "Your security key was not accepted. Try it again, or confirm it's you another way.",
  ),
  passkeyNotAccepted: translationKey(
    "Your passkey was not accepted. Try it again, or confirm it's you another way.",
  ),
  noPassword: translationKey(
    "Your account has no password, so confirm it's you with your passkey.",
  ),
  noPasskey: translationKey(
    "Your account has no passkey, so confirm it's you with your password.",
  ),
  noSecurityKey: translationKey(
    "Your account has no security key, so enter a code from your authenticator app or a backup code.",
  ),
  signInAgain: translationKey(
    "You sign in without a password, so sign in again to confirm it's you.",
  ),
  signedOut: translationKey(
    "You were signed out after too many wrong attempts to confirm it's you. Sign in again to continue.",
  ),
  tooManyAttempts: translationKey(
    "Too many attempts to confirm it's you. Try again in a few minutes.",
  ),
  unavailable: translationKey(
    "We could not confirm it's you right now. Try again in a minute.",
  ),
};

/*
 * The refusal of a change that waits for a confirmation, in the words of
 * what it is for: REAUTHENTICATION_MESSAGES.required is a change to how
 * you sign in.
 */
export const REAUTHENTICATION_REQUIRED_MESSAGES: Record<
  ReauthenticationPurpose,
  string
> = {
  [ReauthenticationPurpose.OwnSignIn]: REAUTHENTICATION_MESSAGES.required,
  [ReauthenticationPurpose.DeleteAccount]: translationKey(
    "Confirm it's you before you delete your account, then try again.",
  ),
  [ReauthenticationPurpose.AdminChange]: translationKey(
    "Confirm it's you before you make this change, then try again.",
  ),
};

/*
 * The refusal of such a change from a request with no session - an API
 * key, the master API key, an MCP client, a workflow - which cannot
 * confirm, since nobody signed in to it.
 */
export const REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES: Record<
  ReauthenticationPurpose,
  string
> = {
  [ReauthenticationPurpose.OwnSignIn]:
    REAUTHENTICATION_MESSAGES.notFromASession,
  [ReauthenticationPurpose.DeleteAccount]: translationKey(
    "An account can only be deleted from a session its person signed in to, after they confirm it's them.",
  ),
  [ReauthenticationPurpose.AdminChange]: translationKey(
    "This change can only be made from a session you signed in to, after you confirm it's you. An API key cannot make it.",
  ),
};

// GET REAUTHENTICATION_ROUTE's answer as JSON, and back.
export interface ReauthenticationStatusJSON {
  isConfirmed: boolean;
  confirmedUntil: string | null;
  windowInMinutes: number;
  methods: ReauthenticationMethods;
  signInAgain: ReauthenticationSignInAgain | null;
}

export const reauthenticationStatusToJSON: (
  status: ReauthenticationStatus,
) => ReauthenticationStatusJSON = (
  status: ReauthenticationStatus,
): ReauthenticationStatusJSON => {
  return {
    isConfirmed: status.isConfirmed,
    confirmedUntil: status.confirmedUntil
      ? status.confirmedUntil.toISOString()
      : null,
    windowInMinutes: status.windowInMinutes,
    methods: {
      password: status.methods.password,
      secondStep: status.methods.secondStep
        ? {
            authenticatorApp: status.methods.secondStep.authenticatorApp,
            securityKey: status.methods.secondStep.securityKey,
            backupCode: status.methods.secondStep.backupCode,
          }
        : null,
      passkey: status.methods.passkey,
      signInAgain: status.methods.signInAgain,
    },
    signInAgain: status.signInAgain
      ? {
          route: status.signInAgain.route,
          provider: status.signInAgain.provider,
          providerName: status.signInAgain.providerName,
          refusal: status.signInAgain.refusal,
          canUseSignInLink: status.signInAgain.canUseSignInLink,
        }
      : null,
  };
};

// A route under Identity's address: a path of plain segments, nothing else.
const SIGN_IN_AGAIN_ROUTE: RegExp = /^(?:\/[A-Za-z0-9_-]+){1,4}$/;

// What a status's signInAgain says, or null when it says nothing readable.
const readSignInAgain: (
  value: unknown,
) => ReauthenticationSignInAgain | null = (
  value: unknown,
): ReauthenticationSignInAgain | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: Record<string, unknown> = value as Record<string, unknown>;
  const provider: unknown = json["provider"];
  const refusal: unknown = json["refusal"];
  const route: unknown = json["route"];
  const providerName: unknown = json["providerName"];

  return {
    // Only a path under Identity's address: never a page somewhere else.
    route:
      typeof route === "string" && SIGN_IN_AGAIN_ROUTE.test(route)
        ? route
        : null,
    provider: Object.values(SignInAgainProvider).includes(
      provider as SignInAgainProvider,
    )
      ? (provider as SignInAgainProvider)
      : SignInAgainProvider.SignInPage,
    providerName:
      typeof providerName === "string" && providerName.trim()
        ? providerName.trim()
        : null,
    refusal: Object.values(SignInAgainRefusal).includes(
      refusal as SignInAgainRefusal,
    )
      ? (refusal as SignInAgainRefusal)
      : null,
    canUseSignInLink: json["canUseSignInLink"] === true,
  };
};

// A status as the server sent it, or null when it is not one.
export const readReauthenticationStatus: (
  value: unknown,
) => ReauthenticationStatus | null = (
  value: unknown,
): ReauthenticationStatus | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: Record<string, unknown> = value as Record<string, unknown>;
  const methods: unknown = json["methods"];

  if (
    typeof json["isConfirmed"] !== "boolean" ||
    !methods ||
    typeof methods !== "object" ||
    Array.isArray(methods)
  ) {
    return null;
  }

  const methodsJson: Record<string, unknown> = methods as Record<
    string,
    unknown
  >;
  const secondStep: unknown = methodsJson["secondStep"];
  const secondStepJson: Record<string, unknown> | null =
    secondStep && typeof secondStep === "object" && !Array.isArray(secondStep)
      ? (secondStep as Record<string, unknown>)
      : null;

  const confirmedUntil: Date | null =
    typeof json["confirmedUntil"] === "string"
      ? new Date(json["confirmedUntil"])
      : null;

  return {
    isConfirmed: json["isConfirmed"] === true,
    confirmedUntil:
      confirmedUntil && !isNaN(confirmedUntil.getTime())
        ? confirmedUntil
        : null,
    windowInMinutes:
      typeof json["windowInMinutes"] === "number"
        ? json["windowInMinutes"]
        : REAUTHENTICATION_WINDOW_IN_MINUTES,
    methods: {
      password: methodsJson["password"] === true,
      secondStep: secondStepJson
        ? {
            authenticatorApp: secondStepJson["authenticatorApp"] === true,
            securityKey: secondStepJson["securityKey"] === true,
            backupCode: secondStepJson["backupCode"] === true,
          }
        : null,
      passkey: methodsJson["passkey"] === true,
      signInAgain: methodsJson["signInAgain"] === true,
    },
    signInAgain:
      methodsJson["signInAgain"] === true
        ? readSignInAgain(json["signInAgain"])
        : null,
  };
};
