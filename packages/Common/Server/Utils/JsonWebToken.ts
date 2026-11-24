import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import JsonWebTokenPurpose from "../../Types/JsonWebTokenPurpose";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import Timezone from "../../Types/Timezone";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../Models/DatabaseModels/User";
import jwt from "jsonwebtoken";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";
import TokenSigningKey from "./TokenSigningKey";
import JsonWebTokenKeys from "./JsonWebTokenKeys";

// The claim a token says what it is for in (JsonWebTokenPurpose).
export const PURPOSE_CLAIM: string = "purpose";

/*
 * A session's access token's claims of when the session signed in and when
 * its person was last active, in milliseconds (JSONWebTokenData.signedInAtMs
 * and lastActiveAtMs).
 */
export const SIGNED_IN_AT_CLAIM: string = "signedInAt";

export const LAST_ACTIVE_AT_CLAIM: string = "lastActiveAt";

/*
 * How long a session's access token lives when it is signed without a
 * usable lifetime: fifteen minutes, as every access token does at most.
 */
export const DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 15 * 60;

/*
 * How long a session's access token lived when an earlier release signed it,
 * without a purpose: fifteen minutes, from every sign-in and every refresh.
 */
export const EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 15 * 60;

export const UNSAID_PURPOSE_MESSAGE: string =
  "A token that names a session or an SSO provider is signed with what it is for (JsonWebTokenPurpose).";

const INVALID_TOKEN_MESSAGE: string = "AccessToken is invalid or expired";

export interface DecodeOptions {
  /*
   * Takes a token that has expired, its signature and what it is for
   * checked all the same. For ENDING the session a session's access token
   * names, at a sign-out, and nothing else (POST /identity/logout, issue
   * #8592): the server rotates the refresh token at every renewal, so a
   * client whose renewal's answer was lost signs out with a refresh token
   * that matches no session any more, and an access token of before - a
   * sign-out is often the first request after a while - which still names
   * the session. An expired token can end its own session there and get
   * nothing else anywhere: what its holder asked for, and no more than a
   * refresh token of the same session could do.
   */
  acceptExpired?: boolean | undefined;
}

/*
 * The session a browser's sign-out cookie names
 * (JsonWebTokenPurpose.UserSessionSignOut), read by
 * JSONWebToken.decodeSessionToSignOut: whose session, and which.
 */
export interface SessionToSignOut {
  userId: ObjectID;
  sessionId: ObjectID;
}

/*
 * The session a browser's sign-out cookie for one status page names
 * (JsonWebTokenPurpose.StatusPageSessionSignOut), read by
 * JSONWebToken.decodeStatusPageSessionToSignOut: which status page, whose
 * session there - a StatusPagePrivateUser's - and which.
 */
export interface StatusPageSessionToSignOut {
  statusPageId: ObjectID;
  userId: ObjectID;
  sessionId: ObjectID;
}

/*
 * What a dashboard private user's session token names
 * (JsonWebTokenPurpose.DashboardPrivateUserSession, and its sign-out
 * cookie's DashboardPrivateUserSessionSignOut): which dashboard, whose
 * session there - a DashboardPrivateUser's - and which. Nothing else: no
 * address and no name, so a token copied out of a browser says nothing
 * about the person (#10250).
 */
export interface DashboardPrivateUserSessionClaims {
  dashboardId: ObjectID;
  userId: ObjectID;
  sessionId: ObjectID;
}

/*
 * What a form private user's session token names
 * (JsonWebTokenPurpose.FormPrivateUserSession, and its sign-out
 * cookie's FormPrivateUserSessionSignOut): which form, whose
 * session there - a FormPrivateUser's - and which. Nothing else: no
 * address and no name, so a token copied out of a browser says nothing
 * about the person (#10249).
 */
export interface FormPrivateUserSessionClaims {
  formId: ObjectID;
  userId: ObjectID;
  sessionId: ObjectID;
}

class JSONWebToken {
  /*
   * A dashboard session's access token, the only token the API takes as a
   * session (JsonWebTokenPurpose.UserSession). It names the UserSession it
   * belongs to, whose refresh token renews it.
   */
  @CaptureSpan()
  public static signUserLoginToken(data: {
    tokenData: {
      userId: ObjectID;
      email: Email;
      name: Name;
      timezone: Timezone | null; // User's timezone
      isMasterAdmin: boolean;
      // If this is OneUptime username and password login. This is true, if this is SSO login. Then, this is false.
      isGlobalLogin: boolean;
      sessionId: ObjectID;
      /*
       * When the session signed in, and when its person was last active, as
       * the session knows them now (UserSessionService's SessionMetadata):
       * the server's session lengths are asked against them on every
       * request.
       */
      signedInAt?: Date | undefined;
      lastActiveAt?: Date | undefined;
    };
    /*
     * The session's own access token lifetime (SessionMetadata.
     * accessTokenExpiresInSeconds): fifteen minutes, or less when the
     * session ends sooner. A lifetime that is not a number at all is
     * fifteen minutes: a session's token never goes without an expiry.
     */
    expiresInSeconds: number;
  }): string {
    const { signedInAt, lastActiveAt, ...tokenData } = data.tokenData;

    const claims: JSONObject = {
      ...tokenData,
    } as unknown as JSONObject;

    if (JSONWebToken.isUsableDate(signedInAt)) {
      claims[SIGNED_IN_AT_CLAIM] = signedInAt.getTime();
    }

    if (JSONWebToken.isUsableDate(lastActiveAt)) {
      claims[LAST_ACTIVE_AT_CLAIM] = lastActiveAt.getTime();
    }

    return JSONWebToken.sign({
      data: claims,
      expiresInSeconds:
        typeof data.expiresInSeconds === "number" &&
        Number.isFinite(data.expiresInSeconds)
          ? Math.floor(data.expiresInSeconds)
          : DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
      purpose: JsonWebTokenPurpose.UserSession,
    });
  }

  /*
   * Which session a browser holds, for its sign-out and nothing else
   * (JsonWebTokenPurpose.UserSessionSignOut): CookieUtil.setUserCookie
   * keeps it in a cookie sent only to POST /identity/logout, beside the
   * session's refresh token and for as long, so that a sign-out can name
   * its session when neither its refresh token nor its access token can
   * (issue #8638).
   *
   * It says whose session and which, and nothing else: no address, no
   * name, nothing of a session's access token. Every reader of a person's
   * token makes an address of the token's own, so none of them - of this
   * release or of one before tokens said what they were for - takes it for
   * a session, however long it lives. Read only by decodeSessionToSignOut.
   */
  @CaptureSpan()
  public static signSessionSignOutToken(data: {
    userId: ObjectID;
    sessionId: ObjectID;
    // As long as the session's refresh token: a whole number of seconds.
    expiresInSeconds: number;
  }): string {
    return JSONWebToken.sign({
      data: {
        userId: data.userId,
        sessionId: data.sessionId,
      },
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.ceil(data.expiresInSeconds)
          : 0,
      purpose: JsonWebTokenPurpose.UserSessionSignOut,
    });
  }

  /*
   * Which session a browser holds on one status page, for its sign-out on
   * that page and nothing else (JsonWebTokenPurpose.StatusPageSessionSignOut):
   * CookieUtil.setStatusPagePrivateUserCookie keeps it in a cookie sent
   * only to that page's sign-out, beside the session's refresh token and
   * for as long (issue #8671).
   *
   * It says which page, whose session and which, and nothing else: no
   * address, so no reader of a person's token, of this release or of one
   * before tokens said what they were for, takes it for a session. Read
   * only by decodeStatusPageSessionToSignOut.
   */
  @CaptureSpan()
  public static signStatusPageSessionSignOutToken(data: {
    statusPageId: ObjectID;
    // The StatusPagePrivateUser whose session it is.
    userId: ObjectID;
    sessionId: ObjectID;
    // As long as the session's refresh token: a whole number of seconds.
    expiresInSeconds: number;
  }): string {
    return JSONWebToken.sign({
      data: {
        userId: data.userId,
        statusPageId: data.statusPageId.toString(),
        sessionId: data.sessionId,
      },
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.ceil(data.expiresInSeconds)
          : 0,
      purpose: JsonWebTokenPurpose.StatusPageSessionSignOut,
    });
  }

  /*
   * A dashboard private user's access token, for that one dashboard's public
   * link (JsonWebTokenPurpose.DashboardPrivateUserSession): signed only by
   * CookieUtil.setDashboardPrivateUserCookie, which keeps it in the
   * dashboard's own HttpOnly cookie. Read only by
   * decodeDashboardPrivateUserSession, and taken there only together with
   * the live session it names (DashboardPrivateUserSessionService).
   */
  @CaptureSpan()
  public static signDashboardPrivateUserSessionToken(
    data: DashboardPrivateUserSessionClaims & {
      // Fifteen minutes at most; a whole number of seconds.
      expiresInSeconds: number;
    },
  ): string {
    return JSONWebToken.sign({
      data: JSONWebToken.getDashboardPrivateUserSessionClaims(data),
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.min(
              Math.floor(data.expiresInSeconds),
              DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
            )
          : DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
      purpose: JsonWebTokenPurpose.DashboardPrivateUserSession,
    });
  }

  /*
   * Which session a browser holds on one dashboard's public link, for its
   * sign-out there and nothing else
   * (JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut):
   * CookieUtil.setDashboardPrivateUserCookie keeps it in a cookie sent only
   * to that dashboard's sign-out, beside the session's refresh token and for
   * as long. Read only by decodeDashboardPrivateUserSessionToSignOut.
   */
  @CaptureSpan()
  public static signDashboardPrivateUserSessionSignOutToken(
    data: DashboardPrivateUserSessionClaims & {
      // As long as the session's refresh token: a whole number of seconds.
      expiresInSeconds: number;
    },
  ): string {
    return JSONWebToken.sign({
      data: JSONWebToken.getDashboardPrivateUserSessionClaims(data),
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.ceil(data.expiresInSeconds)
          : 0,
      purpose: JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut,
    });
  }

  // The three ids, as text, and nothing else of what the caller handed in.
  private static getDashboardPrivateUserSessionClaims(
    data: DashboardPrivateUserSessionClaims,
  ): JSONObject {
    return {
      dashboardId: data.dashboardId.toString(),
      userId: data.userId.toString(),
      sessionId: data.sessionId.toString(),
    };
  }

  /*
   * A form private user's access token, for that one form's public
   * link (JsonWebTokenPurpose.FormPrivateUserSession): signed only by
   * CookieUtil.setFormPrivateUserCookie, which keeps it in the
   * form's own HttpOnly cookie. Read only by
   * decodeFormPrivateUserSession, and taken there only together with
   * the live session it names (FormPrivateUserSessionService).
   */
  @CaptureSpan()
  public static signFormPrivateUserSessionToken(
    data: FormPrivateUserSessionClaims & {
      // Fifteen minutes at most; a whole number of seconds.
      expiresInSeconds: number;
    },
  ): string {
    return JSONWebToken.sign({
      data: JSONWebToken.getFormPrivateUserSessionClaims(data),
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.min(
              Math.floor(data.expiresInSeconds),
              DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
            )
          : DEFAULT_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
      purpose: JsonWebTokenPurpose.FormPrivateUserSession,
    });
  }

  /*
   * Which session a browser holds on one form's public link, for its
   * sign-out there and nothing else
   * (JsonWebTokenPurpose.FormPrivateUserSessionSignOut):
   * CookieUtil.setFormPrivateUserCookie keeps it in a cookie sent only
   * to that form's sign-out, beside the session's refresh token and for
   * as long. Read only by decodeFormPrivateUserSessionToSignOut.
   */
  @CaptureSpan()
  public static signFormPrivateUserSessionSignOutToken(
    data: FormPrivateUserSessionClaims & {
      // As long as the session's refresh token: a whole number of seconds.
      expiresInSeconds: number;
    },
  ): string {
    return JSONWebToken.sign({
      data: JSONWebToken.getFormPrivateUserSessionClaims(data),
      expiresInSeconds:
        Number.isFinite(data.expiresInSeconds) && data.expiresInSeconds > 0
          ? Math.ceil(data.expiresInSeconds)
          : 0,
      purpose: JsonWebTokenPurpose.FormPrivateUserSessionSignOut,
    });
  }

  // The three ids, as text, and nothing else of what the caller handed in.
  private static getFormPrivateUserSessionClaims(
    data: FormPrivateUserSessionClaims,
  ): JSONObject {
    return {
      formId: data.formId.toString(),
      userId: data.userId.toString(),
      sessionId: data.sessionId.toString(),
    };
  }

  private static isUsableDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
  }

  // A claim of milliseconds, if it is one.
  private static readMsClaim(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  }

  /*
   * `purpose` is what the token is for (JsonWebTokenPurpose), and only the
   * caller says it: a `purpose` inside `data` is never carried over, so
   * nothing signed from values that came from elsewhere can claim to be a
   * session.
   *
   * A token that names a session or an SSO provider is refused without one:
   * the readers still take such a token, when it says nothing, as one an
   * earlier release signed (isFor), so nothing signs one that way now.
   */
  @CaptureSpan()
  public static sign(props: {
    data: JSONWebTokenData | User | StatusPagePrivateUser | string | JSONObject;
    expiresInSeconds: number;
    purpose?: JsonWebTokenPurpose | undefined;
  }): string {
    const { data, expiresInSeconds } = props;

    let jsonObj: JSONObject;

    if (typeof data === "string") {
      jsonObj = {
        data: data.toString(),
      };
    } else if (data instanceof User) {
      jsonObj = {
        userId: data.id!.toString(),
        email: data.email!.toString(),
        name: data.name?.toString() || "",
        isMasterAdmin: data.isMasterAdmin!,
      };
    } else if (data instanceof StatusPagePrivateUser) {
      jsonObj = {
        userId: data.id!.toString(),
        email: data.email!.toString(),
        statusPageId: data.statusPageId?.toString(),
      };
    } else {
      jsonObj = {
        ...data,
        userId: data.userId?.toString(),
        email: data.email?.toString(),
        name: data.name?.toString() || "",
        projectId: data.projectId?.toString() || "",
        isMasterAdmin: data.isMasterAdmin,
        sessionId: data.sessionId?.toString() || undefined,
        // A decoded token's issue time is not a claim of the new one.
        issuedAtMs: undefined,
        /*
         * Nor what a decoded session token said of its session: only
         * signUserLoginToken writes those, from the session itself.
         */
        signedInAtMs: undefined,
        lastActiveAtMs: undefined,
      };
    }

    delete jsonObj[PURPOSE_CLAIM];

    if (props.purpose) {
      jsonObj[PURPOSE_CLAIM] = props.purpose;
    } else if (JSONWebToken.namesSessionOrSsoProvider(jsonObj)) {
      throw new BadDataException(UNSAID_PURPOSE_MESSAGE);
    }

    return JSONWebToken.signJsonPayload(jsonObj, expiresInSeconds);
  }

  /*
   * Signed with TokenSigningKey: ENCRYPTION_SECRET when the operator set one,
   * and never a value this repository ships.
   */
  @CaptureSpan()
  public static signJsonPayload(
    payload: JSONObject,
    expiresInSeconds: number,
  ): string {
    /*
     * The key object jsonwebtoken would make of the key, made once
     * (JsonWebTokenKeys). jsonwebtoken 9 takes a KeyObject; its type
     * package (8.5) does not say so.
     */
    return jwt.sign(
      payload,
      JsonWebTokenKeys.forSigning(TokenSigningKey.get()) as jwt.Secret,
      {
        expiresIn: expiresInSeconds,
      },
    );
  }

  /**
   * Sign a JWT with a custom private key using RS256 algorithm.
   * Used for OAuth JWT Bearer flows that require asymmetric signing.
   */
  @CaptureSpan()
  public static signWithPrivateKey(
    payload: Record<string, unknown>,
    privateKey: string,
  ): string {
    return jwt.sign(payload, privateKey, {
      algorithm: "RS256",
    });
  }

  /*
   * Only a token signed with TokenSigningKey verifies. On an installation
   * whose ENCRYPTION_SECRET is unset or a shipped placeholder, one signed
   * with that public value does not.
   *
   * This says nothing about what the token is for. A token that names a
   * person is read with decode, which asks.
   */
  @CaptureSpan()
  public static decodeJsonPayload(
    token: string,
    options?: DecodeOptions,
  ): JSONObject {
    // The key object jsonwebtoken would make of the key (see signJsonPayload).
    const decodedToken: string = JSON.stringify(
      jwt.verify(
        token,
        JsonWebTokenKeys.forVerifying(TokenSigningKey.get()) as jwt.Secret,
        options?.acceptExpired ? { ignoreExpiration: true } : undefined,
      ) as string,
    );
    const decoded: JSONObject = JSONFunctions.parseJSONObject(decodedToken);

    return decoded;
  }

  /*
   * Whether claims that verified are a token for `purpose`
   * (JsonWebTokenPurpose):
   *
   *   - a session names the user and the UserSession it belongs to, and no
   *     status page or SSO provider. It says it is one, or is an access
   *     token an earlier release signed: no purpose, and signed for fifteen
   *     minutes at most. Those are still taken, so that nobody is signed out
   *     while an upgrade rolls out - a server of the release before signs
   *     them until it stops - and nothing signs one now (sign). An SSO
   *     sign-in never names a session and lives thirty days, and a status
   *     page's session names its status page, so neither is ever one;
   *   - an SSO sign-in says so, or is one an earlier release gave: no
   *     purpose, the kind of provider that gave it, and no session or status
   *     page of its own. Those lasted thirty days, so they are still read as
   *     what they are - SSO sign-ins, never sessions - until the last of
   *     them expires;
   *   - a status page's session says so and names its status page, or is one
   *     an earlier release gave: no purpose, a status page and a session.
   *
   * Anything else is refused, whatever it holds.
   */
  public static isFor(
    claims: JSONObject,
    purpose: JsonWebTokenPurpose,
  ): boolean {
    const claimedPurpose: unknown = claims[PURPOSE_CLAIM];
    const namesStatusPage: boolean = Boolean(claims["statusPageId"]);
    const namesSession: boolean = Boolean(claims["sessionId"]);

    switch (purpose) {
      case JsonWebTokenPurpose.UserSession:
        if (
          namesStatusPage ||
          JSONWebToken.namesSsoProvider(claims) ||
          !JSONWebToken.isId(claims["userId"]) ||
          !JSONWebToken.isId(claims["sessionId"])
        ) {
          return false;
        }

        if (claimedPurpose === JsonWebTokenPurpose.UserSession) {
          return true;
        }

        return (
          claimedPurpose === undefined &&
          JSONWebToken.livesAtMost(
            claims,
            EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
          )
        );

      case JsonWebTokenPurpose.SsoSignIn:
        if (claimedPurpose === JsonWebTokenPurpose.SsoSignIn) {
          return !namesStatusPage && !namesSession;
        }

        return (
          claimedPurpose === undefined &&
          Object.values(SsoProviderType).includes(
            claims["ssoProviderType"] as SsoProviderType,
          ) &&
          !namesStatusPage &&
          !namesSession
        );

      case JsonWebTokenPurpose.StatusPageSession:
        if (claimedPurpose === JsonWebTokenPurpose.StatusPageSession) {
          return namesStatusPage;
        }

        return claimedPurpose === undefined && namesStatusPage && namesSession;

      /*
       * Which session a browser's sign-out names
       * (signSessionSignOutToken): it says so - no release signed one
       * that did not - and names its user and its session, and no status
       * page or SSO provider.
       */
      case JsonWebTokenPurpose.UserSessionSignOut:
        return (
          claimedPurpose === JsonWebTokenPurpose.UserSessionSignOut &&
          !namesStatusPage &&
          !JSONWebToken.namesSsoProvider(claims) &&
          JSONWebToken.isId(claims["userId"]) &&
          JSONWebToken.isId(claims["sessionId"])
        );

      /*
       * Which session a browser's sign-out names on one status page
       * (signStatusPageSessionSignOutToken): it says so, and names its
       * status page, its private user and its session, and no SSO
       * provider.
       */
      case JsonWebTokenPurpose.StatusPageSessionSignOut:
        return (
          claimedPurpose === JsonWebTokenPurpose.StatusPageSessionSignOut &&
          !JSONWebToken.namesSsoProvider(claims) &&
          JSONWebToken.isId(claims["statusPageId"]) &&
          JSONWebToken.isId(claims["userId"]) &&
          JSONWebToken.isId(claims["sessionId"])
        );

      /*
       * A dashboard private user's session, and the cookie that names it for
       * its sign-out (signDashboardPrivateUserSessionToken,
       * signDashboardPrivateUserSessionSignOutToken): each says so - no
       * release signed one that did not - and names its dashboard, its
       * private user and its session, and no status page or SSO provider.
       */
      case JsonWebTokenPurpose.DashboardPrivateUserSession:
      case JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut:
        return (
          claimedPurpose === purpose &&
          !namesStatusPage &&
          !JSONWebToken.namesSsoProvider(claims) &&
          JSONWebToken.isId(claims["dashboardId"]) &&
          JSONWebToken.isId(claims["userId"]) &&
          JSONWebToken.isId(claims["sessionId"])
        );

      /*
       * A form private user's session, and the cookie that names it for
       * its sign-out (signFormPrivateUserSessionToken,
       * signFormPrivateUserSessionSignOutToken): each says so - no
       * release signed one that did not - and names its form, its
       * private user and its session, and no status page or SSO provider.
       */
      case JsonWebTokenPurpose.FormPrivateUserSession:
      case JsonWebTokenPurpose.FormPrivateUserSessionSignOut:
        return (
          claimedPurpose === purpose &&
          !namesStatusPage &&
          !JSONWebToken.namesSsoProvider(claims) &&
          JSONWebToken.isId(claims["formId"]) &&
          JSONWebToken.isId(claims["userId"]) &&
          JSONWebToken.isId(claims["sessionId"])
        );

      default:
        return false;
    }
  }

  /*
   * The claims of a token that names a person, if OneUptime signed it for
   * `purpose` and it has not expired. Throws otherwise: a token made for
   * anything else is refused exactly as one that does not verify (isFor),
   * so an SSO sign-in is no session, a session no SSO sign-in, and a status
   * page's session neither. With `acceptExpired` (DecodeOptions), one that
   * has expired is taken too, for the one use that asks.
   *
   * A browser's sign-out cookie names a person too, but holds no address
   * and is no one's identity: it is read only by decodeSessionToSignOut
   * (a dashboard's) or decodeStatusPageSessionToSignOut (a status page's),
   * and refused here whatever is asked.
   */
  @CaptureSpan()
  public static decode(
    token: string,
    purpose: JsonWebTokenPurpose,
    options?: DecodeOptions,
  ): JSONWebTokenData {
    try {
      if (
        purpose === JsonWebTokenPurpose.UserSessionSignOut ||
        purpose === JsonWebTokenPurpose.StatusPageSessionSignOut ||
        purpose === JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut ||
        purpose === JsonWebTokenPurpose.FormPrivateUserSessionSignOut
      ) {
        throw new BadDataException(
          "A sign-out cookie is read only by JSONWebToken.decodeSessionToSignOut, decodeStatusPageSessionToSignOut, decodeDashboardPrivateUserSessionToSignOut or decodeFormPrivateUserSessionToSignOut.",
        );
      }

      /*
       * A dashboard private user's session names no address, so it is no
       * JSONWebTokenData: it is read only by decodeDashboardPrivateUserSession.
       */
      if (purpose === JsonWebTokenPurpose.DashboardPrivateUserSession) {
        throw new BadDataException(
          "A dashboard private user's session is read only by JSONWebToken.decodeDashboardPrivateUserSession.",
        );
      }

      /*
       * A form private user's session names no address, so it is no
       * JSONWebTokenData: it is read only by decodeFormPrivateUserSession.
       */
      if (purpose === JsonWebTokenPurpose.FormPrivateUserSession) {
        throw new BadDataException(
          "A form private user's session is read only by JSONWebToken.decodeFormPrivateUserSession.",
        );
      }

      const decoded: JSONObject = JSONWebToken.readClaimsFor(
        token,
        purpose,
        options,
      );

      // When it was issued, from the claims whose signature was just checked.
      const issuedAtInSeconds: unknown = decoded["iat"];
      const issuedAtMs: number | undefined =
        typeof issuedAtInSeconds === "number" &&
        Number.isFinite(issuedAtInSeconds)
          ? issuedAtInSeconds * 1000
          : undefined;

      if (purpose === JsonWebTokenPurpose.StatusPageSession) {
        return {
          userId: new ObjectID(decoded["userId"] as string),
          email: new Email(decoded["email"] as string),
          statusPageId: new ObjectID(decoded["statusPageId"] as string),
          isMasterAdmin: false,
          name: new Name("User"),
          isGlobalLogin: Boolean(decoded["isGlobalLogin"]),
          sessionId: decoded["sessionId"]
            ? new ObjectID(decoded["sessionId"] as string)
            : undefined,
          issuedAtMs: issuedAtMs,
        };
      }

      return {
        userId: new ObjectID(decoded["userId"] as string),
        email: new Email(decoded["email"] as string),
        name: new Name(decoded["name"] as string),
        projectId: decoded["projectId"]
          ? new ObjectID(decoded["projectId"] as string)
          : undefined,
        isMasterAdmin: Boolean(decoded["isMasterAdmin"]),
        isGlobalLogin: Boolean(decoded["isGlobalLogin"]),
        sessionId: decoded["sessionId"]
          ? new ObjectID(decoded["sessionId"] as string)
          : undefined,
        ssoProviderId: decoded["ssoProviderId"]
          ? new ObjectID(decoded["ssoProviderId"] as string)
          : undefined,
        ssoProviderType: decoded["ssoProviderType"]
          ? (decoded["ssoProviderType"] as SsoProviderType)
          : undefined,
        issuedAtMs: issuedAtMs,
        signedInAtMs:
          purpose === JsonWebTokenPurpose.UserSession
            ? JSONWebToken.readMsClaim(decoded[SIGNED_IN_AT_CLAIM])
            : undefined,
        lastActiveAtMs:
          purpose === JsonWebTokenPurpose.UserSession
            ? JSONWebToken.readMsClaim(decoded[LAST_ACTIVE_AT_CLAIM])
            : undefined,
      };
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  /*
   * The session a browser's sign-out cookie names
   * (JsonWebTokenPurpose.UserSessionSignOut, signSessionSignOutToken), if
   * OneUptime signed it for that and it has not expired. Throws otherwise,
   * as decode does: a session's access token, an SSO sign-in, a status
   * page's session or anything else is refused here exactly as a token
   * that does not verify. For POST /identity/logout to end that session of
   * that user and nothing else (issue #8638).
   */
  @CaptureSpan()
  public static decodeSessionToSignOut(token: string): SessionToSignOut {
    try {
      const decoded: JSONObject = JSONWebToken.readClaimsFor(
        token,
        JsonWebTokenPurpose.UserSessionSignOut,
      );

      return {
        userId: new ObjectID(decoded["userId"] as string),
        sessionId: new ObjectID(decoded["sessionId"] as string),
      };
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  /*
   * The session a browser's sign-out cookie for a status page names
   * (JsonWebTokenPurpose.StatusPageSessionSignOut,
   * signStatusPageSessionSignOutToken), if OneUptime signed it for that and
   * it has not expired. Throws otherwise, as decode does: a status page's
   * access token, a dashboard's sign-out cookie or anything else is
   * refused here exactly as a token that does not verify. For
   * POST /status-page-identity-api/logout/<status page> to end that session
   * of that reader on that page and nothing else (issue #8671).
   */
  @CaptureSpan()
  public static decodeStatusPageSessionToSignOut(
    token: string,
  ): StatusPageSessionToSignOut {
    try {
      const decoded: JSONObject = JSONWebToken.readClaimsFor(
        token,
        JsonWebTokenPurpose.StatusPageSessionSignOut,
      );

      return {
        statusPageId: new ObjectID(decoded["statusPageId"] as string),
        userId: new ObjectID(decoded["userId"] as string),
        sessionId: new ObjectID(decoded["sessionId"] as string),
      };
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  /*
   * The session a dashboard private user's access token names
   * (JsonWebTokenPurpose.DashboardPrivateUserSession,
   * signDashboardPrivateUserSessionToken), if OneUptime signed it for that
   * and it has not expired. Throws otherwise, as decode does: a OneUptime
   * session, an SSO sign-in, a status page's session, a sign-out cookie or
   * anything else is refused here exactly as a token that does not verify.
   * The caller still holds it to the live session it names, and to the
   * dashboard it is asked about (DashboardPrivateUserSessionService).
   */
  @CaptureSpan()
  public static decodeDashboardPrivateUserSession(
    token: string,
  ): DashboardPrivateUserSessionClaims {
    try {
      return JSONWebToken.readDashboardPrivateUserSessionClaims(
        JSONWebToken.readClaimsFor(
          token,
          JsonWebTokenPurpose.DashboardPrivateUserSession,
        ),
      );
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  /*
   * The session a browser's sign-out cookie for a dashboard names
   * (JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut,
   * signDashboardPrivateUserSessionSignOutToken), if OneUptime signed it for
   * that and it has not expired. Throws otherwise. For the dashboard's
   * sign-out to end that session of that private user on that dashboard and
   * nothing else, when the refresh token it sent matches none.
   */
  @CaptureSpan()
  public static decodeDashboardPrivateUserSessionToSignOut(
    token: string,
  ): DashboardPrivateUserSessionClaims {
    try {
      return JSONWebToken.readDashboardPrivateUserSessionClaims(
        JSONWebToken.readClaimsFor(
          token,
          JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut,
        ),
      );
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  private static readDashboardPrivateUserSessionClaims(
    decoded: JSONObject,
  ): DashboardPrivateUserSessionClaims {
    return {
      dashboardId: new ObjectID(decoded["dashboardId"] as string),
      userId: new ObjectID(decoded["userId"] as string),
      sessionId: new ObjectID(decoded["sessionId"] as string),
    };
  }

  /*
   * The session a form private user's access token names
   * (JsonWebTokenPurpose.FormPrivateUserSession,
   * signFormPrivateUserSessionToken), if OneUptime signed it for that
   * and it has not expired. Throws otherwise, as decode does: a OneUptime
   * session, an SSO sign-in, a status page's session, a sign-out cookie or
   * anything else is refused here exactly as a token that does not verify.
   * The caller still holds it to the live session it names, and to the
   * form it is asked about (FormPrivateUserSessionService).
   */
  @CaptureSpan()
  public static decodeFormPrivateUserSession(
    token: string,
  ): FormPrivateUserSessionClaims {
    try {
      return JSONWebToken.readFormPrivateUserSessionClaims(
        JSONWebToken.readClaimsFor(
          token,
          JsonWebTokenPurpose.FormPrivateUserSession,
        ),
      );
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  /*
   * The session a browser's sign-out cookie for a form names
   * (JsonWebTokenPurpose.FormPrivateUserSessionSignOut,
   * signFormPrivateUserSessionSignOutToken), if OneUptime signed it for
   * that and it has not expired. Throws otherwise. For the form's
   * sign-out to end that session of that private user on that form and
   * nothing else, when the refresh token it sent matches none.
   */
  @CaptureSpan()
  public static decodeFormPrivateUserSessionToSignOut(
    token: string,
  ): FormPrivateUserSessionClaims {
    try {
      return JSONWebToken.readFormPrivateUserSessionClaims(
        JSONWebToken.readClaimsFor(
          token,
          JsonWebTokenPurpose.FormPrivateUserSessionSignOut,
        ),
      );
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
  }

  private static readFormPrivateUserSessionClaims(
    decoded: JSONObject,
  ): FormPrivateUserSessionClaims {
    return {
      formId: new ObjectID(decoded["formId"] as string),
      userId: new ObjectID(decoded["userId"] as string),
      sessionId: new ObjectID(decoded["sessionId"] as string),
    };
  }

  /*
   * The claims of `token`, if OneUptime signed it for `purpose` (isFor) and
   * it has not expired - or, with `acceptExpired`, whether or not it has.
   * Throws otherwise.
   */
  private static readClaimsFor(
    token: string,
    purpose: JsonWebTokenPurpose,
    options?: DecodeOptions,
  ): JSONObject {
    const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token, options);

    if (!JSONWebToken.isFor(decoded, purpose)) {
      throw new BadDataException(
        `The token is not one OneUptime signed for this use (${purpose}).`,
      );
    }

    return decoded;
  }

  private static isId(value: unknown): boolean {
    return typeof value === "string" && ObjectID.isValidUUID(value);
  }

  private static namesSsoProvider(claims: JSONObject): boolean {
    return (
      Boolean(claims["ssoProviderType"]) || Boolean(claims["ssoProviderId"])
    );
  }

  private static namesSessionOrSsoProvider(claims: JSONObject): boolean {
    return (
      Boolean(claims["sessionId"]) || JSONWebToken.namesSsoProvider(claims)
    );
  }

  // Whether the token was signed to last `seconds` or less (its `exp` less its `iat`).
  private static livesAtMost(claims: JSONObject, seconds: number): boolean {
    const issuedAt: unknown = claims["iat"];
    const expiresAt: unknown = claims["exp"];

    return (
      typeof issuedAt === "number" &&
      typeof expiresAt === "number" &&
      Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      expiresAt - issuedAt <= seconds
    );
  }
}

export default JSONWebToken;
