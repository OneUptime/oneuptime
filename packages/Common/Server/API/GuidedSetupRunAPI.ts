import UserMiddleware from "../Middleware/UserAuthorization";
import GuidedSetupRunService, {
  GuidedSetupRunCaller,
} from "../Services/GuidedSetupRunService";
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
import {
  GUIDED_SETUP_RUN_ROUTE,
  GuidedSetupRunChange,
  GuidedSetupRunState,
  isGuidedSetupKey,
  parseGuidedSetupRunChange,
  toGuidedSetupRunAnswerJSON,
} from "../../Types/GuidedSetup/GuidedSetupRun";
import ObjectID from "../../Types/ObjectID";

/*
 * A GUIDED SETUP'S RUN, OVER HTTP (#7253). The routes and their answer are
 * described in Types/GuidedSetup/GuidedSetupRun.ts; GuidedSetupRunService
 * reads and writes the run.
 *
 * A bare router, as WelcomeChecklistAPI is: a run is no model with an API of
 * its own, and the service reads and writes as root, so the checks here are
 * the whole gate:
 *
 *   - every route needs a signed-in member of the project in the `tenantid`
 *     header (CommonAPI.assertAuthenticatedProjectMember): no session is a
 *     401, so an expired one refreshes and sends again, and somebody who has
 *     left the project reads and writes no run of it;
 *   - no route takes a person: each serves the caller's own run, so nobody
 *     reads or changes anybody else's;
 *   - the setup is one that keeps a run, or the route answers 400.
 *
 * Every route answers with the run as it now stands.
 */
const router: ExpressRouter = Express.getRouter();

async function readCaller(req: ExpressRequest): Promise<GuidedSetupRunCaller> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);
  const setup: unknown = req.params["setup"];

  if (!isGuidedSetupKey(setup)) {
    throw new BadDataException(
      "There is no guided setup by that name. Open the setup from Home or its product's page.",
    );
  }

  return {
    projectId: projectId,
    userId: props.userId as ObjectID,
    setup: setup,
  };
}

function sendRun(
  req: ExpressRequest,
  res: ExpressResponse,
  caller: GuidedSetupRunCaller,
  run: GuidedSetupRunState | null,
): void {
  return Response.sendJsonObjectResponse(
    req,
    res,
    toGuidedSetupRunAnswerJSON({ setup: caller.setup, run: run }),
  );
}

// The caller's run for the setup, or null.
router.get(
  `${GUIDED_SETUP_RUN_ROUTE}/:setup`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: GuidedSetupRunCaller = await readCaller(req);

      return sendRun(
        req,
        res,
        caller,
        await GuidedSetupRunService.getRun(caller),
      );
    } catch (err) {
      next(err);
    }
  },
);

// A change to the caller's run: { values, resources }, merged name by name.
router.post(
  `${GUIDED_SETUP_RUN_ROUTE}/:setup`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: GuidedSetupRunCaller = await readCaller(req);
      const change: GuidedSetupRunChange = parseGuidedSetupRunChange(req.body);

      return sendRun(
        req,
        res,
        caller,
        await GuidedSetupRunService.changeRun(caller, change),
      );
    } catch (err) {
      next(err);
    }
  },
);

// Start afresh: the caller's run is deleted.
router.post(
  `${GUIDED_SETUP_RUN_ROUTE}/:setup/forget`,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const caller: GuidedSetupRunCaller = await readCaller(req);

      await GuidedSetupRunService.forgetRun(caller);

      return sendRun(req, res, caller, null);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
