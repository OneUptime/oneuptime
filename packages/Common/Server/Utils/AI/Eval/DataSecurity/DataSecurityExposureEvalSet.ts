import {
  BREACH_LAW_RULES,
  BreachLawId,
  BreachLawRule,
  BreachPlace,
  isUsStateRule,
} from "../../../../../Types/DataSecurity/BreachLaws";
import { getCloudRegionLocation } from "../../../../../Types/DataSecurity/CloudRegionCountry";
import { getBuiltInDataType } from "../../../../../Types/DataSecurity/DataTypeCatalog";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import {
  buildExposureAssessmentView,
  ExposureAssessmentView,
  ExposureChangeDirection,
  ExposureGrant,
  ExposureIssueEvent,
  ExposureIssueFacts,
  ExposureResponseEntry,
  ExposureSecret,
  ExposureStoreChange,
  ExposureWindow,
  getExposureReads,
  getExposureWindow,
  getWhoseData,
} from "../../../../../Types/DataSecurity/ExposureAssessment";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import DataSecurityAiInput, {
  AiComplianceFacts,
  AiStoreRecord,
} from "../../DataSecurity/DataSecurityAiInput";

/*
 * THE EXPOSURE EVAL SET (#10377): MADE-UP EXPOSURES, AND THE OBLIGATIONS
 * EACH SHOULD LIST.
 *
 * Each exposure is made up - no customer's store, no customer's data - in
 * the shapes the product reads (ExposureAssessmentReader): the store as
 * its configuration says it, its exposure issues and their timelines, the
 * changes of the cloud's log, Data Security's own responses, who can reach
 * it, the secrets found in it, and where a person said the people live.
 * The product's plain code works each one out (getExposureEvalView), and
 * its test holds what it lists to what the exposure should list:
 *
 *   - mayApplyKnown: the notices that may apply where some of the people
 *     are known to live, or wherever they live;
 *   - mayApplyIfPlace: those that may apply if any of the people live
 *     where they apply - the places nobody knows yet;
 *   - notYetInForce: those that take effect later;
 *   - every other row of the table: not triggered;
 *   - the notice due first, and when.
 *
 * The same exposures are the eval's cases for OneUptime AI's write-up
 * (DataSecurityExposureEvalCases), asked with the product's own builder.
 */

export interface ExposureEvalExpectation {
  isAssessedOnItsOwn: boolean;
  mayApplyKnown: Array<BreachLawId>;
  mayApplyIfPlace: Array<BreachLawId>;
  notYetInForce: Array<BreachLawId>;
  mostUrgent: BreachLawId | null;
  // ISO 8601, when there is a notice due first.
  mostUrgentDueAt?: string | undefined;
  readsTreatedAsRead: boolean;
  windowDays?: number | undefined;
  isPlaceUnknown: boolean;
}

export interface ExposureEvalExposure {
  id: string;
  title: string;
  store: AiStoreRecord;
  storeFirstSeenAt?: string | undefined;
  issues: Array<ExposureIssueFacts>;
  changes?: Array<ExposureStoreChange> | undefined;
  responses?: Array<ExposureResponseEntry> | undefined;
  grants?: Array<ExposureGrant> | undefined;
  secrets?: Array<ExposureSecret> | undefined;
  placesNamed?: Array<BreachPlace> | undefined;
  people?: Array<string> | undefined;
  now: string;
  expect: ExposureEvalExpectation;
}

// A store as the assessment reads it.
function store(
  data: Partial<AiStoreRecord> & {
    name: string;
    dataTypeIds: Array<string>;
    accessLogging?: boolean | null | undefined;
  },
): AiStoreRecord {
  const { accessLogging, ...rest } = data;

  return {
    kind: DataStoreKind.AwsS3Bucket,
    provider: "aws",
    environment: DataStoreEnvironment.Production,
    sensitivity: DataSensitivity.Confidential,
    exposure: DataStoreExposure.Public,
    isPublicByDesign: false,
    subjectCountries: [],
    posture:
      accessLogging === undefined ? {} : { accessLogging: accessLogging },
    ...rest,
  } as AiStoreRecord;
}

// An exposure issue, open since it was found or resolved since.
function issue(data: {
  id: string;
  checkId: string;
  title: string;
  severity?: SecuritySeverity | undefined;
  foundAt: string;
  resolvedAt?: string | undefined;
}): ExposureIssueFacts {
  return {
    id: data.id,
    checkId: data.checkId,
    title: data.title,
    severity: data.severity || SecuritySeverity.Critical,
    status: data.resolvedAt ? "Resolved" : "Open",
    firstDetectedAt: data.foundAt,
    resolvedAt: data.resolvedAt,
    timeline: [
      { event: ExposureIssueEvent.Opened, at: data.foundAt },
      ...(data.resolvedAt
        ? [{ event: ExposureIssueEvent.Resolved, at: data.resolvedAt }]
        : []),
    ],
  };
}

const NOT_YET: Array<BreachLawId> = [
  BreachLawId.DpdpPeople,
  BreachLawId.DpdpBoard,
];

// The notices any personal data brings in, wherever its people may live.
const PERSONAL_DATA_IF_PLACE: Array<BreachLawId> = [
  BreachLawId.GdprAuthority,
  BreachLawId.GdprPeople,
  BreachLawId.UkGdprAuthority,
  BreachLawId.UkGdprPeople,
  BreachLawId.LgpdAuthority,
  BreachLawId.LgpdPeople,
  BreachLawId.CertIn,
];

// The states whose laws cover another government's ID number, as each statute lists it.
const OTHER_GOVERNMENT_ID_STATES: Array<BreachLawId> = [
  BreachLawId.CaliforniaResidents,
  BreachLawId.CaliforniaAttorneyGeneral,
  BreachLawId.ColoradoResidents,
  BreachLawId.ColoradoAttorneyGeneral,
  BreachLawId.FloridaIndividuals,
  BreachLawId.FloridaDepartment,
  BreachLawId.TexasIndividuals,
  BreachLawId.TexasAttorneyGeneral,
  // #10952's, each as its statute lists another government ID number.
  BreachLawId.AlabamaResidents,
  BreachLawId.AlabamaAttorneyGeneral,
  BreachLawId.ConnecticutResidents,
  BreachLawId.ConnecticutAttorneyGeneral,
  BreachLawId.DelawareResidents,
  BreachLawId.DelawareAttorneyGeneral,
  BreachLawId.DistrictOfColumbiaResidents,
  BreachLawId.DistrictOfColumbiaAttorneyGeneral,
  BreachLawId.IowaResidents,
  BreachLawId.IowaAttorneyGeneral,
  BreachLawId.MarylandResidents,
  BreachLawId.MarylandAttorneyGeneral,
  BreachLawId.MississippiResidents,
  BreachLawId.MissouriResidents,
  BreachLawId.MissouriAttorneyGeneral,
  BreachLawId.MontanaResidents,
  BreachLawId.MontanaAttorneyGeneral,
  BreachLawId.NewHampshireResidents,
  BreachLawId.NewHampshireAttorneyGeneral,
  BreachLawId.NewMexicoResidents,
  BreachLawId.NewMexicoAttorneyGeneral,
];

/*
 * Every US state's notices: each state's law covers a Social Security
 * number held with a name (UsStateBreachLaws.test.ts holds each row to its
 * statute), so they all wait on which states the people live in.
 */
const EVERY_US_STATE_ROW: Array<BreachLawId> = BREACH_LAW_RULES.filter(
  (rule: BreachLawRule): boolean => {
    return isUsStateRule(rule);
  },
).map((rule: BreachLawRule): BreachLawId => {
  return rule.id;
});

export const EXPOSURE_EVAL_EXPOSURES: Array<ExposureEvalExposure> = [
  {
    id: "eu-customer-emails-public",
    title:
      "A public bucket of EU customers' emails, open for nine days with reads not logged",
    store: store({
      name: "eu-customer-exports",
      region: "eu-west-1",
      dataTypeIds: ["email-address", "person-name"],
      estimatedRecords: 48000,
      subjectCountries: ["DE", "FR", "NL"],
      accessLogging: false,
    }),
    storeFirstSeenAt: "2026-09-01T00:00:00.000Z",
    issues: [
      issue({
        id: "a1b2c3d4-0001-4000-8000-000000000001",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-02T09:00:00.000Z",
        resolvedAt: "2026-11-11T09:30:00.000Z",
      }),
    ],
    responses: [{ at: "2026-11-11T09:00:00.000Z", closesExposure: true }],
    now: "2026-11-11T12:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [BreachLawId.GdprAuthority, BreachLawId.GdprPeople],
      mayApplyIfPlace: [
        BreachLawId.UkGdprAuthority,
        BreachLawId.UkGdprPeople,
        BreachLawId.LgpdAuthority,
        BreachLawId.LgpdPeople,
        BreachLawId.CertIn,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.GdprAuthority,
      mostUrgentDueAt: "2026-11-05T09:00:00.000Z",
      readsTreatedAsRead: true,
      windowDays: 9,
      isPlaceUnknown: false,
    },
  },
  {
    id: "website-images-public",
    title: "A bucket of website images, public, with nothing personal in it",
    store: store({
      name: "acme-website-assets",
      region: "us-east-1",
      sensitivity: DataSensitivity.Public,
      dataTypeIds: [],
      estimatedRecords: 3200,
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0002-4000-8000-000000000002",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        severity: SecuritySeverity.Low,
        foundAt: "2026-11-20T10:00:00.000Z",
      }),
    ],
    now: "2026-11-20T11:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: false,
      mayApplyKnown: [],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: null,
      readsTreatedAsRead: true,
      isPlaceUnknown: true,
    },
  },
  {
    id: "us-patient-records-texas",
    title:
      "Patient records shared with an outside account, logged, about people in Texas",
    store: store({
      name: "clinic-claims-archive",
      region: "us-east-2",
      sensitivity: DataSensitivity.Restricted,
      exposure: DataStoreExposure.OtherAccounts,
      dataTypeIds: [
        "medical-record-number",
        "health-plan-id",
        "person-name",
        "us-ssn",
      ],
      estimatedRecords: 12000,
      subjectCountries: ["US"],
      accessLogging: true,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0003-4000-8000-000000000003",
        checkId: "shared-with-external-accounts",
        title: "An account outside your company can read it",
        foundAt: "2026-11-16T15:30:00.000Z",
      }),
    ],
    grants: [
      {
        principal: "arn:aws:iam::999999999999:root",
        isExternal: true,
        lastUsedAt: "2026-11-17T08:00:00.000Z",
      },
    ],
    placesNamed: [BreachPlace.Texas],
    now: "2026-11-18T09:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.TexasAttorneyGeneral,
        BreachLawId.HipaaPeople,
        BreachLawId.HipaaMedia,
        BreachLawId.HipaaSecretaryLarge,
        BreachLawId.HipaaBusinessAssociate,
        BreachLawId.TexasIndividuals,
        BreachLawId.HipaaSecretarySmall,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.TexasAttorneyGeneral,
      mostUrgentDueAt: "2026-12-16T15:30:00.000Z",
      readsTreatedAsRead: false,
      isPlaceUnknown: false,
    },
  },
  {
    id: "brazil-cpf-emails",
    title:
      "Brazilian CPF numbers and emails, public, found on a Friday, logging unknown",
    store: store({
      name: "loja-clientes-backup",
      kind: DataStoreKind.GcpStorageBucket,
      provider: "gcp",
      region: "southamerica-east1",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["br-cpf", "email-address"],
      estimatedRecords: 230000,
      subjectCountries: ["BR"],
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0004-4000-8000-000000000004",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-20T18:00:00.000Z",
      }),
    ],
    now: "2026-11-21T10:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [BreachLawId.LgpdAuthority, BreachLawId.LgpdPeople],
      mayApplyIfPlace: [
        ...PERSONAL_DATA_IF_PLACE.filter((id: BreachLawId): boolean => {
          return (
            id !== BreachLawId.LgpdAuthority && id !== BreachLawId.LgpdPeople
          );
        }),
        ...OTHER_GOVERNMENT_ID_STATES,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.LgpdAuthority,
      // Friday 18:00 UTC, three business days: Wednesday 18:00 UTC.
      mostUrgentDueAt: "2026-11-25T18:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "india-aadhaar-public",
    title: "Aadhaar numbers, public, before India's DPDP Rule 7 takes effect",
    store: store({
      name: "kyc-documents",
      region: "ap-south-1",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["in-aadhaar", "person-name"],
      estimatedRecords: 9000,
      subjectCountries: ["IN"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0005-4000-8000-000000000005",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-23T04:00:00.000Z",
      }),
    ],
    now: "2026-11-23T05:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [BreachLawId.CertIn],
      mayApplyIfPlace: [
        BreachLawId.GdprAuthority,
        BreachLawId.GdprPeople,
        BreachLawId.UkGdprAuthority,
        BreachLawId.UkGdprPeople,
        BreachLawId.LgpdAuthority,
        BreachLawId.LgpdPeople,
        ...OTHER_GOVERNMENT_ID_STATES,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.CertIn,
      mostUrgentDueAt: "2026-11-23T10:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "india-aadhaar-after-dpdp",
    title: "Aadhaar numbers, public, once DPDP Rule 7 is in force",
    store: store({
      name: "kyc-documents",
      region: "ap-south-1",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["in-aadhaar", "person-name"],
      estimatedRecords: 9000,
      subjectCountries: ["IN"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0006-4000-8000-000000000006",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2027-06-02T04:00:00.000Z",
      }),
    ],
    now: "2027-06-02T05:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.CertIn,
        BreachLawId.DpdpBoard,
        BreachLawId.DpdpPeople,
      ],
      mayApplyIfPlace: [
        BreachLawId.GdprAuthority,
        BreachLawId.GdprPeople,
        BreachLawId.UkGdprAuthority,
        BreachLawId.UkGdprPeople,
        BreachLawId.LgpdAuthority,
        BreachLawId.LgpdPeople,
        ...OTHER_GOVERNMENT_ID_STATES,
      ],
      notYetInForce: [],
      mostUrgent: BreachLawId.CertIn,
      mostUrgentDueAt: "2027-06-02T10:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "california-cards-credentials",
    title:
      "Card numbers with their codes and logins, shared outside, about Californians and others",
    store: store({
      name: "checkout-events",
      region: "us-west-1",
      sensitivity: DataSensitivity.Restricted,
      exposure: DataStoreExposure.OtherAccounts,
      dataTypeIds: [
        "credit-card-number",
        "card-verification-code",
        "email-address",
        "generic-secret",
        "person-name",
      ],
      estimatedRecords: 1800,
      accessLogging: true,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0007-4000-8000-000000000007",
        checkId: "shared-with-external-accounts",
        title: "An account outside your company can read it",
        foundAt: "2026-11-10T12:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.California, BreachPlace.Elsewhere],
    now: "2026-11-12T12:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.CaliforniaResidents,
        BreachLawId.CaliforniaAttorneyGeneral,
        BreachLawId.PciDss,
        // The card brands' own rules (#10953): Mastercard's 24 hours first.
        BreachLawId.VisaCompromise,
        BreachLawId.MastercardAdcEvent,
        BreachLawId.AmericanExpressDataIncident,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.MastercardAdcEvent,
      mostUrgentDueAt: "2026-11-11T12:00:00.000Z",
      readsTreatedAsRead: false,
      isPlaceUnknown: false,
    },
  },
  {
    id: "uk-nino-snapshot",
    title:
      "A payroll snapshot with UK National Insurance numbers shared with another account",
    store: store({
      name: "payroll-db-snapshot",
      kind: DataStoreKind.AwsRdsSnapshot,
      region: "eu-west-2",
      sensitivity: DataSensitivity.Restricted,
      exposure: DataStoreExposure.OtherAccounts,
      dataTypeIds: ["uk-nino", "person-name", "bank-account-number"],
      estimatedRecords: 2400,
      subjectCountries: ["GB"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0008-4000-8000-000000000008",
        checkId: "snapshot-shared-externally",
        title: "A snapshot is shared with another account",
        foundAt: "2026-11-19T22:00:00.000Z",
      }),
    ],
    now: "2026-11-20T08:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [BreachLawId.UkGdprAuthority, BreachLawId.UkGdprPeople],
      mayApplyIfPlace: [
        BreachLawId.GdprAuthority,
        BreachLawId.GdprPeople,
        BreachLawId.LgpdAuthority,
        BreachLawId.LgpdPeople,
        BreachLawId.CertIn,
        // A bank account number held with a name: every state's law covers it.
        ...EVERY_US_STATE_ROW,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.UkGdprAuthority,
      mostUrgentDueAt: "2026-11-22T22:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "secrets-only-bucket",
    title:
      "A public bucket of build artifacts holding cloud keys, nothing personal",
    store: store({
      name: "ci-artifacts",
      region: "us-east-1",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["aws-secret-access-key", "private-key"],
      estimatedRecords: 40,
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0009-4000-8000-000000000009",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-22T13:00:00.000Z",
      }),
    ],
    secrets: [
      {
        dataTypeId: "aws-secret-access-key",
        dataTypeName: "AWS secret access key",
        location: "deploy/env.sh",
        locationKind: "Object path",
        isStillThere: true,
      },
      {
        dataTypeId: "private-key",
        dataTypeName: "Private key",
        location: "keys/*.pem",
        locationKind: "Object path",
        isStillThere: true,
      },
    ],
    now: "2026-11-22T14:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: null,
      readsTreatedAsRead: true,
      isPlaceUnknown: true,
    },
  },
  {
    id: "new-york-ssn-no-names",
    title: "Social Security numbers with no names found, about New Yorkers",
    store: store({
      name: "tax-forms-2025",
      region: "us-east-1",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["us-ssn"],
      estimatedRecords: 700,
      subjectCountries: ["US"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0010-4000-8000-000000000010",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-03T16:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.NewYork],
    now: "2026-11-04T10:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.NewYorkResidents,
        BreachLawId.NewYorkAgencies,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.NewYorkResidents,
      mostUrgentDueAt: "2026-12-03T16:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "colorado-and-florida-licenses",
    title:
      "Driver's license numbers with names, about people in Colorado and Florida",
    store: store({
      name: "drivers-onboarding",
      region: "us-west-2",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["us-drivers-license", "person-name"],
      estimatedRecords: 650,
      subjectCountries: ["US"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0011-4000-8000-000000000011",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-12T08:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.Colorado, BreachPlace.Florida],
    now: "2026-11-12T20:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.ColoradoResidents,
        BreachLawId.ColoradoAttorneyGeneral,
        BreachLawId.FloridaIndividuals,
        BreachLawId.FloridaDepartment,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.ColoradoResidents,
      mostUrgentDueAt: "2026-12-12T08:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "washington-dates-of-birth",
    title:
      "Members' names and dates of birth, about people in Washington, logged",
    store: store({
      name: "members-profile-export",
      region: "us-west-2",
      dataTypeIds: ["date-of-birth", "person-name", "email-address"],
      estimatedRecords: 5200,
      accessLogging: true,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0012-4000-8000-000000000012",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-05T11:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.Washington],
    now: "2026-11-06T11:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.WashingtonConsumers,
        BreachLawId.WashingtonAttorneyGeneral,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.WashingtonConsumers,
      mostUrgentDueAt: "2026-12-05T11:00:00.000Z",
      readsTreatedAsRead: false,
      isPlaceUnknown: false,
    },
  },
  {
    id: "newsletter-emails-place-unknown",
    title: "Newsletter emails, public, and nobody knows where the people live",
    store: store({
      name: "newsletter-signups",
      region: "us-east-1",
      dataTypeIds: ["email-address"],
      estimatedRecords: 15000,
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0013-4000-8000-000000000013",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-24T06:00:00.000Z",
      }),
    ],
    now: "2026-11-24T07:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [],
      mayApplyIfPlace: PERSONAL_DATA_IF_PLACE,
      notYetInForce: NOT_YET,
      mostUrgent: null,
      readsTreatedAsRead: true,
      isPlaceUnknown: true,
    },
  },
  {
    id: "japan-my-number",
    title:
      "Japanese My Number IDs shared outside: a country the table does not cover",
    store: store({
      name: "jp-payroll",
      region: "ap-northeast-1",
      sensitivity: DataSensitivity.Restricted,
      exposure: DataStoreExposure.OtherAccounts,
      dataTypeIds: ["jp-my-number", "person-name"],
      estimatedRecords: 800,
      subjectCountries: ["JP"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0014-4000-8000-000000000014",
        checkId: "shared-with-external-accounts",
        title: "An account outside your company can read it",
        foundAt: "2026-11-18T01:00:00.000Z",
      }),
    ],
    now: "2026-11-18T02:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [],
      mayApplyIfPlace: [
        ...PERSONAL_DATA_IF_PLACE,
        ...OTHER_GOVERNMENT_ID_STATES,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: null,
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "exposed-by-a-logged-change",
    title:
      "A bucket a policy change opened, logged by the cloud, closed by its owner's change",
    store: store({
      name: "partner-reports",
      region: "eu-central-1",
      dataTypeIds: ["email-address", "person-name"],
      estimatedRecords: 2600,
      subjectCountries: ["DE"],
      accessLogging: false,
    }),
    storeFirstSeenAt: "2026-10-01T00:00:00.000Z",
    issues: [
      issue({
        id: "a1b2c3d4-0015-4000-8000-000000000015",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
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
    now: "2026-11-10T12:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [BreachLawId.GdprAuthority, BreachLawId.GdprPeople],
      mayApplyIfPlace: [
        BreachLawId.UkGdprAuthority,
        BreachLawId.UkGdprPeople,
        BreachLawId.LgpdAuthority,
        BreachLawId.LgpdPeople,
        BreachLawId.CertIn,
      ],
      notYetInForce: NOT_YET,
      mostUrgent: BreachLawId.GdprAuthority,
      // Counted from when it was found, not from the change that exposed it.
      mostUrgentDueAt: "2026-11-12T10:15:00.000Z",
      readsTreatedAsRead: true,
      windowDays: 0,
      isPlaceUnknown: false,
    },
  },
  {
    id: "us-ssn-state-not-said",
    title:
      "Payroll Social Security numbers with names, about people in the US, and nobody said which states",
    store: store({
      name: "payroll-export-2026",
      region: "us-east-2",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["us-ssn", "person-name"],
      estimatedRecords: 1800,
      subjectCountries: ["US"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0016-4000-8000-000000000016",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-25T10:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.UnitedStates],
    now: "2026-11-25T12:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [],
      // Every state's, until a person says which states the people live in.
      mayApplyIfPlace: EVERY_US_STATE_ROW,
      notYetInForce: NOT_YET,
      mostUrgent: null,
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
  {
    id: "indiana-and-hawaii-ssn",
    title:
      "Members' Social Security numbers with names, about people in Indiana and Hawaii",
    store: store({
      name: "member-benefits",
      region: "us-east-2",
      sensitivity: DataSensitivity.Restricted,
      dataTypeIds: ["us-ssn", "person-name"],
      estimatedRecords: 2400,
      subjectCountries: ["US"],
      accessLogging: false,
    }),
    issues: [
      issue({
        id: "a1b2c3d4-0017-4000-8000-000000000017",
        checkId: "public-read",
        title: "Anyone on the internet can read it",
        foundAt: "2026-11-26T09:00:00.000Z",
      }),
    ],
    placesNamed: [BreachPlace.Indiana, BreachPlace.Hawaii],
    now: "2026-11-26T15:00:00.000Z",
    expect: {
      isAssessedOnItsOwn: true,
      mayApplyKnown: [
        BreachLawId.HawaiiResidents,
        BreachLawId.HawaiiConsumerProtection,
        BreachLawId.IndianaResidents,
        BreachLawId.IndianaAttorneyGeneral,
      ],
      mayApplyIfPlace: [],
      notYetInForce: NOT_YET,
      // Indiana's 45 days; Hawaii's notices have no length of time.
      mostUrgent: BreachLawId.IndianaResidents,
      mostUrgentDueAt: "2027-01-10T09:00:00.000Z",
      readsTreatedAsRead: true,
      isPlaceUnknown: false,
    },
  },
];

// An exposure as the product's plain code works it out (ExposureAssessmentReader's view).
export function getExposureEvalView(
  exposure: ExposureEvalExposure,
): ExposureAssessmentView {
  const now: Date = new Date(exposure.now);
  const window: ExposureWindow | null = getExposureWindow({
    issues: exposure.issues,
    changes: exposure.changes || [],
    responses: exposure.responses || [],
    storeFirstSeenAt: exposure.storeFirstSeenAt || null,
    now,
  });
  const location: ReturnType<typeof getCloudRegionLocation> =
    getCloudRegionLocation(exposure.store.region);

  return buildExposureAssessmentView({
    store: {
      id: `store-${exposure.id}`,
      name: exposure.store.name || "",
      kind: exposure.store.kind || "",
      provider: exposure.store.provider || undefined,
      region: exposure.store.region || undefined,
      environment: exposure.store.environment || undefined,
      sensitivity: exposure.store.sensitivity || DataSensitivity.Public,
      exposure: exposure.store.exposure || DataStoreExposure.Unknown,
    },
    exposureIssues: exposure.issues.map((item: ExposureIssueFacts) => {
      return {
        id: item.id,
        checkId: item.checkId,
        title: item.title || "",
        severity: item.severity || "",
        status: item.status || "",
        firstDetectedAt: item.firstDetectedAt
          ? new Date(item.firstDetectedAt).toISOString()
          : undefined,
        resolvedAt: item.resolvedAt
          ? new Date(item.resolvedAt).toISOString()
          : undefined,
      };
    }),
    window,
    reads: getExposureReads({
      accessLogging: exposure.store.posture?.accessLogging,
      exposureCheckIds: exposure.issues.map(
        (item: ExposureIssueFacts): string => {
          return item.checkId;
        },
      ),
      isStorePublic: exposure.store.exposure === DataStoreExposure.Public,
      grants: exposure.grants || [],
      window,
      now,
    }),
    whose: getWhoseData({
      dataTypes: (exposure.store.dataTypeIds || []).map((id: string) => {
        return {
          id,
          name: getBuiltInDataType(id)?.name || id,
          category: getBuiltInDataType(id)?.category || "",
        };
      }),
      estimatedRecords: exposure.store.estimatedRecords,
      subjectCountries: exposure.store.subjectCountries || [],
      placesNamed: exposure.placesNamed,
      region: exposure.store.region,
      regionCountry: location?.country || undefined,
      regionIsInEea: location ? location.isInEea : undefined,
      people: exposure.people,
    }),
    secretsToRotate: exposure.secrets || [],
    hasMoreSecrets: false,
    now,
  });
}

// The facts OneUptime AI is told of an exposure, as the product builds them.
export function getExposureEvalFacts(
  exposure: ExposureEvalExposure,
): AiComplianceFacts {
  return DataSecurityAiInput.exposureAssessmentFacts({
    dossier: { store: exposure.store, view: getExposureEvalView(exposure) },
  });
}

export function getExposureEvalExposure(id: string): ExposureEvalExposure {
  const found: ExposureEvalExposure | undefined = EXPOSURE_EVAL_EXPOSURES.find(
    (exposure: ExposureEvalExposure): boolean => {
      return exposure.id === id;
    },
  );

  if (!found) {
    throw new Error(`No exposure ${id} in the eval set.`);
  }

  return found;
}
