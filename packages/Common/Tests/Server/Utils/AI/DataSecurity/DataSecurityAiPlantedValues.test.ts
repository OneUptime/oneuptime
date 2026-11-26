jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../../../Server/API/DataSecurityAPI";
import Queue from "../../../../../Server/Infrastructure/Queue";
import UserMiddleware from "../../../../../Server/Middleware/UserAuthorization";
import AIService, {
  ProjectAiDailyLimitStatus,
} from "../../../../../Server/Services/AIService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../../Server/Services/CodeRepositoryService";
import DataAssetService from "../../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../../Server/Services/DataAssetUsageService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityFlowService from "../../../../../Server/Services/DataSecurityFlowService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import LlmLogService from "../../../../../Server/Services/LlmLogService";
import LogService from "../../../../../Server/Services/LogService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import RumSessionService from "../../../../../Server/Services/RumSessionService";
import TelemetrySourceMapService from "../../../../../Server/Services/TelemetrySourceMapService";
import CodeFixOnItsWay from "../../../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import ProductionReviewScope from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewScope";
import LlmProviderService from "../../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import CodeFixReadiness from "../../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DataSecurityAiInput, {
  DataSecurityAiPrompt,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import DataSecurityFieldSuggestion from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestion";
import DataSecurityAiEngine from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiEngine";
import DataSecurityFindingVerdicts from "../../../../../Server/Utils/AI/DataSecurity/FindingVerdicts";
import DataTypeDiscovery from "../../../../../Server/Utils/AI/DataSecurity/DataTypeDiscovery";
import DataTypeFromSentence from "../../../../../Server/Utils/AI/DataSecurity/DataTypeFromSentence";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ServiceOwnerTeamService from "../../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import DataStoreOwnerPlanner from "../../../../../Server/Utils/AI/DataSecurity/DataStoreOwnerPlanner";
import ScrubRuleWriter from "../../../../../Server/Utils/AI/DataSecurity/ScrubRuleWriter";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  readScrubPlanFindingRecord,
  ScrubPlanFindingRecord,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlan";
import { describeScrubPlace } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubShapes";
import { getScrubTarget } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubRuleWriterPlace } from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import { ScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import {
  DATA_STORE_FOR_OWNER_PLAN_SELECT,
  DataStoreForOwnerPlan,
} from "../../../../../Server/Utils/AI/DataSecurity/Owners/DataStoreOwnerSelects";
import DeclaredCodeOwner from "../../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import { DataStoreOwnerDirectory } from "../../../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import DataSecurityIssueAnalysis from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import PullRequestLeakReview from "../../../../../Server/Utils/AI/DataSecurity/PullRequestLeakReview";
import { CodeHostChangedFile } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import ProductionReviewSensitiveData from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewSensitiveData";
import * as TelemetryScrubCoverage from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  ProductionReviewLeakJSON,
  ProductionReviewSensitiveDataJSON,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  QueryDataSecurityIssuesTool,
  QueryDataStoreAccessTool,
  QueryDataStoresTool,
} from "../../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import DataSecurityFindingWriter from "../../../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import DataSecurityResponse from "../../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { toStoredFieldSuggestionState } from "../../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../../Server/Utils/Express";
import LLMService, {
  LLMCompletionRequest,
} from "../../../../../Server/Utils/LLM/LLMService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import DataSecurityIssueGroupService from "../../../../../Server/Services/DataSecurityIssueGroupService";
import DataSecurityIssueGroupNaming from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupNaming";
import AuditEvidenceDrafter from "../../../../../Server/Utils/AI/DataSecurity/AuditEvidenceDrafter";
import ImpactAssessmentDrafter from "../../../../../Server/Utils/AI/DataSecurity/ImpactAssessmentDrafter";
import ExposureAssessmentDrafter from "../../../../../Server/Utils/AI/DataSecurity/ExposureAssessmentDrafter";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseTaskService from "../../../../../Server/Services/SecurityCaseTaskService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import {
  ExposureAssessmentStarter,
  startExposureAssessment,
  toStoredExposureAssessmentJson,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import { getDataStoreEntityValue } from "../../../../../Types/SecurityCase/SecurityEntity";
import RecordOfProcessingDrafter from "../../../../../Server/Utils/AI/DataSecurity/RecordOfProcessingDrafter";
import DataSecuritySettingService from "../../../../../Server/Services/DataSecuritySettingService";
import DataSecurityComplianceSettingService from "../../../../../Server/Services/DataSecurityComplianceSettingService";
import DeclaredDataStores from "../../../../../Server/Utils/DataSecurity/DeclaredDataStores";
import ResourceDataSecurity from "../../../../../Server/Utils/DataSecurity/ResourceDataSecurity";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import ComplianceFramework, {
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../../../Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "../../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import { DeclaredCodeOwnerReason } from "../../../../../Utils/AiRemediation/DeclaredCodeChange";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import { DATA_SECURITY_API_ROUTES } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
} from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import LlmType from "../../../../../Types/LLM/LlmType";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { CodeRepositoryRunnerChoiceKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A VALUE PLANTED IN EVERY COLUMN THAT HOLDS ONE NEVER REACHES ONEUPTIME AI
 * (#10365).
 *
 * The issue says it outright: plant a masked sample, a record and a
 * connection string on an issue, and find none of them in any feature's
 * input. So here a store, its issues, its findings and who can reach it are
 * rows held in memory with a value planted in every column that holds one
 * - a finding's masked samples and the records it was seen in, the store's
 * connection string, a cloud connection's secret, a log's body - and each
 * Data Security AI feature runs its real path over them:
 *
 *   - Explain with AI and Fix with AI over HTTP, through the routes, the
 *     permission layer, the reads for AI and the builder, to the model
 *     (LLMService) and to the Code task (CodeTaskRuns.start);
 *   - the field suggestions, from the store's scan state to the model;
 *   - the verdicts on findings that wait for a person (#10372), from the
 *     store's findings and the team's decisions on findings like them;
 *   - Ask AI's three Data Security tools, to the text the chat reads.
 *
 * Every byte each one sends is searched for every planted value. A
 * feature added to DATA_SECURITY_AI_FEATURES without a run here fails, and
 * the search itself is shown to find a planted value in a prompt that
 * carries one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10365000-0000-4000-8000-000000000001",
);
const STORE_ID: string = "10365000-0000-4000-8000-0000000000b1";
const TELEMETRY_STORE_ID: string = "10365000-0000-4000-8000-0000000000b2";
// A second store that keeps the same unknown kind of value (#10371).
const DATABASE_STORE_ID: string = "10365000-0000-4000-8000-0000000000b3";
const BUCKET_ISSUE_ID: string = "10365000-0000-4000-8000-0000000000a1";
const TELEMETRY_ISSUE_ID: string = "10365000-0000-4000-8000-0000000000a2";
const INFRA_ID: string = "10365000-0000-4000-8000-0000000000c1";
const RUN_ID: ObjectID = new ObjectID("10365000-0000-4000-8000-0000000000f1");
// A group of issues one mistake made, the bucket's among them (#10370).
const GROUP_ID: string = "10370000-0000-4000-8000-0000000000d1";

function groupRow(): StoredRow {
  return {
    _id: GROUP_ID,
    projectId: PROJECT_ID.toString(),
    groupKey: "public-read|aws|tag:module=card-exports",
    checkId: "public-read",
    cause: "DeclaredCode",
    facts: {
      cause: "DeclaredCode",
      checkId: "public-read",
      tag: ["module", "card-exports"],
      tagRole: "Module",
      code: {
        repositoryId: INFRA_ID,
        repositoryName: "acme/infra",
        paths: ["modules/card-exports/main.tf"],
        codeKind: "Terraform",
        reason: "has-named-file",
      },
      storeKind: "AWS S3 Bucket",
      provider: "aws",
      managedAsCode: "Terraform",
    },
    name: null,
    nameFactsHash: null,
    issueCount: 1,
    openIssueCount: 1,
    codeTaskId: null,
  };
}

// The bucket, declared by the module, and its issue in the group.
function useIssueGroupTables(): void {
  useInMemoryTable(asService(DataSecurityIssueGroupService), [groupRow()]);
  useInMemoryTable(
    asService(DataSecurityIssueService),
    issueRows().map((row: StoredRow): StoredRow => {
      return row["_id"] === BUCKET_ISSUE_ID
        ? { ...row, dataSecurityIssueGroupId: GROUP_ID }
        : row;
    }),
  );
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID, {
      cloudTags: { module: "card-exports", "managed-by": "terraform" },
    }),
  ]);
}

// The service whose telemetry the store of logs is (#10376).
const CHECKOUT_SERVICE_ID: string = "10365000-0000-4000-8000-0000000000e9";
// What production knows that a pull request's diff does not: never sent.
const SCRUB_RULE_NAME: string = "PLANTED-SCRUB-RULE mask checkout emails";

// The database a pull request's migration adds a column to a table of (#10779).
const ORDERS_DB_ID: string = "10779000-0000-4000-8000-0000000000b1";
const ORDERS_DB_NAME: string = "PLANTED-STORE-NAME orders-db";

// An analysis of an issue, as OneUptime AI answers one (#10369).
const ANALYSIS_ANSWER: string = JSON.stringify({
  verdict: "Real",
  reason: { text: "Anyone can read what the store holds.", facts: ["S2"] },
});

// The planted values: what a record keeps of the data, and the secrets.
const PLANTED: Readonly<Record<string, string>> = {
  maskedSample: "PLANTED-MASKED-j***@e******.com",
  maskedCard: "PLANTED-MASKED-****-****-****-4242",
  sampleRecordTrace: "PLANTED-RECORD-4bf92f3577b34da6a3ce929d0e0e4736",
  sampleRecordLog: "PLANTED-RECORD-LOG-0192f1a0",
  connectionString:
    "postgres://planted_user:PLANTED-PASSWORD@orders-db.internal:5432/orders",
  logBody: "PLANTED-LOG-BODY user=alice@example.com card=4111111111111111",
  cloudSecret: "PLANTED-CLOUD-SECRET",
  description: "PLANTED-DESCRIPTION a person wrote",
  scanCursor: "PLANTED-SCAN-CURSOR",
  acceptedReason: "PLANTED-ACCEPTED-REASON",
  suppressedReason: "PLANTED-SUPPRESSED-REASON",
};

// What each feature sent: every message, request and tool result.
function plantedIn(sent: string): Array<string> {
  return Object.entries(PLANTED)
    .filter(([, planted]: [string, string]): boolean => {
      return sent.includes(planted) || sent.includes(planted.slice(0, 16));
    })
    .map(([name]: [string, string]): string => {
      return name;
    });
}

// The store, with what holds a value planted.
function storeRow(id: string, data: Partial<StoredRow> = {}): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: "acme-card-exports",
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-north-1",
    environment: "Production",
    sensitivity: "Restricted",
    providerResourceId: "arn:aws:s3:::acme-card-exports",
    dataTypeIds: ["credit-card-number", "email-address"],
    exposure: "Public",
    riskScore: 91,
    openIssueCount: 2,
    isArchived: false,
    connectionString: PLANTED["connectionString"],
    description: PLANTED["description"],
    contentScanState: { cursor: PLANTED["scanCursor"] },
    ...data,
  };
}

function issueRows(): Array<StoredRow> {
  return [
    {
      _id: BUCKET_ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Anyone on the internet can read it",
      checkId: "public-read",
      checkGroup: "Exposure",
      evidence: "The bucket policy grants s3:GetObject to Principal *.",
      severity: "Critical",
      status: "Open",
      riskScore: 91,
      dataTypeIds: ["credit-card-number"],
      dataStoreId: STORE_ID,
      acceptedReason: PLANTED["acceptedReason"],
      dataStore: storeRow(STORE_ID),
    },
    {
      _id: TELEMETRY_ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Sensitive data is reaching your telemetry",
      checkId: "sensitive-data-in-telemetry",
      checkGroup: "Telemetry",
      evidence: "1 kind of sensitive data is not scrubbed: Email address.",
      severity: "High",
      status: "Open",
      riskScore: 70,
      dataTypeIds: ["email-address"],
      dataStoreId: TELEMETRY_STORE_ID,
      dataStore: storeRow(TELEMETRY_STORE_ID, {
        name: "checkout · Logs",
        kind: "Telemetry Logs",
        provider: "oneuptime",
      }),
    },
  ];
}

function findingRows(): Array<StoredRow> {
  return [
    {
      _id: "10365000-0000-4000-8000-0000000000d1",
      projectId: PROJECT_ID.toString(),
      dataStoreId: TELEMETRY_STORE_ID,
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      location: "attributes.user.email",
      locationKind: "Attribute",
      confidence: "High",
      matchCount: 41,
      valueCount: 50,
      distinctValues: 33,
      isScrubbed: false,
      isSuppressed: false,
      isConfirmed: false,
      isAiSuggested: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedSample"]],
      sampleRecords: [
        {
          time: new Date().toISOString(),
          traceId: PLANTED["sampleRecordTrace"],
          logId: PLANTED["sampleRecordLog"],
        },
      ],
      suppressedReason: PLANTED["suppressedReason"],
      // A record's body, where no column should hold one.
      body: PLANTED["logBody"],
    },
    {
      _id: "10365000-0000-4000-8000-0000000000d2",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "credit-card-number",
      dataTypeName: "Card number",
      location: "exports/*.csv",
      locationKind: "Object pattern",
      confidence: "High",
      matchCount: 120,
      valueCount: 200,
      distinctValues: 118,
      isScrubbed: false,
      isSuppressed: false,
      isAiSuggested: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedCard"]],
    },
    {
      // An AI suggestion a person has not judged, as field suggestions read.
      _id: "10365000-0000-4000-8000-0000000000d3",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "email-address",
      location: "public.customers.kontakt",
      locationKind: "Column",
      confidence: "Low",
      isAiSuggested: true,
      isConfirmed: false,
      isSuppressed: false,
      maskedSamples: [PLANTED["maskedSample"]],
    },
  ];
}

/*
 * The team's decision on a finding like the bucket's suggestion, on a third
 * store (#10372): the one column of a finding a verdict is told as a person
 * wrote it, the reason, with a value of its own typed into it. The verdict
 * is told the words, never the values.
 */
const CRM_STORE_ID: string = "10372000-0000-4000-8000-0000000000b3";
const REASON_WORDS: string = "Our support inbox, not a customer";
const REASON_EMAIL: string = "support@acme-shop.com";
const REASON_NUMBER: string = "48151623421";

function precedentRows(): Array<StoredRow> {
  return [
    {
      _id: "10372000-0000-4000-8000-0000000000d4",
      projectId: PROJECT_ID.toString(),
      dataStoreId: CRM_STORE_ID,
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      location: "crm.customers.kontakt",
      locationKind: "Column",
      confidence: "Medium",
      matchCount: 30,
      valueCount: 40,
      isSuppressed: true,
      isConfirmed: false,
      isAiSuggested: false,
      suppressedReason: `${REASON_WORDS}: ${REASON_EMAIL}, ticket ${REASON_NUMBER}`,
      decidedAt: new Date(),
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedSample"]],
      sampleRecords: [
        {
          time: new Date().toISOString(),
          traceId: PLANTED["sampleRecordTrace"],
          logId: PLANTED["sampleRecordLog"],
        },
      ],
      body: PLANTED["logBody"],
    },
  ];
}

function accessRows(): Array<StoredRow> {
  return [
    {
      _id: "10365000-0000-4000-8000-0000000000e1",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: "arn:aws:iam::210987654321:role/partner",
      principalName: "partner",
      principalType: "Role",
      accessLevel: "Read",
      grantedVia: "Bucket policy",
      isExternal: true,
      isPublic: false,
      isSeenInTraces: false,
      accessKey: PLANTED["cloudSecret"],
    },
  ];
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function passSessionGuards(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
}

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

let server: DashboardRequestsOverHttp;
let completion: SpyInstance<typeof LLMService.getCompletion>;
let started: SpyInstance<typeof CodeTaskRuns.start>;

// Every message the model was sent, as text.
function sentToTheModel(): string {
  return completion.mock.calls
    .map((call: Array<unknown>): string => {
      return JSON.stringify((call[0] as LLMCompletionRequest).messages);
    })
    .join("\n");
}

beforeAll(async () => {
  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  await server.start([new DataSecurityAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return OWNER;
    });

  useInMemoryTable(asService(DataSecurityIssueService), issueRows());
  useInMemoryTable(asService(DataStoreFindingService), findingRows());
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID, {
      fieldSuggestionState: toStoredFieldSuggestionState({
        pending: [
          {
            location: "public.customers.kundennr",
            locationKind: "Column",
            neighbours: ["name", "email"],
            shapes: [{ shape: "AA-999999", share: 1 }],
            valueCount: 40,
            averageLength: 9,
          },
        ],
        answers: {},
      }),
    }),
    storeRow(TELEMETRY_STORE_ID, {
      name: "checkout · Logs",
      kind: "Telemetry Logs",
      provider: "oneuptime",
    }),
  ]);
  // Written as one statement the tables in memory do not run: what it saves is no input.
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  useInMemoryTable(asService(DataStoreAccessService), accessRows());
  // What else an issue's analysis reads (#10369): none of it here.
  useInMemoryTable(asService(DataSecurityFlowService), []);
  useInMemoryTable(asService(DataSecurityAiProposalService), []);
  useInMemoryTable(asService(DataStoreOwnerUserService), []);
  useInMemoryTable(asService(DataStoreOwnerTeamService), []);
  jest
    .spyOn(DataSecurityResponse, "getAvailability")
    .mockResolvedValue({ actions: [] });
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en");
  // Written as one statement the tables in memory do not run: what it saves is no input.
  jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);
  useInMemoryTable(asService(LlmLogService), []);
  useInMemoryTable(asService(CodeRepositoryService), [
    {
      _id: INFRA_ID,
      projectId: PROJECT_ID.toString(),
      name: "infra",
      repositoryHostedAt: CodeRepositoryType.GitHub,
      organizationName: "acme",
      repositoryName: "infra",
      mainBranchName: "main",
      labels: [],
    },
  ]);

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);

  // OneUptime AI on, with the project's own model.
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);
  jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
    id: ObjectID.generate(),
    name: "The project's provider",
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1",
    isGlobalLlm: false,
  } as unknown as LlmProvider);
  completion = jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
    content: '{"fields":[]}',
    usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
  });

  // What a Code task's gate reads: a connected repository, a Runner, room left.
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(
      async (data: {
        repositoryIds: Array<ObjectID>;
      }): Promise<Map<string, CodeHostConnectionSummary>> => {
        return new Map(
          data.repositoryIds.map(
            (id: ObjectID): [string, CodeHostConnectionSummary] => {
              return [
                id.toString(),
                {
                  connectionId: null,
                  provider: CodeRepositoryType.GitHub,
                  hostUrl: null,
                  hostProduct: null,
                  accountLogin: "acme",
                  credentialHint: null,
                  state: CodeHostConnectionState.Connected,
                  isReachableFromServer: true,
                },
              ];
            },
          ),
        );
      },
    );
  jest
    .spyOn(CodeFixReadiness, "getLlmProviderCheck")
    .mockImplementation(async () => {
      return {
        id: "llmProvider",
        ok: true,
        title: "An LLM provider is available",
        detail: "",
      } as never;
    });
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async (): Promise<ProjectAiDailyLimitStatus | null> => {
      return null;
    });
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockImplementation(async (): Promise<CodeRepositoryRunnerStatus> => {
      return {
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      };
    });
  started = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async (): Promise<AIRun> => {
      return new AIRun(RUN_ID);
    });

  // A field suggestion's setup, and what it writes.
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockImplementation((async () => {
      return {
        setting: { disabledDataTypeIds: [] },
        options: {},
        customTypes: new Map(),
      };
    }) as never);
  jest
    .spyOn(DataSecurityFindingWriter, "recordFieldSuggestions")
    .mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
  passSessionGuards();
});

async function post(
  route: string,
  body: JSONObject = {},
): Promise<SentRequest> {
  return await server.request("POST", `/api${route}`, body);
}

// What a scan reads with: the limits its sample is cut to.
const SCAN_OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date(Date.now() + 60 * 60 * 1000),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "planted-values",
};

// The records a scrub rule is proven on, with a value planted in each (#10366).
function plantedLogRows(): Array<JSONObject> {
  // Enough values for a place to be described at all (MIN_UNPLACED_VALUES).
  return Array.from({ length: 6 }, (_value: unknown, index: number) => {
    return {
      ownerId: "10365000-0000-4000-8000-0000000000e9",
      recordTime: 1795000000000 + index,
      readLogId:
        index === 0
          ? PLANTED["sampleRecordLog"]
          : `10365000-0000-4000-8000-00000000070${index}`,
      readAttributes: [
        [
          "user.email",
          index % 2 === 0 ? PLANTED["logBody"] : PLANTED["maskedSample"],
        ],
      ],
    } as JSONObject;
  });
}

/*
 * Each feature's run over the planted rows, and everything it sent.
 * The group's two features (#10370), over the same planted rows.
 */
const nameIssueGroupRun: () => Promise<string> = async (): Promise<string> => {
  useIssueGroupTables();
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutomaticDataSecurityAi: true,
  } as unknown as Project);
  completion.mockResolvedValue({
    content: JSON.stringify({
      name: "the card-exports module leaves its buckets public",
      facts: ["F1", "F2"],
    }),
    usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
  });

  await DataSecurityIssueGroupNaming.nameGroups({
    projectId: PROJECT_ID,
    groupIds: [new ObjectID(GROUP_ID)],
  });

  expect(completion).toHaveBeenCalledTimes(1);

  return sentToTheModel();
};

const fixIssueGroupRun: () => Promise<string> = async (): Promise<string> => {
  useIssueGroupTables();
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingForGroup")
    .mockResolvedValue(0);
  jest.spyOn(DeclaredCodeOwner, "findCandidates").mockResolvedValue([
    {
      repository: {
        id: INFRA_ID,
        name: "infra",
        organizationName: "acme",
        repositoryName: "infra",
      },
      reason: DeclaredCodeOwnerReason.HasNamedFile,
      matchedPaths: ["modules/card-exports/main.tf"],
      score: 10,
    },
  ] as never);
  const queued: SpyInstance<typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun> =
    jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(new AIRun(RUN_ID));

  const sent: SentRequest = await post(
    DATA_SECURITY_API_ROUTES.fixIssueGroup(GROUP_ID),
    { parts: ["PullRequest"], codeRepositoryId: INFRA_ID },
  );

  expect(sent.status).toBe(200);
  expect(queued).toHaveBeenCalledTimes(1);

  return JSON.stringify(queued.mock.calls[0]![0]);
};

/*
 * A service's telemetry leaks, fixed in its code (#10367): Fix with AI on
 * the service's telemetry issue, over HTTP - its leaks read from the
 * finding, located from the records it was seen in (planted with values
 * where a record keeps them: the line it logged, its ids), placed in the
 * repository and planned - to the Code task it queues. The records name
 * one line of code read with two different values: only its template, the
 * values masked, may go.
 */
function plantedLeakRows(): Array<JSONObject> {
  return [
    {
      recordTime: 1795000000000,
      readLogId: PLANTED["sampleRecordLog"],
      readFile1: "/usr/src/app/src/signup.js",
      readLine1: "12",
      readFunction1: "signUp",
      readScope: "checkout",
      readBody: `Signed up ${PLANTED["maskedSample"]} from ${PLANTED["sampleRecordTrace"]}`,
    },
    {
      recordTime: 1795000000001,
      readLogId: "10367000-0000-4000-8000-000000000701",
      readFile1: "/usr/src/app/src/signup.js",
      readLine1: "12",
      readFunction1: "signUp",
      readScope: "checkout",
      readBody: `Signed up ${PLANTED["cloudSecret"]} from ${PLANTED["scanCursor"]}`,
    },
  ];
}

const fixTelemetryLeaksRun: () => Promise<string> =
  async (): Promise<string> => {
    useInMemoryTable(asService(ServiceService), [
      {
        _id: CHECKOUT_SERVICE_ID,
        projectId: PROJECT_ID.toString(),
        name: "checkout",
      },
    ]);
    useInMemoryTable(asService(DataStoreService), [
      storeRow(STORE_ID),
      storeRow(TELEMETRY_STORE_ID, {
        name: "checkout · Logs",
        // DataStoreKind.TelemetryLogs: the service's own logs.
        kind: "Logs",
        provider: "oneuptime",
        serviceId: CHECKOUT_SERVICE_ID,
      }),
    ]);
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockResolvedValue({ rules: [] } as never);
    // The records the finding was seen in, as the locator's read returns them.
    const recordReads: SpyInstance<typeof LogService.executeQuery> = jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: plantedLeakRows() };
        },
      } as never);
    // The project's one repository, whose tree holds the file the records name.
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([
        {
          id: INFRA_ID,
          name: "infra",
          organizationName: "acme",
          repositoryName: "infra",
          mainBranchName: "main",
          gitHubAppInstallationId: null,
          repositoryHostedAt: CodeRepositoryType.GitHub,
        },
      ]);
    jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
      .mockResolvedValue(["package.json", "src/signup.js", "src/telemetry.js"]);
    jest
      .spyOn(ProductionReviewScope, "get")
      .mockResolvedValue({ services: [] } as never);
    jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null);
    jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
      .mockResolvedValue(0);
    const queued: SpyInstance<
      typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun
    > = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(new AIRun(RUN_ID));

    const sent: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(TELEMETRY_ISSUE_ID),
    );

    expect(sent.status).toBe(200);
    expect(recordReads).toHaveBeenCalled();
    expect(queued).toHaveBeenCalledTimes(1);

    const asked: string = JSON.stringify(queued.mock.calls[0]![0]);

    // One line of code, read with two values: only its words are left.
    expect(asked).toContain("Signed up <value> from <value>");

    return asked;
  };

/*
 * The compliance paperwork (#10375), over the planted rows: the bucket as a
 * store of personal data about many people, its record drafted on its own
 * and on request, its impact assessment, and SOC 2's evidence with the
 * bucket's issue an accepted risk.
 */
function usePaperworkTables(): void {
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID, {
      dataCategories: ["Contact and identity", "Financial"],
      estimatedRecords: 2000000,
    }),
  ]);
  useInMemoryTable(asService(ServiceService), []);
  useInMemoryTable(asService(DataSecuritySettingService), []);
  useInMemoryTable(asService(DataSecurityComplianceSettingService), []);
  jest
    .spyOn(DeclaredDataStores, "declareBeforeRead")
    .mockResolvedValue(undefined);
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
}

/*
 * A security case Data Security opened for the bucket's exposure, assessed
 * (#10377): its store holds a secret whose finding keeps a planted sample,
 * and the case keeps the assessment's start.
 */
const EXPOSURE_CASE_ID: string = "10377000-0000-4000-8000-0000000000c1";
const EXPOSURE_STORE_KEY: string = "aws:s3:acme-card-exports";

function useExposureTables(): void {
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID, {
      storeKey: EXPOSURE_STORE_KEY,
      dataCategories: ["Contact and identity", "Financial"],
      estimatedRecords: 2000000,
      subjectCountries: ["DE"],
      posture: { accessLogging: false },
    }),
  ]);

  const cases: InMemoryTable = useInMemoryTable(
    asService(SecurityCaseService),
    [
      {
        _id: EXPOSURE_CASE_ID,
        projectId: PROJECT_ID.toString(),
        entities: [
          {
            type: "Data Store",
            value: getDataStoreEntityValue(EXPOSURE_STORE_KEY),
          },
        ],
        exposureAssessment: toStoredExposureAssessmentJson(
          startExposureAssessment({
            dataStoreId: STORE_ID,
            startedBy: ExposureAssessmentStarter.DataSecurity,
            language: "en",
            now: new Date(),
          }),
        ),
      },
    ],
  );

  useInMemoryHookFreeWrites(asService(SecurityCaseService), cases);
  useInMemoryTable(
    asService(DataSecurityIssueService),
    issueRows().map((row: StoredRow): StoredRow => {
      return row["_id"] === BUCKET_ISSUE_ID
        ? {
            ...row,
            securityCaseId: EXPOSURE_CASE_ID,
            firstDetectedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          }
        : row;
    }),
  );
  useInMemoryTable(asService(DataStoreFindingService), [
    ...findingRows(),
    {
      _id: "10377000-0000-4000-8000-0000000000d5",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "aws-secret-access-key",
      dataTypeName: "AWS secret access key",
      dataCategory: "Secrets and credentials",
      location: "deploy/env.sh",
      locationKind: "Object path",
      confidence: "High",
      isSuppressed: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["cloudSecret"]],
      sampleRecords: [
        {
          time: new Date().toISOString(),
          traceId: PLANTED["sampleRecordTrace"],
          logId: PLANTED["sampleRecordLog"],
        },
      ],
    },
  ]);
  useInMemoryTable(asService(DataSecurityIssueFeedService), []);
  useInMemoryTable(asService(DataStoreFeedService), []);
  useInMemoryTable(asService(SecurityCaseTaskService), []);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ChangeEventService, "executeQuery")
    .mockRejectedValue(new Error("No change log in this test."));
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
    .mockResolvedValue(null);
}

const draftRecordRun: (
  feature:
    | DataSecurityAiFeature.DraftRecord
    | DataSecurityAiFeature.DraftRecordOnRequest,
) => Promise<string> = async (
  feature:
    | DataSecurityAiFeature.DraftRecord
    | DataSecurityAiFeature.DraftRecordOnRequest,
): Promise<string> => {
  usePaperworkTables();

  await RecordOfProcessingDrafter.draftStore({
    projectId: PROJECT_ID,
    dataStoreId: new ObjectID(STORE_ID),
    feature,
    ...(feature === DataSecurityAiFeature.DraftRecordOnRequest
      ? { userId: OWNER.userId as ObjectID }
      : {}),
    dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
  });

  expect(completion).toHaveBeenCalledTimes(1);

  return sentToTheModel();
};

const RUNS: Record<DataSecurityAiFeature, () => Promise<string>> = {
  // An exposure's write-up on its own, as its case opens (#10377).
  [DataSecurityAiFeature.DraftExposureAssessment]:
    async (): Promise<string> => {
      useExposureTables();

      await ExposureAssessmentDrafter.draftOnItsOwn({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(EXPOSURE_CASE_ID),
      });

      expect(completion).toHaveBeenCalledTimes(1);

      return sentToTheModel();
    },
  // ...and when a person asks on the case's card.
  [DataSecurityAiFeature.DraftExposureAssessmentOnRequest]:
    async (): Promise<string> => {
      useExposureTables();

      // An answer it cannot hold is refused after the call: what was sent is the test.
      await ExposureAssessmentDrafter.draftForPerson({
        projectId: PROJECT_ID,
        securityCaseId: new ObjectID(EXPOSURE_CASE_ID),
        props: OWNER,
      }).catch((): void => {
        // Nothing held from '{"fields":[]}'.
      });

      expect(completion).toHaveBeenCalledTimes(1);

      return sentToTheModel();
    },
  [DataSecurityAiFeature.DraftRecord]: async (): Promise<string> => {
    return await draftRecordRun(DataSecurityAiFeature.DraftRecord);
  },
  [DataSecurityAiFeature.DraftRecordOnRequest]: async (): Promise<string> => {
    return await draftRecordRun(DataSecurityAiFeature.DraftRecordOnRequest);
  },
  [DataSecurityAiFeature.DraftImpactAssessment]: async (): Promise<string> => {
    usePaperworkTables();

    // An answer it cannot read is refused after the call: what was sent is the test.
    await ImpactAssessmentDrafter.draftForPerson({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
      props: OWNER,
    }).catch((): void => {
      // Nothing drafted from '{"fields":[]}'.
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  [DataSecurityAiFeature.DraftAuditEvidence]: async (): Promise<string> => {
    usePaperworkTables();
    useInMemoryTable(
      asService(DataSecurityIssueService),
      issueRows().map((row: StoredRow): StoredRow => {
        return row["_id"] === BUCKET_ISSUE_ID
          ? {
              ...row,
              status: "Accepted",
              acceptedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            }
          : row;
      }),
    );
    jest
      .spyOn(ResourceDataSecurity, "readProjectCompliance")
      .mockResolvedValue([
        {
          framework: ComplianceFramework.SOC2,
          fullName:
            COMPLIANCE_FRAMEWORK_INFO[ComplianceFramework.SOC2].fullName,
          scope: COMPLIANCE_FRAMEWORK_INFO[ComplianceFramework.SOC2].scope,
          score: 0,
          storesInScope: 1,
          storesTurnedOff: 0,
          requirements: [
            {
              requirement: "CC6.1",
              title: "Logical access security",
              status: ComplianceRequirementStatus.Failing,
              checkIds: ["public-read"],
              failingIssueCount: 1,
            },
          ],
          turnedOff: [],
        },
      ] as never);
    jest
      .spyOn(ResourceDataSecurity, "readProjectSettings")
      .mockResolvedValue([]);
    jest.spyOn(ResourceDataSecurity, "toScopedStores").mockResolvedValue([
      {
        id: STORE_ID,
        owner: null,
        input: {
          id: STORE_ID,
          dataTypeIds: ["credit-card-number", "email-address"],
          isEvaluated: true,
        },
      },
    ]);

    await AuditEvidenceDrafter.draftForPerson({
      projectId: PROJECT_ID,
      framework: ComplianceFramework.SOC2,
      periodInDays: 90,
      props: OWNER,
    }).catch((): void => {
      // Nothing drafted from '{"fields":[]}'.
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  [DataSecurityAiFeature.ExplainIssue]: async (): Promise<string> => {
    completion.mockResolvedValue({
      content: ANALYSIS_ANSWER,
      usage: { promptTokens: 900, completionTokens: 60, totalTokens: 960 },
    });

    for (const issueId of [BUCKET_ISSUE_ID, TELEMETRY_ISSUE_ID]) {
      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.explainIssue(issueId),
      );

      expect(sent.status).toBe(200);
    }

    expect(completion).toHaveBeenCalledTimes(2);

    return sentToTheModel();
  },
  // OneUptime AI's own analysis of each new issue (#10364), as its queue job runs it.
  [DataSecurityAiFeature.AnalyzeIssue]: async (): Promise<string> => {
    jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue(null);
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null);
    completion.mockResolvedValue({
      content: ANALYSIS_ANSWER,
      usage: { promptTokens: 900, completionTokens: 60, totalTokens: 960 },
    });

    for (const issueId of [BUCKET_ISSUE_ID, TELEMETRY_ISSUE_ID]) {
      const outcome: { analyzed: boolean } =
        await DataSecurityIssueAnalysis.analyze({
          projectId: PROJECT_ID,
          issue: { id: new ObjectID(issueId) } as DataSecurityIssue,
          dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
        });

      expect(outcome.analyzed).toBe(true);
    }

    expect(completion).toHaveBeenCalledTimes(2);

    return sentToTheModel();
  },
  [DataSecurityAiFeature.FixIssue]: async (): Promise<string> => {
    for (const issueId of [BUCKET_ISSUE_ID, TELEMETRY_ISSUE_ID]) {
      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.fixIssueWithAi(issueId),
      );

      expect(sent.status).toBe(200);
    }

    expect(started).toHaveBeenCalledTimes(2);

    return started.mock.calls
      .map((call: Array<unknown>): string => {
        return JSON.stringify(call[0]);
      })
      .join("\n");
  },
  [DataSecurityAiFeature.SuggestFieldTypes]: async (): Promise<string> => {
    await DataSecurityFieldSuggestion.suggestForStore({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  // Owners for the bucket (#10374): its tags, read with every column planted.
  [DataSecurityAiFeature.ProposeStoreOwners]: async (): Promise<string> => {
    jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue(null);
    jest.spyOn(DeclaredCodeOwner, "findCandidates").mockResolvedValue([]);
    jest.spyOn(ChangeEventService, "executeQuery").mockResolvedValue({
      json: async () => {
        return { data: [] };
      },
    } as never);
    useInMemoryTable(asService(DataStoreService), [
      storeRow(STORE_ID, { cloudTags: { team: "payments" } }),
    ]);
    useInMemoryTable(asService(DataStoreOwnerUserService), []);
    useInMemoryTable(asService(DataStoreOwnerTeamService), []);
    useInMemoryTable(asService(ServiceService), []);
    useInMemoryTable(asService(ServiceOwnerUserService), []);
    useInMemoryTable(asService(ServiceOwnerTeamService), []);

    const store: DataStoreForOwnerPlan | null =
      await DataStoreService.findOneBy({
        query: { _id: new ObjectID(STORE_ID), projectId: PROJECT_ID },
        select: DATA_STORE_FOR_OWNER_PLAN_SELECT,
        props: { isRoot: true },
      });

    await DataStoreOwnerPlanner.plan({
      projectId: PROJECT_ID,
      store: store!,
      isSensitive: true,
      directory: new DataStoreOwnerDirectory({
        people: [],
        teams: [
          { id: "10365000-0000-4000-8000-0000000000c9", name: "Payments" },
        ],
        grantsByTeam: new Map(),
      }),
      dataTypeNamer: DataTypeNamer.withoutCustomTypes(),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  /*
   * Scrub rules for what Scrub It cannot cover (#10366): the finding's own
   * records - every value at its place planted - read into shapes, then
   * the writer's call.
   */
  [DataSecurityAiFeature.WriteScrubRules]: async (): Promise<string> => {
    jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue(null);
    completion.mockResolvedValue({
      content: '{"rules":[]}',
      usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
    });

    const target: ScrubTarget = getScrubTarget(
      DataStoreKind.TelemetryLogs,
      "attributes.user.email",
    )!;
    const record: ScrubPlanFindingRecord | null =
      await readScrubPlanFindingRecord({
        projectId: PROJECT_ID,
        findingId: "10365000-0000-4000-8000-0000000000d1",
        kind: DataStoreKind.TelemetryLogs,
        target: target as ScrubTarget & { signal: "log" },
      });

    expect(record).not.toBeNull();

    const place: ScrubRuleWriterPlace | null = await describeScrubPlace({
      projectId: PROJECT_ID,
      ref: "P1",
      finding: record!,
      dataTypeName: "Email address",
      serviceId: "10365000-0000-4000-8000-0000000000e9",
      options: SCAN_OPTIONS,
      readRows: async (): Promise<Array<JSONObject>> => {
        return plantedLogRows();
      },
      readNeighbours: async (): Promise<Array<string>> => {
        return ["http.route", "user.id"];
      },
    });

    expect(place).not.toBeNull();
    expect(
      (await ScrubRuleWriter.write({ projectId: PROJECT_ID, places: [place!] }))
        .kind,
    ).toBe("written");
    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  /*
   * A pull request's sensitive data (#10376), as a production review reads
   * it: the section from the diff and what production knows - the bucket
   * the Terraform names, where the service's logs held emails, the scrub
   * rule that masks them - then OneUptime AI's read of the section.
   */
  [DataSecurityAiFeature.ReviewPullRequests]: async (): Promise<string> => {
    useInMemoryTable(asService(DataStoreService), [
      storeRow(STORE_ID),
      storeRow(TELEMETRY_STORE_ID, {
        name: "checkout · Logs",
        // DataStoreKind.TelemetryLogs: the service's own logs.
        kind: "Logs",
        provider: "oneuptime",
        serviceId: CHECKOUT_SERVICE_ID,
      }),
      // The database a migration's table is in (#10779), every column planted.
      storeRow(ORDERS_DB_ID, {
        name: ORDERS_DB_NAME,
        kind: "AWS RDS Instance",
        providerResourceId: "arn:aws:rds:eu-north-1:123456789012:db:orders",
        dataTypeIds: ["us-ssn", "date-of-birth"],
        exposure: "Internet reachable",
        posture: { readAt: new Date().toISOString(), encryptedAtRest: false },
      }),
    ]);
    useInMemoryTable(asService(DataStoreFindingService), [
      ...findingRows(),
      {
        _id: "10779000-0000-4000-8000-0000000000d1",
        projectId: PROJECT_ID.toString(),
        dataStoreId: ORDERS_DB_ID,
        dataTypeId: "date-of-birth",
        dataTypeName: "Date of birth",
        sensitivity: "Confidential",
        location: "public.customers.birthday",
        locationKind: "Column",
        confidence: "High",
        matchCount: 40,
        valueCount: 50,
        isScrubbed: false,
        isSuppressed: false,
        isConfirmed: false,
        isAiSuggested: false,
        lastSeenAt: new Date(),
        maskedSamples: [PLANTED["maskedSample"]],
        suppressedReason: PLANTED["suppressedReason"],
      },
    ]);
    useInMemoryTable(asService(DataAssetService), []);
    useInMemoryTable(asService(DataAssetUsageService), []);
    jest.spyOn(TelemetryScrubCoverage, "getScrubCoverage").mockResolvedValue({
      rules: [
        {
          id: "10365000-0000-4000-8000-0000000000e8",
          name: SCRUB_RULE_NAME,
          signal: "log",
          patternType: LogScrubPatternType.Email,
          fieldsToScrub: LogScrubField.Both,
        },
      ],
    } as never);
    completion.mockResolvedValue({
      content: JSON.stringify({
        candidates: [
          { id: "L1", keep: true, text: "", fix: "" },
          { id: "L2", keep: true, text: "", fix: "" },
        ],
      }),
      usage: { promptTokens: 700, completionTokens: 40, totalTokens: 740 },
    });

    const files: Array<CodeHostChangedFile> = [
      {
        filename: "services/checkout/src/signup.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: [
          "@@ -10,2 +10,3 @@",
          " export async function signup(customer: Customer): Promise<void> {",
          '+  logger.info("signup", { email: customer.email });',
          "   await customers.create(customer);",
        ].join("\n"),
      },
      {
        filename: "infra/exports.tf",
        status: "added",
        additions: 4,
        deletions: 0,
        patch: [
          "@@ -0,0 +1,4 @@",
          '+resource "aws_s3_bucket_acl" "exports" {',
          '+  bucket = "acme-card-exports"',
          '+  acl    = "public-read"',
          "+}",
        ].join("\n"),
      },
      {
        filename: "db/migrations/20261124_add_customer_ssn.sql",
        status: "added",
        additions: 1,
        deletions: 0,
        patch: [
          "@@ -0,0 +1,1 @@",
          "+ALTER TABLE customers ADD COLUMN date_of_birth DATE;",
        ].join("\n"),
      },
    ];

    const section: ProductionReviewSensitiveDataJSON =
      await ProductionReviewSensitiveData.find({
        projectId: PROJECT_ID,
        files,
        services: [
          {
            id: CHECKOUT_SERVICE_ID,
            name: "checkout",
            method: "stack-trace",
            evidence: "",
            pathInRepository: null,
          },
        ],
        isFailOn: true,
        now: new Date(),
        // A private repository's: what Data Security knows of its table too.
        isRepositoryPrivate: async (): Promise<boolean> => {
          return true;
        },
      });

    // What production knows is on the section, for the comment and the page.
    expect(
      section.points.map((point: ProductionReviewLeakJSON) => {
        return point.production;
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          store: expect.objectContaining({ name: "acme-card-exports" }),
        }),
        expect.objectContaining({
          heldBefore: [
            expect.objectContaining({ location: "attributes.user.email" }),
          ],
          maskedAtIngestBy: SCRUB_RULE_NAME,
        }),
        expect.objectContaining({
          store: expect.objectContaining({
            name: ORDERS_DB_NAME,
            exposure: "Internet reachable",
            isNotEncryptedAtRest: true,
          }),
          table: expect.objectContaining({
            name: "public.customers",
            sameData: [
              expect.objectContaining({
                location: "public.customers.birthday",
              }),
            ],
          }),
        }),
      ]),
    );

    await PullRequestLeakReview.read({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      pullRequestTitle: "Export cards for finance",
      section,
      files: files.map((file: CodeHostChangedFile) => {
        return { path: file.filename, patch: file.patch };
      }),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    const sent: string = sentToTheModel();

    // None of it reaches the model: only the diff and the rules' points.
    for (const knownOnlyByProduction of [
      "checkout · Logs",
      "attributes.user.email",
      SCRUB_RULE_NAME,
      "Card number",
      "Restricted",
      // A migration's table (#10779): its store, its columns, what it holds.
      ORDERS_DB_NAME,
      "public.customers",
      "birthday",
      "Internet reachable",
      "not encrypted at rest",
      "isNotEncryptedAtRest",
    ]) {
      expect({
        knownOnlyByProduction,
        sent: sent.includes(knownOnlyByProduction),
      }).toEqual({ knownOnlyByProduction, sent: false });
    }

    return sent;
  },
  [DataSecurityAiFeature.AskAi]: async (): Promise<string> => {
    const ctx: ToolContext = { projectId: PROJECT_ID, props: { isRoot: true } };
    const results: Array<ToolExecutionResult> = [
      await QueryDataStoresTool.execute({}, ctx),
      await QueryDataStoresTool.execute({ dataStoreId: STORE_ID }, ctx),
      await QueryDataStoresTool.execute(
        { dataStoreId: TELEMETRY_STORE_ID },
        ctx,
      ),
      await QueryDataSecurityIssuesTool.execute({}, ctx),
      await QueryDataSecurityIssuesTool.execute(
        { dataSecurityIssueId: TELEMETRY_ISSUE_ID },
        ctx,
      ),
      /*
       * A principal's reach is read with a text search the tables in
       * memory do not answer; its row is the builder's
       * (reachableStoreRow), planted in DataSecurityAiInput.test.ts.
       */
      await QueryDataStoreAccessTool.execute({ dataStoreId: STORE_ID }, ctx),
    ];

    return results
      .map((result: ToolExecutionResult): string => {
        return result.dataForLlm;
      })
      .join("\n");
  },
  [DataSecurityAiFeature.NameIssueGroup]: nameIssueGroupRun,
  [DataSecurityAiFeature.FixIssueGroup]: fixIssueGroupRun,
  [DataSecurityAiFeature.FixTelemetryLeaks]: fixTelemetryLeaksRun,
  /*
   * The verdicts (#10372): the bucket's suggestion waits for a person, and
   * the team's decision on a field of the same name on another store is
   * its precedent - read with every column planted, its own included.
   */
  [DataSecurityAiFeature.JudgeFindings]: async (): Promise<string> => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
      enableAutomaticDataSecurityAi: true,
    } as unknown as Project);
    useInMemoryTable(asService(DataStoreFindingService), [
      ...findingRows(),
      ...precedentRows(),
    ]);
    useInMemoryTable(asService(DataStoreService), [
      storeRow(STORE_ID),
      storeRow(CRM_STORE_ID, {
        name: "crm-eu",
        kind: "PostgreSQL",
        provider: "aws",
      }),
    ]);
    // No AI rule: the project's defaults, which suggest.
    jest.spyOn(DataSecurityAiEngine, "readRules").mockResolvedValue([]);
    // Written as one statement the tables in memory do not run: what it saves is no input.
    jest
      .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    completion.mockResolvedValue({
      content: JSON.stringify({
        findings: [
          {
            ref: "F1",
            verdict: "NotSensitive",
            reason: "Your team marked kontakt not sensitive on another store.",
            precedent: ["P1"],
            draft: "The support inbox, as on crm-eu.",
          },
        ],
      }),
      usage: { promptTokens: 300, completionTokens: 40, totalTokens: 340 },
    });

    await DataSecurityFindingVerdicts.judgeStore({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  /*
   * The company's own data types (#10371): three fields no detector placed,
   * in two stores whose every column that holds a value is planted, grouped
   * and drafted from their names and shapes.
   */
  [DataSecurityAiFeature.DraftDataTypes]: async (): Promise<string> => {
    const unplaced: (location: string) => JSONObject = (
      location: string,
    ): JSONObject => {
      return {
        location,
        locationKind: "Column",
        neighbours: ["name", "email"],
        shapes: [{ shape: "AA-999999", share: 1 }],
        valueCount: 40,
        averageLength: 9,
      };
    };

    useInMemoryTable(asService(DataStoreService), [
      storeRow(STORE_ID, {
        fieldSuggestionState: toStoredFieldSuggestionState({
          pending: [
            unplaced("public.customers.kundennr"),
            unplaced("public.orders.kundennr"),
          ] as never,
          answers: {},
        }),
      }),
      storeRow(DATABASE_STORE_ID, {
        name: "orders-db",
        kind: "PostgreSQL",
        fieldSuggestionState: toStoredFieldSuggestionState({
          pending: [unplaced("crm.accounts.kundennr")] as never,
          answers: {},
        }),
      }),
    ]);
    jest
      .spyOn(DataSecuritySettingService, "getOrCreateForProject")
      .mockResolvedValue({ contentScanIntervalInHours: 24 } as never);
    completion.mockResolvedValue({
      content: JSON.stringify({
        dataType: null,
        reason: "A customer number of the company's own.",
      }),
      usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
    });

    await DataTypeDiscovery.runForProject({
      projectId: PROJECT_ID,
      now: new Date(),
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
  // Describe It on the data type form (#10371): a sentence and its examples' shapes.
  [DataSecurityAiFeature.DescribeDataType]: async (): Promise<string> => {
    completion.mockResolvedValue({
      content: JSON.stringify({
        dataType: {
          name: "Customer number",
          description: "A customer number, such as AA-999999.",
          category: "Contact and identity",
          sensitivity: "Confidential",
          pattern: "\\b[A-Z]{2}-?\\d{6}\\b",
          keywords: ["customer"],
          nameHints: ["kundennr"],
        },
        reason: "As described.",
      }),
      usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
    });

    await DataTypeFromSentence.draft({
      projectId: PROJECT_ID,
      userId: OWNER.userId,
      sentence:
        "Our customer numbers look like AB-123456, sometimes without the dash.",
      exampleShapes: ["AA-999999", "AA999999"],
    });

    expect(completion).toHaveBeenCalledTimes(1);

    return sentToTheModel();
  },
};

/*
 * What a feature sends on purpose, though no other may (#10375): what a
 * store is for, as its team described it, which the record of processing
 * and the impact assessment are drafted from; and why a risk was accepted,
 * as the person who accepted it wrote it for an auditor, which the audit
 * evidence cites. Each is cleaned, held to a length and marked as data
 * (customerText), as every text a person wrote is, and each feature's
 * catalog entry says it is sent. Every other planted value stays out.
 */
const SENT_ON_PURPOSE: Partial<Record<DataSecurityAiFeature, Array<string>>> = {
  [DataSecurityAiFeature.DraftRecord]: ["description"],
  [DataSecurityAiFeature.DraftRecordOnRequest]: ["description"],
  [DataSecurityAiFeature.DraftImpactAssessment]: ["description"],
  [DataSecurityAiFeature.DraftAuditEvidence]: ["acceptedReason"],
};

// What each feature is for, which its input must still carry.
const WHAT_EACH_SENDS: Record<DataSecurityAiFeature, Array<string>> = {
  // The store, its exposure and the secret to rotate, by type and where (#10377).
  [DataSecurityAiFeature.DraftExposureAssessment]: [
    "acme-card-exports",
    "Anyone on the internet can read it",
    "deploy/env.sh",
    "GDPR Article 33",
  ],
  [DataSecurityAiFeature.DraftExposureAssessmentOnRequest]: [
    "acme-card-exports",
    "Anyone on the internet can read it",
    "deploy/env.sh",
    "GDPR Article 33",
  ],
  // The store, what it holds and how many: what its purpose is drafted from.
  [DataSecurityAiFeature.DraftRecord]: [
    "acme-card-exports",
    "Card number",
    "eu-north-1",
  ],
  [DataSecurityAiFeature.DraftRecordOnRequest]: [
    "acme-card-exports",
    "Card number",
    "eu-north-1",
  ],
  // The record's and the store's open issues, which its risks are.
  [DataSecurityAiFeature.DraftImpactAssessment]: [
    "acme-card-exports",
    "Anyone on the internet can read it",
    "Card number",
  ],
  // The requirement, the store in its scope and the risk accepted under it.
  [DataSecurityAiFeature.DraftAuditEvidence]: [
    "CC6.1",
    "acme-card-exports",
    "Anyone on the internet can read it",
  ],
  [DataSecurityAiFeature.ExplainIssue]: [
    "acme-card-exports",
    "attributes.user.email",
    "The bucket policy grants s3:GetObject",
  ],
  [DataSecurityAiFeature.AnalyzeIssue]: [
    "acme-card-exports",
    "attributes.user.email",
    "The bucket policy grants s3:GetObject",
  ],
  [DataSecurityAiFeature.FixIssue]: [
    "acme-card-exports",
    "attributes.user.email",
    "Open a pull request.",
  ],
  [DataSecurityAiFeature.SuggestFieldTypes]: [
    "public.customers.kundennr",
    "AA-999999",
  ],
  [DataSecurityAiFeature.AskAi]: [
    "acme-card-exports",
    "attributes.user.email",
    "arn:aws:iam::210987654321:role/partner",
  ],
  [DataSecurityAiFeature.ProposeStoreOwners]: [
    "acme-card-exports",
    "Payments",
    "cloud tag",
  ],
  // The group's facts, never a store's name (#10370).
  [DataSecurityAiFeature.NameIssueGroup]: ["card-exports", "Terraform"],
  // The module, and each store and issue its one pull request fixes.
  [DataSecurityAiFeature.FixIssueGroup]: [
    "acme-card-exports",
    "modules/card-exports/main.tf",
    "FixInfrastructureCode",
  ],
  // The place, its type, the names beside it and the values' shapes - never a value.
  [DataSecurityAiFeature.WriteScrubRules]: [
    "attributes.user.email",
    "Email address",
    "http.route",
    "aaaaa@aaaaaaa.aaa",
  ],
  // Where the service's code writes the data, its key and its type (#10367).
  [DataSecurityAiFeature.FixTelemetryLeaks]: [
    "src/signup.js",
    "user.email",
    "Email address",
    "FixSensitiveDataInTelemetry",
  ],
  // The diff's own words: the line it writes, the bucket it opens.
  [DataSecurityAiFeature.ReviewPullRequests]: [
    "customer.email",
    "acme-card-exports",
    "public-read",
  ],
  // The finding that waits, and the decision on one like it, in the person's words.
  [DataSecurityAiFeature.JudgeFindings]: [
    "public.customers.kontakt",
    "crm.customers.kontakt",
    REASON_WORDS,
  ],
  // The group's fields, by where each is, and their shape - never a value.
  [DataSecurityAiFeature.DraftDataTypes]: [
    "public.customers.kundennr",
    "crm.accounts.kundennr",
    "AA-999999",
  ],
  // The person's sentence, and their examples' shapes.
  [DataSecurityAiFeature.DescribeDataType]: ["customer numbers", "AA-999999"],
};

describe("no feature's input carries a value planted where a record keeps one", () => {
  test("every Data Security AI feature has a run here", () => {
    expect(Object.keys(RUNS).sort()).toEqual(
      DATA_SECURITY_AI_FEATURES.map(
        (info: DataSecurityAiFeatureInfo): string => {
          return info.feature;
        },
      ).sort(),
    );
  });

  test.each(Object.keys(RUNS))("%s", async (feature: string) => {
    const sent: string = await RUNS[feature as DataSecurityAiFeature]();

    expect({
      feature,
      planted: plantedIn(sent).filter((name: string): boolean => {
        return !(
          SENT_ON_PURPOSE[feature as DataSecurityAiFeature] || []
        ).includes(name);
      }),
    }).toEqual({
      feature,
      planted: [],
    });
    // It sent what it is for.
    for (const fact of WHAT_EACH_SENDS[feature as DataSecurityAiFeature]) {
      expect({ feature, fact, sent: sent.includes(fact) }).toEqual({
        feature,
        fact,
        sent: true,
      });
    }
  });

  test("the reads for AI never even select what holds a value", async () => {
    const issueReads: SpyInstance<typeof DataSecurityIssueService.findOneBy> =
      jest.spyOn(DataSecurityIssueService, "findOneBy");
    const findingReads: SpyInstance<typeof DataStoreFindingService.findBy> =
      jest.spyOn(DataStoreFindingService, "findBy");

    await RUNS[DataSecurityAiFeature.ExplainIssue]();
    await RUNS[DataSecurityAiFeature.FixIssue]();

    const selects: string = [
      ...issueReads.mock.calls,
      ...findingReads.mock.calls,
    ]
      .map((call: Array<unknown>): string => {
        return JSON.stringify((call[0] as { select?: unknown }).select || {});
      })
      .join("\n");

    for (const column of [
      "maskedSamples",
      "sampleRecords",
      "connectionString",
      "secrets",
      "description",
      "acceptedReason",
      "suppressedReason",
    ]) {
      expect({ column, selected: selects.includes(`"${column}"`) }).toEqual({
        column,
        selected: false,
      });
    }
  });
});

describe("a person's reason reaches the verdicts without a value in it", () => {
  test("the words go, the email address and the number typed into it do not", async () => {
    const sent: string = await RUNS[DataSecurityAiFeature.JudgeFindings]();

    expect(sent).toContain(REASON_WORDS);
    expect(sent).not.toContain(REASON_EMAIL);
    expect(sent).not.toContain(REASON_NUMBER);
  });
});

/*
 * The search itself: a prompt that carries a planted value is found out.
 * A feature built without the builder - its finding's samples joined into
 * the message - is what the guard and this test exist to stop.
 */
describe("the search finds a planted value in a prompt that carries one", () => {
  test("a masked sample, a record, a connection string and a log's body", () => {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.maskedSamples = [PLANTED["maskedSample"]!];
    finding.sampleRecords = [
      {
        time: "2026-11-20T10:00:00.000Z",
        traceId: PLANTED["sampleRecordTrace"],
      },
    ];

    const leaky: string = JSON.stringify([
      { role: "system", content: "Explain it." },
      {
        role: "user",
        content: `Samples: ${finding.maskedSamples.join(", ")}. Seen in ${JSON.stringify(finding.sampleRecords)}. Database: ${PLANTED["connectionString"]}. Body: ${PLANTED["logBody"]}`,
      },
    ]);

    expect(plantedIn(leaky)).toEqual([
      "maskedSample",
      "sampleRecordTrace",
      "connectionString",
      "logBody",
    ]);
  });

  test("the same finding through the builder carries none of them", () => {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.dataTypeId = "email-address";
    finding.location = "attributes.user.email";
    finding.maskedSamples = [PLANTED["maskedSample"]!];

    const prompt: DataSecurityAiPrompt =
      DataSecurityAiInput.buildAnalyzeIssuePrompt({
        feature: DataSecurityAiFeature.ExplainIssue,
        instructions: "Analyze it.",
        dossier: {
          issue: { checkId: "sensitive-data-in-telemetry" },
          store: { name: "checkout · Logs" },
          places: [finding],
          access: [],
          copies: [],
          securityCaseIds: [],
          responses: [],
          proposals: [],
          declaredCode: null,
          owners: { recordIds: [], names: [], count: 0 },
          now: new Date("2026-11-20T12:00:00.000Z"),
        },
      });

    expect(plantedIn(JSON.stringify(prompt.messages))).toEqual([]);
    expect(JSON.stringify(prompt.messages)).toContain("attributes.user.email");
  });
});

// An AI Logs row of these runs keeps none of it either.
describe("and the AI Logs keep none of it", () => {
  test("Explain's and the field suggestions' rows", async () => {
    const logs: SpyInstance<typeof LlmLogService.create> = jest.spyOn(
      LlmLogService,
      "create",
    );

    await RUNS[DataSecurityAiFeature.ExplainIssue]();
    await DataSecurityFieldSuggestion.suggestForStore({
      projectId: PROJECT_ID,
      dataStoreId: new ObjectID(STORE_ID),
    });

    const kept: string = logs.mock.calls
      .map((call: Array<unknown>): string => {
        return JSON.stringify((call[0] as { data: LlmLog }).data);
      })
      .join("\n");

    expect(logs.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(plantedIn(kept)).toEqual([]);
    expect(kept).not.toContain("acme-card-exports");
    expect(kept).not.toContain("attributes.user.email");
  });
});

/*
 * A RUM APPLICATION'S LEAKS, FIXED IN ITS FRONT-END CODE (#10933): Fix with
 * AI on the application's session replay issue, over HTTP - its findings
 * read, located from the records they were seen in, its browser log's
 * stack resolved through its source maps, placed and planned - to the Code
 * task it queues. A value is planted wherever a front end keeps one: the
 * line a browser log wrote, its page's address (an email in its path, a
 * coupon in its query), its stack's message, a session's user label and
 * traits, the page attributes, the replay's recorded DOM text, the source
 * map's embedded sources and the records' ids. Only the original file, the
 * page's masked path and the session recorder call may go.
 */
const RUM_APP_ID: string = "10933000-0000-4000-8000-0000000000e1";
const RUM_SOURCE_MAP_SERVICE_ID: string =
  "10933000-0000-4000-8000-0000000000e2";
const RUM_STORE_ID: string = "10933000-0000-4000-8000-0000000000b1";
const RUM_ISSUE_ID: string = "10933000-0000-4000-8000-0000000000a1";

// Each told apart by its first sixteen characters, as the search reads them.
const RUM_PLANTED: Readonly<Record<string, string>> = {
  // One line of code, read with two values: only its words may go.
  logLine: "PLANTED-LOGLINE-ONE",
  logLineAgain: "PLANTED-LINETWO-RUM",
  pagePath: "planted.rum.page@example.com",
  pageQuery: "PLANTED-COUPON-RUM",
  stackMessage: "PLANTED-STACKMSG-RUM",
  sessionLabel: "planted.rum.label@example.com",
  sessionTrait: "PLANTED-TRAIT-RUM",
  sessionAttribute: "PLANTED-SESSATTR-RUM",
  replayDomText: "PLANTED-DOMTEXT-RUM Ada Lovelace, 12 Downing St",
  sourcesContent: "PLANTED-SRCCONTENT-RUM",
  sessionId: "PLANTED-SESSIONID-0192f1a0",
  logId: "PLANTED-LOGID-RUM-7f3c",
};

function rumPlantedIn(sent: string): Array<string> {
  return Object.entries(RUM_PLANTED)
    .filter(([, planted]: [string, string]): boolean => {
      return sent.includes(planted) || sent.includes(planted.slice(0, 16));
    })
    .map(([name]: [string, string]): string => {
      return name;
    });
}

function useRumTables(): void {
  useInMemoryTable(asService(RumApplicationService), [
    {
      _id: RUM_APP_ID,
      projectId: PROJECT_ID.toString(),
      name: "Storefront",
      appIdentifier: "storefront-web",
    },
  ]);
  // The service its builds' source maps were uploaded under, named as it names itself.
  useInMemoryTable(asService(ServiceService), [
    {
      _id: RUM_SOURCE_MAP_SERVICE_ID,
      projectId: PROJECT_ID.toString(),
      name: "storefront-web",
    },
  ]);
  useInMemoryTable(asService(DataStoreService), [
    storeRow(RUM_STORE_ID, {
      name: "Storefront · Session Replays",
      kind: "Session Replays",
      provider: "oneuptime",
      storeKey: `telemetry:${RUM_APP_ID}:Session Replays`,
    }),
  ]);
  useInMemoryTable(asService(DataSecurityIssueService), [
    {
      _id: RUM_ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Sensitive data is reaching your telemetry",
      checkId: "sensitive-data-in-telemetry",
      checkGroup: "Telemetry",
      evidence: "1 kind of sensitive data is not scrubbed: Email address.",
      severity: "High",
      status: "Open",
      riskScore: 80,
      dataTypeIds: ["email-address"],
      dataStoreId: RUM_STORE_ID,
    },
  ]);

  const finding: (data: {
    id: string;
    location: string;
    record: JSONObject;
  }) => StoredRow = (data: {
    id: string;
    location: string;
    record: JSONObject;
  }): StoredRow => {
    return {
      _id: data.id,
      projectId: PROJECT_ID.toString(),
      dataStoreId: RUM_STORE_ID,
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      location: data.location,
      locationKind: "Attribute",
      confidence: "High",
      matchCount: 12,
      valueCount: 20,
      distinctValues: 9,
      isScrubbed: false,
      isSuppressed: false,
      isConfirmed: false,
      isAiSuggested: false,
      lastSeenAt: new Date(),
      maskedSamples: [PLANTED["maskedSample"]],
      sampleRecords: [{ time: new Date().toISOString(), ...data.record }],
    };
  };

  useInMemoryTable(asService(DataStoreFindingService), [
    finding({
      id: "10933000-0000-4000-8000-0000000000d1",
      location: "logs.attributes.user.email",
      record: { logId: RUM_PLANTED["logId"] },
    }),
    finding({
      id: "10933000-0000-4000-8000-0000000000d2",
      location: "sessions.identifiedUserLabel",
      record: { sessionId: RUM_PLANTED["sessionId"] },
    }),
  ]);
  // The application's newest release's source map, its embedded sources planted.
  useInMemoryTable(asService(TelemetrySourceMapService), [
    {
      _id: "10933000-0000-4000-8000-0000000000aa",
      projectId: PROJECT_ID.toString(),
      serviceId: RUM_SOURCE_MAP_SERVICE_ID,
      serviceVersion: "web-1.4.2",
      bundlePath: "assets/app.3f9c1e.js",
      sizeInBytes: 512,
      createdAt: new Date(),
      content: JSON.stringify({
        version: 3,
        sources: [
          "webpack://storefront-web/./src/checkout/payment.js",
          "webpack://storefront-web/./src/session.js",
        ],
        sourcesContent: [`const coupon = "${RUM_PLANTED["sourcesContent"]}";`],
        mappings: "AAAA",
      }),
    },
  ]);
}

/*
 * A browser log, as the locator's read returns it: every value it keeps
 * planted - one line of code, read twice with different values.
 */
function plantedRumLogRows(): Array<JSONObject> {
  return [RUM_PLANTED["logLine"]!, RUM_PLANTED["logLineAgain"]!].map(
    (value: string, index: number): JSONObject => {
      return {
        recordTime: 1795000000000 + index,
        readLogId: RUM_PLANTED["logId"],
        readBody: `Payment declined for ${value}`,
        readUrlFull: `https://shop.example.com/checkout/${RUM_PLANTED["pagePath"]}/pay?coupon=${RUM_PLANTED["pageQuery"]}#review`,
        readStackTrace: [
          `Error: ${RUM_PLANTED["stackMessage"]}`,
          "    at e (https://shop.example.com/assets/app.3f9c1e.js:1:1)",
        ].join("\n"),
        readServiceVersion: "web-1.4.2",
      };
    },
  );
}

// A session, as a read of it could return one: its user details and its replay's DOM text planted.
function plantedRumSessionRows(): Array<JSONObject> {
  return [
    {
      recordTime: 1795000000000,
      readSessionId: RUM_PLANTED["sessionId"],
      readPage: `https://shop.example.com/account/${RUM_PLANTED["pagePath"]}/settings?ref=${RUM_PLANTED["pageQuery"]}`,
      readLabel: RUM_PLANTED["sessionLabel"],
      readTraits: JSON.stringify({ plan: RUM_PLANTED["sessionTrait"] }),
      readAttributes: JSON.stringify({ cart: RUM_PLANTED["sessionAttribute"] }),
      readPayload: RUM_PLANTED["replayDomText"],
      domText: RUM_PLANTED["replayDomText"],
    },
  ];
}

describe("a RUM application's leaks reach OneUptime AI without a value in them (#10933)", () => {
  test("Fix with AI on its session replay issue: the original file, the masked page and the recorder call - nothing a record keeps", async () => {
    useRumTables();
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockResolvedValue({ rules: [] } as never);

    const logReads: SpyInstance<typeof LogService.executeQuery> = jest
      .spyOn(LogService, "executeQuery")
      .mockResolvedValue({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: plantedRumLogRows() };
        },
      } as never);
    const sessionReads: SpyInstance<typeof RumSessionService.executeQuery> =
      jest.spyOn(RumSessionService, "executeQuery").mockResolvedValue({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: plantedRumSessionRows() };
        },
      } as never);
    // The application's source maps resolve the bundle's frame to its original file.
    const resolved: SpyInstance<
      typeof TelemetrySourceMapService.resolveFramesForService
    > = jest
      .spyOn(TelemetrySourceMapService, "resolveFramesForService")
      .mockImplementation((async (data: { frames: Array<JSONObject> }) => {
        return {
          frames: data.frames.map((frame: JSONObject) => {
            return {
              ...frame,
              inApp: true,
              resolved: true,
              originalFileName:
                "webpack://storefront-web/./src/checkout/payment.js",
              originalLineNumber: 8,
              originalFunctionName: "pay",
            };
          }),
        };
      }) as never);
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([
        {
          id: INFRA_ID,
          name: "web",
          organizationName: "acme",
          repositoryName: "web",
          mainBranchName: "main",
          gitHubAppInstallationId: null,
          repositoryHostedAt: CodeRepositoryType.GitHub,
        },
      ]);
    jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
      .mockResolvedValue([
        "package.json",
        "src/checkout/payment.js",
        "src/session.js",
      ]);
    jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null);
    jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
      .mockResolvedValue(0);
    const queued: SpyInstance<
      typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun
    > = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(new AIRun(RUN_ID));

    const sent: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(RUM_ISSUE_ID),
    );

    expect(sent.status).toBe(200);
    expect(logReads).toHaveBeenCalled();
    expect(sessionReads).toHaveBeenCalled();
    expect(resolved).toHaveBeenCalled();
    // The stack's frames, never its message, are what the source maps were asked.
    expect(JSON.stringify(resolved.mock.calls)).not.toContain(
      RUM_PLANTED["stackMessage"],
    );
    expect(queued).toHaveBeenCalledTimes(1);

    const asked: string = JSON.stringify(queued.mock.calls[0]![0]);

    expect({
      planted: plantedIn(asked).filter((name: string): boolean => {
        return !(
          SENT_ON_PURPOSE[DataSecurityAiFeature.FixTelemetryLeaks] || []
        ).includes(name);
      }),
      rumPlanted: rumPlantedIn(asked),
    }).toEqual({ planted: [], rumPlanted: [] });
    // It sent what it is for: the application, where its front-end code writes each leak.
    for (const fact of [
      "Storefront",
      "src/checkout/payment.js",
      "Payment declined for <value>",
      "identify",
      "/checkout/",
      "/account/",
      "browser",
      "FixSensitiveDataInTelemetry",
    ]) {
      expect({ fact, sent: asked.includes(fact) }).toEqual({
        fact,
        sent: true,
      });
    }
    // A page's host, query and fragment never go; nor a session's identity.
    expect(asked).not.toContain("shop.example.com");
    expect(asked).not.toContain("#review");
    expect(asked).not.toContain("example.com");
  });

  test("the reads never even select a session's user details, its page attributes or its recording", async () => {
    useRumTables();
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockResolvedValue({ rules: [] } as never);
    jest.spyOn(LogService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<JSONObject> }> => {
        return { data: [] };
      },
    } as never);
    const sessionReads: SpyInstance<typeof RumSessionService.executeQuery> =
      jest.spyOn(RumSessionService, "executeQuery").mockResolvedValue({
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return { data: [] };
        },
      } as never);
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([]);
    jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null);

    await post(DATA_SECURITY_API_ROUTES.issueFixPlan(RUM_ISSUE_ID));

    expect(sessionReads).toHaveBeenCalled();

    const selected: string = sessionReads.mock.calls
      .map((call: Array<unknown>): string => {
        return JSON.stringify(call[0]);
      })
      .join("\n");

    for (const column of [
      "identifiedUserLabel",
      "identifiedUserTraits",
      "attributes",
      "payload",
      "chunk",
    ]) {
      expect({ column, selected: selected.includes(column) }).toEqual({
        column,
        selected: false,
      });
    }
  });
});

/*
 * A LINE READ FROM ONE RECORD, A PERSON'S NAME IN IT (#11098): Fix with AI
 * and the plan before it, over HTTP, for a service's log and a RUM
 * application's browser log - each finding seen in a single record whose
 * line holds a name no detector names, and a RUM page whose path holds one.
 * Nothing aligns one record with another, so only the words code writes
 * log lines with may go: never the name, in the plan the Dashboard shows or
 * in the request the code agent is handed (and its pull request is written
 * from).
 */
const ONE_RECORD_NAME: Readonly<Record<string, string>> = {
  given: "Ottilie",
  family: "Quarrington",
  slug: "ottilie-quarrington",
};

function oneRecordNamesIn(sent: string): Array<string> {
  return Object.entries(ONE_RECORD_NAME)
    .filter(([, name]: [string, string]): boolean => {
      return sent.toLowerCase().includes(name.toLowerCase());
    })
    .map(([key]: [string, string]): string => {
      return key;
    });
}

function useOneRecordServiceRead(): void {
  useInMemoryTable(asService(ServiceService), [
    {
      _id: CHECKOUT_SERVICE_ID,
      projectId: PROJECT_ID.toString(),
      name: "checkout",
    },
  ]);
  useInMemoryTable(asService(DataStoreService), [
    storeRow(STORE_ID),
    storeRow(TELEMETRY_STORE_ID, {
      name: "checkout · Logs",
      kind: "Logs",
      provider: "oneuptime",
      serviceId: CHECKOUT_SERVICE_ID,
    }),
  ]);
  jest
    .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
    .mockResolvedValue({ rules: [] } as never);
  // The one record the finding was seen in: a line with a person's name.
  jest.spyOn(LogService, "executeQuery").mockResolvedValue({
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return {
        data: [
          {
            recordTime: 1795000000000,
            readLogId: PLANTED["sampleRecordLog"],
            readFile1: "/usr/src/app/src/signup.js",
            readLine1: "12",
            readFunction1: "signUp",
            readScope: "checkout",
            readBody: `Payment declined for ${ONE_RECORD_NAME["given"]} ${ONE_RECORD_NAME["family"]}`,
          },
        ],
      };
    },
  } as never);
  jest
    .spyOn(CodeRepositoryService, "getResolvableRepositories")
    .mockResolvedValue([
      {
        id: INFRA_ID,
        name: "infra",
        organizationName: "acme",
        repositoryName: "infra",
        mainBranchName: "main",
        gitHubAppInstallationId: null,
        repositoryHostedAt: CodeRepositoryType.GitHub,
      },
    ]);
  jest
    .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
    .mockResolvedValue(["package.json", "src/signup.js"]);
  jest
    .spyOn(ProductionReviewScope, "get")
    .mockResolvedValue({ services: [] } as never);
  jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null);
  jest
    .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
    .mockResolvedValue(0);
}

describe("a line read from one record never puts a person's name in a plan or a prompt (#11098)", () => {
  test("a service's log: the plan and the code agent's request say the line's words, never the name", async () => {
    useOneRecordServiceRead();
    const queued: SpyInstance<
      typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun
    > = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(new AIRun(RUN_ID));

    const plan: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.issueFixPlan(TELEMETRY_ISSUE_ID),
    );

    expect(plan.status).toBe(200);

    const shown: string = JSON.stringify(plan.answer);

    expect(shown).toContain("Payment declined for <value>");
    expect(oneRecordNamesIn(shown)).toEqual([]);

    const fixed: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(TELEMETRY_ISSUE_ID),
    );

    expect(fixed.status).toBe(200);
    expect(queued).toHaveBeenCalledTimes(1);

    const asked: string = JSON.stringify(queued.mock.calls[0]![0]);

    expect(asked).toContain("Payment declined for <value>");
    expect(asked).toContain("src/signup.js");
    expect(oneRecordNamesIn(asked)).toEqual([]);
  });

  test("a RUM application's browser log: its line and its page, never the name in either", async () => {
    useRumTables();
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockResolvedValue({ rules: [] } as never);
    jest.spyOn(LogService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<JSONObject> }> => {
        return {
          data: [
            {
              recordTime: 1795000000000,
              readLogId: RUM_PLANTED["logId"],
              readBody: `Payment declined for ${ONE_RECORD_NAME["given"]} ${ONE_RECORD_NAME["family"]}`,
              readUrlFull: `https://shop.example.com/profile/${ONE_RECORD_NAME["slug"]}/settings?tab=billing`,
              readStackTrace: [
                "Error: Payment declined",
                "    at e (https://shop.example.com/assets/app.3f9c1e.js:1:1)",
              ].join("\n"),
              readServiceVersion: "web-1.4.2",
            },
          ],
        };
      },
    } as never);
    jest.spyOn(RumSessionService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<JSONObject> }> => {
        return { data: [] };
      },
    } as never);
    jest
      .spyOn(TelemetrySourceMapService, "resolveFramesForService")
      .mockImplementation((async (data: { frames: Array<JSONObject> }) => {
        return {
          frames: data.frames.map((frame: JSONObject) => {
            return {
              ...frame,
              inApp: true,
              resolved: true,
              originalFileName:
                "webpack://storefront-web/./src/checkout/payment.js",
              originalLineNumber: 8,
              originalFunctionName: "pay",
            };
          }),
        };
      }) as never);
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([
        {
          id: INFRA_ID,
          name: "web",
          organizationName: "acme",
          repositoryName: "web",
          mainBranchName: "main",
          gitHubAppInstallationId: null,
          repositoryHostedAt: CodeRepositoryType.GitHub,
        },
      ]);
    jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
      .mockResolvedValue(["package.json", "src/checkout/payment.js"]);
    jest.spyOn(CodeFixOnItsWay, "findTaskId").mockResolvedValue(null);
    jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingInLane")
      .mockResolvedValue(0);
    const queued: SpyInstance<
      typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun
    > = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(new AIRun(RUN_ID));

    const plan: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.issueFixPlan(RUM_ISSUE_ID),
    );

    expect(plan.status).toBe(200);
    expect(oneRecordNamesIn(JSON.stringify(plan.answer))).toEqual([]);

    const fixed: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(RUM_ISSUE_ID),
    );

    expect(fixed.status).toBe(200);
    expect(queued).toHaveBeenCalledTimes(1);

    const asked: string = JSON.stringify(queued.mock.calls[0]![0]);

    expect(asked).toContain("Payment declined for <value>");
    expect(asked).toContain("/profile/<value>/settings");
    expect(oneRecordNamesIn(asked)).toEqual([]);
  });
});
