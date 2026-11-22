import { mockRouter } from "./Helpers";
import DataSecurityAPI, {
  EXPLAIN_ISSUE_PERMISSIONS,
} from "../../../Server/API/DataSecurityAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Queue from "../../../Server/Infrastructure/Queue";
import AIService, {
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  AUTONOMOUS_AI_FEATURES,
} from "../../../Server/Services/AIService";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import CodeTaskAccess, {
  CODE_TASK_ASK_REFUSED_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import {
  DATA_SECURITY_FIX_NO_ASKABLE_REPOSITORY_MESSAGE,
  DataSecurityFixCode,
  getDataSecurityFixNoRepositoryMessage,
  getDataSecurityFixPickRepositoryMessage,
} from "../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../Types/AI/CodeTask";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import { buildDataSecurityFixRequest } from "../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import DataSecurityIssueAnalysis, {
  StoredDataSecurityIssueAnalysis,
} from "../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityIssueAnalysisReader from "../../../Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysisReader";
import {
  DataSecurityAiVerdict,
  DataSecurityIssueAnalysisView,
} from "../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataSecurityAiSettings from "../../../Server/Utils/AI/DataSecurity/DataSecurityAiSettings";
import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ServerProducts from "../../../Server/Utils/ServerProducts/ServerProducts";
import ProductKey from "../../../Types/Product/ProductKey";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataSecuritySettingService from "../../../Server/Services/DataSecuritySettingService";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DataSecurityComplianceSettingService from "../../../Server/Services/DataSecurityComplianceSettingService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ServiceService from "../../../Server/Services/ServiceService";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import CodeTaskRuns from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import AiContextReader from "../../../Server/Utils/AI/AiContext/AiContextReader";
import DataSecurityIntegrations from "../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import DeclaredDataStores from "../../../Server/Utils/DataSecurity/DeclaredDataStores";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import SecurityEventRetention from "../../../Server/Utils/SecurityEvent/SecurityEventRetention";
import {
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
} from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import * as TelemetryScrubCoverage from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import * as TelemetryScrubIt from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubIt";
import * as TelemetryMetricDrop from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryMetricDrop";
import * as TelemetryScrubImpact from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubImpact";
import * as TelemetryFindingOccurrences from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import { TelemetrySampleSource } from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import DataSecurityRunner from "../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import AnalyticsDatabaseService, {
  Results,
} from "../../../Server/Services/AnalyticsDatabaseService";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import Span from "../../../Models/AnalyticsModels/Span";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Purple500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import UserType from "../../../Types/UserType";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceIssueInput,
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
  ComplianceStoreInput,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceFramework,
  DataSecurityComplianceResponse,
  DataSecurityComplianceTurnedOff,
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerptPartKind,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesSource,
  DataSecurityOccurrencesUnavailableReason,
  DataSecurityOverview,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  DataSecurityResourceComplianceFramework,
  DataSecurityResourceComplianceResponse,
  DataSecurityResourceScope,
  MAX_COMPLIANCE_TURNED_OFF,
  MAX_RESOURCE_SCOPE_STORES,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { FindingSampleRecord } from "../../../Types/DataSecurity/FindingSampleRecord";
import { getDataSecurityCheck } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DeclaredDataStoreInfo,
  DeclaredStoreReaders,
  DeclaredStoreRetentionBasis,
  getDeclaredDataStore,
} from "../../../Types/DataSecurity/DeclaredDataStore";
import NetworkFlow from "../../../Models/AnalyticsModels/NetworkFlow";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { withoutRefusals } from "./RouteRefusals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * Data Security's own routes (DataSecurityAPI), beside the Data Store CRUD:
 * each is mounted under the path the Dashboard reads from
 * (DATA_SECURITY_API_ROUTES), refuses whoever is not a member of the
 * project or lacks the route's permissions before it reads anything, reads
 * only the caller's project, and answers what it says it computes - the
 * Overview's figures, each framework's compliance score, the record of
 * processing. Postgres, the queue, OneUptime AI and the code task runner
 * are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

const READ: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];
const OPERATE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];
const SCRUB: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
  // A metric's attribute is scrubbed by a metric pipeline rule (#9604).
  Permission.CreateProjectMetricPipelineRule,
];
// Dropping a service's metrics named with a finding's data: who may make pipeline rules (#9757).
const DROP_METRIC: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectMetricPipelineRule,
];
// Who may change other rules, or read the findings, but not make pipeline rules.
const NOT_DROP_METRIC: Array<Permission> = [
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
  Permission.EditDataStoreFinding,
  Permission.ReadProjectMetricPipelineRule,
];
const OCCURRENCES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.ReadDataStoreFinding,
];
const FIX: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];
// Who may read the issue: its explanation spells out the evidence (#10361).
const EXPLAIN: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityIssue,
];

// A custom type the project keeps, and one it deleted (#10363).
const LOYALTY_ROW: ObjectID = new ObjectID(
  "10363000-0000-4000-8000-0000000000a1",
);
const LOYALTY: string = `custom:${LOYALTY_ROW.toString()}`;

// An analysis the issue keeps (#10369), and how a reader sees it.
const STORED_ANALYSIS: StoredDataSecurityIssueAnalysis = {
  record: {
    version: 1,
    verdict: DataSecurityAiVerdict.Real,
    language: "en",
    lines: {
      reason: {
        text: "Anyone on the internet can read the card numbers.",
        facts: ["S2"],
      },
      path: { text: "Block public access from this page.", facts: ["A1"] },
    },
    facts: [],
  },
  analyzedAt: new Date("2026-10-27T11:00:00.000Z"),
  inputHash: "a".repeat(64),
};
const ANALYSIS_VIEW: DataSecurityIssueAnalysisView = {
  verdict: DataSecurityAiVerdict.Real,
  analyzedAt: "2026-10-27T11:00:00.000Z",
  language: "en",
  lines: {
    reason: {
      text: "Anyone on the internet can read the card numbers.",
      facts: ["S2"],
    },
  },
  hiddenLines: { path: [] },
  facts: [],
};
const DELETED_TYPE: string = "custom:10363000-0000-4000-8000-0000000000a2";

interface RouteCase {
  name: string;
  path: string;
  allowed: Array<Permission>;
  refused: Array<Permission>;
  // What the route is asked about, when it reads its body.
  body?: JSONObject | undefined;
}

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DATABASE_SERVER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_DATABASE_SERVER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const ROUTES: Array<RouteCase> = [
  {
    name: "overview",
    path: DATA_SECURITY_API_ROUTES.overview,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
  },
  {
    name: "compliance",
    path: DATA_SECURITY_API_ROUTES.compliance,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
  },
  {
    name: "a resource's stores",
    path: DATA_SECURITY_API_ROUTES.resourceScope,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
    body: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
    },
  },
  {
    name: "a resource's compliance",
    path: DATA_SECURITY_API_ROUTES.resourceCompliance,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
    body: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
    },
  },
  {
    name: "record of processing",
    path: DATA_SECURITY_API_ROUTES.recordOfProcessing,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataStoreFinding],
  },
  {
    name: "scan now",
    path: DATA_SECURITY_API_ROUTES.scanNow(":id"),
    allowed: OPERATE,
    refused: [
      Permission.ReadDataStore,
      Permission.SecurityViewer,
      Permission.ProjectMember,
    ],
  },
  {
    name: "check now",
    path: DATA_SECURITY_API_ROUTES.checkNow(":id"),
    allowed: OPERATE,
    refused: [
      Permission.ReadDataStore,
      Permission.SecurityViewer,
      Permission.EditDataSecurityIssue,
    ],
  },
  {
    name: "scrub it",
    path: DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
    allowed: SCRUB,
    refused: [
      Permission.SecurityAdmin,
      Permission.EditDataStore,
      Permission.EditDataStoreFinding,
    ],
  },
  {
    name: "what dropping a metric would do",
    path: DATA_SECURITY_API_ROUTES.dropMetricImpact(":id"),
    allowed: DROP_METRIC,
    refused: NOT_DROP_METRIC,
  },
  {
    name: "drop a metric",
    path: DATA_SECURITY_API_ROUTES.dropMetric(":id"),
    allowed: DROP_METRIC,
    refused: NOT_DROP_METRIC,
    body: { confirmDataLoss: true },
  },
  {
    name: "a finding's records",
    path: DATA_SECURITY_API_ROUTES.findingOccurrences(":id"),
    allowed: OCCURRENCES,
    // A Security Viewer does not read masked samples, which the records carry.
    refused: [
      Permission.SecurityViewer,
      Permission.ReadDataStore,
      Permission.ProjectMember,
      Permission.EditDataStoreFinding,
      Permission.ReadTelemetryServiceLog,
    ],
  },
  {
    name: "explain",
    path: DATA_SECURITY_API_ROUTES.explainIssue(":id"),
    allowed: EXPLAIN,
    // A store's reader alone does not read its issues' evidence.
    refused: [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadDataStore,
      Permission.ReadLlmLog,
    ],
  },
  {
    // The analysis the issue keeps (#10369): for whoever may explain it.
    name: "the issue's analysis",
    path: DATA_SECURITY_API_ROUTES.issueAnalysis(":id"),
    allowed: EXPLAIN,
    refused: [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadDataStore,
      Permission.ReadLlmLog,
    ],
  },
  {
    name: "fix with AI",
    path: DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
    allowed: FIX,
    refused: [
      Permission.SecurityViewer,
      Permission.ReadDataSecurityIssue,
      Permission.EditDataStore,
    ],
  },
  {
    /*
     * What OneUptime AI sees (#10365): for whoever reads Data Security;
     * each part of the answer is read with the reader's own permissions.
     */
    name: "what OneUptime AI sees",
    path: DATA_SECURITY_API_ROUTES.aiInput,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadLlmLog],
  },
];

// Each route with each permission it answers, and each it refuses.
const ROUTE_PERMISSIONS_ALLOWED: Array<[string, Permission, RouteCase]> =
  ROUTES.flatMap((route: RouteCase): Array<[string, Permission, RouteCase]> => {
    return route.allowed.map(
      (permission: Permission): [string, Permission, RouteCase] => {
        return [route.name, permission, route];
      },
    );
  });

const ROUTE_PERMISSIONS_REFUSED: Array<[string, Permission, RouteCase]> =
  ROUTES.flatMap((route: RouteCase): Array<[string, Permission, RouteCase]> => {
    return route.refused.map(
      (permission: Permission): [string, Permission, RouteCase] => {
        return [route.name, permission, route];
      },
    );
  });

function buildProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: memberOf,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
  const map: Dictionary<UserTenantAccessPermission> = {};
  map[memberOf.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

let propsSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;
let storeFindOneSpy: jest.SpyInstance;
let storeFindSpy: jest.SpyInstance;
let storeUpdateSpy: jest.SpyInstance;
let settingFindOneSpy: jest.SpyInstance;
let settingRow: DataSecuritySetting | null;
let issueFindOneSpy: jest.SpyInstance;
let issueFindSpy: jest.SpyInstance;
let findingFindOneSpy: jest.SpyInstance;
let findingFindSpy: jest.SpyInstance;
let findingUpdateSpy: jest.SpyInstance;
let connectionsSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;
let aiSpy: jest.SpyInstance;
let aiSettingsSpy: jest.SpyInstance;
let repositoriesSpy: jest.SpyInstance;
let codeTaskSpy: jest.SpyInstance;
let scrubSpy: jest.SpyInstance;
let dropSpy: jest.SpyInstance;
let dropImpactSpy: jest.SpyInstance;
let ownersSpy: jest.SpyInstance;
let declareSpy: jest.SpyInstance;
let withheldSpy: jest.SpyInstance;
let withheld: Map<string, WithheldProfile>;
let eventRetentionSpy: jest.SpyInstance;
/*
 * OneUptime AI's analysis of an issue (#10369): written and read by its own
 * suites (DataSecurityIssueAnalysis, DataSecurityIssueAnalysisReader);
 * here, what the routes hand it and answer with.
 */
let analyzeSpy: jest.SpyInstance;
let viewSpy: jest.SpyInstance;
let storedSpy: jest.SpyInstance;
let aiEnabledSpy: jest.SpyInstance;
let complianceSettingFindSpy: jest.SpyInstance;
let databaseServerFindSpy: jest.SpyInstance;
let databaseServerFindOneSpy: jest.SpyInstance;
let clusterFindOneSpy: jest.SpyInstance;
let clusterFindSpy: jest.SpyInstance;
let complianceSettings: Array<DataSecurityComplianceSetting>;
let databaseServers: Array<DatabaseServer>;
let databaseServerRow: DatabaseServer | null;
let clusterRow: KubernetesCluster | null;
// The project's own data types (#10363).
let customTypes: Array<DataSecurityCustomDataType>;
let customTypesSpy: jest.SpyInstance;
/*
 * Code's checks, as a task in Code asks them (#10362): the repositories the
 * caller reads, those they may not ask in, and what the gate answers for
 * work before a repository is known and for one.
 */
let notAskable: Set<string>;
let blockerBeforeRepository: CodeTaskBlocker | null;
let blockerInRepository: CodeTaskBlocker | null;
let readableSpy: jest.SpyInstance;
let readableOneSpy: jest.SpyInstance;
let canAskSpy: jest.SpyInstance;
let gateSpy: jest.SpyInstance;

let storeRow: DataStore | null;
let issueRow: DataSecurityIssue | null;
let findingRow: DataStoreFinding | null;
let stores: Array<DataStore>;
let issues: Array<DataSecurityIssue>;
let findings: Array<DataStoreFinding>;
let connections: Array<CloudConnection>;
let repositories: Array<CodeRepository>;

function asCaller(permissions: Array<Permission>): void {
  propsSpy.mockResolvedValue(buildProps(permissions));
}

async function call(
  path: string,
  params: Record<string, string> = {},
  body: JSONObject = {},
): Promise<RouteCall> {
  const req: ExpressRequest = {
    params,
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: jest.Mock = jest.fn();
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const before: number = send.mock.calls.length;

  await mockRouter
    .match("POST", path)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0]?.[0],
    answer:
      send.mock.calls.length > before
        ? (send.mock.calls[send.mock.calls.length - 1]![2] as JSONObject)
        : undefined,
  };
}

function paramsFor(route: RouteCase): Record<string, string> {
  return route.path.includes(":id") ? { id: STORE_ID.toString() } : {};
}

function bodyFor(route: RouteCase): JSONObject {
  return route.body || {};
}

function readsMade(): number {
  return [
    storeFindOneSpy,
    storeFindSpy,
    issueFindOneSpy,
    issueFindSpy,
    findingFindOneSpy,
    findingFindSpy,
    connectionsSpy,
    repositoriesSpy,
    complianceSettingFindSpy,
    databaseServerFindSpy,
    databaseServerFindOneSpy,
    clusterFindOneSpy,
    customTypesSpy,
    aiSettingsSpy,
    readableSpy,
    readableOneSpy,
    canAskSpy,
    gateSpy,
  ].reduce((sum: number, spy: jest.SpyInstance) => {
    return sum + spy.mock.calls.length;
  }, 0);
}

function queuedJobs(): Array<{ jobName: string; payload: JSONObject }> {
  return queueSpy.mock.calls.map((queued: Array<unknown>) => {
    return { jobName: queued[2] as string, payload: queued[3] as JSONObject };
  });
}

function telemetryFinding(kind: DataStoreKind): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(STORE_ID);
  finding.dataTypeId = "email-address";
  finding.location = "attributes.user.email";
  finding.dataStoreId = ObjectID.generate();
  const store: DataStore = new DataStore();
  store.kind = kind;
  finding.dataStore = store;
  return finding;
}

function issueOf(): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue(STORE_ID);
  issue.checkId = "public-read";
  issue.title = "Anyone on the internet can read it";
  issue.severity = SecuritySeverity.Critical;
  issue.evidence = "The bucket policy grants s3:GetObject to *.";
  issue.dataTypeIds = ["credit-card-number", LOYALTY];
  const store: DataStore = new DataStore();
  store.name = "customer-exports";
  store.kind = DataStoreKind.AwsS3Bucket;
  store.region = "us-east-1";
  store.sensitivity = DataSensitivity.Restricted;
  store.providerResourceId = "arn:aws:s3:::customer-exports";
  issue.dataStore = store;
  return issue;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DataSecurityAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  // A store Scan Now may scan: the workers' S3 bucket (workerStore).
  storeRow = workerStore();
  issueRow = issueOf();
  findingRow = telemetryFinding(DataStoreKind.TelemetryLogs);
  stores = [];
  issues = [];
  findings = [];
  connections = [];
  repositories = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
  asCaller([Permission.ProjectOwner]);

  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  storeFindOneSpy = jest
    .spyOn(DataStoreService, "findOneBy")
    .mockImplementation((async () => {
      return storeRow;
    }) as never);
  storeFindSpy = jest
    .spyOn(DataStoreService, "findBy")
    .mockImplementation((async () => {
      return stores;
    }) as never);
  storeUpdateSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  settingRow = null;
  settingFindOneSpy = jest
    .spyOn(DataSecuritySettingService, "findOneBy")
    .mockImplementation((async () => {
      return settingRow;
    }) as never);
  issueFindOneSpy = jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async () => {
      return issueRow;
    }) as never);
  issueFindSpy = jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation((async () => {
      return issues;
    }) as never);
  findingFindOneSpy = jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async () => {
      return findingRow;
    }) as never);
  findingFindSpy = jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async () => {
      return findings;
    }) as never);
  findingUpdateSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  connectionsSpy = jest
    .spyOn(CloudConnectionService, "findBy")
    .mockImplementation((async () => {
      return connections;
    }) as never);
  feedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  aiSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue({ content: "Turn on Block Public Access." } as never);
  // What OneUptime AI sees: its own suite reads it (DataSecurityAiSettings).
  aiSettingsSpy = jest.spyOn(DataSecurityAiSettings, "read").mockResolvedValue({
    isAiEnabled: true,
    canReadModels: false,
    projectModel: null,
    codeAgentModel: null,
    example: null,
  });
  repositoriesSpy = jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockImplementation((async () => {
      return repositories;
    }) as never);
  codeTaskSpy = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation((async () => {
      return new AIRun(new ObjectID("77777777-7777-4777-8777-777777777777"));
    }) as never);
  // Scrub It makes the proven, narrow rule for the finding (#10366).
  scrubSpy = jest
    .spyOn(TelemetryScrubIt, "scrubFindingWithProvenRule")
    .mockResolvedValue({
      signal: "log",
      scrubRuleId: "88888888-8888-4888-8888-888888888888",
      scrubRuleName: "Data Security: Email address in attributes.user.email",
      isProven: true,
    });
  dropSpy = jest
    .spyOn(TelemetryScrubCoverage, "createDropRuleForFinding")
    .mockResolvedValue({
      ruleId: "99999999-9999-4999-8999-999999999999",
      ruleName: "Data Security: drop metrics named with Email address",
      isNew: true,
    });
  dropImpactSpy = jest
    .spyOn(TelemetryMetricDrop, "getDropMetricImpact")
    .mockResolvedValue({
      isAvailable: true,
      ruleName: "Data Security: drop metrics named with Email address",
      metricsMatched: 2,
      isMetricsMatchedCapped: false,
      metricsCounted: true,
      monitors: [],
      dashboards: [],
      slos: [],
      recordingRules: [],
      monitorsChecked: true,
      dashboardsChecked: true,
      slosChecked: true,
      recordingRulesChecked: true,
      monitorsHidden: 0,
      dashboardsHidden: 0,
      slosHidden: 0,
      recordingRulesHidden: 0,
    });
  ownersSpy = jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockResolvedValue([]);
  /*
   * The record declares OneUptime's own security stores before it is read
   * (#10398): their own suite holds that (DeclaredDataStores), and here it
   * declares nothing unless a test says so. The project keeps security
   * events 15 days.
   */
  declareSpy = jest
    .spyOn(DeclaredDataStores, "declareBeforeRead")
    .mockResolvedValue(undefined);
  // Nobody the record names is only invited, unless a test says so (#10697).
  withheld = new Map();
  withheldSpy = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation((async () => {
      return withheld;
    }) as never);
  eventRetentionSpy = jest
    .spyOn(SecurityEventRetention, "getRetentionInDays")
    .mockResolvedValue(15);
  // A project with no AI context, unless a test writes one.
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
  analyzeSpy = jest
    .spyOn(DataSecurityIssueAnalysis, "analyzeForPerson")
    .mockResolvedValue({ analysis: STORED_ANALYSIS, isNew: true });
  viewSpy = jest
    .spyOn(DataSecurityIssueAnalysisReader, "viewFor")
    .mockResolvedValue(ANALYSIS_VIEW);
  storedSpy = jest
    .spyOn(DataSecurityIssueAnalysis, "readStored")
    .mockResolvedValue(STORED_ANALYSIS);
  aiEnabledSpy = jest
    .spyOn(AIService, "isProjectAIEnabled")
    .mockResolvedValue(true);

  // The project's own data types: Loyalty card number (#10363).
  const loyalty: DataSecurityCustomDataType = new DataSecurityCustomDataType(
    LOYALTY_ROW,
  );
  loyalty.name = "Loyalty card number";
  customTypes = [loyalty];
  customTypesSpy = jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockImplementation((async () => {
      return customTypes;
    }) as never);

  /*
   * Code's checks (#10362): the caller reads the repositories the test
   * lists, may ask in each but those it marks, and nothing stops AI.
   */
  notAskable = new Set();
  blockerBeforeRepository = null;
  blockerInRepository = null;
  readableSpy = jest
    .spyOn(CodeTaskAccess, "listReadableRepositories")
    .mockImplementation((async () => {
      return repositories;
    }) as never);
  readableOneSpy = jest
    .spyOn(CodeTaskAccess, "getReadableRepository")
    .mockImplementation((async (data: { repositoryId: ObjectID }) => {
      const found: CodeRepository | undefined = repositories.find(
        (repository: CodeRepository): boolean => {
          return repository.id!.toString() === data.repositoryId.toString();
        },
      );

      if (!found) {
        throw new NotFoundException(CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE);
      }

      return found;
    }) as never);
  canAskSpy = jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation((async (data: { repositoryId: ObjectID }) => {
      return !notAskable.has(data.repositoryId.toString());
    }) as never);
  gateSpy = jest
    .spyOn(CodeTaskGate, "getBlocker")
    .mockImplementation((async (data: {
      repository: CodeRepository | null;
    }) => {
      return data.repository ? blockerInRepository : blockerBeforeRepository;
    }) as never);

  // No resource turned anything off, unless a test turns it off.
  complianceSettings = [];
  complianceSettingFindSpy = jest
    .spyOn(DataSecurityComplianceSettingService, "findBy")
    .mockImplementation((async () => {
      return complianceSettings;
    }) as never);
  databaseServers = [];
  databaseServerFindSpy = jest
    .spyOn(DatabaseServerService, "findBy")
    .mockImplementation((async () => {
      return databaseServers;
    }) as never);
  databaseServerRow = null;
  databaseServerFindOneSpy = jest
    .spyOn(DatabaseServerService, "findOneBy")
    .mockImplementation((async () => {
      return databaseServerRow;
    }) as never);
  // The cluster the resource routes are asked about, readable by the caller.
  clusterRow = new KubernetesCluster(CLUSTER_ID);
  clusterRow.name = "prod-eu";
  clusterFindOneSpy = jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockImplementation((async () => {
      return clusterRow;
    }) as never);
  // A list of clusters, as OneUptime or as the caller: that cluster.
  clusterFindSpy = jest
    .spyOn(KubernetesClusterService, "findBy")
    .mockImplementation((async () => {
      return clusterRow ? [clusterRow] : [];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("routes and who may call them", () => {
  test("the routes are the shared paths the Dashboard calls", () => {
    expect(DATA_SECURITY_API_ROUTES.overview).toBe("/data-security/overview");
    expect(DATA_SECURITY_API_ROUTES.compliance).toBe(
      "/data-security/compliance",
    );
    expect(DATA_SECURITY_API_ROUTES.resourceScope).toBe(
      "/data-security/resource-scope",
    );
    expect(DATA_SECURITY_API_ROUTES.resourceCompliance).toBe(
      "/data-security/resource-compliance",
    );
    expect(DATA_SECURITY_API_ROUTES.recordOfProcessing).toBe(
      "/data-security/record-of-processing",
    );
    expect(DATA_SECURITY_API_ROUTES.scanNow("x")).toBe(
      "/data-store/x/scan-now",
    );
    expect(DATA_SECURITY_API_ROUTES.checkNow("x")).toBe(
      "/data-store/x/check-now",
    );
    expect(DATA_SECURITY_API_ROUTES.scrubFinding("x")).toBe(
      "/data-store-finding/x/scrub",
    );
    expect(DATA_SECURITY_API_ROUTES.dropMetricImpact("x")).toBe(
      "/data-store-finding/x/drop-metric-impact",
    );
    expect(DATA_SECURITY_API_ROUTES.dropMetric("x")).toBe(
      "/data-store-finding/x/drop-metric",
    );
    expect(DATA_SECURITY_API_ROUTES.findingOccurrences("x")).toBe(
      "/data-store-finding/x/occurrences",
    );
    expect(DATA_SECURITY_API_ROUTES.explainIssue("x")).toBe(
      "/data-security-issue/x/explain",
    );
    expect(DATA_SECURITY_API_ROUTES.issueAnalysis("x")).toBe(
      "/data-security-issue/x/analysis",
    );
    expect(DATA_SECURITY_API_ROUTES.fixIssueWithAi("x")).toBe(
      "/data-security-issue/x/fix-with-ai",
    );
    expect(DATA_SECURITY_API_ROUTES.aiInput).toBe("/data-security/ai-input");
  });

  // The explanation spells out the issue's evidence (#10361).
  test("Explain is for whoever may read the issue, by the issue's own read permissions", () => {
    expect([...EXPLAIN_ISSUE_PERMISSIONS].sort()).toEqual(
      [...new DataSecurityIssue().getReadPermissions()].sort(),
    );
    expect(EXPLAIN_ISSUE_PERMISSIONS).not.toContain(Permission.ReadDataStore);
  });

  /*
   * Which products each route is refused while they are off on the server:
   * every action of Data Security's, and Fix with AI's Code too - it starts
   * a task in Code, as every route that asks AI for a code change does.
   */
  async function productsRefusedWhileOff(
    path: string,
  ): Promise<Array<ProductKey>> {
    const asked: Array<ProductKey> = [];
    const spy: jest.SpyInstance = jest
      .spyOn(ServerProducts, "assertProductIsOn")
      .mockImplementation((async (product: ProductKey) => {
        asked.push(product);
      }) as never);

    for (const middleware of mockRouter.match("POST", path).middlewares) {
      if (ServerProductRoutes.isRefusal(middleware)) {
        await (
          middleware as unknown as (
            req: ExpressRequest,
            res: ExpressResponse,
            next: NextFunction,
          ) => Promise<void>
        )(
          { params: {}, body: {}, headers: {} } as unknown as ExpressRequest,
          {} as ExpressResponse,
          (() => {}) as NextFunction,
        );
      }
    }

    spy.mockRestore();
    return asked;
  }

  test("Fix with AI is refused while the server has Data Security or Code switched off", async () => {
    expect(
      await productsRefusedWhileOff(
        DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      ),
    ).toEqual([ProductKey.DataSecurity, ProductKey.Code]);
  });

  test("Explain, which writes the issue's timeline, is refused while Data Security is off; a read is not", async () => {
    expect(
      await productsRefusedWhileOff(
        DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      ),
    ).toEqual([ProductKey.DataSecurity]);
    expect(
      await productsRefusedWhileOff(
        DATA_SECURITY_API_ROUTES.recordOfProcessing,
      ),
    ).toEqual([]);
  });

  test.each(ROUTES)(
    "$name is a POST under its path, behind the user middleware and sign-in",
    (route: RouteCase) => {
      // Its chain as it was, beside the refusal while its product is off (#7479).
      expect(
        withoutRefusals(mockRouter.match("POST", route.path).middlewares),
      ).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  test.each(ROUTE_PERMISSIONS_ALLOWED)(
    "%s answers a caller holding %s",
    async (_name: string, permission: Permission, route: RouteCase) => {
      asCaller([permission]);
      repositories = [new CodeRepository(ObjectID.generate())];

      const result: RouteCall = await call(
        route.path,
        paramsFor(route),
        bodyFor(route),
      );

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toBeDefined();
    },
  );

  test.each(ROUTE_PERMISSIONS_REFUSED)(
    "%s refuses a caller holding only %s, before reading anything",
    async (_name: string, permission: Permission, route: RouteCase) => {
      asCaller([permission]);

      const result: RouteCall = await call(
        route.path,
        paramsFor(route),
        bodyFor(route),
      );

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrown as Exception).message).toBe(PERMISSION_MESSAGE);
      expect(result.answer).toBeUndefined();
      expect(readsMade()).toBe(0);
      expect(queueSpy).not.toHaveBeenCalled();
      expect(aiSpy).not.toHaveBeenCalled();
      expect(scrubSpy).not.toHaveBeenCalled();
      expect(dropSpy).not.toHaveBeenCalled();
      expect(dropImpactSpy).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "$name refuses an anonymous caller",
    async (route: RouteCase) => {
      propsSpy.mockResolvedValue({});

      const result: RouteCall = await call(
        route.path,
        paramsFor(route),
        bodyFor(route),
      );

      expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(readsMade()).toBe(0);
    },
  );

  test.each(ROUTES)(
    "$name refuses someone who is not a member of the project they named",
    async (route: RouteCase) => {
      propsSpy.mockResolvedValue(
        buildProps([Permission.ProjectOwner], ObjectID.generate()),
      );

      const result: RouteCall = await call(
        route.path,
        paramsFor(route),
        bodyFor(route),
      );

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(readsMade()).toBe(0);
    },
  );
});

// An S3 bucket OneUptime's workers scan, with nothing stopping it.
function workerStore(): DataStore {
  const store: DataStore = new DataStore(STORE_ID);
  store.projectId = PROJECT_ID;
  store.kind = DataStoreKind.AwsS3Bucket;
  store.provider = DataStoreProvider.Aws;
  store.isContentScanEnabled = true;
  store.isArchived = false;
  return store;
}

const PROBE_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

// A PostgreSQL database the project's own connected probe scans.
function probeStore(probe: Partial<Probe> = {}): DataStore {
  const store: DataStore = workerStore();
  store.kind = DataStoreKind.PostgreSql;
  store.provider = DataStoreProvider.SelfManaged;
  store.scanProbeId = PROBE_ID;
  store.probeConnectionVariable = "ORDERS_DB_URL";
  const scanProbe: Probe = new Probe(PROBE_ID);
  scanProbe.name = "Datacenter probe";
  scanProbe.isGlobalProbe = false;
  scanProbe.projectId = PROJECT_ID;
  scanProbe.connectionStatus = ProbeConnectionStatus.Connected;
  Object.assign(scanProbe, probe);
  store.scanProbe = scanProbe;
  return store;
}

function settingOf(data: Partial<DataSecuritySetting>): DataSecuritySetting {
  const setting: DataSecuritySetting = new DataSecuritySetting();
  setting.projectId = PROJECT_ID;
  Object.assign(setting, data);
  return setting;
}

describe("Scan Now and Check Now", () => {
  test("Scan Now makes the store due now and queues its scan", async () => {
    storeRow = workerStore();

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual({});
    expect(storeFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
      // What decides whether anything scans it, its probe read through it.
      select: {
        kind: true,
        provider: true,
        isContentScanEnabled: true,
        isArchived: true,
        scanProbeId: true,
        probeConnectionVariable: true,
        scanProbe: {
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
      },
      props: { isRoot: true },
    });
    expect(settingFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      select: { isContentScanEnabled: true, isTelemetryScanEnabled: true },
      props: { isRoot: true },
    });
    expect(storeUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { nextContentScanAt: NOW },
    });
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_SCAN_STORE_JOB,
        payload: {
          projectId: PROJECT_ID.toString(),
          dataStoreId: STORE_ID.toString(),
        },
      },
    ]);
  });

  test("Scan Now on a SQL Server database the workers scan: queued, as PostgreSQL's is (#8322)", async () => {
    storeRow = workerStore();
    storeRow.kind = DataStoreKind.SqlServer;
    storeRow.provider = DataStoreProvider.SelfManaged;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(queuedJobs()).toHaveLength(1);
  });

  test("Scan Now on a probe's store makes it due now for the probe, and queues no worker", async () => {
    storeRow = probeStore();
    settingRow = settingOf({ isContentScanEnabled: true });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual({});
    expect(storeUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { nextContentScanAt: NOW },
    });
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("Scan Now in a project with no Data Security settings yet: the defaults, content scanning on", async () => {
    storeRow = workerStore();
    settingRow = null;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(queuedJobs()).toHaveLength(1);
  });

  /*
   * It made any store due and queued a scan, and answered success, for a
   * store whose project scans no content or one no claim will hand out
   * (#8325). Each is refused now, with the sentence the Overview shows,
   * and nothing is made due or queued.
   */
  test.each([
    [
      "the store's Scan Content switch off",
      (): void => {
        storeRow = workerStore();
        storeRow.isContentScanEnabled = false;
      },
      "Content scanning is off for this store. Turn it on in its Settings.",
    ],
    [
      "the project's Scan Content switch off",
      (): void => {
        storeRow = workerStore();
        settingRow = settingOf({ isContentScanEnabled: false });
      },
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
    [
      "an archived store",
      (): void => {
        storeRow = workerStore();
        storeRow.isArchived = true;
      },
      "A store that is no longer found is not scanned. It is scanned again once it is found.",
    ],
    [
      "a kind OneUptime cannot sample",
      (): void => {
        storeRow = workerStore();
        storeRow.kind = DataStoreKind.AwsDynamoDbTable;
      },
      "OneUptime cannot sample this kind of store's content yet. Its configuration is still checked.",
    ],
    [
      "a service's telemetry, which the hourly telemetry scan reads",
      (): void => {
        storeRow = workerStore();
        storeRow.kind = DataStoreKind.TelemetryLogs;
        storeRow.provider = DataStoreProvider.OneUptime;
      },
      "A service's telemetry is scanned every hour, with the project's telemetry scan.",
    ],
    [
      "a service's telemetry whose own switch is off",
      (): void => {
        storeRow = workerStore();
        storeRow.kind = DataStoreKind.TelemetryLogs;
        storeRow.provider = DataStoreProvider.OneUptime;
        storeRow.isContentScanEnabled = false;
      },
      "Content scanning is off for this store. Turn it on in its Settings.",
    ],
    [
      "a probe's store with the project's switch off",
      (): void => {
        storeRow = probeStore();
        settingRow = settingOf({ isContentScanEnabled: false });
      },
      "Content scanning is off for this project. Turn it on in Data Security's Settings.",
    ],
    [
      "a probe's store with no connection variable",
      (): void => {
        storeRow = probeStore();
        storeRow.probeConnectionVariable = "";
      },
      "Name the probe's environment variable that holds the connection string, in its Settings.",
    ],
    [
      "a store on a global probe",
      (): void => {
        storeRow = probeStore({ isGlobalProbe: true });
      },
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    ],
    [
      "a store on another project's probe",
      (): void => {
        storeRow = probeStore({ projectId: ObjectID.generate() });
      },
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    ],
    [
      "a store whose probe is gone",
      (): void => {
        storeRow = probeStore();
        delete storeRow.scanProbe;
      },
      "Only a probe of this project's own scans a store. Pick one in its Settings.",
    ],
    [
      "a store on a disconnected probe, named",
      (): void => {
        storeRow = probeStore({
          connectionStatus: ProbeConnectionStatus.Disconnected,
        });
      },
      "Nothing scans this store while Datacenter probe is disconnected.",
    ],
  ])(
    "Scan Now on %s: refused, with why, and nothing made due or queued",
    async (_name: string, arrange: () => void, reason: string) => {
      arrange();

      const result: RouteCall = await call(
        DATA_SECURITY_API_ROUTES.scanNow(":id"),
        { id: STORE_ID.toString() },
      );

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as Exception).message).toBe(reason);
      expect(result.answer).toBeUndefined();
      expect(storeUpdateSpy).not.toHaveBeenCalled();
      expect(queueSpy).not.toHaveBeenCalled();
    },
  );

  test("a store of another project, or none at all, is not found, and nothing is queued", async () => {
    storeRow = null;

    for (const path of [
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
    ]) {
      const result: RouteCall = await call(path, { id: STORE_ID.toString() });

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as Exception).message).toBe(
        "Data store not found.",
      );
    }

    expect(storeUpdateSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("an id that is not an id is not found, before anything is read", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      {
        id: "../other-project",
      },
    );

    expect((result.thrown as Exception).message).toBe("Not found.");
    expect(storeFindOneSpy).not.toHaveBeenCalled();
  });

  test("Check Now reads the store's cloud connection again, then evaluates the project", async () => {
    const connectionId: ObjectID = ObjectID.generate();
    storeRow!.cloudConnectionId = connectionId;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.answer).toEqual({});
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_READ_CONNECTION_JOB,
        payload: {
          projectId: PROJECT_ID.toString(),
          cloudConnectionId: connectionId.toString(),
        },
      },
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
  });

  test("Check Now on a store with no cloud connection only evaluates the project", async () => {
    await call(DATA_SECURITY_API_ROUTES.checkNow(":id"), {
      id: STORE_ID.toString(),
    });

    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
  });
});

describe("Scrub It", () => {
  test("makes the scrub rule as the caller, marks the finding scrubbed, and evaluates again", async () => {
    asCaller([Permission.CreateProjectLogScrubRule]);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(scrubSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      // Its records are what the rule is proven on (#10366).
      findingId: STORE_ID.toString(),
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      serviceId: null,
      storeKey: null,
    });
    expect(findingFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
      // The store's service, and its key, which names it for a store kept without one (#10433).
      select: { dataStore: { kind: true, serviceId: true, storeKey: true } },
    });
    expect(findingUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { isScrubbed: true },
    });
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
    expect(result.answer).toEqual({
      signal: "log",
      scrubRuleId: "88888888-8888-4888-8888-888888888888",
      scrubRuleName: "Data Security: Email address in attributes.user.email",
      isProven: true,
    });
  });

  test("every kind of telemetry can be scrubbed", async () => {
    for (const kind of [
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetrySessionReplays,
      DataStoreKind.TelemetryAiConversations,
      DataStoreKind.TelemetryMetrics,
    ]) {
      findingRow = telemetryFinding(kind);

      const result: RouteCall = await call(
        DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
        { id: STORE_ID.toString() },
      );

      expect(result.thrown).toBeUndefined();
    }

    expect(scrubSpy).toHaveBeenCalledTimes(5);
  });

  test("a metric's attribute is scrubbed for the service whose metrics it is, by someone who may make metric pipeline rules", async () => {
    asCaller([Permission.CreateProjectMetricPipelineRule]);
    findingRow = telemetryFinding(DataStoreKind.TelemetryMetrics);

    const serviceId: ObjectID = ObjectID.generate();

    findingRow.dataStore!.serviceId = serviceId;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(scrubSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      findingId: STORE_ID.toString(),
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      serviceId,
      storeKey: null,
    });
  });

  test("a finding in a data store, not telemetry, is refused: Scrub It hides telemetry as it arrives", async () => {
    findingRow = telemetryFinding(DataStoreKind.AwsS3Bucket);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((result.thrown as Exception).message).toBe(
      "Scrub It hides data in telemetry as it arrives; this finding is in a data store, not in telemetry.",
    );
    expect(scrubSpy).not.toHaveBeenCalled();
    expect(findingUpdateSpy).not.toHaveBeenCalled();
  });

  test("a finding of another project, or with nothing to scrub, is not found", async () => {
    findingRow = null;

    const missing: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((missing.thrown as Exception).message).toBe("Finding not found.");

    findingRow = telemetryFinding(DataStoreKind.TelemetryLogs);
    delete findingRow.location;

    const nowhere: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((nowhere.thrown as Exception).message).toBe("Finding not found.");
    expect(scrubSpy).not.toHaveBeenCalled();
  });
});

/*
 * DROP THIS METRIC (#9757): dropping the new data points of a service's
 * metrics whose names hold a finding's data loses them for good, so it is
 * asked for in as many words, by someone who may make metric pipeline
 * rules, and made as them.
 */
describe("Drop This Metric", () => {
  const SERVICE_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );

  function nameFinding(): DataStoreFinding {
    const finding: DataStoreFinding = telemetryFinding(
      DataStoreKind.TelemetryMetrics,
    );

    finding.location = "name";
    finding.dataStore!.serviceId = SERVICE_ID;

    return finding;
  }

  test("drops as the caller, for the metrics' service, marks the finding scrubbed and evaluates again", async () => {
    asCaller([Permission.CreateProjectMetricPipelineRule]);
    findingRow = nameFinding();

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.dropMetric(":id"),
      { id: STORE_ID.toString() },
      { confirmDataLoss: true },
    );

    expect(result.thrown).toBeUndefined();
    expect(dropSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "name",
      serviceId: SERVICE_ID,
    });
    expect(findingUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { isScrubbed: true },
    });
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
    expect(result.answer).toEqual({
      ruleId: "99999999-9999-4999-8999-999999999999",
      ruleName: "Data Security: drop metrics named with Email address",
    });
    expect(scrubSpy).not.toHaveBeenCalled();
  });

  test("nothing is dropped unless the request confirms the data loss in as many words", async () => {
    asCaller([Permission.ProjectOwner]);
    findingRow = nameFinding();

    for (const body of [
      {},
      { confirmDataLoss: false },
      { confirmDataLoss: "true" },
      { confirmDataLoss: 1 },
    ] as Array<JSONObject>) {
      const result: RouteCall = await call(
        DATA_SECURITY_API_ROUTES.dropMetric(":id"),
        { id: STORE_ID.toString() },
        body,
      );

      expect((result.thrown as Exception).message).toBe(
        "Dropping these metrics loses their new data points for good. Confirm that you want them dropped.",
      );
    }

    expect(dropSpy).not.toHaveBeenCalled();
    expect(findingUpdateSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("what dropping would do is worked out with the caller's own permissions, for the finding's service", async () => {
    asCaller([Permission.CreateProjectMetricPipelineRule]);
    findingRow = nameFinding();

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.dropMetricImpact(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(dropImpactSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        dataTypeId: "email-address",
        location: "name",
        serviceId: SERVICE_ID,
        props: expect.objectContaining({ userId: USER_ID }),
      }),
    );
    // Never as OneUptime itself: the monitors and dashboards named are the caller's.
    expect(dropImpactSpy.mock.calls[0]![0].props.isRoot).toBeFalsy();
    expect(result.answer).toMatchObject({
      isAvailable: true,
      metricsMatched: 2,
    });
    // Asking changes nothing.
    expect(dropSpy).not.toHaveBeenCalled();
    expect(findingUpdateSpy).not.toHaveBeenCalled();
  });

  test("a finding of another project, or in a data store, is refused", async () => {
    asCaller([Permission.ProjectOwner]);
    findingRow = null;

    const missing: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.dropMetric(":id"),
      { id: STORE_ID.toString() },
      { confirmDataLoss: true },
    );

    expect((missing.thrown as Exception).message).toBe("Finding not found.");

    findingRow = telemetryFinding(DataStoreKind.AwsS3Bucket);

    const notTelemetry: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.dropMetricImpact(":id"),
      { id: STORE_ID.toString() },
    );

    expect((notTelemetry.thrown as Exception).message).toBe(
      "Scrub It hides data in telemetry as it arrives; this finding is in a data store, not in telemetry.",
    );
    expect(dropSpy).not.toHaveBeenCalled();
    expect(dropImpactSpy).not.toHaveBeenCalled();
  });
});

describe("What Scrub It would do", () => {
  let impactSpy: jest.SpyInstance;

  beforeEach(() => {
    impactSpy = jest
      .spyOn(TelemetryScrubImpact, "getScrubItImpact")
      .mockResolvedValue({
        isAvailable: true,
        rule: {
          signal: "log",
          name: "Data Security: Email address in log attributes of checkout",
          scrubAction: "redact",
          patternType: "email",
          fieldsToScrub: "attributes",
          dataTypeName: "Email address",
        },
      });
  });

  test("is worked out with the caller's own permissions, for the finding's store, and changes nothing", async () => {
    asCaller([Permission.CreateProjectLogScrubRule]);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubImpact(":id"),
      { id: STORE_ID.toString() },
    );

    expect(result.thrown).toBeUndefined();
    expect(impactSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "email-address",
        location: "attributes.user.email",
        serviceId: null,
        storeKey: null,
        props: expect.objectContaining({ userId: USER_ID }),
      }),
    );
    // Never as OneUptime itself: the records named are the caller's.
    expect(impactSpy.mock.calls[0]![0].props.isRoot).toBeFalsy();
    expect(result.answer).toMatchObject({
      isAvailable: true,
      rule: { scrubAction: "redact" },
    });
    expect(scrubSpy).not.toHaveBeenCalled();
    expect(findingUpdateSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("is asked by whoever may press Scrub It, and no one else", async () => {
    asCaller([Permission.ReadDataStore]);

    const refused: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubImpact(":id"),
      { id: STORE_ID.toString() },
    );

    expect(refused.thrown).toBeDefined();
    expect(impactSpy).not.toHaveBeenCalled();
  });

  test("a finding in a data store, not telemetry, is refused", async () => {
    asCaller([Permission.ProjectOwner]);
    findingRow = telemetryFinding(DataStoreKind.AwsS3Bucket);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubImpact(":id"),
      { id: STORE_ID.toString() },
    );

    expect((result.thrown as Exception).message).toBe(
      "Scrub It hides data in telemetry as it arrives; this finding is in a data store, not in telemetry.",
    );
    expect(impactSpy).not.toHaveBeenCalled();
  });
});

describe("A telemetry finding's records", () => {
  const SERVICE_ID: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );
  const WEB_APP_ID: string = "55555555-5555-4555-8555-555555555555";
  const ROUTE: string = DATA_SECURITY_API_ROUTES.findingOccurrences(":id");

  let tablePermissionSpy: jest.SpyInstance;
  let scopeSpy: jest.SpyInstance;
  let setupSpy: jest.SpyInstance;
  let occurrencesSpy: jest.SpyInstance;
  let scanOptions: ContentScanOptions;

  const READ_ANSWER: DataSecurityFindingOccurrences = {
    occurrences: [
      {
        time: "2026-10-27T11:57:00.000Z",
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        serviceId: SERVICE_ID.toString(),
        traceId: "trace-1",
        maskedValue: "j***@a********.com",
      },
    ],
    since: "2026-10-20T12:00:00.000Z",
    until: "2026-10-27T12:00:00.000Z",
    recordsRead: 12,
    isComplete: true,
  };

  function serviceFinding(
    kind: DataStoreKind,
    location: string = "attributes.user.email",
  ): DataStoreFinding {
    const finding: DataStoreFinding = telemetryFinding(kind);
    finding.location = location;
    finding.dataStore!.serviceId = SERVICE_ID;
    finding.dataStore!.storeKey = `telemetry:${SERVICE_ID.toString()}:${kind}`;
    return finding;
  }

  async function records(): Promise<RouteCall> {
    return await call(ROUTE, { id: STORE_ID.toString() });
  }

  function unavailable(
    reason: DataSecurityOccurrencesUnavailableReason,
  ): DataSecurityFindingOccurrences {
    return {
      occurrences: [],
      since: "2026-10-20T12:00:00.000Z",
      until: "2026-10-27T12:00:00.000Z",
      recordsRead: 0,
      isComplete: true,
      unavailableReason: reason,
    };
  }

  beforeEach(() => {
    findingRow = serviceFinding(DataStoreKind.TelemetryLogs);
    scanOptions = {
      limits: {
        maxObjects: 2000,
        maxBytesPerObject: 65536,
        maxBytesTotal: 52428800,
        maxRowsPerTable: 1000,
        maxTables: 200,
        deadline: new Date(NOW.getTime() + 60_000),
      },
      customDetectors: [],
      extraHints: [],
      disabledDataTypeIds: new Set(),
      allowedValues: new Set(["support@acme.io"]),
      exclusions: [],
      fingerprintKey: "key",
    };
    tablePermissionSpy = jest
      .spyOn(AnalyticsModelPermission, "checkReadPermission")
      .mockImplementation((async (...args: Array<unknown>) => {
        return { query: args[1], select: null };
      }) as never);
    scopeSpy = jest
      .spyOn(TelemetryReadAccess, "getScope")
      .mockResolvedValue({ readableIds: null, blockedIds: [] });
    setupSpy = jest
      .spyOn(DataSecurityRunner, "getScanSetup")
      .mockImplementation((async () => {
        return { options: scanOptions } as never;
      }) as never);
    occurrencesSpy = jest
      .spyOn(TelemetryFindingOccurrences, "findTelemetryFindingOccurrences")
      .mockResolvedValue(READ_ANSWER);
  });

  test("reads the records of the finding's store, at its location, for its data type, with the project's scan setup", async () => {
    asCaller([Permission.SecurityMember]);

    const result: RouteCall = await records();

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual(READ_ANSWER);
    expect(findingFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
      select: {
        dataTypeId: true,
        location: true,
        sampleRecords: true,
        lastSeenAt: true,
        dataStore: { kind: true, serviceId: true, storeKey: true },
      },
    });
    expect(setupSpy).toHaveBeenCalledWith(PROJECT_ID);
    // A finding no scan kept records for, nor saw: its newest records.
    expect(occurrencesSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      plan: {
        source: TelemetrySampleSource.Logs,
        read: { kind: "pairs", column: "attributes", key: "user.email" },
      },
      ownerId: SERVICE_ID.toString(),
      location: "attributes.user.email",
      dataTypeId: "email-address",
      options: scanOptions,
      sampleRecords: [],
      lastSeenAt: null,
      now: NOW,
    });
  });

  test("hands over the records the last scan found it in, read as records, and when it last saw it (#9549)", async () => {
    const lastSeenAt: Date = new Date(NOW.getTime() - 12 * 86_400_000);

    findingRow!.lastSeenAt = lastSeenAt;
    findingRow!.sampleRecords = [
      {
        time: "2026-10-15T11:59:58.123Z",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        // Nothing but a record's keys is read from the column.
        value: "jane.doe@acme-corp.com",
      } as unknown as FindingSampleRecord,
      { time: "not a time" },
    ];

    await records();

    expect(occurrencesSpy.mock.calls[0]![0]).toMatchObject({
      sampleRecords: [
        {
          time: "2026-10-15T11:59:58.123Z",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        },
      ],
      lastSeenAt,
    });
    expect(JSON.stringify(occurrencesSpy.mock.calls[0]![0])).not.toContain(
      "jane.doe",
    );
  });

  test("asks whether the caller may read that telemetry themselves, of the table its records are rows of", async () => {
    const cases: Array<[DataStoreKind, string, unknown, string]> = [
      [
        DataStoreKind.TelemetryLogs,
        "attributes.user.email",
        Log,
        SERVICE_ID.toString(),
      ],
      [
        DataStoreKind.TelemetryTraces,
        "attributes.user.pps",
        Span,
        SERVICE_ID.toString(),
      ],
      [
        DataStoreKind.TelemetryAiConversations,
        "gen_ai.input.messages",
        Span,
        SERVICE_ID.toString(),
      ],
      [
        DataStoreKind.TelemetryExceptions,
        "message",
        ExceptionInstance,
        SERVICE_ID.toString(),
      ],
      [
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserTraits.email",
        RumSession,
        WEB_APP_ID,
      ],
      [
        DataStoreKind.TelemetrySessionReplays,
        "logs.attributes.email",
        Log,
        WEB_APP_ID,
      ],
      // A metric's points: read by who may read the service's metrics (#9604).
      [
        DataStoreKind.TelemetryMetrics,
        "attributes.user.email",
        Metric,
        SERVICE_ID.toString(),
      ],
      [DataStoreKind.TelemetryMetrics, "name", Metric, SERVICE_ID.toString()],
    ];

    for (const [kind, location, model, ownerId] of cases) {
      tablePermissionSpy.mockClear();
      scopeSpy.mockClear();
      findingRow = serviceFinding(kind, location);

      if (kind === DataStoreKind.TelemetrySessionReplays) {
        // A RUM application is not a service: its id is in the store's key.
        delete findingRow.dataStore!.serviceId;
        findingRow.dataStore!.storeKey = `telemetry:${WEB_APP_ID}:${kind}`;
      }

      const result: RouteCall = await records();

      expect([kind, location, result.thrown]).toEqual([
        kind,
        location,
        undefined,
      ]);
      expect(tablePermissionSpy.mock.calls[0]![0]).toBe(model);
      expect(tablePermissionSpy.mock.calls[0]![1]).toEqual({
        projectId: PROJECT_ID,
        primaryEntityId: new ObjectID(ownerId),
      });
      expect(
        (tablePermissionSpy.mock.calls[0]![3] as DatabaseCommonInteractionProps)
          .userId,
      ).toEqual(USER_ID);
      expect(scopeSpy.mock.calls[0]![0]).toBe(model);
    }
  });

  test("a caller who may not read the store's telemetry gets no records, and nothing is read", async () => {
    asCaller([Permission.SecurityMember]);
    tablePermissionSpy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read logs."),
    );

    const result: RouteCall = await records();

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess),
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
    expect(setupSpy).not.toHaveBeenCalled();
  });

  test("a caller whose plan does not reach the table gets no records", async () => {
    tablePermissionSpy.mockRejectedValue(
      new PaymentRequiredException("Please upgrade your plan."),
    );

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess),
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("a caller whose grants reach other services, or block this one, gets no records", async () => {
    scopeSpy.mockResolvedValue({
      readableIds: ["66666666-6666-4666-8666-666666666666"],
      blockedIds: [],
    });

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess),
    );

    scopeSpy.mockResolvedValue({
      readableIds: null,
      blockedIds: [SERVICE_ID.toString().toUpperCase()],
    });

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoTelemetryAccess),
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("a caller whose grants reach this service reads its records", async () => {
    scopeSpy.mockResolvedValue({
      readableIds: [SERVICE_ID.toString().toUpperCase()],
      blockedIds: [],
    });

    expect((await records()).answer).toEqual(READ_ANSWER);
  });

  test("any other failure of the permission check is not taken for a refusal", async () => {
    tablePermissionSpy.mockRejectedValue(new Error("Postgres is down"));

    const result: RouteCall = await records();

    expect((result.thrown as Error).message).toBe("Postgres is down");
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("a location no record has, or a store whose service is gone, says why", async () => {
    findingRow = serviceFinding(DataStoreKind.TelemetryTraces, "body");

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.UnreadableLocation),
    );

    findingRow = serviceFinding(DataStoreKind.TelemetryLogs);
    delete findingRow.dataStore!.serviceId;

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoOwner),
    );

    findingRow = serviceFinding(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.attributes.plan",
    );
    findingRow.dataStore!.storeKey = "telemetry:not-an-id:Session Replays";

    expect((await records()).answer).toEqual(
      unavailable(DataSecurityOccurrencesUnavailableReason.NoOwner),
    );
    expect(tablePermissionSpy).not.toHaveBeenCalled();
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("a finding in a data store has no records to show", async () => {
    findingRow = serviceFinding(DataStoreKind.AwsS3Bucket, "exports/*.csv");

    const result: RouteCall = await records();

    expect((result.thrown as Exception).message).toBe(
      "Only a finding in telemetry has records to show; this finding is in a data store.",
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("a finding of another project, or with no data type or location, is not found", async () => {
    findingRow = null;

    expect(((await records()).thrown as Exception).message).toBe(
      "Finding not found.",
    );

    findingRow = serviceFinding(DataStoreKind.TelemetryLogs);
    delete findingRow.dataTypeId;

    expect(((await records()).thrown as Exception).message).toBe(
      "Finding not found.",
    );
    expect(occurrencesSpy).not.toHaveBeenCalled();
  });

  test("an id that is not one is not found, and nothing is read", async () => {
    const result: RouteCall = await call(ROUTE, { id: "not-an-id" });

    expect((result.thrown as Exception).message).toBe("Not found.");
    expect(findingFindOneSpy).not.toHaveBeenCalled();
  });

  test("end to end: ClickHouse's rows come back as masked records, never a raw value", async () => {
    occurrencesSpy.mockRestore();
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (): Promise<Results> => {
        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({
              data: [
                {
                  ownerId: SERVICE_ID.toString(),
                  recordTime: String(NOW.getTime() - 3 * 60_000),
                  readTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                  readSpanId: "00f067aa0ba902b7",
                  readSeverity: "Warning",
                  readAttributes: [["user.email", "jane.doe@acme-corp.com"]],
                },
                {
                  ownerId: SERVICE_ID.toString(),
                  recordTime: String(NOW.getTime() - 4 * 60_000),
                  // A value the project allows is no finding's.
                  readAttributes: [["user.email", "support@acme.io"]],
                },
              ],
            });
          },
        } as unknown as Results;
      }) as never);

    const result: RouteCall = await records();
    const answer: DataSecurityFindingOccurrences =
      result.answer as unknown as DataSecurityFindingOccurrences;

    expect(result.thrown).toBeUndefined();
    expect(answer.occurrences).toEqual([
      {
        time: "2026-10-27T11:57:00.000Z",
        recordKind: DataSecurityOccurrenceRecordKind.Log,
        serviceId: SERVICE_ID.toString(),
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        severity: "Warning",
        maskedValue: "j***@a********.com",
        excerpt: {
          field: "user.email",
          parts: [
            {
              kind: DataSecurityOccurrenceExcerptPartKind.Match,
              text: "j***@a********.com",
            },
          ],
          isCutAtStart: false,
          isCutAtEnd: false,
        },
      },
    ]);
    expect(answer.recordsRead).toBe(2);
    expect(answer.source).toBe(DataSecurityOccurrencesSource.Recent);
    expect(JSON.stringify(answer)).not.toContain("jane.doe");
    expect(JSON.stringify(answer)).not.toContain("support@acme.io");
  });

  test("end to end, with the records the last scan kept: those records, looked up by their millisecond", async () => {
    occurrencesSpy.mockRestore();

    const statements: Array<Statement> = [];
    const lastSeenAt: Date = new Date("2026-10-15T12:01:30.000Z");

    findingRow = serviceFinding(DataStoreKind.TelemetryLogs, "body");
    findingRow.dataTypeId = "ip-address";
    findingRow.lastSeenAt = lastSeenAt;
    findingRow.sampleRecords = [{ time: "2026-10-15T11:59:58.123Z" }];
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({
              data: [
                {
                  ownerId: SERVICE_ID.toString(),
                  recordTime: String(Date.parse("2026-10-15T11:59:58.123Z")),
                  readSeverity: "Info",
                  readBody: "Ping to 34.120.7.19 succeeded in 120 ms",
                },
              ],
            });
          },
        } as unknown as Results;
      }) as never);

    const answer: DataSecurityFindingOccurrences = (await records())
      .answer as unknown as DataSecurityFindingOccurrences;

    expect(statements.length).toBe(1);
    expect(statements[0]!.query).toMatch(
      /AND \(\(time >= \{p\d+:DateTime64\(9\)\} AND time < \{p\d+:DateTime64\(9\)\}\)\)/,
    );
    // A lookup of kept records is not narrowed by a pattern.
    expect(statements[0]!.query).not.toContain("match(substringUTF8(body");
    expect(answer.source).toBe(DataSecurityOccurrencesSource.SampledRecords);
    expect(answer.lastSeenAt).toBe(lastSeenAt.toISOString());
    expect(
      answer.occurrences.map(
        (occurrence: DataSecurityFindingOccurrence): string => {
          return (occurrence.excerpt?.parts || [])
            .map((part: { text: string }): string => {
              return part.text;
            })
            .join("");
        },
      ),
    ).toEqual(["Ping to 34.***.***.*** succeeded in 120 ms"]);
    expect(JSON.stringify(answer)).not.toContain("34.120.7.19");
  });

  test("end to end, a metric's kept point: looked up by its metric and millisecond, narrowed, each series once, masked (#9604)", async () => {
    occurrencesSpy.mockRestore();

    const statements: Array<Statement> = [];
    const pointTime: string = "2026-10-27T11:59:00.000Z";

    findingRow = serviceFinding(
      DataStoreKind.TelemetryMetrics,
      "attributes.http.route",
    );
    findingRow.lastSeenAt = new Date("2026-10-27T12:00:30.000Z");
    findingRow.sampleRecords = [{ time: pointTime, metricName: "http.calls" }];
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        const point: (route: string) => JSONObject = (
          route: string,
        ): JSONObject => {
          return {
            ownerId: SERVICE_ID.toString(),
            recordTime: String(Date.parse(pointTime)),
            readMetricName: "http.calls",
            readAttributes: [["http.route", route]],
          };
        };

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({
              data: [
                point("/users/jane.doe@acme-corp.com/orders"),
                // The same series again: one record.
                point("/users/jane.doe@acme-corp.com/orders"),
                point("/users/sam.lee@acme-corp.com/orders"),
              ],
            });
          },
        } as unknown as Results;
      }) as never);

    const answer: DataSecurityFindingOccurrences = (await records())
      .answer as unknown as DataSecurityFindingOccurrences;

    expect(statements.length).toBe(1);
    // The metric's own range of the table, at the kept millisecond.
    expect(statements[0]!.query).toMatch(
      /AND \(\(name = \{p\d+:String\} AND time >= \{p\d+:DateTime64\(9\)\} AND time < \{p\d+:DateTime64\(9\)\}\)\)/,
    );
    // Every series of the metric shares the millisecond: narrowed by the pattern.
    expect(statements[0]!.query).toContain("match(substringUTF8(attributes[");
    expect(Object.values(statements[0]!.query_params)).toContain("http.calls");
    expect(answer.source).toBe(DataSecurityOccurrencesSource.SampledRecords);
    expect(
      answer.occurrences.map(
        (occurrence: DataSecurityFindingOccurrence): unknown => {
          return [
            occurrence.recordKind,
            occurrence.name,
            occurrence.metricName,
            occurrence.excerpt?.field,
          ];
        },
      ),
    ).toEqual([
      [
        DataSecurityOccurrenceRecordKind.Metric,
        "http.calls",
        "http.calls",
        "http.route",
      ],
      [
        DataSecurityOccurrenceRecordKind.Metric,
        "http.calls",
        "http.calls",
        "http.route",
      ],
    ]);
    expect(JSON.stringify(answer)).not.toContain("jane.doe");
    expect(JSON.stringify(answer)).not.toContain("sam.lee");
  });
});

describe("Explain and Fix With AI", () => {
  test("Explain answers OneUptime AI's analysis of the issue (#10369), asked for as the caller, as they may read it", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      { id: STORE_ID.toString() },
    );

    // The caller's own read of the issue first: one they may not read is not found.
    expect(issueFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
      props: { userId: USER_ID },
    });
    expect(analyzeSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      issueId: issueRow!.id,
      userId: USER_ID,
      force: false,
    });
    // Each fact as the caller may read it.
    expect(viewSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      stored: STORED_ANALYSIS,
      props: { userId: USER_ID },
    });
    expect(result.answer).toEqual({
      markdown: DataSecurityIssueAnalysisReader.toMarkdown(ANALYSIS_VIEW),
      analysis: ANALYSIS_VIEW,
      isNew: true,
    });
    // The analysis asks OneUptime AI itself, through the one Data Security call.
    expect(aiSpy).not.toHaveBeenCalled();
  });

  test("Analyze Again asks anyway: force is true only when the body says true", async () => {
    for (const [force, asked] of [
      [true, true],
      ["true", false],
      [1, false],
      [undefined, false],
    ] as Array<[unknown, boolean]>) {
      analyzeSpy.mockClear();

      await call(
        DATA_SECURITY_API_ROUTES.explainIssue(":id"),
        { id: STORE_ID.toString() },
        force === undefined ? {} : { force: force as JSONObject[string] },
      );

      expect((analyzeSpy.mock.calls[0]![0] as { force: boolean }).force).toBe(
        asked,
      );
    }
  });

  test("Explain's label keeps the value it was always written with, and is no autonomous feature's", () => {
    expect(AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE).toBe(
      "DataSecurityIssueExplanation",
    );
    expect(AUTONOMOUS_AI_FEATURES).not.toContain(
      AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
    );
  });

  test("what stops the analysis is the route's answer: AI off, or an answer that is not an analysis", async () => {
    analyzeSpy.mockRejectedValue(
      new BadDataException("AI is turned off for this project."),
    );

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      { id: STORE_ID.toString() },
    );

    expect((result.thrown as Exception).message).toBe(
      "AI is turned off for this project.",
    );
    expect(result.answer).toBeUndefined();
  });

  test("an issue of another project, or one the caller may not read, is not found, and OneUptime AI is not asked", async () => {
    issueRow = null;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      { id: STORE_ID.toString() },
    );

    expect((result.thrown as Exception).message).toBe("Issue not found.");
    expect(analyzeSpy).not.toHaveBeenCalled();
    expect(aiSpy).not.toHaveBeenCalled();
  });

  test("the issue's analysis route reads the analysis the issue keeps, as the caller may read it, and never asks OneUptime AI", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.issueAnalysis(":id"),
      { id: STORE_ID.toString() },
    );

    expect(storedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      issueId: STORE_ID,
    });
    expect(viewSpy.mock.calls[0]![0]).toMatchObject({
      stored: STORED_ANALYSIS,
      props: { userId: USER_ID },
    });
    expect(result.answer).toEqual({ analysis: ANALYSIS_VIEW });
    expect(analyzeSpy).not.toHaveBeenCalled();
    expect(aiSpy).not.toHaveBeenCalled();
  });

  test("the issue's analysis route answers none for an issue never analyzed, and none with the project's AI off", async () => {
    storedSpy.mockResolvedValue(null);

    expect(
      (
        await call(DATA_SECURITY_API_ROUTES.issueAnalysis(":id"), {
          id: STORE_ID.toString(),
        })
      ).answer,
    ).toEqual({ analysis: null });

    storedSpy.mockResolvedValue(STORED_ANALYSIS);
    aiEnabledSpy.mockResolvedValue(false);

    expect(
      (
        await call(DATA_SECURITY_API_ROUTES.issueAnalysis(":id"), {
          id: STORE_ID.toString(),
        })
      ).answer,
    ).toEqual({ analysis: null });
    expect(viewSpy).not.toHaveBeenCalled();
  });

  function repositoryNamed(name: string): CodeRepository {
    const repository: CodeRepository = new CodeRepository(ObjectID.generate());
    repository.name = name;
    return repository;
  }

  async function askForFix(body: JSONObject = {}): Promise<RouteCall> {
    return await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      { id: STORE_ID.toString() },
      body,
    );
  }

  // As a task in Code is asked (#10362): the caller's own permissions throughout.
  test("Fix With AI starts a code task in the one repository the caller may read and ask in, as the caller, and notes it", async () => {
    const repository: CodeRepository = repositoryNamed("infra");
    repositories = [repository];

    const result: RouteCall = await askForFix();

    expect(readableSpy).toHaveBeenCalledTimes(1);
    expect(readableSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: { userId: USER_ID },
    });
    expect(canAskSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      repositoryId: repository.id,
      props: { userId: USER_ID },
    });
    // Asked first with no repository, then for the one the task works in.
    expect(
      gateSpy.mock.calls.map((gateCall: Array<unknown>): unknown => {
        return (gateCall[0] as { repository: CodeRepository | null })
          .repository;
      }),
    ).toEqual([null, repository]);
    expect(gateSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: { userId: USER_ID },
      canAsk: true,
    });
    expect(codeTaskSpy).toHaveBeenCalledTimes(1);

    const started: {
      projectId: ObjectID;
      userId: ObjectID;
      repository: CodeRepository;
      message: string;
      context: Array<unknown>;
    } = codeTaskSpy.mock.calls[0]![0];

    expect(started.projectId).toBe(PROJECT_ID);
    expect(started.userId).toBe(USER_ID);
    expect(started.repository).toBe(repository);
    expect(started.context).toEqual([]);
    expect(started.message).toContain("Open a pull request.");
    // The request DataSecurityAiInput builds for the issue (#10365).
    expect(started.message).toBe(
      buildDataSecurityFixRequest(
        issueRow!,
        [],
        new DataTypeNamer(new Map([[LOYALTY, "Loyalty card number"]])),
      ).text,
    );
    expect(started.message).toContain(
      '"dataTypes": [\n      "Card number",\n      "Loyalty card number"\n    ]',
    );
    expect(feedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataSecurityIssueId: issueRow!.id,
      eventType: DataSecurityIssueFeedEventType.AiFixRequested,
      displayColor: Purple500,
      feedInfoInMarkdown:
        "OneUptime AI was asked to open a fix as a pull request.",
      userId: USER_ID,
    });
    expect(result.answer).toEqual({
      message:
        "OneUptime AI is working on a fix. Its pull request will appear under Code.",
      aiRunId: "77777777-7777-4777-8777-777777777777",
    });
  });

  test("with no repository the caller may read, it says to connect one or ask for permission to edit it", async () => {
    const result: RouteCall = await askForFix();

    expect(result.answer).toEqual({
      message: getDataSecurityFixNoRepositoryMessage(
        DataSecurityFixCode.Infrastructure,
      ),
    });
    expect(result.answer!["message"]).toBe(
      "Connect the repository that holds this store's infrastructure code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.",
    );
    expect(codeTaskSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("the only repository the caller may read, but not change, is refused in Code's words", async () => {
    const repository: CodeRepository = repositoryNamed("infra");
    repositories = [repository];
    notAskable.add(repository.id!.toString());

    const result: RouteCall = await askForFix();

    expect(result.answer).toEqual({ message: CODE_TASK_ASK_REFUSED_MESSAGE });
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("with several repositories and none chosen, it lists only those the caller may ask in", async () => {
    const infra: CodeRepository = repositoryNamed("infra");
    const website: CodeRepository = repositoryNamed("website");
    const platform: CodeRepository = repositoryNamed("platform");
    repositories = [infra, website, platform];
    notAskable.add(website.id!.toString());

    const result: RouteCall = await askForFix();

    expect(result.answer).toEqual({
      message: getDataSecurityFixPickRepositoryMessage(
        DataSecurityFixCode.Infrastructure,
      ),
      repositories: [
        { id: infra.id!.toString(), name: "infra" },
        { id: platform.id!.toString(), name: "platform" },
      ],
    });
    expect(result.answer!["message"]).toBe(
      "This project has several repositories: choose the one that holds this store's infrastructure code.",
    );
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("with several repositories the caller may read and none they may change, it says so", async () => {
    repositories = [repositoryNamed("infra"), repositoryNamed("website")];

    for (const repository of repositories) {
      notAskable.add(repository.id!.toString());
    }

    const result: RouteCall = await askForFix();

    expect(result.answer).toEqual({
      message: DATA_SECURITY_FIX_NO_ASKABLE_REPOSITORY_MESSAGE,
    });
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("the repository the caller chose is the one asked for, read with their permissions", async () => {
    const chosen: CodeRepository = repositoryNamed("infra");
    repositories = [repositoryNamed("website"), chosen];

    await askForFix({ codeRepositoryId: chosen.id!.toString() });

    expect(readableOneSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: { userId: USER_ID },
    });
    expect(
      (
        readableOneSpy.mock.calls[0]![0] as { repositoryId: ObjectID }
      ).repositoryId.toString(),
    ).toBe(chosen.id!.toString());
    expect(readableSpy).not.toHaveBeenCalled();
    expect(
      (codeTaskSpy.mock.calls[0]![0] as { repository: CodeRepository })
        .repository,
    ).toBe(chosen);
  });

  test("a repository the caller chose that they may not read is not found, as Code answers it", async () => {
    repositories = [repositoryNamed("website")];

    const result: RouteCall = await askForFix({
      codeRepositoryId: ObjectID.generate().toString(),
    });

    expect(result.thrown).toBeInstanceOf(NotFoundException);
    expect((result.thrown as Exception).message).toBe(
      CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
    );
    expect(codeTaskSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a repository the caller chose that they may read but not change is refused with Code's own sentence", async () => {
    const chosen: CodeRepository = repositoryNamed("infra");
    repositories = [chosen];
    notAskable.add(chosen.id!.toString());

    const result: RouteCall = await askForFix({
      codeRepositoryId: chosen.id!.toString(),
    });

    expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrown as Exception).message).toBe(
      CODE_TASK_ASK_REFUSED_MESSAGE,
    );
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("a repository id that is not an id is no choice: with several repositories, it still asks which", async () => {
    repositories = [repositoryNamed("infra"), repositoryNamed("website")];

    const result: RouteCall = await askForFix({
      codeRepositoryId: "infrastructure-repo",
    });

    expect(result.answer!["message"]).toBe(
      "This project has several repositories: choose the one that holds this store's infrastructure code.",
    );
    expect(readableOneSpy).not.toHaveBeenCalled();
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test.each([
    [
      "AI switched off for the project",
      CodeTaskBlockerType.AiDisabled,
      "AI is disabled for this project. Enable it in Project Settings > AI.",
    ],
    [
      "no AI credits",
      CodeTaskBlockerType.NoAiCredits,
      "This project is out of AI credits.",
    ],
    [
      "the daily limits reached",
      CodeTaskBlockerType.DailyLimitReached,
      "This project has used its daily AI token limit.",
    ],
  ])(
    "with %s it says what to fix, before any repository is asked about, and starts nothing",
    async (_what: string, type: CodeTaskBlockerType, message: string) => {
      repositories = [repositoryNamed("infra"), repositoryNamed("website")];
      blockerBeforeRepository = { type, message };

      const result: RouteCall = await askForFix();

      expect(result.answer).toEqual({ message });
      expect(readableSpy).not.toHaveBeenCalled();
      expect(codeTaskSpy).not.toHaveBeenCalled();
      expect(feedSpy).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      "no Runner online",
      CodeTaskBlockerType.NoAgent,
      "No global Runner is online.",
    ],
    [
      "a repository its Git server no longer lets OneUptime reach",
      CodeTaskBlockerType.RepositoryNotConnected,
      "AI can only work in a GitHub repository connected through the GitHub App, and this one is not. Connect GitHub again from Code.",
    ],
  ])(
    "with %s in the repository, it says what to fix and starts nothing",
    async (_what: string, type: CodeTaskBlockerType, message: string) => {
      repositories = [repositoryNamed("infra")];
      blockerInRepository = { type, message };

      const result: RouteCall = await askForFix();

      expect(result.answer).toEqual({ message });
      expect(codeTaskSpy).not.toHaveBeenCalled();
      expect(feedSpy).not.toHaveBeenCalled();
    },
  );
});

describe("Fix With AI on a telemetry issue", () => {
  const TRACES_STORE_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );

  function telemetryIssue(checkId: string): DataSecurityIssue {
    const issue: DataSecurityIssue = new DataSecurityIssue(STORE_ID);
    issue.checkId = checkId;
    issue.title = "Sensitive data is reaching your telemetry";
    issue.severity = SecuritySeverity.High;
    issue.evidence =
      "2 kinds of sensitive data are not scrubbed: IP address, Ireland PPS number.";
    issue.dataStoreId = TRACES_STORE_ID;
    const store: DataStore = new DataStore();
    store.name = "oneuptime-app · Traces";
    store.kind = DataStoreKind.TelemetryTraces;
    store.sensitivity = DataSensitivity.Restricted;
    issue.dataStore = store;
    return issue;
  }

  function finding(
    dataTypeId: string,
    location: string,
    overrides: Partial<DataStoreFinding> = {},
  ): DataStoreFinding {
    const row: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
    row.dataTypeId = dataTypeId;
    row.dataTypeName = dataTypeId;
    row.location = location;
    row.locationKind = "Attribute";
    row.confidence = DataConfidence.High;
    row.matchCount = 40;
    row.isScrubbed = false;
    row.isConfirmed = false;
    row.isAiSuggested = false;
    Object.assign(row, overrides);
    return row;
  }

  beforeEach(() => {
    issueRow = telemetryIssue("sensitive-data-in-telemetry");
    findings = [
      finding("ie-ppsn", "attributes.user.pps"),
      finding("ip-address", "attributes.http.client_ip"),
      // The other check's: a secret.
      finding("github-token", "attributes.config.token"),
      // Not counted, or not sure enough: none of them is named.
      finding("email-address", "attributes.user.email", {
        confidence: DataConfidence.Low,
      }),
      finding("phone-number", "attributes.user.phone", {
        isAiSuggested: true,
        matchCount: 0,
      }),
    ];
  });

  test("Fix With AI tells OneUptime AI where the data sits in the service's telemetry: the places its check counts", async () => {
    repositories = [new CodeRepository(ObjectID.generate())];

    await call(DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"), {
      id: STORE_ID.toString(),
    });

    const message: string = (
      codeTaskSpy.mock.calls[0]![0] as { message: string }
    ).message;

    expect(message).toContain('"location": "attributes.http.client_ip"');
    expect(message).not.toContain("config.token");
    expect(message).not.toContain("user.email");
    expect(message).not.toContain("user.phone");
  });

  test("the places are read from the issue's own store and project, unscrubbed, still seen, never a sample", async () => {
    repositories = [new CodeRepository(ObjectID.generate())];

    await call(DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"), {
      id: STORE_ID.toString(),
    });

    const read: {
      query: JSONObject;
      select: JSONObject;
      props: JSONObject;
    } = findingFindSpy.mock.calls[0]![0];

    expect(read.query).toMatchObject({
      projectId: PROJECT_ID,
      dataStoreId: TRACES_STORE_ID,
      isSuppressed: false,
      isScrubbed: false,
    });
    expect(read.query["lastSeenAt"]).toBeDefined();
    expect(read.select["maskedSamples"]).toBeUndefined();
    expect(read.props).toEqual({ isRoot: true });
  });

  test("the secrets check names its secrets, and only them", async () => {
    issueRow = telemetryIssue("secrets-in-telemetry");
    repositories = [new CodeRepository(ObjectID.generate())];

    await call(DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"), {
      id: STORE_ID.toString(),
    });

    const message: string = (
      codeTaskSpy.mock.calls[0]![0] as { message: string }
    ).message;

    expect(message).toContain('"location": "attributes.config.token"');
    expect(message).toContain('"dataType": "GitHub token"');
    expect(message).not.toContain("attributes.user.pps");
  });

  test("an issue that is not about telemetry reads no findings, and asks for its infrastructure code", async () => {
    issueRow = issueOf();
    repositories = [new CodeRepository(ObjectID.generate())];

    await call(DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"), {
      id: STORE_ID.toString(),
    });

    expect(findingFindSpy).not.toHaveBeenCalled();
    expect(
      (codeTaskSpy.mock.calls[0]![0] as { message: string }).message,
    ).toContain("infrastructure code");
  });

  test("Fix With AI asks for a change to the service's code at each place, not to infrastructure code", async () => {
    repositories = [new CodeRepository(ObjectID.generate())];

    await call(DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"), {
      id: STORE_ID.toString(),
    });

    const message: string = (
      codeTaskSpy.mock.calls[0]![0] as { message: string }
    ).message;

    expect(message).toContain(
      "Fix this data security issue in the code of the service that writes this data to its telemetry",
    );
    expect(message).not.toContain("infrastructure code");
    expect(message).toContain('"location": "attributes.user.pps"');
    expect(message).toContain('"dataType": "Ireland PPS number"');
    expect(message).toContain("Open a pull request.");
  });

  test("Fix With AI asks for the repository that holds the service's code", async () => {
    const none: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      { id: STORE_ID.toString() },
    );

    expect(none.answer).toEqual({
      message:
        "Connect the repository that holds this service's code under Code, then ask again. If it is connected already, asking OneUptime AI to change it takes permission to edit it in Code - ask a Project Admin for it.",
    });

    repositories = [
      new CodeRepository(ObjectID.generate()),
      new CodeRepository(ObjectID.generate()),
    ];

    const several: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      { id: STORE_ID.toString() },
    );

    expect(several.answer!["message"]).toBe(
      "This project has several repositories: choose the one that holds this service's code.",
    );
    expect(several.answer!["repositories"]).toHaveLength(2);
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });
});

describe("what OneUptime AI sees (#10365)", () => {
  test("is read with the caller's own permissions, for the issue asked for", async () => {
    const issueId: ObjectID = ObjectID.generate();

    await call(
      DATA_SECURITY_API_ROUTES.aiInput,
      {},
      {
        withExample: true,
        issueId: issueId.toString(),
      },
    );

    expect(aiSettingsSpy).toHaveBeenCalledTimes(1);
    expect(aiSettingsSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: { userId: USER_ID },
      withExample: true,
      issueId,
    });
  });

  test("builds no example unless asked to", async () => {
    await call(DATA_SECURITY_API_ROUTES.aiInput, {}, { withExample: "yes" });

    expect(
      (aiSettingsSpy.mock.calls[0]![0] as { withExample: boolean }).withExample,
    ).toBe(false);
  });

  test("an issue id that is not one asks for none: the riskiest open issue's", async () => {
    await call(DATA_SECURITY_API_ROUTES.aiInput, {}, { issueId: "nope" });

    expect(
      (aiSettingsSpy.mock.calls[0]![0] as { issueId?: ObjectID }).issueId,
    ).toBeUndefined();
  });
});

describe("the issue as Fix with AI tells OneUptime AI it (DataSecurityAiInput, #10365)", () => {
  // The JSON the request carries, read back from its code fence.
  function dataOf(issue: DataSecurityIssue): JSONObject {
    const text: string = buildDataSecurityFixRequest(issue).text;

    return JSON.parse(
      text.slice(text.indexOf("```json\n") + 8, text.lastIndexOf("\n```")),
    ) as JSONObject;
  }

  test("says what the check saw and how to fix it on the store's cloud, with the store's values filled in", () => {
    const data: JSONObject = dataOf(issueOf());
    const check: ReturnType<typeof getDataSecurityCheck> =
      getDataSecurityCheck("public-read");
    const issue: JSONObject = data["issue"] as JSONObject;
    const fix: JSONObject = issue["fix"] as JSONObject;

    expect(issue).toMatchObject({
      title: "Anyone on the internet can read it",
      check: "public-read",
      severity: "Critical",
      // No names handed in: one of the project's own, never by its id (#10363).
      dataTypes: ["Card number", "Custom data type"],
      evidence: "The bucket policy grants s3:GetObject to *.",
      whyItMatters: check!.whyItMatters,
    });
    expect(data["store"]).toEqual({
      name: "customer-exports",
      kind: "AWS S3 Bucket",
      region: "us-east-1",
      cloudId: "arn:aws:s3:::customer-exports",
      sensitivity: "Restricted",
    });
    expect((fix["steps"] as Array<string>)[0]).toBe(
      "Open the bucket in the S3 console and choose Permissions.",
    );
    expect(fix["cli"]).toContain(
      "aws s3api put-public-access-block --bucket customer-exports --public-access-block-configuration",
    );
    expect(fix["terraform"]).toContain(
      'resource "aws_s3_bucket_public_access_block" "customer-exports" {',
    );
    expect(JSON.stringify(data)).not.toContain("{name}");
  });

  test("an issue with little recorded leaves out what it does not know, never guessing it", () => {
    const issue: DataSecurityIssue = new DataSecurityIssue(STORE_ID);
    issue.checkId = "a-check-from-a-later-release";
    issue.severity = SecuritySeverity.Low;

    expect(dataOf(issue)).toEqual({
      issue: { check: "a-check-from-a-later-release", severity: "Low" },
    });
  });
});

describe("the Overview", () => {
  function storeOf(data: {
    kind?: DataStoreKind | undefined;
    sensitivity?: DataSensitivity | undefined;
    sensitivityOverride?: DataSensitivity | undefined;
    dataCategories?: Array<DataCategory> | undefined;
    exposure?: DataStoreExposure | undefined;
    configurationReadAt?: Date | undefined;
    contentScannedAt?: Date | undefined;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.kind = data.kind || DataStoreKind.AwsS3Bucket;

    if (data.sensitivity) {
      store.sensitivity = data.sensitivity;
    }

    if (data.sensitivityOverride) {
      store.sensitivityOverride = data.sensitivityOverride;
    }

    if (data.dataCategories) {
      store.dataCategories = data.dataCategories;
    }

    if (data.exposure) {
      store.exposure = data.exposure;
    }

    if (data.configurationReadAt) {
      store.configurationReadAt = data.configurationReadAt;
    }

    if (data.contentScannedAt) {
      store.contentScannedAt = data.contentScannedAt;
    }

    stores.push(store);
    return store;
  }

  function overviewIssue(data: {
    store: DataStore;
    status: DataSecurityIssueStatus;
    severity: SecuritySeverity;
    riskScore: number;
    openedDaysAgo: number;
    resolvedDaysAgo?: number | undefined;
    title?: string | undefined;
  }): DataSecurityIssue {
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.status = data.status;
    issue.severity = data.severity;
    issue.riskScore = data.riskScore;
    issue.title =
      data.title || `${data.severity} issue scoring ${data.riskScore}`;
    issue.checkId = "public-read";
    issue.dataStoreId = data.store.id!;
    const store: DataStore = new DataStore();
    store.name = `store of ${issue.title}`;
    issue.dataStore = store;
    issue.firstDetectedAt = new Date(
      NOW.getTime() - data.openedDaysAgo * DAY_IN_MS,
    );

    if (data.resolvedDaysAgo !== undefined) {
      issue.resolvedAt = new Date(
        NOW.getTime() - data.resolvedDaysAgo * DAY_IN_MS,
      );
    }

    issues.push(issue);
    return issue;
  }

  function findingOf(
    store: DataStore,
    matchCount: number,
    isScrubbed: boolean,
  ): void {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.dataStoreId = store.id!;
    finding.matchCount = matchCount;
    finding.isScrubbed = isScrubbed;
    findings.push(finding);
  }

  function connectionOf(config: JSONObject | undefined): void {
    const connection: CloudConnection = new CloudConnection(
      ObjectID.generate(),
    );

    if (config) {
      connection.config = config;
    }

    connections.push(connection);
  }

  async function overview(): Promise<DataSecurityOverview> {
    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.overview);

    expect(result.thrown).toBeUndefined();
    return result.answer as unknown as DataSecurityOverview;
  }

  test("counts the project's stores by sensitivity, category and exposure, and how many were evaluated", async () => {
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      sensitivityOverride: DataSensitivity.Restricted,
      dataCategories: [DataCategory.Financial, DataCategory.ContactAndIdentity],
      exposure: DataStoreExposure.Public,
      configurationReadAt: NOW,
    });
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.ContactAndIdentity],
      exposure: DataStoreExposure.OtherAccounts,
      contentScannedAt: NOW,
    });
    storeOf({
      kind: DataStoreKind.PostgreSql,
      sensitivity: DataSensitivity.Internal,
      exposure: DataStoreExposure.Public,
      configurationReadAt: NOW,
      contentScannedAt: NOW,
    });
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.Health],
      exposure: DataStoreExposure.InternetReachable,
    });
    storeOf({ kind: DataStoreKind.TelemetryLogs });

    const answer: DataSecurityOverview = await overview();

    expect(storeFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, isArchived: false },
      props: { isRoot: true },
    });
    expect(answer.storeCount).toBe(5);
    expect(answer.evaluatedStoreCount).toBe(3);
    expect(answer.contentScannedStoreCount).toBe(2);
    expect(answer.storesBySensitivity).toEqual({
      [DataSensitivity.Restricted]: 1,
      [DataSensitivity.Confidential]: 2,
      [DataSensitivity.Internal]: 1,
      [DataSensitivity.Public]: 1,
    });
    // In the order the Overview lists categories, only those found.
    expect(answer.storesByCategory).toEqual([
      { category: DataCategory.Financial, storeCount: 1 },
      { category: DataCategory.Health, storeCount: 1 },
      { category: DataCategory.ContactAndIdentity, storeCount: 2 },
    ]);
    // Restricted and public, Confidential and shared; Internal and reachable ones are not.
    expect(answer.exposedSensitiveStoreCount).toBe(2);
  });

  test("counts open issues by severity, ranks the five riskiest, and charts 30 days of opened and resolved", async () => {
    const store: DataStore = storeOf({
      sensitivity: DataSensitivity.Restricted,
    });
    const scores: Array<[SecuritySeverity, number]> = [
      [SecuritySeverity.Critical, 95],
      [SecuritySeverity.Critical, 80],
      [SecuritySeverity.High, 70],
      [SecuritySeverity.High, 99],
      [SecuritySeverity.Medium, 40],
      [SecuritySeverity.Low, 10],
    ];

    for (const [index, [severity, riskScore]] of scores.entries()) {
      overviewIssue({
        store,
        status: DataSecurityIssueStatus.Open,
        severity,
        riskScore,
        openedDaysAgo: index,
      });
    }

    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Resolved,
      severity: SecuritySeverity.Critical,
      riskScore: 100,
      openedDaysAgo: 3,
      resolvedDaysAgo: 1,
    });
    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Accepted,
      severity: SecuritySeverity.High,
      riskScore: 98,
      openedDaysAgo: 45,
    });
    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Resolved,
      severity: SecuritySeverity.Low,
      riskScore: 1,
      openedDaysAgo: 60,
      resolvedDaysAgo: 40,
    });

    const answer: DataSecurityOverview = await overview();

    expect(answer.openIssuesBySeverity).toEqual({
      [SecuritySeverity.Critical]: 2,
      [SecuritySeverity.High]: 2,
      [SecuritySeverity.Medium]: 1,
      [SecuritySeverity.Low]: 1,
    });
    expect(
      answer.topIssues.map((issue: { riskScore: number }): number => {
        return issue.riskScore;
      }),
    ).toEqual([99, 95, 80, 70, 40]);
    expect(answer.topIssues[0]).toEqual({
      issueId: issues[3]!.id!.toString(),
      title: "High issue scoring 99",
      severity: SecuritySeverity.High,
      riskScore: 99,
      checkId: "public-read",
      dataStoreId: store.id!.toString(),
      dataStoreName: "store of High issue scoring 99",
    });

    expect(answer.issueTrend).toHaveLength(30);
    expect(answer.issueTrend[0]!.day).toBe("2026-09-28");
    expect(answer.issueTrend[29]!.day).toBe("2026-10-27");

    const byDay: Map<string, { opened: number; resolved: number }> = new Map(
      answer.issueTrend.map(
        (entry: {
          day: string;
          opened: number;
          resolved: number;
        }): [string, { opened: number; resolved: number }] => {
          return [
            entry.day,
            { opened: entry.opened, resolved: entry.resolved },
          ];
        },
      ),
    );

    expect(byDay.get("2026-10-27")).toEqual({ opened: 1, resolved: 0 });
    expect(byDay.get("2026-10-24")).toEqual({ opened: 2, resolved: 0 });
    expect(byDay.get("2026-10-26")).toEqual({ opened: 1, resolved: 1 });
    expect(
      answer.issueTrend.reduce((sum: number, entry: { opened: number }) => {
        return sum + entry.opened;
      }, 0),
    ).toBe(7);
    expect(
      answer.issueTrend.reduce((sum: number, entry: { resolved: number }) => {
        return sum + entry.resolved;
      }, 0),
    ).toBe(1);
  });

  test("counts telemetry findings, and the ones no scrub rule masks", async () => {
    const logs: DataStore = storeOf({ kind: DataStoreKind.TelemetryLogs });
    const traces: DataStore = storeOf({ kind: DataStoreKind.TelemetryTraces });
    const bucket: DataStore = storeOf({ kind: DataStoreKind.AwsS3Bucket });
    findingOf(logs, 4, false);
    findingOf(logs, 2, true);
    findingOf(traces, 9, false);
    findingOf(traces, 0, false);
    findingOf(bucket, 30, false);

    const answer: DataSecurityOverview = await overview();

    expect(findingFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, isSuppressed: false },
    });
    expect(answer.telemetryFindingCount).toBe(3);
    expect(answer.unscrubbedTelemetryFindingCount).toBe(2);
  });

  test("with no telemetry stores, findings are not read at all", async () => {
    storeOf({ kind: DataStoreKind.AwsS3Bucket });

    const answer: DataSecurityOverview = await overview();

    expect(findingFindSpy).not.toHaveBeenCalled();
    expect(answer.telemetryFindingCount).toBe(0);
    expect(answer.unscrubbedTelemetryFindingCount).toBe(0);
  });

  test("counts the cloud connections that cannot read content yet", async () => {
    connectionOf({ dataSecurity: "content" });
    connectionOf({ dataSecurity: "configuration" });
    connectionOf({ dataSecurity: "off" });
    connectionOf(undefined);

    const answer: DataSecurityOverview = await overview();

    expect(answer.connectionsWithoutContentAccess).toBe(3);
    expect(answer.hasCloudConnection).toBe(true);
  });

  test("an empty project: everything is zero, and it has no cloud connection", async () => {
    const answer: DataSecurityOverview = await overview();

    expect(answer).toMatchObject({
      storeCount: 0,
      evaluatedStoreCount: 0,
      contentScannedStoreCount: 0,
      storesByCategory: [],
      exposedSensitiveStoreCount: 0,
      topIssues: [],
      telemetryFindingCount: 0,
      unscrubbedTelemetryFindingCount: 0,
      connectionsWithoutContentAccess: 0,
      hasCloudConnection: false,
    });
    expect(
      answer.issueTrend.every((entry: { opened: number; resolved: number }) => {
        return entry.opened === 0 && entry.resolved === 0;
      }),
    ).toBe(true);
  });

  /*
   * The issue trend counts the reader's days (issue #7925): the page sends
   * the reader's zone, and each issue counts on the day it was opened or
   * resolved there. A zone the list does not name is dropped, and those days
   * stay UTC's, as an older Dashboard that sends none gets.
   */
  describe("the issue trend, in the reader's zone", () => {
    function issueAt(data: {
      openedAt: string;
      resolvedAt?: string | undefined;
    }): DataSecurityIssue {
      const issue: DataSecurityIssue = overviewIssue({
        store: storeOf({}),
        status: data.resolvedAt
          ? DataSecurityIssueStatus.Resolved
          : DataSecurityIssueStatus.Open,
        severity: SecuritySeverity.High,
        riskScore: 50,
        openedDaysAgo: 0,
      });
      issue.firstDetectedAt = new Date(data.openedAt);

      if (data.resolvedAt) {
        issue.resolvedAt = new Date(data.resolvedAt);
      }

      return issue;
    }

    async function trendIn(
      body: JSONObject,
    ): Promise<DataSecurityOverview["issueTrend"]> {
      const result: RouteCall = await call(
        DATA_SECURITY_API_ROUTES.overview,
        {},
        body,
      );

      expect(result.thrown).toBeUndefined();
      return (result.answer as unknown as DataSecurityOverview).issueTrend;
    }

    function countedDays(
      trend: DataSecurityOverview["issueTrend"],
    ): Record<string, { opened: number; resolved: number }> {
      const counted: Record<string, { opened: number; resolved: number }> = {};

      for (const entry of trend) {
        if (entry.opened > 0 || entry.resolved > 0) {
          counted[entry.day] = {
            opened: entry.opened,
            resolved: entry.resolved,
          };
        }
      }

      return counted;
    }

    // Every calendar date from `from` to `to`, both included.
    function datesFrom(from: string, to: string): Array<string> {
      const dates: Array<string> = [from];

      while (dates[dates.length - 1]! < to) {
        dates.push(
          new Date(
            Date.parse(`${dates[dates.length - 1]!}T00:00:00.000Z`) + DAY_IN_MS,
          )
            .toISOString()
            .slice(0, 10),
        );
      }

      return dates;
    }

    test("a New York reader's issue opened at 02:00 UTC on the 27th counts on the 26th", async () => {
      // 22:00 on the 26th, and 23:30 on the 24th, in New York.
      issueAt({
        openedAt: "2026-10-27T02:00:00.000Z",
        resolvedAt: "2026-10-27T03:00:00.000Z",
      });
      issueAt({ openedAt: "2026-10-25T03:30:00.000Z" });

      const trend: DataSecurityOverview["issueTrend"] = await trendIn({
        timezone: "America/New_York",
      });

      expect(trend).toHaveLength(30);
      expect(trend[0]!.day).toBe("2026-09-28");
      expect(trend[29]!.day).toBe("2026-10-27");
      expect(countedDays(trend)).toEqual({
        "2026-10-24": { opened: 1, resolved: 0 },
        "2026-10-26": { opened: 1, resolved: 1 },
      });

      // With no zone, the UTC days, as before.
      expect(countedDays(await trendIn({}))).toEqual({
        "2026-10-25": { opened: 1, resolved: 0 },
        "2026-10-27": { opened: 1, resolved: 1 },
      });
    });

    test("over New York's 1 November change the bars are 30 days, one a day, and the 25th hour is on the 1st", async () => {
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date("2026-11-10T12:00:00.000Z");
      });
      issueAt({ openedAt: "2026-11-02T04:30:00.000Z" });
      issueAt({ openedAt: "2026-11-02T05:00:00.000Z" });

      const trend: DataSecurityOverview["issueTrend"] = await trendIn({
        timezone: "America/New_York",
      });

      expect(
        trend.map((entry: { day: string }): string => {
          return entry.day;
        }),
      ).toEqual(datesFrom("2026-10-12", "2026-11-10"));
      expect(countedDays(trend)).toEqual({
        "2026-11-01": { opened: 1, resolved: 0 },
        "2026-11-02": { opened: 1, resolved: 0 },
      });
    });

    test("over London's 29 March change, its 23-hour day is one bar too", async () => {
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        // 00:30 BST on 30 March, the day after the clocks went forward.
        return new Date("2026-03-29T23:30:00.000Z");
      });
      issueAt({ openedAt: "2026-03-29T22:59:59.000Z" });
      issueAt({ openedAt: "2026-03-29T23:00:00.000Z" });

      const trend: DataSecurityOverview["issueTrend"] = await trendIn({
        timezone: "Europe/London",
      });

      expect(
        trend.map((entry: { day: string }): string => {
          return entry.day;
        }),
      ).toEqual(datesFrom("2026-03-01", "2026-03-30"));
      expect(countedDays(trend)).toEqual({
        "2026-03-29": { opened: 1, resolved: 0 },
        "2026-03-30": { opened: 1, resolved: 0 },
      });
    });

    test("a Kathmandu reader's day starts at 18:15 UTC the day before", async () => {
      issueAt({ openedAt: "2026-10-26T18:14:59.000Z" });
      issueAt({ openedAt: "2026-10-26T18:15:00.000Z" });

      const trend: DataSecurityOverview["issueTrend"] = await trendIn({
        timezone: "Asia/Kathmandu",
      });

      // 17:45 on 27 October there: today is the 27th.
      expect(trend[29]!.day).toBe("2026-10-27");
      expect(countedDays(trend)).toEqual({
        "2026-10-26": { opened: 1, resolved: 0 },
        "2026-10-27": { opened: 1, resolved: 0 },
      });
    });

    test.each([
      ["a zone the list does not name", "Mars/Olympus_Mons"],
      ["a number", 330],
      ["text written to be SQL", "UTC'; DROP TABLE DataStore; --"],
    ] as Array<[string, unknown]>)(
      "%s is dropped: the trend is answered on UTC's days",
      async (_name: string, timezone: unknown) => {
        issueAt({ openedAt: "2026-10-27T02:00:00.000Z" });

        const trend: DataSecurityOverview["issueTrend"] = await trendIn({
          timezone: timezone as JSONObject,
        });

        expect(trend).toHaveLength(30);
        expect(countedDays(trend)).toEqual({
          "2026-10-27": { opened: 1, resolved: 0 },
        });
      },
    );
  });
});

describe("Compliance", () => {
  function storeOf(data: {
    dataTypeIds: Array<string>;
    subjectCountries?: Array<string> | undefined;
    evaluated: boolean;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.dataTypeIds = data.dataTypeIds;

    if (data.subjectCountries) {
      store.subjectCountries = data.subjectCountries;
    }

    if (data.evaluated) {
      store.configurationReadAt = NOW;
    }

    stores.push(store);
    return store;
  }

  function openIssue(store: DataStore, checkId: string): void {
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.dataStoreId = store.id!;
    issue.checkId = checkId;
    issues.push(issue);
  }

  test("scores every framework from the project's stores and its open issues", async () => {
    const cards: DataStore = storeOf({
      dataTypeIds: ["credit-card-number", "email-address"],
      evaluated: true,
    });
    const brazil: DataStore = storeOf({
      dataTypeIds: ["br-cpf"],
      subjectCountries: ["BR"],
      evaluated: false,
    });
    storeOf({ dataTypeIds: [], evaluated: true });
    openIssue(cards, "public-read");
    openIssue(brazil, "no-owner");

    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.compliance);
    const answer: DataSecurityComplianceResponse =
      result.answer as unknown as DataSecurityComplianceResponse;

    expect(issueFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, status: DataSecurityIssueStatus.Open },
    });

    const storeInputs: Array<ComplianceStoreInput> = stores.map(
      (store: DataStore): ComplianceStoreInput => {
        return {
          id: store.id!.toString(),
          dataTypeIds: store.dataTypeIds || [],
          subjectCountries: store.subjectCountries || [],
          isEvaluated: Boolean(store.configurationReadAt),
        };
      },
    );
    const issueInputs: Array<ComplianceIssueInput> = issues.map(
      (issue: DataSecurityIssue): ComplianceIssueInput => {
        return {
          storeId: issue.dataStoreId!.toString(),
          checkId: issue.checkId!,
        };
      },
    );

    expect(
      answer.frameworks.map((framework: DataSecurityComplianceFramework) => {
        return framework.framework;
      }),
    ).toEqual([...ALL_COMPLIANCE_FRAMEWORKS]);

    for (const framework of answer.frameworks) {
      expect(framework).toEqual({
        ...scoreComplianceFramework(
          framework.framework,
          storeInputs,
          issueInputs,
        ),
        fullName: COMPLIANCE_FRAMEWORK_INFO[framework.framework].fullName,
        scope: COMPLIANCE_FRAMEWORK_INFO[framework.framework].scope,
        // Nothing turned off anywhere (#9629).
        turnedOff: [],
      });
    }

    const pci: DataSecurityComplianceFramework = answer.frameworks.find(
      (framework: DataSecurityComplianceFramework) => {
        return framework.framework === ComplianceFramework.PCIDSS;
      },
    )!;

    // Only the store with card numbers is in scope; its public bucket fails 7.2.
    expect(pci.storesInScope).toBe(1);
    expect(
      pci.requirements.find((requirement: ComplianceRequirementResult) => {
        return requirement.requirement === "7.2";
      }),
    ).toMatchObject({
      status: ComplianceRequirementStatus.Failing,
      failingIssueCount: 1,
    });
    // Seven of its eight requirements pass: 87.5, rounded.
    expect(pci.score).toBe(88);
    expect(pci.fullName).toBe("PCI DSS v4.0");

    const lgpd: DataSecurityComplianceFramework = answer.frameworks.find(
      (framework: DataSecurityComplianceFramework) => {
        return framework.framework === ComplianceFramework.LGPD;
      },
    )!;

    // Brazil's store is in LGPD's scope, but nothing in it was evaluated yet.
    expect(lgpd.storesInScope).toBe(1);
    expect(lgpd.score).toBeNull();
  });

  test("a project with no stores evaluates nothing", async () => {
    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.compliance);
    const answer: DataSecurityComplianceResponse =
      result.answer as unknown as DataSecurityComplianceResponse;

    for (const framework of answer.frameworks) {
      expect({
        framework: framework.framework,
        score: framework.score,
      }).toEqual({
        framework: framework.framework,
        score: null,
      });
      expect(framework.storesInScope).toBe(0);
    }
  });
});

describe("Compliance, with what resources turned off", () => {
  function cardStoreOnServer(serverId: ObjectID): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.dataTypeIds = ["credit-card-number"];
    store.configurationReadAt = NOW;
    store.databaseServerId = serverId;
    stores.push(store);
    return store;
  }

  function serverOnCluster(serverId: ObjectID): DatabaseServer {
    const server: DatabaseServer = new DatabaseServer(serverId);
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServers.push(server);
    return server;
  }

  function turnedOff(data: {
    framework: ComplianceFramework;
    requirement?: string | undefined;
  }): void {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(ObjectID.generate());
    setting.resourceType = DataStoreResourceKind.KubernetesCluster;
    setting.resourceId = CLUSTER_ID;
    setting.framework = data.framework;

    if (data.requirement) {
      setting.requirement = data.requirement;
    }

    setting.isEnabled = false;
    complianceSettings.push(setting);
  }

  function pciOf(
    answer: DataSecurityComplianceResponse,
  ): DataSecurityComplianceFramework {
    return answer.frameworks.find(
      (framework: DataSecurityComplianceFramework) => {
        return framework.framework === ComplianceFramework.PCIDSS;
      },
    )!;
  }

  test("a framework a cluster turned off leaves its databases' stores out of the project's score", async () => {
    serverOnCluster(DATABASE_SERVER_ID);
    cardStoreOnServer(DATABASE_SERVER_ID);
    // A database on no cluster still counts.
    cardStoreOnServer(OTHER_DATABASE_SERVER_ID);
    turnedOff({ framework: ComplianceFramework.PCIDSS });

    const answer: DataSecurityComplianceResponse = (
      await call(DATA_SECURITY_API_ROUTES.compliance)
    ).answer as unknown as DataSecurityComplianceResponse;

    expect(complianceSettingFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
    expect(pciOf(answer).storesInScope).toBe(1);
    expect(pciOf(answer).storesTurnedOff).toBe(1);
  });

  test("a requirement a cluster turned off stops its stores' issues failing it, project-wide", async () => {
    serverOnCluster(DATABASE_SERVER_ID);
    const orders: DataStore = cardStoreOnServer(DATABASE_SERVER_ID);
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.dataStoreId = orders.id!;
    issue.checkId = "public-read";
    issues.push(issue);
    turnedOff({ framework: ComplianceFramework.PCIDSS, requirement: "7.2" });

    const answer: DataSecurityComplianceResponse = (
      await call(DATA_SECURITY_API_ROUTES.compliance)
    ).answer as unknown as DataSecurityComplianceResponse;

    expect(
      pciOf(answer).requirements.find(
        (requirement: ComplianceRequirementResult) => {
          return requirement.requirement === "7.2";
        },
      )?.status,
    ).toBe(ComplianceRequirementStatus.TurnedOff);
  });

  test("with nothing turned off, no database's placement is read", async () => {
    cardStoreOnServer(DATABASE_SERVER_ID);

    const answer: DataSecurityComplianceResponse = (
      await call(DATA_SECURITY_API_ROUTES.compliance)
    ).answer as unknown as DataSecurityComplianceResponse;

    expect(databaseServerFindSpy).not.toHaveBeenCalled();
    expect(pciOf(answer).storesInScope).toBe(1);
    expect(pciOf(answer).storesTurnedOff).toBe(0);
    // Nothing turned off, and no resource read to name one.
    expect(pciOf(answer).turnedOff).toEqual([]);
    expect(clusterFindSpy).not.toHaveBeenCalled();
  });
});

/*
 * Why a framework or a requirement is turned off for a resource, and who
 * turned it off when (#9629): the project's Compliance page lists each
 * one, its resource named as the reader may see it.
 */
describe("Compliance, with why each was turned off", () => {
  const JANE: User = new User(
    new ObjectID("99999999-9999-4999-8999-999999999999"),
  );
  JANE.name = new Name("Jane Doe");

  function turnedOff(data: {
    framework: ComplianceFramework;
    requirement?: string | undefined;
    note?: string | undefined;
    turnedOffAt?: Date | undefined;
    turnedOffByUser?: User | undefined;
    resourceType?: DataStoreResourceKind | undefined;
    resourceId?: ObjectID | undefined;
  }): DataSecurityComplianceSetting {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(ObjectID.generate());
    setting.resourceType =
      data.resourceType || DataStoreResourceKind.KubernetesCluster;
    setting.resourceId = data.resourceId || CLUSTER_ID;
    setting.framework = data.framework;

    if (data.requirement) {
      setting.requirement = data.requirement;
    }

    if (data.note !== undefined) {
      setting.note = data.note;
    }

    if (data.turnedOffAt) {
      setting.turnedOffAt = data.turnedOffAt;
    }

    if (data.turnedOffByUser) {
      setting.turnedOffByUser = data.turnedOffByUser;
    }

    setting.isEnabled = false;
    complianceSettings.push(setting);
    return setting;
  }

  function frameworkOf(
    answer: DataSecurityComplianceResponse,
    framework: ComplianceFramework,
  ): DataSecurityComplianceFramework {
    return answer.frameworks.find((each: DataSecurityComplianceFramework) => {
      return each.framework === framework;
    })!;
  }

  async function compliance(): Promise<DataSecurityComplianceResponse> {
    return (await call(DATA_SECURITY_API_ROUTES.compliance))
      .answer as unknown as DataSecurityComplianceResponse;
  }

  test("lists each, the latest turned off first, with why, by whom and when, its resource named", async () => {
    const whole: DataSecurityComplianceSetting = turnedOff({
      framework: ComplianceFramework.PCIDSS,
      note: "No card data ever reaches prod-eu.",
      turnedOffAt: new Date("2026-10-20T09:00:00.000Z"),
      turnedOffByUser: JANE,
    });
    const requirement: DataSecurityComplianceSetting = turnedOff({
      framework: ComplianceFramework.PCIDSS,
      requirement: "7.2",
      turnedOffAt: new Date("2026-10-26T09:00:00.000Z"),
    });

    const pci: DataSecurityComplianceFramework = frameworkOf(
      await compliance(),
      ComplianceFramework.PCIDSS,
    );

    expect(pci.turnedOff).toEqual([
      {
        id: requirement.id!.toString(),
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
        requirement: "7.2",
        note: "",
        turnedOffAt: "2026-10-26T09:00:00.000Z",
        turnedOffBy: null,
      },
      {
        id: whole.id!.toString(),
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
        requirement: null,
        note: "No card data ever reaches prod-eu.",
        turnedOffAt: "2026-10-20T09:00:00.000Z",
        turnedOffBy: "Jane Doe",
      },
    ]);
    // Another framework lists only its own.
    expect(
      frameworkOf(await compliance(), ComplianceFramework.HIPAA).turnedOff,
    ).toEqual([]);
  });

  test("reads what is turned off as OneUptime, with why and by whom", async () => {
    turnedOff({ framework: ComplianceFramework.PCIDSS });

    await compliance();

    const read: Record<string, unknown> | undefined = (
      complianceSettingFindSpy.mock.calls as Array<
        [{ query: Record<string, unknown>; select: Record<string, unknown> }]
      >
    )
      .map(
        (
          args: [
            { query: Record<string, unknown>; select: Record<string, unknown> },
          ],
        ): {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        } => {
          return args[0];
        },
      )
      .find((args: { query: Record<string, unknown> }): boolean => {
        return args.query["isEnabled"] === false;
      }) as Record<string, unknown> | undefined;

    expect(read).toMatchObject({
      query: { projectId: PROJECT_ID, isEnabled: false },
      select: {
        note: true,
        turnedOffAt: true,
        turnedOffByUser: { name: true, email: true },
      },
      props: { isRoot: true },
    });
  });

  test("names a resource as the reader may see it: asked as OneUptime whether it is there, as the reader what it is called", async () => {
    turnedOff({ framework: ComplianceFramework.PCIDSS });

    await compliance();

    const propsOfReads: Array<DatabaseCommonInteractionProps> =
      clusterFindSpy.mock.calls.map(
        (args: Array<unknown>): DatabaseCommonInteractionProps => {
          return (args[0] as { props: DatabaseCommonInteractionProps }).props;
        },
      );

    expect(propsOfReads).toHaveLength(2);
    expect(propsOfReads[0]).toEqual({ isRoot: true });
    expect(propsOfReads[1]?.isRoot).toBeFalsy();
    expect(propsOfReads[1]?.tenantId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a resource the reader may not read is named by its kind alone", async () => {
    turnedOff({ framework: ComplianceFramework.PCIDSS, note: "Not ours." });
    const cluster: KubernetesCluster = new KubernetesCluster(CLUSTER_ID);
    cluster.name = "prod-eu";
    clusterFindSpy.mockImplementation((async (args: {
      props: DatabaseCommonInteractionProps;
    }) => {
      return args.props.isRoot ? [cluster] : [];
    }) as never);

    const pci: DataSecurityComplianceFramework = frameworkOf(
      await compliance(),
      ComplianceFramework.PCIDSS,
    );

    expect(pci.turnedOff?.[0]?.resource.name).toBe("");
    expect(pci.turnedOff?.[0]?.note).toBe("Not ours.");
  });

  test("one whose resource is gone is left out: it turns nothing off now", async () => {
    turnedOff({ framework: ComplianceFramework.PCIDSS });
    clusterFindSpy.mockImplementation((async () => {
      return [];
    }) as never);

    const pci: DataSecurityComplianceFramework = frameworkOf(
      await compliance(),
      ComplianceFramework.PCIDSS,
    );

    expect(pci.turnedOff).toEqual([]);
  });

  test("a person with no name is named by their email; an API key by nobody", async () => {
    const byEmail: User = new User(ObjectID.generate());
    byEmail.email = new Email("sam@acme.example");
    turnedOff({
      framework: ComplianceFramework.PCIDSS,
      turnedOffByUser: byEmail,
      turnedOffAt: new Date("2026-10-26T09:00:00.000Z"),
    });
    turnedOff({
      framework: ComplianceFramework.PCIDSS,
      requirement: "3.4",
      turnedOffAt: new Date("2026-10-25T09:00:00.000Z"),
    });

    const pci: DataSecurityComplianceFramework = frameworkOf(
      await compliance(),
      ComplianceFramework.PCIDSS,
    );

    expect(
      pci.turnedOff?.map((entry: DataSecurityComplianceTurnedOff) => {
        return entry.turnedOffBy;
      }),
    ).toEqual(["sam@acme.example", null]);
  });

  test("lists at most MAX_COMPLIANCE_TURNED_OFF of one framework", async () => {
    for (
      let index: number = 0;
      index < MAX_COMPLIANCE_TURNED_OFF + 5;
      index++
    ) {
      turnedOff({ framework: ComplianceFramework.PCIDSS });
    }

    const pci: DataSecurityComplianceFramework = frameworkOf(
      await compliance(),
      ComplianceFramework.PCIDSS,
    );

    expect(pci.turnedOff).toHaveLength(MAX_COMPLIANCE_TURNED_OFF);
  });
});

describe("a resource's stores", () => {
  function storeOf(data: Partial<DataStore>): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    Object.assign(store, data);
    stores.push(store);
    return store;
  }

  async function scopeOf(body: JSONObject): Promise<RouteCall> {
    return await call(DATA_SECURITY_API_ROUTES.resourceScope, {}, body);
  }

  test("a cluster's stores are the stores of the databases running on it, and its compliance is set on it", async () => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServers.push(server);
    const orders: DataStore = storeOf({
      databaseServerId: DATABASE_SERVER_ID,
    });

    const result: RouteCall = await scopeOf({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
    });
    const scope: DataSecurityResourceScope =
      result.answer as unknown as DataSecurityResourceScope;

    // The cluster is read as the caller may read it.
    expect(clusterFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: CLUSTER_ID.toString(), projectId: PROJECT_ID },
    });
    expect(clusterFindOneSpy.mock.calls[0]![0].props.isRoot).toBeUndefined();
    // Its databases, then their stores - not archived, the riskiest first.
    expect(databaseServerFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, kubernetesClusterId: CLUSTER_ID },
    });
    const storeQuery: Record<string, unknown> = storeFindSpy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(storeQuery["projectId"]).toEqual(PROJECT_ID);
    expect(storeQuery["isArchived"]).toBe(false);
    expect(storeQuery["databaseServerId"]).toBeInstanceOf(Includes);
    expect(storeFindSpy.mock.calls[0]![0].limit).toBe(
      MAX_RESOURCE_SCOPE_STORES + 1,
    );

    expect(scope).toEqual({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
      name: "prod-eu",
      dataStoreIds: [orders.id!.toString()],
      ownedDataStoreIds: [orders.id!.toString()],
      complianceOwner: null,
      isTruncated: false,
    });
  });

  test("a cluster with no databases has no stores, and none are read", async () => {
    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.KubernetesCluster,
        id: CLUSTER_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(storeFindSpy).not.toHaveBeenCalled();
    expect(scope.dataStoreIds).toEqual([]);
    expect(scope.ownedDataStoreIds).toEqual([]);
  });

  test("a database on a cluster shows its store, whose compliance is set on the cluster", async () => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.name = "orders";
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServers.push(server);
    databaseServerRow = server;
    const orders: DataStore = storeOf({
      databaseServerId: DATABASE_SERVER_ID,
    });

    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.DatabaseServer,
        id: DATABASE_SERVER_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(storeFindSpy.mock.calls[0]![0].query).toMatchObject({
      projectId: PROJECT_ID,
      isArchived: false,
      databaseServerId: DATABASE_SERVER_ID,
    });
    expect(scope.name).toBe("orders");
    expect(scope.dataStoreIds).toEqual([orders.id!.toString()]);
    expect(scope.ownedDataStoreIds).toEqual([]);
    expect(scope.complianceOwner).toEqual({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
      name: "prod-eu",
    });
  });

  test("a database on a cluster with no store yet still says where its compliance is set", async () => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.name = "orders";
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServerRow = server;

    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.DatabaseServer,
        id: DATABASE_SERVER_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(scope.dataStoreIds).toEqual([]);
    expect(scope.complianceOwner?.kind).toBe(
      DataStoreResourceKind.KubernetesCluster,
    );
  });

  test("a database that runs on nothing monitored owns its store's compliance", async () => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.name = "billing";
    databaseServers.push(server);
    databaseServerRow = server;
    const billing: DataStore = storeOf({
      databaseServerId: DATABASE_SERVER_ID,
    });

    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.DatabaseServer,
        id: DATABASE_SERVER_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(scope.ownedDataStoreIds).toEqual([billing.id!.toString()]);
    expect(scope.complianceOwner).toBeNull();
  });

  test("a service's stores are its telemetry", async () => {
    const service: ServiceModel = new ServiceModel(STORE_ID);
    service.name = "checkout";
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(service);
    const logs: DataStore = storeOf({ serviceId: STORE_ID });

    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.Service,
        id: STORE_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(storeFindSpy.mock.calls[0]![0].query).toMatchObject({
      serviceId: STORE_ID,
      isArchived: false,
    });
    expect(scope.name).toBe("checkout");
    expect(scope.ownedDataStoreIds).toEqual([logs.id!.toString()]);
  });

  test("more stores than a scope lists are cut, and said to be", async () => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServers.push(server);

    for (let index: number = 0; index <= MAX_RESOURCE_SCOPE_STORES; index++) {
      storeOf({ databaseServerId: DATABASE_SERVER_ID });
    }

    const scope: DataSecurityResourceScope = (
      await scopeOf({
        kind: DataStoreResourceKind.KubernetesCluster,
        id: CLUSTER_ID.toString(),
      })
    ).answer as unknown as DataSecurityResourceScope;

    expect(scope.dataStoreIds.length).toBe(MAX_RESOURCE_SCOPE_STORES);
    expect(scope.isTruncated).toBe(true);
  });

  test("a resource the caller may not read is not found, and none of its stores are read", async () => {
    clusterRow = null;

    const result: RouteCall = await scopeOf({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
    });

    expect(result.thrown).toBeInstanceOf(NotFoundException);
    expect(databaseServerFindSpy).not.toHaveBeenCalled();
    expect(storeFindSpy).not.toHaveBeenCalled();
  });

  test("a kind that is not one, or an id that is not one, is refused before anything is read", async () => {
    for (const body of [
      { kind: "Host", id: CLUSTER_ID.toString() },
      { id: CLUSTER_ID.toString() },
      { kind: DataStoreResourceKind.KubernetesCluster, id: "prod-eu" },
      { kind: DataStoreResourceKind.KubernetesCluster },
    ]) {
      const result: RouteCall = await scopeOf(body as JSONObject);

      expect(result.thrown).toBeInstanceOf(BadDataException);
    }

    expect(readsMade()).toBe(0);
  });
});

describe("a resource's compliance", () => {
  function clusterStore(data: { dataTypeIds: Array<string> }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.dataTypeIds = data.dataTypeIds;
    store.configurationReadAt = NOW;
    store.databaseServerId = DATABASE_SERVER_ID;
    stores.push(store);
    return store;
  }

  function turnedOff(
    framework: ComplianceFramework,
    requirement?: string | undefined,
  ): void {
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(ObjectID.generate());
    setting.resourceType = DataStoreResourceKind.KubernetesCluster;
    setting.resourceId = CLUSTER_ID;
    setting.framework = framework;

    if (requirement) {
      setting.requirement = requirement;
    }

    setting.isEnabled = false;
    complianceSettings.push(setting);
  }

  function frameworkOf(
    answer: DataSecurityResourceComplianceResponse,
    framework: ComplianceFramework,
  ): DataSecurityResourceComplianceFramework {
    return answer.frameworks.find(
      (each: DataSecurityResourceComplianceFramework) => {
        return each.framework === framework;
      },
    )!;
  }

  async function complianceOf(): Promise<RouteCall> {
    return await call(
      DATA_SECURITY_API_ROUTES.resourceCompliance,
      {},
      {
        kind: DataStoreResourceKind.KubernetesCluster,
        id: CLUSTER_ID.toString(),
      },
    );
  }

  beforeEach(() => {
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServers.push(server);
  });

  test("scores every framework over the cluster's own stores, with what it turned off", async () => {
    const orders: DataStore = clusterStore({
      dataTypeIds: ["credit-card-number"],
    });
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.dataStoreId = orders.id!;
    issue.checkId = "public-read";
    issues.push(issue);
    turnedOff(ComplianceFramework.HIPAA);
    turnedOff(ComplianceFramework.SOC2, "CC6.1");

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(answer.name).toBe("prod-eu");
    expect(answer.storeCount).toBe(1);
    expect(
      answer.frameworks.map(
        (framework: DataSecurityResourceComplianceFramework) => {
          return framework.framework;
        },
      ),
    ).toEqual([...ALL_COMPLIANCE_FRAMEWORKS]);

    // Only the cluster's stores' open issues are read.
    const issueQuery: Record<string, unknown> = issueFindSpy.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(issueQuery["status"]).toBe(DataSecurityIssueStatus.Open);
    expect(issueQuery["dataStoreId"]).toBeInstanceOf(Includes);

    const soc2: DataSecurityResourceComplianceFramework = frameworkOf(
      answer,
      ComplianceFramework.SOC2,
    );
    expect(soc2.isTurnedOff).toBe(false);
    expect(soc2.turnedOffRequirements).toEqual(["CC6.1"]);
    expect(
      soc2.requirements.find((requirement: ComplianceRequirementResult) => {
        return requirement.requirement === "CC6.1";
      })?.status,
    ).toBe(ComplianceRequirementStatus.TurnedOff);

    const hipaa: DataSecurityResourceComplianceFramework = frameworkOf(
      answer,
      ComplianceFramework.HIPAA,
    );
    expect(hipaa.isTurnedOff).toBe(true);

    const pci: DataSecurityResourceComplianceFramework = frameworkOf(
      answer,
      ComplianceFramework.PCIDSS,
    );
    expect(pci.storesInScope).toBe(1);
    expect(
      pci.requirements.find((requirement: ComplianceRequirementResult) => {
        return requirement.requirement === "7.2";
      }),
    ).toMatchObject({
      status: ComplianceRequirementStatus.Failing,
      failingIssueCount: 1,
    });
  });

  test("another resource's setting does not change this cluster's page", async () => {
    clusterStore({ dataTypeIds: ["credit-card-number"] });
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(ObjectID.generate());
    setting.resourceType = DataStoreResourceKind.Service;
    setting.resourceId = CLUSTER_ID;
    setting.framework = ComplianceFramework.PCIDSS;
    setting.isEnabled = false;
    complianceSettings.push(setting);

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(frameworkOf(answer, ComplianceFramework.PCIDSS)).toMatchObject({
      isTurnedOff: false,
      storesInScope: 1,
      storesTurnedOff: 0,
    });
  });

  test("a database on the cluster is scored with the cluster's settings, which only the cluster's page changes", async () => {
    clusterStore({ dataTypeIds: ["credit-card-number"] });
    turnedOff(ComplianceFramework.PCIDSS);
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.name = "orders";
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServerRow = server;

    const answer: DataSecurityResourceComplianceResponse = (
      await call(
        DATA_SECURITY_API_ROUTES.resourceCompliance,
        {},
        {
          kind: DataStoreResourceKind.DatabaseServer,
          id: DATABASE_SERVER_ID.toString(),
        },
      )
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(answer.name).toBe("orders");
    expect(answer.storeCount).toBe(1);
    expect(answer.complianceOwner).toEqual({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID.toString(),
      name: "prod-eu",
    });
    expect(frameworkOf(answer, ComplianceFramework.PCIDSS)).toMatchObject({
      isTurnedOff: true,
      storesInScope: 0,
      storesTurnedOff: 1,
    });
  });

  test("a cluster sets its own compliance", async () => {
    clusterStore({ dataTypeIds: [] });

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(answer.complianceOwner).toBeNull();
  });

  test("a cluster with no stores scores nothing and reads no issues", async () => {
    databaseServers.length = 0;

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(answer.storeCount).toBe(0);
    expect(issueFindSpy).not.toHaveBeenCalled();
    for (const framework of answer.frameworks) {
      expect(framework.score).toBeNull();
    }
  });

  test("a resource the caller may not read is not found", async () => {
    clusterRow = null;

    const result: RouteCall = await complianceOf();

    expect(result.thrown).toBeInstanceOf(NotFoundException);
    expect(storeFindSpy).not.toHaveBeenCalled();
    expect(complianceSettingFindSpy).not.toHaveBeenCalled();
  });

  /*
   * Why each was turned off here, by whom and when (#9629): the settings of
   * where the compliance is set, named as the page names it, with no other
   * resource read to name them.
   */
  test("says why each of its own was turned off, by whom and when", async () => {
    clusterStore({ dataTypeIds: ["credit-card-number"] });
    turnedOff(ComplianceFramework.SOC2, "CC6.1");
    const setting: DataSecurityComplianceSetting = complianceSettings[0]!;
    setting.note = "Access is reviewed by the platform team instead.";
    setting.turnedOffAt = new Date("2026-10-26T09:00:00.000Z");

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(frameworkOf(answer, ComplianceFramework.SOC2).turnedOff).toEqual([
      {
        id: setting.id!.toString(),
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
        requirement: "CC6.1",
        note: "Access is reviewed by the platform team instead.",
        turnedOffAt: "2026-10-26T09:00:00.000Z",
        turnedOffBy: null,
      },
    ]);
    expect(frameworkOf(answer, ComplianceFramework.HIPAA).turnedOff).toEqual(
      [],
    );
    // Only the cluster's own settings are asked for, and nobody is read to name them.
    expect(
      (
        complianceSettingFindSpy.mock.calls as Array<
          [{ query: Record<string, unknown> }]
        >
      ).some((args: [{ query: Record<string, unknown> }]): boolean => {
        return (
          args[0].query["isEnabled"] === false &&
          args[0].query["resourceType"] ===
            DataStoreResourceKind.KubernetesCluster &&
          String(args[0].query["resourceId"]) === CLUSTER_ID.toString()
        );
      }),
    ).toBe(true);
    expect(clusterFindSpy).not.toHaveBeenCalled();
  });

  test("another resource's reason is not this cluster's", async () => {
    clusterStore({ dataTypeIds: ["credit-card-number"] });
    const setting: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting(ObjectID.generate());
    setting.resourceType = DataStoreResourceKind.Service;
    setting.resourceId = CLUSTER_ID;
    setting.framework = ComplianceFramework.PCIDSS;
    setting.note = "A service's own.";
    setting.isEnabled = false;
    complianceSettings.push(setting);

    const answer: DataSecurityResourceComplianceResponse = (
      await complianceOf()
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(frameworkOf(answer, ComplianceFramework.PCIDSS).turnedOff).toEqual(
      [],
    );
  });

  test("a database on the cluster shows the cluster's reasons, under the cluster's name", async () => {
    clusterStore({ dataTypeIds: ["credit-card-number"] });
    turnedOff(ComplianceFramework.PCIDSS);
    complianceSettings[0]!.note = "No card data on this cluster.";
    const server: DatabaseServer = new DatabaseServer(DATABASE_SERVER_ID);
    server.name = "orders";
    server.kubernetesClusterId = CLUSTER_ID;
    databaseServerRow = server;

    const answer: DataSecurityResourceComplianceResponse = (
      await call(
        DATA_SECURITY_API_ROUTES.resourceCompliance,
        {},
        {
          kind: DataStoreResourceKind.DatabaseServer,
          id: DATABASE_SERVER_ID.toString(),
        },
      )
    ).answer as unknown as DataSecurityResourceComplianceResponse;

    expect(
      frameworkOf(answer, ComplianceFramework.PCIDSS).turnedOff,
    ).toMatchObject([
      {
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
        requirement: null,
        note: "No card data on this cluster.",
      },
    ]);
  });
});

describe("the record of processing", () => {
  function storeOf(data: {
    name: string;
    dataCategories: Array<DataCategory>;
    dataTypeIds: Array<string>;
    sensitivity?: DataSensitivity | undefined;
    sensitivityOverride?: DataSensitivity | undefined;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.name = data.name;
    store.kind = DataStoreKind.AwsS3Bucket;
    store.provider = "aws";
    store.region = "eu-west-1";
    store.environment = DataStoreEnvironment.Production;
    store.dataCategories = data.dataCategories;
    store.dataTypeIds = data.dataTypeIds;

    if (data.sensitivity) {
      store.sensitivity = data.sensitivity;
    }

    if (data.sensitivityOverride) {
      store.sensitivityOverride = data.sensitivityOverride;
    }

    stores.push(store);
    return store;
  }

  function ownerOf(name: string, email?: string): User {
    const user: User = new User(ObjectID.generate());

    if (name) {
      user.name = new Name(name);
    }

    if (email) {
      user.email = new Email(email);
    }

    return user;
  }

  test("one row per store holding personal data: what it holds, where, whose and under which laws", async () => {
    const crm: DataStore = storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
      dataTypeIds: ["email-address", "credit-card-number", LOYALTY],
      sensitivity: DataSensitivity.Confidential,
      sensitivityOverride: DataSensitivity.Restricted,
    });
    crm.purpose = "Customer support exports";
    crm.retention = "90 days";
    storeOf({
      name: "secrets-only",
      dataCategories: [DataCategory.SecretsAndCredentials],
      dataTypeIds: ["aws-access-key-id"],
    });
    storeOf({
      name: "board-papers",
      dataCategories: [DataCategory.BusinessConfidential],
      dataTypeIds: ["confidential-document"],
    });
    const nhs: DataStore = storeOf({
      name: "patients",
      dataCategories: [DataCategory.Health],
      dataTypeIds: ["medical-record-number"],
    });

    ownersSpy.mockImplementation(async (dataStoreId: ObjectID) => {
      return dataStoreId.toString() === crm.id!.toString()
        ? [ownerOf("Alice Owner", "alice@acme.io"), ownerOf("", "bob@acme.io")]
        : [];
    });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );
    const answer: DataSecurityRecordOfProcessingResponse =
      result.answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["crm-exports", "patients"]);
    expect(answer.rows[0]).toEqual({
      dataStoreId: crm.id!.toString(),
      name: "crm-exports",
      kind: DataStoreKind.AwsS3Bucket,
      provider: "aws",
      region: "eu-west-1",
      environment: DataStoreEnvironment.Production,
      sensitivity: DataSensitivity.Restricted,
      dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
      dataTypeNames: ["Email address", "Card number", "Loyalty card number"],
      owners: ["Alice Owner", "bob@acme.io"],
      purpose: "Customer support exports",
      retention: "90 days",
      frameworks: [
        ComplianceFramework.GDPR,
        ComplianceFramework.CCPA,
        ComplianceFramework.PCIDSS,
      ],
    });
    expect(answer.rows[1]).toMatchObject({
      dataStoreId: nhs.id!.toString(),
      sensitivity: DataSensitivity.Public,
      dataTypeNames: ["Medical record number"],
      owners: [],
      purpose: "",
      retention: "",
      frameworks: [
        ComplianceFramework.HIPAA,
        ComplianceFramework.GDPR,
        ComplianceFramework.CCPA,
      ],
    });
    expect(
      ownersSpy.mock.calls.map((ownerCall: Array<unknown>): string => {
        return (ownerCall[0] as ObjectID).toString();
      }),
    ).toEqual([crm.id!.toString(), nhs.id!.toString()]);
  });

  // An auditor reads what the data is, never an id (#10363).
  test("the project's own data types by their names, one it deleted as deleted, read once for the whole record", async () => {
    storeOf({
      name: "hr-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: [LOYALTY, "email-address", DELETED_TYPE],
    });
    storeOf({
      name: "payroll",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: [
        DELETED_TYPE,
        "custom:10363000-0000-4000-8000-0000000000a3",
      ],
    });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );
    const answer: DataSecurityRecordOfProcessingResponse =
      result.answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map((row: { dataTypeNames: Array<string> }) => {
        return row.dataTypeNames;
      }),
    ).toEqual([
      ["Loyalty card number", "Email address", "A deleted data type"],
      ["A deleted data type"],
    ]);
    expect(JSON.stringify(answer)).not.toContain("custom:");
    expect(customTypesSpy).toHaveBeenCalledTimes(1);
    expect(customTypesSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      select: { _id: true, name: true },
      props: { isRoot: true },
    });
  });

  test("a project holding no personal data has nothing to record", async () => {
    storeOf({
      name: "secrets-only",
      dataCategories: [DataCategory.SecretsAndCredentials],
      dataTypeIds: ["aws-access-key-id"],
    });
    storeOf({ name: "empty", dataCategories: [], dataTypeIds: [] });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );

    expect(result.answer).toEqual({ rows: [] });
    expect(ownersSpy).not.toHaveBeenCalled();
    // Nobody to name: no read of who is only invited.
    expect(withheldSpy).not.toHaveBeenCalled();
  });

  /*
   * EACH OWNER AS THE PROJECT KNOWS THEM (#10697). A direct owner can be
   * someone only invited, whose own account's name the project may not see
   * until they join (#9823): the record names them by the name typed with
   * their invitation, else the address they were invited at - never their
   * account's own name. A member is named as ever: their name, else their
   * address.
   */
  test("names an invitee owner by the name typed for them, else the address they were invited at, and a member with no name by their address", async () => {
    const crm: DataStore = storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });
    storeOf({
      name: "payroll",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });
    // Invited, with a name typed for them; their account has a name of its own.
    const ada: User = ownerOf(
      "Ada Lovelace (personal account)",
      "ada@home.example",
    );
    // Invited with no name typed; their account's address moved since.
    const bea: User = ownerOf("Bea's Own Name", "bea-new@home.example");
    // A member who never gave a name.
    const carl: User = ownerOf("", "carl@acme.io");

    withheld = new Map<string, WithheldProfile>([
      [
        ada.id!.toString(),
        { inviteeName: "Ada from Legal", inviteeEmail: "ada@acme.io" },
      ],
      [bea.id!.toString(), { inviteeName: null, inviteeEmail: "bea@acme.io" }],
    ]);
    ownersSpy.mockImplementation(async (dataStoreId: ObjectID) => {
      return dataStoreId.toString() === crm.id!.toString()
        ? [ada, bea, carl]
        : [carl];
    });

    const answer: DataSecurityRecordOfProcessingResponse = (
      await call(DATA_SECURITY_API_ROUTES.recordOfProcessing)
    ).answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map(
        (row: DataSecurityRecordOfProcessingRow): Array<string> => {
          return row.owners;
        },
      ),
    ).toEqual([
      ["Ada from Legal", "bea@acme.io", "carl@acme.io"],
      ["carl@acme.io"],
    ]);
    expect(JSON.stringify(answer)).not.toContain("personal account");
    expect(JSON.stringify(answer)).not.toContain("Bea's Own Name");
    expect(JSON.stringify(answer)).not.toContain("bea-new@home.example");

    // Read once for every owner of the record, each once, in the project.
    expect(withheldSpy).toHaveBeenCalledTimes(1);
    expect(withheldSpy.mock.calls[0]![0]).toEqual({
      userIds: [ada.id!.toString(), bea.id!.toString(), carl.id!.toString()],
      projectId: PROJECT_ID,
    });
  });

  test("an owner with neither a name nor an address is left out, not listed blank", async () => {
    storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });
    ownersSpy.mockResolvedValue([ownerOf(""), ownerOf("Dana Member")]);

    const answer: DataSecurityRecordOfProcessingResponse = (
      await call(DATA_SECURITY_API_ROUTES.recordOfProcessing)
    ).answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(answer.rows[0]!.owners).toEqual(["Dana Member"]);
  });

  /*
   * THE STORES ONEUPTIME KEEPS FOR THE PROJECT'S SECURITY (#10398): declared
   * as DeclaredDataStores writes them, never scanned, each with what
   * OneUptime knows of it filled in until the team writes its own.
   */
  function declaredStoreOf(
    kind: DataStoreKind,
    columns: { purpose?: string; retention?: string } = {},
  ): DataStore {
    const info: DeclaredDataStoreInfo = getDeclaredDataStore(kind)!;
    const store: DataStore = new DataStore(ObjectID.generate());

    store.name = info.name;
    store.kind = info.kind;
    store.storeKey = info.storeKey;
    store.provider = DataStoreProvider.OneUptime;
    store.dataCategories = [...info.dataCategories];
    store.dataTypeIds = [...info.dataTypeIds];
    store.sensitivity = info.sensitivity;

    if (columns.purpose !== undefined) {
      store.purpose = columns.purpose;
    }

    if (columns.retention !== undefined) {
      store.retention = columns.retention;
    }

    stores.push(store);
    return store;
  }

  function rowNamed(
    answer: DataSecurityRecordOfProcessingResponse,
    name: string,
  ): DataSecurityRecordOfProcessingRow {
    const row: DataSecurityRecordOfProcessingRow | undefined = answer.rows.find(
      (candidate: DataSecurityRecordOfProcessingRow) => {
        return candidate.name === name;
      },
    );

    if (!row) {
      throw new Error(`The record has no row for ${name}.`);
    }

    return row;
  }

  test("declares the project's own security stores before it reads its stores", async () => {
    await call(DATA_SECURITY_API_ROUTES.recordOfProcessing);

    expect(declareSpy).toHaveBeenCalledTimes(1);
    expect(declareSpy.mock.calls[0]![0]).toEqual(PROJECT_ID);
    expect(declareSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      storeFindSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("a project with security events and network flows lists them, with the purpose and retention filled in", async () => {
    storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });
    const events: DataStore = declaredStoreOf(DataStoreKind.SecurityEvents);
    const flows: DataStore = declaredStoreOf(DataStoreKind.NetworkFlows);

    const answer: DataSecurityRecordOfProcessingResponse = (
      await call(DATA_SECURITY_API_ROUTES.recordOfProcessing)
    ).answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map((row: DataSecurityRecordOfProcessingRow) => {
        return row.name;
      }),
    ).toEqual(["crm-exports", "Security Events", "Network Flows"]);

    expect(rowNamed(answer, "Security Events")).toEqual({
      dataStoreId: events.id!.toString(),
      name: "Security Events",
      kind: DataStoreKind.SecurityEvents,
      provider: DataStoreProvider.OneUptime,
      region: "",
      environment: "",
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeNames: ["IP address", "Username", "Email address"],
      owners: [],
      purpose: "Network and information security (GDPR Recital 49)",
      retention: "15 days",
      frameworks: [ComplianceFramework.GDPR, ComplianceFramework.CCPA],
      declared: {
        kind: DataStoreKind.SecurityEvents,
        purpose: "Network and information security (GDPR Recital 49)",
        retentionInDays: 15,
        retentionBasis: DeclaredStoreRetentionBasis.SecurityEvents,
        retentionText: "15 days",
        isPurposeTheTeams: false,
        isRetentionTheTeams: false,
        readers: DeclaredStoreReaders.Roles,
        readPermissions: [...new SecurityEvent().getReadPermissions()],
        readerNames: PermissionHelper.getPermissionTitles(
          new SecurityEvent().getReadPermissions(),
        ),
        dataTypeNames: ["IP address", "Username", "Email address"],
        fields: [
          "principalIp",
          "targetIp",
          "principalUser",
          "targetUser",
          "observables",
        ],
      },
    });
    expect(rowNamed(answer, "Network Flows")).toMatchObject({
      dataStoreId: flows.id!.toString(),
      purpose: "Network and information security (GDPR Recital 49)",
      retention: "30 days",
      declared: {
        retentionInDays: 30,
        readers: DeclaredStoreReaders.Roles,
        readPermissions: [...new NetworkFlow().getReadPermissions()],
      },
    });
    // A store Data Security found carries no declaration.
    expect(rowNamed(answer, "crm-exports").declared).toBeUndefined();
    expect(eventRetentionSpy).toHaveBeenCalledWith(PROJECT_ID, {
      isFresh: true,
    });
  });

  test("the address vault is listed as read only by Security Events' scans, kept 30 days after an address was last seen", async () => {
    declaredStoreOf(DataStoreKind.SecurityAddressVault);

    const answer: DataSecurityRecordOfProcessingResponse = (
      await call(DATA_SECURITY_API_ROUTES.recordOfProcessing)
    ).answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(rowNamed(answer, "Security Address Vault")).toMatchObject({
      dataTypeNames: ["IP address"],
      purpose: "Network and information security (GDPR Recital 49)",
      retention: "30 days after an address was last seen",
      declared: {
        readers: DeclaredStoreReaders.SecurityEventsScansOnly,
        readPermissions: [],
        readerNames: [],
      },
    });
  });

  test("a project with neither lists none of them", async () => {
    storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });

    const answer: DataSecurityRecordOfProcessingResponse = (
      await call(DATA_SECURITY_API_ROUTES.recordOfProcessing)
    ).answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map((row: DataSecurityRecordOfProcessingRow) => {
        return [row.name, Boolean(row.declared)];
      }),
    ).toEqual([["crm-exports", false]]);
  });

  test("a purpose or a retention the team changed is the one listed, and theirs", async () => {
    declaredStoreOf(DataStoreKind.SecurityEvents, {
      purpose: "Detecting and blocking attacks on our web shop",
      retention: "90 days, then archived",
    });

    const row: DataSecurityRecordOfProcessingRow = rowNamed(
      (await call(DATA_SECURITY_API_ROUTES.recordOfProcessing))
        .answer as unknown as DataSecurityRecordOfProcessingResponse,
      "Security Events",
    );

    expect(row.purpose).toBe("Detecting and blocking attacks on our web shop");
    expect(row.retention).toBe("90 days, then archived");
    expect(row.declared).toMatchObject({
      isPurposeTheTeams: true,
      isRetentionTheTeams: true,
      // What OneUptime would say stays beside it.
      purpose: "Network and information security (GDPR Recital 49)",
      retentionText: "15 days",
    });
  });

  test("a retention changed in Settings after the store was declared is the one listed", async () => {
    declaredStoreOf(DataStoreKind.SecurityEvents);
    eventRetentionSpy.mockResolvedValue(60);

    const row: DataSecurityRecordOfProcessingRow = rowNamed(
      (await call(DATA_SECURITY_API_ROUTES.recordOfProcessing))
        .answer as unknown as DataSecurityRecordOfProcessingResponse,
      "Security Events",
    );

    expect(row.retention).toBe("60 days");
    expect(row.declared?.retentionInDays).toBe(60);
  });

  test("is answered whatever declaring them did", async () => {
    declareSpy.mockRestore();
    jest
      .spyOn(DeclaredDataStores, "declareProject")
      .mockRejectedValue(new Error("ClickHouse is restarting") as never);
    DeclaredDataStores.clearCache();
    storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity],
      dataTypeIds: ["email-address"],
    });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );

    expect(result.thrown).toBeUndefined();
    expect(
      (result.answer as unknown as DataSecurityRecordOfProcessingResponse).rows,
    ).toHaveLength(1);
  });
});

describe("a declared store's page", () => {
  const DECLARED_PATH: string = DATA_SECURITY_API_ROUTES.declaredStore(":id");

  function declaredRow(
    kind: DataStoreKind,
    columns: { purpose?: string; retention?: string } = {},
  ): DataStore {
    const store: DataStore = new DataStore(STORE_ID);
    store.kind = kind;

    if (columns.purpose !== undefined) {
      store.purpose = columns.purpose;
    }

    if (columns.retention !== undefined) {
      store.retention = columns.retention;
    }

    return store;
  }

  test("is a POST of its own, behind the user middleware and sign-in, and answered while Data Security is off", () => {
    expect(DECLARED_PATH).toBe("/data-store/:id/declared");
    expect(
      withoutRefusals(mockRouter.match("POST", DECLARED_PATH).middlewares),
    ).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test.each(READ)(
    "answers a caller holding %s with what the record says of the store",
    async (permission: Permission) => {
      asCaller([permission]);
      storeRow = declaredRow(DataStoreKind.NetworkFlows);

      const result: RouteCall = await call(DECLARED_PATH, {
        id: STORE_ID.toString(),
      });

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toMatchObject({
        purpose: "Network and information security (GDPR Recital 49)",
        retention: "30 days",
        declared: {
          kind: DataStoreKind.NetworkFlows,
          readers: DeclaredStoreReaders.Roles,
        },
      });
    },
  );

  test.each([Permission.ProjectMember, Permission.ReadDataStoreFinding])(
    "refuses a caller holding only %s, before reading anything",
    async (permission: Permission) => {
      asCaller([permission]);

      const result: RouteCall = await call(DECLARED_PATH, {
        id: STORE_ID.toString(),
      });

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(readsMade()).toBe(0);
    },
  );

  test("reads the store as the caller, in the caller's project", async () => {
    storeRow = declaredRow(DataStoreKind.SecurityEvents, {
      purpose: "Our own words",
    });

    const result: RouteCall = await call(DECLARED_PATH, {
      id: STORE_ID.toString(),
    });

    expect(result.answer).toMatchObject({
      purpose: "Our own words",
      retention: "15 days",
      declared: { isPurposeTheTeams: true, isRetentionTheTeams: false },
    });

    const findOne: {
      query: { _id: ObjectID; projectId: ObjectID };
      props: { isRoot?: boolean };
    } = storeFindOneSpy.mock.calls[0]![0] as never;

    expect(findOne.query._id.toString()).toBe(STORE_ID.toString());
    expect(findOne.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(findOne.props.isRoot).toBeFalsy();
  });

  test("a store a scan found is no declared store, and one that is not there is not found", async () => {
    storeRow = workerStore();

    const scanned: RouteCall = await call(DECLARED_PATH, {
      id: STORE_ID.toString(),
    });

    expect(scanned.thrown).toBeInstanceOf(BadDataException);
    expect(scanned.answer).toBeUndefined();

    storeRow = null;

    const missing: RouteCall = await call(DECLARED_PATH, {
      id: STORE_ID.toString(),
    });

    expect(missing.thrown).toBeInstanceOf(NotFoundException);

    const notAnId: RouteCall = await call(DECLARED_PATH, { id: "not-an-id" });

    expect(notAnId.thrown).toBeInstanceOf(BadDataException);
  });
});

describe("the Overview leaves out the stores OneUptime declares", () => {
  test("counting only what Data Security found and checks", async () => {
    const found: DataStore = new DataStore(ObjectID.generate());
    found.kind = DataStoreKind.AwsS3Bucket;
    found.sensitivity = DataSensitivity.Confidential;
    found.dataCategories = [DataCategory.ContactAndIdentity];
    found.configurationReadAt = NOW;
    stores.push(found);

    for (const kind of DECLARED_DATA_STORE_KINDS) {
      const declared: DataStore = new DataStore(ObjectID.generate());
      declared.kind = kind;
      declared.sensitivity = DataSensitivity.Confidential;
      declared.dataCategories = [DataCategory.ContactAndIdentity];
      stores.push(declared);
    }

    const answer: DataSecurityOverview = (
      await call(DATA_SECURITY_API_ROUTES.overview)
    ).answer as unknown as DataSecurityOverview;

    expect(answer.storeCount).toBe(1);
    expect(answer.evaluatedStoreCount).toBe(1);
    expect(answer.storesBySensitivity[DataSensitivity.Confidential]).toBe(1);
    expect(answer.storesByCategory).toEqual([
      { category: DataCategory.ContactAndIdentity, storeCount: 1 },
    ]);
  });
});
