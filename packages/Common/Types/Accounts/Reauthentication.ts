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

// GET REAUTHENTICATION_ROUTE's answer as JSON, and back.
export const reauthenticationStatusToJSON: (status: ReauthenticationStatus) => {
  isConfirmed: boolean;
  confirmedUntil: string | null;
  windowInMinutes: number;
  methods: ReauthenticationMethods;
} = (
  status: ReauthenticationStatus,
): {
  isConfirmed: boolean;
  confirmedUntil: string | null;
  windowInMinutes: number;
  methods: ReauthenticationMethods;
} => {
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
  };
};
