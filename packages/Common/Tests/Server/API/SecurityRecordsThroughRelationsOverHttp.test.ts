jest.mock("../../../Server/Utils/Logger", () => {
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

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import SecurityBlockAPI from "../../../Server/API/SecurityBlockAPI";
import SecurityBlockCloudWafAPI from "../../../Server/API/SecurityBlockCloudWafAPI";
import SecurityWatchlistAPI from "../../../Server/API/SecurityWatchlistAPI";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataSecurityScanService from "../../../Server/Services/DataSecurityScanService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import SecurityBlockService from "../../../Server/Services/SecurityBlockService";
import SecurityBlockCloudWafService from "../../../Server/Services/SecurityBlockCloudWafService";
import SecurityWatchlistService from "../../../Server/Services/SecurityWatchlistService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import Select from "../../../Server/Types/Database/Select";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RelationReaders from "../../../Types/Database/RelationReaders";
import RelationReadersUtil from "../../../Types/Database/RelationReadersUtil";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
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

/*
 * WHAT EACH ROLE READS OF A SECURITY RECORD THROUGH THE RECORD THAT NAMES
 * IT, OVER HTTP THROUGH THE SERVER'S OWN ROUTES (#10310).
 *
 * A watchlist names the threat-intel feed it follows, a feed the connection
 * it reads through, a data store finding the scan that last read it, a data
 * security issue the case it is worked in, a data store and a scan the cloud
 * connection and account they were read through. Until #10310 every column
 * of the second a relation read was a label every reader of the first read,
 * so a custom role that reads detection rules could send
 *
 *   POST /api/security-watchlist/get-list
 *   { "select": { "threatIntelFeed": { "listUrl": true, "nextPageToken": true } } }
 *
 * and read a feed's list URL - a token in its query string - and its page
 * token; the Security tiers read a cloud connection's role ARN and regions
 * through any data store, though they may not read cloud connections.
 *
 * Here every request goes over HTTP through Express's body parser, the
 * routes the App serves (SecurityWatchlistAPI, DataSecurityAPI for data
 * stores, SecurityBlockAPI for blocks, BaseAPI for the rest), the
 * permission layer and the error handler, into tables held in memory that
 * join the related record as Postgres would (DashboardRequestsOverHttp,
 * InMemoryRepository):
 *
 *   - before: with the records as 17.1.0 shipped them, every reader of the
 *     first reads all of the second - the leak;
 *   - after, through each of the nine relations, for each of its readers:
 *     which record it is (its name, its kind or provider, whether it is on;
 *     a case by its number) is answered; the rest is answered for who may
 *     read the record itself and refused for everyone else, saying who may,
 *     before the table is read - and so is a filter or an order by it.
 *
 * Two of the nine came after #10310, with readers of their own the details
 * are held from as well: a block names the case it was made for (#10338),
 * read by a custom role that reads blocks; and App Platforms' levels
 * (#10289) read a cloud's resources, which name their connection, though
 * only Cloud's levels and the roles they follow read the connection.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10310000-0000-4000-8000-000000000001",
);
const RECORD_ID: string = "10310000-0000-4000-8000-0000000000a1";
const FEED_ID: string = "10310000-0000-4000-8000-0000000000b1";
const CONNECTION_ID: string = "10310000-0000-4000-8000-0000000000b2";
const SCAN_ID: string = "10310000-0000-4000-8000-0000000000b3";
const CASE_ID: string = "10310000-0000-4000-8000-0000000000b4";
const CLOUD_CONNECTION_ID: string = "10310000-0000-4000-8000-0000000000b5";
const CLOUD_ACCOUNT_ID: string = "10310000-0000-4000-8000-0000000000b6";
const STORE_ID: string = "10310000-0000-4000-8000-0000000000b7";
const PROBE_ID: string = "10310000-0000-4000-8000-0000000000b8";
const SERVICE_ID: string = "10310000-0000-4000-8000-0000000000b9";
const USER_ID: string = "10310000-0000-4000-8000-0000000000c1";
const TEAM_ID: string = "10310000-0000-4000-8000-0000000000c2";
const INCIDENT_ID: string = "10310000-0000-4000-8000-0000000000c3";
const STATUS_ID: string = "10310000-0000-4000-8000-0000000000c4";
const PRIORITY_ID: string = "10310000-0000-4000-8000-0000000000c5";

const AT: Date = new Date("2026-11-20T08:00:00.000Z");

// What each record holds, as the row that names it joins it.
const FEED: StoredRow = {
  _id: FEED_ID,
  projectId: PROJECT_ID.toString(),
  name: "URLhaus",
  feedType: "List",
  isEnabled: true,
  apiRootUrl: "https://taxii.example.com/api1/?token=taxii-secret-10310",
  listUrl: "https://lists.example.com/urlhaus.txt?key=list-secret-10310",
  indicatorConfidence: 80,
  securityEventConnectionId: CONNECTION_ID,
  collectionId: "collection-42",
  pollIntervalInMinutes: 60,
  minimumConfidence: 50,
  shouldCreateAlert: true,
  shouldWriteDetectionFinding: true,
  shouldCreateIncident: false,
  shouldCreateCase: true,
  lastPolledAt: AT,
  cursor: "cursor-10310",
  nextPageToken: "page-token-10310",
  lastPollSummary: "Read 120 indicators.",
  lastError:
    "401 from https://lists.example.com/urlhaus.txt?key=list-secret-10310",
  lastEvaluatedAt: AT,
  lastMatchAt: AT,
  lastMatchError: "The match against Security Events timed out.",
};

const CONNECTION: StoredRow = {
  _id: CONNECTION_ID,
  projectId: PROJECT_ID.toString(),
  name: "CrowdStrike Falcon",
  provider: "CrowdStrike",
  isEnabled: true,
  pollIntervalInMinutes: 5,
  alertingOnly: false,
  caseMinimumSeverity: "High",
  lastSuccessfulPollAt: AT,
  lastEventIngestedAt: AT,
  lastPolledAt: AT,
  cursor: "falcon-cursor-10310",
  lastError: "The API client's token expired.",
};

const SCAN: StoredRow = {
  _id: SCAN_ID,
  projectId: PROJECT_ID.toString(),
  kind: "Content",
  dataStoreId: STORE_ID,
  cloudConnectionId: CLOUD_CONNECTION_ID,
  probeId: PROBE_ID,
  status: "Failed",
  startedAt: AT,
  finishedAt: AT,
  durationInMs: 1200,
  storesRead: 1,
  objectsRead: 40,
  rowsRead: 12000,
  bytesRead: 1048576,
  findingsFound: 3,
  errorMessage: "Access denied to s3://customer-exports/raw/2026/",
};

const CASE: StoredRow = {
  _id: CASE_ID,
  projectId: PROJECT_ID.toString(),
  caseNumber: 12,
  caseNumberWithPrefix: "SC-12",
  title: "Credential stuffing against admin@acme.example",
  securityCaseStatusId: STATUS_ID,
  securityCasePriorityId: PRIORITY_ID,
  verdict: "True Positive",
  assignedToUserId: USER_ID,
  assignedToTeamId: TEAM_ID,
  source: "Detection Rule",
  detectionCount: 7,
  firstDetectedAt: AT,
  lastDetectedAt: AT,
  acknowledgedAt: AT,
  containedAt: AT,
  closedAt: AT,
  acknowledgeDueAt: AT,
  containDueAt: AT,
  acknowledgeMissedAt: AT,
  containMissedAt: AT,
  nextDueAt: AT,
  incidentId: INCIDENT_ID,
  // How soon an automatic response blocked its address (#10350).
  blockedAt: AT,
  timeToBlockInSeconds: 41,
};

const CLOUD_CONNECTION: StoredRow = {
  _id: CLOUD_CONNECTION_ID,
  projectId: PROJECT_ID.toString(),
  name: "Production AWS",
  provider: "aws",
  isEnabled: true,
  config: {
    roleArn: "arn:aws:iam::123456789012:role/OneUptimeReader",
    regions: ["eu-west-1"],
  },
  serviceId: SERVICE_ID,
  lastPulledAt: AT,
  lastSuccessfulPullAt: AT,
  lastError: "AccessDenied for arn:aws:iam::123456789012:role/OneUptimeReader",
  streamKeyCreatedAt: AT,
  addedMetrics: [{ name: "AWS/S3 BucketSizeBytes" }],
};

// The playbook run that made a block (#10338).
const RUN: StoredRow = {
  _id: "10310000-0000-4000-8000-0000000000c6",
  projectId: PROJECT_ID.toString(),
  securityCaseId: CASE_ID,
  securityPlaybookId: "10310000-0000-4000-8000-0000000000c7",
  playbookName: "Contain account takeover",
  trigger: "Triaged as Likely Malicious",
  status: "Succeeded",
  startedAt: AT,
  completedAt: AT,
  // The automatic response policy a run blocked for (#10350).
  securityAutomaticResponsePolicyId: "10310000-0000-4000-8000-0000000000c8",
};

const CLOUD_ACCOUNT: StoredRow = {
  _id: CLOUD_ACCOUNT_ID,
  projectId: PROJECT_ID.toString(),
  name: "Production",
  provider: "aws",
  accountId: "123456789012",
  providerAccountName: "acme-prod",
  cloudConnectionId: CLOUD_CONNECTION_ID,
  resourceCount: 420,
  regionCount: 3,
  lastSeenAt: AT,
};

interface Reader {
  name: string;
  permissions: Array<Permission>;
}

const OWNER: Reader = {
  name: "Project Owner",
  permissions: [Permission.ProjectOwner],
};
const ADMIN: Reader = {
  name: "Project Admin",
  permissions: [Permission.ProjectAdmin],
};
const SECURITY_ADMIN: Reader = {
  name: "Security Admin",
  permissions: [Permission.SecurityAdmin],
};
const SECURITY_MEMBER: Reader = {
  name: "Security Member",
  permissions: [Permission.SecurityMember],
};
const SECURITY_VIEWER: Reader = {
  name: "Security Viewer",
  permissions: [Permission.SecurityViewer],
};
const SECURITY_TIERS: Array<Reader> = [
  SECURITY_ADMIN,
  SECURITY_MEMBER,
  SECURITY_VIEWER,
];

interface Joiner {
  // "SecurityWatchlist.threatIntelFeed"
  name: string;
  path: string;
  service: DatabaseService<BaseModel>;
  relation: string;
  relatedModel: BaseModel;
  // The record the row joins, every column a relation reads.
  joined: StoredRow;
  // The row that names it.
  row: StoredRow;
  // Every reader of the relation, and those of them who read the record itself.
  readers: Array<Reader>;
  readsRelated: Array<Reader>;
  // What says which record it is: what every reader of the relation reads.
  labels: Array<string>;
  // A column held to the record's own read, to filter and order by.
  filterColumn: string;
  // Who may read the record itself, as a refusal names them.
  whoMay: string;
}

const SECURITY_RECORD_READERS: string =
  "Project Owner, Project Admin, Security Admin, Security Member, Security Viewer";

// A cloud connection's and account's readers: Cloud's levels too (#10289), never App Platforms'.
const CLOUD_READERS: string =
  "You need one of these permissions: Project Owner, Project Admin, Project Member, Viewer, Settings Admin, Settings Member, Settings Viewer, Read Cloud Resource, Cloud Admin, Cloud Member, Cloud Viewer.";

function customRole(name: string, permissions: Array<Permission>): Reader {
  return { name: name, permissions: permissions };
}

const READS_DETECTION_RULES: Reader = customRole(
  "a custom role that reads detection rules",
  [Permission.ReadProjectDetectionRule],
);
const READS_FEEDS: Reader = customRole("a custom role that reads feeds", [
  Permission.ReadProjectThreatIntelFeed,
]);
const READS_FINDINGS: Reader = customRole("a custom role that reads findings", [
  Permission.ReadDataStoreFinding,
]);
const READS_ISSUES: Reader = customRole(
  "a custom role that reads data security issues",
  [Permission.ReadDataSecurityIssue],
);
const READS_STORES: Reader = customRole("a custom role that reads stores", [
  Permission.ReadDataStore,
]);
const READS_SCANS: Reader = customRole("a custom role that reads scans", [
  Permission.ReadDataSecurityScan,
]);
// A Security Viewer given the project's cloud resources too: reads both.
const READS_STORES_AND_CLOUD: Reader = customRole(
  "a Security Viewer who also reads cloud resources",
  [Permission.SecurityViewer, Permission.ReadCloudResource],
);
const READS_BLOCKS: Reader = customRole("a custom role that reads blocks", [
  Permission.ReadSecurityBlock,
]);
const READS_BLOCKS_AND_CASES: Reader = customRole(
  "a custom role that reads blocks and cases",
  [Permission.ReadSecurityBlock, Permission.ReadSecurityCase],
);
const READS_BLOCKS_AND_RUNS: Reader = customRole(
  "a custom role that reads blocks and playbook runs",
  [Permission.ReadSecurityBlock, Permission.ReadSecurityPlaybookRun],
);
// A blocklist reader given the project's cloud resources too: reads a WAF's connection (#10344).
const READS_BLOCKS_AND_CLOUD: Reader = customRole(
  "a custom role that reads blocks and cloud resources",
  [Permission.ReadSecurityBlock, Permission.ReadCloudResource],
);

// A cloud's resources' readers (#10289): every one of them reads its connection but App Platforms' levels.
const VIEWER: Reader = { name: "Viewer", permissions: [Permission.Viewer] };
const SETTINGS_VIEWER: Reader = {
  name: "Settings Viewer",
  permissions: [Permission.SettingsViewer],
};
const READS_CLOUD_RESOURCES: Reader = customRole(
  "a custom role that reads cloud resources",
  [Permission.ReadCloudResource],
);
const CLOUD_ADMIN: Reader = {
  name: "Cloud Admin",
  permissions: [Permission.CloudAdmin],
};
const CLOUD_VIEWER: Reader = {
  name: "Cloud Viewer",
  permissions: [Permission.CloudViewer],
};
const APP_PLATFORM_LEVELS: Array<Reader> = [
  { name: "App Platform Admin", permissions: [Permission.AppPlatformAdmin] },
  { name: "App Platform Member", permissions: [Permission.AppPlatformMember] },
  { name: "App Platform Viewer", permissions: [Permission.AppPlatformViewer] },
];
// An App Platforms team given Cloud's Viewer level too: reads the connection.
const APP_PLATFORMS_AND_CLOUD: Reader = customRole(
  "an App Platform Viewer who is also a Cloud Viewer",
  [Permission.AppPlatformViewer, Permission.CloudViewer],
);

const JOINERS: Array<Joiner> = [
  {
    name: "SecurityWatchlist.threatIntelFeed",
    path: "/api/security-watchlist/get-list",
    service: SecurityWatchlistService as unknown as DatabaseService<BaseModel>,
    relation: "threatIntelFeed",
    relatedModel: new ThreatIntelFeed(),
    joined: FEED,
    row: {
      name: "URLhaus",
      entityType: "Url",
      source: "Threat Intel Feed",
      threatIntelFeedId: FEED_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_DETECTION_RULES],
    readsRelated: [
      OWNER,
      ADMIN,
      ...SECURITY_TIERS,
      customRole("a custom role that reads detection rules and feeds", [
        Permission.ReadProjectDetectionRule,
        Permission.ReadProjectThreatIntelFeed,
      ]),
    ],
    labels: ["feedType", "isEnabled", "name"],
    filterColumn: "listUrl",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}, Read Threat Intel Feed.`,
  },
  {
    name: "ThreatIntelFeed.securityEventConnection",
    path: "/api/threat-intel-feed/get-list",
    service: ThreatIntelFeedService as unknown as DatabaseService<BaseModel>,
    relation: "securityEventConnection",
    relatedModel: new SecurityEventConnection(),
    joined: CONNECTION,
    row: {
      name: "Falcon indicators",
      feedType: "Security Event Connection",
      securityEventConnectionId: CONNECTION_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_FEEDS],
    readsRelated: [OWNER, ADMIN, ...SECURITY_TIERS],
    labels: ["isEnabled", "name", "provider"],
    filterColumn: "cursor",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}.`,
  },
  {
    name: "DataStoreFinding.lastScan",
    path: "/api/data-store-finding/get-list",
    service: DataStoreFindingService as unknown as DatabaseService<BaseModel>,
    relation: "lastScan",
    relatedModel: new DataSecurityScan(),
    joined: SCAN,
    row: {
      dataStoreId: STORE_ID,
      lastScanId: SCAN_ID,
      dataTypeId: "credit-card-number",
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_FINDINGS],
    readsRelated: [
      OWNER,
      ADMIN,
      ...SECURITY_TIERS,
      customRole("a custom role that reads findings and scans", [
        Permission.ReadDataStoreFinding,
        Permission.ReadDataSecurityScan,
      ]),
    ],
    labels: ["kind"],
    filterColumn: "errorMessage",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}, Read Data Security Scan.`,
  },
  {
    name: "DataSecurityIssue.securityCase",
    path: "/api/data-security-issue/get-list",
    service: DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    relation: "securityCase",
    relatedModel: new SecurityCase(),
    joined: CASE,
    row: {
      title: "Anyone on the internet can read it",
      dataStoreId: STORE_ID,
      securityCaseId: CASE_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_ISSUES],
    readsRelated: [
      OWNER,
      ADMIN,
      ...SECURITY_TIERS,
      customRole("a custom role that reads issues and cases", [
        Permission.ReadDataSecurityIssue,
        Permission.ReadSecurityCase,
      ]),
    ],
    labels: ["caseNumber", "caseNumberWithPrefix"],
    filterColumn: "verdict",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}, Read Security Case.`,
  },
  {
    name: "DataStore.cloudConnection",
    path: "/api/data-store/get-list",
    service: DataStoreService as unknown as DatabaseService<BaseModel>,
    relation: "cloudConnection",
    relatedModel: new CloudConnection(),
    joined: CLOUD_CONNECTION,
    row: {
      name: "customer-exports",
      kind: "AWS S3 Bucket",
      cloudConnectionId: CLOUD_CONNECTION_ID,
      cloudAccountId: CLOUD_ACCOUNT_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_STORES],
    readsRelated: [OWNER, ADMIN, READS_STORES_AND_CLOUD],
    labels: ["isEnabled", "name", "provider"],
    filterColumn: "lastError",
    whoMay: CLOUD_READERS,
  },
  {
    name: "DataSecurityScan.cloudConnection",
    path: "/api/data-security-scan/get-list",
    service: DataSecurityScanService as unknown as DatabaseService<BaseModel>,
    relation: "cloudConnection",
    relatedModel: new CloudConnection(),
    joined: CLOUD_CONNECTION,
    row: {
      kind: "Configuration",
      status: "Succeeded",
      cloudConnectionId: CLOUD_CONNECTION_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_SCANS],
    readsRelated: [OWNER, ADMIN, READS_STORES_AND_CLOUD],
    labels: ["isEnabled", "name", "provider"],
    filterColumn: "lastError",
    whoMay: CLOUD_READERS,
  },
  {
    name: "DataStore.cloudAccount",
    path: "/api/data-store/get-list",
    service: DataStoreService as unknown as DatabaseService<BaseModel>,
    relation: "cloudAccount",
    relatedModel: new CloudAccount(),
    joined: CLOUD_ACCOUNT,
    row: {
      name: "customer-exports",
      kind: "AWS S3 Bucket",
      cloudConnectionId: CLOUD_CONNECTION_ID,
      cloudAccountId: CLOUD_ACCOUNT_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_STORES],
    readsRelated: [OWNER, ADMIN, READS_STORES_AND_CLOUD],
    labels: ["name", "provider"],
    filterColumn: "accountId",
    whoMay: CLOUD_READERS,
  },
  {
    // The case a block was made for (#10338).
    name: "SecurityBlock.securityCase",
    path: "/api/security-block/get-list",
    service: SecurityBlockService as unknown as DatabaseService<BaseModel>,
    relation: "securityCase",
    relatedModel: new SecurityCase(),
    joined: CASE,
    row: {
      value: "203.0.113.7",
      securityCaseId: CASE_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_BLOCKS],
    readsRelated: [OWNER, ADMIN, ...SECURITY_TIERS, READS_BLOCKS_AND_CASES],
    labels: ["caseNumber", "caseNumberWithPrefix"],
    filterColumn: "verdict",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}, Read Security Case.`,
  },
  {
    /*
     * The playbook run that made a block (#10338): every reader of the block
     * reads which run it was, and nothing of it but who may read the run.
     */
    name: "SecurityBlock.securityPlaybookRun",
    path: "/api/security-block/get-list",
    service: SecurityBlockService as unknown as DatabaseService<BaseModel>,
    relation: "securityPlaybookRun",
    relatedModel: new SecurityPlaybookRun(),
    joined: RUN,
    row: {
      value: "198.51.100.9",
      securityPlaybookRunId: RUN["_id"],
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_BLOCKS],
    readsRelated: [OWNER, ADMIN, ...SECURITY_TIERS, READS_BLOCKS_AND_RUNS],
    labels: [],
    filterColumn: "playbookName",
    whoMay: `You need one of these permissions: ${SECURITY_RECORD_READERS}, Read Security Playbook Run.`,
  },
  {
    // The connection a cloud's resource is read through, for App Platforms' levels too (#10289).
    name: "CloudResource.cloudConnection",
    path: "/api/cloud-resource/get-list",
    service: CloudResourceService as unknown as DatabaseService<BaseModel>,
    relation: "cloudConnection",
    relatedModel: new CloudConnection(),
    joined: CLOUD_CONNECTION,
    row: {
      name: "checkout-api",
      cloudConnectionId: CLOUD_CONNECTION_ID,
    },
    readers: [
      OWNER,
      ADMIN,
      VIEWER,
      SETTINGS_VIEWER,
      READS_CLOUD_RESOURCES,
      CLOUD_ADMIN,
      CLOUD_VIEWER,
      ...APP_PLATFORM_LEVELS,
    ],
    readsRelated: [
      OWNER,
      ADMIN,
      VIEWER,
      SETTINGS_VIEWER,
      READS_CLOUD_RESOURCES,
      CLOUD_ADMIN,
      CLOUD_VIEWER,
      APP_PLATFORMS_AND_CLOUD,
    ],
    labels: ["isEnabled", "name", "provider"],
    filterColumn: "lastError",
    whoMay: CLOUD_READERS,
  },
  {
    /*
     * The connection OneUptime writes a cloud WAF's blocklist through
     * (#10344): read by the blocklist's readers, whom the Security levels
     * are - and who read which connection it is, never its configuration,
     * its last error or its pull times, unless they read cloud connections.
     */
    name: "SecurityBlockCloudWaf.cloudConnection",
    path: "/api/security-block-cloud-waf/get-list",
    service:
      SecurityBlockCloudWafService as unknown as DatabaseService<BaseModel>,
    relation: "cloudConnection",
    relatedModel: new CloudConnection(),
    joined: CLOUD_CONNECTION,
    row: {
      name: "checkout-edge",
      region: "us-east-1",
      clientAddress: "SourceIp",
      cloudConnectionId: CLOUD_CONNECTION_ID,
    },
    readers: [OWNER, ADMIN, ...SECURITY_TIERS, READS_BLOCKS],
    readsRelated: [OWNER, ADMIN, READS_BLOCKS_AND_CLOUD],
    labels: ["isEnabled", "name", "provider"],
    filterColumn: "lastError",
    whoMay: CLOUD_READERS,
  },
];

// The columns of the related record held to its own read through a relation.
function heldOf(joiner: Joiner): Array<string> {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(
    joiner.relatedModel,
  );

  return Object.keys(columns).filter((column: string): boolean => {
    return RelationReadersUtil.isHeldToItsOwnRead(columns[column]);
  });
}

// What a relation reads for every reader of it, but the ids and the project.
function labelsOf(model: BaseModel): Array<string> {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

  return Object.keys(columns)
    .filter((column: string): boolean => {
      return (
        !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
        column !== "projectId" &&
        RelationReadersUtil.isReadByEveryReaderOfTheRelation(columns[column])
      );
    })
    .sort();
}

function narrowReadersOf(joiner: Joiner): Array<Reader> {
  return joiner.readers.filter((reader: Reader): boolean => {
    return !joiner.readsRelated.includes(reader);
  });
}

// Every reader of every relation, those who read the related record last.
const CASES: Array<[string, string, Joiner, Reader, boolean]> = JOINERS.flatMap(
  (joiner: Joiner): Array<[string, string, Joiner, Reader, boolean]> => {
    return [
      ...joiner.readers.map(
        (reader: Reader): [string, string, Joiner, Reader, boolean] => {
          return [
            joiner.name,
            reader.name,
            joiner,
            reader,
            joiner.readsRelated.includes(reader),
          ];
        },
      ),
      ...joiner.readsRelated
        .filter((reader: Reader): boolean => {
          return !joiner.readers.includes(reader);
        })
        .map((reader: Reader): [string, string, Joiner, Reader, boolean] => {
          return [joiner.name, reader.name, joiner, reader, true];
        }),
    ];
  },
);

const NARROW_CASES: Array<[string, string, Joiner, Reader]> = JOINERS.flatMap(
  (joiner: Joiner): Array<[string, string, Joiner, Reader]> => {
    return narrowReadersOf(joiner).map(
      (reader: Reader): [string, string, Joiner, Reader] => {
        return [joiner.name, reader.name, joiner, reader];
      },
    );
  },
);

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

// The related record as the first record of a list's answer joins it.
function joinedOf(sent: SentRequest, relation: string): JSONObject {
  const data: Array<JSONObject> = ((sent.answer as JSONObject)?.["data"] ||
    []) as Array<JSONObject>;

  return (data[0]?.[relation] || {}) as JSONObject;
}

// Its columns an answer holds, but its id.
function columnsOf(joined: JSONObject): Array<string> {
  return Object.keys(joined)
    .filter((column: string): boolean => {
      return (
        !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
        !column.startsWith("_") &&
        joined[column] !== undefined &&
        joined[column] !== null
      );
    })
    .sort();
}

function selectOf(joiner: Joiner, columns: Array<string>): JSONObject {
  const relationSelect: JSONObject = { _id: true };

  for (const column of columns) {
    relationSelect[column] = true;
  }

  return { _id: true, [joiner.relation]: relationSelect };
}

// The status the server refuses a read with (NotAuthorizedException).
const REFUSED: number = 422;

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function useJoiner(joiner: Joiner): InMemoryTable {
  return useInMemoryTable(
    joiner.service,
    [
      {
        _id: RECORD_ID,
        projectId: PROJECT_ID.toString(),
        ...joiner.row,
        [joiner.relation]: { ...joiner.joined },
      },
    ],
    { answersOnlySelectedColumns: true },
  );
}

async function send(
  joiner: Joiner,
  body: JSONObject,
): Promise<{ sent: SentRequest; table: InMemoryTable }> {
  const table: InMemoryTable = useJoiner(joiner);

  const sent: SentRequest = await server.request("POST", joiner.path, {
    query: {},
    limit: 10,
    skip: 0,
    ...body,
  });

  return { sent: sent, table: table };
}

/*
 * The related record as 17.1.0 shipped it: every column a relation reads
 * read by every reader of the relation. The metadata is the model's own:
 * planted off, and put back.
 */
function asShippedIn1710(joiner: Joiner): () => void {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(
    joiner.relatedModel,
  );
  const held: Array<TableColumnMetadata> = heldOf(joiner).map(
    (column: string): TableColumnMetadata => {
      return columns[column]!;
    },
  );

  for (const metadata of held) {
    delete metadata.relationReaders;
  }

  return (): void => {
    for (const metadata of held) {
      metadata.relationReaders = RelationReaders.ColumnReaders;
    }
  };
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    // The App serves watchlists, data stores and blocks with routes of their own.
    new SecurityWatchlistAPI().getRouter(),
    new DataSecurityAPI().getRouter(),
    new SecurityBlockAPI().getRouter(),
    new SecurityBlockCloudWafAPI().getRouter(),
    new BaseAPI<CloudResource, DatabaseService<BaseModel>>(
      CloudResource,
      CloudResourceService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<ThreatIntelFeed, DatabaseService<BaseModel>>(
      ThreatIntelFeed,
      ThreatIntelFeedService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataStoreFinding, DatabaseService<BaseModel>>(
      DataStoreFinding,
      DataStoreFindingService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityIssue, DatabaseService<BaseModel>>(
      DataSecurityIssue,
      DataSecurityIssueService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<DataSecurityScan, DatabaseService<BaseModel>>(
      DataSecurityScan,
      DataSecurityScanService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what each record's relations read", () => {
  test.each(JOINERS)(
    "$name: which record it is for every reader of the relation, and the rest held to the record's own read",
    (joiner: Joiner) => {
      expect(labelsOf(joiner.relatedModel)).toEqual([...joiner.labels].sort());

      const held: Array<string> = heldOf(joiner);
      expect(held.length).toBeGreaterThan(0);

      // Every column the row joins is one or the other.
      expect([...joiner.labels, ...held, "projectId"].sort()).toEqual(
        Object.keys(joiner.joined)
          .filter((column: string): boolean => {
            return column !== "_id";
          })
          .sort(),
      );

      // Each held column follows the record's own read.
      for (const column of held) {
        expect({
          column: column,
          read: [
            ...(joiner.relatedModel.getColumnAccessControlFor(column)?.read ||
              []),
          ].sort(),
        }).toEqual({
          column: column,
          read: [...(joiner.relatedModel.readRecordPermissions || [])].sort(),
        });
      }
    },
  );

  test("the details the issue names are held: a feed's URLs and tokens, a connection's cursor, a scan's figures, a case's title and verdict, a cloud connection's configuration", () => {
    const heldBy: Record<string, Array<string>> = {};

    for (const joiner of JOINERS) {
      heldBy[joiner.relatedModel.tableName!] = heldOf(joiner);
    }

    expect(heldBy["ThreatIntelFeed"]).toEqual(
      expect.arrayContaining([
        "apiRootUrl",
        "listUrl",
        "collectionId",
        "cursor",
        "nextPageToken",
        "lastError",
        "lastMatchError",
        "lastPollSummary",
        "pollIntervalInMinutes",
        "minimumConfidence",
      ]),
    );
    expect(heldBy["SecurityEventConnection"]).toEqual(
      expect.arrayContaining(["cursor", "lastError", "lastPolledAt"]),
    );
    expect(heldBy["DataSecurityScan"]).toEqual(
      expect.arrayContaining([
        "errorMessage",
        "bytesRead",
        "rowsRead",
        "objectsRead",
        "probeId",
      ]),
    );
    expect(heldBy["SecurityCase"]).toEqual(
      expect.arrayContaining([
        "title",
        "verdict",
        "assignedToUserId",
        "assignedToTeamId",
        "acknowledgeDueAt",
        "containMissedAt",
        "detectionCount",
      ]),
    );
    expect(heldBy["CloudConnection"]).toEqual(
      expect.arrayContaining(["config", "lastError", "addedMetrics"]),
    );
    expect(heldBy["CloudAccount"]).toEqual(
      expect.arrayContaining([
        "accountId",
        "providerAccountName",
        "resourceCount",
        "regionCount",
      ]),
    );
  });
});

describe("before #10310: every reader of the record that names it read the whole of it", () => {
  test.each(NARROW_CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      const putBack: () => void = asShippedIn1710(joiner);

      try {
        caller = callerWith(reader.permissions);

        const { sent } = await send(joiner, {
          select: selectOf(joiner, [...joiner.labels, ...heldOf(joiner)]),
        });

        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 200,
          refusal: "",
        });
        expect(columnsOf(joinedOf(sent, joiner.relation))).toEqual(
          [...joiner.labels, ...heldOf(joiner)].sort(),
        );
      } finally {
        putBack();
      }
    },
  );

  test("a custom role that reads detection rules read a feed's list URL - a token in its query string - and its page token", async () => {
    const joiner: Joiner = JOINERS[0]!;
    const putBack: () => void = asShippedIn1710(joiner);

    try {
      caller = callerWith(READS_DETECTION_RULES.permissions);

      const { sent } = await send(joiner, {
        select: selectOf(joiner, ["name", "listUrl", "nextPageToken"]),
      });

      expect(joinedOf(sent, "threatIntelFeed")).toEqual(
        expect.objectContaining({
          listUrl:
            "https://lists.example.com/urlhaus.txt?key=list-secret-10310",
          nextPageToken: "page-token-10310",
        }),
      );
    } finally {
      putBack();
    }
  });
});

describe("after: through each relation, each reader reads which record it is", () => {
  test.each(CASES)(
    "%s: %s",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, joiner.labels),
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(table.repository.find).toHaveBeenCalled();
      expect(columnsOf(joinedOf(sent, joiner.relation))).toEqual(
        [...joiner.labels].sort(),
      );
    },
  );
});

describe("after: through each relation, the rest of the record is read only by who may read it", () => {
  test.each(CASES)(
    "%s: %s",
    async (
      _through: string,
      _who: string,
      joiner: Joiner,
      reader: Reader,
      readsRelated: boolean,
    ) => {
      caller = callerWith(reader.permissions);

      const held: Array<string> = heldOf(joiner);
      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, [...joiner.labels, ...held]),
      });

      if (!readsRelated) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: REFUSED,
          refusal: `You do not have permissions to read ${held[0]} of ${joiner.relatedModel.singularName} through ${joiner.relation} on ${new (joiner.service.modelType as { new (): BaseModel })().singularName}. ${joiner.whoMay}`,
        });
        // Refused before the table is read.
        expect(table.repository.find).not.toHaveBeenCalled();
        return;
      }

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(columnsOf(joinedOf(sent, joiner.relation))).toEqual(
        [...joiner.labels, ...held].sort(),
      );
    },
  );

  test.each(
    NARROW_CASES.flatMap(
      (
        entry: [string, string, Joiner, Reader],
      ): Array<[string, string, string, Joiner, Reader]> => {
        return heldOf(entry[2]).map(
          (column: string): [string, string, string, Joiner, Reader] => {
            return [entry[1], column, entry[0], entry[2], entry[3]];
          },
        );
      },
    ),
  )(
    "%s selecting %s alone through %s is refused, saying who may",
    async (
      _who: string,
      column: string,
      _through: string,
      joiner: Joiner,
      reader: Reader,
    ) => {
      caller = callerWith(reader.permissions);

      // Beside which record it is, when a relation reads that much of it.
      const label: string | undefined =
        "name" in joiner.joined ? "name" : joiner.labels[0];

      const { sent, table } = await send(joiner, {
        select: selectOf(joiner, label ? [label, column] : [column]),
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        `You do not have permissions to read ${column} of ${joiner.relatedModel.singularName} through ${joiner.relation}`,
      );
      expect(refusalOf(sent)).toContain(joiner.whoMay);
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );
});

describe("a filter or an order by a held column reads it, and is held to the record's own read", () => {
  test.each(NARROW_CASES)(
    "%s: %s filtering by it is refused",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        query: {
          [joiner.relation]: {
            [joiner.filterColumn]: String(joiner.joined[joiner.filterColumn]),
          },
        },
        select: { _id: true },
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        `You do not have permissions to query on - ${joiner.filterColumn} of ${joiner.relatedModel.singularName} through ${joiner.relation}.`,
      );
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test.each(NARROW_CASES)(
    "%s: %s ordering by it is refused",
    async (_through: string, _who: string, joiner: Joiner, reader: Reader) => {
      caller = callerWith(reader.permissions);

      const { sent, table } = await send(joiner, {
        select: { _id: true },
        sort: { [joiner.relation]: { [joiner.filterColumn]: "DESC" } },
      });

      expect(sent.status).toBe(REFUSED);
      expect(refusalOf(sent)).toContain(
        `You do not have permissions to sort on - ${joiner.filterColumn} of ${joiner.relatedModel.singularName} through ${joiner.relation}.`,
      );
      expect(table.repository.find).not.toHaveBeenCalled();
    },
  );

  test("before #10310, a custom role that reads detection rules filtered watchlists by their feed's list URL: a yes or no on each guess", async () => {
    const joiner: Joiner = JOINERS[0]!;
    const putBack: () => void = asShippedIn1710(joiner);

    try {
      caller = callerWith(READS_DETECTION_RULES.permissions);

      const { sent } = await send(joiner, {
        query: { threatIntelFeed: { listUrl: String(FEED["listUrl"]) } },
        select: { _id: true },
      });

      expect(refusalOf(sent)).not.toContain("You do not have permissions");
    } finally {
      putBack();
    }
  });
});

describe("the select a read on a reader's behalf sends: which record it is, and what else they may read", () => {
  test.each(CASES)(
    "%s: %s",
    (
      _through: string,
      _who: string,
      joiner: Joiner,
      reader: Reader,
      readsRelated: boolean,
    ) => {
      const asked: JSONObject = selectOf(joiner, [
        ...joiner.labels,
        ...heldOf(joiner),
      ]);
      const sentFor: JSONObject =
        QueryPermission.getSelectReadableThroughRelations({
          modelType: joiner.service.modelType as { new (): BaseModel },
          select: asked as Select<BaseModel>,
          props: callerWith(reader.permissions),
        }) as JSONObject;

      expect(
        Object.keys(sentFor[joiner.relation] as JSONObject).sort(),
      ).toEqual(
        (readsRelated
          ? ["_id", ...joiner.labels, ...heldOf(joiner)]
          : ["_id", ...joiner.labels]
        ).sort(),
      );

      // What it leaves out, the server would have refused.
      expect(() => {
        QueryPermission.checkRelationQueryPermission(
          joiner.service.modelType as { new (): BaseModel },
          {},
          sentFor as Select<BaseModel>,
          callerWith(reader.permissions),
        );
      }).not.toThrow();
    },
  );
});

describe("the readers are the models' own", () => {
  test("a data store's readers do not read cloud connections, and a cloud resource's do", () => {
    expect(new DataStore().readRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.SecurityAdmin,
        Permission.SecurityMember,
        Permission.SecurityViewer,
        Permission.ReadDataStore,
      ]),
    );
    expect(new CloudConnection().readRecordPermissions).not.toEqual(
      expect.arrayContaining([Permission.SecurityViewer]),
    );
    expect(new CloudConnection().readRecordPermissions).toEqual(
      expect.arrayContaining([Permission.ReadCloudResource, Permission.Viewer]),
    );
    expect(new SecurityWatchlist().readRecordPermissions).toEqual(
      expect.arrayContaining([Permission.ReadProjectDetectionRule]),
    );
    expect(new ThreatIntelFeed().readRecordPermissions).not.toEqual(
      expect.arrayContaining([Permission.ReadProjectDetectionRule]),
    );
  });

  test("App Platforms' levels read a cloud's resources and not its connections; Cloud's read both (#10289)", () => {
    const resourceReaders: Array<Permission> =
      new CloudResource().readRecordPermissions || [];
    const connectionReaders: Array<Permission> =
      new CloudConnection().readRecordPermissions || [];

    for (const level of [
      Permission.AppPlatformAdmin,
      Permission.AppPlatformMember,
      Permission.AppPlatformViewer,
    ]) {
      expect({
        level,
        readsResources: resourceReaders.includes(level),
      }).toEqual({ level, readsResources: true });
      expect({
        level,
        readsConnections: connectionReaders.includes(level),
      }).toEqual({ level, readsConnections: false });
    }

    for (const level of [
      Permission.CloudAdmin,
      Permission.CloudMember,
      Permission.CloudViewer,
    ]) {
      expect([
        resourceReaders.includes(level),
        connectionReaders.includes(level),
      ]).toEqual([true, true]);
    }
  });

  test("a custom role that reads blocks does not read cases (#10338)", () => {
    expect(new SecurityBlock().readRecordPermissions).toEqual(
      expect.arrayContaining([Permission.ReadSecurityBlock]),
    );
    expect(new SecurityCase().readRecordPermissions).not.toEqual(
      expect.arrayContaining([Permission.ReadSecurityBlock]),
    );
  });
});
