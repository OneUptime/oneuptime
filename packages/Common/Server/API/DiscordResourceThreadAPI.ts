import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ObjectID from "../../Types/ObjectID";
import WorkspaceOAuthState from "../Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../Utils/Workspace/WorkspaceActionAuthorization";
import DiscordResourceThreadService, {
  ThreadReconcileConflict,
} from "../Services/DiscordResourceThreadService";
import DiscordResourceThread from "../../Models/DatabaseModels/DiscordResourceThread";

/*
 * Explicit reconciliation for a Discord thread record whose remote outcome
 * is unknown or unusable (HOM-42). Kept out of DiscordAPI so the OAuth,
 * interaction and connection routes stay with their owner. Same actor rule
 * as connection management: a project owner, admin or member.
 */
export default class DiscordResourceThreadAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/discord/resource-thread/:id/reconcile",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);
          CommonAPI.assertPermittedInProject({
            databaseProps:
              await WorkspaceActionAuthorization.getProjectMemberProps({
                projectId,
                userId: databaseProps.userId!,
              }),
            allowedPermissions:
              WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
            errorMessage:
              "You do not have permission to manage this Discord connection.",
          });
          const rowId: string = String(req.params["id"] || "");
          if (!ObjectID.isValidUUID(rowId)) {
            throw new BadDataException("Invalid thread record id.");
          }
          const threadId: unknown = req.body?.threadId;
          const recreate: unknown = req.body?.recreate;
          if (threadId !== undefined && typeof threadId !== "string") {
            throw new BadDataException("threadId must be a string.");
          }
          if (recreate !== undefined && recreate !== true) {
            throw new BadDataException("recreate must be true when present.");
          }
          if (threadId && recreate) {
            throw new BadDataException(
              "Name a thread or ask for a recreate, not both.",
            );
          }
          const row: DiscordResourceThread =
            await DiscordResourceThreadService.reconcile({
              projectId,
              rowId: new ObjectID(rowId),
              threadId: threadId as string | undefined,
              recreate: recreate as boolean | undefined,
            });
          Response.sendJsonObjectResponse(req, res, {
            _id: row.id?.toString() || rowId,
            state: row.state || "",
            threadId: row.threadId || null,
          });
        } catch (error) {
          if (error instanceof ThreadReconcileConflict) {
            Response.sendCustomResponse(
              req,
              res,
              409,
              { message: error.message },
              {},
            );
            return;
          }
          Response.sendErrorResponse(req, res, error as Exception);
        }
      },
    );

    return router;
  }
}
