import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { ExposureDraftPart } from "../../../../../Types/DataSecurity/ExposureAssessment";
import { getExposureEvalExposure } from "./DataSecurityExposureEvalSet";
import { ExposureAssessmentEvalCase } from "./DataSecurityEvalCase";

/*
 * THE EXPOSURE WRITE-UP'S EVAL CASES (#10377): EXPOSURES FROM THE EVAL SET,
 * AND WHAT A GOOD WRITE-UP OF EACH SAYS.
 *
 * Each case's input is the product's own: the exposure worked out by its
 * plain code (DataSecurityExposureEvalSet), its facts built by the input
 * builder, its words the prompt's. Its answer is held to the facts as the
 * product holds it - a number or a law none of them holds drops the part -
 * and each part kept says what the case names: the notice due first and
 * its deadline, that the data is to be treated as read when reads were not
 * logged, whose data it was, and the secrets to rotate. A write-up never
 * says nobody read data whose reads were not logged.
 */

// What no write-up of an exposure whose reads were not logged says.
const NEVER_UNREAD: Array<string> = [
  "nobody read",
  "no one read",
  "was not read",
  "were not accessed",
  "was not accessed",
];

export const EXPOSURE_ASSESSMENT_CASES: Array<ExposureAssessmentEvalCase> = [
  {
    id: "exposure-eu-customer-emails",
    title:
      "A public bucket of EU customers' emails, open nine days, reads not logged: GDPR's 72 hours and treat as read",
    feature: DataSecurityAiFeature.DraftExposureAssessment,
    exposure: getExposureEvalExposure("eu-customer-emails-public"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [
          ["72"],
          ["GDPR"],
          ["treat", "treated"],
        ],
        [ExposureDraftPart.RegulatorNotice]: [
          ["email"],
          ["48,000", "48000"],
          ["2026"],
        ],
        [ExposureDraftPart.PeopleNotice]: [["email"]],
        [ExposureDraftPart.InternalSummary]: [
          ["not logged", "weren't logged", "were not logged"],
          ["9 days", "nine days"],
        ],
      },
      never: NEVER_UNREAD,
    },
  },
  {
    id: "exposure-texas-patient-records",
    title:
      "Patient records shared outside, about Texans, reads logged: the attorney general's 30 days first, HIPAA if a covered entity",
    feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    exposure: getExposureEvalExposure("us-patient-records-texas"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [["Texas"], ["30"]],
        [ExposureDraftPart.InternalSummary]: [
          ["HIPAA"],
          ["covered entity"],
          ["logged"],
        ],
        [ExposureDraftPart.PeopleNotice]: [["health", "medical"]],
      },
      never: ["nobody read", "no one read"],
    },
  },
  {
    id: "exposure-brazil-cpf",
    title: "Brazilian CPF numbers, public: the ANPD within three business days",
    feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    exposure: getExposureEvalExposure("brazil-cpf-emails"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [
          ["ANPD", "LGPD"],
          ["3", "three"],
        ],
        [ExposureDraftPart.RegulatorNotice]: [["CPF"]],
      },
      never: NEVER_UNREAD,
    },
  },
  {
    id: "exposure-california-cards",
    title:
      "Card numbers and logins, shared outside, about Californians: Mastercard's 24 hours first, then the other brands and California's 30 days",
    feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    exposure: getExposureEvalExposure("california-cards-credentials"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [["Mastercard"], ["24"]],
        [ExposureDraftPart.InternalSummary]: [
          ["PCI"],
          ["card"],
          ["California"],
          ["Visa"],
        ],
        [ExposureDraftPart.PeopleNotice]: [["password"]],
      },
      never: ["nobody read", "no one read"],
    },
  },
  {
    id: "exposure-indiana-and-hawaii",
    title:
      "Social Security numbers about people in Indiana and Hawaii: Indiana's 45 days first, Hawaii's without unreasonable delay (#10952)",
    feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    exposure: getExposureEvalExposure("indiana-and-hawaii-ssn"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [["Indiana"], ["45"]],
        [ExposureDraftPart.RegulatorNotice]: [["Social Security"]],
        [ExposureDraftPart.InternalSummary]: [["Hawaii"], ["Indiana"]],
      },
      never: NEVER_UNREAD,
    },
  },
  {
    id: "exposure-us-states-not-said",
    title:
      "Social Security numbers about people in the US, nobody said which states: every state's law waits on it, and no draft names one (#10952)",
    feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
    exposure: getExposureEvalExposure("us-ssn-state-not-said"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [["states", "state"]],
        [ExposureDraftPart.InternalSummary]: [
          ["Social Security"],
          ["states", "state"],
        ],
      },
      never: NEVER_UNREAD,
    },
  },
  {
    id: "exposure-secrets-only",
    title:
      "A public bucket of cloud keys and nothing personal: no breach law, rotate the keys",
    feature: DataSecurityAiFeature.DraftExposureAssessment,
    exposure: getExposureEvalExposure("secrets-only-bucket"),
    expect: {
      parts: {
        [ExposureDraftPart.Explanation]: [["rotate"], ["key"]],
        [ExposureDraftPart.InternalSummary]: [["deploy/env.sh"], ["rotate"]],
      },
      never: NEVER_UNREAD,
    },
  },
];
