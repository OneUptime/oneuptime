import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * HOW A SESSION WAS SIGNED IN, AND FROM WHERE.
 *
 * Every way into OneUptime ends in a session (UserSessionService.
 * createSession): a password or a sign-in link, with the account's second
 * factor when it has one; a passkey; Sign in with Google or Microsoft;
 * sign-in from Vercel; or single sign-on - a project's SAML or OpenID
 * Connect provider, or the server's own. The session keeps how, and the
 * device and place it signed in from, in its additionalInfo, so the audit
 * log can say so when it signs in and again when it ends
 * (Types/AuditLog/AuditLogSessionEvent, issue #6762).
 *
 * The words are the audit log's: an entry carries them as they are, and
 * "Google", "Microsoft" and "Vercel" are what those sign-ins kept in
 * additionalInfo.signInMethod before the rest were named.
 */

export enum SignInMethod {
  Password = "Password",
  SignInLink = "Sign-in link",
  Passkey = "Passkey",
  Google = "Google",
  Microsoft = "Microsoft",
  Vercel = "Vercel",
  Saml = "SAML single sign-on",
  OpenIdConnect = "OpenID Connect single sign-on",
}

// The second step of a password or sign-in link sign-in, when the account has one.
export enum SecondFactor {
  AuthenticatorApp = "Authenticator app",
  SecurityKey = "Security key",
  BackupCode = "Backup code",
}

export interface SessionSignIn {
  method: SignInMethod;
  secondFactor?: SecondFactor | undefined;
  /*
   * The single sign-on provider that signed them in, by its name, and the
   * project whose provider it is - none for one of the server's own. Only
   * that project's audit log names a project's provider: the person may be
   * a member of other projects too, and their admins have no business
   * knowing which other project the person belongs to, or what its
   * provider is called.
   */
  ssoProviderName?: string | undefined;
  ssoProjectId?: ObjectID | undefined;
}

// Where it signed in from, in words OneUptime spells out (RequestOrigin).
export interface SessionSignInOrigin {
  // "Chrome 130 on macOS", "An app on an Apple device", "curl".
  device?: string | undefined;
  // "Berlin, Germany", when the operator names the CDN headers that say it.
  location?: string | undefined;
}

// The keys of UserSession.additionalInfo that keep it.
export const SIGN_IN_METHOD_KEY: string = "signInMethod";
export const SECOND_FACTOR_KEY: string = "secondFactor";
export const SSO_PROVIDER_NAME_KEY: string = "ssoProviderName";
// A project's SAML and OpenID Connect sign-ins have always kept their project here.
export const SSO_PROJECT_ID_KEY: string = "projectId";
export const SIGN_IN_DEVICE_KEY: string = "signInDevice";
export const SIGN_IN_LOCATION_KEY: string = "signInLocation";

/*
 * The most of a name or a description a session keeps: a provider's name
 * and a device's description are a few words, and a longer value is cut
 * rather than kept whole in every entry about the session.
 */
export const MAX_SESSION_SIGN_IN_TEXT_LENGTH: number = 100;

const SIGN_IN_METHODS: ReadonlyArray<string> = Object.values(SignInMethod);

const SECOND_FACTORS: ReadonlyArray<string> = Object.values(SecondFactor);

export const isSignInMethod: (value: unknown) => value is SignInMethod = (
  value: unknown,
): value is SignInMethod => {
  return typeof value === "string" && SIGN_IN_METHODS.includes(value);
};

export const isSecondFactor: (value: unknown) => value is SecondFactor = (
  value: unknown,
): value is SecondFactor => {
  return typeof value === "string" && SECOND_FACTORS.includes(value);
};

// Whether a method is single sign-on: the methods that name a provider.
export const isSingleSignOnMethod: (method: SignInMethod) => boolean = (
  method: SignInMethod,
): boolean => {
  return (
    method === SignInMethod.Saml || method === SignInMethod.OpenIdConnect
  );
};

/*
 * A text a session keeps, or undefined when there is none: trimmed, on one
 * line, and no longer than MAX_SESSION_SIGN_IN_TEXT_LENGTH.
 */
export const readSessionSignInText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const oneLine: string = value
    .slice(0, MAX_SESSION_SIGN_IN_TEXT_LENGTH * 4)
    .split(/[\r\n\t]+/)
    .join(" ")
    .trim();

  if (!oneLine) {
    return undefined;
  }

  return oneLine.length > MAX_SESSION_SIGN_IN_TEXT_LENGTH
    ? oneLine.slice(0, MAX_SESSION_SIGN_IN_TEXT_LENGTH).trim()
    : oneLine;
};

/*
 * What a session's additionalInfo keeps of how it signed in and from where.
 * A provider is kept only for single sign-on, and a project only for a
 * project's own provider.
 */
export const toSessionSignInInfo: (data: {
  signIn?: SessionSignIn | undefined;
  origin?: SessionSignInOrigin | undefined;
}) => JSONObject = (data: {
  signIn?: SessionSignIn | undefined;
  origin?: SessionSignInOrigin | undefined;
}): JSONObject => {
  const info: JSONObject = {};

  if (data.signIn && isSignInMethod(data.signIn.method)) {
    info[SIGN_IN_METHOD_KEY] = data.signIn.method;

    if (isSecondFactor(data.signIn.secondFactor)) {
      info[SECOND_FACTOR_KEY] = data.signIn.secondFactor;
    }

    if (isSingleSignOnMethod(data.signIn.method)) {
      const providerName: string | undefined = readSessionSignInText(
        data.signIn.ssoProviderName,
      );

      if (providerName) {
        info[SSO_PROVIDER_NAME_KEY] = providerName;
      }

      if (data.signIn.ssoProjectId) {
        info[SSO_PROJECT_ID_KEY] = data.signIn.ssoProjectId.toString();
      }
    }
  }

  const device: string | undefined = readSessionSignInText(data.origin?.device);

  if (device) {
    info[SIGN_IN_DEVICE_KEY] = device;
  }

  const location: string | undefined = readSessionSignInText(
    data.origin?.location,
  );

  if (location) {
    info[SIGN_IN_LOCATION_KEY] = location;
  }

  return info;
};

const asObject: (value: unknown) => JSONObject = (
  value: unknown,
): JSONObject => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
};

/*
 * How a session signed in, as its additionalInfo keeps it, or null when it
 * does not say: a session signed in before the sign-ins were named, other
 * than with Google, Microsoft or Vercel, which always said. Whatever it
 * holds that could not have been written reads as nothing.
 */
export const readSessionSignIn: (
  additionalInfo: unknown,
) => SessionSignIn | null = (additionalInfo: unknown): SessionSignIn | null => {
  const info: JSONObject = asObject(additionalInfo);
  const method: unknown = info[SIGN_IN_METHOD_KEY];

  if (!isSignInMethod(method)) {
    return null;
  }

  const signIn: SessionSignIn = { method: method };

  if (isSecondFactor(info[SECOND_FACTOR_KEY])) {
    signIn.secondFactor = info[SECOND_FACTOR_KEY] as SecondFactor;
  }

  if (isSingleSignOnMethod(method)) {
    const providerName: string | undefined = readSessionSignInText(
      info[SSO_PROVIDER_NAME_KEY],
    );

    if (providerName) {
      signIn.ssoProviderName = providerName;
    }

    const projectId: unknown = info[SSO_PROJECT_ID_KEY];

    if (typeof projectId === "string" && ObjectID.isValidUUID(projectId)) {
      signIn.ssoProjectId = new ObjectID(projectId);
    }
  }

  return signIn;
};

// Where a session signed in from, as its additionalInfo keeps it.
export const readSessionSignInOrigin: (
  additionalInfo: unknown,
) => SessionSignInOrigin = (additionalInfo: unknown): SessionSignInOrigin => {
  const info: JSONObject = asObject(additionalInfo);
  const origin: SessionSignInOrigin = {};

  const device: string | undefined = readSessionSignInText(
    info[SIGN_IN_DEVICE_KEY],
  );

  if (device) {
    origin.device = device;
  }

  const location: string | undefined = readSessionSignInText(
    info[SIGN_IN_LOCATION_KEY],
  );

  if (location) {
    origin.location = location;
  }

  return origin;
};
