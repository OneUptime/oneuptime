/**
 * HTTP plumbing shared by the OAuth endpoints
 *
 * The back-channel endpoints (token, registration, revocation, discovery)
 * answer in the OAuth wire formats rather than the API's own `{ message }`
 * envelope, so they write their responses directly; this is the handful of
 * rules they all follow.
 */

import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

export type OAuthParameters = Record<string, unknown>;

export type OAuthHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void>;

export default class OAuthHttp {
  /*
   * Nothing an OAuth endpoint says may be stored: a token response in a
   * shared cache is a token handed to the next reader, and even an error
   * names a flow that has since moved on (RFC 6749 section 5.1).
   */
  public static setNoStore(res: ExpressResponse): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }

  /*
   * Open to any origin. These endpoints take no ambient credential - no
   * cookie, no session - so a page on another origin calling them can do
   * nothing its own server could not, and browser-based MCP clients need to
   * be able to. The consent endpoints, which DO ride on the session cookie,
   * are not given this.
   */
  public static setCorsHeaders(res: ExpressResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, mcp-protocol-version",
    );
  }

  public static sendJson(
    res: ExpressResponse,
    statusCode: number,
    body: unknown,
  ): void {
    OAuthHttp.setNoStore(res);
    res.status(statusCode).json(body);
  }

  public static sendError(res: ExpressResponse, error: McpOAuthError): void {
    if (error.challenge) {
      res.setHeader("WWW-Authenticate", error.challenge);
    }

    OAuthHttp.sendJson(res, error.getStatusCode(), error.toResponseBody());
  }

  /*
   * The request's parameters: the form body of a POST, the query of a GET.
   * A body that is not an object (a JSON array, a bare string) is no
   * parameters at all rather than something to index into.
   */
  public static getParameters(req: ExpressRequest): OAuthParameters {
    const source: unknown = req.method === "GET" ? req.query : req.body;

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }

    return source as OAuthParameters;
  }

  /*
   * A parameter that must appear at most once (RFC 6749 section 3.1). A
   * repeated one arrives as an array and is treated as absent.
   */
  public static getString(
    parameters: OAuthParameters,
    name: string,
  ): string | undefined {
    const value: unknown = parameters[name];

    return typeof value === "string" && value !== "" ? value : undefined;
  }

  /*
   * Wraps an endpoint so that a failure is always an OAuth error document:
   * the one it threw, or - for anything unexpected - `server_error`, with the
   * cause in the log and never in the response.
   */
  public static handle(name: string, handler: OAuthHandler): OAuthHandler {
    return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      try {
        await handler(req, res);
      } catch (err) {
        if (res.headersSent) {
          logger.error(`MCP OAuth: ${name} failed after responding.`);
          logger.error(err);
          return;
        }

        if (err instanceof McpOAuthError) {
          OAuthHttp.sendError(res, err);
          return;
        }

        logger.error(`MCP OAuth: ${name} failed.`);
        logger.error(err);

        OAuthHttp.sendError(
          res,
          new McpOAuthError(
            McpOAuthErrorCode.ServerError,
            "The authorization server encountered an unexpected error.",
          ),
        );
      }
    };
  }
}
