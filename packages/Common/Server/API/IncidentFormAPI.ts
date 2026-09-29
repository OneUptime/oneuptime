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
import BaseAPI from "./BaseAPI";
import IncidentForm from "../../Models/DatabaseModels/IncidentForm";
import BadDataException from "../../Types/Exception/BadDataException";
import {
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
 *  1. IncidentFormRateLimit, before anything else costs anything. Reading a
 *     form is load control and fails open; submitting one declares an
 *     incident, so its counter fails closed.
 *
 *  2. UserMiddleware.getPublicRouteUserMiddleware, the anonymous variant: an
 *     access-token cookie that no longer decodes makes the request anonymous
 *     instead of answering 401. The page is served on the same host as the
 *     dashboard, so a visitor's own OneUptime session cookie rides along -
 *     often expired - and a 401 would send the dashboard client to the login
 *     page, or sign the visitor out of their real session. Nothing here
 *     answers 401 (or 405), and the handlers never read who is calling:
 *     forms are anonymous, and a signed-in visitor is just a visitor.
 *
 *  3. The handler, which checks the body's shape and hands everything else -
 *     the link, the form's switch, the plan, the IP allowlist, the captcha,
 *     the answers - to IncidentFormService, where it is unit-testable.
 *
 * What the page must handle: 200, 400 (bad answers or captcha, with a
 * message to show), 403 (network not allowed), 404 (one message for every
 * unavailable form), 429 with Retry-After, 500 and 503.
 */

export const INCIDENT_FORM_SUBMISSION_BODY_MESSAGE: string =
  'The request must be a JSON object holding the form\'s answers in "data".';

export const INCIDENT_FORM_CAPTCHA_TOKEN_MESSAGE: string =
  "captchaToken must be a string.";

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
          next(err);
        }
      },
    );
  }

  /*
   * The shape of the submit body, checked before anything reaches the
   * service: an object with the answers in `data` and, optionally, the
   * captcha token as text. What the answers themselves hold is the service's
   * to judge (validateIncidentFormSubmission); every other key in the body
   * is left behind here, so it cannot reach anything.
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

    const request: PublicIncidentFormSubmissionRequest = {
      data: body["data"] as unknown as PublicIncidentFormSubmissionData,
    };

    if (typeof captchaToken === "string") {
      request.captchaToken = captchaToken;
    }

    return request;
  }
}
