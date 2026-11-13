import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProductFeedbackService from "../Services/ProductFeedbackService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import ProductFeedbackRateLimit from "../Utils/ProductFeedbackRateLimit";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  FeedbackQuestionDecision,
  PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
  PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
  PRODUCT_FEEDBACK_ASK_ROUTE,
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  PRODUCT_FEEDBACK_LIST_MAX_PAGE_SIZE,
  PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
  PRODUCT_FEEDBACK_ROUTE,
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
  ProductFeedbackKind,
  ProductFeedbackSettings,
  ProductFeedbackSubmission,
  isProductFeedbackKind,
  readFeedbackQuestionKey,
  readProductFeedbackSubmission,
  toFeedbackDetails,
} from "../../Types/ProductFeedback/ProductFeedback";

/*
 * ASKING PEOPLE, OVER HTTP (issue #6832). The rules are in Types/
 * ProductFeedback/ProductFeedback; ProductFeedbackService keeps the
 * answers on this server.
 *
 * A bare router, as WelcomeChecklistAPI is: ProductFeedback has no CRUD
 * API, and the service reads and writes as root, so the checks here are
 * the whole gate.
 *
 * For a signed-in person (no session is a 401, so an expired one refreshes
 * and sends again):
 *
 *   GET  /product-feedback/settings  whether this server asks, and whether
 *                                    it asks me
 *   POST /product-feedback/ask       { question }: may I ask this now?
 *                                    { ask, reason }. A yes is written down
 *                                    as asked. The project in `tenantid`,
 *                                    when the person is its member, is
 *                                    checked for an open incident or alert.
 *   POST /product-feedback           an answer: { kind, topic, score,
 *                                    isPositive, details, page, version } -
 *                                    only these are read; { answerId }
 *   POST /product-feedback/details   { answerId, details }: the words written
 *                                    after a one-click answer; { added }
 *
 * The two that keep an answer refuse while a master admin has switched
 * feedback off for the server, and take at most
 * PRODUCT_FEEDBACK_ANSWERS_PER_HOUR answers an hour from one person.
 *
 * For master admins only (Admin Dashboard > Feedback):
 *
 *   GET  /product-feedback/admin/summary  the last 90 days by question, and
 *                                         Ask AI's thumbs
 *   GET  /product-feedback/admin/list     ?kind=&skip=&limit=: the answers,
 *                                         newest first
 */
const router: ExpressRouter = Express.getRouter();

export const PRODUCT_FEEDBACK_OFF_MESSAGE: string =
  "Feedback is turned off on this server. Ask your server's admin to turn it on in the Admin Dashboard, under Feedback.";

export const PRODUCT_FEEDBACK_TOO_MANY_MESSAGE: string =
  "You have sent a lot of feedback in the last hour. Thank you - please wait a while, then send it again.";

const readBody: (req: ExpressRequest) => JSONObject = (
  req: ExpressRequest,
): JSONObject => {
  const body: unknown = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  return body as JSONObject;
};

const readQueryString: (req: ExpressRequest, name: string) => string = (
  req: ExpressRequest,
  name: string,
): string => {
  const value: unknown = (req.query as Record<string, unknown>)[name];

  return typeof value === "string" ? value : "";
};

const WHOLE_NUMBER: RegExp = /^\d+$/;

const readWholeNumber: (
  req: ExpressRequest,
  name: string,
  fallback: number,
) => number = (req: ExpressRequest, name: string, fallback: number): number => {
  const raw: string = readQueryString(req, name);

  if (!raw) {
    return fallback;
  }

  if (!WHOLE_NUMBER.test(raw)) {
    throw new BadDataException(
      `Set ${name} to a whole number of 0 or more, then load the list again.`,
    );
  }

  return Number(raw);
};

// The signed-in person asking.
const readUserId: (req: ExpressRequest) => Promise<{
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}> = async (
  req: ExpressRequest,
): Promise<{ userId: ObjectID; props: DatabaseCommonInteractionProps }> => {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const userId: ObjectID = CommonAPI.assertAuthenticatedUser(
    props,
    "Sign in to OneUptime as yourself to give feedback: an API key cannot.",
  );

  return { userId, props };
};

/*
 * The project in `tenantid` when the person is its member: its incidents
 * and alerts are checked before a question is asked. Anything else asks
 * about no project.
 */
const readMemberProjectId: (
  props: DatabaseCommonInteractionProps,
) => ObjectID | null = (
  props: DatabaseCommonInteractionProps,
): ObjectID | null => {
  const projectId: ObjectID | undefined = props.tenantId;

  if (
    !projectId ||
    !props.userTenantAccessPermission ||
    !props.userTenantAccessPermission[projectId.toString()]
  ) {
    return null;
  }

  return projectId;
};

// An answer is kept only while the server asks, and not too many from one person.
const assertMayAnswer: (userId: ObjectID) => Promise<void> = async (
  userId: ObjectID,
): Promise<void> => {
  if (!(await ProductFeedbackService.isServerOn())) {
    throw new NotAuthorizedException(PRODUCT_FEEDBACK_OFF_MESSAGE);
  }

  if (!ProductFeedbackRateLimit.take(userId.toString(), Date.now())) {
    throw new BadDataException(PRODUCT_FEEDBACK_TOO_MANY_MESSAGE);
  }
};

router.get(
  PRODUCT_FEEDBACK_SETTINGS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = await readUserId(req);

      const settings: ProductFeedbackSettings =
        await ProductFeedbackService.getSettings(userId);

      return Response.sendJsonObjectResponse(req, res, {
        isOn: settings.isOn,
        isAskingMe: settings.isAskingMe,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  PRODUCT_FEEDBACK_ASK_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId, props } = await readUserId(req);
      const key: string | null = readFeedbackQuestionKey(
        readBody(req)["question"],
      );

      if (!key) {
        throw new BadDataException(
          "Name the question as setup_flow:<setup> or check_in:<project>, then ask again.",
        );
      }

      const decision: FeedbackQuestionDecision =
        await ProductFeedbackService.ask({
          userId: userId,
          projectId: readMemberProjectId(props),
          key: key,
          now: new Date(),
        });

      return Response.sendJsonObjectResponse(req, res, {
        ask: decision === FeedbackQuestionDecision.Ask,
        reason: decision,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  PRODUCT_FEEDBACK_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = await readUserId(req);

      const submission: ProductFeedbackSubmission | string =
        readProductFeedbackSubmission(readBody(req));

      if (typeof submission === "string") {
        throw new BadDataException(submission);
      }

      await assertMayAnswer(userId);

      const answerId: ObjectID =
        await ProductFeedbackService.submit(submission);

      return Response.sendJsonObjectResponse(req, res, {
        answerId: answerId.toString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  PRODUCT_FEEDBACK_DETAILS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = await readUserId(req);
      const body: JSONObject = readBody(req);
      const answerId: unknown = body["answerId"];
      const details: string | null = toFeedbackDetails(body["details"]);

      if (typeof answerId !== "string" || !ObjectID.isValidUUID(answerId)) {
        throw new BadDataException(
          "Send the answerId the answer came back with, then send the words again.",
        );
      }

      if (!details) {
        throw new BadDataException(
          "Write what got in the way, then send it again.",
        );
      }

      await assertMayAnswer(userId);

      const added: boolean = await ProductFeedbackService.addDetails({
        answerId: new ObjectID(answerId),
        details: details,
        now: new Date(),
      });

      return Response.sendJsonObjectResponse(req, res, { added: added });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE,
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      return Response.sendJsonObjectResponse(
        req,
        res,
        (await ProductFeedbackService.getAdminSummary(
          new Date(),
        )) as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE,
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const kind: string = readQueryString(req, "kind");

      if (kind && !isProductFeedbackKind(kind)) {
        throw new BadDataException(
          "Set kind to setup_flow, general, explanation or check_in, or leave it out for every kind, then load the list again.",
        );
      }

      const limit: number = Math.min(
        Math.max(
          readWholeNumber(req, "limit", PRODUCT_FEEDBACK_LIST_PAGE_SIZE),
          1,
        ),
        PRODUCT_FEEDBACK_LIST_MAX_PAGE_SIZE,
      );

      return Response.sendJsonObjectResponse(
        req,
        res,
        (await ProductFeedbackService.getAdminList({
          kind: kind ? (kind as ProductFeedbackKind) : null,
          skip: readWholeNumber(req, "skip", 0),
          limit: limit,
        })) as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
