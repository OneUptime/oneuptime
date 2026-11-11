import UserMiddleware from "../Middleware/UserAuthorization";
import WelcomeChecklistService, {
  WELCOME_CHECKLIST_SET_UP_PERMISSIONS,
  WelcomeChecklistCaller,
} from "../Services/WelcomeChecklistService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
  WELCOME_CHECKLIST_GOALS_ROUTE,
  WELCOME_CHECKLIST_HIDE_ROUTE,
  WELCOME_CHECKLIST_ROUTE,
  WELCOME_CHECKLIST_SHOW_ROUTE,
  WelcomeChecklistAnswer,
  toWelcomeChecklistAnswerJSON,
} from "../../Types/WelcomeChecklist/WelcomeChecklistAnswer";

/*
 * THE WELCOME CHECKLIST ON HOME, OVER HTTP (issue #6803). The routes and
 * their answer are described in Types/WelcomeChecklist/
 * WelcomeChecklistAnswer.ts; WelcomeChecklistService works the answer out.
 *
 * A bare router, as OnCallReadinessAPI is: the checklist is no model of its
 * own, and the service reads and writes as root, so the checks here are the
 * whole gate:
 *
 *   - every route needs a signed-in member of the project in the `tenantid`
 *     header (CommonAPI.assertAuthenticatedProjectMember): no session is a
 *     401, so an expired one refreshes and sends again;
 *   - choosing the goals needs a Project Owner or Admin (or a master
 *     admin), the people who set the project up;
 *   - hiding and showing change only the caller's own entry.
 *
 * Every route answers with the checklist as it now stands, so Home draws
 * the change without a second request.
 */
const router: ExpressRouter = Express.getRouter();

async function readCaller(req: ExpressRequest): Promise<WelcomeChecklistCaller> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return {
    projectId: projectId,
    userId: props.userId as ObjectID,
    props: props,
  };
}

async function sendAnswer(
  req: ExpressRequest,
  res: ExpressResponse,
  caller: WelcomeChecklistCaller,
): Promise<void> {
  const answer: WelcomeChecklistAnswer =
    await WelcomeChecklistService.getAnswer(caller);

  return Response.sendJsonObjectResponse(
    req,
    res,
    toWelcomeChecklistAnswerJSON(answer),
  );
}

function readBody(req: ExpressRequest): JSONObject {
  const body: unknown = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  return body as JSONObject;
}

// The checklist for the project and the caller.
router.get(
  WELCOME_CHECKLIST_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      return await sendAnswer(req, res, await readCaller(req));
    } catch (err) {
      next(err);
    }
  },
);

// Choose the project's goals, or skip the question with [].
router.post(
  WELCOME_CHECKLIST_GOALS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: WelcomeChecklistCaller = await readCaller(req);

      CommonAPI.assertPermittedInProject({
        databaseProps: caller.props,
        allowedPermissions: [...WELCOME_CHECKLIST_SET_UP_PERMISSIONS],
        errorMessage:
          "Only a Project Owner or Project Admin can choose what this project is for.",
      });

      const body: JSONObject = readBody(req);

      if (!Array.isArray(body["goals"])) {
        throw new BadDataException("goals is required and must be a list.");
      }

      await WelcomeChecklistService.chooseGoals(caller, body["goals"]);

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

// Hide the card for the caller.
router.post(
  WELCOME_CHECKLIST_HIDE_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: WelcomeChecklistCaller = await readCaller(req);

      await WelcomeChecklistService.setHiddenForCaller(caller, true);

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

// Show it again.
router.post(
  WELCOME_CHECKLIST_SHOW_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: WelcomeChecklistCaller = await readCaller(req);

      await WelcomeChecklistService.setHiddenForCaller(caller, false);

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

/*
 * What the caller's browser remembered of the checklist before this one:
 * { wasDismissed, wasFinished }, sent once, after which the browser forgets.
 */
router.post(
  WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: WelcomeChecklistCaller = await readCaller(req);
      const body: JSONObject = readBody(req);

      await WelcomeChecklistService.takeBrowserState(caller, {
        wasDismissed: body["wasDismissed"] === true,
        wasFinished: body["wasFinished"] === true,
      });

      return await sendAnswer(req, res, caller);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
