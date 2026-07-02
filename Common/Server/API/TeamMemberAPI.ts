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
