import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../Models/DatabaseModels/DataStoreFinding";
import DataSecuritySetting from "../../Models/DatabaseModels/DataSecuritySetting";
import DataSecurityIssue from "../../Models/DatabaseModels/DataSecurityIssue";
import User from "../../Models/DatabaseModels/User";
import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import {
  CalendarDay,
  findCalendarDay,
  getLastCalendarDays,
} from "../../Utils/SecurityCase/SecurityOverviewMetrics";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import SecuritySeverity from "../../Types/SecuritySeverity";
import ComplianceFramework from "../../Types/DataSecurity/ComplianceFramework";
import DataCategory, {
  ALL_DATA_CATEGORIES,
  isPersonalDataCategory,
} from "../../Types/DataSecurity/DataCategory";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "../../Types/DataSecurity/DataSensitivity";
import DataSecurityIssueStatus from "../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceResponse,
  DataSecurityExplainResult,
  DataSecurityFindingOccurrences,
  DataSecurityIssueAnalysisResult,
  DataSecurityOccurrencesUnavailableReason,
  DataSecurityOverview,
  DataSecurityOverviewIssue,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  DataSecurityResourceComplianceResponse,
  DataSecurityResourceScope,
} from "../../Types/DataSecurity/DataSecurityApiTypes";
import { getBuiltInDataType } from "../../Types/DataSecurity/DataTypeCatalog";
import DataTypeNamer from "../../Types/DataSecurity/DataTypeNamer";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../Types/DataSecurity/DataStorePosture";
import { readFindingSampleRecords } from "../../Types/DataSecurity/FindingSampleRecord";
import UserMiddleware from "../Middleware/UserAuthorization";
import CloudConnectionService from "../Services/CloudConnectionService";
import DataStoreFindingService from "../Services/DataStoreFindingService";
import DataStoreService, {
  Service as DataStoreServiceType,
} from "../Services/DataStoreService";
import DataSecurityIssueService from "../Services/DataSecurityIssueService";
import DataSecuritySettingService from "../Services/DataSecuritySettingService";
import { getDataStoreScanNowRefusalSentence } from "../../Utils/DataSecurity/DataStoreContentScanSchedule";
import { DataSecurityAiCodeRequest } from "../Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityAiReads from "../Utils/AI/DataSecurity/DataSecurityAiReads";
import DataSecurityAiSettings from "../Utils/AI/DataSecurity/DataSecurityAiSettings";
import DataSecurityCodeTask, {
  DataSecurityFixCode,
} from "../Utils/AI/DataSecurity/DataSecurityCodeTask";
import ProjectDataTypeNames from "../Utils/DataSecurity/ProjectDataTypeNames";
import DataSecurityAiProposal from "../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityAiProposals from "../Utils/AI/DataSecurity/DataSecurityAiProposals";
import { buildDataSecurityFixRequest } from "../Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import DataSecurityIssueAnalysis, {
  StoredDataSecurityIssueAnalysis,
} from "../Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueAnalysisReader from "../Utils/AI/DataSecurity/DataSecurityIssueAnalysisReader";
import { DataSecurityIssueAnalysisView } from "../../Types/DataSecurity/DataSecurityIssueAnalysis";
import { isTelemetryFindingCheck } from "../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIntegrations from "../Utils/DataSecurity/DataSecurityIntegrations";
import DataSecurityResponse from "../Utils/DataSecurity/DataSecurityResponse";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  isDataSecurityResponseAction,
} from "../../Types/DataSecurity/DataSecurityResponseAction";
import {
  queueDataSecurityConnectionRead,
  queueDataSecurityEvaluation,
  queueDataStoreScan,
} from "../Utils/DataSecurity/DataSecurityJobs";
import DataSecurityRunner, {
  getConnectionDataSecurityLevel,
} from "../Utils/DataSecurity/DataSecurityRunner";
import {
  findTelemetryFindingOccurrences,
  getOccurrenceModel,
  getOccurrenceWindow,
  getTelemetryStoreOwnerId,
  OccurrencePlan,
  planOccurrenceRead,
} from "../Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import {
  createDropRuleForFinding,
  createScrubRuleForFinding,
  CreatedScrubRule,
} from "../Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { getDropMetricImpact } from "../Utils/DataSecurity/Telemetry/TelemetryMetricDrop";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModelPermission from "../Types/AnalyticsDatabase/ModelPermission";
import AnalyticsQuery from "../Types/AnalyticsDatabase/Query";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Utils/Telemetry/TelemetryReadScope";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ResourceDataSecurity from "../Utils/DataSecurity/ResourceDataSecurity";
import NotFoundException from "../../Types/Exception/NotFoundException";
import {
  DataStoreResourceKind,
  isDataStoreResourceKind,
} from "../../Types/DataSecurity/DataStoreResource";
import ProductKey from "../../Types/Product/ProductKey";

/*
 * DATA SECURITY'S OWN ROUTES, BESIDE THE DATA STORE CRUD ROUTES.
 *
 * Everything stored has its CRUD route from BaseAPI; these answer what is
 * worked out on request (Types/DataSecurity/DataSecurityApiTypes):
 *
 *  - the Overview's figures, the compliance scores and the GDPR record of
 *    processing, for anyone who may read data stores;
 *  - a resource's own stores and compliance - a Kubernetes cluster's, a
 *    container host's, a database's, a cloud resource's or a service's
 *    (ResourceDataSecurity) - for anyone who may read data stores and
 *    that resource;
 *  - Scan Now and Check Now on a store, for anyone who may edit it;
 *  - Scrub It on a telemetry finding, for anyone who may create scrub
 *    rules, or metric pipeline rules for a metric's attribute - the rule is
 *    theirs, made under their own permissions;
 *  - a telemetry finding's newest records, read now
 *    (TelemetryFindingOccurrences), for anyone who may read its masked
 *    samples and the store's telemetry itself - its logs, traces, metrics,
 *    exceptions or sessions, as the explorers would let them;
 *  - OneUptime AI's analysis of an issue (#10369) - is it real, what it
 *    puts at risk, what the fix would break, the shortest path to fixed -
 *    for anyone who may read the issue, each fact and line of it only to
 *    who may read what it rests on (DataSecurityIssueAnalysisReader): read
 *    as the issue keeps it, with no model call; and Explain with AI, which
 *    writes one now when there is none or what it rests on changed, under
 *    the project's OneUptime AI switches and limits, keeping neither what
 *    it sent nor what OneUptime AI answered in the AI Logs, which every
 *    Project Member and Viewer reads (#10361);
 *  - Fix With AI on an issue, sending the issue, its evidence and how to
 *    fix it - and, for a telemetry issue, where in the telemetry each kind
 *    of data sits, so the fix goes in the service's code - never a
 *    finding's samples, nor a record: for anyone who may change the issue,
 *    in a repository they may change in Code, under every check a task in
 *    Code is asked (DataSecurityCodeTask, #10362). The analysis and the fix
 *    each name a data type as the project does (ProjectDataTypeNames,
 *    #10363), and build what they send through DataSecurityAiInput, the
 *    one way a Data Security prompt is made (#10365);
 *  - What OneUptime AI sees, for Settings > OneUptime AI: the model each
 *    feature runs on and the exact input one issue would send, each to who
 *    may read it (DataSecurityAiSettings);
 *  - Block public access and Revoke sharing on a cloud store, for anyone
 *    who may edit it, through the store's cloud connection and only when
 *    its "Data security response" setting is on (DataSecurityResponse) -
 *    and which of them a store can take now, for anyone who may read it;
 *  - Approve, Dismiss and Undo on what OneUptime AI proposed for an issue
 *    (#10364), for anyone who may read the proposal, each held to the
 *    permission the change itself takes (DataSecurityAiProposals).
 *
 * Every route reads only the caller's project and answers 404-like errors
 * for another project's records.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];

const OPERATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

/*
 * Who may make a scrub rule of any signal - a log or trace scrub rule, or
 * the metric pipeline rule that redacts a metric's attribute; the rule
 * itself is made with the person's own permissions, so a log rule still
 * needs the log permission, a trace rule the trace one and a metric rule
 * the metric pipeline rule one.
 */
const SCRUB_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
  Permission.CreateProjectMetricPipelineRule,
];

/*
 * Who may drop the metrics whose names hold a finding's data (#9757): who
 * may change metric pipeline rules - the Drop rule is made with the
 * person's own permissions and recorded in the audit log as theirs, and
 * removing it from the pipeline rules undoes it.
 */
const DROP_METRIC_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectMetricPipelineRule,
];

/*
 * Who may see a telemetry finding's records: who may read its masked
 * samples (DataStoreFinding's restricted columns), which they carry too.
 * The records are shown only to a reader who may read that telemetry
 * themselves as well (canReadTelemetryOf).
 */
const OCCURRENCE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.ReadDataStoreFinding,
];

const ISSUE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

/*
 * Who may ask OneUptime AI to explain an issue: who may read the issue
 * (DataSecurityIssue's read list). Its explanation spells out the issue's
 * evidence, so it is never for a reader of the store alone (#10361).
 */
export const EXPLAIN_ISSUE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityIssue,
];

/*
 * Who may press on a proposal of OneUptime AI's (#10364): who may read it,
 * the issue's readers. Each press then takes the change's own permission
 * (DataSecurityAiProposals), so a reader who may make no change is refused
 * with what it takes. Its own list, not READ_PERMISSIONS: a press acts, so
 * it is refused while the server has Data Security switched off.
 */
export const AI_PROPOSAL_PERMISSIONS: Array<Permission> = [
  ...new DataSecurityAiProposal().readRecordPermissions,
];

const TREND_DAYS: number = 30;

export default class DataSecurityAPI extends BaseAPI<
  DataStore,
  DataStoreServiceType
> {
  public constructor() {
    super(DataStore, DataStoreService);

    this.post(
      DATA_SECURITY_API_ROUTES.overview,
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await DataSecurityAPI.getOverview(
          projectId,
          /*
           * The reader's zone, which the page sends: the issue trend counts
           * the reader's days (issue #7925). One the list does not name is
           * dropped, and those days stay UTC's.
           */
          AggregationIntervalUtil.readRequestedTimezone(body["timezone"]),
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.compliance,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        _req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataSecurityAPI.getCompliance(
          projectId,
          props,
        )) as unknown as JSONObject;
      },
    );

    /*
     * A resource's Data Security and Compliance pages (#9547, #9555): the
     * stores its pages show, and how the ones whose compliance it owns
     * stand. The resource is read with the caller's own props: one they
     * may not read is not found.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.resourceScope,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const resource: { kind: DataStoreResourceKind; id: ObjectID } =
          DataSecurityAPI.readResourceRequest(req);
        const scope: DataSecurityResourceScope | null =
          await ResourceDataSecurity.readScope({
            projectId,
            kind: resource.kind,
            id: resource.id,
            props,
          });

        if (!scope) {
          throw new NotFoundException("This resource could not be found.");
        }

        return scope as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.resourceCompliance,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const resource: { kind: DataStoreResourceKind; id: ObjectID } =
          DataSecurityAPI.readResourceRequest(req);
        const compliance: DataSecurityResourceComplianceResponse | null =
          await ResourceDataSecurity.readCompliance({
            projectId,
            kind: resource.kind,
            id: resource.id,
            props,
          });

        if (!compliance) {
          throw new NotFoundException("This resource could not be found.");
        }

        return compliance as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
      READ_PERMISSIONS,
      async (projectId: ObjectID) => {
        return (await DataSecurityAPI.getRecordOfProcessing(
          projectId,
        )) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataSecurityAPI.readStoreToScan(
          projectId,
          req,
        );
        const setting: DataSecuritySetting | null =
          await DataSecuritySettingService.findOneBy({
            query: { projectId },
            select: {
              isContentScanEnabled: true,
              isTelemetryScanEnabled: true,
            },
            props: { isRoot: true },
          });

        /*
         * Scan Now scans only what a claim would hand out, by the rule the
         * store's Overview turns the button off by: never a store whose
         * scanning a person turned off, nor one nothing will scan.
         */
        const refusal: string | null = getDataStoreScanNowRefusalSentence(
          {
            store: store,
            scanProbe: store.scanProbeId ? store.scanProbe || null : undefined,
            projectSetting: setting,
          },
          store.scanProbe?.name,
        );

        if (refusal) {
          throw new BadDataException(refusal);
        }

        await DataStoreService.updateColumnsByIdWithoutHooks({
          id: store.id!,
          data: { nextContentScanAt: OneUptimeDate.getCurrentDate() },
        });

        // A probe's store waits for its probe to ask: no worker scans it.
        if (!store.scanProbeId) {
          await queueDataStoreScan({ projectId, dataStoreId: store.id! });
        }

        return {};
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
      OPERATE_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataSecurityAPI.readStore(
          projectId,
          req,
        );

        if (store.cloudConnectionId) {
          await queueDataSecurityConnectionRead({
            projectId,
            cloudConnectionId: store.cloudConnectionId,
          });
        }

        await queueDataSecurityEvaluation(projectId);

        return {};
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.responseActions(":id"),
      READ_PERMISSIONS,
      async (projectId: ObjectID, req: ExpressRequest) => {
        const store: DataStore = await DataSecurityAPI.readStore(
          projectId,
          req,
        );

        return (await DataSecurityResponse.getAvailability({
          projectId,
          dataStoreId: store.id!,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.respond(":id"),
      OPERATE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const store: DataStore = await DataSecurityAPI.readStore(
          projectId,
          req,
        );
        const body: JSONObject = (req.body || {}) as JSONObject;
        const action: unknown = body["action"];

        if (!isDataSecurityResponseAction(action)) {
          throw new BadDataException(
            `Choose one of the response actions: ${ALL_DATA_SECURITY_RESPONSE_ACTIONS.map(
              (name: string): string => {
                return `"${name}"`;
              },
            ).join(", ")}.`,
          );
        }

        const issueId: ObjectID | undefined =
          await DataSecurityAPI.readIssueOfStore(
            projectId,
            store.id!,
            body["dataSecurityIssueId"],
          );

        return (await DataSecurityResponse.run({
          projectId,
          dataStoreId: store.id!,
          action,
          userId: props.userId || undefined,
          dataSecurityIssueId: issueId,
        })) as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      SCRUB_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const finding: DataStoreFinding =
          await DataSecurityAPI.readTelemetryFinding(projectId, req);

        const created: CreatedScrubRule = await createScrubRuleForFinding({
          projectId,
          userId: props.userId || undefined,
          kind: finding.dataStore!.kind as DataStoreKind,
          dataTypeId: finding.dataTypeId!,
          dataTypeName: finding.dataTypeName,
          location: finding.location!,
          // A metric's rule is its service's.
          serviceId: finding.dataStore!.serviceId || null,
        });

        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: finding.id!,
          data: { isScrubbed: true },
        });
        await queueDataSecurityEvaluation(projectId);

        return created as unknown as JSONObject;
      },
    );

    // What dropping the metrics named with a finding's data would do (#9757).
    this.post(
      DATA_SECURITY_API_ROUTES.dropMetricImpact(":id"),
      DROP_METRIC_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const finding: DataStoreFinding =
          await DataSecurityAPI.readTelemetryFinding(projectId, req);

        return (await getDropMetricImpact({
          projectId,
          kind: finding.dataStore!.kind as DataStoreKind,
          dataTypeId: finding.dataTypeId!,
          location: finding.location!,
          serviceId: finding.dataStore!.serviceId || null,
          props,
        })) as unknown as JSONObject;
      },
    );

    /*
     * The drop itself: a metric pipeline Drop rule for the service, made as
     * the person who asked. Its data points are lost for good, so it is
     * made only when the request says so in as many words.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.dropMetric(":id"),
      DROP_METRIC_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        if (body["confirmDataLoss"] !== true) {
          throw new BadDataException(
            "Dropping these metrics loses their new data points for good. Confirm that you want them dropped.",
          );
        }

        const finding: DataStoreFinding =
          await DataSecurityAPI.readTelemetryFinding(projectId, req);
        const created: { ruleId: string; ruleName: string } =
          await createDropRuleForFinding({
            projectId,
            userId: props.userId || undefined,
            kind: finding.dataStore!.kind as DataStoreKind,
            dataTypeId: finding.dataTypeId!,
            location: finding.location!,
            serviceId: finding.dataStore!.serviceId || null,
          });

        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: finding.id!,
          data: { isScrubbed: true },
        });
        await queueDataSecurityEvaluation(projectId);

        return {
          ruleId: created.ruleId,
          ruleName: created.ruleName,
        } as unknown as JSONObject;
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.findingOccurrences(":id"),
      OCCURRENCE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return (await DataSecurityAPI.getFindingOccurrences({
          projectId,
          findingId: DataSecurityAPI.readId(req),
          props,
        })) as unknown as JSONObject;
      },
    );

    /*
     * Explain with AI (#10369): OneUptime AI's analysis of the issue - is it
     * real, what it puts at risk, what the fix would break, the shortest
     * path to fixed - as the caller may read it. The one the issue keeps
     * when nothing it rests on changed, with no model call; else one written
     * now, through the one Data Security call, which keeps neither what it
     * sent nor what OneUptime AI answered in the AI Logs (#10361); and with
     * { force: true } (Analyse Again), one written now whatever changed.
     * Kept on the issue, in the language of the person who asked when they
     * asked for a new one.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      EXPLAIN_ISSUE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        // The caller's own read first: an issue they may not read is not found.
        const issue: DataSecurityIssue =
          await DataSecurityIssueAnalysisReader.readIssue({
            projectId,
            issueId: DataSecurityAPI.readId(req),
            props,
          });
        const written: {
          analysis: StoredDataSecurityIssueAnalysis;
          isNew: boolean;
        } = await DataSecurityIssueAnalysis.analyzeForPerson({
          projectId,
          issueId: issue.id!,
          userId: props.userId || undefined,
          force: body["force"] === true,
        });
        const analysis: DataSecurityIssueAnalysisView =
          await DataSecurityIssueAnalysisReader.viewFor({
            projectId,
            dataStoreId: issue.dataStoreId,
            stored: written.analysis,
            props,
          });
        const result: DataSecurityExplainResult = {
          markdown: DataSecurityIssueAnalysisReader.toMarkdown(analysis),
          analysis,
          isNew: written.isNew,
        };

        return result as unknown as JSONObject;
      },
    );

    /*
     * The analysis the issue keeps, as the caller may read it (#10369): what
     * the issue's page shows. A read - no model call, ever - so opening the
     * page costs nothing; with the project's AI off it answers none.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.issueAnalysis(":id"),
      EXPLAIN_ISSUE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const result: DataSecurityIssueAnalysisResult = {
          analysis: await DataSecurityIssueAnalysisReader.read({
            projectId,
            issueId: DataSecurityAPI.readId(req),
            props,
          }),
        };

        return result as unknown as JSONObject;
      },
    );

    /*
     * What OneUptime AI sees (Settings > OneUptime AI, #10365): whether AI
     * is on, the model each feature runs on - to who may read the project's
     * LLM providers - and the exact input one issue would send, to who may
     * read that issue. Every part is read with the caller's own props; a
     * read, so it answers while Data Security is off on the server too.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.aiInput,
      READ_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;
        const issueId: unknown = body["issueId"];

        return (await DataSecurityAiSettings.read({
          projectId,
          props,
          withExample: body["withExample"] === true,
          issueId:
            typeof issueId === "string" && ObjectID.isValidUUID(issueId)
              ? new ObjectID(issueId)
              : undefined,
        })) as unknown as JSONObject;
      },
    );

    /*
     * A pull request that fixes the issue, asked of OneUptime AI as the
     * person who asked: in a repository they may change in Code, and only
     * when AI can work there now (DataSecurityCodeTask). A Code task, so it
     * is refused while the server has Code switched off too.
     */
    this.post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      ISSUE_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const issue: DataSecurityIssue = await DataSecurityAiReads.readIssue({
          projectId,
          issueId: DataSecurityAPI.readId(req),
        });
        const body: JSONObject = (req.body || {}) as JSONObject;

        return (await DataSecurityCodeTask.requestFix({
          props,
          projectId,
          issueIds: [issue.id!],
          // A telemetry issue is fixed in the service's code, any other in infrastructure code.
          code: isTelemetryFindingCheck(issue.checkId)
            ? DataSecurityFixCode.Service
            : DataSecurityFixCode.Infrastructure,
          requestedRepositoryId: body["codeRepositoryId"],
          // The request as DataSecurityAiInput builds it (#10365).
          buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
            return buildDataSecurityFixRequest(
              issue,
              await DataSecurityAiReads.readPlaces({ projectId, issue }),
              await ProjectDataTypeNames.read({ projectId }),
            );
          },
        })) as unknown as JSONObject;
      },
      { startsCodeWork: true },
    );

    /*
     * A proposal of OneUptime AI's (#10364): approved, dismissed or undone
     * by a person who may read it, each held to the change's own
     * permission - approving a scrub rule takes what creating one takes,
     * undoing it what deleting one takes, dismissing what changing the
     * issue takes - and made with their own props
     * (DataSecurityAiProposals).
     */
    this.post(
      DATA_SECURITY_API_ROUTES.approveAiProposal(":id"),
      AI_PROPOSAL_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return await DataSecurityAiProposals.approve({
          props,
          projectId,
          proposalId: req.params["id"],
          expectedPlanFingerprint: body["expectedPlanFingerprint"],
          expectedApprovalStep: body["expectedApprovalStep"],
        });
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.dismissAiProposal(":id"),
      AI_PROPOSAL_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        const body: JSONObject = (req.body || {}) as JSONObject;

        return await DataSecurityAiProposals.dismiss({
          props,
          projectId,
          proposalId: req.params["id"],
          reason: body["reason"],
        });
      },
    );

    this.post(
      DATA_SECURITY_API_ROUTES.undoAiProposal(":id"),
      AI_PROPOSAL_PERMISSIONS,
      async (
        projectId: ObjectID,
        req: ExpressRequest,
        props: DatabaseCommonInteractionProps,
      ) => {
        return await DataSecurityAiProposals.undo({
          props,
          projectId,
          proposalId: req.params["id"],
        });
      },
    );
  }

  private post(
    route: string,
    permissions: Array<Permission>,
    handler: (
      projectId: ObjectID,
      req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
    ) => Promise<JSONObject>,
    options: {
      // Starts a task in Code: asks OneUptime AI for a code change.
      startsCodeWork?: boolean | undefined;
    } = {},
  ): void {
    this.router.post(
      route,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      /*
       * A change or an action of Data Security - every route but its reads -
       * is refused while the server has switched it off (#7479).
       */
      ...(permissions === READ_PERMISSIONS
        ? []
        : [ServerProductRoutes.refuseWhileOff(ProductKey.DataSecurity)]),
      /*
       * And a route that starts a task in Code while Code is off, as every
       * route that asks OneUptime AI for a code change is (#9489, #10362).
       */
      ...(options.startsCodeWork
        ? [ServerProductRoutes.refuseWhileOff(ProductKey.Code)]
        : []),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions: permissions,
            errorMessage:
              "You do not have permission to do this in Data Security.",
          });

          const answer: JSONObject = await handler(projectId, req, props);

          return Response.sendJsonObjectResponse(req, res, answer);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  // The resource a resource route is asked about: { kind, id } in its body.
  private static readResourceRequest(req: ExpressRequest): {
    kind: DataStoreResourceKind;
    id: ObjectID;
  } {
    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];
    const id: string = typeof body["id"] === "string" ? body["id"].trim() : "";

    if (!isDataStoreResourceKind(kind)) {
      throw new BadDataException(
        "Name the kind of resource: a Kubernetes cluster, a Docker or Podman host, a database, a cloud resource or a service.",
      );
    }

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("A valid resource ID is required.");
    }

    return { kind, id: new ObjectID(id) };
  }

  private static readId(req: ExpressRequest): ObjectID {
    const id: string = String(req.params["id"] || "");

    if (!ObjectID.isValidUUID(id)) {
      throw new BadDataException("Not found.");
    }

    return new ObjectID(id);
  }

  /*
   * The telemetry finding a route acts on - Scrub It, Drop This Metric -
   * with its data type, its place and its store's kind and service. Another
   * project's finding, or one in a data store, is refused.
   */
  private static async readTelemetryFinding(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataStoreFinding> {
    const finding: DataStoreFinding | null =
      await DataStoreFindingService.findOneBy({
        query: { _id: DataSecurityAPI.readId(req), projectId },
        select: {
          _id: true,
          dataTypeId: true,
          // What a rule calls the type when the project no longer names it.
          dataTypeName: true,
          location: true,
          dataStoreId: true,
          dataStore: { kind: true, serviceId: true },
        },
        props: { isRoot: true },
      });

    if (!finding?.dataTypeId || !finding.location || !finding.dataStore?.kind) {
      throw new BadDataException("Finding not found.");
    }

    if (
      !TELEMETRY_DATA_STORE_KINDS.includes(
        finding.dataStore.kind as DataStoreKind,
      )
    ) {
      throw new BadDataException(
        "Scrub It masks telemetry at ingest; this finding is in a data store.",
      );
    }

    return finding;
  }

  private static async readStore(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: this.readId(req), projectId },
      select: { _id: true, cloudConnectionId: true },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    return store;
  }

  /*
   * The store Scan Now names, with what decides whether anything scans its
   * content (DataStoreContentScanSchedule): its probe read through it, as
   * the probe's claim joins it, so a deleted probe comes back as none.
   */
  private static async readStoreToScan(
    projectId: ObjectID,
    req: ExpressRequest,
  ): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: this.readId(req), projectId },
      select: {
        _id: true,
        projectId: true,
        kind: true,
        provider: true,
        isContentScanEnabled: true,
        isArchived: true,
        scanProbeId: true,
        probeConnectionVariable: true,
        scanProbe: {
          _id: true,
          name: true,
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
      },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    return store;
  }

  /*
   * The issue a response was run from, when the request names one: one of
   * this store's, in this project - never another store's, whose timeline
   * would then claim a change it did not see.
   */
  private static async readIssueOfStore(
    projectId: ObjectID,
    dataStoreId: ObjectID,
    value: unknown,
  ): Promise<ObjectID | undefined> {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException("Issue not found.");
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: new ObjectID(value), projectId, dataStoreId },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!issue?.id) {
      throw new BadDataException("Issue not found.");
    }

    return issue.id;
  }

  /*
   * The records a telemetry finding's data was seen in - the very ones the
   * last scan found it in, when the finding kept them - for a reader who
   * may read the store's telemetry; why there are none to show otherwise.
   * A finding of another project, or in a data store, is not found.
   */
  public static async getFindingOccurrences(data: {
    projectId: ObjectID;
    findingId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<DataSecurityFindingOccurrences> {
    const finding: DataStoreFinding | null =
      await DataStoreFindingService.findOneBy({
        query: { _id: data.findingId, projectId: data.projectId },
        select: {
          _id: true,
          dataTypeId: true,
          location: true,
          dataStoreId: true,
          sampleRecords: true,
          lastSeenAt: true,
          dataStore: { kind: true, serviceId: true, storeKey: true },
        },
        props: { isRoot: true },
      });

    if (!finding?.dataTypeId || !finding.location || !finding.dataStore?.kind) {
      throw new BadDataException("Finding not found.");
    }

    if (
      !TELEMETRY_DATA_STORE_KINDS.includes(
        finding.dataStore.kind as DataStoreKind,
      )
    ) {
      throw new BadDataException(
        "Only a finding in telemetry has records to show; this finding is in a data store.",
      );
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const none: (
      reason: DataSecurityOccurrencesUnavailableReason,
    ) => DataSecurityFindingOccurrences = (
      reason: DataSecurityOccurrencesUnavailableReason,
    ): DataSecurityFindingOccurrences => {
      return {
        occurrences: [],
        since: getOccurrenceWindow(now).since.toISOString(),
        until: now.toISOString(),
        recordsRead: 0,
        isComplete: true,
        unavailableReason: reason,
      };
    };
    const plan: OccurrencePlan | null = planOccurrenceRead(
      finding.dataStore.kind,
      finding.location,
    );

    if (!plan) {
      return none(DataSecurityOccurrencesUnavailableReason.UnreadableLocation);
    }

    const ownerId: string | null = getTelemetryStoreOwnerId(finding.dataStore);

    if (!ownerId) {
      return none(DataSecurityOccurrencesUnavailableReason.NoOwner);
    }

    if (
      !(await DataSecurityAPI.canReadTelemetryOf({
        projectId: data.projectId,
        plan,
        ownerId,
        props: data.props,
      }))
    ) {
      return none(DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess);
    }

    return await findTelemetryFindingOccurrences({
      projectId: data.projectId,
      plan,
      ownerId,
      location: finding.location,
      dataTypeId: finding.dataTypeId,
      options: (await DataSecurityRunner.getScanSetup(data.projectId)).options,
      sampleRecords: readFindingSampleRecords(finding.sampleRecords),
      lastSeenAt: finding.lastSeenAt
        ? OneUptimeDate.fromString(finding.lastSeenAt)
        : null,
      now,
    });
  }

  /*
   * Whether the reader may read this owner's records of the plan's signal
   * themselves: the table's read permission (ModelPermission), and the
   * resources their grants reach (TelemetryReadAccess) - its labels, its
   * owners, and a company AI tool's conversations for owners and admins
   * only - as the explorers decide it when the record is opened.
   */
  public static async canReadTelemetryOf(data: {
    projectId: ObjectID;
    plan: OccurrencePlan;
    ownerId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    const modelType: { new (): AnalyticsBaseModel } = getOccurrenceModel(
      data.plan.source,
    );

    try {
      await AnalyticsModelPermission.checkReadPermission(
        modelType,
        {
          projectId: data.projectId,
          primaryEntityId: new ObjectID(data.ownerId),
        } as AnalyticsQuery<AnalyticsBaseModel>,
        null,
        data.props,
      );

      const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
        modelType,
        data.props,
      );

      return TelemetryReadScopeUtil.isReadable(scope, data.ownerId);
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        return false;
      }

      throw error;
    }
  }

  public static async getOverview(
    projectId: ObjectID,
    // The zone the reader's days are in; UTC's days when undefined.
    timezone?: Timezone | undefined,
  ): Promise<DataSecurityOverview> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        kind: true,
        sensitivity: true,
        sensitivityOverride: true,
        dataCategories: true,
        exposure: true,
        configurationReadAt: true,
        contentScannedAt: true,
      },
      skip: 0,
      limit: 10000,
      props: { isRoot: true },
    });
    const storesBySensitivity: Record<DataSensitivity, number> = {
      [DataSensitivity.Restricted]: 0,
      [DataSensitivity.Confidential]: 0,
      [DataSensitivity.Internal]: 0,
      [DataSensitivity.Public]: 0,
    };
    const byCategory: Map<DataCategory, number> = new Map();
    let exposedSensitive: number = 0;
    let evaluated: number = 0;
    let contentScanned: number = 0;

    for (const store of stores) {
      const sensitivity: DataSensitivity =
        (store.sensitivityOverride as DataSensitivity | undefined) ||
        (store.sensitivity as DataSensitivity | undefined) ||
        DataSensitivity.Public;

      storesBySensitivity[sensitivity]++;

      for (const category of store.dataCategories || []) {
        byCategory.set(category, (byCategory.get(category) || 0) + 1);
      }

      if (
        DATA_SENSITIVITY_RANK[sensitivity] >=
          DATA_SENSITIVITY_RANK[DataSensitivity.Confidential] &&
        (store.exposure === DataStoreExposure.Public ||
          store.exposure === DataStoreExposure.OtherAccounts)
      ) {
        exposedSensitive++;
      }

      if (store.configurationReadAt || store.contentScannedAt) {
        evaluated++;
      }

      if (store.contentScannedAt) {
        contentScanned++;
      }
    }

    /*
     * The last TREND_DAYS days of the reader's calendar, today's included
     * (UTC's when the request named no zone): walked a day at a time in
     * their zone, so a day the clocks change on is one bar of 23 or 25
     * hours, never two bars or none (issue #7925). The first is the day
     * TREND_DAYS - 1 days before today on that calendar, stepped in that
     * zone: stepped on the server's own calendar it was an hour off across
     * a clock change on a server outside UTC (issue #8236).
     */
    const now: Date = OneUptimeDate.getCurrentDate();
    const trendDays: Array<CalendarDay> = getLastCalendarDays(
      now,
      TREND_DAYS,
      timezone,
    );
    // What the trend counts: from the start of its first day.
    const since: Date = new Date(trendDays[0]!.startMs);
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: { projectId },
        select: {
          _id: true,
          title: true,
          severity: true,
          riskScore: true,
          status: true,
          checkId: true,
          firstDetectedAt: true,
          resolvedAt: true,
          dataStoreId: true,
          dataStore: { name: true },
        },
        skip: 0,
        limit: 20000,
        props: { isRoot: true },
      });
    const openIssuesBySeverity: Record<SecuritySeverity, number> = {
      [SecuritySeverity.Critical]: 0,
      [SecuritySeverity.High]: 0,
      [SecuritySeverity.Medium]: 0,
      [SecuritySeverity.Low]: 0,
    };
    const trend: Map<string, { opened: number; resolved: number }> = new Map();

    for (const { day } of trendDays) {
      trend.set(day, { opened: 0, resolved: 0 });
    }

    // The trend's entry for the day `date` falls on, if it is one of them.
    const entryOn: (
      date: Date,
    ) => { opened: number; resolved: number } | undefined = (
      date: Date,
    ): { opened: number; resolved: number } | undefined => {
      const day: CalendarDay | undefined = findCalendarDay(trendDays, date);

      return day ? trend.get(day.day) : undefined;
    };

    const open: Array<DataSecurityIssue> = [];

    for (const issue of issues) {
      if (issue.status === DataSecurityIssueStatus.Open && issue.severity) {
        openIssuesBySeverity[issue.severity]++;
        open.push(issue);
      }

      if (issue.firstDetectedAt && issue.firstDetectedAt >= since) {
        const entry: { opened: number; resolved: number } | undefined = entryOn(
          issue.firstDetectedAt,
        );

        if (entry) {
          entry.opened++;
        }
      }

      if (issue.resolvedAt && issue.resolvedAt >= since) {
        const entry: { opened: number; resolved: number } | undefined = entryOn(
          issue.resolvedAt,
        );

        if (entry) {
          entry.resolved++;
        }
      }
    }

    const topIssues: Array<DataSecurityOverviewIssue> = open
      .sort((a: DataSecurityIssue, b: DataSecurityIssue) => {
        return (b.riskScore || 0) - (a.riskScore || 0);
      })
      .slice(0, 5)
      .map((issue: DataSecurityIssue): DataSecurityOverviewIssue => {
        return {
          issueId: issue.id!.toString(),
          title: issue.title || "",
          severity: issue.severity || SecuritySeverity.Low,
          riskScore: issue.riskScore || 0,
          checkId: issue.checkId || "",
          dataStoreId: issue.dataStoreId?.toString() || "",
          dataStoreName: issue.dataStore?.name || "",
        };
      });

    const telemetryStoreIds: Set<string> = new Set(
      stores
        .filter((store: DataStore) => {
          return TELEMETRY_DATA_STORE_KINDS.includes(
            store.kind as DataStoreKind,
          );
        })
        .map((store: DataStore) => {
          return store.id!.toString();
        }),
    );
    let telemetryFindings: number = 0;
    let unscrubbed: number = 0;

    if (telemetryStoreIds.size > 0) {
      const findings: Array<DataStoreFinding> =
        await DataStoreFindingService.findBy({
          query: { projectId, isSuppressed: false },
          select: { dataStoreId: true, isScrubbed: true, matchCount: true },
          skip: 0,
          limit: 50000,
          props: { isRoot: true },
        });

      for (const finding of findings) {
        if (
          telemetryStoreIds.has(finding.dataStoreId?.toString() || "") &&
          finding.matchCount
        ) {
          telemetryFindings++;

          if (!finding.isScrubbed) {
            unscrubbed++;
          }
        }
      }
    }

    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: { projectId },
        select: { _id: true, config: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });

    return {
      storeCount: stores.length,
      evaluatedStoreCount: evaluated,
      contentScannedStoreCount: contentScanned,
      storesBySensitivity,
      storesByCategory: ALL_DATA_CATEGORIES.map((category: DataCategory) => {
        return { category, storeCount: byCategory.get(category) || 0 };
      }).filter((entry: { category: DataCategory; storeCount: number }) => {
        return entry.storeCount > 0;
      }),
      exposedSensitiveStoreCount: exposedSensitive,
      openIssuesBySeverity,
      topIssues,
      issueTrend: [...trend.entries()].map(
        ([day, counts]: [string, { opened: number; resolved: number }]) => {
          return { day, opened: counts.opened, resolved: counts.resolved };
        },
      ),
      telemetryFindingCount: telemetryFindings,
      unscrubbedTelemetryFindingCount: unscrubbed,
      connectionsWithoutContentAccess: connections.filter(
        (connection: CloudConnection) => {
          return (
            getConnectionDataSecurityLevel(connection.config) !== "content"
          );
        },
      ).length,
      hasCloudConnection: connections.length > 0,
    };
  }

  /*
   * Every framework, scored over the project's stores and their open
   * issues, with what each store's resource turned off
   * (ResourceDataSecurity, Types/DataSecurity/ComplianceScope) - and,
   * for a reader, why and by whom, each resource named as they may see it
   * (#9629).
   */
  public static async getCompliance(
    projectId: ObjectID,
    props?: DatabaseCommonInteractionProps | undefined,
  ): Promise<DataSecurityComplianceResponse> {
    return {
      frameworks: await ResourceDataSecurity.readProjectCompliance(
        projectId,
        props,
      ),
    };
  }

  public static async getRecordOfProcessing(
    projectId: ObjectID,
  ): Promise<DataSecurityRecordOfProcessingResponse> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        name: true,
        kind: true,
        provider: true,
        region: true,
        environment: true,
        sensitivity: true,
        sensitivityOverride: true,
        dataCategories: true,
        dataTypeIds: true,
        purpose: true,
        retention: true,
      },
      skip: 0,
      limit: 10000,
      props: { isRoot: true },
    });
    const rows: Array<DataSecurityRecordOfProcessingRow> = [];
    /*
     * What an auditor reads each data type as: the project's own by the name
     * it gave it, one it deleted as deleted - never an id (#10363). Read as
     * OneUptime, as the stores are, once for the whole record.
     */
    const dataTypeNamer: DataTypeNamer = await ProjectDataTypeNames.read({
      projectId,
    });

    for (const store of stores) {
      const categories: Array<DataCategory> = store.dataCategories || [];

      if (!categories.some(isPersonalDataCategory)) {
        continue;
      }

      const owners: Array<User> = await DataSecurityIntegrations.getOwnerUsers(
        store.id!,
      );
      const frameworks: Set<ComplianceFramework> = new Set();

      for (const dataTypeId of store.dataTypeIds || []) {
        for (const framework of getBuiltInDataType(dataTypeId)?.frameworks ||
          []) {
          frameworks.add(framework);
        }
      }

      const typeNames: Array<string> = dataTypeNamer.namesOf(store.dataTypeIds);

      rows.push({
        dataStoreId: store.id!.toString(),
        name: store.name || "",
        kind: store.kind || "",
        provider: store.provider || "",
        region: store.region || "",
        environment: store.environment || "",
        sensitivity:
          (store.sensitivityOverride as DataSensitivity | undefined) ||
          (store.sensitivity as DataSensitivity | undefined) ||
          DataSensitivity.Public,
        dataCategories: categories,
        dataTypeNames: typeNames,
        owners: owners.map((owner: User) => {
          return owner.name?.toString() || owner.email?.toString() || "";
        }),
        purpose: store.purpose || "",
        retention: store.retention || "",
        frameworks: [...frameworks],
      });
    }

    return { rows };
  }
}
