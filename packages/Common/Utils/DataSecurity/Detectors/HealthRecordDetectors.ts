import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  alphanumericUpper,
  DataTypeDetector,
  digitsOnly,
  hasDigit,
  isPlaceholderDigits,
} from "../Detector";

/*
 * HEALTH RECORDS: THE IDENTIFIERS AND CODES OF A PATIENT'S CARE.
 *
 * Unlike national health numbers (HealthIdentifierDetectors.ts), record
 * numbers, member IDs and clinical codes have no shape of their own - a
 * medical record number is whatever a hospital's system issues, and "E11.9"
 * reads like a version number until a diagnosis is mentioned. So each of
 * these counts only beside the words that name it, close by, or in a field
 * named for it.
 */

const MEDICAL_RECORD_PATTERN: RegExp =
  /(?<![A-Za-z0-9-])[A-Z]{0,3}[0-9]{5,12}(?![A-Za-z0-9-])/g;

const medicalRecordDetector: DataTypeDetector = {
  dataTypeId: "medical-record-number",
  quickCheck: hasDigit,
  pattern: MEDICAL_RECORD_PATTERN,
  normalize: alphanumericUpper,
  validate: (normalized: string): boolean => {
    return !isPlaceholderDigits(digitsOnly(normalized));
  },
  keywords: [
    "mrn",
    "medical record",
    "patient id",
    "patient number",
    "chart number",
    "record number",
    "ehr",
  ],
  requiresContext: true,
  contextBefore: 24,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[A-Z]{0,3}-?[0-9]{5,12}$/,
};

const HEALTH_PLAN_PATTERN: RegExp =
  /(?<![A-Za-z0-9-])[A-Z0-9]{2,4}-?[0-9]{4,14}(?![A-Za-z0-9-])/g;

const healthPlanDetector: DataTypeDetector = {
  dataTypeId: "health-plan-id",
  quickCheck: hasDigit,
  pattern: HEALTH_PLAN_PATTERN,
  normalize: alphanumericUpper,
  validate: (normalized: string): boolean => {
    return !isPlaceholderDigits(digitsOnly(normalized));
  },
  keywords: [
    "member id",
    "policy number",
    "insurance id",
    "subscriber id",
    "group number",
    "health plan",
    "beneficiary",
  ],
  requiresContext: true,
  contextBefore: 24,
  contextAfter: 4,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[A-Z0-9]{2,4}-?[0-9]{4,14}$/,
};

/*
 * An ICD-10 code: a letter (never U, which WHO reserves), two characters,
 * and up to four more after a dot - E11.9, J45.909, S72.001A.
 */
// Not the start of a longer dotted token: E11.91234 or a version A12.3.4.
const DIAGNOSIS_CODE_PATTERN: RegExp =
  /(?<![A-Za-z0-9.])[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?(?![A-Za-z0-9]|\.[A-Za-z0-9])/g;

const diagnosisCodeDetector: DataTypeDetector = {
  dataTypeId: "diagnosis-code",
  quickCheck: hasDigit,
  pattern: DIAGNOSIS_CODE_PATTERN,
  keywords: [
    "icd",
    "icd-10",
    "icd10",
    "diagnosis",
    "dx",
    "condition",
    "diagnosed",
  ],
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[A-TV-Z][0-9][0-9AB](?:\.?[0-9A-TV-Z]{1,4})?$/,
};

// A National Drug Code in one of its three 10-digit layouts.
const DRUG_CODE_PATTERN: RegExp =
  /(?<![0-9-])(?:[0-9]{4}-[0-9]{4}-[0-9]{2}|[0-9]{5}-[0-9]{3}-[0-9]{2}|[0-9]{5}-[0-9]{4}-[0-9])(?![0-9-])/g;

const drugCodeDetector: DataTypeDetector = {
  dataTypeId: "drug-code",
  quickCheck: hasDigit,
  pattern: DRUG_CODE_PATTERN,
  keywords: ["ndc", "drug", "medication", "prescription", "rx"],
  requiresContext: true,
  contextBefore: 32,
  contextAfter: 8,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  fieldValuePattern: /^[0-9]{4,5}-?[0-9]{3,4}-?[0-9]{1,2}$/,
};

export const HEALTH_RECORD_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  medicalRecordDetector,
  healthPlanDetector,
  diagnosisCodeDetector,
  drugCodeDetector,
];

export default HEALTH_RECORD_DETECTORS;
