import UserMiddleware from "../Middleware/UserAuthorization";
import TeamComplianceService, { TeamComplianceStatus } from "../Services/TeamComplianceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Team from "../../Models/DatabaseModels/Team";
import TeamService, {
  Service as TeamServiceType,
} from "../Services/TeamService";

export default class TeamComplianceAPI extends BaseAPI<
  Team,
  TeamServiceType
> {
  public constructor() {
    super(Team, TeamService);

    // Get team compliance status
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/compliance-status/:teamId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID = databaseProps.tenantId as ObjectID;

          const teamId: ObjectID = new ObjectID(req.params["teamId"] as string);

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid projectId."),
            );
          }

          if (!teamId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid teamId."),
            );
          }

          const complianceStatus: TeamComplianceStatus = await TeamComplianceService.getTeamComplianceStatus(
            teamId,
            projectId,
          );

          // Convert ObjectIDs to strings for JSON response
          const responseData = {
            teamId: complianceStatus.teamId.toString(),
            teamName: complianceStatus.teamName,
            complianceSettings: complianceStatus.complianceSettings,
            userComplianceStatuses: complianceStatus.userComplianceStatuses.map(user => ({
              userId: user.userId.toString(),
              userName: user.userName,
              userEmail: user.userEmail,
              isCompliant: user.isCompliant,
              nonCompliantRules: user.nonCompliantRules,
            })),
          };

          return Response.sendJsonObjectResponse(req, res, responseData as any);
        } catch (e) {
          next(e);
        }
      },
    );
  }
}