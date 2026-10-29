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
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import { SECURITY_CASE_PRIORITY_LEVEL_FLAGS } from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SECURITY_CASE_STAGE_FLAGS } from "../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatuses from "../../Utils/SecurityCase/SecurityCaseStatuses";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../Utils/SecurityCase/SecurityCaseValues";
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
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import AIRunType from "../../Types/AI/AIRunType";
import { InvestigationEvidenceRowsResponse } from "../../Types/AI/InvestigationEvidence";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import AIRunEventService from "../Services/AIRunEventService";
import AIRunService from "../Services/AIRunService";
import { EVIDENCE_CITATION_ID_REGEX } from "../Utils/AI/SRE/InvestigationEvidence";
import {
  MAX_EVIDENCE_EVENTS,
  rerunInvestigationEvidence,
} from "../Utils/AI/SRE/InvestigationEvidenceRerun";
import NotFoundException from "../../Types/Exception/NotFoundException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Exception from "../../Types/Exception/Exception";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import {
  IncidentSecurityJson,
  ResourceSecurityJson,
  SECURITY_CONNECTION_MAX_ENTITIES,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../Types/SecurityCase/SecurityEntity";
import { SecurityLogResource } from "../../Utils/SecurityCase/SecurityConnectionMatch";
import SecurityConnections from "../Utils/SecurityEvent/Connections/SecurityConnections";
import { getLogResourceKind } from "../Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import ResourceSecurity from "../Utils/SecurityEvent/Connections/ResourceSecurity";
import IncidentSecurity from "../Utils/SecurityEvent/Connections/IncidentSecurity";
import SecurityRiskiestEntitiesReader from "../Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import { SecurityRiskiestEntities } from "../../Types/SecurityCase/SecurityEntityRisk";

// The overview's windows: cases over the last 30 days, detections over the last 14.
export const SECURITY_OVERVIEW_CASE_WINDOW_IN_DAYS: number = 30;
export const SECURITY_OVERVIEW_DETECTION_WINDOW_IN_DAYS: number = 14;

// The most rows one overview reads of each kind; beyond them its figures are the latest ones'.
export const SECURITY_OVERVIEW_ROW_LIMIT: number = 5000;

export const ENTITY_ACTIVITY_MAX_HOURS: number = 30 * 24;

export const SECURITY_CASE_NOT_FOUND_MESSAGE: string =
  "This case could not be found.";

export const SECURITY_CASE_CHANGE_REFUSED_MESSAGE: string =
  "You do not have permission to change this security case.";

/*
 * A project's case priority or status as the overview hands it to the
 * Dashboard: what its charts are labelled and coloured with, in the
 * project's order, and the built-in flags the rules read
 * (SecurityCasePriorities, SecurityCaseStatuses).
 */
export function toSecurityCaseValueJson(
  value: SecurityCasePriority | SecurityCaseStatus,
  flags: Array<string>,
): JSONObject {
  const json: JSONObject = {
    _id: value.id?.toString() || "",
    name: value.name || "",
    color: value.color?.toString() || "",
    order: typeof value.order === "number" ? value.order : null,
    isArchived: value.isArchived === true,
  };

  for (const flag of flags) {
    json[flag] = (value as unknown as Record<string, unknown>)[flag] === true;
  }

  return json;
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

// A time a request names, or nothing when it names none a person could mean.
export function readOptionalDate(
  value: JSONValue | undefined,
): Date | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 64) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

// The most log resources a request may name (an event has one).
export const MAX_REQUEST_LOG_RESOURCES: number = 5;

/*
 * The records an event's log lines were sent under, as a request names them:
 * each a kind of record the connections know and a real id, at most a few.
 */
export function readLogResources(
  value: JSONValue | undefined,
): Array<SecurityLogResource> {
  if (!Array.isArray(value)) {
    return [];
  }

  const resources: Array<SecurityLogResource> = [];

  for (const item of value) {
    if (resources.length >= MAX_REQUEST_LOG_RESOURCES) {
      break;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const type: unknown = (item as JSONObject)["type"];
    const id: unknown = (item as JSONObject)["id"];

    if (
      typeof type === "string" &&
      typeof id === "string" &&
      getLogResourceKind(type) &&
      ObjectID.isValidUUID(id)
    ) {
      resources.push({ type, id });
    }
  }

  return resources;
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
 *   POST /security-case/overview           the overview's figures, and the
 *                                          riskiest entities as Entity Risk
 *                                          ranks them
 *   POST /security-case/entity-activity    how active some values have been
 *   POST /security-case/connections        what a case or an event names in
 *                                          the rest of OneUptime (Connected
 *                                          Signals)
 *   POST /security-case/resource-security  what Security Events says about a
 *                                          host, cluster, service or member
 *   POST /security-case/incident-security  the cases behind an incident and
 *                                          naming what it affects
 *   POST /security-case/:caseId/declare-incident
 *   POST /security-case/setup/status       how security is set up
 *   POST /security-case/setup/turn-on-recommended
 *   POST /security-case/setup/test         a simulated attack, end to end
 *   POST /security-case/:caseId/ai-triage  OneUptime AI's triage of a case
 *   POST /security-case/:caseId/ai-triage/start
 *   POST /security-case/:caseId/ai-triage/evidence  the rows behind a [C#]
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
              serviceFilter: await this.getSecurityEventSourceFilter(props),
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

    /*
     * Connected Signals: what a case - or an event's or an entity's values -
     * names in the rest of OneUptime, and what is happening on it. Takes the
     * right to read security events; every record and fact is then read with
     * the caller's own permissions (a kind they cannot read is said to be).
     */
    this.router.post(
      `${basePath}/connections`,
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
          const caseId: JSONValue | undefined = body["caseId"];

          if (caseId !== undefined && caseId !== null) {
            if (typeof caseId !== "string" || !ObjectID.isValidUUID(caseId)) {
              throw new BadDataException("A valid case ID is required.");
            }

            const connections: SecurityConnectionsJson | null =
              await SecurityConnections.forCase({
                projectId,
                securityCaseId: new ObjectID(caseId),
                props,
              });

            if (!connections) {
              throw new NotFoundException("This case could not be found.");
            }

            return Response.sendJsonObjectResponse(
              req,
              res,
              connections as unknown as JSONObject,
            );
          }

          const entities: Array<SecurityEntity> = readSecurityEntities(
            body["entities"],
          ).slice(0, SECURITY_CONNECTION_MAX_ENTITIES);
          const time: Date | undefined = readOptionalDate(body["time"]);

          return Response.sendJsonObjectResponse(
            req,
            res,
            (await SecurityConnections.forEntities({
              projectId,
              entities,
              time,
              logResources: readLogResources(body["logResources"]),
              readLogResources: body["readLogResources"] === true,
              props,
            })) as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * A record's Security card: what Security Events says about one of the
     * project's hosts, clusters, devices, services or members. Takes the
     * right to read security events, and the right to read the record.
     */
    this.router.post(
      `${basePath}/resource-security`,
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
          const kind: JSONValue | undefined = body["kind"];
          const id: JSONValue | undefined = body["id"];

          if (
            typeof kind !== "string" ||
            !(Object.values(SecurityConnectionKind) as Array<string>).includes(
              kind,
            )
          ) {
            throw new BadDataException("Name the kind of record to read.");
          }

          if (typeof id !== "string" || !ObjectID.isValidUUID(id)) {
            throw new BadDataException("A valid record ID is required.");
          }

          const security: ResourceSecurityJson | null =
            await ResourceSecurity.read({
              projectId,
              kind: kind as SecurityConnectionKind,
              id: new ObjectID(id),
              props,
            });

          if (!security) {
            throw new NotFoundException("This record could not be found.");
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            security as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    // An incident's Security card: the case that declared it, and the cases naming what it affects.
    this.router.post(
      `${basePath}/incident-security`,
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
              "Reading security cases takes a Security role, or Project Owner or Project Admin.",
          });

          const incidentId: JSONValue | undefined = readBody(req)["incidentId"];

          if (
            typeof incidentId !== "string" ||
            !ObjectID.isValidUUID(incidentId)
          ) {
            throw new BadDataException("A valid incident ID is required.");
          }

          const security: IncidentSecurityJson | null =
            await IncidentSecurity.read({
              projectId,
              incidentId: new ObjectID(incidentId),
              props,
            });

          if (!security) {
            throw new NotFoundException("This incident could not be found.");
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            security as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Declaring an incident is a change of the case and the creation of an
     * incident, so it takes both: whoever may work the case and open
     * incidents in this project. OneUptime writes both as itself, so each is
     * held to the record as the caller's own write would be: the case to
     * what an update of it reaches (readCaseToChange), the incident to what
     * creating it themselves would need (declareIncidentForCase's
     * declaredBy).
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

          const securityCase: SecurityCase = await this.readCaseToChange({
            caseId: new ObjectID(caseId),
            projectId,
            props,
          });

          if (securityCase.incidentId) {
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
              securityCase,
              incidentSeverityId: severity.id,
              userId: props.userId,
              declaredBy: props,
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
     * its own. The triage writes its read on the case - a verdict, a
     * suggested priority and playbook, a report - as OneUptime, so it takes
     * a case the person may change (readCaseToChange), not only a role that
     * can work cases somewhere in the project, and everything AI needs
     * (SecurityCaseTriage). Answers with the run, or 400 with what stopped
     * it.
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

          const caseId: string | undefined = req.params["caseId"];

          if (!caseId || !ObjectID.isValidUUID(caseId)) {
            throw new BadDataException("A valid case ID is required.");
          }

          const securityCase: SecurityCase = await this.readCaseToChange({
            caseId: new ObjectID(caseId),
            projectId,
            props,
          });

          const result: SecurityCaseTriageStartResult =
            await SecurityCaseTriage.startTriage({
              projectId,
              securityCaseId: securityCase.id!,
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

    /*
     * "Load rows" for one piece of the triage's evidence: re-runs the check
     * behind a citation of the report ([C#]) with the VIEWER's own
     * permissions, as an incident's AI card does (rerunInvestigationEvidence).
     * The case is read under the viewer's props first; the run must be a
     * triage of THAT case in the tenant, so another case's run cannot be
     * replayed through this one; the tool and its arguments come from the
     * run's recorded events, never from the request; only read-only tools
     * re-run. Body: { runId, citationId: "C1" }.
     */
    this.router.post(
      `${basePath}/:caseId/ai-triage/evidence`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          // Every read and the re-run inside the tenant, never multi-tenant.
          const viewerProps: DatabaseCommonInteractionProps = {
            ...props,
            isMultiTenantRequest: false,
          };

          CommonAPI.assertCanReadTable({
            modelType: SecurityCase,
            props,
            errorMessage:
              "Reading a case's AI triage takes a Security role, or Project Owner or Project Admin.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const runIdText: string =
            typeof body["runId"] === "string"
              ? (body["runId"] as string).trim()
              : "";

          if (!ObjectID.isValidUUID(runIdText)) {
            throw new BadDataException("runId must be a valid ID.");
          }

          const citationId: string =
            typeof body["citationId"] === "string"
              ? (body["citationId"] as string).trim()
              : "";

          if (!EVIDENCE_CITATION_ID_REGEX.test(citationId)) {
            throw new BadDataException(
              'citationId must be a citation marker such as "C1".',
            );
          }

          const securityCaseId: ObjectID = await this.readCaseForTriage({
            caseId: req.params["caseId"],
            projectId,
            props: viewerProps,
          });

          const run: AIRun | null = await AIRunService.findOneBy({
            query: {
              _id: new ObjectID(runIdText),
              projectId,
              runType: AIRunType.Investigation,
              triggeredBySecurityCaseId: securityCaseId,
            },
            select: { _id: true },
            props: { isRoot: true },
          });

          if (!run) {
            throw new BadDataException(
              "This triage was not found for this case.",
            );
          }

          const events: Array<AIRunEvent> = await AIRunEventService.findBy({
            query: { aiRunId: run.id!, projectId },
            select: {
              _id: true,
              sequence: true,
              eventType: true,
              toolName: true,
              toolArguments: true,
              resultSummary: true,
              citationId: true,
              createdAt: true,
            },
            sort: { sequence: SortOrder.Ascending },
            limit: MAX_EVIDENCE_EVENTS,
            skip: 0,
            props: { isRoot: true },
          });

          const rows: InvestigationEvidenceRowsResponse =
            await rerunInvestigationEvidence({
              events,
              citationId,
              tenantId: projectId,
              viewerProps,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            rows as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  /*
   * The case a person declares an incident from, or asks OneUptime AI to
   * triage - each then written on the case by OneUptime, as itself - as
   * the caller may change it: held to what an update of it would be held to
   * (DatabaseService.findOneUpdatableById) - the case's update permissions
   * in the caller's project, a team's block on them, the labels of the
   * incident it names, and a credential that may make changes. A case they
   * may not read is not found; one they may read but not change is refused.
   */
  private async readCaseToChange(data: {
    caseId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCase> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneUpdatableById({
        id: data.caseId,
        select: {
          _id: true,
          projectId: true,
          caseNumberWithPrefix: true,
          title: true,
          description: true,
          incidentId: true,
        },
        props: data.props,
      });

    if (!securityCase) {
      const refusal: Exception =
        await SecurityCaseService.getUnwrittenByIdError({
          id: data.caseId,
          props: data.props,
          type: DatabaseRequestType.Update,
        });

      if (refusal instanceof NotFoundException) {
        throw new NotFoundException(SECURITY_CASE_NOT_FOUND_MESSAGE);
      }

      throw new NotAuthorizedException(SECURITY_CASE_CHANGE_REFUSED_MESSAGE);
    }

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: securityCase.projectId,
      projectId: data.projectId,
    });

    return securityCase;
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

  /*
   * The sources whose security events the caller may read, for the entity
   * reads that build their own SQL: what a read of the events themselves
   * keeps to (TelemetryReadAccess), so a Security role scoped to the
   * sources it owns, or to some labels, ranks and counts those sources'
   * events alone - not every source of the project.
   */
  private async getSecurityEventSourceFilter(
    props: DatabaseCommonInteractionProps,
  ): Promise<TelemetryServiceFilter> {
    return await TelemetryReadAccess.getServiceFilter({
      modelType: SecurityEvent,
      props,
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

    // The project's priorities and statuses: what the counts are by.
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(projectId);

    const caseSelect: JSONObject = {
      _id: true,
      createdAt: true,
      securityCasePriorityId: true,
      securityCaseStatusId: true,
      verdict: true,
      assignedToUserId: true,
      assignedToTeamId: true,
      acknowledgedAt: true,
      containedAt: true,
      closedAt: true,
      mitreTactics: true,
    };

    const [
      openCases,
      casesInWindow,
      detections,
      waitingRuns,
      riskiestEntities,
    ]: [
      Array<SecurityCase>,
      Array<SecurityCase>,
      Array<SecurityDetection>,
      number,
      SecurityRiskiestEntities | null,
    ] = await Promise.all([
      SecurityCaseService.findBy({
        query: {
          projectId,
          securityCaseStatusId: new Includes(
            SecurityCaseStatuses.getOpenStatusIds(values.statuses),
          ),
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
      /*
       * Riskiest Entities: the top of Entity Risk's list, by risk score.
       * Null when it could not be read - the card says so, not the page.
       */
      SecurityRiskiestEntitiesReader.read({ projectId, props }),
    ]);

    const toCaseRow: (row: SecurityCase) => OverviewCaseRow = (
      row: SecurityCase,
    ): OverviewCaseRow => {
      return {
        createdAt: row.createdAt!,
        priorityId: row.securityCasePriorityId?.toString(),
        statusId: row.securityCaseStatusId?.toString(),
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
      priorities: values.priorities,
      statuses: values.statuses,
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
      riskiestEntities: riskiestEntities as unknown as JSONObject | null,
      priorities: values.priorities.map(
        (priority: SecurityCasePriority): JSONObject => {
          return toSecurityCaseValueJson(
            priority,
            Object.values(SECURITY_CASE_PRIORITY_LEVEL_FLAGS),
          );
        },
      ),
      statuses: values.statuses.map(
        (status: SecurityCaseStatus): JSONObject => {
          return toSecurityCaseValueJson(
            status,
            Object.values(SECURITY_CASE_STAGE_FLAGS),
          );
        },
      ),
    } as JSONObject;
  }
}
