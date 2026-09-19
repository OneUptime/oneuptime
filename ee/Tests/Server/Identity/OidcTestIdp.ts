/*
 * A real OpenID Provider, in process, for the OIDC tests.
 *
 * The alternative — stubbing openid-client — would test the mock rather than
 * the flow. Everything that actually protects an OIDC login lives in the
 * library and the network exchange: the ID token signature is checked against
 * the JWKS the discovery document points at, `aud` is matched to the client,
 * `exp` is enforced, the nonce is compared to the one the authorization
 * request carried, and the PKCE `code_verifier` is sent to the token endpoint.
 * Serving genuine documents over a loopback socket exercises all of it.
 *
 * Every response body here is the real shape a provider returns; the
 * per-vendor claim sets in OIDC.test.ts are transcribed from real ID tokens
 * (with identifiers replaced).
 */
import crypto from "crypto";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import { JSONObject } from "Common/Types/JSON";

export interface IdpKeyPair {
  privateKey: string;
  publicKey: string;
  kid: string;
}

export function generateIdpKeyPair(kid: string): IdpKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return { privateKey, publicKey, kid };
}

/*
 * The JWKS key is shared across providers and generated once. Every test
 * starts its own provider, and a 2048-bit RSA keygen per start would dominate
 * the suite's runtime for no benefit — the tests that need a *different* key
 * (a token signed by something the JWKS does not publish) pass their own in
 * via signingKeyOverride.
 */
let sharedJwksKey: IdpKeyPair | null = null;

function getSharedJwksKey(): IdpKeyPair {
  if (!sharedJwksKey) {
    sharedJwksKey = generateIdpKeyPair("test-signing-key-1");
  }

  return sharedJwksKey;
}

export function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
}

/*
 * Sign a JWT the way a provider does. `key` is separate from the JWKS the
 * server publishes on purpose: signing with a key the JWKS does not carry is
 * how the "forged token" cases are built.
 */
export function signIdToken(data: {
  claims: JSONObject;
  key: IdpKeyPair;
  algorithm?: string | undefined;
}): string {
  const header: JSONObject = {
    alg: data.algorithm ?? "RS256",
    typ: "JWT",
    kid: data.key.kid,
  };

  const signingInput: string = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(data.claims),
  )}`;

  const signature: Buffer = crypto.sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    data.key.privateKey,
  );

  return `${signingInput}.${base64Url(signature)}`;
}

// The access token every token response returns.
export const TEST_ACCESS_TOKEN: string = "test-access-token";

/*
 * The `at_hash` binding an ID token to its access token: base64url of the
 * left-most half of SHA-256 over the token (OIDC Core 3.1.3.6, for RS256).
 * Providers that send at_hash have it validated by openid-client, so a
 * fixture carrying a placeholder would be rejected for the wrong reason.
 */
export function computeAtHash(accessToken: string = TEST_ACCESS_TOKEN): string {
  const digest: Buffer = crypto
    .createHash("sha256")
    .update(accessToken)
    .digest();

  return base64Url(digest.subarray(0, digest.length / 2));
}

export function publicKeyToJwk(key: IdpKeyPair): JSONObject {
  const jwk: JSONObject = crypto
    .createPublicKey(key.publicKey)
    .export({ format: "jwk" }) as unknown as JSONObject;

  return { ...jwk, kid: key.kid, use: "sig", alg: "RS256" };
}

export interface TokenRequest {
  grantType: string | undefined;
  code: string | undefined;
  redirectUri: string | undefined;
  codeVerifier: string | undefined;
  clientId: string | undefined;
  clientSecretSent: boolean;
  authorizationHeader: string | undefined;
  rawBody: string;
}

export interface IdpOptions {
  clientId: string;
  // Overrides the `issuer` advertised by discovery (default: the live origin).
  issuerOverride?: string | undefined;
  // Signing key for the ID token (default: the key the JWKS publishes).
  signingKeyOverride?: IdpKeyPair | undefined;
  // Merged over the default ID token claims; an explicit undefined drops one.
  idTokenClaims?: JSONObject | undefined;
  // Replaces the ID token entirely (for structurally broken tokens).
  rawIdToken?: string | undefined;
  userInfo?: JSONObject | undefined;
  // 500 from /userinfo, to prove the fallback is non-fatal.
  failUserInfo?: boolean | undefined;
  // Leave userinfo_endpoint out of discovery.
  omitUserInfoEndpoint?: boolean | undefined;
  // Return an OAuth error from the token endpoint instead of tokens.
  tokenError?: { error: string; description: string } | undefined;
}

export interface TestIdp {
  issuerUrl: string;
  jwksKey: IdpKeyPair;
  tokenRequests: Array<TokenRequest>;
  close: () => Promise<void>;
}

const DEFAULT_SUBJECT: string = "00u1a2b3c4D5E6F7g8h9";

/*
 * Start the provider. The caller must await close() — the App suite runs with
 * --detectOpenHandles and a leaked listener fails the run.
 */
export async function startTestIdp(options: IdpOptions): Promise<TestIdp> {
  const jwksKey: IdpKeyPair = getSharedJwksKey();
  const tokenRequests: Array<TokenRequest> = [];

  let issuerUrl: string = "";

  const sendJson: (
    res: ServerResponse,
    status: number,
    body: JSONObject,
  ) => void = (res: ServerResponse, status: number, body: JSONObject): void => {
    const payload: string = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload).toString(),
    });
    res.end(payload);
  };

  const readBody: (req: IncomingMessage) => Promise<string> = (
    req: IncomingMessage,
  ): Promise<string> => {
    return new Promise<string>((resolve: (body: string) => void) => {
      let body: string = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        resolve(body);
      });
    });
  };

  const buildIdToken: () => string = (): string => {
    if (options.rawIdToken !== undefined) {
      return options.rawIdToken;
    }

    const nowSeconds: number = Math.floor(Date.now() / 1000);

    const claims: JSONObject = {
      iss: options.issuerOverride ?? issuerUrl,
      sub: DEFAULT_SUBJECT,
      aud: options.clientId,
      exp: nowSeconds + 3600,
      iat: nowSeconds,
      ...(options.idTokenClaims ?? {}),
    };

    /*
     * An explicit `undefined` in idTokenClaims means "omit this claim" — the
     * point of the missing-email and missing-name cases. JSON.stringify would
     * drop it anyway, but deleting keeps `claims` honest for any caller that
     * inspects it.
     */
    for (const key of Object.keys(claims)) {
      if (claims[key] === undefined) {
        delete claims[key];
      }
    }

    return signIdToken({
      claims,
      key: options.signingKeyOverride ?? jwksKey,
    });
  };

  const server: Server = http.createServer(
    (req: IncomingMessage, res: ServerResponse): void => {
      const pathname: string = (req.url || "").split("?")[0] || "";

      if (pathname === "/.well-known/openid-configuration") {
        const discovery: JSONObject = {
          issuer: options.issuerOverride ?? issuerUrl,
          authorization_endpoint: `${issuerUrl}/authorize`,
          token_endpoint: `${issuerUrl}/token`,
          jwks_uri: `${issuerUrl}/jwks`,
          response_types_supported: ["code", "id_token", "code id_token"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "email", "profile"],
          claims_supported: [
            "sub",
            "iss",
            "aud",
            "exp",
            "iat",
            "email",
            "name",
          ],
          token_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
          ],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        };

        if (!options.omitUserInfoEndpoint) {
          discovery["userinfo_endpoint"] = `${issuerUrl}/userinfo`;
        }

        return sendJson(res, 200, discovery);
      }

      if (pathname === "/jwks") {
        return sendJson(res, 200, {
          keys: [publicKeyToJwk(jwksKey)],
        });
      }

      if (pathname === "/token") {
        readBody(req)
          .then((rawBody: string) => {
            const params: URLSearchParams = new URLSearchParams(rawBody);

            tokenRequests.push({
              grantType: params.get("grant_type") ?? undefined,
              code: params.get("code") ?? undefined,
              redirectUri: params.get("redirect_uri") ?? undefined,
              codeVerifier: params.get("code_verifier") ?? undefined,
              clientId: params.get("client_id") ?? undefined,
              clientSecretSent: params.has("client_secret"),
              authorizationHeader: req.headers["authorization"],
              rawBody,
            });

            if (options.tokenError) {
              return sendJson(res, 400, {
                error: options.tokenError.error,
                error_description: options.tokenError.description,
              });
            }

            return sendJson(res, 200, {
              access_token: TEST_ACCESS_TOKEN,
              token_type: "Bearer",
              expires_in: 3600,
              scope: "openid email profile",
              id_token: buildIdToken(),
            });
          })
          .catch(() => {
            return sendJson(res, 500, { error: "server_error" });
          });
        return;
      }

      if (pathname === "/userinfo") {
        if (options.failUserInfo) {
          return sendJson(res, 500, { error: "server_error" });
        }

        return sendJson(res, 200, options.userInfo ?? { sub: DEFAULT_SUBJECT });
      }

      res.writeHead(404);
      res.end();
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address: AddressInfo = server.address() as AddressInfo;
  issuerUrl = `http://127.0.0.1:${address.port}`;

  return {
    issuerUrl,
    jwksKey,
    tokenRequests,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
