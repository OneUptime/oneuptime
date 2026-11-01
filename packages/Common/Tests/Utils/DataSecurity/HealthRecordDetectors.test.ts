import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import HEALTH_RECORD_DETECTORS from "../../../Utils/DataSecurity/Detectors/HealthRecordDetectors";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * RECORD NUMBERS, MEMBER IDS AND CLINICAL CODES, AS THE SCANNER FINDS THEM.
 *
 * None has a shape of its own, so each counts only next to the words that
 * name it, close by, or in a field named for it. Everywhere else the same
 * characters are an order number, a version, a date: nothing.
 */

interface Found {
  dataTypeId: string;
  value: string;
  confidence: DataConfidence;
}

function scan(text: string): Array<Found> {
  return findSensitiveValues(text, { detectors: HEALTH_RECORD_DETECTORS }).map(
    (match: TextMatch) => {
      return {
        dataTypeId: match.dataTypeId,
        value: text.slice(match.start, match.end),
        confidence: match.confidence,
      };
    },
  );
}

function expectFound(text: string, dataTypeId: string, value: string): void {
  expect([text, scan(text)]).toEqual([
    text,
    [{ dataTypeId, value, confidence: DataConfidence.High }],
  ]);
}

function expectNothingOf(dataTypeId: string, texts: Array<string>): void {
  for (const text of texts) {
    expect([
      text,
      scan(text).filter((match: Found) => {
        return match.dataTypeId === dataTypeId;
      }),
    ]).toEqual([text, []]);
  }
}

function classified(
  fieldPath: string,
  values: Array<unknown>,
  dataTypeId: string,
): FieldClassification | undefined {
  return classifyField(fieldPath, values, {
    detectors: HEALTH_RECORD_DETECTORS,
  }).find((result: FieldClassification) => {
    return result.dataTypeId === dataTypeId;
  });
}

describe("medical-record-number", () => {
  test("is found right after the words that name it", () => {
    expectFound("MRN: 00483920", "medical-record-number", "00483920");
    expectFound(
      "admitted, mrn MR0483920, ward 4",
      "medical-record-number",
      "MR0483920",
    );
    expectFound('{"patient id":"7392011"}', "medical-record-number", "7392011");
    expectFound(
      "medical record 4839201733",
      "medical-record-number",
      "4839201733",
    );
  });

  test("is nothing without those words, at the wrong length, inside a token or a placeholder", () => {
    expectNothingOf("medical-record-number", [
      "id 00483920",
      "00483920",
      "MRN 1234",
      "MRN 1234567890123",
      "mrn x00483920",
      "MRN 11111111",
      "MRN 12345678",
    ]);
  });

  test("is nothing when the words are too far away", () => {
    expectNothingOf("medical-record-number", [
      "MRN was not recorded for this visit; invoice 00483920",
    ]);
  });

  test("is found in a column named for it, with or without a dash", () => {
    expect(
      classified(
        "patient_mrn",
        ["MR-0483920", "00483921", "ab7392011"],
        "medical-record-number",
      ),
    ).toMatchObject({
      confidence: DataConfidence.High,
      matchCount: 2,
      valuesWithMatch: 2,
      nameHinted: true,
    });
  });
});

describe("health-plan-id", () => {
  test("is found right after the words that name it", () => {
    expectFound("Member ID: XKP83920174", "health-plan-id", "XKP83920174");
    expectFound("policy number ABC-83920174", "health-plan-id", "ABC-83920174");
    expectFound("subscriber id 98ZX2039", "health-plan-id", "98ZX2039");
  });

  test("is nothing without those words, too short or a placeholder", () => {
    expectNothingOf("health-plan-id", [
      "group 83920174",
      "XKP83920174",
      "member id 1234",
      "member id XKP-11111111",
    ]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified(
        "insurance_id",
        ["XKP83920174", "ABC-83920175"],
        "health-plan-id",
      ),
    ).toMatchObject({ confidence: DataConfidence.High, matchCount: 2 });
  });
});

describe("diagnosis-code", () => {
  test("is an ICD-10 code next to diagnosis words", () => {
    expectFound(
      "Diagnosis: E11.9 (type 2 diabetes)",
      "diagnosis-code",
      "E11.9",
    );
    expectFound("ICD-10 J45.909", "diagnosis-code", "J45.909");
    expectFound("dx S72.001A", "diagnosis-code", "S72.001A");
    expectFound("diagnosis code E11.", "diagnosis-code", "E11");
  });

  test("reads like a version number without those words", () => {
    expectNothingOf("diagnosis-code", [
      "E11.9",
      "version E11.9",
      "release A12.3",
    ]);
  });

  test("refuses U codes, wrong shapes and the start of a longer dotted token", () => {
    expectNothingOf("diagnosis-code", [
      "diagnosis U07.1",
      "diagnosis E1.9",
      "diagnosis E11.91234",
      "diagnosis A12.3.4",
      "diagnosis xE11.9",
    ]);
  });

  test("is found in a column named for it, with or without the dot", () => {
    expect(
      classified(
        "diagnosis_code",
        ["E119", "J45.909", "I10"],
        "diagnosis-code",
      ),
    ).toMatchObject({ confidence: DataConfidence.High, matchCount: 3 });
  });
});

describe("drug-code", () => {
  test("is a National Drug Code in each of its layouts, next to drug words", () => {
    expectFound("NDC 0002-3227-30", "drug-code", "0002-3227-30");
    expectFound("rx: 50090-2875-1", "drug-code", "50090-2875-1");
    expectFound("drug code 12345-678-90", "drug-code", "12345-678-90");
  });

  test("is nothing without those words or in another layout", () => {
    expectNothingOf("drug-code", [
      "0002-3227-30",
      "ndc 0002-32270-30",
      "ndc 00023227 30",
      "ndc 10002-3227-30-1",
    ]);
  });

  test("is found in a column named for it", () => {
    expect(
      classified("ndc", ["0002322730", "50090-2875-1"], "drug-code"),
    ).toMatchObject({
      confidence: DataConfidence.High,
      matchCount: 2,
    });
  });
});
