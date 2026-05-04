import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectSCIMService from "../Services/ProjectSCIMService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceType,
} from "../Services/TeamMemberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

export default class TeamMemberAPI extends BaseAPI<
  TeamMember,
  TeamMemberServiceType
> {
  public constructor() {
    super(TeamMember, TeamMemberService);

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
