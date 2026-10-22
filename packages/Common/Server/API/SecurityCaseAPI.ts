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
import ArchivedValueCheck from "../Utils/Database/ArchivedValueCheck";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../Utils/ArchivableValues";
import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import SecurityLogSource from "../../Models/DatabaseModels/SecurityLogSource";
import SecurityPlaybook from "../../Models/DatabaseModels/SecurityPlaybook";
import SecuritySetup, {
  SecuritySetupStatus,
  SecuritySetupTestResult,
  TurnOnRecommendedOptions,
  TurnOnRecommendedResult,
} from "../Utils/SecurityEvent/SecuritySetup";
import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
  SecurityCaseTriageStartResult,
} from "../Utils/AI/Security/SecurityCaseTriage";
import SecurityCaseTriageStatus from "../Utils/AI/Security/SecurityCaseTriageStatus";

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
 *   POST /security-case/setup/status       how security is set up
 *   POST /security-case/setup/turn-on-recommended
 *   POST /security-case/setup/test         a simulated attack, end to end
 *   POST /security-case/:caseId/ai-triage  OneUptime AI's triage of a case
 *   POST /security-case/:caseId/ai-triage/start
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
              select: { _id: true, name: true, isArchived: true },
              props: { isRoot: true },
            });

          if (!severity?.id) {
            throw new BadDataException(
              "That incident severity does not exist.",
            );
          }

          // A person's pick: never an archived severity (ArchivedValueCheck).
          if (severity.isArchived) {
            ArchivedValueCheck.refuseValues([
              {
                definition:
                  ARCHIVABLE_VALUES[ArchivableValueType.IncidentSeverity],
                name: severity.name || "",
              },
            ]);
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

    /*
     * The Overview's "Get started": the pipeline's figures, read with the
     * caller's own permissions (a figure they may not read is 0).
     */
    this.router.post(
      `${basePath}/setup/status`,
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
              "Reading how security is set up takes a Security role, or Project Owner or Project Admin.",
          });

          const status: SecuritySetupStatus = await SecuritySetup.getStatus({
            projectId,
            props,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            status as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * The one click: "Your logs" as a source, the recommended rules and the
     * Enrich New Cases playbook. Each part is done as the caller, and asked
     * for only if the caller could do it through its own endpoint, so the
     * route opens no door the CRUD API keeps shut.
     */
    this.router.post(
      `${basePath}/setup/turn-on-recommended`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const body: JSONObject = readBody(req);
          const options: TurnOnRecommendedOptions = {
            logs: body["logs"] !== false,
            detections: body["detections"] !== false,
            playbook: body["playbook"] !== false,
          };

          if (options.logs) {
            CommonAPI.assertCanCreateTable({
              modelType: SecurityLogSource,
              props,
              errorMessage:
                "Turning on your logs as a security source takes Security Admin, or Project Owner or Project Admin.",
            });
          }

          if (options.detections) {
            CommonAPI.assertCanCreateTable({
              modelType: DetectionRule,
              props,
              errorMessage:
                "Turning on detection rules takes a role that can create them.",
            });
          }

          if (options.playbook) {
            CommonAPI.assertCanCreateTable({
              modelType: SecurityPlaybook,
              props,
              errorMessage:
                "Turning on a playbook takes a role that can create playbooks.",
            });
          }

          const result: TurnOnRecommendedResult =
            await SecuritySetup.turnOnRecommended({
              projectId,
              props,
              options,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * The setup test: a simulated attack through the real pipeline. It
     * writes security events and may add the brute force rule, so it takes
     * a role that can do both.
     */
    this.router.post(
      `${basePath}/setup/test`,
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
            allowedPermissions: new SecurityEvent().getCreatePermissions(),
            errorMessage:
              "Running a test takes a role that can create security events.",
          });

          CommonAPI.assertCanCreateTable({
            modelType: DetectionRule,
            props,
            errorMessage:
              "Running a test takes a role that can create detection rules.",
          });

          CommonAPI.assertCanReadTable({
            modelType: SecurityCase,
            props,
            errorMessage: "Running a test takes a role that can read cases.",
          });

          const result: SecuritySetupTestResult = await SecuritySetup.runTest({
            projectId,
            props,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * The case's AI card: OneUptime AI's latest triage run of the case, its
     * steps while it runs, and what stops a triage now
     * (SecurityCaseTriageStatus). For whoever may read the case; the
     * triage's result is on the case itself.
     */
    this.router.post(
      `${basePath}/:caseId/ai-triage`,
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
              "Reading a case's AI triage takes a Security role, or Project Owner or Project Admin.",
          });

          const securityCaseId: ObjectID = await this.readCaseForTriage({
            caseId: req.params["caseId"],
            projectId,
            props,
          });

          return Response.sendJsonObjectResponse(
            req,
            res,
            await SecurityCaseTriageStatus.read({ projectId, securityCaseId }),
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Triage with AI (and Triage again): a person asks OneUptime AI to
     * triage the case now, whether or not the project triages new cases on
     * its own. Takes a role that can work cases - the triage records its
     * read on the case - and everything AI needs (SecurityCaseTriage).
     * Answers with the run, or 400 with what stopped it.
     */
    this.router.post(
      `${basePath}/:caseId/ai-triage/start`,
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
              "Asking OneUptime AI to triage a case takes a role that can work security cases.",
          });

          const securityCaseId: ObjectID = await this.readCaseForTriage({
            caseId: req.params["caseId"],
            projectId,
            props,
          });

          const result: SecurityCaseTriageStartResult =
            await SecurityCaseTriage.startTriage({
              projectId,
              securityCaseId,
            });

          if (!result.started) {
            throw new BadDataException(
              SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[result.code],
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            runId: result.runId.toString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * The case a triage route is about, read with the caller's own props: a
   * case they may not read, or of another project, is no case to them.
   */
  private async readCaseForTriage(data: {
    caseId: string | undefined;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID> {
    if (!data.caseId || !ObjectID.isValidUUID(data.caseId)) {
      throw new BadDataException("A valid case ID is required.");
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.caseId, projectId: data.projectId },
        select: { _id: true, projectId: true },
        props: data.props,
      });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: securityCase?.projectId,
      projectId: data.projectId,
    });

    return securityCase!.id!;
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
