import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import { sampleObjectStore } from "../../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import {
  ContentScanOptions,
  ContentScanResult,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { ModelBudget } from "../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  CONTENT_STORE_KEY,
  createModelScanContext,
  getModelWarnings,
  ModelPlace,
  ModelScanContext,
  recognizeTexts,
} from "../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  checkModelFiles,
  ModelFilesCheck,
  NAME_ADDRESS_MODEL,
} from "../../../../Server/Utils/DataSecurity/Model/NameAddressModelFiles";
import { RecognizerAvailability } from "../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import {
  getTelemetrySource,
  getUnreadSourceWarning,
  RESTRICTED_CONVERSATIONS_WARNING,
  TelemetrySampleSource,
} from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import logger from "../../../../Server/Utils/Logger";
import {
  ReadScanWarning,
  readScanWarning,
  ScanWarningKey,
} from "../../../../Types/DataSecurity/ScanWarnings";
import FakeEntityRecognizer from "./Model/FakeEntityRecognizer";

/*
 * THE WARNINGS SCANS WRITE, READ BACK AS THEIR SENTENCES (#10930).
 *
 * The scan warnings' templates are what a scan's details draw in the
 * reader's language - but only a warning the scanner wrote from one of them
 * can be. These run the scanner's own writers - a model that is not
 * installed, not the pinned file or would not start, on a server and on a
 * probe; a bucket whose objects cannot be read for every reason a reader
 * has; a telemetry store of each kind that could not be read - and read
 * each warning back: every one is a template's, with its values.
 */

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 50,
    maxBytesPerObject: 65536,
    maxBytesTotal: 10 * 1024 * 1024,
    maxRowsPerTable: 100,
    maxTables: 10,
    deadline: new Date(Date.now() + 60 * 60 * 1000),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "scan-warnings-written",
};

function expectRead(
  warning: string,
  key: ScanWarningKey,
  values?: Record<string, string | number>,
): void {
  const read: ReadScanWarning | null = readScanWarning(warning);

  expect({ warning, key: read?.key }).toEqual({ warning, key });

  if (values) {
    expect(read?.values).toEqual(values);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the names-and-addresses model's warnings", () => {
  async function warningsOf(data: {
    place: ModelPlace;
    getRecognizer: () => Promise<RecognizerAvailability>;
  }): Promise<Array<string>> {
    const context: ModelScanContext | undefined = await createModelScanContext({
      isEnabled: true,
      scope: "content",
      place: data.place,
      getRecognizer: data.getRecognizer,
    });

    await recognizeTexts(context, CONTENT_STORE_KEY, [
      "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid",
    ]);

    return getModelWarnings(context, CONTENT_STORE_KEY);
  }

  test("a model whose files are not installed, on a server and on a probe", async () => {
    const empty: string = fs.mkdtempSync(path.join(os.tmpdir(), "ner-f-"));

    try {
      const check: ModelFilesCheck = await checkModelFiles(empty);

      expect(check.isReady).toBe(false);

      const reason: string = check.isReady ? "" : check.reason;
      const file: string = NAME_ADDRESS_MODEL.files[0]!.name;

      for (const [place, key] of [
        ["server", "modelNotInstalledOnServer"],
        ["probe", "modelNotInstalledOnProbe"],
      ] as Array<[ModelPlace, ScanWarningKey]>) {
        const warnings: Array<string> = await warningsOf({
          place,
          getRecognizer: async (): Promise<RecognizerAvailability> => {
            return { reason };
          },
        });

        expect(warnings.length).toBe(1);
        expectRead(warnings[0]!, key, { file });
      }
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a model file that is not the pinned one, on a server and on a probe", async () => {
    const directory: string = fs.mkdtempSync(path.join(os.tmpdir(), "ner-f-"));
    const file: string = NAME_ADDRESS_MODEL.files[0]!.name;

    try {
      fs.writeFileSync(path.join(directory, file), "not the model");

      const check: ModelFilesCheck = await checkModelFiles(directory);
      const reason: string = check.isReady ? "" : check.reason;

      for (const [place, key] of [
        ["server", "modelNotPinnedOnServer"],
        ["probe", "modelNotPinnedOnProbe"],
      ] as Array<[ModelPlace, ScanWarningKey]>) {
        const warnings: Array<string> = await warningsOf({
          place,
          getRecognizer: async (): Promise<RecognizerAvailability> => {
            return { reason };
          },
        });

        expectRead(warnings[0]!, key, { file });
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a model that would not start, on a server and on a probe", async () => {
    for (const [place, key] of [
      ["server", "modelCouldNotStartOnServer"],
      ["probe", "modelCouldNotStartOnProbe"],
    ] as Array<[ModelPlace, ScanWarningKey]>) {
      const warnings: Array<string> = await warningsOf({
        place,
        getRecognizer: async (): Promise<RecognizerAvailability> => {
          throw new Error("worker exited");
        },
      });

      expectRead(warnings[0]!, key, {});
    }
  });

  test("a model that stopped part-way through the scan", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const warnings: Array<string> = await warningsOf({
      place: "server",
      getRecognizer: async (): Promise<RecognizerAvailability> => {
        return {
          recognizer: new FakeEntityRecognizer({
            failWith: new Error("thread died"),
          }),
        };
      },
    });

    expectRead(warnings[0]!, "modelStoppedPartWay", {});
  });

  test("a model that ran out of a store's time, and of the scan's", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 60_000,
      storeLimitInMs: 6_000,
    });
    const store: ReturnType<ModelBudget["forStore"]> = budget.forStore("a");

    store.charge(6_000);
    store.canSpend();
    store.noteValues({ toRead: 500, read: 120 });
    expectRead(store.getWarnings()[0]!, "modelStoreTimeRanOut", {
      read: 120,
      total: 500,
      limit: 6_000,
    });

    const other: ReturnType<ModelBudget["forStore"]> = budget.forStore("b");

    other.charge(5_000);
    budget.charge(60_000);
    other.canSpend();
    other.noteValues({ toRead: 9, read: 2 });
    expectRead(other.getWarnings()[0]!, "modelScanTimeRanOut", {
      read: 2,
      total: 9,
      limit: 60_000,
    });
  });
});

describe("a bucket whose objects cannot be read", () => {
  class Bucket implements ObjectStoreReader {
    public readonly description: string = "s3://acme-data";
    private readonly objects: Map<string, Buffer>;
    private readonly failing: Set<string>;

    public constructor(
      objects: Record<string, Buffer>,
      failing: Array<string>,
    ) {
      this.objects = new Map(Object.entries(objects));
      this.failing = new Set(failing);
    }

    public async listObjects(): Promise<ObjectStoreListPage> {
      return {
        objects: Array.from(this.objects.entries()).map(
          ([key, body]: [string, Buffer]) => {
            return {
              key,
              sizeInBytes: body.length,
              lastModified: new Date("2026-11-20T10:00:00.000Z"),
              etag: `"${key}"`,
            };
          },
        ),
        nextToken: undefined,
      };
    }

    public async readObjectStart(
      key: string,
      maxBytes: number,
    ): Promise<Uint8Array> {
      if (this.failing.has(key)) {
        throw new Error("AccessDenied: the role may not read this object");
      }

      return this.objects.get(key)!.subarray(0, maxBytes);
    }
  }

  test("every reason a pattern's objects were not read is a template's", async () => {
    const png: Buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    const result: ContentScanResult = await sampleObjectStore(
      new Bucket(
        {
          "images/logo.png": Buffer.from("not read at all"),
          "uploads/scan.bin": png,
          // A gzip header, then no deflate data.
          "archive/broken.gz": Buffer.concat([
            Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03]),
            Buffer.from("this is not deflate data at all, really not"),
          ]),
          // A ZIP archive that holds no document a scan reads.
          "archive/notes.zip": Buffer.from(
            "PK\u0003\u0004 this is no document",
          ),
          "dumps/raw.dat": Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xfe]),
          "private/denied.csv": Buffer.from("a,b\n1,2\n"),
          "logs/big.log.gz": zlib.gzipSync(Buffer.from("x".repeat(2048))),
        },
        ["private/denied.csv"],
      ),
      OPTIONS,
    );
    const keys: Array<ScanWarningKey | undefined> = result.warnings.map(
      (warning: string): ScanWarningKey | undefined => {
        return readScanWarning(warning)?.key;
      },
    );

    expect(result.warnings.length).toBeGreaterThanOrEqual(5);

    // Every warning the bucket's scan wrote is one the Dashboard words.
    result.warnings.forEach((warning: string, index: number): void => {
      expect({ warning, key: keys[index] }).toEqual({
        warning,
        key: expect.any(String),
      });
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        "patternFormatNotSupported",
        "patternGzipNotInflated",
        "objectsCouldNotRead",
      ]),
    );
    expect(
      result.warnings.some((warning: string): boolean => {
        return readScanWarning(warning)?.values["format"] === "a ZIP archive";
      }),
    ).toBe(true);
    expect(
      result.warnings.filter((warning: string): boolean => {
        return readScanWarning(warning)?.values["format"] === "PNG image";
      }).length,
    ).toBe(2);
    expect(
      result.warnings.some((warning: string): boolean => {
        return readScanWarning(warning)?.values["format"] === "binary content";
      }),
    ).toBe(true);
  });
});

describe("a telemetry store that could not be read", () => {
  test("each kind of store's warning is its own template's", () => {
    const expected: Array<[TelemetrySampleSource, ScanWarningKey]> = [
      [TelemetrySampleSource.Logs, "telemetryServiceLogsUnread"],
      [TelemetrySampleSource.Traces, "telemetryServiceSpansUnread"],
      [TelemetrySampleSource.Exceptions, "telemetryServiceExceptionsUnread"],
      [TelemetrySampleSource.AiConversations, "telemetryServiceAiCallsUnread"],
      [TelemetrySampleSource.RumLogs, "telemetryApplicationLogsUnread"],
      [TelemetrySampleSource.RumSpans, "telemetryApplicationSpansUnread"],
      [TelemetrySampleSource.RumSessions, "telemetryApplicationSessionsUnread"],
      [TelemetrySampleSource.Metrics, "telemetryServiceMetricsUnread"],
    ];

    for (const [source, key] of expected) {
      expectRead(getUnreadSourceWarning(getTelemetrySource(source)), key, {});
    }

    // Each source has one: none is left to the sentence built from its words.
    expect(
      expected
        .map((entry: [TelemetrySampleSource, ScanWarningKey]) => {
          return entry[0];
        })
        .sort(),
    ).toEqual(Object.values(TelemetrySampleSource).sort());
  });

  test("a company AI tool's conversations, which the scan does not read", () => {
    expectRead(
      RESTRICTED_CONVERSATIONS_WARNING,
      "telemetryRestrictedConversations",
      {},
    );
  });
});
