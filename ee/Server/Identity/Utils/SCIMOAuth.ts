import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import { JSONObject } from "Common/Types/JSON";
import crypto from "crypto";

/*
 * ---------------------------------------------------------------------------
 * OAUTH 2.0 CLIENT CREDENTIALS FOR A SCIM CONNECTION.
 *
 * An identity provider that will not keep a long-lived bearer token -
 * Microsoft Entra ID's application gallery takes only OAuth 2.0 client
 * credentials for SCIM - authenticates the way RFC 6749 section 4.4 says: it
 * sends the connection's client ID and client secret to the token endpoint
 * (API/SCIMOAuthToken.ts) and gets an access token, which it then sends to
 * the SCIM routes as a bearer token (Middleware/SCIMAuthorization.ts), until
 * it expires and it asks for another.
 *
 * The client ID is the connection's id. The client secret is 32 random
 * bytes OneUptime makes (API/SCIMOAuthClientSecret.ts), shown once and kept
 * only as its SHA-256 hash: it has 256 bits of its own, so the hash needs no
 * salt or stretching. A secret works for SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS;
 * when one is replaced the one before keeps working until it expires or is
 * deleted, so the identity provider can be moved to the new one without a
 * gap.
 *
 * An access token lasts an hour and names its connection and - by a
 * fingerprint, never the hash - the secret it was issued with: deleting or
 * replacing that secret, or its expiring, ends the tokens issued with it at
 * once. It is signed like every other token OneUptime signs
 * (JSONWebToken.signJsonPayload) and says what it is for in its purpose
 * claim, so it is never anything else, and nothing else is ever one.
 * ---------------------------------------------------------------------------
 */

export const SCIM_ACCESS_TOKEN_PURPOSE: string = "scim-access-token";

// Microsoft Entra ID requires an access token to live 60 minutes to 6 hours.
export const SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS: number = 60 * 60;

// Microsoft Entra ID requires a client secret to expire after 1 to 3 years.
export const SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS: number = 365;

export const SCIM_CLIENT_SECRET_BYTES: number = 32;

// No token OneUptime signs is anywhere near this long.
const MAX_TOKEN_LENGTH: number = 4096;

export type ScimConnectionType = "project" | "status-page";

const SCIM_CONNECTION_TYPES: ReadonlyArray<ScimConnectionType> = [
  "project",
  "status-page",
];

// What a connection keeps of its client secrets.
export interface ScimClientSecrets {
  oauthClientSecretHash?: string | undefined;
  oauthClientSecretExpiresAt?: Date | undefined;
  oauthPreviousClientSecretHash?: string | undefined;
  oauthPreviousClientSecretExpiresAt?: Date | undefined;
}

// A new client secret: SCIM_CLIENT_SECRET_BYTES random bytes, as hex.
export const generateScimClientSecret: () => string = (): string => {
  return crypto.randomBytes(SCIM_CLIENT_SECRET_BYTES).toString("hex");
};

// What a connection keeps of a client secret: its SHA-256, as hex.
export const hashScimClientSecret: (secret: string) => string = (
  secret: string,
): string => {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
};

// When a client secret made at `now` stops working.
export const getScimClientSecretExpiry: (now: Date) => Date = (
  now: Date,
): Date => {
  return new Date(
    now.getTime() + SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS * 24 * 60 * 60 * 1000,
  );
};

/*
 * What an access token says of the secret it was issued with: a digest of
 * the secret's hash, so a token - which travels with every SCIM request -
 * carries nothing the hash could be read from.
 */
export const getScimClientSecretFingerprint: (secretHash: string) => string = (
  secretHash: string,
): string => {
  return crypto
    .createHash("sha256")
    .update(`scim-access-token:${secretHash}`, "utf8")
    .digest("hex");
};

const isSame: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  const left: Buffer = Buffer.from(a, "utf8");
  const right: Buffer = Buffer.from(b, "utf8");

  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const isLive: (expiresAt: Date | undefined, now: Date) => boolean = (
  expiresAt: Date | undefined,
  now: Date,
): boolean => {
  return Boolean(expiresAt) && new Date(expiresAt!).getTime() > now.getTime();
};

// The hashes of a connection's secrets that have not expired, newest first.
const getLiveSecretHashes: (
  connection: ScimClientSecrets,
  now: Date,
) => Array<string> = (
  connection: ScimClientSecrets,
  now: Date,
): Array<string> => {
  const hashes: Array<string> = [];

  if (
    connection.oauthClientSecretHash &&
    isLive(connection.oauthClientSecretExpiresAt, now)
  ) {
    hashes.push(connection.oauthClientSecretHash);
  }

  if (
    connection.oauthPreviousClientSecretHash &&
    isLive(connection.oauthPreviousClientSecretExpiresAt, now)
  ) {
    hashes.push(connection.oauthPreviousClientSecretHash);
  }

  return hashes;
};

/*
 * The hash of the connection's secret `secret` is, when it is one of its
 * secrets and has not expired - or null. An expired secret gets no access
 * token (Microsoft Entra ID's requirement), and neither does one that was
 * replaced and then deleted.
 */
export const matchScimClientSecret: (data: {
  secret: string;
  connection: ScimClientSecrets;
  now: Date;
}) => string | null = (data: {
  secret: string;
  connection: ScimClientSecrets;
  now: Date;
}): string | null => {
  if (!data.secret) {
    return null;
  }

  const hash: string = hashScimClientSecret(data.secret);

  for (const liveHash of getLiveSecretHashes(data.connection, data.now)) {
    if (isSame(hash, liveHash)) {
      return liveHash;
    }
  }

  return null;
};

// An access token for the connection, issued with the secret whose hash is `secretHash`.
export const signScimAccessToken: (data: {
  connectionId: string;
  connectionType: ScimConnectionType;
  secretHash: string;
}) => string = (data: {
  connectionId: string;
  connectionType: ScimConnectionType;
  secretHash: string;
}): string => {
  return JSONWebToken.signJsonPayload(
    {
      purpose: SCIM_ACCESS_TOKEN_PURPOSE,
      scimConnectionId: data.connectionId.toLowerCase(),
      scimConnectionType: data.connectionType,
      secret: getScimClientSecretFingerprint(data.secretHash),
    },
    SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  );
};

/*
 * Whether a bearer token is shaped like a signed token - three dot-separated
 * parts - rather than a connection's own bearer token, which is hex.
 */
export const isSignedTokenShaped: (token: string) => boolean = (
  token: string,
): boolean => {
  return token.length <= MAX_TOKEN_LENGTH && token.split(".").length === 3;
};

export interface ScimAccessTokenClaims {
  connectionType: ScimConnectionType;
  // getScimClientSecretFingerprint of the secret it was issued with.
  secretFingerprint: string;
}

/*
 * What an access token says, when OneUptime signed it as a SCIM access token
 * for the connection `connectionId` and it has not expired - or null. Never
 * throws.
 */
export const readScimAccessToken: (data: {
  token: string;
  connectionId: string;
}) => ScimAccessTokenClaims | null = (data: {
  token: string;
  connectionId: string;
}): ScimAccessTokenClaims | null => {
  if (!isSignedTokenShaped(data.token)) {
    return null;
  }

  let claims: JSONObject;

  try {
    claims = JSONWebToken.decodeJsonPayload(data.token);
  } catch {
    return null;
  }

  const connectionType: unknown = claims["scimConnectionType"];

  if (
    claims["purpose"] !== SCIM_ACCESS_TOKEN_PURPOSE ||
    typeof claims["scimConnectionId"] !== "string" ||
    claims["scimConnectionId"] !== data.connectionId.toLowerCase() ||
    !SCIM_CONNECTION_TYPES.includes(connectionType as ScimConnectionType) ||
    typeof claims["secret"] !== "string"
  ) {
    return null;
  }

  return {
    connectionType: connectionType as ScimConnectionType,
    secretFingerprint: claims["secret"],
  };
};

/*
 * Whether an access token's secret is still one of the connection's live
 * secrets: replacing, deleting or expiry of the secret ends the tokens it
 * gave.
 */
export const isLiveScimClientSecretFingerprint: (data: {
  secretFingerprint: string;
  connection: ScimClientSecrets;
  now: Date;
}) => boolean = (data: {
  secretFingerprint: string;
  connection: ScimClientSecrets;
  now: Date;
}): boolean => {
  return getLiveSecretHashes(data.connection, data.now).some(
    (hash: string): boolean => {
      return isSame(
        getScimClientSecretFingerprint(hash),
        data.secretFingerprint,
      );
    },
  );
};
