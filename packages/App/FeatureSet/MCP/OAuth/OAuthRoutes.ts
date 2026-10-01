/**
 * OAuth routes
 *
 * Mounts the MCP authorization server on the Express app:
 *
 *   discovery     GET  /.well-known/oauth-protected-resource[/mcp]
 *                 GET  /.well-known/oauth-authorization-server[/mcp]
 *                 GET  /mcp/.well-known/oauth-{protected-resource,authorization-server}
 *   front channel GET  /mcp/oauth/authorize          (the member's browser)
 *   back channel  POST /mcp/oauth/token | register | revoke   (the client)
 *   consent       POST /mcp/oauth/consent/details | approve | deny
 *                                                    (OneUptime's own page)
 *
 * When OAuth is switched off (DISABLE_MCP_OAUTH) every one of these steps
 * aside, so the request falls through to the app's ordinary 404 and the MCP
 * server looks exactly as it did before OAuth existed.
 */

import AuthorizationEndpoint from "./AuthorizationEndpoint";
import ConsentEndpoint from "./ConsentEndpoint";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import Metadata from "./Metadata";
import OAuthHttp, { OAuthHandler } from "./OAuthHttp";
import RegistrationEndpoint from "./RegistrationEndpoint";
import RevocationEndpoint from "./RevocationEndpoint";
import TokenEndpoint from "./TokenEndpoint";
import McpOAuthRateLimit, {
  McpOAuthRateLimitBucket,
  McpOAuthRateLimitRejectionHandler,
} from "Common/Server/Middleware/McpOAuthRateLimit";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import {
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressUrlEncoded,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import Response from "Common/Server/Utils/Response";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";
import { JSONObject } from "Common/Types/JSON";

export const MCP_OAUTH_PATH: string = "/mcp/oauth";

export const MCP_OAUTH_AUTHORIZE_PATH: string = `${MCP_OAUTH_PATH}/authorize`;
export const MCP_OAUTH_TOKEN_PATH: string = `${MCP_OAUTH_PATH}/token`;
export const MCP_OAUTH_REGISTER_PATH: string = `${MCP_OAUTH_PATH}/register`;
export const MCP_OAUTH_REVOKE_PATH: string = `${MCP_OAUTH_PATH}/revoke`;
export const MCP_OAUTH_CONSENT_PATH: string = `${MCP_OAUTH_PATH}/consent`;

/*
 * Request bodies here are a handful of short parameters. The cap keeps an
 * anonymous caller from making the server parse megabytes to find that out.
 */
const MAX_BODY_SIZE: string = "64kb";

const TOO_MANY_REQUESTS_DESCRIPTION: string =
  "Too many requests. Please try again later.";

// Steps aside when OAuth is off, so the app answers its ordinary 404.
function requireOAuthEnabled(
  _req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void {
  if (!McpOAuthConfig.isEnabled()) {
    return next("route");
  }

  return next();
}

function corsMiddleware(
  _req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  OAuthHttp.setCorsHeaders(res);
  next();
}

/*
 * A refused back-channel request, in the OAuth error format. With no counter
 * available the registration endpoint is the only one that refuses (see
 * McpOAuthRateLimit); it says "temporarily unavailable", which is the truth.
 */
const rejectAsOAuthError: McpOAuthRateLimitRejectionHandler = (data: {
  res: ExpressResponse;
  statusCode: number;
}): void => {
  OAuthHttp.sendError(
    data.res,
    data.statusCode === 429
      ? new McpOAuthError(
          McpOAuthErrorCode.TooManyRequests,
          TOO_MANY_REQUESTS_DESCRIPTION,
        )
      : new McpOAuthError(
          McpOAuthErrorCode.TemporarilyUnavailable,
          "The authorization server is temporarily unavailable. Please try again later.",
        ),
  );
};

// A refused request from the consent page, in the API's own envelope.
const rejectAsApiError: McpOAuthRateLimitRejectionHandler = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  statusCode: number;
}): void => {
  Response.sendErrorResponse(
    data.req,
    data.res,
    data.statusCode === 429
      ? new TooManyRequestsException(TOO_MANY_REQUESTS_DESCRIPTION)
      : new ServiceUnavailableException("Please try again in a few minutes."),
  );
};

/*
 * A refused authorization request. It is a browser navigation, so the answer
 * is a short plain-text page rather than a redirect: bouncing a flood back
 * through the consent screen would only move the load.
 */
const rejectAuthorization: McpOAuthRateLimitRejectionHandler = (data: {
  res: ExpressResponse;
  statusCode: number;
}): void => {
  OAuthHttp.setNoStore(data.res);
  data.res
    .status(data.statusCode)
    .type("text/plain")
    .send(TOO_MANY_REQUESTS_DESCRIPTION);
};

function sendDocument(document: () => JSONObject): RequestHandler {
  return (_req: ExpressRequest, res: ExpressResponse): void => {
    /*
     * Discovery documents are the one thing here a client MAY cache, and
     * should: they change only when the instance is reconfigured. Five
     * minutes matches how long clients keep them anyway.
     */
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json(document());
  };
}

function preflight(_req: ExpressRequest, res: ExpressResponse): void {
  res.status(204).end();
}

/*
 * Express does not catch a rejected async handler, so each endpoint is
 * wrapped. The OAuth ones turn any failure into an OAuth error document
 * (OAuthHttp.handle); this only has to make sure nothing escapes it.
 */
function route(name: string, handler: OAuthHandler): RequestHandler {
  const wrapped: OAuthHandler = OAuthHttp.handle(name, handler);

  return (req: ExpressRequest, res: ExpressResponse): void => {
    wrapped(req, res).catch((err: unknown): void => {
      logger.error(`MCP OAuth: ${name} failed unexpectedly.`);
      logger.error(err);
    });
  };
}

export function setupMcpOAuthRoutes(app: ExpressApplication): void {
  // --- Discovery ---------------------------------------------------------

  for (const path of Metadata.getProtectedResourceMetadataPaths()) {
    app.options(path, requireOAuthEnabled, corsMiddleware, preflight);
    app.get(
      path,
      requireOAuthEnabled,
      corsMiddleware,
      sendDocument(Metadata.getProtectedResourceMetadata),
    );
  }

  for (const path of Metadata.getAuthorizationServerMetadataPaths()) {
    app.options(path, requireOAuthEnabled, corsMiddleware, preflight);
    app.get(
      path,
      requireOAuthEnabled,
      corsMiddleware,
      sendDocument(Metadata.getAuthorizationServerMetadata),
    );
  }

  // --- Front channel -----------------------------------------------------

  const authorize: Array<RequestHandler> = [
    requireOAuthEnabled,
    McpOAuthRateLimit.getMiddleware(
      McpOAuthRateLimitBucket.Authorize,
      rejectAuthorization,
    ),
    route("authorization request", AuthorizationEndpoint.handle),
  ];

  app.get(MCP_OAUTH_AUTHORIZE_PATH, ...authorize);

  // RFC 6749 section 3.1 lets a client POST the same parameters as a form.
  app.post(
    MCP_OAUTH_AUTHORIZE_PATH,
    requireOAuthEnabled,
    ExpressUrlEncoded({ extended: false, limit: MAX_BODY_SIZE }),
    ...authorize.slice(1),
  );

  // --- Back channel ------------------------------------------------------

  app.options(
    [MCP_OAUTH_TOKEN_PATH, MCP_OAUTH_REGISTER_PATH, MCP_OAUTH_REVOKE_PATH],
    requireOAuthEnabled,
    corsMiddleware,
    preflight,
  );

  app.post(
    MCP_OAUTH_TOKEN_PATH,
    requireOAuthEnabled,
    corsMiddleware,
    ExpressUrlEncoded({ extended: false, limit: MAX_BODY_SIZE }),
    McpOAuthRateLimit.getMiddleware(
      McpOAuthRateLimitBucket.Token,
      rejectAsOAuthError,
    ),
    route("token request", TokenEndpoint.handle),
  );

  app.post(
    MCP_OAUTH_REGISTER_PATH,
    requireOAuthEnabled,
    corsMiddleware,
    ExpressJson({ limit: MAX_BODY_SIZE }),
    McpOAuthRateLimit.getMiddleware(
      McpOAuthRateLimitBucket.Register,
      rejectAsOAuthError,
    ),
    route("client registration", RegistrationEndpoint.handle),
  );

  app.post(
    MCP_OAUTH_REVOKE_PATH,
    requireOAuthEnabled,
    corsMiddleware,
    ExpressUrlEncoded({ extended: false, limit: MAX_BODY_SIZE }),
    McpOAuthRateLimit.getMiddleware(
      McpOAuthRateLimitBucket.Revoke,
      rejectAsOAuthError,
    ),
    route("token revocation", RevocationEndpoint.handle),
  );

  // --- Consent (session authenticated, same origin only) -----------------

  const consent: Array<RequestHandler> = [
    requireOAuthEnabled,
    ExpressJson({ limit: MAX_BODY_SIZE }),
    McpOAuthRateLimit.getMiddleware(
      McpOAuthRateLimitBucket.Consent,
      rejectAsApiError,
    ),
    UserMiddleware.getUserMiddleware,
  ];

  app.post(
    `${MCP_OAUTH_CONSENT_PATH}/details`,
    ...consent,
    ConsentEndpoint.details,
  );

  app.post(
    `${MCP_OAUTH_CONSENT_PATH}/approve`,
    ...consent,
    ConsentEndpoint.approve,
  );

  app.post(`${MCP_OAUTH_CONSENT_PATH}/deny`, ...consent, ConsentEndpoint.deny);

  logger.info("MCP OAuth routes setup complete");
}
