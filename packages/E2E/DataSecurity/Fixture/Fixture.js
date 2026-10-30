/*
 * Offline fixture for Data Security.
 *
 * The product's real route tree (Routes/DataSecurityRoutes: the product's
 * layout and side menu, a data store's and an issue's own layouts, every
 * page) is mounted under its real RouteMap pattern. Only the data boundary
 * (ModelAPI, API, Realtime) and the signed-in user are replaced, by
 * in-memory tables of a synthetic "Acme Commerce" project: four data stores
 * (a public S3 bucket of customer exports, an RDS database, a warehouse and
 * a service's logs), their findings, access and scans, five issues, and
 * each store's and issue's timeline.
 *
 * Scenarios, parsed once per page load:
 *
 *   ?lang=     en (default) | de | fa. The Dashboard's own locale files,
 *              with the production helpers that set <html lang> and
 *              <html dir> and write dates in the reader's language.
 *   ?theme=    dark adds html.dark (handled by server.js).
 *   ?role=     owner (default) | viewer. A viewer holds Security Viewer
 *              only: it reads everything and changes nothing.
 *   ?response= on (default) | off. Whether the bucket's cloud connection
 *              has "Data security response" on: off, Fix it from here
 *              says what to turn on, and links to the connection.
 *   ?data=     default | empty | busy. "empty" is a new project: no cloud
 *              connection and nothing found yet. "busy" adds 26 stores
 *              with long names, and an open issue or two on each.
 *   ?fail=     reads: every read fails, as when the API is down, so each
 *              page shows how it says so.
 *
 * Every read and write is recorded on window.__dataSecurityFixture:
 * getItemRequests, listRequests, countRequests, apiRequests, updates,
 * creates, and unhandled - anything the fixture does not model. The spec
 * asserts what it expects there.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import DE from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import FA from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import DataSecurityRoutes from "../../../App/FeatureSet/Dashboard/src/Routes/DataSecurityRoutes";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import DataSecurityCheckSetting from "Common/Models/DatabaseModels/DataSecurityCheckSetting";
import DataSecurityCustomDataType from "Common/Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueFeed, {
  DataSecurityIssueFeedEventType,
} from "Common/Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityResidencyRule from "Common/Models/DatabaseModels/DataSecurityResidencyRule";
import DataSecurityScan from "Common/Models/DatabaseModels/DataSecurityScan";
import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import DataStoreFeed, {
  DataStoreFeedEventType,
} from "Common/Models/DatabaseModels/DataStoreFeed";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import DataStoreLabelRule from "Common/Models/DatabaseModels/DataStoreLabelRule";
import DataStoreOwnerRule from "Common/Models/DatabaseModels/DataStoreOwnerRule";
import DataStoreOwnerTeam from "Common/Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "Common/Models/DatabaseModels/DataStoreOwnerUser";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  Blue500,
  Gray500,
  Green500,
  Purple500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "Common/Types/DataSecurity/ComplianceFramework";
import { scoreComplianceFramework } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataStoreEnvironment from "Common/Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "Common/Types/DataSecurity/DataStorePosture";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import {
  getRiskScore,
  moreSevere,
} from "Common/Types/DataSecurity/DataSecurityRisk";
import { getDataSecurityCheck } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityResponseUnavailableReason,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityResponseAction } from "Common/Types/DataSecurity/DataSecurityResponseAction";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

const params = new URLSearchParams(window.location.search);
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const isResponseOn = params.get("response") !== "off";
const dataSet = ["empty", "busy"].includes(params.get("data"))
  ? params.get("data")
  : "default";
const isFailing = params.get("fail") === "reads";
const rolePermissions =
  role === "viewer"
    ? [Permission.SecurityViewer]
    : [Permission.ProjectOwner, Permission.SecurityAdmin];

// The spec pins the browser clock here.
const NOW = new Date("2026-10-27T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(milliseconds) {
  return new Date(NOW.getTime() - milliseconds);
}

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const ID = {
  user: (n) => uuid("80000000", n),
  store: (n) => uuid("20000000", n),
  issue: (n) => uuid("30000000", n),
  finding: (n) => uuid("40000000", n),
  access: (n) => uuid("50000000", n),
  scan: (n) => uuid("60000000", n),
  feed: (n) => uuid("70000000", n),
  connection: (n) => uuid("90000000", n),
  flow: (n) => uuid("a0000000", n),
  setting: (n) => uuid("b0000000", n),
  owner: (n) => uuid("c0000000", n),
  // The security case, alert and incident the Critical issue started.
  securityCase: (n) => uuid("d0000000", n),
  alert: (n) => uuid("e0000000", n),
  incident: (n) => uuid("f0000000", n),
};

const fixture = {
  now: NOW.toISOString(),
  ids: {
    project: PROJECT_ID,
    bucket: ID.store(1),
    database: ID.store(2),
    warehouse: ID.store(3),
    logs: ID.store(4),
    publicBucketIssue: ID.issue(1),
    unencryptedIssue: ID.issue(2),
    emailInLogsIssue: ID.issue(3),
    connection: ID.connection(1),
  },
  scenario: {
    language,
    role,
    response: isResponseOn ? "on" : "off",
    data: dataSet,
    fail: isFailing ? "reads" : "",
  },
  getItemRequests: [],
  listRequests: [],
  countRequests: [],
  apiRequests: [],
  updates: [],
  creates: [],
  unhandled: [],
};
window.__dataSecurityFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function make(modelType, record) {
  return Object.assign(new modelType(), record);
}

function tableName(modelType) {
  return new modelType().tableName;
}

/*
 * ---------------------------------------------------------------------------
 * People and the project
 * ---------------------------------------------------------------------------
 */
const people = {
  maya: make(User, {
    _id: ID.user(1),
    name: new Name("Maya Chen"),
    email: new Email("maya.chen@acme-commerce.example"),
  }),
  diego: make(User, {
    _id: ID.user(2),
    name: new Name("Diego Alvarez"),
    email: new Email("diego.alvarez@acme-commerce.example"),
  }),
};

const project = make(Project, {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

/*
 * ---------------------------------------------------------------------------
 * The data stores
 * ---------------------------------------------------------------------------
 */
const tables = new Map();

function table(modelType) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    tables.set(name, { modelType, records: [] });
  }
  return tables.get(name).records;
}

const projectId = new ObjectID(PROJECT_ID);

table(CloudConnection).push({
  _id: ID.connection(1),
  projectId,
  name: "Acme production (AWS)",
  provider: CloudProvider.AWS,
  isEnabled: true,
  config: {
    [DATA_SECURITY_FIELD_KEY]: "content",
    [DATA_SECURITY_RESPONSE_FIELD_KEY]: isResponseOn ? "block" : "off",
  },
});

const STORES = [
  {
    _id: ID.store(1),
    projectId,
    name: "customer-exports",
    description: "Nightly CSV exports of customer orders for the finance team.",
    kind: DataStoreKind.AwsS3Bucket,
    provider: "aws",
    family: "Object storage",
    discoveredFrom: "Cloud inventory",
    cloudConnectionId: new ObjectID(ID.connection(1)),
    providerResourceId: "arn:aws:s3:::customer-exports",
    cloudAccountNumber: "123456789012",
    region: "eu-west-1",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Restricted,
    dataTypeIds: ["email-address", "credit-card-number"],
    dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
    exposure: DataStoreExposure.Public,
    posture: {
      readAt: ago(2 * HOUR).toISOString(),
      publicRead: true,
      publicReason: 'The bucket policy grants s3:GetObject to Principal "*".',
      blockPublicAccess: false,
      encryptedAtRest: true,
      customerManagedKey: false,
      encryptionInTransitEnforced: false,
      versioning: true,
      accessLogging: false,
    },
    sizeInBytes: 48 * 1024 * 1024 * 1024,
    objectCount: 182340,
    estimatedRecords: 2400000,
    isPublicByDesign: false,
    isAiData: false,
    isContentScanEnabled: true,
    configurationReadAt: ago(2 * HOUR),
    contentScannedAt: ago(5 * HOUR),
    contentScanStatus: "Succeeded",
    findingCount: 2,
    openIssueCount: 3,
    highestIssueSeverity: SecuritySeverity.Critical,
    riskScore: 92,
    isArchived: false,
    firstSeenAt: ago(21 * DAY),
    lastSeenAt: ago(15 * MINUTE),
  },
  {
    _id: ID.store(2),
    projectId,
    name: "orders-db",
    description: "The checkout service's PostgreSQL database.",
    kind: DataStoreKind.AwsRdsInstance,
    provider: "aws",
    family: "Database",
    discoveredFrom: "Cloud inventory",
    cloudConnectionId: new ObjectID(ID.connection(1)),
    providerResourceId: "arn:aws:rds:eu-west-1:123456789012:db:orders-db",
    cloudAccountNumber: "123456789012",
    region: "eu-west-1",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Confidential,
    dataTypeIds: ["email-address"],
    dataCategories: [DataCategory.ContactAndIdentity],
    exposure: DataStoreExposure.Private,
    posture: {
      readAt: ago(2 * HOUR).toISOString(),
      publicNetworkAccess: false,
      encryptedAtRest: false,
      backupsEnabled: true,
      backupRetentionDays: 7,
      deletionProtection: false,
    },
    estimatedRecords: 640000,
    isPublicByDesign: false,
    isAiData: false,
    isContentScanEnabled: true,
    configurationReadAt: ago(2 * HOUR),
    contentScanStatus: "Skipped",
    findingCount: 1,
    openIssueCount: 1,
    highestIssueSeverity: SecuritySeverity.High,
    riskScore: 61,
    isArchived: false,
    firstSeenAt: ago(21 * DAY),
    lastSeenAt: ago(15 * MINUTE),
  },
  {
    _id: ID.store(3),
    projectId,
    name: "analytics",
    description: "",
    kind: DataStoreKind.GcpBigQueryDataset,
    provider: "gcp",
    family: "Warehouse",
    discoveredFrom: "Cloud inventory",
    providerResourceId: "projects/acme-analytics/datasets/analytics",
    region: "europe-west1",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Internal,
    dataTypeIds: [],
    dataCategories: [],
    exposure: DataStoreExposure.Private,
    posture: { readAt: ago(3 * HOUR).toISOString(), encryptedAtRest: true },
    isPublicByDesign: false,
    isAiData: false,
    isContentScanEnabled: true,
    configurationReadAt: ago(3 * HOUR),
    contentScannedAt: ago(6 * HOUR),
    contentScanStatus: "Succeeded",
    findingCount: 0,
    openIssueCount: 0,
    riskScore: 0,
    isArchived: false,
    firstSeenAt: ago(14 * DAY),
    lastSeenAt: ago(15 * MINUTE),
  },
  {
    _id: ID.store(4),
    projectId,
    name: "checkout · Logs",
    description: "",
    kind: DataStoreKind.TelemetryLogs,
    provider: "oneuptime",
    family: "Telemetry",
    discoveredFrom: "Telemetry",
    region: "",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Confidential,
    dataTypeIds: ["email-address"],
    dataCategories: [DataCategory.ContactAndIdentity],
    exposure: DataStoreExposure.Private,
    posture: {},
    isPublicByDesign: false,
    isAiData: false,
    isContentScanEnabled: true,
    contentScannedAt: ago(40 * MINUTE),
    contentScanStatus: "Succeeded",
    findingCount: 1,
    openIssueCount: 1,
    highestIssueSeverity: SecuritySeverity.Medium,
    riskScore: 38,
    isArchived: false,
    firstSeenAt: ago(9 * DAY),
    lastSeenAt: ago(40 * MINUTE),
  },
];
table(DataStore).push(...STORES);

function storeById(id) {
  return table(DataStore).find((store) => {
    return store._id === String(id);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Issues
 * ---------------------------------------------------------------------------
 */
function issue(number, data) {
  const store = storeById(data.dataStoreId);
  // A check the catalog has, titled and grouped as the server writes it.
  const check = getDataSecurityCheck(data.checkId);
  if (!check) {
    throw new Error(
      `The fixture names a check the catalog has not: ${data.checkId}`,
    );
  }
  const risk = getRiskScore({
    severity: data.severity,
    exposure: store.exposure,
    estimatedRecords: store.estimatedRecords,
    isProduction: store.environment === DataStoreEnvironment.Production,
  });
  return {
    _id: ID.issue(number),
    projectId,
    issueKey: `${data.checkId}:${data.dataStoreId}`,
    checkGroup: check.group,
    title: check.title,
    status: DataSecurityIssueStatus.Open,
    riskScore: risk.score,
    riskFactors: risk.factors,
    reopenCount: 0,
    frameworks: [],
    ...data,
    dataStoreId: new ObjectID(data.dataStoreId),
  };
}

table(DataSecurityIssue).push(
  issue(1, {
    dataStoreId: ID.store(1),
    checkId: "public-read",
    evidence:
      'The bucket policy grants s3:GetObject to Principal "*", and it holds Restricted data.',
    severity: SecuritySeverity.Critical,
    dataTypeIds: ["credit-card-number", "email-address"],
    firstDetectedAt: ago(3 * DAY),
    lastDetectedAt: ago(2 * HOUR),
    // What the project's settings started for it: a case, an alert, an incident.
    securityCaseId: new ObjectID(ID.securityCase(1)),
    alertId: new ObjectID(ID.alert(1)),
    incidentId: new ObjectID(ID.incident(1)),
  }),
  issue(2, {
    dataStoreId: ID.store(2),
    checkId: "not-encrypted-at-rest",
    evidence: "StorageEncrypted is false on the RDS instance.",
    severity: SecuritySeverity.High,
    dataTypeIds: ["email-address"],
    firstDetectedAt: ago(10 * DAY),
    lastDetectedAt: ago(2 * HOUR),
  }),
  issue(3, {
    dataStoreId: ID.store(4),
    checkId: "sensitive-data-in-telemetry",
    evidence:
      "37 log records in the last hour hold an email address in attributes.user.email.",
    severity: SecuritySeverity.Medium,
    dataTypeIds: ["email-address"],
    firstDetectedAt: ago(2 * DAY),
    lastDetectedAt: ago(40 * MINUTE),
  }),
  issue(4, {
    dataStoreId: ID.store(1),
    checkId: "access-not-logged",
    evidence: "Server access logging is off.",
    severity: SecuritySeverity.Medium,
    dataTypeIds: [],
    firstDetectedAt: ago(3 * DAY),
    lastDetectedAt: ago(2 * HOUR),
  }),
  issue(5, {
    dataStoreId: ID.store(1),
    checkId: "encryption-in-transit-not-enforced",
    evidence: "The bucket policy does not deny aws:SecureTransport false.",
    severity: SecuritySeverity.Low,
    dataTypeIds: [],
    status: DataSecurityIssueStatus.Accepted,
    acceptedReason: "Only served through CloudFront, which enforces HTTPS.",
    acceptedUntil: new Date(NOW.getTime() + 60 * DAY),
    acceptedByUserId: new ObjectID(ID.user(2)),
    firstDetectedAt: ago(3 * DAY),
    lastDetectedAt: ago(2 * HOUR),
  }),
);

/*
 * ---------------------------------------------------------------------------
 * Findings, access, scans and flows
 * ---------------------------------------------------------------------------
 */
table(DataStoreFinding).push(
  {
    _id: ID.finding(1),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    findingKey: "credit-card-number:exports/orders-2026-10-26.csv:card_number",
    dataTypeId: "credit-card-number",
    dataTypeName: "Card number",
    dataCategory: DataCategory.Financial,
    sensitivity: DataSensitivity.Restricted,
    location: "exports/orders-2026-10-26.csv · card_number",
    locationKind: "Column",
    confidence: "High",
    matchCount: 412,
    valueCount: 500,
    matchPercent: 82,
    distinctValues: 409,
    testValueCount: 0,
    maskedSamples: [
      "4111 **** **** 1111",
      "5500 **** **** 0004",
      "3400 ****** *0009",
    ],
    isFreeText: false,
    isNameHinted: true,
    isFoundByName: false,
    isScrubbed: false,
    isSuppressed: false,
    firstSeenAt: ago(3 * DAY),
    lastSeenAt: ago(5 * HOUR),
  },
  {
    _id: ID.finding(2),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    findingKey: "email-address:exports/orders-2026-10-26.csv:email",
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    dataCategory: DataCategory.ContactAndIdentity,
    sensitivity: DataSensitivity.Confidential,
    location: "exports/orders-2026-10-26.csv · email",
    locationKind: "Column",
    confidence: "High",
    matchCount: 498,
    valueCount: 500,
    matchPercent: 99,
    distinctValues: 471,
    testValueCount: 0,
    maskedSamples: ["j***@e******.com", "m***@a*******.example"],
    isFreeText: false,
    isNameHinted: true,
    isFoundByName: false,
    isScrubbed: false,
    isSuppressed: false,
    firstSeenAt: ago(3 * DAY),
    lastSeenAt: ago(5 * HOUR),
  },
  {
    _id: ID.finding(3),
    projectId,
    dataStoreId: new ObjectID(ID.store(4)),
    findingKey: "email-address:attributes.user.email",
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    dataCategory: DataCategory.ContactAndIdentity,
    sensitivity: DataSensitivity.Confidential,
    location: "attributes.user.email",
    locationKind: "Attribute",
    confidence: "High",
    matchCount: 37,
    valueCount: 37,
    matchPercent: 100,
    distinctValues: 12,
    testValueCount: 0,
    maskedSamples: ["k***@a*************.example"],
    isFreeText: false,
    isNameHinted: true,
    isFoundByName: false,
    isScrubbed: false,
    isSuppressed: false,
    firstSeenAt: ago(2 * DAY),
    lastSeenAt: ago(40 * MINUTE),
  },
);

table(DataStoreAccess).push(
  {
    _id: ID.access(1),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    accessKey: "public:read",
    principal: "*",
    principalName: "Everyone",
    principalType: DataStorePrincipalType.Public,
    accessLevel: DataStoreAccessLevel.Read,
    grantedVia: "Bucket policy",
    isExternal: true,
    isPublic: true,
    isSeenInTraces: false,
    firstSeenAt: ago(3 * DAY),
    lastSeenAt: ago(2 * HOUR),
  },
  {
    _id: ID.access(2),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    accessKey: "role:finance-exporter:write",
    principal: "arn:aws:iam::123456789012:role/finance-exporter",
    principalName: "finance-exporter",
    principalType: DataStorePrincipalType.Role,
    accessLevel: DataStoreAccessLevel.Write,
    grantedVia: "Bucket policy",
    isExternal: false,
    isPublic: false,
    isSeenInTraces: false,
    lastUsedAt: ago(9 * HOUR),
    firstSeenAt: ago(21 * DAY),
    lastSeenAt: ago(2 * HOUR),
  },
);

table(DataSecurityScan).push(
  {
    _id: ID.scan(1),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    kind: "Content",
    status: "Succeeded",
    startedAt: ago(5 * HOUR + 3 * MINUTE),
    finishedAt: ago(5 * HOUR),
    durationInMs: 3 * MINUTE,
    objectsRead: 24,
    bytesRead: 6 * 1024 * 1024,
    findingsFound: 2,
    // What it read, by name, and what it could not: folded under its row.
    readLog: [
      "exports/orders-2026-10-26.csv",
      "exports/orders-2026-10-25.csv",
      "exports/refunds-2026-10.csv",
    ],
    warnings: [
      "exports/archive-2025.zip is larger than the 50 MB a sample reads, so it was skipped.",
    ],
  },
  {
    _id: ID.scan(2),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    cloudConnectionId: new ObjectID(ID.connection(1)),
    kind: "Configuration",
    status: "Succeeded",
    startedAt: ago(2 * HOUR + MINUTE),
    finishedAt: ago(2 * HOUR),
    durationInMs: MINUTE,
    storesRead: 2,
    findingsFound: 0,
  },
);

table(DataSecurityFlow).push({
  _id: ID.flow(1),
  projectId,
  flowKey: `copy:${ID.store(2)}:${ID.store(1)}`,
  kind: "Copy",
  sourceDataStoreId: new ObjectID(ID.store(2)),
  destinationDataStoreId: new ObjectID(ID.store(1)),
  destination: "customer-exports",
  dataTypeIds: ["email-address"],
  sensitivity: DataSensitivity.Confidential,
  isConfirmed: true,
  overlapPercent: 64,
  firstSeenAt: ago(9 * DAY),
  lastSeenAt: ago(5 * HOUR),
});

table(DataStoreOwnerUser).push({
  _id: ID.owner(1),
  projectId,
  dataStoreId: new ObjectID(ID.store(1)),
  userId: new ObjectID(ID.user(2)),
  user: people.diego,
});
table(DataStoreOwnerTeam);
table(DataStoreOwnerRule).push({
  _id: uuid("c1000000", 1),
  projectId,
  name: "Payments team owns payment stores",
  description: "Every store tagged team=payments goes to the payments team.",
  cloudTagPattern: "^team=payments$",
  isEnabled: true,
  notifyOwners: true,
});
table(DataStoreLabelRule);
// The project's members: an owner shown as a member, never as someone who left.
table(TeamMember).push(
  ...Object.values(people).map((person, index) => {
    return {
      _id: uuid("c2000000", index + 1),
      projectId,
      userId: new ObjectID(person._id),
      user: person,
      hasAcceptedInvitation: true,
    };
  }),
);
table(DataSecurityCheckSetting);
// Add Data Store's Scan From Probe picker: the project has no probe of its own.
table(Probe);
table(DataSecurityCustomDataType);
table(DataSecurityResidencyRule);
table(CodeRepository);
// The label filters of the store lists: the project has no labels.
table(Label);

// What Settings > Scan Settings offers under Raise alerts and Declare incidents.
table(AlertSeverity).push(
  {
    _id: uuid("e1000000", 1),
    projectId,
    name: "Critical",
    order: 1,
    isArchived: false,
  },
  {
    _id: uuid("e1000000", 2),
    projectId,
    name: "Major",
    order: 2,
    isArchived: false,
  },
);
table(IncidentSeverity).push(
  {
    _id: uuid("f1000000", 1),
    projectId,
    name: "SEV1",
    order: 1,
    isArchived: false,
  },
  {
    _id: uuid("f1000000", 2),
    projectId,
    name: "SEV2",
    order: 2,
    isArchived: false,
  },
);

table(DataSecuritySetting).push({
  _id: ID.setting(1),
  projectId,
  isConfigurationScanEnabled: true,
  isContentScanEnabled: true,
  isTelemetryScanEnabled: true,
  keepMaskedSamples: true,
  openCasesForCriticalIssues: true,
  raiseAlertsForCriticalIssues: true,
  declareIncidentsForCriticalIssues: true,
  notifyOwners: true,
  contentScanIntervalInHours: 24,
});

/*
 * ---------------------------------------------------------------------------
 * Timelines
 * ---------------------------------------------------------------------------
 */
const STORE_LINK = `[Data Store customer-exports](https://oneuptime.acme-commerce.example/dashboard/${PROJECT_ID}/data-security/stores/${ID.store(1)})`;

table(DataStoreFeed).push(
  {
    _id: ID.feed(1),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    dataStoreFeedEventType: DataStoreFeedEventType.DataStoreCreated,
    displayColor: Blue500,
    feedInfoInMarkdown: `${STORE_LINK} was discovered by Data Security.`,
    postedAt: ago(21 * DAY),
  },
  {
    _id: ID.feed(2),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    dataStoreFeedEventType: DataStoreFeedEventType.OwnerUserAdded,
    displayColor: Blue500,
    feedInfoInMarkdown: `**Diego Alvarez** was added as an owner of ${STORE_LINK}.`,
    postedAt: ago(20 * DAY),
    user: people.maya,
    userId: new ObjectID(ID.user(1)),
  },
  {
    _id: ID.feed(3),
    projectId,
    dataStoreId: new ObjectID(ID.store(1)),
    dataStoreFeedEventType: DataStoreFeedEventType.DataStoreUpdated,
    displayColor: Gray500,
    feedInfoInMarkdown: `📝 ${STORE_LINK} was updated by **Maya Chen**.`,
    moreInformationInMarkdown:
      "**Environment**: Production\n\n**Public By Design**: Off",
    postedAt: ago(4 * DAY),
    user: people.maya,
    userId: new ObjectID(ID.user(1)),
  },
);

table(DataSecurityIssueFeed).push(
  {
    _id: ID.feed(11),
    projectId,
    dataSecurityIssueId: new ObjectID(ID.issue(1)),
    dataSecurityIssueFeedEventType: DataSecurityIssueFeedEventType.IssueOpened,
    displayColor: Red500,
    feedInfoInMarkdown:
      "The check **public-read** failed on this store for the first time: anyone on the internet can read it.",
    postedAt: ago(3 * DAY),
  },
  {
    _id: ID.feed(12),
    projectId,
    dataSecurityIssueId: new ObjectID(ID.issue(1)),
    dataSecurityIssueFeedEventType:
      DataSecurityIssueFeedEventType.SecurityCaseOpened,
    displayColor: Yellow500,
    feedInfoInMarkdown: "A security case was opened for this issue.",
    postedAt: ago(3 * DAY - MINUTE),
  },
  {
    _id: ID.feed(13),
    projectId,
    dataSecurityIssueId: new ObjectID(ID.issue(1)),
    dataSecurityIssueFeedEventType:
      DataSecurityIssueFeedEventType.AiExplanation,
    displayColor: Purple500,
    feedInfoInMarkdown: "OneUptime AI explained this issue.",
    moreInformationInMarkdown:
      "Turn on all four **Block Public Access** settings of the bucket, then remove the policy statement that grants `s3:GetObject` to `*`.",
    postedAt: ago(2 * DAY),
    user: people.maya,
    userId: new ObjectID(ID.user(1)),
  },
);

/*
 * ---------------------------------------------------------------------------
 * The other data sets: a busy project, and a new one
 * ---------------------------------------------------------------------------
 */

// ?data=busy: stores with long names, as real accounts name them.
const BUSY_STORES = [
  [
    "prod-eu-west-1-customer-analytics-events-archive-2026",
    DataStoreKind.AwsS3Bucket,
    "aws",
    "eu-west-1",
  ],
  [
    "billing-invoices-pdf-exports-for-the-finance-team",
    DataStoreKind.AwsS3Bucket,
    "aws",
    "us-east-1",
  ],
  [
    "hr-employee-records-nightly-backups",
    DataStoreKind.AzureStorageAccount,
    "azure",
    "westeurope",
  ],
  [
    "payments-ledger-primary",
    DataStoreKind.AwsRdsInstance,
    "aws",
    "eu-central-1",
  ],
  [
    "payments-ledger-replica-for-reporting",
    DataStoreKind.AwsRdsInstance,
    "aws",
    "eu-central-1",
  ],
  [
    "support-ticket-attachments",
    DataStoreKind.GcpStorageBucket,
    "gcp",
    "europe-west4",
  ],
  [
    "marketing-campaign-audiences-lookalike-segments",
    DataStoreKind.GcpBigQueryDataset,
    "gcp",
    "us-central1",
  ],
  [
    "identity-service-users",
    DataStoreKind.AwsDynamoDbTable,
    "aws",
    "us-west-2",
  ],
  [
    "orders-db-snapshot-2026-10-01",
    DataStoreKind.AwsRdsSnapshot,
    "aws",
    "eu-west-1",
  ],
  ["data-lake-raw-clickstream", DataStoreKind.AwsS3Bucket, "aws", "eu-west-1"],
  ["claims-processing", DataStoreKind.AzureSqlDatabase, "azure", "northeurope"],
  [
    "patient-portal-uploads",
    DataStoreKind.AzureStorageAccount,
    "azure",
    "northeurope",
  ],
  [
    "analytics-staging",
    DataStoreKind.GcpBigQueryDataset,
    "gcp",
    "europe-west1",
  ],
  [
    "mobile-app-crash-reports",
    DataStoreKind.GcpStorageBucket,
    "gcp",
    "us-east1",
  ],
  ["kyc-document-scans", DataStoreKind.AwsS3Bucket, "aws", "ap-south-1"],
  [
    "loyalty-program-members",
    DataStoreKind.AzurePostgreSqlServer,
    "azure",
    "centralindia",
  ],
  [
    "legacy-crm-export-do-not-use",
    DataStoreKind.AwsS3Bucket,
    "aws",
    "us-east-1",
  ],
  [
    "search-index-source-documents",
    DataStoreKind.AwsS3Bucket,
    "aws",
    "eu-west-2",
  ],
  [
    "warehouse-finance-reporting",
    DataStoreKind.GcpBigQueryDataset,
    "gcp",
    "europe-west3",
  ],
  [
    "dev-copy-of-production-users",
    DataStoreKind.PostgreSql,
    "self-managed",
    "",
  ],
  ["vendor-shared-exports", DataStoreKind.AwsS3Bucket, "aws", "eu-west-1"],
  [
    "call-center-recordings-metadata",
    DataStoreKind.AwsDynamoDbTable,
    "aws",
    "eu-west-1",
  ],
  [
    "fraud-model-training-features",
    DataStoreKind.AwsS3Bucket,
    "aws",
    "us-east-2",
  ],
  ["gift-card-balances", DataStoreKind.AwsRdsInstance, "aws", "us-east-2"],
  ["tax-forms-archive", DataStoreKind.AzureStorageAccount, "azure", "eastus"],
  ["newsletter-subscribers", DataStoreKind.PostgreSql, "self-managed", ""],
];

const BUSY_CHECKS = [
  ["public-read", SecuritySeverity.Critical],
  ["not-encrypted-at-rest", SecuritySeverity.High],
  ["access-not-logged", SecuritySeverity.Medium],
  ["no-backups", SecuritySeverity.High],
  ["no-owner", SecuritySeverity.Medium],
  ["shared-with-external-accounts", SecuritySeverity.High],
  ["deletion-protection-off", SecuritySeverity.Low],
  ["secrets-stored", SecuritySeverity.Critical],
];

const SENSITIVITY_CYCLE = [
  DataSensitivity.Restricted,
  DataSensitivity.Confidential,
  DataSensitivity.Confidential,
  DataSensitivity.Internal,
];

const EXPOSURE_CYCLE = [
  DataStoreExposure.Public,
  DataStoreExposure.Private,
  DataStoreExposure.OtherAccounts,
  DataStoreExposure.Private,
  DataStoreExposure.InternetReachable,
];

function addBusyData() {
  BUSY_STORES.forEach(([name, kind, provider, region], index) => {
    const number = 10 + index;
    const sensitivity = SENSITIVITY_CYCLE[index % SENSITIVITY_CYCLE.length];
    table(DataStore).push({
      _id: ID.store(number),
      projectId,
      name,
      description: "",
      kind,
      provider,
      discoveredFrom:
        provider === "self-managed" ? "Manual" : "Cloud inventory",
      providerResourceId: `${provider}:${name}`,
      region,
      environment:
        name.startsWith("dev-") || name.includes("staging")
          ? DataStoreEnvironment.Development
          : DataStoreEnvironment.Production,
      sensitivity,
      dataTypeIds:
        sensitivity === DataSensitivity.Internal
          ? []
          : index % 3 === 0
            ? ["credit-card-number", "email-address"]
            : ["email-address"],
      dataCategories:
        sensitivity === DataSensitivity.Internal
          ? []
          : index % 3 === 0
            ? [DataCategory.ContactAndIdentity, DataCategory.Financial]
            : [DataCategory.ContactAndIdentity],
      exposure: EXPOSURE_CYCLE[index % EXPOSURE_CYCLE.length],
      posture: { readAt: ago(3 * HOUR).toISOString(), encryptedAtRest: true },
      estimatedRecords: (index + 1) * 120000,
      isPublicByDesign: false,
      isAiData: false,
      isContentScanEnabled: true,
      configurationReadAt: ago(3 * HOUR),
      contentScannedAt: index % 4 === 3 ? undefined : ago(7 * HOUR),
      contentScanStatus: index % 4 === 3 ? "Skipped" : "Succeeded",
      findingCount: index % 5,
      isArchived: false,
      firstSeenAt: ago((20 + index) * DAY),
      lastSeenAt: ago(20 * MINUTE),
    });

    // An open issue on every store, and a second on every third one.
    const checks =
      index % 3 === 0
        ? [
            BUSY_CHECKS[index % BUSY_CHECKS.length],
            BUSY_CHECKS[(index + 3) % BUSY_CHECKS.length],
          ]
        : [BUSY_CHECKS[index % BUSY_CHECKS.length]];

    checks.forEach(([checkId, severity], checkIndex) => {
      table(DataSecurityIssue).push(
        issue(100 + index * 2 + checkIndex, {
          dataStoreId: ID.store(number),
          checkId,
          evidence: `What the check saw on ${name}.`,
          severity,
          dataTypeIds: [],
          firstDetectedAt: ago((1 + (index % 9)) * DAY),
          lastDetectedAt: ago(3 * HOUR),
        }),
      );
    });
  });
}

// ?data=empty: a new project, with no cloud connection and nothing found.
function emptyData() {
  for (const modelType of [
    CloudConnection,
    DataStore,
    DataSecurityIssue,
    DataStoreFinding,
    DataStoreAccess,
    DataSecurityScan,
    DataSecurityFlow,
    DataStoreOwnerUser,
    DataStoreOwnerRule,
    DataStoreFeed,
    DataSecurityIssueFeed,
  ]) {
    table(modelType).length = 0;
  }
}

if (dataSet === "busy") {
  addBusyData();
}

if (dataSet === "empty") {
  emptyData();
}

/*
 * Each store's open issues, their count, worst severity and highest risk, as
 * the evaluator keeps them on the store: an accepted issue does not count.
 */
for (const store of table(DataStore)) {
  const open = table(DataSecurityIssue).filter((row) => {
    return (
      String(row.dataStoreId) === store._id &&
      row.status === DataSecurityIssueStatus.Open
    );
  });
  store.openIssueCount = open.length;
  store.highestIssueSeverity = open.reduce((worst, row) => {
    return moreSevere(worst, row.severity);
  }, null);
  store.riskScore = open.reduce((highest, row) => {
    return Math.max(highest, row.riskScore);
  }, 0);
}

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
function failedRead() {
  return new HTTPErrorResponse(
    500,
    { message: "OneUptime could not be reached. Try again in a minute." },
    {},
  );
}

function comparable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "object" && typeof value.toString === "function") {
    const text = value.toString();
    if (text !== "[object Object]") {
      return text;
    }
  }
  return value;
}

function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || key === "projectId") {
      continue;
    }
    const actual = record[key];
    if (condition instanceof Includes) {
      const values = (condition.values || []).map((value) => {
        return String(comparable(value));
      });
      if (!values.includes(String(comparable(actual)))) {
        return false;
      }
      continue;
    }
    if (condition instanceof IsNull) {
      if (actual !== null && actual !== undefined) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotNull) {
      if (actual === null || actual === undefined) {
        return false;
      }
      continue;
    }
    if (condition instanceof NotEqual) {
      if (String(comparable(actual)) === String(comparable(condition.value))) {
        return false;
      }
      continue;
    }
    if (condition instanceof Search) {
      if (
        !String(actual || "")
          .toLowerCase()
          .includes(String(condition.value || "").toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (
      condition === null ||
      typeof condition !== "object" ||
      condition instanceof ObjectID ||
      typeof condition.toString === "function"
    ) {
      const expected = comparable(condition);
      if (
        typeof expected !== "object" &&
        String(comparable(actual)) !== String(expected)
      ) {
        return false;
      }
    }
  }
  return true;
}

function sortRecords(records, sort) {
  const entries = Object.entries(sort || {});
  if (entries.length === 0) {
    return records;
  }
  return [...records].sort((left, right) => {
    for (const [key, order] of entries) {
      const a = comparable(left[key]);
      const b = comparable(right[key]);
      if (a === b) {
        continue;
      }
      const direction = order === SortOrder.Descending ? -1 : 1;
      if (a === undefined || a === null) {
        return direction;
      }
      if (b === undefined || b === null) {
        return -direction;
      }
      return a > b ? direction : -direction;
    }
    return 0;
  });
}

// The relations the pages select through a record, joined at read time.
function withRelations(modelName, record) {
  if (
    record.dataStoreId &&
    (modelName === tableName(DataSecurityIssue) ||
      modelName === tableName(DataStoreFinding) ||
      modelName === tableName(DataStoreAccess) ||
      modelName === tableName(DataSecurityScan))
  ) {
    const store = storeById(record.dataStoreId);
    const joined = {
      ...record,
      dataStore: store ? make(DataStore, store) : undefined,
    };
    if (modelName === tableName(DataSecurityIssue) && record.acceptedByUserId) {
      joined.acceptedByUser = Object.values(people).find((person) => {
        return person._id === String(record.acceptedByUserId);
      });
    }
    return joined;
  }
  if (modelName === tableName(DataSecurityFlow)) {
    const source = record.sourceDataStoreId
      ? storeById(record.sourceDataStoreId)
      : undefined;
    const destination = record.destinationDataStoreId
      ? storeById(record.destinationDataStoreId)
      : undefined;
    return {
      ...record,
      sourceDataStore: source ? make(DataStore, source) : undefined,
      destinationDataStore: destination
        ? make(DataStore, destination)
        : undefined,
    };
  }
  if (modelName === tableName(DataStore) && record.cloudConnectionId) {
    const connection = table(CloudConnection).find((row) => {
      return row._id === String(record.cloudConnectionId);
    });
    return {
      ...record,
      cloudConnection: connection
        ? make(CloudConnection, connection)
        : undefined,
    };
  }
  return record;
}

function knownTable(modelType, kind, extra) {
  const name = tableName(modelType);
  if (!tables.has(name)) {
    fixture.unhandled.push({ kind, modelName: name, ...extra });
    return null;
  }
  return tables.get(name);
}

// A person's picture: their initials on a colour, drawn here, never fetched.
const AVATAR_COLOURS = ["#6366f1", "#0ea5e9", "#10b981"];

UserUtil.getProfilePictureRoute = (userId) => {
  const user = Object.values(people).find((item) => {
    return item._id === String(userId);
  });
  const initials = (user ? user.name.toString() : "?")
    .split(" ")
    .map((part) => {
      return part[0] || "";
    })
    .join("")
    .slice(0, 2);
  const colour =
    AVATAR_COLOURS[
      (user ? Object.values(people).indexOf(user) : 0) % AVATAR_COLOURS.length
    ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${colour}"/><text x="32" y="41" font-family="Inter,Arial,sans-serif" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return {
    toString: () => {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    },
  };
};

UserUtil.isMasterAdmin = () => false;
UserUtil.getUserId = () => new ObjectID(people.maya._id);
UserUtil.getName = () => people.maya.name;
UserUtil.getEmail = () => people.maya.email;
PermissionUtil.getAllPermissions = () => [...rolePermissions];
ProjectUtil.getCurrentProjectId = () => new ObjectID(PROJECT_ID);
ProjectUtil.getCurrentProject = () => project;
ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });

Realtime.listenToModelEvent = () => {
  return () => {};
};
Realtime.listenToAnalyticsModelEvent = () => {
  return () => {};
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = options.id?.toString();
  fixture.getItemRequests.push({ modelName, id });
  if (isFailing) {
    throw failedRead();
  }
  const known = knownTable(options.modelType, "getItem", { id });
  const record = known?.records.find((item) => {
    return String(item._id) === id;
  });
  return record
    ? make(options.modelType, withRelations(modelName, record))
    : null;
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    sort: serialize(options.sort),
    skip,
    limit,
  });
  if (isFailing) {
    throw failedRead();
  }
  const known = knownTable(options.modelType, "getList", {
    query: serialize(options.query),
  });
  const records = sortRecords(
    (known?.records || []).filter((record) => {
      return matches(record, options.query);
    }),
    options.sort,
  );
  return {
    data: records.slice(skip, skip + limit).map((record) => {
      return make(options.modelType, withRelations(modelName, record));
    }),
    count: records.length,
    skip,
    limit,
  };
};

async function countOf(options) {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });
  if (isFailing) {
    throw failedRead();
  }
  const known = knownTable(options.modelType, "count", {
    query: serialize(options.query),
  });
  return (known?.records || []).filter((record) => {
    return matches(record, options.query);
  }).length;
}

ModelAPI.count = countOf;
ModelAPI.getCount = countOf;

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.updates.push({
    modelName,
    id: String(options.id),
    data: serialize(options.data),
  });
  const known = knownTable(options.modelType, "updateById", {
    id: String(options.id),
  });
  const record = known?.records.find((item) => {
    return String(item._id) === String(options.id);
  });
  if (record) {
    Object.assign(record, options.data);
  }
  return new HTTPResponse(200, {}, {});
};

ModelAPI.create = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.creates.push({ modelName, data: serialize(options.model) });
  fixture.unhandled.push({ kind: "create", modelName });
  return new HTTPResponse(200, { _id: uuid("f0000000", 1) }, {});
};

/*
 * Data Security's own routes (Server/API/DataSecurityAPI.ts): the
 * Overview's figures, worked out from the tables above, and the response
 * actions of the bucket.
 */
function overview() {
  const stores = table(DataStore).filter((store) => {
    return !store.isArchived;
  });
  const openIssues = table(DataSecurityIssue).filter((row) => {
    return row.status === DataSecurityIssueStatus.Open;
  });
  const bySensitivity = {
    [DataSensitivity.Restricted]: 0,
    [DataSensitivity.Confidential]: 0,
    [DataSensitivity.Internal]: 0,
    [DataSensitivity.Public]: 0,
  };
  for (const store of stores) {
    bySensitivity[store.sensitivity] =
      (bySensitivity[store.sensitivity] || 0) + 1;
  }
  const bySeverity = {
    [SecuritySeverity.Critical]: 0,
    [SecuritySeverity.High]: 0,
    [SecuritySeverity.Medium]: 0,
    [SecuritySeverity.Low]: 0,
  };
  for (const row of openIssues) {
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
  }
  const trend = [];
  for (let day = 29; day >= 0; day--) {
    const date = new Date(NOW.getTime() - day * DAY);
    const opened = table(DataSecurityIssue).filter((row) => {
      return (
        Math.floor((NOW.getTime() - row.firstDetectedAt.getTime()) / DAY) ===
        day
      );
    }).length;
    trend.push({
      day: date.toISOString().slice(0, 10),
      opened,
      resolved: stores.length === 0 ? 0 : day === 6 ? 2 : day === 1 ? 1 : 0,
    });
  }
  const byCategory = new Map();
  for (const store of stores) {
    for (const category of store.dataCategories || []) {
      byCategory.set(category, (byCategory.get(category) || 0) + 1);
    }
  }
  const telemetryStoreIds = new Set(
    stores
      .filter((store) => {
        return store.provider === "oneuptime";
      })
      .map((store) => {
        return store._id;
      }),
  );
  const telemetryFindings = table(DataStoreFinding).filter((row) => {
    return telemetryStoreIds.has(String(row.dataStoreId));
  });
  return {
    storeCount: stores.length,
    evaluatedStoreCount: stores.filter((store) => {
      return Boolean(store.configurationReadAt || store.contentScannedAt);
    }).length,
    contentScannedStoreCount: stores.filter((store) => {
      return Boolean(store.contentScannedAt);
    }).length,
    storesBySensitivity: bySensitivity,
    storesByCategory: [...byCategory.entries()].map(
      ([category, storeCount]) => {
        return { category, storeCount };
      },
    ),
    exposedSensitiveStoreCount: stores.filter((store) => {
      return (
        [DataSensitivity.Restricted, DataSensitivity.Confidential].includes(
          store.sensitivity,
        ) &&
        [DataStoreExposure.Public, DataStoreExposure.OtherAccounts].includes(
          store.exposure,
        )
      );
    }).length,
    openIssuesBySeverity: bySeverity,
    topIssues: [...openIssues]
      .sort((a, b) => {
        return b.riskScore - a.riskScore;
      })
      .slice(0, 5)
      .map((row) => {
        return {
          issueId: row._id,
          title: row.title,
          severity: row.severity,
          riskScore: row.riskScore,
          checkId: row.checkId,
          dataStoreId: String(row.dataStoreId),
          dataStoreName: storeById(row.dataStoreId).name,
        };
      }),
    issueTrend: trend,
    telemetryFindingCount: telemetryFindings.length,
    unscrubbedTelemetryFindingCount: telemetryFindings.filter((row) => {
      return !row.isScrubbed;
    }).length,
    connectionsWithoutContentAccess: 0,
    hasCloudConnection: table(CloudConnection).length > 0,
  };
}

/*
 * Compliance, scored as the server scores it (DataSecurityAPI.getCompliance):
 * every framework, from the stores and their open issues.
 */
function compliance() {
  const stores = table(DataStore)
    .filter((store) => {
      return !store.isArchived;
    })
    .map((store) => {
      return {
        id: store._id,
        dataTypeIds: store.dataTypeIds || [],
        subjectCountries: store.subjectCountries || [],
        isEvaluated: Boolean(
          store.configurationReadAt || store.contentScannedAt,
        ),
      };
    });
  const openIssues = table(DataSecurityIssue)
    .filter((row) => {
      return row.status === DataSecurityIssueStatus.Open;
    })
    .map((row) => {
      return { storeId: String(row.dataStoreId), checkId: row.checkId };
    });
  return {
    frameworks: ALL_COMPLIANCE_FRAMEWORKS.map((framework) => {
      return {
        ...scoreComplianceFramework(framework, stores, openIssues),
        fullName: COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
        scope: COMPLIANCE_FRAMEWORK_INFO[framework].scope,
      };
    }),
  };
}

function responseActions(dataStoreId) {
  const store = storeById(dataStoreId);
  if (!store || store.kind !== DataStoreKind.AwsS3Bucket) {
    return { actions: [] };
  }
  return {
    actions: [
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: isResponseOn,
        unavailableReason: isResponseOn
          ? undefined
          : DataSecurityResponseUnavailableReason.ResponseOff,
      },
    ],
    cloudConnectionId: isResponseOn ? undefined : ID.connection(1),
  };
}

function respond(dataStoreId, body) {
  const store = storeById(dataStoreId);
  const summary = `Turned on all four Block Public Access settings of ${store.name}.`;
  store.exposure = DataStoreExposure.Private;
  store.posture = {
    ...store.posture,
    publicRead: false,
    blockPublicAccess: true,
  };
  const next = table(DataStoreFeed).length + 1;
  table(DataStoreFeed).push({
    _id: ID.feed(100 + next),
    projectId,
    dataStoreId: new ObjectID(store._id),
    dataStoreFeedEventType: DataStoreFeedEventType.ResponseActionTaken,
    displayColor: Green500,
    feedInfoInMarkdown: `**${body.action}**, through the store's cloud connection: ${summary} The store is being checked again.`,
    postedAt: new Date(),
    user: people.maya,
    userId: new ObjectID(ID.user(1)),
  });
  if (body.dataSecurityIssueId) {
    table(DataSecurityIssueFeed).push({
      _id: ID.feed(200 + next),
      projectId,
      dataSecurityIssueId: new ObjectID(body.dataSecurityIssueId),
      dataSecurityIssueFeedEventType:
        DataSecurityIssueFeedEventType.ResponseActionTaken,
      displayColor: Green500,
      feedInfoInMarkdown: `**${body.action}** on the store, through its cloud connection: ${summary} The store is being checked again.`,
      postedAt: new Date(),
      user: people.maya,
      userId: new ObjectID(ID.user(1)),
    });
  }
  return { changed: true, summary };
}

const ROUTE = {
  overview: DATA_SECURITY_API_ROUTES.overview,
  compliance: DATA_SECURITY_API_ROUTES.compliance,
  responseActions: DATA_SECURITY_API_ROUTES.responseActions(":id"),
  respond: DATA_SECURITY_API_ROUTES.respond(":id"),
  explain: DATA_SECURITY_API_ROUTES.explainIssue(":id"),
};

// "/data-security/store/:id/respond" against a request's path.
function idOf(pattern, pathname) {
  const [before, after] = pattern.split(":id");
  const start = pathname.indexOf(before);
  if (start === -1 || !pathname.endsWith(after)) {
    return null;
  }
  return pathname.slice(start + before.length, pathname.length - after.length);
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const body = options.data ? serialize(options.data) : {};
  fixture.apiRequests.push({ method, url, body });
  const pathname = new window.URL(url).pathname;

  if (isFailing) {
    throw failedRead();
  }

  if (method === "POST" && pathname.endsWith(ROUTE.overview)) {
    return new HTTPResponse(200, overview(), {});
  }

  if (method === "POST" && pathname.endsWith(ROUTE.compliance)) {
    return new HTTPResponse(200, compliance(), {});
  }

  const actionsFor = idOf(ROUTE.responseActions, pathname);
  if (method === "POST" && actionsFor) {
    return new HTTPResponse(200, responseActions(actionsFor), {});
  }

  const respondTo = idOf(ROUTE.respond, pathname);
  if (method === "POST" && respondTo) {
    if (role === "viewer") {
      return new HTTPErrorResponse(
        403,
        {
          message:
            "You need one of these permissions: Security Member, Security Admin.",
        },
        {},
      );
    }
    return new HTTPResponse(200, respond(respondTo, body), {});
  }

  fixture.unhandled.push({ kind: "api", method, url });
  return new HTTPResponse(200, {}, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

// The production helpers, handed the page's i18next instance before it starts.
followLanguageForPage(i18next);
followLanguageForDates(i18next);

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: {} },
    de: { translation: DE },
    fa: { translation: FA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
const pageProps = {
  currentProject: project,
  hasPaymentMethod: true,
};

function Shell() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());
  return <DataSecurityRoutes {...pageProps} />;
}

function FixtureApp() {
  const location = useLocation();
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            OneUptime
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Acme Commerce
          </span>
        </div>
        <span
          data-testid="synthetic-banner"
          className="text-xs text-gray-500 dark:text-gray-400"
        >
          Preview workspace · Synthetic data
        </span>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-8">
        <Routes>
          <Route
            path={RouteMap[PageMap.DATA_SECURITY_ROOT].toString()}
            element={<Shell />}
          />
          <Route
            path="*"
            element={
              <p
                data-testid="stub-page"
                className="py-12 text-sm text-gray-600"
              >
                Not modelled: {location.pathname}
              </p>
            }
          />
        </Routes>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
