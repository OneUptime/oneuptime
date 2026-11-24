import { describe, expect, test } from "@jest/globals";
import {
  classifyContent,
  classifyContentWithModel,
  ContentClassification,
} from "../../../../../Server/Utils/DataSecurity/Content/ContentClassifier";
import {
  ContentScanOptions,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { FingerprintAccumulator } from "../../../../../Server/Utils/DataSecurity/Fingerprint";
import { ModelBudget } from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  CONTENT_STORE_KEY,
  getModelWarnings,
  ModelScanContext,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelScan";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import { FieldClassification } from "../../../../../Utils/DataSecurity/FieldClassifier";
import FakeEntityRecognizer, { ISSUE_SENTENCE } from "./FakeEntityRecognizer";

/*
 * An object of a bucket, read with the names-and-addresses model: its free
 * text, and its free-text fields, are what the model reads; everything else
 * is classified as before.
 */

function options(model?: ModelScanContext | undefined): ContentScanOptions {
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
    model,
  };
}

function modelOf(
  recognizer: FakeEntityRecognizer,
  storeLimitInMs: number = 1e9,
): ModelScanContext {
  return {
    recognizer,
    budget: new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs }),
  };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function classificationsAt(
  classification: ContentClassification,
  location: string,
): Record<string, FieldClassification> {
  const found: LocationFindings | undefined = classification.locations.find(
    (item: LocationFindings): boolean => {
      return item.location === location;
    },
  );

  return Object.fromEntries(
    (found?.classifications || []).map((item: FieldClassification) => {
      return [item.dataTypeId, item];
    }),
  );
}

const LOG: string = [
  "2026-11-24T10:00:01Z INFO checkout started for cart 4471",
  `2026-11-24T10:00:02Z INFO ${ISSUE_SENTENCE}`,
  "2026-11-24T10:00:03Z INFO payment captured",
].join("\n");

describe("classifyContentWithModel", () => {
  test("the issue's sentence in a log file is a person name and a street address of its text", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const classification: ContentClassification =
      await classifyContentWithModel({
        name: "logs/app-2026-11-24.log",
        bytes: bytes(LOG),
        options: options(modelOf(recognizer)),
        fingerprints: new FingerprintAccumulator("test-project-key"),
      });
    const found: Record<string, FieldClassification> = classificationsAt(
      classification,
      "",
    );

    expect(classification.locations[0]?.locationKind).toBe(
      DataStoreLocationKind.Text,
    );
    expect(found["person-name"]).toEqual(
      expect.objectContaining({
        matchCount: 1,
        confidence: DataConfidence.Medium,
        maskedSamples: ["M****"],
        isFreeText: true,
        foundByModel: true,
      }),
    );
    expect(found["postal-address"]).toEqual(
      expect.objectContaining({ matchCount: 1, maskedSamples: ["1****"] }),
    );
    // The line it is on is one of the records holding sensitive data.
    expect(classification.recordsWithSensitive).toBe(1);
    expect(classification.recordCount).toBe(3);
    // The model was given the text once.
    expect(recognizer.given).toEqual([LOG]);
  });

  test("a CSV's free-text column is read by the model; its other columns are not", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const csv: string = [
      "id,status,notes",
      `1,refunded,"${ISSUE_SENTENCE}. The customer called twice about it and was happy with the outcome."`,
      `2,shipped,"The parcel left the warehouse on time and the tracking number was sent by email."`,
    ].join("\n");
    const classification: ContentClassification =
      await classifyContentWithModel({
        name: "exports/tickets.csv",
        bytes: bytes(csv),
        options: options(modelOf(recognizer)),
        fingerprints: new FingerprintAccumulator("test-project-key"),
      });

    expect(
      classificationsAt(classification, "notes")["person-name"]?.foundByModel,
    ).toBe(true);
    expect(classificationsAt(classification, "status")).toEqual({});
    expect(
      recognizer.given.every((text: string): boolean => {
        return text !== "refunded" && text !== "shipped";
      }),
    ).toBe(true);
  });

  test("without the model it is classifyContent, exactly", async () => {
    const input: Parameters<typeof classifyContent>[0] = {
      name: "logs/app.log",
      bytes: bytes(LOG),
      options: options(),
      fingerprints: new FingerprintAccumulator("test-project-key"),
    };

    expect(await classifyContentWithModel(input)).toEqual(
      classifyContent(input),
    );
  });

  test("when the model finds nothing, the content is classified once, and its fingerprints are added once", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      phrases: [],
    });
    const text: string = `Contact: alice@corp.example.org\n${"filler line\n".repeat(3)}`;
    const withModel: FingerprintAccumulator = new FingerprintAccumulator("k");
    const without: FingerprintAccumulator = new FingerprintAccumulator("k");
    const input: Omit<
      Parameters<typeof classifyContent>[0],
      "fingerprints" | "options"
    > = {
      name: "notes.txt",
      bytes: bytes(text),
    };

    const modelResult: ContentClassification = await classifyContentWithModel({
      ...input,
      options: options(modelOf(recognizer)),
      fingerprints: withModel,
    });
    const plain: ContentClassification = classifyContent({
      ...input,
      options: options(),
      fingerprints: without,
    });

    expect(modelResult).toEqual(plain);
    expect(withModel.getFingerprints()).toEqual(without.getFingerprints());
    expect(recognizer.calls).toBe(1);
  });

  test("when the model finds something, the fingerprints are still the detectors' alone: a name is never fingerprinted", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const text: string = `${ISSUE_SENTENCE}\nContact: alice@corp.example.org`;
    const withModel: FingerprintAccumulator = new FingerprintAccumulator("k");
    const without: FingerprintAccumulator = new FingerprintAccumulator("k");

    await classifyContentWithModel({
      name: "notes.txt",
      bytes: bytes(text),
      options: options(modelOf(recognizer)),
      fingerprints: withModel,
    });
    classifyContent({
      name: "notes.txt",
      bytes: bytes(text),
      options: options(),
      fingerprints: without,
    });

    expect(Object.keys(withModel.getFingerprints())).not.toContain(
      "person-name",
    );
    expect(withModel.getFingerprints()).toEqual(without.getFingerprints());
  });

  test("a key or a certificate is never given to the model", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();

    await classifyContentWithModel({
      name: "certs/server.pem",
      bytes: bytes(
        `-----BEGIN CERTIFICATE-----\n${ISSUE_SENTENCE}\n-----END CERTIFICATE-----`,
      ),
      options: options(modelOf(recognizer)),
      fingerprints: new FingerprintAccumulator("k"),
    });

    expect(recognizer.given).toEqual([]);
  });

  test("a letter in a text file is read as free text by the model", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const classification: ContentClassification =
      await classifyContentWithModel({
        name: "letters/refund.txt",
        bytes: bytes(`Dear customer,\n\n${ISSUE_SENTENCE}.\n\nKind regards`),
        options: options(modelOf(recognizer)),
        fingerprints: new FingerprintAccumulator("k"),
      });

    expect(
      classificationsAt(classification, "")["postal-address"],
    ).toBeDefined();
  });

  test("once the store's model time is used, objects are classified without it, and the store's warning says how much was read", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      millisecondsPerText: 10,
    });
    const model: ModelScanContext = modelOf(recognizer, 10);

    const first: ContentClassification = await classifyContentWithModel({
      name: "a.log",
      bytes: bytes(LOG),
      options: options(model),
      fingerprints: new FingerprintAccumulator("k"),
    });
    const second: ContentClassification = await classifyContentWithModel({
      name: "b.log",
      bytes: bytes(`${LOG}\nanother line`),
      options: options(model),
      fingerprints: new FingerprintAccumulator("k"),
    });

    expect(classificationsAt(first, "")["person-name"]).toBeDefined();
    expect(classificationsAt(second, "")["person-name"]).toBeUndefined();
    expect(getModelWarnings(model, CONTENT_STORE_KEY)).toEqual([
      "Names and street addresses were looked for in 1 of 2 free-text values: this store's 1 second of model time ran out.",
    ]);
  });
});
