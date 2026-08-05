import CommonAPI from "./CommonAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectSCIMService from "../Services/ProjectSCIMService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceType,
} from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";

export default class TeamMemberAPI extends BaseAPI<
  TeamMember,
  TeamMemberServiceType
> {
  public constructor() {
    super(TeamMember, TeamMemberService);

    /*
     * Used by the invite-user forms to decide whether to ask for the
     * invitee's name (only needed when the email has no OneUptime account
     * yet). Returns just a boolean — no user details — and requires an
     * authenticated user.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/is-user-registered`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          const userId: ObjectID | undefined =
            oneUptimeRequest.userAuthorization?.userId;
          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const emailString: string = (
            (req.body?.["email"] as string) || ""
          ).trim();

          if (!emailString || !Email.isValid(emailString)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("A valid email is required"),
            );
          }

          const user: User | null = await UserService.findByEmail(
            new Email(emailString),
            {
              isRoot: true,
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            isRegistered: Boolean(user),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Removes one user from the current project - every team they belong to in
     * it - in a single call.
     *
     * The Users table lists people rather than memberships, so "remove" there
     * means "remove from the project". Doing that as N separate DELETEs from
     * the browser is not equivalent: TeamMemberService.onBeforeDelete rejects
     * the removal of the last accepted member of a team that
     * `shouldHaveAtLeastOneMember` (the Owners team), and it rejects it per
     * request - so a client-side loop deletes every other membership first and
     * only then hits the guard, leaving the user stripped of the teams the
     * caller was told they had not been removed from. One deleteBy over the
     * whole set runs that guard against all of the user's memberships before
     * anything is deleted, so the removal either happens or it does not.
     *
     * The project is taken from the request's tenant, never from the body, and
     * the delete runs with the caller's own permissions - so this grants
     * nothing that DELETE /team-member/:id did not already grant.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/remove-user-from-project`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          if (!oneUptimeRequest.userAuthorization?.userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID | undefined = props.tenantId;

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          const userIdParam: string = (
            (req.body?.["userId"] as string) || ""
          ).trim();

          if (!userIdParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("User ID is required"),
            );
          }

          ObjectID.validateUUID(userIdParam);

          const numberOfMembershipsDeleted: number =
            await this.service.deleteBy({
              query: {
                userId: new ObjectID(userIdParam),
                projectId: projectId,
              } as Query<TeamMember>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            numberOfMembershipsDeleted: numberOfMembershipsDeleted,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/leave`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          const idParam: string = req.params["id"] as string;
          if (!idParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member id is required"),
            );
          }

          ObjectID.validateUUID(idParam);
          const teamMemberId: ObjectID = new ObjectID(idParam);

          const userId: ObjectID | undefined =
            oneUptimeRequest.userAuthorization?.userId;
          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const teamMember: TeamMember | null = await this.service.findOneById({
            id: teamMemberId,
            props: { isRoot: true },
            select: {
              userId: true,
              projectId: true,
            },
          });

          if (!teamMember) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member not found"),
            );
          }

          if (teamMember.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException(
                "You can only leave teams you are a member of",
              ),
            );
          }

          if (teamMember.projectId) {
            const scimCount: number = (
              await ProjectSCIMService.countBy({
                query: {
                  projectId: teamMember.projectId,
                  enablePushGroups: true,
                },
                props: { isRoot: true },
              })
            ).toNumber();

            if (scimCount > 0) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "Team membership is managed by SCIM Push Groups for this project. Please contact your administrator to be removed.",
                ),
              );
            }
          }

          await this.service.deleteOneById({
            id: teamMemberId,
            props: { isRoot: true },
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
