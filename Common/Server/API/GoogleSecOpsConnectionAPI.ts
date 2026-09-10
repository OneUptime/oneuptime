import GoogleSecOpsConnection from "../../Models/DatabaseModels/GoogleSecOpsConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import GoogleSecOpsConnectionService, {
  Service as GoogleSecOpsConnectionServiceType,
} from "../Services/GoogleSecOpsConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import GoogleSecOpsRunExecutor from "../Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsRunExecutor";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

export default class GoogleSecOpsConnectionAPI extends BaseAPI<
  GoogleSecOpsConnection,
  GoogleSecOpsConnectionServiceType
> {
  public constructor() {
    super(GoogleSecOpsConnection, GoogleSecOpsConnectionService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:connectionId/run`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions:
              new GoogleSecOpsConnection().getUpdatePermissions(),
            errorMessage:
              "Project owners, project administrators, and security administrators can run connection diagnostics.",
          });

          const connectionId: string | undefined = req.params["connectionId"];
          if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
            throw new BadDataException("A valid connection ID is required.");
          }

          /*
           * Authorize against the caller's tenant before any root read or work
           * is queued. Credentials are only read by the worker.
           */
          const connection: GoogleSecOpsConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          const runId: ObjectID = await GoogleSecOpsRunExecutor.enqueue({
            projectId,
            connectionId: new ObjectID(connectionId),
            options: GoogleSecOpsRunExecutor.validateOptions(req.body),
            requestedByUserId: props.userId,
          });
          return Response.sendJsonObjectResponse(req, res, {
            runId: runId.toString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
