import { describe, expect, test } from "@jest/globals";
import {
  classifyContent,
  ContentClassification,
} from "../../../../Server/Utils/DataSecurity/Content/ContentClassifier";
import { mergeClassifications } from "../../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import { readProbeScanResult } from "../../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { FingerprintAccumulator } from "../../../../Server/Utils/DataSecurity/Fingerprint";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import { JSONObject } from "../../../../Types/JSON";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";

/*
 * EVERY WAY A SCAN'S FINDING REACHES THE WRITER SAYS HOW IT WAS FOUND
 * (#11502).
 *
 * A finding found only with what is around it - a US ZIP code beside "zip",
 * a lone coordinate under `lat`, a "123" under `cvv` - says so
 * (foundByContext), so the finding it becomes says so (isFoundByContext)
 * and Data Security's coverage counts no Custom Regex rule of the type's
 * shapes for it. A bucket's objects say so line by line and field by
 * field, two objects of one place added together say so when either does,
 * and a probe's report keeps it - only as true, never as anything a probe
 * could put there instead.
 * ---------------------------------------------------------------------------
 */

function options(): ContentScanOptions {
  return {
    limits: {
      maxObjects: 100,
      maxBytesPerObject: 1024 * 1024,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 1000,
      maxTables: 100,
      deadline: new Date(Date.now() + 60_000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
  };
}

function classify(name: string, text: string): ContentClassification {
  return classifyContent({
    name,
    bytes: Buffer.from(text, "utf8"),
    options: options(),
    fingerprints: new FingerprintAccumulator("test-project-key"),
  });
}

function findingOf(
  result: ContentClassification,
  location: string,
  dataTypeId: string,
): FieldClassification {
  const found: FieldClassification | undefined = result.locations
    .find((findings: LocationFindings): boolean => {
      return findings.location === location;
    })
    ?.classifications.find((classification: FieldClassification): boolean => {
      return classification.dataTypeId === dataTypeId;
    });

  if (!found) {
    throw new Error(`No ${dataTypeId} at "${location}".`);
  }

  return found;
}

function classification(
  overrides: Partial<FieldClassification> = {},
): FieldClassification {
  return {
    dataTypeId: "postal-code",
    matchCount: 3,
    testValueCount: 0,
    confidence: DataConfidence.Medium,
    maskedSamples: ["9****"],
    distinctValues: 3,
    distinctValuesCapped: false,
    matchRatio: 1,
    valueCount: 3,
    valuesWithMatch: 3,
    isFreeText: false,
    nameHinted: true,
    foundByName: false,
    ...overrides,
  };
}

describe("an object's content says which findings were found only with what is around them", () => {
  test("a text file's line with a ZIP code beside its word", () => {
    const result: ContentClassification = classify(
      "notes/shipping.txt",
      "Ship order 1182 to zip 94107 by Friday.\nReturn order 1183 to SW1A 2AA.",
    );

    expect(findingOf(result, "", "postal-code").foundByContext).toBe(true);
  });

  test("a text file of postcodes found by their shape alone says nothing of it", () => {
    const result: ContentClassification = classify(
      "notes/returns.txt",
      "Return order 1183 to SW1A 2AA.\nReturn order 1184 to EC1A 1BB.",
    );
    const found: FieldClassification = findingOf(result, "", "postal-code");

    expect(found.matchCount).toBe(2);
    expect(found).not.toHaveProperty("foundByContext");
  });

  test("a CSV's column named for ZIP codes, and one of e-mail addresses beside it", () => {
    const result: ContentClassification = classify(
      "exports/addresses.csv",
      [
        "name,email,zip",
        "Ada,ada.lovelace@acme-corp.com,94107",
        "Grace,grace.hopper@acme-corp.com,10001",
        "Alan,alan.turing@acme-corp.com,60614",
      ].join("\n"),
    );

    expect(findingOf(result, "zip", "postal-code").foundByContext).toBe(true);
    expect(findingOf(result, "email", "email-address")).not.toHaveProperty(
      "foundByContext",
    );
  });

  test("a JSON document's coordinates: one under its key is found so, a pair in one value by its shape", () => {
    const result: ContentClassification = classify(
      "data/places.json",
      JSON.stringify([
        { lat: 37.77493, where: "37.77493, -122.41942" },
        { lat: 51.50722, where: "51.50722, -0.12750" },
        { lat: -33.86882, where: "-33.86882, 151.20930" },
      ]),
    );

    expect(findingOf(result, "lat", "geolocation").foundByContext).toBe(true);
    expect(findingOf(result, "where", "geolocation")).not.toHaveProperty(
      "foundByContext",
    );
  });
});

describe("two findings of one type in one place, added together", () => {
  test("are found so when either was", () => {
    const byWord: FieldClassification = classification({
      foundByContext: true,
    });
    const byShape: FieldClassification = classification();

    expect(mergeClassifications(byWord, byShape).foundByContext).toBe(true);
    expect(mergeClassifications(byShape, byWord).foundByContext).toBe(true);
    expect(mergeClassifications(byWord, byWord).foundByContext).toBe(true);
  });

  test("say nothing of it when neither was, as classifyField writes them", () => {
    const merged: FieldClassification = mergeClassifications(
      classification(),
      classification({ foundByContext: false }),
    );

    expect(merged).not.toHaveProperty("foundByContext");
    expect(merged).not.toHaveProperty("foundByModel");
  });

  test("keep the model's mark apart from it, each from whichever said it", () => {
    const merged: FieldClassification = mergeClassifications(
      classification({ foundByModel: true }),
      classification({ foundByContext: true }),
    );

    expect(merged.foundByModel).toBe(true);
    expect(merged.foundByContext).toBe(true);
    expect(merged.matchCount).toBe(6);
  });
});

describe("a probe's report keeps it, only as true", () => {
  function reportOf(classificationJson: JSONObject): unknown {
    return {
      locations: [
        {
          location: "public.orders.zip",
          locationKind: DataStoreLocationKind.Column,
          classifications: [
            {
              dataTypeId: "postal-code",
              matchCount: 3,
              testValueCount: 0,
              confidence: DataConfidence.Medium,
              maskedSamples: ["9****"],
              distinctValues: 3,
              distinctValuesCapped: false,
              valueCount: 3,
              valuesWithMatch: 3,
              isFreeText: false,
              nameHinted: true,
              foundByName: false,
              ...classificationJson,
            },
          ],
        },
      ],
    };
  }

  function readFrom(classificationJson: JSONObject): FieldClassification {
    const result: ContentScanResult | null = readProbeScanResult(
      reportOf(classificationJson),
      (dataTypeId: string): boolean => {
        return dataTypeId === "postal-code";
      },
    );

    return result!.locations[0]!.classifications[0]!;
  }

  test("a classification a probe found so is read as found so", () => {
    expect(readFrom({ foundByContext: true }).foundByContext).toBe(true);
  });

  test.each([
    ["a probe of a release before it, which says nothing", {}],
    ["false", { foundByContext: false }],
    ["the text true", { foundByContext: "true" }],
    ["one", { foundByContext: 1 }],
    ["a map", { foundByContext: { value: true } }],
    ["null", { foundByContext: null }],
  ])(
    "anything else is not kept: %s",
    (_label: string, classificationJson: JSONObject) => {
      const read: FieldClassification = readFrom(classificationJson);

      expect(read.dataTypeId).toBe("postal-code");
      expect(read).not.toHaveProperty("foundByContext");
    },
  );

  test("it is kept beside the model's mark, each as the probe said it", () => {
    const read: FieldClassification = readFrom({
      foundByContext: true,
      foundByModel: true,
    });

    expect(read.foundByContext).toBe(true);
    expect(read.foundByModel).toBe(true);
  });
});
