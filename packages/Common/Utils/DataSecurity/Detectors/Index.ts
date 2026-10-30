import { DataTypeDetector } from "../Detector";
import CONTACT_DETECTORS from "./ContactDetectors";
import DOCUMENT_MARKING_DETECTORS from "./DocumentMarkingDetectors";
import FINANCIAL_DETECTORS from "./FinancialDetectors";
import GOVERNMENT_ID_DETECTORS from "./GovernmentIdDetectors";
import HEALTH_IDENTIFIER_DETECTORS from "./HealthIdentifierDetectors";
import HEALTH_RECORD_DETECTORS from "./HealthRecordDetectors";
import SECRET_DETECTORS from "./SecretDetectors";

/*
 * EVERY BUILT-IN DETECTOR, IN THE ORDER THE SCANNER RUNS THEM.
 *
 * Secrets first: they are the most damaging finding and their literal
 * prefixes make them the cheapest to rule out. A data type may have several
 * detectors (a card number grouped and ungrouped, a phone number in each
 * national format); the scanner counts them as one type.
 * DetectorCatalog.test.ts checks that every value-found type of the
 * catalog has at least one detector here and that every detector names a
 * type the catalog knows.
 */
export const BUILT_IN_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  ...SECRET_DETECTORS,
  ...FINANCIAL_DETECTORS,
  ...GOVERNMENT_ID_DETECTORS,
  ...HEALTH_IDENTIFIER_DETECTORS,
  ...HEALTH_RECORD_DETECTORS,
  ...CONTACT_DETECTORS,
  ...DOCUMENT_MARKING_DETECTORS,
];

let detectorsByType: Map<string, Array<DataTypeDetector>> | null = null;

export function getBuiltInDetectorsOf(
  dataTypeId: string,
): ReadonlyArray<DataTypeDetector> {
  if (!detectorsByType) {
    detectorsByType = new Map();

    for (const detector of BUILT_IN_DETECTORS) {
      const list: Array<DataTypeDetector> =
        detectorsByType.get(detector.dataTypeId) || [];

      list.push(detector);
      detectorsByType.set(detector.dataTypeId, list);
    }
  }

  return detectorsByType.get(dataTypeId) || [];
}

export default BUILT_IN_DETECTORS;
