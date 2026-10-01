import IncidentFormRateLimit, {
  IncidentFormRateLimitBucket,
} from "../Middleware/IncidentFormRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import IncidentFormService, {
  Service as IncidentFormServiceType,
} from "../Services/IncidentFormService";
import { resolveClientIp } from "../Utils/ClientIp";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SameOriginRequest from "../Utils/SameOriginRequest";
import BaseAPI from "./BaseAPI";
import IncidentForm from "../../Models/DatabaseModels/IncidentForm";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import {
  INCIDENT_FORM_PAGE_HEADER,
  INCIDENT_FORM_PAGE_HEADER_VALUE,
  PublicIncidentForm,
  PublicIncidentFormSubmissionData,
  PublicIncidentFormSubmissionRequest,
  PublicIncidentFormSubmissionResult,
} from "../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../Types/JSON";

/*
 * The incident form's CRUD routes (inherited from BaseAPI, all behind the
 * signed-in user middleware) plus the two routes the public form page calls,
 * for anyone holding a form's link:
 *
 *   GET  /incident-form/public/:shareKey          the form's questions
 *   POST /incident-form/public/:shareKey/submit   declare an incident
 *
 * Neither can be mistaken for a CRUD route: those are /incident-form,
 * /incident-form/get-list, /incident-form/count and /incident-form/:id with
 * or without /get-item, /update-item or /delete-item, and a share key is a
 * UUID, never "get-item". The CRUD routes are registered first (in BaseAPI's
 * constructor), so even a key spelled like one of their suffixes lands on a
 * CRUD route and its authentication, never the other way round.
 *
 * Each public route runs, in order:
 *
 *  1. refuseForeignPageRequests: a request a browser sent from a page that
 *     is not this instance's own is refused, 403, before it costs or spends
 *     anything. These routes are anonymous and trust where a request comes
 *     from - the form's IP allowlist, the per-address counters - so without
 *     this any website could have its visitors' browsers read a form or
 *     declare incidents from inside an allowed network, or use up those
 *     visitors' shared budgets. It can only go by the two headers in which
 *     a browser says where a request came from, and a browser does not
 *     always send them, so each route then asks for something only the
 *     form's page sends. The read route requires the page's own header
 *     (requireFormPageHeader, the same 403): over plain HTTP another site's
 *     <img> or link sends its GET with neither header, and it cannot add
 *     one. The submit route requires a JSON body (requireJsonBody, 400):
 *     the one kind another site cannot have a browser send without a
 *     preflight, which carries the Origin the first check reads.
 *
 *  2. IncidentFormRateLimit's per-address counters, before anything else
 *     costs anything. Reading a form is load control and fails open;
 *     submitting one declares an incident, so its counters fail closed. (The
 *     form's own hourly ceiling is spent later, by IncidentFormService, only
 *     for a submission that passed every check; its 429 carries a
 *     Retry-After this route writes.)
 *
 *  3. UserMiddleware.getPublicRouteUserMiddleware, the anonymous variant: an
 *     access-token cookie that no longer decodes makes the request anonymous
 *     instead of answering 401. The page is served on the same host as the
 *     dashboard, so a visitor's own OneUptime session cookie rides along -
 *     often expired - and a 401 would send the dashboard client to the login
 *     page, or sign the visitor out of their real session. Nothing here
 *     answers 401 (or 405), and the handlers never read who is calling:
 *     forms are anonymous, and a signed-in visitor is just a visitor.
 *
 *  4. The handler, which checks the body's shape and hands everything else -
 *     the link, the form's switch, the plan, the IP allowlist, the captcha,
 *     the answers - to IncidentFormService, where it is unit-testable.
 *
 * What the page must handle: 200, 400 (bad answers or captcha, with a
 * message to show), 403 (network not allowed), 404 (one message for every
 * unavailable form), 429 with Retry-After, 500 and 503. (The own-page
 * checks' 403 never reaches it: the page is served from this instance's own
 * origin, and its client sends the page's header with every request.)
 *
 * A page the browser takes for this instance's own - a DNS-rebinding name
 * pointed at this server, a status page on its owner's domain - passes the
 * read route's checks, and can read a form's questions through a visitor
 * inside its IP allowlist. It cannot submit: see SameOriginRequest.
 */

export const INCIDENT_FORM_SUBMISSION_BODY_MESSAGE: string =
  'The request must be a JSON object holding the form\'s answers in "data".';

/*
 * The one answer to a request another page had a browser send, whatever the
 * form and whether it exists: the refusal comes before the link is looked
 * at, so it tells that page nothing.
 */
export const INCIDENT_FORM_FOREIGN_PAGE_MESSAGE: string =
  "This form can only be used from its own page.";

export const INCIDENT_FORM_CAPTCHA_TOKEN_MESSAGE: string =
  "captchaToken must be a string.";

/*
 * Far past any token hCaptcha hands out (a few thousand characters), and
 * small enough that a stranger cannot have the server forward megabytes of
 * "token" to hCaptcha on the form's behalf.
 */
export const INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH: number = 16384;

export const INCIDENT_FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE: string = `captchaToken cannot be more than ${INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH} characters.`;

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export default class IncidentFormAPI extends BaseAPI<
  IncidentForm,
  IncidentFormServiceType
> {
  public constructor() {
    super(IncidentForm, IncidentFormService);

    const readRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = IncidentFormRateLimit.getMiddleware(
      IncidentFormRateLimitBucket.Read,
    );

    const submitRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = IncidentFormRateLimit.getMiddleware(
      IncidentFormRateLimitBucket.Submit,
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/public/:shareKey`,
      IncidentFormAPI.refuseForeignPageRequests,
      IncidentFormAPI.requireFormPageHeader,
      readRateLimit,
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * First, so a refusal is not cached either: a form turned back on
           * must not stay "not available" in a proxy.
           */
          Response.setNoCacheHeaders(res);

          const form: PublicIncidentForm =
            await IncidentFormService.getPublicForm({
              shareKey: req.params["shareKey"],
              clientIp: resolveClientIp(req),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            form as unknown as JSONObject,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/public/:shareKey/submit`,
      IncidentFormAPI.refuseForeignPageRequests,
      IncidentFormAPI.requireJsonBody,
      submitRateLimit,
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const request: PublicIncidentFormSubmissionRequest =
            IncidentFormAPI.readSubmissionRequest(req.body);

          /*
           * The trusted end of X-Forwarded-For, for the form's IP allowlist
           * and for hCaptcha alike: never an address the caller wrote.
           */
          const clientIp: string | undefined = resolveClientIp(req);

          const result: PublicIncidentFormSubmissionResult =
            await IncidentFormService.submitPublicForm({
              shareKey: req.params["shareKey"],
              request: request,
              clientIp: clientIp,
              captchaRemoteIp: clientIp,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          // The form's own ceiling refused: say when to come back.
          IncidentFormRateLimit.setRetryAfterFor(res, err);
          next(err);
        }
      },
    );
  }

  /*
   * First on both public routes (the rule is SameOriginRequest's): a request
   * a browser sent from a page that is not this instance's own is refused
   * before the limiter counts it - so such a page cannot use up its
   * visitors' budgets either - and before the link is looked at. The form's
   * own page is served from this instance's origin and never meets it. A
   * request with neither header passes here - curl, a server-side client,
   * but also another site's <img> over plain HTTP - and meets the route's
   * next check.
   */
  public static refuseForeignPageRequests(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (
      SameOriginRequest.isForeignPageRequest({
        headers: req.headers,
        instanceOrigin: SameOriginRequest.getInstanceOrigin(),
      })
    ) {
      Response.setNoCacheHeaders(res);

      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE),
      );
    }

    return next();
  }

  /*
   * Second on the read route, still before the limiter: the request must
   * carry the header the form's page adds to every request it makes
   * (INCIDENT_FORM_PAGE_HEADER). Over plain HTTP a browser sends another
   * site's <img>, link or no-cors fetch with neither header the check above
   * reads, so without this such a page could have each of its visitors'
   * browsers send reads by the hundred - answered or not, every one counted
   * against the budget everybody behind that visitor's address shares, until
   * their own colleagues are refused the form. None of those can add a
   * header, and a script on another origin that adds one is preflighted,
   * then refused above for its Origin. The same 403 as above, for the same
   * reason; a caller that is not the page - curl, a script - sends the
   * header itself.
   *
   * The submit route needs no such header: every POST carries its Origin,
   * and requireJsonBody forces the preflight a JSON body needs.
   */
  public static requireFormPageHeader(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (
      !SameOriginRequest.hasPageScriptHeader({
        headers: req.headers,
        name: INCIDENT_FORM_PAGE_HEADER,
        value: INCIDENT_FORM_PAGE_HEADER_VALUE,
      })
    ) {
      Response.setNoCacheHeaders(res);

      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(INCIDENT_FORM_FOREIGN_PAGE_MESSAGE),
      );
    }

    return next();
  }

  /*
   * Second on the submit route, still before the limiter: the body must be
   * JSON. Another site's page can have a browser send a urlencoded,
   * multipart or plain text body with no preflight - a plain HTML form does
   * - and the app's urlencoded parser turns "data[title]=..." into the very
   * object a JSON body gives. A browser that sends no Origin with such a
   * form gets past the check above; it cannot get past this. The form's page
   * always sends JSON.
   */
  public static requireJsonBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (!SameOriginRequest.isJsonContentType(req.headers["content-type"])) {
      Response.setNoCacheHeaders(res);

      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(INCIDENT_FORM_SUBMISSION_BODY_MESSAGE),
      );
    }

    return next();
  }

  /*
   * The shape of the submit body, checked before anything reaches the
   * service: an object with the answers in `data` and, optionally, the
   * captcha token as text of a sane length. What the answers themselves
   * hold is the service's to judge (validateIncidentFormSubmission); every
   * other key in the body is left behind here, so it cannot reach anything.
   *
   * The body's size is not checked here. The app's JSON parser has read it
   * (up to 50 MB) before any route runs, so refusing a large body now would
   * save none of what it cost; and nothing after this does more work for a
   * larger body - only the answers the form asks are read, each text is
   * capped, a multi-select's list is bounded before its entries are read,
   * an answer that is an object is refused unread, and the token is capped
   * below. A fixed size would also have to allow for a form with many long
   * questions.
   */
  public static readSubmissionRequest(
    body: unknown,
  ): PublicIncidentFormSubmissionRequest {
    if (!isPlainObject(body) || !isPlainObject(body["data"])) {
      throw new BadDataException(INCIDENT_FORM_SUBMISSION_BODY_MESSAGE);
    }

    const captchaToken: unknown = body["captchaToken"];

    if (
      captchaToken !== undefined &&
      captchaToken !== null &&
      typeof captchaToken !== "string"
    ) {
      throw new BadDataException(INCIDENT_FORM_CAPTCHA_TOKEN_MESSAGE);
    }

    if (
      typeof captchaToken === "string" &&
      captchaToken.length > INCIDENT_FORM_CAPTCHA_TOKEN_MAX_LENGTH
    ) {
      throw new BadDataException(INCIDENT_FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE);
    }

    const request: PublicIncidentFormSubmissionRequest = {
      data: body["data"] as unknown as PublicIncidentFormSubmissionData,
    };

    if (typeof captchaToken === "string") {
      request.captchaToken = captchaToken;
    }

    return request;
  }
}
