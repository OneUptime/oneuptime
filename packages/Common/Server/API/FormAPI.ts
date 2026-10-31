import FormRateLimit, {
  FormRateLimitBucket,
  FormRateLimitFormSource,
} from "../Middleware/FormRateLimit";
import UserMiddleware from "../Middleware/UserAuthorization";
import FormDomainService from "../Services/FormDomainService";
import FormService, {
  Service as FormServiceType,
} from "../Services/FormService";
import { resolveClientIp } from "../Utils/ClientIp";
import { getRequestHost } from "../Utils/RequestHost";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SameOriginRequest from "../Utils/SameOriginRequest";
import BaseAPI from "./BaseAPI";
import Form from "../../Models/DatabaseModels/Form";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import {
  FORM_PAGE_HEADER,
  FORM_PAGE_HEADER_VALUE,
  PublicForm,
  PublicFormSubmissionData,
  PublicFormSubmissionRequest,
  PublicFormSubmissionResult,
} from "../../Types/Form/FormPublic";
import { JSONObject } from "../../Types/JSON";
import {
  FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE,
  FORM_CUSTOM_DOMAIN_ROUTE,
  FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE,
} from "../../Types/Form/FormCustomDomain";

/*
 * The form's CRUD routes (inherited from BaseAPI, all behind the signed-in
 * user middleware) plus the two routes the public form page calls, for
 * anyone holding a form's link:
 *
 *   GET  /form/public/:shareKey          the form's questions
 *   POST /form/public/:shareKey/submit   create from the answers
 *
 * and their twins for a form on its own domain (FormDomain), which the page
 * on that domain calls on that domain, naming no key - the form is the one
 * the domain answers with, found by the request's Host:
 *
 *   GET  /form/custom-domain             the form's questions
 *   POST /form/custom-domain/submit      create from the answers
 *   GET  /form/custom-domain/cname-verification/:token
 *                                        the CNAME sweeps' check that the
 *                                        domain reaches this installation
 *
 * The two custom domain routes the page calls run the same steps as the
 * link's, in the same order, with one difference in the first:
 * refuseForeignPageRequestsOnCustomDomain holds the request to the domain's
 * own origin - the page is served there, not on this instance's own - and
 * the counters key the form by its domain (FormRateLimitFormSource). The
 * form itself is then read through its key, so every check after that is
 * the link's, word for word (FormService.getPublicFormOnCustomDomain).
 *
 * Neither can be mistaken for a CRUD route: those are /form, /form/get-list,
 * /form/count and /form/:id with or without /get-item, /update-item or
 * /delete-item, and a share key is a UUID, never "get-item". The CRUD routes
 * are registered first (in BaseAPI's constructor), so even a key spelled
 * like one of their suffixes lands on a CRUD route and its authentication,
 * never the other way round.
 *
 * Each public route runs, in order:
 *
 *  1. refuseForeignPageRequests: a request a browser sent from a page that
 *     is not this instance's own is refused, 403, before it costs or spends
 *     anything. These routes are anonymous and trust where a request comes
 *     from - the form's IP allowlist, the per-address counters - so without
 *     this any website could have its visitors' browsers read a form or
 *     submit it from inside an allowed network, or use up those visitors'
 *     shared budgets. It can only go by the two headers in which a browser
 *     says where a request came from, and a browser does not always send
 *     them, so each route then asks for something only the form's page
 *     sends. The read route requires the page's own header
 *     (requireFormPageHeader, the same 403): over plain HTTP another site's
 *     <img> or link sends its GET with neither header, and it cannot add
 *     one. The submit route requires a JSON body (requireJsonBody, 400): the
 *     one kind another site cannot have a browser send without a preflight,
 *     which carries the Origin the first check reads.
 *
 *  2. FormRateLimit's per-address counters, before anything else costs
 *     anything. Reading a form is load control and fails open; submitting
 *     one creates an incident or an event, so its counters fail closed. (The
 *     form's own hourly ceiling is spent later, by FormService, only for a
 *     submission that passed every check; its 429 carries a Retry-After this
 *     route writes.)
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
 *     the answers - to FormService, where it is unit-testable.
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

export const FORM_SUBMISSION_BODY_MESSAGE: string =
  'The request must be a JSON object holding the form\'s answers in "data".';

/*
 * The one answer to a request another page had a browser send, whatever the
 * form and whether it exists: the refusal comes before the link is looked
 * at, so it tells that page nothing.
 */
export const FORM_FOREIGN_PAGE_MESSAGE: string =
  "This form can only be used from its own page.";

export const FORM_CAPTCHA_TOKEN_MESSAGE: string =
  "captchaToken must be a string.";

/*
 * Far past any token hCaptcha hands out (a few thousand characters), and
 * small enough that a stranger cannot have the server forward megabytes of
 * "token" to hCaptcha on the form's behalf.
 */
export const FORM_CAPTCHA_TOKEN_MAX_LENGTH: number = 16384;

export const FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE: string = `captchaToken cannot be more than ${FORM_CAPTCHA_TOKEN_MAX_LENGTH} characters.`;

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

// The answer to a token or a name that is not a form domain's.
export const FORM_CUSTOM_DOMAIN_TOKEN_MESSAGE: string = "Invalid token.";

export default class FormAPI extends BaseAPI<Form, FormServiceType> {
  public constructor() {
    super(Form, FormService);

    const readRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = FormRateLimit.getMiddleware(FormRateLimitBucket.Read);

    const submitRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = FormRateLimit.getMiddleware(
      FormRateLimitBucket.Submit,
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/public/:shareKey`,
      FormAPI.refuseForeignPageRequests,
      FormAPI.requireFormPageHeader,
      readRateLimit,
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          /*
           * First, so a refusal is not cached either: a form turned back on
           * must not stay "not available" in a proxy.
           */
          Response.setNoCacheHeaders(res);

          const form: PublicForm = await FormService.getPublicForm({
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
      FormAPI.refuseForeignPageRequests,
      FormAPI.requireJsonBody,
      submitRateLimit,
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const request: PublicFormSubmissionRequest =
            FormAPI.readSubmissionRequest(req.body);

          /*
           * The trusted end of X-Forwarded-For, for the form's IP allowlist
           * and for hCaptcha alike: never an address the caller wrote.
           */
          const clientIp: string | undefined = resolveClientIp(req);

          const result: PublicFormSubmissionResult =
            await FormService.submitPublicForm({
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
          FormRateLimit.setRetryAfterFor(res, err);
          next(err);
        }
      },
    );

    this.registerCustomDomainRoutes();
  }

  /*
   * The routes a form's page calls on its own domain (see the top of this
   * file), and the CNAME check the form domain sweeps make there.
   */
  private registerCustomDomainRoutes(): void {
    const crudApiPath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.get(
      `${crudApiPath}${FORM_CUSTOM_DOMAIN_ROUTE}`,
      FormAPI.refuseForeignPageRequestsOnCustomDomain,
      FormAPI.requireFormPageHeader,
      FormRateLimit.getMiddleware(
        FormRateLimitBucket.Read,
        FormRateLimitFormSource.CustomDomain,
      ),
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const form: PublicForm =
            await FormService.getPublicFormOnCustomDomain({
              hostname: getRequestHost(req),
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
      `${crudApiPath}${FORM_CUSTOM_DOMAIN_SUBMIT_ROUTE}`,
      FormAPI.refuseForeignPageRequestsOnCustomDomain,
      FormAPI.requireJsonBody,
      FormRateLimit.getMiddleware(
        FormRateLimitBucket.Submit,
        FormRateLimitFormSource.CustomDomain,
      ),
      UserMiddleware.getPublicRouteUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const request: PublicFormSubmissionRequest =
            FormAPI.readSubmissionRequest(req.body);

          const clientIp: string | undefined = resolveClientIp(req);

          const result: PublicFormSubmissionResult =
            await FormService.submitPublicFormOnCustomDomain({
              hostname: getRequestHost(req),
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
          FormRateLimit.setRetryAfterFor(res, err);
          next(err);
        }
      },
    );

    /*
     * The form domain sweeps' check that a domain reaches this installation
     * (FormDomainService.isCnameValid): 200 only when the request came to
     * the form domain whose token it names, so a token proves the name, and
     * a name proves nothing without its token. Read-only and anonymous, as
     * a status page domain's twin route is; the sweeps send no page headers.
     */
    this.router.get(
      `${crudApiPath}${FORM_CUSTOM_DOMAIN_CNAME_VERIFICATION_ROUTE}/:token`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          Response.setNoCacheHeaders(res);

          const isOwnToken: boolean =
            await FormDomainService.isVerificationTokenOfDomain({
              hostname: getRequestHost(req),
              token: req.params["token"],
            });

          if (!isOwnToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(FORM_CUSTOM_DOMAIN_TOKEN_MESSAGE),
            );
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * First on the two routes a form's page calls on its own domain, as
   * refuseForeignPageRequests is on the link's: a request a browser sent
   * from a page that is not the domain's own is refused, 403, before it
   * costs or spends anything. The page is served on the domain, so its
   * origin is the domain's, not this instance's: SameOriginRequest's
   * isForeignPageRequestToHost compares a request's Origin with the host
   * the request was sent to. Which form the domain answers with is not
   * looked up yet, so the refusal says nothing about it.
   */
  public static refuseForeignPageRequestsOnCustomDomain(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (
      SameOriginRequest.isForeignPageRequestToHost({
        headers: req.headers,
        hostname: getRequestHost(req),
      })
    ) {
      Response.setNoCacheHeaders(res);

      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(FORM_FOREIGN_PAGE_MESSAGE),
      );
    }

    return next();
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
        new ForbiddenException(FORM_FOREIGN_PAGE_MESSAGE),
      );
    }

    return next();
  }

  /*
   * Second on the read route, still before the limiter: the request must
   * carry the header the form's page adds to every request it makes
   * (FORM_PAGE_HEADER). Over plain HTTP a browser sends another
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
        name: FORM_PAGE_HEADER,
        value: FORM_PAGE_HEADER_VALUE,
      })
    ) {
      Response.setNoCacheHeaders(res);

      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(FORM_FOREIGN_PAGE_MESSAGE),
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
        new BadDataException(FORM_SUBMISSION_BODY_MESSAGE),
      );
    }

    return next();
  }

  /*
   * The shape of the submit body, checked before anything reaches the
   * service: an object with the answers in `data` and, optionally, the
   * captcha token as text of a sane length. What the answers themselves
   * hold is the service's to judge (validateFormSubmission); every
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
  ): PublicFormSubmissionRequest {
    if (!isPlainObject(body) || !isPlainObject(body["data"])) {
      throw new BadDataException(FORM_SUBMISSION_BODY_MESSAGE);
    }

    const captchaToken: unknown = body["captchaToken"];

    if (
      captchaToken !== undefined &&
      captchaToken !== null &&
      typeof captchaToken !== "string"
    ) {
      throw new BadDataException(FORM_CAPTCHA_TOKEN_MESSAGE);
    }

    if (
      typeof captchaToken === "string" &&
      captchaToken.length > FORM_CAPTCHA_TOKEN_MAX_LENGTH
    ) {
      throw new BadDataException(FORM_CAPTCHA_TOKEN_TOO_LONG_MESSAGE);
    }

    const request: PublicFormSubmissionRequest = {
      data: body["data"] as unknown as PublicFormSubmissionData,
    };

    if (typeof captchaToken === "string") {
      request.captchaToken = captchaToken;
    }

    return request;
  }
}
