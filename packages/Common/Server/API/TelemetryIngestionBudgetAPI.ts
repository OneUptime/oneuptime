import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService from "../Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import TelemetryIngestionBudgetStatusReader from "../Utils/Telemetry/TelemetryIngestionBudgetStatusReader";
import CommonAPI from "./CommonAPI";
import { canReadProjectTelemetryUsage } from "./TelemetryUsageAPI";
import Project from "../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE,
  TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
  TelemetryIngestionBudgetStatus,
} from "../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * Telemetry ingestion budgets, read: today's budget, rate, usage, drops and
 * throttling for each signal of a project, and of each of its ingestion keys
 * that has a budget of its own (TelemetryIngestionBudgetStatusReader).
 *
 *   GET /telemetry-ingestion-budget/project - the caller's project (its
 *     tenantid header), for whoever reads its telemetry usage
 *     (canReadProjectTelemetryUsage, the Usage page's own rule): a budget is
 *     read beside the usage it limits. A project API key may read it too.
 *
 *   GET /telemetry-ingestion-budget/admin/projects/:projectId - any project,
 *     for master admins (Admin Dashboard > Projects > a project > Ingestion
 *     Budgets).
 *
 * The budgets themselves are written through the models' own routes: the
 * instance's on GlobalConfig and a project's on Project, both by master
 * admins only, and a key's on TelemetryIngestionKey by whoever may edit the
 * key. A bare router, as TelemetryUsageAPI is.
 */
const router: ExpressRouter = Express.getRouter();

export const TELEMETRY_INGESTION_BUDGET_READ_REFUSAL: string =
  "You need a role that reads this project's telemetry across the whole project (Project Owner, Project Admin, Project Member, Viewer or a Telemetry role), or a billing role, to see its ingestion budgets.";

router.get(
  TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID = props.isMasterAdmin
        ? CommonAPI.assertTenantScoped(props)
        : CommonAPI.assertAuthenticatedProjectPrincipal(props);

      if (!canReadProjectTelemetryUsage(props)) {
        throw new NotAuthorizedException(
          TELEMETRY_INGESTION_BUDGET_READ_REFUSAL,
        );
      }

      const status: TelemetryIngestionBudgetStatus =
        await TelemetryIngestionBudgetStatusReader.getProjectStatus({
          projectId: projectId,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  `${TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE}/:projectId`,
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const projectIdParam: string = String(req.params["projectId"] || "");

      if (!ObjectID.isValidUUID(projectIdParam)) {
        throw new BadDataException("projectId must be a project's ID.");
      }

      const project: Project | null = await ProjectService.findOneById({
        id: new ObjectID(projectIdParam),
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!project?.id) {
        throw new NotFoundException("Project not found.");
      }

      const status: TelemetryIngestionBudgetStatus =
        await TelemetryIngestionBudgetStatusReader.getProjectStatus({
          projectId: project.id,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        status as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
