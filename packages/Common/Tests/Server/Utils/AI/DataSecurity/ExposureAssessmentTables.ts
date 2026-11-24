import DatabaseService from "../../../../../Server/Services/DatabaseService";
import DataSecurityCustomDataTypeService from "../../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../../../Server/Services/DataStoreAccessService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../../Server/Services/SecurityCaseTaskService";
import { getResponseActionStoreFeedMarkdown } from "../../../../../Server/Utils/DataSecurity/DataSecurityResponseFeed";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityResponseAction } from "../../../../../Types/DataSecurity/DataSecurityResponseAction";
import {
  ExposureAssessmentStarter,
  startExposureAssessment,
  StoredExposureAssessment,
  toStoredExposureAssessmentJson,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import {
  DATA_EXPOSURE_CHECKLIST_TASKS,
  ExposureChecklistItem,
} from "../../../../../Types/DataSecurity/ExposureChecklist";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { getDataStoreEntityValue } from "../../../../../Types/SecurityCase/SecurityEntity";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";

/*
 * A SECURITY CASE ABOUT AN EXPOSED BUCKET, AS TABLES IN MEMORY (#10377): the
 * exposure assessment's suites (ExposureAssessmentDrafter,
 * ExposureAssessmentRun) put them up behind the services the assessment
 * reads.
 *
 * The bucket is the brief's: a public bucket of EU customers' emails, open
 * nine days - found on 2 November at 09:00 UTC, closed by Data Security's
 * own Block public access on 11 November at 09:00 - with reads not logged.
 * Its rows keep values that must never reach an assessment, a draft or the
 * model (PLANTED): a secret's sample, a record, the accounts that can reach
 * it and a connection string.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "10377000-0000-4000-8000-000000000001",
);
export const CASE_ID: string = "10377000-0000-4000-8000-0000000000c1";
export const STORE_ID: string = "10377000-0000-4000-8000-0000000000b1";
export const OTHER_STORE_ID: string = "10377000-0000-4000-8000-0000000000b2";
export const ISSUE_ID: string = "10377000-0000-4000-8000-0000000000a1";
export const CLOUD_RESOURCE_ID: string = "10377000-0000-4000-8000-0000000000e1";
export const USER_ID: ObjectID = new ObjectID("10377000-0000-4000-8000-0000000000f1");
export const STORE_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::eu-customer-exports";
export const OTHER_STORE_KEY: string = "cloud:aws:AWS S3 Bucket:arn:aws:s3:::eu-invoices";

export const FOUND: Date = new Date("2026-11-02T09:00:00.000Z");
export const CLOSED: Date = new Date("2026-11-11T09:00:00.000Z");
export const RESOLVED: Date = new Date("2026-11-11T09:30:00.000Z");
export const NOW: Date = new Date("2026-11-11T12:00:00.000Z");
export const HOUR: number = 60 * 60 * 1000;

// What the tables keep that must never reach an assessment, a draft or the model.
export const PLANTED: Readonly<Record<string, string>> = {
  secretSample: "PLANTED-SECRET-AKIAIOSFODNN7EXAMPLE",
  emailSample: "PLANTED-SAMPLE-j***@e******.de",
  recordTrace: "PLANTED-RECORD-4bf92f3577b34da6",
  principal: "arn:aws:iam::999999999999:role/PLANTED-PARTNER-READER",
  usedPrincipal: "arn:aws:iam::888888888888:role/PLANTED-AUDITOR",
  connectionString: "postgres://planted:PLANTED-PASSWORD@db.internal/orders",
};

export const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

export function caller(
  permissions: Array<Permission>,
  data: { labelIds?: Array<ObjectID> } = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions,
      projectId: PROJECT_ID,
      labelIds: data.labelIds,
    }),
    ...ON_HIGHEST_PLAN,
    userId: USER_ID,
  };
}

export const OWNER: DatabaseCommonInteractionProps = caller([Permission.ProjectOwner]);
export const SECURITY_VIEWER: DatabaseCommonInteractionProps = caller([
  Permission.SecurityViewer,
]);

export function storeRow(data: Partial<StoredRow> = {}): StoredRow {
  return {
    _id: STORE_ID,
    projectId: PROJECT_ID.toString(),
    name: "eu-customer-exports",
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "eu-west-1",
    environment: "Production",
    sensitivity: "Confidential",
    exposure: "Public",
    isPublicByDesign: false,
    posture: { accessLogging: false },
    dataTypeIds: ["email-address", "person-name"],
    dataCategories: ["Contact and identity"],
    subjectCountries: ["DE", "FR", "NL"],
    estimatedRecords: 48213,
    dataSubjects: ["Customers"],
    firstSeenAt: new Date("2026-10-01T00:00:00.000Z"),
    storeKey: STORE_KEY,
    cloudResourceId: CLOUD_RESOURCE_ID,
    providerResourceId: "arn:aws:s3:::eu-customer-exports",
    cloudAccountNumber: "123456789012",
    isArchived: false,
    connectionString: PLANTED["connectionString"],
    ...data,
  };
}

export function caseRow(data: Partial<StoredRow> = {}): StoredRow {
  return {
    _id: CASE_ID,
    projectId: PROJECT_ID.toString(),
    title: "Anyone on the internet can read it: eu-customer-exports",
    entities: [
      { type: "Data Store", value: getDataStoreEntityValue(STORE_KEY) },
    ],
    exposureAssessment: null,
    ...data,
  };
}

export function issueRow(data: Partial<StoredRow> = {}): StoredRow {
  return {
    _id: ISSUE_ID,
    projectId: PROJECT_ID.toString(),
    dataStoreId: STORE_ID,
    checkId: "public-read",
    checkGroup: "Exposure",
    title: "Anyone on the internet can read it",
    severity: "Critical",
    status: "Resolved",
    firstDetectedAt: FOUND,
    resolvedAt: RESOLVED,
    securityCaseId: CASE_ID,
    dataTypeIds: ["email-address"],
    ...data,
  };
}

export function issueFeedRows(): Array<StoredRow> {
  return [
    {
      _id: "10377000-0000-4000-8000-000000000101",
      projectId: PROJECT_ID.toString(),
      dataSecurityIssueId: ISSUE_ID,
      dataSecurityIssueFeedEventType: "IssueOpened",
      postedAt: FOUND,
      createdAt: FOUND,
    },
    {
      _id: "10377000-0000-4000-8000-000000000102",
      projectId: PROJECT_ID.toString(),
      dataSecurityIssueId: ISSUE_ID,
      dataSecurityIssueFeedEventType: "Resolved",
      postedAt: RESOLVED,
      createdAt: RESOLVED,
    },
  ];
}

export function responseRow(at: Date, changed: boolean): StoredRow {
  return {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID.toString(),
    dataStoreId: STORE_ID,
    dataStoreFeedEventType: "ResponseActionTaken",
    feedInfoInMarkdown: getResponseActionStoreFeedMarkdown({
      action: DataSecurityResponseAction.BlockPublicAccess,
      outcome: {
        changed,
        summary: "Block Public Access is on for the bucket.",
      } as never,
    }).toString(),
    postedAt: at,
    createdAt: at,
  };
}

export function grantRows(): Array<StoredRow> {
  return [
    {
      _id: "10377000-0000-4000-8000-000000000201",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: "*",
      isPublic: true,
      isExternal: false,
      isSeenInTraces: false,
    },
    {
      _id: "10377000-0000-4000-8000-000000000202",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: PLANTED["principal"],
      isPublic: false,
      isExternal: true,
      isSeenInTraces: false,
      lastUsedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      _id: "10377000-0000-4000-8000-000000000203",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      principal: PLANTED["usedPrincipal"],
      isPublic: false,
      isExternal: true,
      isSeenInTraces: false,
      lastUsedAt: new Date("2026-11-05T13:00:00.000Z"),
    },
  ];
}

export function findingRows(): Array<StoredRow> {
  return [
    {
      _id: "10377000-0000-4000-8000-000000000301",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "aws-secret-access-key",
      dataTypeName: "AWS secret access key",
      dataCategory: "Secrets and credentials",
      location: "deploy/env.sh",
      locationKind: "Object path",
      isSuppressed: false,
      lastSeenAt: new Date("2026-11-10T00:00:00.000Z"),
      fixedAt: null,
      maskedSamples: [PLANTED["secretSample"]],
      sampleRecords: [{ traceId: PLANTED["recordTrace"] }],
    },
    {
      // Fixed while the bucket was open: it was exposed, and is rotated.
      _id: "10377000-0000-4000-8000-000000000302",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "github-token",
      dataTypeName: "GitHub token",
      dataCategory: "Secrets and credentials",
      location: "ci/release.yml",
      locationKind: "Object path",
      isSuppressed: false,
      lastSeenAt: new Date("2026-11-06T00:00:00.000Z"),
      fixedAt: new Date("2026-11-06T00:00:00.000Z"),
      maskedSamples: [PLANTED["secretSample"]],
    },
    {
      // Fixed before it opened: never exposed.
      _id: "10377000-0000-4000-8000-000000000303",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "slack-token",
      dataTypeName: "Slack token",
      dataCategory: "Secrets and credentials",
      location: "old/notify.sh",
      locationKind: "Object path",
      isSuppressed: false,
      lastSeenAt: new Date("2026-10-15T00:00:00.000Z"),
      fixedAt: new Date("2026-10-15T00:00:00.000Z"),
      maskedSamples: [PLANTED["secretSample"]],
    },
    {
      // A person said it is not a secret.
      _id: "10377000-0000-4000-8000-000000000304",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "generic-secret",
      dataTypeName: "Secret",
      dataCategory: "Secrets and credentials",
      location: "docs/example.env",
      locationKind: "Object path",
      isSuppressed: true,
      lastSeenAt: new Date("2026-11-10T00:00:00.000Z"),
      fixedAt: null,
      maskedSamples: [PLANTED["secretSample"]],
    },
    {
      // What the store holds: never a secret to rotate.
      _id: "10377000-0000-4000-8000-000000000305",
      projectId: PROJECT_ID.toString(),
      dataStoreId: STORE_ID,
      dataTypeId: "email-address",
      dataTypeName: "Email address",
      dataCategory: "Contact and identity",
      location: "exports/customers.csv",
      locationKind: "Object pattern",
      isSuppressed: false,
      lastSeenAt: new Date("2026-11-10T00:00:00.000Z"),
      maskedSamples: [PLANTED["emailSample"]],
    },
  ];
}

export function taskRows(): Array<StoredRow> {
  return [
    {
      _id: "10377000-0000-4000-8000-000000000401",
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID,
      title: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.WhoReadIt],
      isDone: false,
      createdAt: new Date("2026-11-02T09:01:00.000Z"),
    },
    {
      _id: "10377000-0000-4000-8000-000000000402",
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID,
      title: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.MustReport],
      isDone: false,
      createdAt: new Date("2026-11-02T09:02:00.000Z"),
    },
    {
      _id: "10377000-0000-4000-8000-000000000403",
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID,
      title: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.RotateSecrets],
      isDone: true,
      createdAt: new Date("2026-11-02T09:03:00.000Z"),
    },
  ];
}

export function startedAssessment(
  data: Partial<StoredExposureAssessment> = {},
): JSONObject {
  return toStoredExposureAssessmentJson({
    ...startExposureAssessment({
      dataStoreId: STORE_ID,
      startedBy: ExposureAssessmentStarter.DataSecurity,
      language: "en",
      now: FOUND,
    }),
    ...data,
  });
}

export interface ExposureTables {
  cases: InMemoryTable;
  stores: InMemoryTable;
  issues: InMemoryTable;
  storeFeed: InMemoryTable;
  findings: InMemoryTable;
  tasks: InMemoryTable;
}

export function useExposureTables(data: {
  cases?: Array<StoredRow>;
  stores?: Array<StoredRow>;
  issues?: Array<StoredRow>;
  issueFeed?: Array<StoredRow>;
  storeFeed?: Array<StoredRow>;
  findings?: Array<StoredRow>;
  tasks?: Array<StoredRow>;
} = {}): ExposureTables {
  const cases: InMemoryTable = useInMemoryTable(
    asService(SecurityCaseService),
    data.cases || [caseRow()],
  );

  useInMemoryHookFreeWrites(asService(SecurityCaseService), cases);
  useInMemoryTable(
    asService(DataSecurityIssueFeedService),
    data.issueFeed || issueFeedRows(),
  );
  useInMemoryTable(asService(DataStoreAccessService), grantRows());
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);

  return {
    cases,
    stores: useInMemoryTable(
      asService(DataStoreService),
      data.stores || [storeRow()],
    ),
    issues: useInMemoryTable(
      asService(DataSecurityIssueService),
      data.issues || [issueRow()],
    ),
    storeFeed: useInMemoryTable(
      asService(DataStoreFeedService),
      data.storeFeed || [responseRow(CLOSED, true)],
    ),
    findings: useInMemoryTable(
      asService(DataStoreFindingService),
      data.findings || findingRows(),
    ),
    tasks: useInMemoryTable(
      asService(SecurityCaseTaskService),
      data.tasks || taskRows(),
    ),
  };
}
