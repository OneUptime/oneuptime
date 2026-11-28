import {
  ExposureLogRead,
  ExposureLogReadStatus,
  ExposureLogUnreadReason,
  getUnreadLogs,
} from "../../Types/DataSecurity/AccessLogReads";
import { BreachPlace } from "../../Types/DataSecurity/BreachLaws";
import { DataSecurityExposureAssessmentResponse } from "../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../Types/DataSecurity/DataTypeCatalog";
import {
  buildExposureAssessmentView,
  ExposureAssessmentStarter,
  ExposureAssessmentView,
  ExposureGrant,
  ExposureIssueEvent,
  ExposureSecret,
  ExposureWindow,
  getExposureReads,
  getExposureWindow,
  getWhoseData,
  startExposureAssessment,
  StoredExposureAssessment,
} from "../../Types/DataSecurity/ExposureAssessment";
import {
  ExposureChecklistTask,
  getExposureChecklistAnswers,
} from "../../Types/DataSecurity/ExposureChecklist";

/*
 * A SECURITY CASE'S EXPOSURE ASSESSMENT, AS THE SERVER ANSWERS IT, FOR THE
 * DASHBOARD'S TESTS (#10377, #10954, #10955): built by the server's own
 * pure code (buildExposureAssessmentView), so a page is tested against what
 * the server would send, not a hand-written shape that drifts from it.
 *
 * The example is #10377's: a public bucket of EU customers' emails and
 * names, eu-customer-exports in eu-west-1, found on 2 November 2026 at
 * 09:00 UTC and closed by Data Security's own response nine days later,
 * reads not logged, about 48,000 records, one AWS secret access key still
 * in it - so GDPR Article 33 is due first, 72 hours after it was found.
 */

export const EXPOSURE_CASE_ID: string = "10377000-0000-4000-8000-0000000000c1";
export const EXPOSURE_STORE_ID: string = "10377000-0000-4000-8000-0000000000b1";
export const EXPOSURE_FOUND: string = "2026-11-02T09:00:00.000Z";
export const EXPOSURE_CLOSED: string = "2026-11-11T09:00:00.000Z";
export const EXPOSURE_NOW: Date = new Date("2026-11-11T12:00:00.000Z");

export interface ExposureViewOptions {
  countries?: Array<string> | undefined;
  places?: Array<BreachPlace> | undefined;
  accessLogging?: boolean | null | undefined;
  dataTypeIds?: Array<string> | undefined;
  secrets?: Array<ExposureSecret> | undefined;
  grants?: Array<ExposureGrant> | undefined;
  records?: number | undefined;
  storeName?: string | undefined;
  // What OneUptime read of the store's access logs (#10951).
  logRead?: ExposureLogRead | undefined;
  storeKind?: string | undefined;
}

export function exposureWindowOf(): ExposureWindow | null {
  return getExposureWindow({
    issues: [
      {
        id: "issue",
        checkId: "public-read",
        status: "Resolved",
        firstDetectedAt: EXPOSURE_FOUND,
        resolvedAt: "2026-11-11T09:30:00.000Z",
        timeline: [
          { event: ExposureIssueEvent.Opened, at: EXPOSURE_FOUND },
          {
            event: ExposureIssueEvent.Resolved,
            at: "2026-11-11T09:30:00.000Z",
          },
        ],
      },
    ],
    changes: [],
    responses: [{ at: EXPOSURE_CLOSED, closesExposure: true }],
    now: EXPOSURE_NOW,
  });
}

export function exposureViewOf(
  data: ExposureViewOptions = {},
): ExposureAssessmentView {
  const window: ExposureWindow | null = exposureWindowOf();

  return buildExposureAssessmentView({
    store: {
      id: EXPOSURE_STORE_ID,
      name: data.storeName || "eu-customer-exports",
      kind: data.storeKind || "AWS S3 Bucket",
      region: "eu-west-1",
      sensitivity: DataSensitivity.Confidential,
      exposure: "Public",
    },
    exposureIssues: [],
    window,
    reads: getExposureReads({
      accessLogging:
        data.accessLogging === undefined ? false : data.accessLogging,
      exposureCheckIds: ["public-read"],
      isStorePublic: true,
      grants: data.grants || [
        {
          principal: "partner",
          isExternal: true,
          lastUsedAt: "2026-11-05T13:00:00.000Z",
        },
        { principal: "auditor", isExternal: true },
      ],
      window,
      now: EXPOSURE_NOW,
      logRead: data.logRead,
    }),
    whose: getWhoseData({
      dataTypes: (data.dataTypeIds || ["email-address", "person-name"]).map(
        (id: string) => {
          return {
            id,
            name: getBuiltInDataType(id)?.name || id,
            category: getBuiltInDataType(id)?.category || "",
          };
        },
      ),
      estimatedRecords: data.records === undefined ? 48213 : data.records,
      subjectCountries:
        data.countries === undefined ? ["DE", "FR", "NL"] : data.countries,
      placesNamed: data.places,
      people: ["Customers"],
    }),
    secretsToRotate: data.secrets || [
      {
        dataTypeId: "aws-secret-access-key",
        dataTypeName: "AWS secret access key",
        location: "deploy/env.sh",
        isStillThere: true,
      },
    ],
    hasMoreSecrets: false,
    now: EXPOSURE_NOW,
  });
}

export function exposureAssessmentOf(
  data: Partial<StoredExposureAssessment> = {},
): StoredExposureAssessment {
  return {
    ...startExposureAssessment({
      dataStoreId: EXPOSURE_STORE_ID,
      startedBy: ExposureAssessmentStarter.DataSecurity,
      language: "en",
      now: new Date(EXPOSURE_FOUND),
    }),
    ...data,
  };
}

export function exposureAnswerOf(
  data: Partial<DataSecurityExposureAssessmentResponse> = {},
  tasks: ReadonlyArray<ExposureChecklistTask> = [],
): DataSecurityExposureAssessmentResponse {
  return {
    securityCaseId: EXPOSURE_CASE_ID,
    stores: [
      {
        dataStoreId: EXPOSURE_STORE_ID,
        name: "eu-customer-exports",
        kind: "AWS S3 Bucket",
        sensitivity: DataSensitivity.Confidential,
      },
    ],
    dataStoreId: EXPOSURE_STORE_ID,
    assessment: exposureAssessmentOf(),
    view: exposureViewOf(),
    facts: [],
    staleParts: [],
    editors: {},
    checklist: getExposureChecklistAnswers(tasks),
    isAiEnabled: true,
    canChange: true,
    canDraft: true,
    ...data,
  };
}

// A case about a store nobody assessed yet.
export const EXPOSURE_NOT_ASSESSED: Partial<DataSecurityExposureAssessmentResponse> =
  {
    dataStoreId: undefined,
    assessment: null,
    view: null,
    checklist: [],
  };

/*
 * What OneUptime read of the bucket's access logs for the window (#10951):
 * reads from outside by anyone and by an outside account, or none.
 */
export function exposureLogReadOf(
  data: {
    anonymous?: number;
    outside?: number;
    unknown?: number;
    isComplete?: boolean;
    principals?: boolean;
    windowStart?: string;
  } = {},
): ExposureLogRead {
  const window: { start: string; end?: string | undefined } =
    exposureWindowOf()!;
  const counts: (reads: number) => {
    reads: number;
    bytes: number;
    objects: number;
  } = (reads: number) => {
    return { reads, bytes: reads * 1024 * 1024, objects: reads > 0 ? 2 : 0 };
  };

  return {
    ...getUnreadLogs({
      reason: ExposureLogUnreadReason.NoWindow,
      now: EXPOSURE_NOW,
    }),
    status: ExposureLogReadStatus.Read,
    reason: undefined,
    windowStart: data.windowStart || window.start,
    windowEnd: window.end,
    logLocation: "s3://acme-logs/logs/",
    logFilesRead: 240,
    isComplete: data.isComplete !== false,
    readThrough:
      data.isComplete === false ? "2026-11-06T09:00:00.000Z" : undefined,
    anonymous: {
      ...counts(data.anonymous || 0),
      addresses: data.anonymous ? 3 : 0,
    },
    outside: { ...counts(data.outside || 0), accounts: data.outside ? 1 : 0 },
    unknown: {
      ...counts(data.unknown || 0),
      requesters: data.unknown ? 1 : 0,
    },
    outsidePrincipals:
      data.principals && data.outside
        ? [
            {
              principal:
                "arn:aws:sts::999999999999:assumed-role/partner-reader/s1",
              accountId: "999999999999",
              reads: data.outside,
              bytes: data.outside * 1024 * 1024,
              firstAt: "2026-11-04T10:00:00.000Z",
              lastAt: "2026-11-06T10:00:00.000Z",
            },
          ]
        : [],
  };
}
