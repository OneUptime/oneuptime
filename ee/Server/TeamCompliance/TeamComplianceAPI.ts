import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import TeamComplianceService, {
  TeamComplianceStatus,
  UserComplianceStatus,
} from "./TeamComplianceService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import TeamService from "Common/Server/Services/TeamService";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";

/*
 * `/team/compliance-status/:teamId` - who on this team cannot be paged, and why.
 *
 * AUTHORISATION, and why it is written out here rather than assumed.
 *
 * This route is mounted with UserMiddleware.getUserMiddleware, and that
 * middleware is not an authorisation gate: it admits an unauthenticated request
 * as UserType.Public and calls next(), and the tenant id it attaches is read
 * from the caller-supplied `tenantid` header before any authorisation runs.
 * Everything underneath then reads with `isRoot: true`, because a compliance
 * page necessarily reports on people the reader may not be permitted to read
 * individually. The handler is therefore the only gate that exists.
 *
 * Until this change the handler checked only that the header carried SOME
 * project id, so anyone at all could send a `tenantid` and a team id and be told
 * which of that team's responders are unreachable, by name and email. That is a
 * roster of who to phone during an outage and who will never pick up, and it
 * predates Phase 2 - it is not a regression introduced by the readiness work,
 * but the readiness work rebuilt this service, so it is closed here.
 *
 * Two assertions now, in this order:
 *
 *   1. the caller is a logged-in member of the project they named
 *      (CommonAPI.assertAuthenticatedProjectMember), and
 *   2. the team in the path belongs to that same project - otherwise a member of
 *      project A reads project B's roster simply by sending their own header
 *      alongside a borrowed team id.
 *
 * TeamComplianceService scopes its own team read to the project as well, and the
 * duplication is deliberate for the same reason OnCallReadinessAPI duplicates
 * its service's guards: the service's scoping answers "no such team" (a 400),
 * whereas a member of project A reaching for project B's team id is an
 * authorisation failure and should be answered as one - and an endpoint's
 * authorisation should be legible in the endpoint, not inferred from what some
 * service happens to do today. The wording of the refusal is identical to the
 * one a nonexistent team gets, so the route cannot be used to enumerate team ids
 * across tenants.
 *
 * A PLAIN ROUTER (OnCallReadinessAPI's pattern). This file used to be
 * `class TeamComplianceAPI extends BaseAPI<Team>` purely to inherit a router,
 * which registered a second, dead copy of the whole Team CRUD route set on it.
 * The enterprise module mounts this router at "/api" through getApiRouters(),
 * so it carries this one route and nothing else - and no router.use() layer,
 * which in a router mounted at "/api" would run for core's requests too
 * (ee/Tests/Server/ModuleShape.test.ts enforces that for every ee router).
 *
 * Reading the status is runtime behaviour of the Enterprise Edition, not
 * enterprise configuration: it keeps working while ee is loaded whatever the
 * license says. Creating or changing the compliance RULES
 * (TeamComplianceSetting) is what the license governs, in EditionPermission.
 */

/*
 * The path is part of the contract with the Dashboard's compliance status
 * table, which requests it verbatim. Team's CRUD path is "/team".
 */
export const TEAM_COMPLIANCE_STATUS_ROUTE: string =
  "/team/compliance-status/:teamId";

const router: ExpressRouter = Express.getRouter();

router.get(
  TEAM_COMPLIANCE_STATUS_ROUTE,
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * ObjectID's constructor accepts any string, so an unparseable path
       * segment would otherwise travel all the way to a query that matches
       * nothing and be reported as "this team does not exist" rather than as
       * "you sent nonsense". The guard this replaces was `if (!teamId)`,
       * which could never fire: `new ObjectID(...)` is always truthy, so a
       * malformed id was accepted silently.
       */
      const rawTeamId: string = (req.params["teamId"] as string) || "";
      ObjectID.validateUUID(rawTeamId);
      const teamId: ObjectID = new ObjectID(rawTeamId);

      /*
       * The team id arrives from the caller and everything downstream reads
       * as root, so the team's OWN projectId - not the header - is what has
       * to agree with the project the caller was authorised for.
       */
      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: team?.projectId,
        projectId: projectId,
      });

      const complianceStatus: TeamComplianceStatus =
        await TeamComplianceService.getTeamComplianceStatus(teamId, projectId);

      // Convert ObjectIDs to strings for JSON response
      const responseData: {
        teamId: string;
        teamName: string;
        complianceSettings: Array<{
          ruleType: ComplianceRuleType;
          enabled: boolean;
        }>;
        userComplianceStatuses: Array<{
          userId: string;
          userName: string;
          userEmail: string;
          userProfilePictureId: string | undefined;
          isCompliant: boolean;
          nonCompliantRules: Array<{
            ruleType: ComplianceRuleType;
            reason: string;
          }>;
        }>;
      } = {
        teamId: complianceStatus.teamId.toString(),
        teamName: complianceStatus.teamName,
        complianceSettings: complianceStatus.complianceSettings,
        userComplianceStatuses: complianceStatus.userComplianceStatuses.map(
          (user: UserComplianceStatus) => {
            return {
              userId: user.userId.toString(),
              userName: user.userName,
              userEmail: user.userEmail,
              userProfilePictureId: user.userProfilePictureId?.toString(),
              isCompliant: user.isCompliant,
              nonCompliantRules: user.nonCompliantRules,
            };
          },
        ),
      };

      return Response.sendJsonObjectResponse(req, res, responseData);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
