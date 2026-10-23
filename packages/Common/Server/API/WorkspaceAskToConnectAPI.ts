import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import WorkspaceAskToConnect, {
  WORKSPACE_ASK_TO_CONNECT_PERMISSION_MESSAGE,
  WORKSPACE_ASK_TO_CONNECT_PERMISSIONS,
} from "../Utils/Workspace/WorkspaceAskToConnect";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceAskToConnectUtil, {
  WORKSPACE_ASK_TO_CONNECT_ROUTE,
  WorkspaceAskToConnectStatus,
} from "../../Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

/*
 * ASKING EVERY MEMBER TO CONNECT THEIR SLACK OR MICROSOFT TEAMS ACCOUNT
 * (WorkspaceAskToConnect).
 *
 * GET /workspace-ask-to-connect/<Slack | MicrosoftTeams>
 *   How many members the project has, how many have connected their account
 *   in the workspace, and how the last ask went: { memberCount,
 *   connectedCount, run }.
 *
 * POST /workspace-ask-to-connect/<Slack | MicrosoftTeams>
 *   Asks everybody who has not connected - and was not asked in the last
 *   day - by direct message, and answers at once with the same shape, the
 *   run asking. The page reads GET until the run is done.
 *
 * Both for a signed-in project owner or admin: a message to every member is
 * theirs to send, as uninstalling the app is.
 */
const router: ExpressRouter = Express.getRouter();

// The workspace in the path, checked before anything is read.
const readWorkspaceType: (req: ExpressRequest) => WorkspaceType = (
  req: ExpressRequest,
): WorkspaceType => {
  const workspaceType: unknown = req.params["workspaceType"];

  if (!WorkspaceAskToConnectUtil.isWorkspaceType(workspaceType)) {
    throw new BadDataException(
      `Unknown workspace. Use one of: ${WorkspaceType.Slack}, ${WorkspaceType.MicrosoftTeams}.`,
    );
  }

  return workspaceType;
};

// The project and the asking member, once they may ask.
const readCaller: (req: ExpressRequest) => Promise<{
  projectId: ObjectID;
  userId: ObjectID;
}> = async (
  req: ExpressRequest,
): Promise<{ projectId: ObjectID; userId: ObjectID }> => {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  CommonAPI.assertPermittedInProject({
    databaseProps: props,
    allowedPermissions: WORKSPACE_ASK_TO_CONNECT_PERMISSIONS,
    errorMessage: WORKSPACE_ASK_TO_CONNECT_PERMISSION_MESSAGE,
  });

  return { projectId: projectId, userId: props.userId! };
};

router.get(
  `${WORKSPACE_ASK_TO_CONNECT_ROUTE}/:workspaceType`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const workspaceType: WorkspaceType = readWorkspaceType(req);
      const caller: { projectId: ObjectID } = await readCaller(req);

      const status: WorkspaceAskToConnectStatus =
        await WorkspaceAskToConnect.getStatus({
          projectId: caller.projectId,
          workspaceType: workspaceType,
        });

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        WorkspaceAskToConnectUtil.statusToJSON(status),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  `${WORKSPACE_ASK_TO_CONNECT_ROUTE}/:workspaceType`,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const workspaceType: WorkspaceType = readWorkspaceType(req);
      const caller: { projectId: ObjectID; userId: ObjectID } =
        await readCaller(req);

      const status: WorkspaceAskToConnectStatus =
        await WorkspaceAskToConnect.start({
          projectId: caller.projectId,
          workspaceType: workspaceType,
          askedByUserId: caller.userId,
        });

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(
        req,
        res,
        WorkspaceAskToConnectUtil.statusToJSON(status),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
