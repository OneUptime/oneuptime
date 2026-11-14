import UserMiddleware from "../Middleware/UserAuthorization";
import SampleProjectService from "../Services/SampleProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SAMPLE_PROJECT_CREATE_ROUTE,
  SAMPLE_PROJECT_DELETE_ROUTE,
  SampleProjectCreateAnswer,
} from "../../Types/SampleProject/SampleProject";

/*
 * A PERSON'S SAMPLE PROJECT, OVER HTTP (issue #6808). The routes are
 * described in Types/SampleProject/SampleProject.ts; SampleProjectService
 * makes and deletes the sample.
 *
 * A bare router, as WelcomeChecklistAPI is: a sample is made as OneUptime
 * (root), so the checks here are the gate:
 *
 *   - making one needs a signed-in person, and no project: it is made for
 *     them, whichever project they are in (or none, on the "No projects"
 *     page). The service decides whether this server lets them;
 *   - deleting one needs a signed-in member of the sample in the
 *     `tenantid` header, and is done as them: only someone who may delete
 *     the project (its owner) can, and only a sample is deleted here.
 */
const router: ExpressRouter = Express.getRouter();

// Makes the person's sample, or finds the one they have, and answers its id.
router.post(
  SAMPLE_PROJECT_CREATE_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const userId: ObjectID = CommonAPI.assertAuthenticatedUser(
        props,
        "Sign in to explore the sample project.",
      );

      const answer: SampleProjectCreateAnswer =
        await SampleProjectService.createForUser({ userId: userId });

      return Response.sendJsonObjectResponse(
        req,
        res,
        answer as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

// Deletes the sample the request is for.
router.post(
  SAMPLE_PROJECT_DELETE_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      await SampleProjectService.deleteSample({
        projectId: projectId,
        props: props,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
