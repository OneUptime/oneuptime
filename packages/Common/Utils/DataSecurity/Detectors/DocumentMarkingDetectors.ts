import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import { containsAny, DataTypeDetector } from "../Detector";

/*
 * DOCUMENTS THAT SAY WHAT THEY ARE.
 *
 * Contracts, board papers and legal advice are marked by the people who
 * write them - "Attorney-Client Privileged", "Strictly Confidential",
 * "Internal Use Only" - and that marking is the most reliable signal a
 * scanner has about a document it cannot otherwise understand. The word
 * "confidential" on its own is far too common (privacy policies, footers),
 * so only the phrases a marking uses count.
 */

const PRIVILEGED_PATTERN: RegExp =
  /(?<![A-Za-z])(?:attorney[- ]client privileged?|privileged (?:and|&) confidential|legally privileged|privileged communication|attorney work product)(?![A-Za-z])/gi;

const privilegedDetector: DataTypeDetector = {
  dataTypeId: "privileged-document",
  quickCheck: containsAny(["privilege", "work product"]),
  quickCheckLowerCase: true,
  pattern: PRIVILEGED_PATTERN,
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
};

const CONFIDENTIAL_PATTERN: RegExp =
  /(?<![A-Za-z])(?:strictly confidential|highly confidential|company confidential|confidential information|trade secret|confidential[ :-]{1,3}do not (?:distribute|share|forward|copy))(?![A-Za-z])/gi;

const confidentialDetector: DataTypeDetector = {
  dataTypeId: "confidential-document",
  quickCheck: containsAny(["confidential", "trade secret"]),
  quickCheckLowerCase: true,
  pattern: CONFIDENTIAL_PATTERN,
  negativeKeywords: ["privacy policy", "terms of service", "we keep"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
};

const INTERNAL_PATTERN: RegExp =
  /(?<![A-Za-z])(?:internal use only|for internal use|internal only|not for (?:external )?distribution|do not distribute)(?![A-Za-z])/gi;

const internalDetector: DataTypeDetector = {
  dataTypeId: "internal-document",
  quickCheck: containsAny(["internal", "distribut"]),
  quickCheckLowerCase: true,
  pattern: INTERNAL_PATTERN,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
};

export const DOCUMENT_MARKING_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  privilegedDetector,
  confidentialDetector,
  internalDetector,
];

export default DOCUMENT_MARKING_DETECTORS;
