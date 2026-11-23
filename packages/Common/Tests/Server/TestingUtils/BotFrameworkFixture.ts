import crypto from "crypto";
import http from "http";

/*
 * THE MICROSOFT SERVICES THE TEAMS BOT TALKS TO, STOOD IN FOR ON THIS
 * MACHINE (issue #10763).
 *
 * The suites that hold the bot's requests to the outbound proxy's route
 * (App/Tests/OutboundProxy) send real requests, through real proxies
 * (OutboundProxyFixture, SelfSignedHttpsFixture), to these handlers, each
 * answering by path as the service it stands in for answers:
 *
 *   - the Bot Framework's OpenID configuration and the key set it names,
 *     which the SDK checks each incoming activity's token against, holding
 *     a signing key of the suite's own, endorsed for Teams as Microsoft's
 *     keys are;
 *   - Microsoft Entra ID's token endpoint, answering the bot's client
 *     credentials grant with an access token;
 *   - the Bot Connector, recording every activity the bot sends, and who
 *     it was sent as, and answering with the new message's id.
 *
 * Each records what reached it, so a suite reads what was asked for, and
 * with which token.
 */

export const BOT_FRAMEWORK_LOGIN_HOST: string = "login.botframework.com";
export const ENTRA_HOST: string = "login.microsoftonline.com";
export const BOT_CONNECTOR_HOST: string = "smba.trafficmanager.net";

// Who signs a token Teams sends the bot, in Azure's public cloud.
export const CHANNEL_TOKEN_ISSUER: string = "https://api.botframework.com";

export const OPEN_ID_CONFIGURATION_PATH: string =
  "/v1/.well-known/openidconfiguration";
export const KEY_SET_PATH: string = "/v1/.well-known/keys";

// The access token the stand-in Entra ID hands out.
export const ACCESS_TOKEN: string = "access-token-from-entra";

export type ServiceHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  body: string,
) => void;

export interface SigningKey {
  keyId: string;
  privateKey: crypto.KeyObject;
  // The key as a key set publishes it (kty, n, e).
  publicJwk: Record<string, unknown>;
}

export function createSigningKey(keyId: string): SigningKey {
  const pair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } =
    crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

  return {
    keyId: keyId,
    privateKey: pair.privateKey,
    publicJwk: pair.publicKey.export({ format: "jwk" }) as Record<
      string,
      unknown
    >,
  };
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/*
 * A token as the Bot Framework signs one for a request from Teams: for the
 * bot (its audience), naming the service the request came from, valid for
 * an hour.
 */
export function signChannelToken(data: {
  key: SigningKey;
  audience: string;
  serviceUrl: string;
  issuer?: string | undefined;
}): string {
  const nowInSeconds: number = Math.floor(Date.now() / 1000);
  const header: string = base64url(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: data.key.keyId }),
  );
  const payload: string = base64url(
    JSON.stringify({
      iss: data.issuer || CHANNEL_TOKEN_ISSUER,
      aud: data.audience,
      serviceurl: data.serviceUrl,
      nbf: nowInSeconds - 60,
      exp: nowInSeconds + 3600,
    }),
  );
  const signature: string = base64url(
    crypto.sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      data.key.privateKey,
    ),
  );

  return `${header}.${payload}.${signature}`;
}

function answerJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

/*
 * The Bot Framework's two documents: the OpenID configuration, naming the
 * key set at `keySetUrl`, and the key set, holding `keys`, each endorsed
 * for `endorsements` (Teams', by default). Every path asked for is noted
 * in `seen`.
 */
export function botFrameworkKeysHandler(data: {
  keySetUrl: string;
  keys: Array<SigningKey>;
  seen: Array<string>;
  endorsements?: Array<string> | undefined;
}): ServiceHandler {
  return (request: http.IncomingMessage, response: http.ServerResponse) => {
    // A forwarded request names its whole URL; a tunnelled one its path.
    const path: string = new URL(request.url || "/", "http://stand-in")
      .pathname;

    data.seen.push(path);

    if (path === OPEN_ID_CONFIGURATION_PATH) {
      answerJson(response, 200, {
        issuer: CHANNEL_TOKEN_ISSUER,
        authorization_endpoint: "https://invalid.botframework.com",
        jwks_uri: data.keySetUrl,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      });
      return;
    }

    if (path === KEY_SET_PATH) {
      answerJson(response, 200, {
        keys: data.keys.map((key: SigningKey) => {
          return {
            ...key.publicJwk,
            kid: key.keyId,
            use: "sig",
            endorsements: data.endorsements || ["msteams"],
          };
        }),
      });
      return;
    }

    answerJson(response, 404, { error: "not found" });
  };
}

export interface TokenRequestSeen {
  // The token endpoint's path: /<tenant>/oauth2/v2.0/token.
  path: string;
  form: Record<string, string>;
}

// Microsoft Entra ID's token endpoint, answering a client credentials grant.
export function entraTokenHandler(data: {
  seen: Array<TokenRequestSeen>;
}): ServiceHandler {
  return (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    body: string,
  ) => {
    const path: string = new URL(request.url || "/", "http://stand-in")
      .pathname;

    data.seen.push({
      path: path,
      form: Object.fromEntries(new URLSearchParams(body).entries()),
    });

    if (request.method !== "POST" || !path.endsWith("/oauth2/v2.0/token")) {
      answerJson(response, 404, { error: "not_found" });
      return;
    }

    answerJson(response, 200, {
      token_type: "Bearer",
      expires_in: 3599,
      ext_expires_in: 3599,
      access_token: ACCESS_TOKEN,
    });
  };
}

export interface ConnectorCallSeen {
  method: string;
  path: string;
  // The Authorization header the bot sent: "Bearer <token>".
  authorization: string;
  activity: Record<string, unknown>;
}

// The Bot Connector: records each call, answers with a new message's id.
export function botConnectorHandler(data: {
  seen: Array<ConnectorCallSeen>;
}): ServiceHandler {
  return (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    body: string,
  ) => {
    data.seen.push({
      method: request.method || "",
      path: new URL(request.url || "/", "http://stand-in").pathname,
      authorization: String(request.headers["authorization"] || ""),
      activity: body ? (JSON.parse(body) as Record<string, unknown>) : {},
    });

    answerJson(response, 200, { id: `message-${data.seen.length}` });
  };
}
