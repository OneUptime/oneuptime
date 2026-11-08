import { IsBillingEnabled } from "../EnvironmentConfig";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import UserMiddleware from "../Middleware/UserAuthorization";
import ProjectService from "../Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import CallerPermission from "../Utils/Permission/CallerPermission";
import Response from "../Utils/Response";
import TelemetryUsageReads from "../Utils/TelemetryUsage/TelemetryUsageReads";
import CommonAPI from "./CommonAPI";
import Project from "../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  getTelemetryUsageWindow,
  isTelemetryProjectUsageSortBy,
  TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
  TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
  TELEMETRY_USAGE_MAX_PROJECTS_PAGE_SIZE,
  TELEMETRY_USAGE_PROJECT_ROUTE,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryUsageSummary,
  TelemetryUsageWindow,
} from "../../Types/Telemetry/TelemetryUsage";
import {
  PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "../../Utils/Project/ProjectBilling";

/*
 * Telemetry usage, read: how much telemetry each project and each of its
 * resources sent, per UTC day and signal, from the staged usage rows
 * (TelemetryUsageReads). With billing on or off: a server without billing
 * counts usage too, at no cost.
 *
 * A bare router, as OnCallReadinessAPI is: TelemetryUsageBilling's CRUD
 * routes are mounted on their own, and extending BaseAPI here would mount
 * them a second time.
 *
 *   GET /telemetry-usage/project - the caller's project (its tenantid
 *     header): whoever reads the project's telemetry usage
 *     (PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS), with a grant that reaches
 *     the whole project, since the answer is about all of it. A project API
 *     key may read it too. What usage cost is in the answer only where
 *     billing is on and the caller reads billing (PROJECT_USAGE_READ_PERMISSIONS);
 *     resources are named as the caller may read them.
 *
 *   GET /telemetry-usage/admin/projects - every project, heaviest first;
 *   GET /telemetry-usage/admin/projects/:projectId - any one project.
 *     Master admins only (Admin Dashboard > Telemetry Usage, and Projects >
 *     a project > Telemetry Usage), with the cost where billing is on.
 *
 * Every read reads the rows as root, so these checks are the whole gate.
 */
const router: ExpressRouter = Express.getRouter();

const READ_OPTIONS: {
  projectWideOnly: boolean;
  labelledBlocksRefuse: boolean;
} = {
  projectWideOnly: true,
  labelledBlocksRefuse: true,
};

export const TELEMETRY_USAGE_READ_REFUSAL: string =
  "You need a role that reads this project's telemetry across the whole project (Project Owner, Project Admin, Project Member, Viewer or a Telemetry role), or a billing role, to see its telemetry usage.";

const readQueryString: (req: ExpressRequest, name: string) => string = (
  req: ExpressRequest,
  name: string,
): string => {
  const value: unknown = (req.query as Record<string, unknown>)[name];

  return typeof value === "string" ? value : "";
};

// The range the request names, or a 400 that says what is wrong with it.
const readWindow: (req: ExpressRequest) => TelemetryUsageWindow = (
  req: ExpressRequest,
): TelemetryUsageWindow => {
  const window: TelemetryUsageWindow | string = getTelemetryUsageWindow({
    startDay: readQueryString(req, "startDay"),
    endDay: readQueryString(req, "endDay"),
  });

  if (typeof window === "string") {
    throw new BadDataException(window);
  }

  return window;
};

const WHOLE_NUMBER: RegExp = /^\d+$/;

const readWholeNumber: (
  req: ExpressRequest,
  name: string,
  fallback: number,
) => number = (req: ExpressRequest, name: string, fallback: number): number => {
  const raw: string = readQueryString(req, name);

  if (!raw) {
    return fallback;
  }

  if (!WHOLE_NUMBER.test(raw)) {
    throw new BadDataException(`${name} must be a whole number.`);
  }

  return parseInt(raw, 10);
};

/*
 * Whether the caller reads the project's usage: a master admin, or a member
 * or API key whose grant of one of the usage readers' permissions reaches
 * the whole project, with no block on any of them.
 */
export const canReadProjectTelemetryUsage: (
  props: DatabaseCommonInteractionProps,
) => boolean = (props: DatabaseCommonInteractionProps): boolean => {
  if (props.isMasterAdmin) {
    return true;
  }

  return CallerPermission.holdsAnyOf(
    props,
    PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
    READ_OPTIONS,
  );
};

/*
 * Whether the answer may say what usage cost: only where billing is on, and
 * only to whoever reads billing - a master admin, or a holder of one of the
 * cost readers' permissions over the whole project.
 */
export const canReadProjectTelemetryUsageCost: (
  props: DatabaseCommonInteractionProps,
) => boolean = (props: DatabaseCommonInteractionProps): boolean => {
  if (!IsBillingEnabled) {
    return false;
  }

  if (props.isMasterAdmin) {
    return true;
  }

  return CallerPermission.holdsAnyOf(
    props,
    PROJECT_USAGE_READ_PERMISSIONS,
    READ_OPTIONS,
  );
};

router.get(
  TELEMETRY_USAGE_PROJECT_ROUTE,
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
        throw new NotAuthorizedException(TELEMETRY_USAGE_READ_REFUSAL);
      }

      const summary: TelemetryUsageSummary =
        await TelemetryUsageReads.getProjectUsage({
          projectId: projectId,
          window: readWindow(req),
          isCostIncluded: canReadProjectTelemetryUsageCost(props),
          nameProps: props,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const window: TelemetryUsageWindow = readWindow(req);

      const sortByParam: string = readQueryString(req, "sortBy") || "total";

      if (!isTelemetryProjectUsageSortBy(sortByParam)) {
        throw new BadDataException(
          "sortBy must be total, name or one of the signals (Logs, Metrics, Traces, Profiles, Session Replay, Security Events).",
        );
      }

      const sortOrderParam: string =
        readQueryString(req, "sortOrder") ||
        (sortByParam === "name" ? "asc" : "desc");

      if (sortOrderParam !== "asc" && sortOrderParam !== "desc") {
        throw new BadDataException("sortOrder must be asc or desc.");
      }

      const limit: number = readWholeNumber(
        req,
        "limit",
        TELEMETRY_USAGE_DEFAULT_PROJECTS_PAGE_SIZE,
      );

      if (limit < 1 || limit > TELEMETRY_USAGE_MAX_PROJECTS_PAGE_SIZE) {
        throw new BadDataException(
          `limit must be from 1 to ${TELEMETRY_USAGE_MAX_PROJECTS_PAGE_SIZE}.`,
        );
      }

      const page: TelemetryProjectUsagePage =
        await TelemetryUsageReads.getUsageByProject({
          window: window,
          isCostIncluded: IsBillingEnabled,
          sortBy: sortByParam as TelemetryProjectUsageSortBy,
          sortOrder: sortOrderParam,
          skip: readWholeNumber(req, "skip", 0),
          limit: limit,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        page as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  `${TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE}/:projectId`,
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const projectIdParam: string = String(req.params["projectId"] || "");

      if (!ObjectID.isValidUUID(projectIdParam)) {
        throw new BadDataException("projectId must be a project's ID.");
      }

      const window: TelemetryUsageWindow = readWindow(req);

      const project: Project | null = await ProjectService.findOneById({
        id: new ObjectID(projectIdParam),
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!project?.id) {
        throw new NotFoundException("Project not found.");
      }

      const summary: TelemetryUsageSummary =
        await TelemetryUsageReads.getProjectUsage({
          projectId: project.id,
          window: window,
          isCostIncluded: IsBillingEnabled,
          nameProps: { isRoot: true },
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
