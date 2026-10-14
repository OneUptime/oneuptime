import UserMiddleware from "../Middleware/UserAuthorization";
import WorkspaceUserGroupService, {
  Service as WorkspaceUserGroupServiceType,
} from "../Services/WorkspaceUserGroupService";
import BillingPermissions from "../Types/Database/Permissions/BillingPermission";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import WorkspaceUserGroupManager from "../Utils/Workspace/UserGroups/WorkspaceUserGroupManager";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import WorkspaceUserGroup from "../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupConnectRequest,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

/*
 * On-call user groups (WorkspaceUserGroup) through the API: the CRUD routes
 * every model has, and what the on-call schedule page's card asks
 * (WorkspaceUserGroupManager):
 *
 *   GET  /workspace-user-group/schedule/:scheduleId   the groups following it
 *   GET  /workspace-user-group/available               the Connect form's list
 *   POST /workspace-user-group/connect                 connect one
 *   POST /workspace-user-group/disconnect              disconnect one
 *   POST /workspace-user-group/sync/:workspaceUserGroupId   Try again
 *
 * Each asks for a signed-in member of the project or one of its API keys,
 * reads and writes with the caller's own permissions in that one project,
 * and answers a schedule or group they may not read like one that is not
 * there. Connecting, disconnecting and Try again change a group in Slack or
 * Microsoft Teams, so they ask what changing the record asks: its create
 * permission and its plan.
 */
export const USER_GROUP_PERMISSION_MESSAGE: string =
  "You do not have permission to change the user groups of this project's on-call schedules.";

export default class WorkspaceUserGroupAPI extends BaseAPI<
  WorkspaceUserGroup,
  WorkspaceUserGroupServiceType
> {
  public constructor() {
    super(WorkspaceUserGroup, WorkspaceUserGroupService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.get(
      `${path}/schedule/:scheduleId`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: {
            props: DatabaseCommonInteractionProps;
            projectId: ObjectID;
          } = await WorkspaceUserGroupAPI.getCaller(req);

          const views: Array<WorkspaceUserGroupView> =
            await WorkspaceUserGroupManager.getViewsForSchedule({
              scheduleId: WorkspaceUserGroupAPI.readId(
                req.params["scheduleId"],
                "scheduleId",
              ),
              projectId: caller.projectId,
              props: caller.props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            userGroups: views as unknown as Array<JSONObject>,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${path}/available`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: {
            props: DatabaseCommonInteractionProps;
            projectId: ObjectID;
          } = await WorkspaceUserGroupAPI.getCaller(req);

          WorkspaceUserGroupAPI.assertMayChange(caller.props);

          const available: {
            groups: Array<WorkspaceAvailableUserGroup>;
            teams: Array<WorkspaceUserGroupTeam>;
          } = await WorkspaceUserGroupManager.getAvailable({
            workspaceType: WorkspaceUserGroupAPI.readWorkspaceType(
              req.query["workspaceType"],
            ),
            teamId:
              typeof req.query["teamId"] === "string"
                ? req.query["teamId"]
                : undefined,
            projectId: caller.projectId,
            props: caller.props,
          });

          return Response.sendJsonObjectResponse(req, res, {
            groups: available.groups as unknown as Array<JSONObject>,
            teams: available.teams as unknown as Array<JSONObject>,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/connect`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: {
            props: DatabaseCommonInteractionProps;
            projectId: ObjectID;
          } = await WorkspaceUserGroupAPI.getCaller(req);

          WorkspaceUserGroupAPI.assertMayChange(caller.props);

          const body: JSONObject = (req.body || {}) as JSONObject;

          const request: WorkspaceUserGroupConnectRequest = {
            onCallDutyPolicyScheduleId: WorkspaceUserGroupAPI.readText(
              body["onCallDutyPolicyScheduleId"],
            ),
            workspaceType: WorkspaceUserGroupAPI.readWorkspaceType(
              body["workspaceType"],
            ),
          };

          for (const key of [
            "workspaceGroupId",
            "newGroupName",
            "newGroupHandle",
            "workspaceTeamId",
            "tagName",
          ] as const) {
            const value: string = WorkspaceUserGroupAPI.readText(body[key]);

            if (value) {
              request[key] = value;
            }
          }

          const view: WorkspaceUserGroupView =
            await WorkspaceUserGroupManager.connect({
              request: request,
              projectId: caller.projectId,
              props: caller.props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            userGroup: view as unknown as JSONObject,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/disconnect`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: {
            props: DatabaseCommonInteractionProps;
            projectId: ObjectID;
          } = await WorkspaceUserGroupAPI.getCaller(req);

          WorkspaceUserGroupAPI.assertMayChange(caller.props);

          const body: JSONObject = (req.body || {}) as JSONObject;

          await WorkspaceUserGroupManager.disconnect({
            workspaceUserGroupId: WorkspaceUserGroupAPI.readId(
              body["workspaceUserGroupId"],
              "workspaceUserGroupId",
            ),
            scheduleId: WorkspaceUserGroupAPI.readId(
              body["onCallDutyPolicyScheduleId"],
              "onCallDutyPolicyScheduleId",
            ),
            projectId: caller.projectId,
            props: caller.props,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/sync/:workspaceUserGroupId`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const caller: {
            props: DatabaseCommonInteractionProps;
            projectId: ObjectID;
          } = await WorkspaceUserGroupAPI.getCaller(req);

          WorkspaceUserGroupAPI.assertMayChange(caller.props);

          const scheduleId: string = WorkspaceUserGroupAPI.readText(
            (req.body as JSONObject | undefined)?.["onCallDutyPolicyScheduleId"],
          );

          const view: WorkspaceUserGroupView =
            await WorkspaceUserGroupManager.syncAgain({
              workspaceUserGroupId: WorkspaceUserGroupAPI.readId(
                req.params["workspaceUserGroupId"],
                "workspaceUserGroupId",
              ),
              scheduleId:
                scheduleId && ObjectID.isValidUUID(scheduleId)
                  ? new ObjectID(scheduleId)
                  : null,
              projectId: caller.projectId,
              props: caller.props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            userGroup: view as unknown as JSONObject,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * The caller - a signed-in member of the project or one of its API keys -
   * with their permissions for that one project.
   */
  private static async getCaller(req: ExpressRequest): Promise<{
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }> {
    const props: DatabaseCommonInteractionProps = {
      ...(await CommonAPI.getDatabaseCommonInteractionProps(req)),
      isMultiTenantRequest: false,
    };

    const projectId: ObjectID =
      CommonAPI.assertAuthenticatedProjectPrincipal(props);

    return { props, projectId };
  }

  // Whoever changes a group could create one, on the plan they are sold on.
  private static assertMayChange(props: DatabaseCommonInteractionProps): void {
    BillingPermissions.checkFeatureIsOnPlan(
      WorkspaceUserGroup,
      props,
      DatabaseRequestType.Create,
    );

    CommonAPI.assertCanCreateTable({
      modelType: WorkspaceUserGroup,
      props: props,
      errorMessage: USER_GROUP_PERMISSION_MESSAGE,
    });
  }

  private static readWorkspaceType(value: unknown): WorkspaceType {
    if (value === WorkspaceType.Slack || value === WorkspaceType.MicrosoftTeams) {
      return value;
    }

    throw new BadDataException(
      "workspaceType must be Slack or MicrosoftTeams.",
    );
  }

  private static readId(value: unknown, name: string): ObjectID {
    const text: string = WorkspaceUserGroupAPI.readText(value);

    if (!text || !ObjectID.isValidUUID(text)) {
      throw new BadDataException(`A valid ${name} is required.`);
    }

    return new ObjectID(text);
  }

  private static readText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
