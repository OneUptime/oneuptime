import UserMiddleware from "../Middleware/UserAuthorization";
import WorkflowVariableService, {
  Service as WorkflowVariableServiceType,
} from "../Services/WorkflowVariableService";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import WorkflowVariableOAuthToken, {
  WorkflowVariableAccessToken,
} from "../Utils/Workflow/WorkflowVariableOAuthToken";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import WorkflowVariable from "../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ObjectID from "../../Types/ObjectID";
import { isOAuth2WorkflowVariable } from "../../Types/Workflow/WorkflowVariableOAuth";

/*
 * ------------------------------------------------------------------
 * WorkflowVariableAPI
 *
 *   POST /workflow-variable/:id/refresh-oauth-token
 *
 * "Refresh now" for an OAuth 2.0 workflow variable: fetch a new access
 * token from the identity provider now, whether or not the cached one has
 * expired. It is how somebody checks new settings without running a
 * workflow, and how they recover after fixing whatever made the last refresh
 * fail.
 *
 * The answer says when the new token expires and never contains it. The
 * access token is as unreadable through the API as a variable's content is;
 * this endpoint must not become a way around that.
 *
 * A refresh writes to the variable (the token, and a rotated refresh token),
 * so it needs the same update permission as editing the variable. Access is
 * checked in two steps, like the Data Source test route: the row is read
 * with the caller's own permissions first - another project's id, or one the
 * caller may not read, answers exactly like an id that does not exist - and
 * only then is the update permission checked and the credentials read as
 * root.
 * ------------------------------------------------------------------
 */

const NOT_FOUND_MESSAGE: string =
  "Workflow variable not found, or you do not have access to it.";

function readVariableId(req: ExpressRequest): ObjectID {
  const id: string | undefined = req.params["id"];

  /*
   * ObjectID's constructor takes any string, so a malformed id would
   * otherwise reach Postgres and come back as a syntax error, not a 400.
   */
  if (!id || !ObjectID.isValidUUID(id)) {
    throw new BadDataException(NOT_FOUND_MESSAGE);
  }

  return new ObjectID(id);
}

export default class WorkflowVariableAPI extends BaseAPI<
  WorkflowVariable,
  WorkflowVariableServiceType
> {
  public constructor() {
    super(WorkflowVariable, WorkflowVariableService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/:id/refresh-oauth-token`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const variableId: ObjectID = readVariableId(req);

          const variable: WorkflowVariable | null =
            await WorkflowVariableService.findOneById({
              id: variableId,
              select: {
                _id: true,
                name: true,
                variableType: true,
              },
              props: props,
            });

          if (!variable) {
            throw new BadDataException(NOT_FOUND_MESSAGE);
          }

          await ModelPermission.checkUpdateQueryPermissions(
            WorkflowVariable,
            { _id: variableId.toString() } as Query<WorkflowVariable>,
            {},
            props,
          );

          if (!isOAuth2WorkflowVariable(variable.variableType)) {
            throw new BadDataException(
              `"${variable.name || "This variable"}" is not an OAuth 2.0 variable, so it has no access token to refresh.`,
            );
          }

          let token: WorkflowVariableAccessToken;

          try {
            token = await WorkflowVariableOAuthToken.getAccessToken({
              variableId: variableId,
              forceRefresh: true,
            });
          } catch (err) {
            /*
             * The identity provider's answer is the useful part - it is what
             * the person has to fix - so it goes back as the error message.
             * WorkflowVariableOAuthToken has already written it to the
             * variable, where the table shows it.
             */
            return Response.sendErrorResponse(
              req,
              res,
              err instanceof Exception
                ? err
                : new BadDataException(
                    "Could not refresh the access token. Try again in a few minutes.",
                  ),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            oauthAccessTokenExpiresAt: token.expiresAt
              ? token.expiresAt.toISOString()
              : null,
            oauthLastRefreshedAt: token.refreshedAt
              ? token.refreshedAt.toISOString()
              : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
