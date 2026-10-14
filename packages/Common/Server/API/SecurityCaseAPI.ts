import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../Models/DatabaseModels/SecurityDetection";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import Includes from "../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { OPEN_SECURITY_CASE_STATUSES } from "../../Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  OverviewCaseRow,
  OverviewDetectionRow,
  SecurityOverviewMetrics,
  computeSecurityOverviewMetrics,
} from "../../Utils/SecurityCase/SecurityOverviewMetrics";
import UserMiddleware from "../Middleware/UserAuthorization";
import IncidentSeverityService from "../Services/IncidentSeverityService";
import SecurityCaseService, {
  Service as SecurityCaseServiceType,
} from "../Services/SecurityCaseService";
import SecurityDetectionService from "../Services/SecurityDetectionService";
import SecurityEventService, {
  EntityFindingSummary,
  ObservableActivity,
} from "../Services/SecurityEventService";
import SecurityPlaybookRunService from "../Services/SecurityPlaybookRunService";
import QueryHelper from "../Types/Database/QueryHelper";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityPlaybookActions from "../Utils/SecurityPlaybook/SecurityPlaybookActions";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

// The overview's windows: cases over the last 30 days, detections over the last 14.
export const SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS: number = 30;
export const SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS: number = 14;

// The most rows one overview reads of each kind; beyond them its figures are the latest ones'.
export const SECURITY_OVERVIEW_ROW_LIMIT: number = 5000;

export const ENTITY_ACTIVITY_MAX_HOURS: number = 30 * 24;

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

function readWholeNumber(
  value: JSONValue | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : fallback;

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/*
 * The Security product's own routes, beside the security case CRUD:
 *
 *   POST /security-case/overview           the overview's figures
 *   POST /security-case/entity-activity    how active some values have been
 *   POST /security-case/top-entities       the values the findings name most
 *   POST /security-case/:caseId/declare-incident
 *
 * Every read is made with the caller's own props, so the figures are of the
 * cases, detections and events the caller may read, and nothing else.
 */
export default class SecurityCaseAPI extends BaseAPI<
  SecurityCase,
  SecurityCaseServiceType
> {
  public constructor() {
    super(SecurityCase, SecurityCaseService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/overview`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanReadTable({
            modelType: SecurityCase,
            props,
            errorMessage:
              "Reading the security overview takes a Security role, or Project Owner or Project Admin.",
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            await this.getOverview({ projectId, props }),
          );
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/entity-activity`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          this.assertCanReadSecurityEvents(props);

          const body: JSONObject = readBody(req);
          const values: Array<string> = Array.isArray(body["values"])
            ? (body["values"] as Array<JSONValue>)
                .filter((value: JSONValue): value is string => {
                  return typeof value === "string" && value.trim().length > 0;
                })
                .slice(0, 50)
            : [];
          const hours: number = readWholeNumber(
            body["hours"],
            24 * 7,
            1,
            ENTITY_ACTIVITY_MAX_HOURS,
          );
          const endTime: Date = OneUptimeDate.getCurrentDate();

          const activity: Array<ObservableActivity> =
            await SecurityEventService.findObservableActivity({
              projectId,
              values,
              startTime: OneUptimeDate.addRemoveHours(endTime, -hours),
              endTime,
            });

          return Response.sendJsonObjectResponse(req, res, {
            hours,
            activity: activity.map((item: ObservableActivity): JSONObject => {
              return {
                value: item.value,
                eventCount: item.eventCount,
                findingCount: item.findingCount,
                maxSeverityId: item.maxSeverityId,
                firstSeen: item.firstSeen ? item.firstSeen.toISOString() : null,
                lastSeen: item.lastSeen ? item.lastSeen.toISOString() : null,
              };
            }),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    this.router.post(
      `${basePath}/top-entities`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          this.assertCanReadSecurityEvents(props);

          const body: JSONObject = readBody(req);
          const days: number = readWholeNumber(body["days"], 7, 1, 30);
          const limit: number = readWholeNumber(body["limit"], 25, 1, 100);
          const endTime: Date = OneUptimeDate.getCurrentDate();

          const entities: Array<EntityFindingSummary> =
            await SecurityEventService.findEntitiesByFindings({
              projectId,
              startTime: OneUptimeDate.addRemoveDays(endTime, -days),
              endTime,
              limit,
            });

          return Response.sendJsonObjectResponse(req, res, {
            days,
            entities: entities.map(
              (entity: EntityFindingSummary): JSONObject => {
                return {
                  value: entity.value,
                  findingCount: entity.findingCount,
                  ruleCount: entity.ruleCount,
                  maxSeverityId: entity.maxSeverityId,
                  lastSeen: entity.lastSeen
                    ? entity.lastSeen.toISOString()
                    : null,
                };
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Declaring an incident is a change of the case and the creation of an
     * incident, so it takes both: whoever may work the case and open
     * incidents in this project.
     */
    this.router.post(
      `${basePath}/:caseId/declare-incident`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: new SecurityCase().getUpdatePermissions(),
            errorMessage:
              "Declaring an incident for a case takes a role that can work security cases.",
          });

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: new Incident().getCreatePermissions(),
            errorMessage:
              "Declaring an incident takes a role that can create incidents in this project.",
          });

          const caseId: string | undefined = req.params["caseId"];

          if (!caseId || !ObjectID.isValidUUID(caseId)) {
            throw new BadDataException("A valid case ID is required.");
          }

          const body: JSONObject = readBody(req);
          const severityId: JSONValue | undefined = body["incidentSeverityId"];

          if (
            typeof severityId !== "string" ||
            !ObjectID.isValidUUID(severityId)
          ) {
            throw new BadDataException("Choose the incident's severity.");
          }

          const securityCase: SecurityCase | null =
            await SecurityCaseService.findOneBy({
              query: { _id: caseId, projectId },
              select: {
                _id: true,
                projectId: true,
                caseNumberWithPrefix: true,
                title: true,
                description: true,
                incidentId: true,
              },
              props,
            });

          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: securityCase?.projectId,
            projectId,
          });

          if (securityCase!.incidentId) {
            throw new BadDataException(
              "An incident is already declared for this case.",
            );
          }

          const severity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
              query: { _id: severityId, projectId },
              select: { _id: true },
              props: { isRoot: true },
            });

          if (!severity?.id) {
            throw new BadDataException(
              "That incident severity does not exist.",
            );
          }

          const result: { incident: Incident; incidentNumber: string } =
            await SecurityPlaybookActions.declareIncidentForCase({
              projectId,
              securityCase: securityCase!,
              incidentSeverityId: severity.id,
              userId: props.userId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            incidentId: result.incident.id!.toString(),
            incidentNumber: result.incidentNumber,
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private assertCanReadSecurityEvents(
    props: DatabaseCommonInteractionProps,
  ): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new SecurityEvent().getReadPermissions(),
      errorMessage:
        "Reading security events takes a Security role, or Project Owner or Project Admin.",
    });
  }

  private async getOverview(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    const { projectId, props } = data;
    const now: Date = OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.addRemoveDays(
      now,
      -SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS,
    );
    const detectionWindowStart: Date = OneUptimeDate.addRemoveDays(
      now,
      -SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS,
    );

    const caseSelect: JSONObject = {
      _id: true,
      createdAt: true,
      priority: true,
      status: true,
      verdict: true,
      assignedToUserId: true,
      assignedToTeamId: true,
      acknowledgedAt: true,
      containedAt: true,
      closedAt: true,
      mitreTactics: true,
    };

    const [openCases, casesInWindow, detections, waitingRuns]: [
      Array<SecurityCase>,
      Array<SecurityCase>,
      Array<SecurityDetection>,
      number,
    ] = await Promise.all([
      SecurityCaseService.findBy({
        query: {
          projectId,
          status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
        },
        select: caseSelect,
        skip: 0,
        limit: SECURITY_OVERVIEW_ROW_LIMIT,
        props,
      }),
      SecurityCaseService.findBy({
        query: {
          projectId,
          createdAt: QueryHelper.greaterThanEqualTo(windowStart),
        },
        select: caseSelect,
        skip: 0,
        limit: SECURITY_OVERVIEW_ROW_LIMIT,
        props,
      }),
      SecurityDetectionService.findBy({
        query: {
          projectId,
          firstSeenAt: QueryHelper.greaterThanEqualTo(detectionWindowStart),
        },
        select: {
          _id: true,
          firstSeenAt: true,
          source: true,
          ruleName: true,
          detectionRuleId: true,
        },
        skip: 0,
        limit: SECURITY_OVERVIEW_ROW_LIMIT,
        props,
      }),
      SecurityPlaybookRunService.countBy({
        query: {
          projectId,
          status: SecurityPlaybookRunStatus.WaitingForApproval,
        },
        props,
      }).then((count: { toNumber: () => number }): number => {
        return count.toNumber();
      }),
    ]);

    const toCaseRow: (row: SecurityCase) => OverviewCaseRow = (
      row: SecurityCase,
    ): OverviewCaseRow => {
      return {
        createdAt: row.createdAt!,
        priority: row.priority,
        status: row.status,
        verdict: row.verdict,
        assignedToUserId: row.assignedToUserId?.toString(),
        assignedToTeamId: row.assignedToTeamId?.toString(),
        acknowledgedAt: row.acknowledgedAt,
        containedAt: row.containedAt,
        closedAt: row.closedAt,
        mitreTactics: row.mitreTactics || [],
      };
    };

    const metrics: SecurityOverviewMetrics = computeSecurityOverviewMetrics({
      openCases: openCases.map(toCaseRow),
      casesInWindow: casesInWindow.map(toCaseRow),
      detectionsInWindow: detections.map(
        (row: SecurityDetection): OverviewDetectionRow => {
          return {
            firstSeenAt: row.firstSeenAt || row.createdAt!,
            source: row.source,
            ruleName: row.ruleName,
            detectionRuleId: row.detectionRuleId?.toString(),
          };
        },
      ),
      windowStart,
      detectionWindowStart,
      now,
    });

    const myOpenCases: number = props.userId
      ? openCases.filter((row: SecurityCase): boolean => {
          return row.assignedToUserId?.toString() === props.userId!.toString();
        }).length
      : 0;

    return {
      generatedAt: now.toISOString(),
      caseWindowInDays: SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS,
      detectionWindowInDays: SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS,
      myOpenCases,
      runsWaitingForApproval: waitingRuns,
      isTruncated:
        openCases.length >= SECURITY_OVERVIEW_ROW_LIMIT ||
        casesInWindow.length >= SECURITY_OVERVIEW_ROW_LIMIT ||
        detections.length >= SECURITY_OVERVIEW_ROW_LIMIT,
      metrics: metrics as unknown as JSONObject,
    } as JSONObject;
  }
}
