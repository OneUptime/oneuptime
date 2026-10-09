import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import TeamComplianceService from "./TeamComplianceService";
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
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import TeamService from "Common/Server/Services/TeamService";
import { JSONObject } from "Common/Types/JSON";
import { TeamComplianceStatusJSON } from "Common/Types/Team/TeamComplianceStatus";

/*
 * `/team/compliance-status/:teamId` - which of this team's members fail its
 * compliance rules, and why (TeamComplianceStatusJSON).
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
 * Three assertions now, in this order:
 *
 *   1. the caller is a logged-in member of the project they named
 *      (CommonAPI.assertAuthenticatedProjectMember),
 *   2. the caller could read the team's compliance rules through their own
 *      CRUD endpoint (CommonAPI.assertCanReadTable on TeamComplianceSetting) -
 *      membership is not read authorisation, and the status is those rules
 *      evaluated against the team's members, and
 *   3. the team in the path belongs to that same project - otherwise a member of
 *      project A reads project B's roster simply by sending their own header
 *      alongside a borrowed team id.
 *
 * Why the rules' read list is the bar, and not Team's or TeamMember's: those
 * two are shared with every member through ProjectUser, which every member
 * holds, so a check on them would refuse nobody. TeamComplianceSetting's list
 * is narrower - owners, admins, members, viewers and ReadProjectTeam - and a
 * member whose teams grant only, say, MonitorViewer cannot read the rules on
 * their CRUD endpoint. Without the check this route handed that member the
 * rules anyway, together with every member's reachability under them. The
 * roster stays where it was: anyone in the project can still list a team's
 * members.
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
       * Before anything is read as root: the same bar the compliance rules'
       * own CRUD read sets, team BLOCK rows included (see the header).
       */
      CommonAPI.assertCanReadTable({
        modelType: TeamComplianceSetting,
        props: databaseProps,
        errorMessage: "You do not have permission to read team compliance.",
      });

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

      /*
       * The service builds the wire shape itself
       * (Common/Types/Team/TeamComplianceStatus, which the Dashboard page is
       * typed against too), so there is nothing left to convert here.
       */
      const complianceStatus: TeamComplianceStatusJSON =
        await TeamComplianceService.getTeamComplianceStatus(teamId, projectId);

      return Response.sendJsonObjectResponse(
        req,
        res,
        complianceStatus as unknown as JSONObject,
      );
    } catch (e) {
      next(e);
    }
  },
);

export default router;
