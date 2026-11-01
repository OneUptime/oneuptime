import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import { SECRET_DETECTORS } from "../../../Utils/DataSecurity/Detectors/SecretDetectors";
import { MAX_SCANNED_TEXT_LENGTH } from "../../../Utils/DataSecurity/TextScanner";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SECRET DETECTORS READ TEXT ANYONE MAY WRITE - a log line, an object
 * in a bucket - in windows of up to 4 MiB, so a pattern must take time in
 * line with the text whatever it holds. Three of them have repeats a
 * regular expression checker reads as polynomial (the fields of an Azure
 * SAS token, a connection string's look ahead to its next ";", the name
 * before a generic secret's key word); each repeat is capped, so they are
 * linear in fact. This holds them to it: each one's worst case - the input
 * the checker built against it - at the scanner's whole window is read in
 * well under the time a scan has, where a polynomial pattern takes minutes.
 */

interface WorstCase {
  dataTypeId: string;
  unit: string;
  tail: string;
}

const WORST_CASES: ReadonlyArray<WorstCase> = [
  { dataTypeId: "azure-sas-token", unit: "sv=2032-10-02&sig=", tail: "\u0000" },
  { dataTypeId: "connection-string-password", unit: "PWD='=", tail: "\n" },
  { dataTypeId: "generic-secret", unit: "Y-", tail: "" },
];

// About 0.3 to 0.7 s on a laptop; a polynomial pattern takes minutes.
const LIMIT_IN_MS: number = 5000;

function detector(dataTypeId: string): DataTypeDetector {
  const found: DataTypeDetector | undefined = SECRET_DETECTORS.find(
    (candidate: DataTypeDetector): boolean => {
      return candidate.dataTypeId === dataTypeId;
    },
  );

  if (!found) {
    throw new Error(`No detector ${dataTypeId}`);
  }

  return found;
}

function worstCase(entry: WorstCase, length: number): string {
  return (
    entry.unit.repeat(Math.ceil(length / entry.unit.length)).slice(0, length) +
    entry.tail
  );
}

describe("the secret detectors on their worst case", () => {
  test.each(WORST_CASES)(
    "$dataTypeId reads the scanner's whole window in time in line with it",
    (entry: WorstCase) => {
      const pattern: RegExp = detector(entry.dataTypeId).pattern;
      const text: string = worstCase(entry, MAX_SCANNED_TEXT_LENGTH);

      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          pattern.lastIndex = 0;
          return Array.from(text.matchAll(pattern)).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      // Nothing in a worst case is a secret.
      expect(timed.result).toBe(0);
      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
    120000,
  );
});
