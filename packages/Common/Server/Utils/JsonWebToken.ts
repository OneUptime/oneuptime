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
 * How long a session's access token lived when an earlier release signed it,
 * without a purpose: fifteen minutes, from every sign-in and every refresh.
 */
export const EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS: number = 15 * 60;

export const UNSAID_PURPOSE_MESSAGE: string =
  "A token that names a session or an SSO provider is signed with what it is for (JsonWebTokenPurpose).";

const INVALID_TOKEN_MESSAGE: string = "AccessToken is invalid or expired";

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
    };
    expiresInSeconds: number;
  }): string {
    return JSONWebToken.sign({
      data: data.tokenData,
      expiresInSeconds: data.expiresInSeconds,
      purpose: JsonWebTokenPurpose.UserSession,
    });
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
  public static decodeJsonPayload(token: string): JSONObject {
    // The key object jsonwebtoken would make of the key (see signJsonPayload).
    const decodedToken: string = JSON.stringify(
      jwt.verify(
        token,
        JsonWebTokenKeys.forVerifying(TokenSigningKey.get()) as jwt.Secret,
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

      default:
        return false;
    }
  }

  /*
   * The claims of a token that names a person, if OneUptime signed it for
   * `purpose` and it has not expired. Throws otherwise: a token made for
   * anything else is refused exactly as one that does not verify (isFor),
   * so an SSO sign-in is no session, a session no SSO sign-in, and a status
   * page's session neither.
   */
  @CaptureSpan()
  public static decode(
    token: string,
    purpose: JsonWebTokenPurpose,
  ): JSONWebTokenData {
    try {
      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      if (!JSONWebToken.isFor(decoded, purpose)) {
        throw new BadDataException(
          `The token is not one OneUptime signed for this use (${purpose}).`,
        );
      }

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
      };
    } catch (e) {
      logger.error(e);
      throw new BadDataException(INVALID_TOKEN_MESSAGE);
    }
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
