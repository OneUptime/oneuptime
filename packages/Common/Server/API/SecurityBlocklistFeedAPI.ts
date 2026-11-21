import SecurityBlocklistFeed from "../../Models/DatabaseModels/SecurityBlocklistFeed";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ExceptionCode from "../../Types/Exception/ExceptionCode";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import { SECURITY_BLOCKLIST_FEED_CONTENT_TYPE } from "../../Types/SecurityBlocklist/SecurityBlocklistFeedFormat";
import SecurityBlocklistFeedRateLimit from "../Middleware/SecurityBlocklistFeedRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityBlocklistFeedService, {
  MadeSecurityBlocklistFeedSecret,
  Service as SecurityBlocklistFeedServiceType,
} from "../Services/SecurityBlocklistFeedService";
import { resolveClientIp } from "../Utils/ClientIp";
import OneUptimeDate from "../../Types/Date";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeResponse,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityBlocklistFeedServe, {
  SECURITY_BLOCKLIST_FEED_NOT_FOUND_MESSAGE,
  SECURITY_BLOCKLIST_FEED_REALM,
  SecurityBlocklistFeedFetchAnswer,
} from "../Utils/SecurityBlocklist/SecurityBlocklistFeedServe";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Blocklist feeds (#10345). Two kinds of route share this router:
 *
 * THE FEEDS THEMSELVES, read by firewalls - no session, no API key, no
 * UserMiddleware (an `apikey` header, or a browser's expired cookie, would
 * take the request somewhere else): the secret is the credential.
 *
 *   GET /blocklist-feed/:feedId/:file            the secret in Authorization:
 *                                                a basic password (Palo Alto,
 *                                                FortiGate, Check Point) or a
 *                                                bearer token (a host's curl)
 *   GET /blocklist-feed/:feedId/:secret/:file    the secret in the path, for
 *                                                firewalls that can send
 *                                                neither (Cisco, OPNsense,
 *                                                pfSense)
 *
 * where :file is blocklist.txt (?comments=1), nftables.nft or nginx.conf,
 * or any of them with .md5 after it. Rate limited first
 * (SecurityBlocklistFeedRateLimit), then answered by SecurityBlocklistFeedServe.
 * Nginx writes no access log line for /api/blocklist-feed/: a path secret in
 * a log is a credential on disk. Anything else under the prefix is answered
 * by a constant (blocklistFeedFallbackHandler), never by the app's own
 * "Page not found - <url>", which would log the URL.
 *
 * THE FEEDS' SECRETS, for the feed's page and the API (a session or an API
 * key, the permission to change the feed):
 *
 *   POST /security-blocklist-feed/:id/rotate-secret   a new secret, answered
 *                                                     once; the one it
 *                                                     replaces works a day more
 *   POST /security-blocklist-feed/:id/revoke-secret   every secret ends now
 *
 * The CRUD of the feeds is BaseAPI's: a create answers the new feed's secret
 * once (SecurityBlocklistFeedService.onCreateSuccess).
 */

export const BLOCKLIST_FEED_ROUTE_PREFIX: string = "/blocklist-feed";
export const BLOCKLIST_FEED_HEADER_ROUTE: string = `${BLOCKLIST_FEED_ROUTE_PREFIX}/:feedId/:file`;
export const BLOCKLIST_FEED_PATH_SECRET_ROUTE: string = `${BLOCKLIST_FEED_ROUTE_PREFIX}/:feedId/:secret/:file`;
export const BLOCKLIST_FEED_FALLBACK_ROUTE: string = `${BLOCKLIST_FEED_ROUTE_PREFIX}/*`;

export const ROTATE_SECRET_ROUTE: string =
  "/security-blocklist-feed/:id/rotate-secret";
export const REVOKE_SECRET_ROUTE: string =
  "/security-blocklist-feed/:id/revoke-secret";

export const BLOCKLIST_FEED_ALLOWED_METHODS: string = "GET, HEAD, OPTIONS";

export const SECRET_REQUIRED_MESSAGE: string =
  "This feed needs its secret: send it as the password of basic auth, as a bearer token, or in the feed's URL.";
export const SOURCE_NOT_ALLOWED_MESSAGE: string =
  "This feed answers only the addresses on its allowlist. Add the firewall's address to the feed on its page in OneUptime.";
export const UNAVAILABLE_MESSAGE: string =
  "OneUptime could not check the blocklist against your protected addresses, so it served nothing new. Your firewall keeps the list it has; it is tried again in a minute.";

/* 405, as the calendar feeds answer a wrong method. */
class MethodNotAllowedException extends Exception {
  public constructor(message: string) {
    super(405 as ExceptionCode, message);
  }
}

function sendNotFound(req: ExpressRequest, res: ExpressResponse): void {
  return Response.sendErrorResponse(
    req,
    res,
    new NotFoundException(SECURITY_BLOCKLIST_FEED_NOT_FOUND_MESSAGE),
  );
}

/*
 * The answer to every near miss under the feed prefix. It says nothing
 * about the URL it was asked for - a constant - so neither the body nor the
 * error line sendErrorResponse writes can carry a secret. OPTIONS is
 * answered as OPTIONS should be; another method gets 405 with Allow.
 */
export function blocklistFeedFallbackHandler(
  req: ExpressRequest,
  res: ExpressResponse,
): void {
  const method: string = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.set("Allow", BLOCKLIST_FEED_ALLOWED_METHODS);

    return Response.sendEmptySuccessResponse(req, res);
  }

  if (method !== "GET" && method !== "HEAD") {
    res.set("Allow", BLOCKLIST_FEED_ALLOWED_METHODS);

    return Response.sendErrorResponse(
      req,
      res,
      new MethodNotAllowedException(
        "A blocklist feed is read with GET on its full URL.",
      ),
    );
  }

  return sendNotFound(req, res);
}

/*
 * Sends a fetch's answer. A list goes out as text with its ETag, never
 * cached by anything shared (its URL may hold a secret), and is not
 * written to the request log; its fetch is recorded once the answer is on
 * its way.
 */
export function sendBlocklistFeedAnswer(
  req: ExpressRequest,
  res: ExpressResponse,
  answer: SecurityBlocklistFeedFetchAnswer,
): void {
  switch (answer.status) {
    case 404:
      return sendNotFound(req, res);
    case 401:
      res.set(
        "WWW-Authenticate",
        `Basic realm="${SECURITY_BLOCKLIST_FEED_REALM}", charset="UTF-8"`,
      );
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(SECRET_REQUIRED_MESSAGE),
      );
    case 403:
      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(SOURCE_NOT_ALLOWED_MESSAGE),
      );
    case 503:
      res.set("Retry-After", String(answer.retryAfterSeconds));
      return Response.sendErrorResponse(
        req,
        res,
        new ServiceUnavailableException(UNAVAILABLE_MESSAGE),
      );
    default:
      break;
  }

  const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

  oneUptimeResponse.set("Content-Type", SECURITY_BLOCKLIST_FEED_CONTENT_TYPE);
  oneUptimeResponse.set("ETag", answer.etag);
  oneUptimeResponse.set("Cache-Control", "private, no-cache");
  oneUptimeResponse.set("X-Content-Type-Options", "nosniff");
  oneUptimeResponse.set("X-Robots-Tag", "noindex");
  oneUptimeResponse.removeHeader("Pragma");

  if (answer.bookkeeping) {
    const bookkeeping: () => Promise<void> = answer.bookkeeping;

    // Recorded once the answer is handed on: a fetch that never got its list is no evidence.
    res.once("finish", () => {
      void SecurityBlocklistFeedServe.runBookkeeping(bookkeeping);
    });
  }

  if (answer.status === 304) {
    oneUptimeResponse.logBody = { status: 304 };
    oneUptimeResponse.status(304).end();
    return;
  }

  oneUptimeResponse.logBody = {
    contentType: SECURITY_BLOCKLIST_FEED_CONTENT_TYPE,
    bytes: Buffer.byteLength(answer.body, "utf8"),
  };
  oneUptimeResponse.status(200).send(answer.body);
}

// Answers one fetch, the secret taken from the path or from the headers.
function fetchHandler(
  isPathSecret: boolean,
): (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const answer: SecurityBlocklistFeedFetchAnswer =
        await SecurityBlocklistFeedServe.answer({
          feedId: req.params["feedId"],
          pathSecret: isPathSecret ? String(req.params["secret"] || "") : null,
          fileName: req.params["file"],
          comments: req.query["comments"],
          authorization: req.headers["authorization"],
          ifNoneMatch: req.headers["if-none-match"],
          userAgent: req.headers["user-agent"],
          clientIp: resolveClientIp(req) || null,
          isHead: (req.method || "").toUpperCase() === "HEAD",
          now: OneUptimeDate.getCurrentDate(),
        });

      return sendBlocklistFeedAnswer(req, res, answer);
    } catch (error) {
      next(error);
    }
  };
}

export default class SecurityBlocklistFeedAPI extends BaseAPI<
  SecurityBlocklistFeed,
  SecurityBlocklistFeedServiceType
> {
  public constructor() {
    super(SecurityBlocklistFeed, SecurityBlocklistFeedService);

    this.router.get(
      BLOCKLIST_FEED_HEADER_ROUTE,
      SecurityBlocklistFeedRateLimit.middleware,
      fetchHandler(false),
    );

    this.router.get(
      BLOCKLIST_FEED_PATH_SECRET_ROUTE,
      SecurityBlocklistFeedRateLimit.middleware,
      fetchHandler(true),
    );

    this.router.all(BLOCKLIST_FEED_FALLBACK_ROUTE, blocklistFeedFallbackHandler);

    this.router.post(
      ROTATE_SECRET_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const made: MadeSecurityBlocklistFeedSecret =
            await SecurityBlocklistFeedService.rotateSecret({
              id: this.readFeedId(req),
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            secret: made.secret,
            secretHint: made.secretHint,
            previousSecretExpiresAt: made.previousSecretExpiresAt
              ? made.previousSecretExpiresAt.toISOString()
              : null,
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      REVOKE_SECRET_ROUTE,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      ServerProductRoutes.refuseWhileOff(ProductKey.SecurityEvents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          await SecurityBlocklistFeedService.revokeSecret({
            id: this.readFeedId(req),
            props,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private readFeedId(req: ExpressRequest): ObjectID {
    const id: unknown = req.params["id"];

    if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
      throw new BadDataException("Name the feed by its ID.");
    }

    return new ObjectID(id);
  }
}
