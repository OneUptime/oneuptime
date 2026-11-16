import Monitor from "../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import StatusCode from "../../Types/API/StatusCode";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SLO_MONTHLY_REPORT_ROUTE,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  parseSloMonthlyReportPeriod,
  sloMonthlyReportToJSON,
} from "../../Utils/Slo/SloMonthlyReport";
import {
  SLO_RELEASE_CHECK_ROUTE,
  SloReleaseCheckDecision,
  SloReleaseCheckMeasurement as SloReleaseCheckMeasurementResult,
  SloReleaseCheckOptions,
  buildSloReleaseCheckResponse,
  decideSloReleaseCheck,
  parseSloReleaseCheckOptions,
} from "../../Utils/Slo/SloReleaseCheck";
import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorService from "../Services/MonitorService";
import ServiceLevelObjectiveService, {
  Service as ServiceLevelObjectiveServiceType,
} from "../Services/ServiceLevelObjectiveService";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SloMonthlyReportMeasurement, {
  SLO_MONTHLY_REPORT_SELECT,
} from "../Utils/Slo/SloMonthlyReportMeasurement";
import SloReleaseCheckMeasurement, {
  SLO_RELEASE_CHECK_SELECT,
} from "../Utils/Slo/SloReleaseCheckMeasurement";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// A "no" answered as an error, for tools that read the status code (Flagger).
export const SLO_RELEASE_CHECK_FAILED_STATUS_CODE: number = 412;

export const SLO_RELEASE_CHECK_PERMISSION_MESSAGE: string =
  "Checking a release against an SLO takes a role that can read SLOs.";

export const SLO_RELEASE_CHECK_BAD_ID_MESSAGE: string =
  "The SLO's ID in the address is not a valid ID. Copy it from the SLO's page or its API.";

export const SLO_MONTHLY_REPORT_PERMISSION_MESSAGE: string =
  "Reading an SLO's monthly report takes a role that can read SLOs.";

export const SLO_MONTHLY_REPORT_NOT_FOUND_MESSAGE: string =
  "Service Level Objective not found. Check the SLO's ID, and that it belongs to the project you are signed in to.";

/*
 * Service Level Objectives: their CRUD, and the release check a rollout
 * asks while a release goes out (Utils/Slo/SloReleaseCheck says what it
 * answers).
 *
 *   GET  /service-level-objective/:id/release-check?windowInMinutes=10
 *   POST /service-level-objective/:id/release-check
 *        -> { isSafeToContinue, verdict, reason, burnRate, ... }
 *
 * Both take the same options, in the query string or a JSON body: GET for
 * a tool that only builds URLs (Argo Rollouts' web metric), POST for one
 * that sends a body (a Flagger webhook, whose own fields are ignored).
 * It takes what reading the SLO takes - the deploy gate's API key reads it
 * too - and the SLO is read as the caller, so an SLO of another project or
 * one the caller may not see is answered as missing. A "no" is 200 with
 * isSafeToContinue false, or 412 with failWithStatusCode=true.
 *
 *   GET  /service-level-objective/:id/monthly-report?months=12
 *   GET  /service-level-objective/:id/monthly-report?year=2025
 *        -> { months: [...], total: {...}, monitors: [...] }
 *
 * The SLO's monthly report (Utils/Slo/SloMonthlyReport says what it
 * holds), measured when it is asked for, with what reading the SLO takes.
 * The per-monitor breakdown names only the monitors the caller may read.
 */
export default class ServiceLevelObjectiveAPI extends BaseAPI<
  ServiceLevelObjective,
  ServiceLevelObjectiveServiceType
> {
  public constructor() {
    super(ServiceLevelObjective, ServiceLevelObjectiveService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    const releaseCheckPath: string = `${basePath}/:id${SLO_RELEASE_CHECK_ROUTE}`;

    this.router.get(
      releaseCheckPath,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.checkRelease(req, res);
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      releaseCheckPath,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.checkRelease(req, res);
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.get(
      `${basePath}/:id${SLO_MONTHLY_REPORT_ROUTE}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getMonthlyReport(req, res);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private async getMonthlyReport(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertAuthenticatedProjectPrincipal(props);

    CommonAPI.assertCanReadTable({
      modelType: ServiceLevelObjective,
      props,
      errorMessage: SLO_MONTHLY_REPORT_PERMISSION_MESSAGE,
    });

    const rawId: unknown = req.params["id"];

    if (typeof rawId !== "string" || !ObjectID.isValidUUID(rawId.trim())) {
      throw new BadDataException(SLO_RELEASE_CHECK_BAD_ID_MESSAGE);
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const query: JSONObject = (req.query || {}) as JSONObject;

    const period: SloMonthlyReportPeriod = parseSloMonthlyReportPeriod({
      months: query["months"],
      year: query["year"],
      now: now,
    });

    const slo: ServiceLevelObjective | null = await this.service.findOneById({
      id: new ObjectID(rawId.trim()),
      select: SLO_MONTHLY_REPORT_SELECT,
      props: props,
    });

    if (!slo || !slo.id || !slo.projectId) {
      throw new NotFoundException(SLO_MONTHLY_REPORT_NOT_FOUND_MESSAGE);
    }

    const projectId: ObjectID = slo.projectId;

    const report: SloMonthlyReport = await SloMonthlyReportMeasurement.measure({
      slo: slo,
      period: period,
      now: now,
      readMonitorNames: (
        monitorIds: Array<ObjectID>,
      ): Promise<Map<string, string>> => {
        return ServiceLevelObjectiveAPI.readMonitorNames({
          projectId: projectId,
          monitorIds: monitorIds,
          props: props,
        });
      },
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      sloMonthlyReportToJSON(report),
    );
  }

  /*
   * The names of the SLO's monitors the caller may read, read as the
   * caller: a role that may not read monitors, or reads only some, sees the
   * breakdown of those it may - the SLO's own figures still count them all.
   */
  public static async readMonitorNames(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.monitorIds.length === 0) {
      return names;
    }

    let monitors: Array<Monitor> = [];

    try {
      CommonAPI.assertCanReadTable({ modelType: Monitor, props: data.props });

      monitors = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(data.monitorIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: data.props,
      });
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof NotAuthenticatedException
      ) {
        return names;
      }

      throw error;
    }

    for (const monitor of monitors) {
      if (monitor.id) {
        names.set(monitor.id.toString(), monitor.name || "");
      }
    }

    return names;
  }

  private async checkRelease(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertAuthenticatedProjectPrincipal(props);

    CommonAPI.assertCanReadTable({
      modelType: ServiceLevelObjective,
      props,
      errorMessage: SLO_RELEASE_CHECK_PERMISSION_MESSAGE,
    });

    const rawId: unknown = req.params["id"];

    if (typeof rawId !== "string" || !ObjectID.isValidUUID(rawId.trim())) {
      throw new BadDataException(SLO_RELEASE_CHECK_BAD_ID_MESSAGE);
    }

    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};

    const options: SloReleaseCheckOptions = parseSloReleaseCheckOptions({
      ...((req.query || {}) as JSONObject),
      ...body,
    });

    const slo: ServiceLevelObjective | null = await this.service.findOneById({
      id: new ObjectID(rawId.trim()),
      select: SLO_RELEASE_CHECK_SELECT,
      props: props,
    });

    if (!slo || !slo.id) {
      throw new NotFoundException(
        "Service Level Objective not found. Check the SLO's ID, and that the API key belongs to its project.",
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: slo,
        options: options,
        now: now,
      });

    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: slo.sliType,
      targetPercentage: Number(slo.targetPercentage),
      options: options,
      measurement: measurement,
      deploymentsAllowed: slo.deploymentsAllowed,
      errorBudgetPolicyTierName: slo.currentErrorBudgetPolicyTierName,
    });

    const response: JSONObject = buildSloReleaseCheckResponse({
      sloId: slo.id.toString(),
      sloName: slo.name,
      sliType: slo.sliType,
      targetPercentage: Number(slo.targetPercentage),
      sloStatus: slo.sloStatus,
      deploymentsAllowed: slo.deploymentsAllowed,
      errorBudgetPolicyTierName: slo.currentErrorBudgetPolicyTierName,
      options: options,
      measurement: measurement,
      decision: decision,
      checkedAt: now,
    });

    return Response.sendJsonObjectResponse(req, res, response, {
      statusCode:
        options.failWithStatusCode && !decision.isSafeToContinue
          ? new StatusCode(SLO_RELEASE_CHECK_FAILED_STATUS_CODE)
          : new StatusCode(200),
    });
  }
}
