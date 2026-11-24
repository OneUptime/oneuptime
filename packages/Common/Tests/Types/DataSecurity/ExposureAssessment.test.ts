import {
  BreachLawFamily,
  BreachLawId,
  BreachPlace,
  getBreachLawRule,
} from "../../../Types/DataSecurity/BreachLaws";
import {
  BreachObligationFact,
  ComplianceFact,
  ComplianceFactKind,
  ExposureWindowFact,
  StoreHoldsFact,
  getFactsHash,
  readComplianceFacts,
} from "../../../Types/DataSecurity/ComplianceFacts";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  addBusinessDays,
  applyBreachLaws,
  BreachObligation,
  BreachObligationStatus,
  buildExposureAssessmentView,
  countObligationsThatMayApply,
  describeBreachCheckInEnglish,
  describeBreachDeadlineInEnglish,
  editExposureDraft,
  EXPOSURE_CHECK_IDS,
  EXPOSURE_DRAFT_PART_ASKS,
  EXPOSURE_DRAFT_PART_TITLES,
  EXPOSURE_DRAFT_PARTS,
  EXPOSURE_NOTICE_PARTS,
  ExposureAssessmentStarter,
  ExposureAssessmentView,
  ExposureChangeDirection,
  ExposureDraftDropReason,
  ExposureDraftPart,
  ExposureIssueEvent,
  ExposureIssueFacts,
  ExposureReads,
  ExposureReadsLogged,
  ExposureWhoseData,
  ExposureWindow,
  ExposureWindowEndKind,
  ExposureWindowStartKind,
  getBreachDataElements,
  getBreachDueAt,
  getDraftableExposureParts,
  getExposureChangeDirection,
  getExposureChangeOperations,
  getExposureReads,
  getExposureWindow,
  getIssueOpenIntervals,
  getMostUrgentObligation,
  getPlacesOfCountries,
  getStaleExposureDraftParts,
  getUncoveredLaws,
  getUnfoundedLaws,
  getWhoseData,
  HeldExposureDrafts,
  holdExposureDraftsToFacts,
  isAssessedOnItsOwn,
  isBreachLawInForce,
  isExposureCheck,
  isExposureDraftPart,
  mergeExposureDrafts,
  readStoredExposureAssessment,
  roundRecords,
  setExposurePeoplePlaces,
  startExposureAssessment,
  StoredExposureAssessment,
  toStoredExposureAssessmentJson,
  UncoveredLawKind,
} from "../../../Types/DataSecurity/ExposureAssessment";
import {
  DATA_EXPOSURE_CHECKLIST_TASKS,
  EXPOSURE_CHECKLIST_ITEMS,
  ExposureChecklistAnswer,
  ExposureChecklistItem,
  getDataExposureChecklistTaskLines,
  getExposureChecklistAnswers,
  getExposureChecklistItemOfTask,
  getExposureChecklistStepKey,
} from "../../../Types/DataSecurity/ExposureChecklist";
import { ImpactAssessmentSectionSource } from "../../../Types/DataSecurity/ImpactAssessment";
import {
  DATA_EXPOSURE_TEMPLATE,
  DATA_EXPOSURE_TEMPLATE_KEY,
  getSecurityPlaybookTemplateDefinition,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import { describe, expect, test } from "@jest/globals";

/*
 * AN EXPOSURE, ASSESSED BY PLAIN CODE (#10377): THE WINDOW FROM RECORDED
 * TIMELINES, WHO READ IT WITH AND WITHOUT LOGS, WHOSE DATA, THE DEADLINES,
 * THE CHECKLIST, AND ONEUPTIME AI'S DRAFTS HELD TO THE FACTS.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function iso(value: string): string {
  return new Date(value).toISOString();
}

function issue(
  data: Partial<ExposureIssueFacts> & {
    id: string;
    foundAt: string;
    resolvedAt?: string;
  },
): ExposureIssueFacts {
  return {
    id: data.id,
    checkId: data.checkId || "public-read",
    status: data.resolvedAt ? "Resolved" : "Open",
    firstDetectedAt: data.foundAt,
    resolvedAt: data.resolvedAt,
    timeline: data.timeline || [
      { event: ExposureIssueEvent.Opened, at: data.foundAt },
      ...(data.resolvedAt
        ? [{ event: ExposureIssueEvent.Resolved, at: data.resolvedAt }]
        : []),
    ],
  };
}

function whose(data: {
  dataTypeIds: Array<string>;
  countries?: Array<string>;
  places?: Array<BreachPlace>;
  records?: number;
  people?: Array<string>;
}): ExposureWhoseData {
  return getWhoseData({
    dataTypes: data.dataTypeIds.map((id: string) => {
      return {
        id,
        name: getBuiltInDataType(id)?.name || id,
        category: getBuiltInDataType(id)?.category || "",
      };
    }),
    estimatedRecords: data.records,
    subjectCountries: data.countries || [],
    placesNamed: data.places,
    people: data.people,
  });
}

function readsOf(logged: ExposureReadsLogged): ExposureReads {
  return {
    logged,
    isPublic: true,
    outsideAccounts: 0,
    outsideAccountsUsedInWindow: 0,
    isTreatedAsRead: logged !== ExposureReadsLogged.Logged,
  };
}

describe("which exposures are assessed on their own", () => {
  test("a Critical exposure of a store with Restricted or Confidential data is", () => {
    for (const checkId of EXPOSURE_CHECK_IDS) {
      for (const sensitivity of [
        DataSensitivity.Restricted,
        DataSensitivity.Confidential,
      ]) {
        expect(
          isAssessedOnItsOwn({
            severity: SecuritySeverity.Critical,
            checkId,
            sensitivity,
          }),
        ).toBe(true);
      }
    }
  });

  test("a bucket of website images, public, is not", () => {
    expect(
      isAssessedOnItsOwn({
        severity: SecuritySeverity.Critical,
        checkId: "public-read",
        sensitivity: DataSensitivity.Public,
      }),
    ).toBe(false);
    expect(
      isAssessedOnItsOwn({
        severity: SecuritySeverity.Low,
        checkId: "public-read",
        sensitivity: DataSensitivity.Public,
      }),
    ).toBe(false);
  });

  test("nor an Internal store, a High issue, or a check that is not an exposure", () => {
    expect(
      isAssessedOnItsOwn({
        severity: SecuritySeverity.Critical,
        checkId: "public-read",
        sensitivity: DataSensitivity.Internal,
      }),
    ).toBe(false);
    expect(
      isAssessedOnItsOwn({
        severity: SecuritySeverity.High,
        checkId: "public-read",
        sensitivity: DataSensitivity.Restricted,
      }),
    ).toBe(false);
    expect(
      isAssessedOnItsOwn({
        severity: SecuritySeverity.Critical,
        checkId: "secrets-stored",
        sensitivity: DataSensitivity.Restricted,
      }),
    ).toBe(false);
    expect(isExposureCheck(undefined)).toBe(false);
    expect(isExposureCheck("access-not-logged")).toBe(false);
  });
});

describe("the window, from recorded timelines", () => {
  const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

  test("open nine days, closed by Data Security's own response: at least since the first scan", () => {
    const window: ExposureWindow | null = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-02T09:00:00.000Z",
          resolvedAt: "2026-11-11T09:30:00.000Z",
        }),
      ],
      changes: [],
      responses: [{ at: "2026-11-11T09:00:00.000Z", closesExposure: true }],
      now: NOW,
    });

    expect(window).toEqual({
      foundAt: iso("2026-11-02T09:00:00Z"),
      start: iso("2026-11-02T09:00:00Z"),
      startKind: ExposureWindowStartKind.FirstSeen,
      startOperation: undefined,
      end: iso("2026-11-11T09:00:00Z"),
      endKind: ExposureWindowEndKind.ResponseAction,
      endOperation: undefined,
      isStillOpen: false,
      hours: 216,
      days: 9,
      earlierPeriods: [],
    });
  });

  test("a change of the cloud's log starts it, when the store was watched before it", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-09T10:15:00.000Z",
          resolvedAt: "2026-11-10T09:00:00.000Z",
        }),
      ],
      changes: [
        {
          time: "2026-11-09T10:02:00.000Z",
          operation: "s3:PutBucketPolicy",
          direction: ExposureChangeDirection.Either,
        },
        {
          time: "2026-11-10T08:40:00.000Z",
          operation: "s3:PutBucketPublicAccessBlock",
          direction: ExposureChangeDirection.Closes,
        },
      ],
      responses: [],
      storeFirstSeenAt: "2026-10-01T00:00:00.000Z",
      now: NOW,
    })!;

    expect(window.startKind).toBe(ExposureWindowStartKind.Change);
    expect(window.start).toBe(iso("2026-11-09T10:02:00Z"));
    expect(window.startOperation).toBe("s3:PutBucketPolicy");
    expect(window.endKind).toBe(ExposureWindowEndKind.Change);
    expect(window.end).toBe(iso("2026-11-10T08:40:00Z"));
    expect(window.endOperation).toBe("s3:PutBucketPublicAccessBlock");
    // Found at 10:15: what the deadlines count from, not the change at 10:02.
    expect(window.foundAt).toBe(iso("2026-11-09T10:15:00Z"));
    expect(window.hours).toBe(22);
    expect(window.days).toBe(0);
  });

  test("a change before Data Security first saw the store proves nothing: at least since", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [issue({ id: "i1", foundAt: "2026-11-09T10:15:00.000Z" })],
      changes: [
        {
          time: "2026-11-09T10:02:00.000Z",
          operation: "s3:PutBucketPolicy",
          direction: ExposureChangeDirection.Either,
        },
      ],
      responses: [],
      storeFirstSeenAt: "2026-11-09T10:10:00.000Z",
      now: NOW,
    })!;

    expect(window.startKind).toBe(ExposureWindowStartKind.FirstSeen);
    expect(window.start).toBe(iso("2026-11-09T10:15:00Z"));
  });

  test("nor does one with no record of when the store was first seen, a closing one, a failed one or one too long before", () => {
    const base: {
      issues: Array<ExposureIssueFacts>;
      responses: [];
      now: Date;
    } = {
      issues: [issue({ id: "i1", foundAt: "2026-11-09T10:15:00.000Z" })],
      responses: [],
      now: NOW,
    };

    expect(
      getExposureWindow({
        ...base,
        changes: [
          {
            time: "2026-11-09T10:02:00.000Z",
            operation: "s3:PutBucketPolicy",
            direction: ExposureChangeDirection.Either,
          },
        ],
      })!.startKind,
    ).toBe(ExposureWindowStartKind.FirstSeen);

    const watched: { storeFirstSeenAt: string } = {
      storeFirstSeenAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      getExposureWindow({
        ...base,
        ...watched,
        changes: [
          {
            time: "2026-11-09T10:02:00.000Z",
            operation: "s3:PutBucketPublicAccessBlock",
            direction: ExposureChangeDirection.Closes,
          },
        ],
      })!.startKind,
    ).toBe(ExposureWindowStartKind.FirstSeen);
    expect(
      getExposureWindow({
        ...base,
        ...watched,
        changes: [
          {
            time: "2026-11-09T10:02:00.000Z",
            operation: "s3:DeleteBucketPublicAccessBlock",
            direction: ExposureChangeDirection.Opens,
            failed: true,
          },
        ],
      })!.startKind,
    ).toBe(ExposureWindowStartKind.FirstSeen);
    expect(
      getExposureWindow({
        ...base,
        ...watched,
        changes: [
          {
            time: "2026-09-01T10:02:00.000Z",
            operation: "s3:DeleteBucketPublicAccessBlock",
            direction: ExposureChangeDirection.Opens,
          },
        ],
      })!.startKind,
    ).toBe(ExposureWindowStartKind.FirstSeen);
  });

  test("still open: it runs to now, and says so", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [issue({ id: "i1", foundAt: "2026-11-21T12:00:00.000Z" })],
      changes: [],
      responses: [],
      now: NOW,
    })!;

    expect(window.isStillOpen).toBe(true);
    expect(window.end).toBeUndefined();
    expect(window.endKind).toBe(ExposureWindowEndKind.StillOpen);
    expect(window.hours).toBe(72);
    expect(window.days).toBe(3);
  });

  test("closed by a scan, with no change or response to say when: by then at the latest", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-20T00:00:00.000Z",
          resolvedAt: "2026-11-21T06:00:00.000Z",
        }),
      ],
      changes: [],
      responses: [{ at: "2026-11-25T00:00:00.000Z", closesExposure: true }],
      now: NOW,
    })!;

    expect(window.endKind).toBe(ExposureWindowEndKind.Scan);
    expect(window.end).toBe(iso("2026-11-21T06:00:00Z"));
    expect(window.hours).toBe(30);
  });

  test("a response that changed nothing does not close it", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-20T00:00:00.000Z",
          resolvedAt: "2026-11-21T06:00:00.000Z",
        }),
      ],
      changes: [],
      responses: [{ at: "2026-11-20T08:00:00.000Z", closesExposure: false }],
      now: NOW,
    })!;

    expect(window.endKind).toBe(ExposureWindowEndKind.Scan);
  });

  test("an exposure that came back: the latest period, with the earlier one kept", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-01T00:00:00.000Z",
          timeline: [
            { event: ExposureIssueEvent.Opened, at: "2026-11-01T00:00:00Z" },
            { event: ExposureIssueEvent.Resolved, at: "2026-11-03T00:00:00Z" },
            { event: ExposureIssueEvent.Reopened, at: "2026-11-10T00:00:00Z" },
          ],
        }),
      ],
      changes: [],
      responses: [],
      now: NOW,
    })!;

    expect(window.foundAt).toBe(iso("2026-11-10T00:00:00Z"));
    expect(window.isStillOpen).toBe(true);
    expect(window.earlierPeriods).toEqual([
      { start: iso("2026-11-01T00:00:00Z"), end: iso("2026-11-03T00:00:00Z") },
    ]);
  });

  test("two exposure issues of the case are one exposure, merged", () => {
    const window: ExposureWindow = getExposureWindow({
      issues: [
        issue({
          id: "read",
          foundAt: "2026-11-10T00:00:00.000Z",
          resolvedAt: "2026-11-12T00:00:00.000Z",
        }),
        issue({
          id: "write",
          checkId: "public-write",
          foundAt: "2026-11-11T00:00:00.000Z",
          resolvedAt: "2026-11-14T00:00:00.000Z",
        }),
      ],
      changes: [],
      responses: [],
      now: NOW,
    })!;

    expect(window.start).toBe(iso("2026-11-10T00:00:00Z"));
    expect(window.end).toBe(iso("2026-11-14T00:00:00Z"));
    expect(window.days).toBe(4);
    expect(window.earlierPeriods).toEqual([]);
  });

  test("an issue with no timeline is open from its first detection to its resolution", () => {
    const intervals: ReturnType<typeof getIssueOpenIntervals> =
      getIssueOpenIntervals(
        {
          id: "i",
          checkId: "public-read",
          status: "Resolved",
          firstDetectedAt: "2026-11-01T00:00:00Z",
          resolvedAt: "2026-11-02T00:00:00Z",
          timeline: [],
        },
        NOW,
      );

    expect(intervals).toEqual([
      {
        start: new Date("2026-11-01T00:00:00Z").getTime(),
        end: new Date("2026-11-02T00:00:00Z").getTime(),
      },
    ]);
    expect(
      getIssueOpenIntervals(
        {
          id: "i",
          checkId: "public-read",
          status: "Open",
          firstDetectedAt: "2026-11-01T00:00:00Z",
          resolvedAt: "2026-11-02T00:00:00Z",
          timeline: [],
        },
        NOW,
      )[0]!.end,
    ).toBeNull();
  });

  test("no exposure issue, no window", () => {
    expect(
      getExposureWindow({ issues: [], changes: [], responses: [], now: NOW }),
    ).toBeNull();
  });

  test("which way each operation of the log moves who can reach a store", () => {
    expect(
      getExposureChangeDirection({ operation: "s3:DeleteBucketPublicAccessBlock" }),
    ).toBe(ExposureChangeDirection.Opens);
    expect(
      getExposureChangeDirection({ operation: "s3:PutBucketPublicAccessBlock" }),
    ).toBe(ExposureChangeDirection.Closes);
    expect(getExposureChangeDirection({ operation: "s3:PutBucketPolicy" })).toBe(
      ExposureChangeDirection.Either,
    );
    expect(
      getExposureChangeDirection({
        operation: "rds:ModifyDBSnapshotAttribute",
        grantsAccess: true,
      }),
    ).toBe(ExposureChangeDirection.Opens);
    expect(
      getExposureChangeDirection({
        operation: "rds:ModifyDBSnapshotAttribute",
        grantsAccess: false,
      }),
    ).toBe(ExposureChangeDirection.Closes);
    expect(
      getExposureChangeDirection({ operation: "rds:ModifyDBSnapshotAttribute" }),
    ).toBe(ExposureChangeDirection.Either);
    expect(
      getExposureChangeDirection({ operation: "s3:PutBucketVersioning" }),
    ).toBeNull();

    for (const operation of getExposureChangeOperations()) {
      expect(getExposureChangeDirection({ operation })).not.toBeNull();
    }
  });
});

describe("who read it, with and without logs", () => {
  const window: ExposureWindow = {
    foundAt: iso("2026-11-10T00:00:00Z"),
    start: iso("2026-11-10T00:00:00Z"),
    startKind: ExposureWindowStartKind.FirstSeen,
    end: iso("2026-11-12T00:00:00Z"),
    endKind: ExposureWindowEndKind.Scan,
    isStillOpen: false,
    hours: 48,
    days: 2,
    earlierPeriods: [],
  };
  const now: Date = new Date("2026-11-20T00:00:00Z");

  test("reads not logged: treat the data as read", () => {
    const reads: ExposureReads = getExposureReads({
      accessLogging: false,
      exposureCheckIds: ["public-read"],
      isStorePublic: false,
      grants: [],
      window,
      now,
    });

    expect(reads.logged).toBe(ExposureReadsLogged.NotLogged);
    expect(reads.isTreatedAsRead).toBe(true);
    expect(reads.isPublic).toBe(true);
  });

  test("reads logged: not treated as read, a person checks the logs", () => {
    const reads: ExposureReads = getExposureReads({
      accessLogging: true,
      exposureCheckIds: ["shared-with-external-accounts"],
      isStorePublic: false,
      grants: [],
      window,
      now,
    });

    expect(reads.logged).toBe(ExposureReadsLogged.Logged);
    expect(reads.isTreatedAsRead).toBe(false);
    expect(reads.isPublic).toBe(false);
  });

  test("logging not known: treated as read until someone checks", () => {
    for (const accessLogging of [null, undefined]) {
      const reads: ExposureReads = getExposureReads({
        accessLogging,
        exposureCheckIds: [],
        isStorePublic: true,
        grants: [],
        window: null,
        now,
      });

      expect(reads.logged).toBe(ExposureReadsLogged.Unknown);
      expect(reads.isTreatedAsRead).toBe(true);
      expect(reads.isPublic).toBe(true);
    }
  });

  test("who could read it: outside accounts counted once each, and those that used it in the window", () => {
    const reads: ExposureReads = getExposureReads({
      accessLogging: true,
      exposureCheckIds: ["shared-with-external-accounts"],
      isStorePublic: false,
      grants: [
        { principal: "arn:aws:iam::111:root", isExternal: true },
        {
          principal: "arn:aws:iam::111:root",
          isExternal: true,
          lastUsedAt: "2026-11-11T00:00:00Z",
        },
        {
          principal: "arn:aws:iam::222:root",
          isExternal: true,
          lastUsedAt: "2026-11-15T00:00:00Z",
        },
        { principal: "arn:aws:iam::999:role/app", isExternal: false },
        { principal: "*", isPublic: true },
      ],
      window,
      now,
    });

    expect(reads.outsideAccounts).toBe(2);
    expect(reads.outsideAccountsUsedInWindow).toBe(1);
    // A public grant is anyone on the internet.
    expect(reads.isPublic).toBe(true);
  });
});

describe("whose data", () => {
  test("its types, categories, special categories, records and the people's places", () => {
    const data: ExposureWhoseData = whose({
      dataTypeIds: ["email-address", "health-information", "de-tax-id"],
      countries: ["de", "XX1", "FR"],
      records: 48213,
      people: ["Customers", "Children"],
    });

    expect(data.categories).toEqual([
      "Contact and identity",
      "Government ID",
      "Health",
    ]);
    expect(data.hasPersonalData).toBe(true);
    expect(data.specialCategories).toEqual(["Health"]);
    expect(data.records).toBe(48000);
    expect(data.countriesFromData).toEqual(["DE", "FR"]);
    expect(data.places).toEqual([BreachPlace.Eea]);
    expect(data.includesChildren).toBe(true);
    expect(data.hasNames).toBe(false);
  });

  test("a person's answer adds to the places the data says", () => {
    const data: ExposureWhoseData = whose({
      dataTypeIds: ["email-address"],
      countries: ["US"],
      places: [BreachPlace.Texas, BreachPlace.Texas, "XX" as BreachPlace],
    });

    expect(data.placesNamed).toEqual([BreachPlace.Texas]);
    expect(data.places).toEqual([BreachPlace.UnitedStates, BreachPlace.Texas]);
  });

  test("records round to two figures", () => {
    expect(roundRecords(7)).toBe(7);
    expect(roundRecords(99)).toBe(99);
    expect(roundRecords(1234)).toBe(1200);
    expect(roundRecords(48213)).toBe(48000);
    expect(roundRecords(230499)).toBe(230000);
  });

  test("the breach laws' elements of a store's types", () => {
    expect(getBreachDataElements({ dataTypeIds: ["email-address"] })).toEqual([
      "PersonalData",
    ]);
    // A login only with a password.
    expect(
      getBreachDataElements({
        dataTypeIds: ["email-address", "generic-secret"],
      }),
    ).toContain("OnlineCredentials");
    expect(
      getBreachDataElements({ dataTypeIds: ["generic-secret"] }),
    ).not.toContain("OnlineCredentials");
    // Another government's ID number is one, a US one is its own.
    expect(getBreachDataElements({ dataTypeIds: ["br-cpf"] })).toEqual([
      "OtherGovernmentId",
      "PersonalData",
    ]);
    expect(getBreachDataElements({ dataTypeIds: ["us-ssn"] })).toEqual([
      "PersonalData",
      "SocialSecurityNumber",
    ]);
    // A card number is a financial account and card data.
    expect(
      getBreachDataElements({ dataTypeIds: ["credit-card-number"] }),
    ).toEqual(["CardData", "FinancialAccount", "PersonalData"]);
    // Secrets are not personal data.
    expect(
      getBreachDataElements({ dataTypeIds: ["aws-secret-access-key"] }),
    ).toEqual([]);
  });

  test("a custom data type counts by its category", () => {
    expect(
      getBreachDataElements({
        dataTypeIds: ["custom:abc"],
        categoryOf: new Map([["custom:abc", "Health"]]),
      }),
    ).toEqual(["PersonalData"]);
    expect(
      getBreachDataElements({
        dataTypeIds: ["custom:abc"],
        categoryOf: new Map([["custom:abc", "Business confidential"]]),
      }),
    ).toEqual([]);
  });

  test("countries become the table's places, each once, in its order", () => {
    expect(getPlacesOfCountries(["JP", "DE", "FR", "BR", "GB"])).toEqual([
      BreachPlace.Eea,
      BreachPlace.UnitedKingdom,
      BreachPlace.Brazil,
      BreachPlace.Elsewhere,
    ]);
  });
});

describe("deadlines, in their units, counted from when it was found", () => {
  test("business days skip Saturday and Sunday", () => {
    // Friday 18:00 + 3 business days: Wednesday 18:00.
    expect(
      addBusinessDays(new Date("2026-11-20T18:00:00Z"), 3).toISOString(),
    ).toBe(iso("2026-11-25T18:00:00Z"));
    // Saturday + 1 business day: Monday.
    expect(
      addBusinessDays(new Date("2026-11-21T10:00:00Z"), 1).toISOString(),
    ).toBe(iso("2026-11-23T10:00:00Z"));
    expect(
      addBusinessDays(new Date("2026-11-23T10:00:00Z"), 0).toISOString(),
    ).toBe(iso("2026-11-23T10:00:00Z"));
  });

  test("the end of the calendar year counts a leap year's 29 February", () => {
    // Found in 2027: the next year, 2028, is a leap year.
    expect(
      getBreachDueAt({
        rule: {
          ...({} as never),
          deadline: {
            unit: "CalendarDays",
            amount: 60,
            start: "EndOfCalendarYear",
          },
        } as never,
        foundAt: new Date("2027-06-01T00:00:00Z"),
      })!.toISOString(),
    ).toBe(iso("2028-02-29T23:59:00Z"));
  });

  test("a deadline counted from another notice waits for it", () => {
    const rule: never = {
      deadline: {
        unit: "CalendarDays",
        amount: 15,
        start: "PeopleNotified",
        afterRule: BreachLawId.CaliforniaResidents,
      },
    } as never;

    expect(
      getBreachDueAt({ rule, foundAt: new Date("2026-11-01T00:00:00Z") }),
    ).toBeUndefined();
    expect(
      getBreachDueAt({
        rule,
        foundAt: new Date("2026-11-01T00:00:00Z"),
        dueAtOf: new Map([
          [BreachLawId.CaliforniaResidents, new Date("2026-12-01T00:00:00Z")],
        ]),
      })!.toISOString(),
    ).toBe(iso("2026-12-16T00:00:00Z"));
  });

  test("a row takes effect on its day, in UTC", () => {
    const rule: never = { inForceFrom: "2027-05-13" } as never;

    expect(isBreachLawInForce(rule, new Date("2027-05-12T23:59:59Z"))).toBe(
      false,
    );
    expect(isBreachLawInForce(rule, new Date("2027-05-13T00:00:00Z"))).toBe(
      true,
    );
    expect(isBreachLawInForce({} as never, new Date())).toBe(true);
  });

  test("each deadline in English, for OneUptime AI and an export", () => {
    const words: Array<string> = applyBreachLaws({
      whose: whose({ dataTypeIds: ["us-ssn"] }),
      reads: readsOf(ExposureReadsLogged.NotLogged),
      foundAt: new Date("2026-11-01T00:00:00Z"),
      now: new Date("2026-11-02T00:00:00Z"),
    }).map((obligation: BreachObligation): string => {
      return describeBreachDeadlineInEnglish(
        getBreachLawRule(obligation.ruleId),
      );
    });

    expect(words).toEqual(
      expect.arrayContaining([
        "72 hours from when it was found",
        "6 hours from when it was found",
        "3 business days from when it was found",
        "30 calendar days from when it was found",
        "15 calendar days after the people are notified",
        "when the people are notified",
        "60 calendar days after the end of the calendar year it was found in",
        "without undue delay",
        "no fixed time",
      ]),
    );
  });
});

describe("what the law may ask", () => {
  const FOUND: Date = new Date("2026-11-02T09:00:00.000Z");
  const NOW: Date = new Date("2026-11-03T09:00:00.000Z");

  test("EU emails: GDPR's 72 hours is due first, the rest by deadline and place", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: whose({
        dataTypeIds: ["email-address", "person-name"],
        countries: ["DE", "FR"],
      }),
      reads: readsOf(ExposureReadsLogged.NotLogged),
      foundAt: FOUND,
      now: NOW,
    });

    expect(obligations).toHaveLength(Object.values(BreachLawId).length);
    expect(obligations[0]!.ruleId).toBe(BreachLawId.GdprAuthority);
    expect(obligations[0]!.dueAt).toBe(iso("2026-11-05T09:00:00Z"));
    // What may apply comes first, then what is not in force, then what is not triggered.
    const statuses: Array<BreachObligationStatus> = obligations.map(
      (obligation: BreachObligation): BreachObligationStatus => {
        return obligation.status;
      },
    );
    const firstNotYet: number = statuses.indexOf(
      BreachObligationStatus.NotYetInForce,
    );
    const firstNot: number = statuses.indexOf(
      BreachObligationStatus.NotTriggered,
    );

    expect(firstNotYet).toBeGreaterThan(0);
    expect(firstNot).toBeGreaterThan(firstNotYet);
    expect(
      statuses.slice(0, firstNotYet).every((status: string): boolean => {
        return status === BreachObligationStatus.MayApply;
      }),
    ).toBe(true);
    expect(getMostUrgentObligation(obligations)!.ruleId).toBe(
      BreachLawId.GdprAuthority,
    );
    expect(countObligationsThatMayApply(obligations)).toBe(7);
  });

  test("nobody knows where the people live: nothing is due first, and every place is asked", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: whose({ dataTypeIds: ["email-address"] }),
      reads: readsOf(ExposureReadsLogged.NotLogged),
      foundAt: FOUND,
      now: NOW,
    });

    expect(getMostUrgentObligation(obligations)).toBeNull();
    expect(
      obligations.filter((obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.MayApply;
      }),
    ).toHaveLength(7);
  });

  test("the people in the United States, no state said: every state's law asks which", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: whose({
        dataTypeIds: ["us-ssn", "person-name"],
        places: [BreachPlace.UnitedStates],
      }),
      reads: readsOf(ExposureReadsLogged.NotLogged),
      foundAt: FOUND,
      now: NOW,
    });
    const texas: BreachObligation = obligations.find(
      (obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.TexasIndividuals;
      },
    )!;

    expect(texas.status).toBe(BreachObligationStatus.MayApply);
    expect(texas.isPlaceKnown).toBe(false);
    // ...and GDPR is ruled out by the person's answer.
    expect(
      obligations.find((obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.GdprAuthority;
      })!.status,
    ).toBe(BreachObligationStatus.NotTriggered);
  });

  test("the table's checks read in English for a person and OneUptime AI", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: whose({ dataTypeIds: ["us-ssn"], records: 900 }),
      reads: readsOf(ExposureReadsLogged.Logged),
      foundAt: FOUND,
      now: NOW,
    });
    const california: BreachObligation = obligations.find(
      (obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.CaliforniaAttorneyGeneral;
      },
    )!;
    const words: Array<string> = california.checks.map(
      describeBreachCheckInEnglish,
    );

    expect(words).toEqual([
      "If any of the people live in California.",
      "If the numbers were held with people's names: no names were found, but scans can miss them.",
      "If it affects more than 500 people.",
      "If the store's access logs show the data was read from outside your accounts.",
    ]);
  });

  test("what the table does not cover is said, never left silent", () => {
    const kinds: (data: ExposureWhoseData) => Array<UncoveredLawKind> = (
      data: ExposureWhoseData,
    ): Array<UncoveredLawKind> => {
      return getUncoveredLaws(data).map(
        (uncovered: { kind: UncoveredLawKind }): UncoveredLawKind => {
          return uncovered.kind;
        },
      );
    };

    expect(
      getUncoveredLaws(whose({ dataTypeIds: ["jp-my-number"], countries: ["JP"] })),
    ).toEqual(
      expect.arrayContaining([
        { kind: UncoveredLawKind.OtherCountries, countries: ["JP"] },
      ]),
    );
    expect(
      kinds(
        whose({ dataTypeIds: ["email-address"], places: [BreachPlace.Elsewhere] }),
      ),
    ).toContain(UncoveredLawKind.PeopleElsewhere);
    // Nobody said where they live: other states may still be involved.
    expect(kinds(whose({ dataTypeIds: ["email-address"] }))).toEqual([
      UncoveredLawKind.OtherUsStates,
      UncoveredLawKind.Establishment,
      UncoveredLawKind.ContractsAndSectors,
    ]);
    // A person said only the EU: no US state to warn of.
    expect(
      kinds(whose({ dataTypeIds: ["email-address"], places: [BreachPlace.Eea] })),
    ).toEqual([
      UncoveredLawKind.Establishment,
      UncoveredLawKind.ContractsAndSectors,
    ]);
  });
});

describe("the playbook's checklist, answered", () => {
  test("the template writes its tasks from the checklist, in its order", () => {
    const steps: Array<SecurityPlaybookStep> = getSecurityPlaybookTemplateDefinition(
      DATA_EXPOSURE_TEMPLATE_KEY,
    )!.getSteps({ priorityId: () => "", statusId: () => "" });
    const tasks: SecurityPlaybookStep | undefined = steps.find(
      (step: SecurityPlaybookStep): boolean => {
        return step.action === SecurityPlaybookActionType.AddCaseTasks;
      },
    );

    expect((tasks?.config as { tasks: Array<string> }).tasks).toEqual(
      getDataExposureChecklistTaskLines(),
    );
    expect(DATA_EXPOSURE_TEMPLATE.title).toBe("Close a Data Exposure");
    expect(getDataExposureChecklistTaskLines()).toEqual([
      DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.WhoReadIt],
      DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.MustReport],
      DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.RotateSecrets],
      DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.CloseTheCase],
    ]);
  });

  test("a task is matched by its title as the template wrote it, or by its key", () => {
    expect(
      getExposureChecklistItemOfTask({
        title: `  ${DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.RotateSecrets].toUpperCase()} `,
      }),
    ).toBe(ExposureChecklistItem.RotateSecrets);
    expect(
      getExposureChecklistItemOfTask({
        title: "Renamed by a person",
        responseStepKey: getExposureChecklistStepKey(
          ExposureChecklistItem.MustReport,
        ),
      }),
    ).toBe(ExposureChecklistItem.MustReport);
    expect(getExposureChecklistItemOfTask({ title: "Reset the password" })).toBe(
      null,
    );
    expect(getExposureChecklistItemOfTask({})).toBe(null);
  });

  test("each line is answered with the case's task, done or not, when the case has it", () => {
    const answers: Array<ExposureChecklistAnswer> = getExposureChecklistAnswers([
      {
        id: "t1",
        title: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.WhoReadIt],
        isDone: true,
      },
      {
        id: "t2",
        title: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.MustReport],
        isDone: null,
      },
      { id: "t3", title: "Something else" },
    ]);

    expect(answers).toEqual([
      {
        item: ExposureChecklistItem.WhoReadIt,
        taskId: "t1",
        taskTitle: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.WhoReadIt],
        isDone: true,
      },
      {
        item: ExposureChecklistItem.MustReport,
        taskId: "t2",
        taskTitle: DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.MustReport],
        isDone: false,
      },
      { item: ExposureChecklistItem.RotateSecrets },
      { item: ExposureChecklistItem.CloseTheCase },
    ]);
    expect(EXPOSURE_CHECKLIST_ITEMS).toHaveLength(4);
  });
});

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI's drafts, held to the facts
 * ---------------------------------------------------------------------------
 */

function obligationFact(
  data: Partial<BreachObligationFact> & { id: string; family: string },
): BreachObligationFact {
  const ruleId: string = data.ruleId || "gdpr-art-33";

  return {
    key: `obligation:${ruleId}`,
    kind: ComplianceFactKind.BreachObligation,
    ruleId,
    law: data.law || "GDPR Article 33",
    status: data.status || BreachObligationStatus.MayApply,
    action: "Notify the supervisory authority",
    recipient: "The competent supervisory authority",
    deadline: data.deadline || "72 hours from when it was found",
    deadlineAmount: data.deadlineAmount ?? 72,
    deadlineUnit: "Hours",
    dueAt: data.dueAt || "2026-11-05T09:00:00.000Z",
    countsFrom: "2026-11-02T09:00:00.000Z",
    checks: [],
    ...data,
  } as BreachObligationFact;
}

const HOLDS: StoreHoldsFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Email address"],
  categories: ["Contact and identity"],
  sensitivity: "Confidential",
  records: 48000,
};

const WINDOW: ExposureWindowFact = {
  id: "F2",
  key: "exposure:window",
  kind: ComplianceFactKind.ExposureWindow,
  foundAt: "2026-11-02T09:00:00.000Z",
  start: "2026-11-02T09:00:00.000Z",
  startIsExact: false,
  end: "2026-11-11T09:00:00.000Z",
  endKind: "ResponseAction",
  isStillOpen: false,
  hours: 216,
  days: 9,
};

const FACTS: Array<ComplianceFact> = [
  HOLDS,
  WINDOW,
  obligationFact({ id: "F3", family: BreachLawFamily.Gdpr }),
  obligationFact({
    id: "F4",
    family: BreachLawFamily.Hipaa,
    ruleId: "hipaa-164-404",
    law: "HIPAA 45 CFR 164.404",
    status: BreachObligationStatus.NotTriggered,
    deadline: "60 calendar days from when it was found",
    deadlineAmount: 60,
  }),
];

const NOW: Date = new Date("2026-11-12T00:00:00.000Z");

function hold(
  part: ExposureDraftPart,
  markdown: string,
  facts: Array<string> = ["F1", "F2", "F3"],
): HeldExposureDrafts {
  return holdExposureDraftsToFacts({
    answer: { [part]: { markdown, facts } },
    facts: FACTS,
    now: NOW,
  });
}

describe("OneUptime AI's drafts, held to the facts", () => {
  test("a draft that rests on its facts is kept, with the facts' ids taken out of its words", () => {
    const held: HeldExposureDrafts = hold(
      ExposureDraftPart.Explanation,
      "The store holding about 48,000 email addresses was open for 9 days (F1, F2). Under GDPR Article 33 the supervisory authority is due within 72 hours [F3].",
    );
    const section = held.sections[ExposureDraftPart.Explanation]!;

    expect(section.markdown).toBe(
      "The store holding about 48,000 email addresses was open for 9 days. Under GDPR Article 33 the supervisory authority is due within 72 hours.",
    );
    expect(section.source).toBe(ImpactAssessmentSectionSource.Drafted);
    expect(section.factKeys).toEqual([
      "store:holds",
      "exposure:window",
      "obligation:gdpr-art-33",
    ]);
    expect(section.factsHash).toBe(
      getFactsHash({ facts: FACTS, keys: section.factKeys }),
    );
    expect(section.draftedAt).toBe(NOW.toISOString());
    expect(held.dropped).toEqual({});
  });

  test("a number the facts do not hold drops the draft: a count, a date, a deadline", () => {
    for (const text of [
      "The store holding about 50,000 email addresses was open for nine days and must be reported.",
      "It was exposed from 1 November 2026 and the authority must be told within 72 hours.",
      "The supervisory authority must be told within 48 hours of finding it, under GDPR.",
    ]) {
      const held: HeldExposureDrafts = hold(ExposureDraftPart.RegulatorNotice, text);

      expect({ text, kept: Boolean(held.sections.regulatorNotice) }).toEqual({
        text,
        kept: false,
      });
      expect(held.dropped.regulatorNotice).toBe(
        ExposureDraftDropReason.UnfoundedNumber,
      );
    }
  });

  test("dates, times and the law's own numbers the facts hold are kept", () => {
    const held: HeldExposureDrafts = hold(
      ExposureDraftPart.RegulatorNotice,
      "The store was exposed at least since 2 November 2026, 09:00 UTC, until 11 November 2026. GDPR Article 33(1) asks for a notice within 72 hours: by 5 November 2026.",
    );

    expect(held.sections.regulatorNotice).toBeDefined();
  });

  test("a law none of the facts names drops the draft; one the table never covers always does", () => {
    for (const text of [
      "The store held about 48,000 email addresses, which the CCPA protects as personal information.",
      "Notify the authority under PIPEDA within 72 hours of finding the exposure.",
      "Texas residents must be told: the store held about 48,000 email addresses.",
    ]) {
      expect(hold(ExposureDraftPart.InternalSummary, text).dropped).toEqual({
        [ExposureDraftPart.InternalSummary]: ExposureDraftDropReason.UnfoundedLaw,
      });
    }
  });

  test("the explanation and the summary may say a law does not apply; a notice may not cite it", () => {
    const text: string =
      "HIPAA does not apply: the store held about 48,000 email addresses and no health data, and GDPR may apply.";

    expect(
      hold(ExposureDraftPart.InternalSummary, text, ["F1", "F4"]).sections
        .internalSummary,
    ).toBeDefined();
    expect(
      hold(ExposureDraftPart.RegulatorNotice, text, ["F1", "F4"]).dropped
        .regulatorNotice,
    ).toBe(ExposureDraftDropReason.UnfoundedLaw);
    expect(
      hold(ExposureDraftPart.PeopleNotice, text, ["F1", "F4"]).dropped
        .peopleNotice,
    ).toBe(ExposureDraftDropReason.UnfoundedLaw);
  });

  test("UK GDPR is not read as GDPR, nor GDPR as UK GDPR", () => {
    const ukOnly: Array<ComplianceFact> = [
      HOLDS,
      obligationFact({
        id: "F3",
        family: BreachLawFamily.UkGdpr,
        ruleId: "uk-gdpr-art-33",
        law: "UK GDPR Article 33",
      }),
    ];

    expect(
      getUnfoundedLaws({ text: "Under UK GDPR, tell the Commission.", facts: ukOnly }),
    ).toEqual([]);
    expect(
      getUnfoundedLaws({ text: "Under GDPR, tell the authority.", facts: ukOnly }),
    ).toEqual(["GDPR"]);
    expect(
      getUnfoundedLaws({
        text: "Under UK-GDPR, tell the Commission.",
        facts: [HOLDS, obligationFact({ id: "F3", family: BreachLawFamily.Gdpr })],
      }),
    ).toEqual(["UK-GDPR"]);
  });

  test("a draft that cites no fact, or says too little, is dropped", () => {
    expect(
      hold(
        ExposureDraftPart.PeopleNotice,
        "Your email address was in a store that was open to anyone for a while.",
        ["F99"],
      ).dropped.peopleNotice,
    ).toBe(ExposureDraftDropReason.NoFactCited);
    expect(
      hold(ExposureDraftPart.PeopleNotice, "Read it.", ["F1"]).dropped
        .peopleNotice,
    ).toBe(ExposureDraftDropReason.TooShort);
  });

  test("a part not asked for, or not text, is left out", () => {
    const held: HeldExposureDrafts = holdExposureDraftsToFacts({
      answer: {
        explanation: { markdown: 7 as never, facts: ["F1"] },
      },
      facts: FACTS,
      now: NOW,
    });

    expect(held.sections).toEqual({});
    expect(held.dropped).toEqual({});
  });

  test("headings, links and HTML are cleaned out of a draft, and a long one is cut", () => {
    const held: HeldExposureDrafts = hold(
      ExposureDraftPart.InternalSummary,
      [
        "# A heading the page draws itself",
        "The store held about 48,000 email addresses. See [the store](https://evil.example) <b>now</b>.",
        `${"Open for 9 days. ".repeat(500)}`,
      ].join("\n"),
    );
    const markdown: string = held.sections.internalSummary!.markdown;

    expect(markdown).not.toContain("# A heading");
    expect(markdown).not.toContain("evil.example");
    expect(markdown).not.toContain("<b>");
    expect(markdown).toContain("See the store now.");
    expect(Array.from(markdown).length).toBeLessThanOrEqual(6000);
    expect(markdown.endsWith("…")).toBe(true);
  });
});

describe("the assessment a case keeps", () => {
  const started: StoredExposureAssessment = startExposureAssessment({
    dataStoreId: "11111111-1111-4111-8111-111111111111",
    startedBy: ExposureAssessmentStarter.DataSecurity,
    language: "en",
    now: new Date("2026-11-02T09:05:00.000Z"),
  });

  test("starts with nothing drafted, and reads back as it was written", () => {
    expect(started.sections).toEqual({});
    expect(started.facts).toEqual([]);
    expect(readStoredExposureAssessment(toStoredExposureAssessmentJson(started))).toEqual(
      started,
    );
  });

  test("what this build cannot read is no assessment", () => {
    expect(readStoredExposureAssessment(null)).toBeNull();
    expect(readStoredExposureAssessment("text")).toBeNull();
    expect(readStoredExposureAssessment([])).toBeNull();
    expect(readStoredExposureAssessment({ sections: {} })).toBeNull();
  });

  test("a kept section, a person's answer and the facts read back, and junk in them is left out", () => {
    const read: StoredExposureAssessment = readStoredExposureAssessment({
      ...toStoredExposureAssessmentJson(started),
      startedBy: "Person",
      startedByUserId: "22222222-2222-4222-8222-222222222222",
      peopleLiveIn: {
        places: ["EEA", "US-TX", "MARS", 7, "EEA"],
        saidAt: "2026-11-03T00:00:00.000Z",
      },
      sections: {
        regulatorNotice: {
          markdown: "Dear authority, the store held about 48,000 email addresses.",
          source: "Edited",
          factKeys: ["store:holds", 9],
          editedAt: "2026-11-03T00:00:00.000Z",
        },
        peopleNotice: { markdown: "   " },
        nonsense: { markdown: "ignored" },
      },
      facts: [HOLDS, { id: "bad" }],
    })!;

    expect(read.startedBy).toBe(ExposureAssessmentStarter.Person);
    expect(read.peopleLiveIn?.places).toEqual([
      BreachPlace.Eea,
      BreachPlace.Texas,
    ]);
    expect(Object.keys(read.sections)).toEqual([
      ExposureDraftPart.RegulatorNotice,
    ]);
    expect(read.sections.regulatorNotice!.source).toBe(
      ImpactAssessmentSectionSource.Edited,
    );
    expect(read.sections.regulatorNotice!.factKeys).toEqual(["store:holds"]);
    expect(read.facts).toEqual(readComplianceFacts([HOLDS]));
  });

  test("a new draft never writes over a part a person edited", () => {
    const assessment: StoredExposureAssessment = (
      editExposureDraft({
        assessment: started,
        part: ExposureDraftPart.RegulatorNotice,
        markdown: "Our own notice to the authority.",
        facts: FACTS,
        userId: "user-1",
        now: NOW,
      }) as { isDone: true; assessment: StoredExposureAssessment }
    ).assessment;

    expect(getDraftableExposureParts(assessment)).toEqual([
      ExposureDraftPart.Explanation,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]);

    const drafted: HeldExposureDrafts = holdExposureDraftsToFacts({
      answer: {
        regulatorNotice: {
          markdown: "A drafted notice: the store held about 48,000 email addresses.",
          facts: ["F1"],
        },
        explanation: {
          markdown: "The store held about 48,000 email addresses and was open for 9 days.",
          facts: ["F1", "F2"],
        },
      },
      facts: FACTS,
      now: NOW,
    });
    const merged: StoredExposureAssessment = mergeExposureDrafts({
      previous: assessment,
      drafted: drafted.sections,
      facts: FACTS,
      language: "de",
      now: NOW,
    });

    expect(merged.sections.regulatorNotice!.markdown).toBe(
      "Our own notice to the authority.",
    );
    expect(merged.sections.regulatorNotice!.editedByUserId).toBe("user-1");
    expect(merged.sections.explanation!.source).toBe(
      ImpactAssessmentSectionSource.Drafted,
    );
    expect(merged.language).toBe("de");
    expect(merged.facts).toEqual(FACTS);
    expect(merged.draftedAt).toBe(NOW.toISOString());
  });

  test("a part not drafted again keeps its last draft", () => {
    const first: StoredExposureAssessment = mergeExposureDrafts({
      previous: started,
      drafted: hold(
        ExposureDraftPart.PeopleNotice,
        "Your email address was in a store open for 9 days. We closed it.",
      ).sections,
      facts: FACTS,
      language: "en",
      now: NOW,
    });
    const second: StoredExposureAssessment = mergeExposureDrafts({
      previous: first,
      drafted: {},
      facts: FACTS,
      language: "en",
      now: NOW,
    });

    expect(second.sections.peopleNotice!.markdown).toBe(
      first.sections.peopleNotice!.markdown,
    );
  });

  test("a person's empty part is taken out, and a part too long is refused", () => {
    const cleared: { isDone: boolean } = editExposureDraft({
      assessment: {
        ...started,
        sections: {
          internalSummary: {
            part: ExposureDraftPart.InternalSummary,
            markdown: "x".repeat(50),
            source: ImpactAssessmentSectionSource.Drafted,
            factKeys: [],
          },
        },
      },
      part: ExposureDraftPart.InternalSummary,
      markdown: "   ",
      facts: FACTS,
      now: NOW,
    });

    expect(cleared.isDone).toBe(true);
    expect(
      (cleared as { assessment: StoredExposureAssessment }).assessment.sections,
    ).toEqual({});

    const tooLong: { isDone: boolean; refusal?: string } = editExposureDraft({
      assessment: started,
      part: ExposureDraftPart.InternalSummary,
      markdown: "x".repeat(20001),
      facts: FACTS,
      now: NOW,
    });

    expect(tooLong.isDone).toBe(false);
    expect(tooLong.refusal).toContain("longer than an assessment keeps");
  });

  test("a part written over facts that say something else now says so", () => {
    const drafted: StoredExposureAssessment = mergeExposureDrafts({
      previous: started,
      drafted: hold(
        ExposureDraftPart.Explanation,
        "The store held about 48,000 email addresses and was open for 9 days.",
        ["F1", "F2"],
      ).sections,
      facts: FACTS,
      language: "en",
      now: NOW,
    });

    expect(getStaleExposureDraftParts({ assessment: drafted, facts: FACTS })).toEqual(
      [],
    );

    const reopened: Array<ComplianceFact> = FACTS.map(
      (fact: ComplianceFact): ComplianceFact => {
        return fact.key === "exposure:window"
          ? { ...fact, isStillOpen: true, end: undefined }
          : fact;
      },
    );

    expect(
      getStaleExposureDraftParts({ assessment: drafted, facts: reopened }),
    ).toEqual([ExposureDraftPart.Explanation]);

    // A fact it does not cite changing leaves it alone.
    const otherChanged: Array<ComplianceFact> = FACTS.map(
      (fact: ComplianceFact): ComplianceFact => {
        return fact.key === "obligation:gdpr-art-33"
          ? { ...fact, dueAt: "2026-11-06T09:00:00.000Z" }
          : fact;
      },
    );

    expect(
      getStaleExposureDraftParts({ assessment: drafted, facts: otherChanged }),
    ).toEqual([]);
    expect(getStaleExposureDraftParts({ assessment: null, facts: FACTS })).toEqual(
      [],
    );
  });

  test("where the people live: said, each place once, and taken back with none", () => {
    const said: StoredExposureAssessment = setExposurePeoplePlaces({
      assessment: started,
      places: [BreachPlace.Eea, "US-TX", "nowhere", BreachPlace.Eea],
      userId: "user-2",
      now: NOW,
    });

    expect(said.peopleLiveIn).toEqual({
      places: [BreachPlace.Eea, BreachPlace.Texas],
      saidAt: NOW.toISOString(),
      saidByUserId: "user-2",
    });
    expect(
      setExposurePeoplePlaces({ assessment: said, places: [], now: NOW })
        .peopleLiveIn,
    ).toBeUndefined();
  });

  test("every part has its title and its ask, and the notices are the three a person edits", () => {
    for (const part of EXPOSURE_DRAFT_PARTS) {
      expect(EXPOSURE_DRAFT_PART_TITLES[part].length).toBeGreaterThan(5);
      expect(EXPOSURE_DRAFT_PART_ASKS[part].length).toBeGreaterThan(40);
      expect(isExposureDraftPart(part)).toBe(true);
    }

    expect(EXPOSURE_NOTICE_PARTS).toEqual([
      ExposureDraftPart.RegulatorNotice,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]);
    expect(isExposureDraftPart("summary")).toBe(false);
  });
});

describe("the assessment plain code works out", () => {
  test("a public bucket of EU customers' emails, open nine days with reads not logged", () => {
    const now: Date = new Date("2026-11-11T12:00:00.000Z");
    const window: ExposureWindow | null = getExposureWindow({
      issues: [
        issue({
          id: "i1",
          foundAt: "2026-11-02T09:00:00.000Z",
          resolvedAt: "2026-11-11T09:30:00.000Z",
        }),
      ],
      changes: [],
      responses: [{ at: "2026-11-11T09:00:00.000Z", closesExposure: true }],
      now,
    });
    const view: ExposureAssessmentView = buildExposureAssessmentView({
      store: {
        id: "s",
        name: "eu-customer-exports",
        kind: "AWS S3 Bucket",
        region: "eu-west-1",
        sensitivity: DataSensitivity.Confidential,
        exposure: "Public",
      },
      exposureIssues: [],
      window,
      reads: getExposureReads({
        accessLogging: false,
        exposureCheckIds: ["public-read"],
        isStorePublic: true,
        grants: [],
        window,
        now,
      }),
      whose: whose({
        dataTypeIds: ["email-address"],
        countries: ["DE", "FR", "NL"],
        records: 48000,
      }),
      secretsToRotate: [],
      hasMoreSecrets: false,
      now,
    });

    expect(view.window!.days).toBe(9);
    expect(view.window!.startKind).toBe(ExposureWindowStartKind.FirstSeen);
    expect(view.reads.isTreatedAsRead).toBe(true);
    expect(view.whose.countriesFromData).toEqual(["DE", "FR", "NL"]);
    expect(view.whose.dataTypes.map((type) => type.name)).toEqual([
      "Email address",
    ]);
    expect(view.mostUrgent!.ruleId).toBe(BreachLawId.GdprAuthority);
    // 72 hours counted from when it was found: overdue by now.
    expect(view.mostUrgent!.foundAt).toBe(iso("2026-11-02T09:00:00Z"));
    expect(view.mostUrgent!.dueAt).toBe(
      new Date(new Date("2026-11-02T09:00:00Z").getTime() + 72 * HOUR).toISOString(),
    );
    expect(view.isPlaceUnknown).toBe(false);
    expect(view.now).toBe(now.toISOString());
  });

  test("a store with no exposure window counts its deadlines from now", () => {
    const now: Date = new Date("2026-11-11T12:00:00.000Z");
    const view: ExposureAssessmentView = buildExposureAssessmentView({
      store: {
        id: "s",
        name: "s",
        kind: "AWS S3 Bucket",
        sensitivity: DataSensitivity.Restricted,
        exposure: "Private",
      },
      exposureIssues: [],
      window: null,
      reads: readsOf(ExposureReadsLogged.Unknown),
      whose: whose({ dataTypeIds: ["in-aadhaar"], countries: ["IN"] }),
      secretsToRotate: [],
      hasMoreSecrets: false,
      now,
    });

    expect(view.mostUrgent!.ruleId).toBe(BreachLawId.CertIn);
    expect(view.mostUrgent!.dueAt).toBe(
      new Date(now.getTime() + 6 * HOUR).toISOString(),
    );
    expect(DAY).toBe(24 * HOUR);
  });
});
