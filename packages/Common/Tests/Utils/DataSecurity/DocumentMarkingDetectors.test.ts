import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import DOCUMENT_MARKING_DETECTORS from "../../../Utils/DataSecurity/Detectors/DocumentMarkingDetectors";
import { maskValue } from "../../../Utils/DataSecurity/Masking";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";

/*
 * DOCUMENTS THAT SAY WHAT THEY ARE.
 *
 * Only the phrases a marking uses count, in any case; the word
 * "confidential" alone, a privacy policy's promise and an "internal server
 * error" do not.
 */

interface Found {
  dataTypeId: string;
  value: string;
  confidence: DataConfidence;
}

function scan(text: string): Array<Found> {
  return findSensitiveValues(text, {
    detectors: DOCUMENT_MARKING_DETECTORS,
  }).map((match: TextMatch) => {
    return {
      dataTypeId: match.dataTypeId,
      value: text.slice(match.start, match.end),
      confidence: match.confidence,
    };
  });
}

function expectFound(
  text: string,
  dataTypeId: string,
  value: string,
  confidence: DataConfidence,
): void {
  expect([text, scan(text)]).toEqual([
    text,
    [{ dataTypeId, value, confidence }],
  ]);
}

describe("privileged-document", () => {
  test("is found from a privilege marking, High on its own", () => {
    expectFound(
      "ATTORNEY-CLIENT PRIVILEGED\nMemo to the board",
      "privileged-document",
      "ATTORNEY-CLIENT PRIVILEGED",
      DataConfidence.High,
    );
    expectFound(
      "Privileged & Confidential - prepared at the request of counsel",
      "privileged-document",
      "Privileged & Confidential",
      DataConfidence.High,
    );
    expectFound(
      "This memo is legally privileged.",
      "privileged-document",
      "legally privileged",
      DataConfidence.High,
    );
    expectFound(
      "Attorney Work Product",
      "privileged-document",
      "Attorney Work Product",
      DataConfidence.High,
    );
  });

  test("is not found in other uses of the word", () => {
    expect(scan("Turn on privileged access management for admins.")).toEqual(
      [],
    );
    expect(scan("unprivileged communication-channels")).toEqual([]);
  });
});

describe("confidential-document", () => {
  test("is found from a confidentiality marking, Medium on its own", () => {
    for (const marking of [
      "STRICTLY CONFIDENTIAL",
      "Highly Confidential",
      "Company Confidential",
      "Trade Secret",
      "Confidential - do not distribute",
    ]) {
      expectFound(
        `${marking}\nQ3 board deck`,
        "confidential-document",
        marking,
        DataConfidence.Medium,
      );
    }
  });

  test("is not found from the word alone, or inside a longer word", () => {
    expect(scan("This is confidential.")).toEqual([]);
    expect(scan("unconfidentially")).toEqual([]);
  });

  test("is Low where a privacy policy promises to keep things confidential", () => {
    expectFound(
      "We keep your information strictly confidential as our privacy policy says.",
      "confidential-document",
      "strictly confidential",
      DataConfidence.Low,
    );
  });
});

describe("internal-document", () => {
  test("is found from an internal-only marking", () => {
    for (const marking of [
      "INTERNAL USE ONLY",
      "For internal use",
      "Not for external distribution",
      "Do Not Distribute",
    ]) {
      expectFound(marking, "internal-document", marking, DataConfidence.Medium);
    }
  });

  test("is not found in internal server errors or adverbs", () => {
    expect(scan("500 internal server error, handled internally")).toEqual([]);
  });
});

describe("a marking's sample", () => {
  test("is kept as written, since it is what the document says about itself", () => {
    expect(maskValue("confidential-document", "STRICTLY CONFIDENTIAL")).toBe(
      "STRICTLY CONFIDENTIAL",
    );
    expect(maskValue("privileged-document", "Attorney Work Product")).toBe(
      "Attorney Work Product",
    );
  });
});
