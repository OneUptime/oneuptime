import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
  DataSecurityScanKind,
  DataSecurityScanStatus,
  FINDING_FRESHNESS_IN_DAYS,
  FINDING_RETENTION_IN_DAYS,
  getFindingKey,
  MAX_FINDINGS_PER_STORE,
  RecordContentScanInput,
  RecordContentScanOutput,
} from "../../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import {
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { DATA_SECURITY_EVALUATE_PROJECT_JOB } from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import DataSecurityScanService from "../../../../Server/Services/DataSecurityScanService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import DataSecurityScan from "../../../../Models/DatabaseModels/DataSecurityScan";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  classifyField,
  FieldClassification,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A scan's result written down (DataSecurityFindingWriter): one finding per
 * data type and location - created once, updated after - with masked
 * samples only when the project keeps them, one scan row saying what was
 * read, the store's own summary, old findings pruned, and the project's
 * evaluation queued. Postgres is an in-memory table of findings here, and
 * the scan and store writes are recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const STARTED_AT: Date = new Date(NOW.getTime() - 90 * 1000);
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

interface FindByArgument {
  query: JSONObject;
  select?: JSONObject | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

let table: Array<DataStoreFinding>;
let clock: Date;
let store: DataStore | null;
let findSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let scanSpy: jest.SpyInstance;
let storeUpdateSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  table = [];
  clock = NOW;
  store = new DataStore(STORE_ID);
  store.fingerprints = {};

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(clock.getTime());
  });

  findSpy = jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async (findBy: FindByArgument) => {
      const keys: Includes | undefined = findBy.query["findingKey"] as
        | Includes
        | undefined;

      return table
        .filter((row: DataStoreFinding) => {
          return (
            row.dataStoreId?.toString() ===
              (findBy.query["dataStoreId"] as ObjectID).toString() &&
            (!keys ||
              (keys.values as Array<string>).includes(row.findingKey || ""))
          );
        })
        .slice(0, Number(findBy.limit));
    }) as never);
  createSpy = jest
    .spyOn(DataStoreFindingService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataStoreFinding>,
    ): Promise<DataStoreFinding> => {
      createBy.data.id = ObjectID.generate();
      table.push(createBy.data);
      return createBy.data;
    }) as never);
  updateSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: DataStoreFinding | undefined = table.find(
        (finding: DataStoreFinding) => {
          return finding.id?.toString() === data.id.toString();
        },
      );

      for (const [column, value] of Object.entries(data.data)) {
        row!.setColumnValue(column, value);
      }
    }) as never);
  deleteSpy = jest
    .spyOn(DataStoreFindingService, "deleteOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      table = table.filter((finding: DataStoreFinding) => {
        return finding.id?.toString() !== data.id.toString();
      });
    }) as never);
  scanSpy = jest
    .spyOn(DataSecurityScanService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataSecurityScan>,
    ): Promise<DataSecurityScan> => {
      createBy.data.id = ObjectID.generate();
      return createBy.data;
    }) as never);
  jest.spyOn(DataStoreService, "findOneById").mockImplementation((async () => {
    return store;
  }) as never);
  storeUpdateSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function classification(
  dataTypeId: string,
  overrides: Partial<FieldClassification> = {},
): FieldClassification {
  return {
    dataTypeId,
    matchCount: 8,
    testValueCount: 1,
    confidence: DataConfidence.High,
    maskedSamples: ["p***@a***.io"],
    distinctValues: 7,
    distinctValuesCapped: false,
    matchRatio: 0.666,
    valueCount: 12,
    valuesWithMatch: 8,
    isFreeText: false,
    nameHinted: true,
    foundByName: false,
    ...overrides,
  };
}

function location(
  where: string,
  classifications: Array<FieldClassification>,
  locationKind: DataStoreLocationKind = DataStoreLocationKind.Column,
): LocationFindings {
  return { location: where, locationKind, classifications };
}

function resultOf(
  overrides: Partial<ContentScanResult> = {},
): ContentScanResult {
  return { ...emptyContentScanResult(), ...overrides };
}

function scanInput(
  overrides: Partial<RecordContentScanInput> = {},
): RecordContentScanInput {
  return {
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    kind: DataSecurityScanKind.Content,
    result: resultOf(),
    startedAt: STARTED_AT,
    keepMaskedSamples: true,
    contentScanIntervalInHours: 24,
    ...overrides,
  };
}

function record(
  overrides: Partial<RecordContentScanInput> = {},
): Promise<RecordContentScanOutput> {
  return DataSecurityFindingWriter.recordContentScan(scanInput(overrides));
}

function findingAt(dataTypeId: string, where: string): DataStoreFinding {
  const found: DataStoreFinding | undefined = table.find(
    (finding: DataStoreFinding) => {
      return finding.findingKey === getFindingKey(dataTypeId, where);
    },
  );

  if (!found) {
    throw new Error(`No finding of ${dataTypeId} at ${where}.`);
  }

  return found;
}

function writtenScan(): DataSecurityScan {
  expect(scanSpy).toHaveBeenCalledTimes(1);
  return (scanSpy.mock.calls[0]![0] as CreateBy<DataSecurityScan>).data;
}

function storeWrite(): JSONObject {
  expect(storeUpdateSpy).toHaveBeenCalledTimes(1);
  return (storeUpdateSpy.mock.calls[0]![0] as { data: JSONObject }).data;
}

function keyLookups(): Array<Array<string>> {
  return findSpy.mock.calls
    .map((call: Array<unknown>): FindByArgument => {
      return call[0] as FindByArgument;
    })
    .filter((findBy: FindByArgument) => {
      return Boolean(findBy.query["findingKey"]);
    })
    .map((findBy: FindByArgument): Array<string> => {
      return (findBy.query["findingKey"] as Includes).values as Array<string>;
    });
}

// A card number of the issuer prefix 4539 that passes the Luhn check, built here.
function cardNumber(random: SeededRandom): string {
  let digits: string = "4539";

  while (digits.length < 15) {
    digits += String(random(10));
  }

  let sum: number = 0;

  for (let index: number = 0; index < 15; index++) {
    let digit: number = Number(digits[14 - index]);

    if (index % 2 === 0) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return digits + String((10 - (sum % 10)) % 10);
}

describe("the writer's constants", () => {
  test("findings count for 30 days, are kept for 90, and a store keeps at most 2000", () => {
    expect(FINDING_FRESHNESS_IN_DAYS).toBe(30);
    expect(FINDING_RETENTION_IN_DAYS).toBe(90);
    expect(MAX_FINDINGS_PER_STORE).toBe(2000);
  });

  test("a finding is keyed by its data type and location, at most 500 characters", () => {
    expect(getFindingKey("email-address", "public.users.email")).toBe(
      "email-address|public.users.email",
    );
    expect(getFindingKey("email-address", "x".repeat(600))).toHaveLength(500);
    expect(getFindingKey("email-address", "x".repeat(600))).toBe(
      `email-address|${"x".repeat(486)}`,
    );
  });
});

describe("recordContentScan: findings", () => {
  test("one finding per data type and location, keyed by both", async () => {
    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
          location(
            "exports/*/users-*.csv",
            [
              classification("email-address"),
              classification("credit-card-number", {
                maskedSamples: ["**** **** **** 6467"],
              }),
            ],
            DataStoreLocationKind.Object,
          ),
        ],
      }),
    });

    expect(output.findingsWritten).toBe(3);
    expect(
      table
        .map((finding: DataStoreFinding): string => {
          return finding.findingKey || "";
        })
        .sort(),
    ).toEqual([
      "credit-card-number|exports/*/users-*.csv",
      "email-address|exports/*/users-*.csv",
      "email-address|public.users.email",
    ]);

    const finding: DataStoreFinding = findingAt(
      "credit-card-number",
      "exports/*/users-*.csv",
    );

    expect(finding.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(finding.dataStoreId?.toString()).toBe(STORE_ID.toString());
    expect(finding.dataTypeId).toBe("credit-card-number");
    expect(finding.location).toBe("exports/*/users-*.csv");
    expect(finding.locationKind).toBe(DataStoreLocationKind.Object);
    expect(finding.dataTypeName).toBe("Card number");
    expect(finding.dataCategory).toBe(DataCategory.Financial);
    expect(finding.sensitivity).toBe(DataSensitivity.Restricted);
    expect(finding.confidence).toBe(DataConfidence.High);
    expect(finding.matchCount).toBe(8);
    expect(finding.valueCount).toBe(12);
    expect(finding.matchPercent).toBe(67);
    expect(finding.distinctValues).toBe(7);
    expect(finding.testValueCount).toBe(1);
    expect(finding.maskedSamples).toEqual(["**** **** **** 6467"]);
    expect(finding.isFreeText).toBe(false);
    expect(finding.isNameHinted).toBe(true);
    expect(finding.isFoundByName).toBe(false);
    expect(finding.firstSeenAt).toEqual(NOW);
    expect(finding.lastSeenAt).toEqual(NOW);
    expect(
      (createSpy.mock.calls[0]![0] as CreateBy<DataStoreFinding>).props,
    ).toEqual({ isRoot: true });
  });

  test("a custom data type is named and graded as its project defined it; an unknown one by its id", async () => {
    const customTypes: Map<string, CustomDataTypeSummary> = new Map([
      [
        "custom:loyalty",
        {
          name: "Loyalty card number",
          category: DataCategory.Financial,
          sensitivity: DataSensitivity.Confidential,
        },
      ],
    ]);

    await record({
      customDataTypes: customTypes,
      result: resultOf({
        locations: [
          location("members.card", [
            classification("custom:loyalty"),
            classification("custom:gone"),
          ]),
        ],
      }),
    });

    expect(findingAt("custom:loyalty", "members.card")).toMatchObject({
      dataTypeName: "Loyalty card number",
      dataCategory: DataCategory.Financial,
      sensitivity: DataSensitivity.Confidential,
    });

    const unknown: DataStoreFinding = findingAt("custom:gone", "members.card");

    expect(unknown.dataTypeName).toBe("custom:gone");
    expect(unknown.dataCategory).toBeUndefined();
    expect(unknown.sensitivity).toBeUndefined();
  });

  test("a finding seen before is brought up to date, not made again, and keeps its first sighting", async () => {
    await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });

    const first: DataStoreFinding = findingAt(
      "email-address",
      "public.users.email",
    );
    const firstId: string = first.id!.toString();

    clock = new Date(NOW.getTime() + DAY_IN_MS);
    createSpy.mockClear();

    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [
          location("public.users.email", [
            classification("email-address", {
              matchCount: 40,
              confidence: DataConfidence.Medium,
              maskedSamples: ["q***@b***.io"],
            }),
          ]),
        ],
      }),
    });

    expect(output.findingsWritten).toBe(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(table).toHaveLength(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(
      (updateSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(firstId);

    const update: JSONObject = (
      updateSpy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(update).toEqual({
      dataTypeName: "Email address",
      dataCategory: DataCategory.ContactAndIdentity,
      sensitivity: DataSensitivity.Confidential,
      confidence: DataConfidence.Medium,
      matchCount: 40,
      valueCount: 12,
      matchPercent: 67,
      distinctValues: 7,
      testValueCount: 1,
      maskedSamples: ["q***@b***.io"],
      isFreeText: false,
      isNameHinted: true,
      isFoundByName: false,
      locationKind: DataStoreLocationKind.Column,
      lastSeenAt: clock,
    });

    const after: DataStoreFinding = findingAt(
      "email-address",
      "public.users.email",
    );

    expect(after.firstSeenAt).toEqual(NOW);
    expect(after.lastSeenAt).toEqual(clock);
    expect(after.matchCount).toBe(40);
  });

  test("every column written is a column of DataStoreFinding", async () => {
    const columns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStoreFinding())),
    );

    await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });
    await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });

    const written: JSONObject = (
      updateSpy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    for (const column of Object.keys(written)) {
      expect({ column, isAColumn: columns.has(column) }).toEqual({
        column,
        isAColumn: true,
      });
    }

    for (const column of [
      "findingKey",
      "dataTypeId",
      "location",
      "firstSeenAt",
    ]) {
      expect(columns.has(column)).toBe(true);
    }
  });

  test("samples are masked, kept only when the project allows it, and no raw value is ever written", async () => {
    const random: SeededRandom = seededRandom(4242);
    const emails: Array<string> = [];
    const cards: Array<string> = [];

    // Local parts nothing else written could contain, so any match is a leak.
    for (let index: number = 0; index < 12; index++) {
      emails.push(`zq${100000 + random(900000)}.${index}@acme-shop.io`);
      cards.push(cardNumber(random));
    }

    const emailFindings: Array<FieldClassification> = classifyField(
      "customer_email",
      emails,
    );
    const cardFindings: Array<FieldClassification> = classifyField(
      "card_number",
      cards,
    );

    expect(
      emailFindings.map((found: FieldClassification) => {
        return found.dataTypeId;
      }),
    ).toContain("email-address");
    expect(
      cardFindings.map((found: FieldClassification) => {
        return found.dataTypeId;
      }),
    ).toContain("credit-card-number");

    const result: ContentScanResult = resultOf({
      locations: [
        location("crm.customers.email", emailFindings),
        location("crm.customers.card_number", cardFindings),
      ],
      readLog: ["crm.customers"],
      rowsRead: 12,
    });

    await record({ result, keepMaskedSamples: true });

    const kept: Array<string> = table.flatMap((finding: DataStoreFinding) => {
      return finding.maskedSamples || [];
    });

    expect(kept.length).toBeGreaterThan(0);

    // The same findings again, now with the project keeping no samples.
    await record({ result, keepMaskedSamples: false });

    for (const finding of table) {
      expect(finding.maskedSamples).toEqual([]);
    }

    const everythingWritten: string = JSON.stringify([
      createSpy.mock.calls,
      updateSpy.mock.calls,
      scanSpy.mock.calls,
      storeUpdateSpy.mock.calls,
      queueSpy.mock.calls,
      kept,
    ]);

    for (const raw of [...emails, ...cards]) {
      for (let start: number = 0; start + 8 <= raw.length; start++) {
        expect({
          raw,
          window: raw.slice(start, start + 8),
          written: everythingWritten.includes(raw.slice(start, start + 8)),
        }).toEqual({
          raw,
          window: raw.slice(start, start + 8),
          written: false,
        });
      }
    }
  });

  test("the same data type at the same location twice in one scan is one finding", async () => {
    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [
          location("public.users.email", [
            classification("email-address", { matchCount: 3 }),
          ]),
          location("public.users.email", [
            classification("email-address", { matchCount: 9 }),
          ]),
        ],
      }),
    });

    expect(output.findingsWritten).toBe(1);
    expect(table).toHaveLength(1);
    expect(table[0]!.matchCount).toBe(9);
  });

  test("existing findings are looked up 500 keys at a time", async () => {
    const locations: Array<LocationFindings> = [];

    for (let index: number = 0; index < 1200; index++) {
      locations.push(
        location(`exports/part-${index}.csv`, [
          classification("email-address"),
        ]),
      );
    }

    await record({ result: resultOf({ locations }) });

    const lookups: Array<Array<string>> = keyLookups();

    expect(
      lookups.map((keys: Array<string>): number => {
        return keys.length;
      }),
    ).toEqual([500, 500, 200]);
    expect(lookups.flat()).toEqual(
      locations.map((found: LocationFindings): string => {
        return getFindingKey("email-address", found.location);
      }),
    );
  });

  test("one scan writes at most 2000 findings", async () => {
    const locations: Array<LocationFindings> = [];

    for (let index: number = 0; index < 700; index++) {
      locations.push(
        location(`events/day-${index}.json`, [
          classification("email-address"),
          classification("phone-number"),
          classification("ip-address"),
        ]),
      );
    }

    const output: RecordContentScanOutput = await record({
      result: resultOf({ locations }),
    });

    expect(output.findingsWritten).toBe(MAX_FINDINGS_PER_STORE);
    expect(table).toHaveLength(MAX_FINDINGS_PER_STORE);
    expect(writtenScan().findingsFound).toBe(MAX_FINDINGS_PER_STORE);
  });

  test("a finding that cannot be written is logged and not counted; the others are written", async () => {
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataStoreFinding>,
    ): Promise<DataStoreFinding> => {
      if (createBy.data.dataTypeId === "phone-number") {
        throw new Error("value too long for type character varying(100)");
      }

      createBy.data.id = ObjectID.generate();
      table.push(createBy.data);
      return createBy.data;
    }) as never);

    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [
          location("public.users.contact", [
            classification("phone-number"),
            classification("email-address"),
          ]),
        ],
      }),
    });

    expect(output.findingsWritten).toBe(1);
    expect(
      table.map((finding: DataStoreFinding) => {
        return finding.dataTypeId;
      }),
    ).toEqual(["email-address"]);
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not write finding phone-number|public.users.contact of store ${STORE_ID.toString()}:`,
    );
    expect(writtenScan().findingsFound).toBe(1);
  });

  test("ids, locations and names longer than their columns are cut to fit", async () => {
    const longType: string = `custom:${"t".repeat(150)}`;
    const longLocation: string = `exports/${"p".repeat(700)}`;

    await record({
      customDataTypes: new Map([
        [
          longType,
          {
            name: "N".repeat(150),
            category: DataCategory.BusinessConfidential,
            sensitivity: DataSensitivity.Internal,
          },
        ],
      ]),
      result: resultOf({
        locations: [location(longLocation, [classification(longType)])],
      }),
    });

    const finding: DataStoreFinding = table[0]!;

    expect(finding.dataTypeId).toBe(longType.slice(0, 100));
    expect(finding.location).toBe(longLocation.slice(0, 500));
    expect(finding.findingKey).toBe(getFindingKey(longType, longLocation));
    expect(finding.findingKey).toHaveLength(500);
    expect(finding.dataTypeName).toBe("N".repeat(100));
  });
});

describe("recordContentScan: the scan row", () => {
  test("says what was read, how it ended, how long it took and what was found", async () => {
    const readLog: Array<string> = [];
    const warnings: Array<string> = [];

    for (let index: number = 0; index < 250; index++) {
      readLog.push(`exports/2026/10/object-${index}-${"o".repeat(400)}.csv`);
    }

    for (let index: number = 0; index < 60; index++) {
      warnings.push(`Could not read object ${index}: ${"w".repeat(600)}`);
    }

    const output: RecordContentScanOutput = await record({
      probeId: PROBE_ID,
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
        readLog,
        warnings,
        objectsRead: 250,
        rowsRead: 9000,
        bytesRead: 52428800,
        isComplete: true,
      }),
    });

    const scan: DataSecurityScan = writtenScan();

    expect(output.scanId?.toString()).toBe(scan.id!.toString());
    expect(scan.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(scan.dataStoreId?.toString()).toBe(STORE_ID.toString());
    expect(scan.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(scan.kind).toBe(DataSecurityScanKind.Content);
    expect(scan.status).toBe(DataSecurityScanStatus.Succeeded);
    expect(scan.startedAt).toEqual(STARTED_AT);
    expect(scan.finishedAt).toEqual(NOW);
    expect(scan.durationInMs).toBe(90 * 1000);
    expect(scan.objectsRead).toBe(250);
    expect(scan.rowsRead).toBe(9000);
    expect(scan.bytesRead).toBe(52428800);
    expect(scan.findingsFound).toBe(1);
    expect(scan.readLog).toHaveLength(MAX_READ_LOG_ENTRIES);
    expect(scan.readLog![0]).toBe(readLog[0]!.slice(0, 300));
    expect(scan.warnings).toHaveLength(50);
    expect(scan.warnings![0]).toBe(warnings[0]!.slice(0, 500));
    expect(
      (scanSpy.mock.calls[0]![0] as CreateBy<DataSecurityScan>).props,
    ).toEqual({ isRoot: true });
  });

  test("a scan that could not read everything partly succeeded", async () => {
    await record({
      kind: DataSecurityScanKind.Telemetry,
      result: resultOf({ isComplete: false }),
    });

    expect(writtenScan().status).toBe(DataSecurityScanStatus.PartlySucceeded);
    expect(writtenScan().kind).toBe(DataSecurityScanKind.Telemetry);
    expect(writtenScan().probeId).toBeUndefined();
    expect(storeWrite()["contentScanStatus"]).toBe(
      DataSecurityScanStatus.PartlySucceeded,
    );
  });

  test("a scan that seems to end before it started is never a negative duration", async () => {
    await record({ startedAt: new Date(NOW.getTime() + 5000) });

    expect(writtenScan().durationInMs).toBe(0);
  });

  test("a scan row that cannot be written is logged; the findings, the store and the evaluation still happen", async () => {
    scanSpy.mockRejectedValue(new Error("Postgres went away"));

    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });

    expect(output).toEqual({ scanId: null, findingsWritten: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not record a scan:",
    );
    expect(storeUpdateSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });
});

describe("recordContentScan: the store", () => {
  test("notes when it was scanned, how it ended, when it is due next and how many records it holds", async () => {
    await record({
      contentScanIntervalInHours: 6,
      result: resultOf({ estimatedRecords: 1234.6 }),
    });

    expect(
      (storeUpdateSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(STORE_ID.toString());
    expect(storeWrite()).toMatchObject({
      contentScannedAt: NOW,
      contentScanStatus: DataSecurityScanStatus.Succeeded,
      nextContentScanAt: OneUptimeDate.addRemoveHours(NOW, 6),
      estimatedRecords: 1235,
    });
    expect((storeWrite()["nextContentScanAt"] as Date).getTime()).toBe(
      NOW.getTime() + 6 * 60 * 60 * 1000,
    );
  });

  test("a scan with no estimate leaves the store's own", async () => {
    await record();

    expect(Object.keys(storeWrite())).not.toContain("estimatedRecords");
  });

  test("the scan's fingerprints join the store's, a data type's newest sketch winning", async () => {
    store!.fingerprints = {
      "email-address": [1, 2, 3],
      "phone-number": [4, 5, 6],
    };

    await record({
      result: resultOf({
        fingerprints: { "email-address": [7, 8, 9], "us-ssn": [10, 11, 12] },
      }),
    });

    expect(storeWrite()["fingerprints"]).toEqual({
      "email-address": [7, 8, 9],
      "phone-number": [4, 5, 6],
      "us-ssn": [10, 11, 12],
    });
  });

  test("keeps what the next scan needs, and at most 50 plain-text password fields", async () => {
    const fields: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      fields.push(`app.users_${index}.password`);
    }

    await record({
      result: resultOf({
        nextState: {
          "exports/": "2026-10-27T00:00:00.000Z",
          tables: ["users"],
        },
        plaintextPasswordFields: fields,
      }),
    });

    expect(storeWrite()["contentScanState"]).toEqual({
      "exports/": "2026-10-27T00:00:00.000Z",
      tables: ["users"],
      plaintextPasswordFields: fields.slice(0, 50),
    });
  });

  test("a store that is gone is not written", async () => {
    store = null;

    const output: RecordContentScanOutput = await record();

    expect(storeUpdateSpy).not.toHaveBeenCalled();
    expect(output.scanId).not.toBeNull();
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  test("every column written to the store is a column of DataStore", async () => {
    const columns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStore())),
    );

    await record({ result: resultOf({ estimatedRecords: 10 }) });

    for (const column of Object.keys(storeWrite())) {
      expect({ column, isAColumn: columns.has(column) }).toEqual({
        column,
        isAColumn: true,
      });
    }
  });
});

describe("recordContentScan: old findings and the evaluation", () => {
  function oldFinding(daysAgo: number | null): DataStoreFinding {
    const finding: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
    finding.dataStoreId = STORE_ID;
    finding.findingKey = `email-address|old-${String(daysAgo)}`;

    if (daysAgo !== null) {
      finding.lastSeenAt = new Date(NOW.getTime() - daysAgo * DAY_IN_MS);
    }

    table.push(finding);
    return finding;
  }

  test("findings unseen for 90 days are deleted; newer ones, and undated ones, are kept", async () => {
    const ancient: DataStoreFinding = oldFinding(120);
    oldFinding(89);
    oldFinding(null);

    await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(
      (deleteSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(ancient.id!.toString());
    expect(
      (deleteSpy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
    expect(
      table
        .map((finding: DataStoreFinding): string => {
          return finding.findingKey || "";
        })
        .sort(),
    ).toEqual([
      "email-address|old-89",
      "email-address|old-null",
      "email-address|public.users.email",
    ]);

    const prune: FindByArgument | undefined = findSpy.mock.calls
      .map((call: Array<unknown>): FindByArgument => {
        return call[0] as FindByArgument;
      })
      .find((findBy: FindByArgument) => {
        return !findBy.query["findingKey"];
      });

    expect(prune?.limit).toBe(MAX_FINDINGS_PER_STORE);
  });

  test("a failure while pruning is logged and does not fail the scan", async () => {
    oldFinding(200);
    deleteSpy.mockRejectedValue(new Error("Postgres went away"));

    await expect(record()).resolves.toMatchObject({ findingsWritten: 0 });
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not prune old findings:",
    );
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  test("queues the project's evaluation, last", async () => {
    await record({
      result: resultOf({
        locations: [
          location("public.users.email", [classification("email-address")]),
        ],
      }),
    });

    expect(queueSpy).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = queueSpy.mock.calls[0]!;

    expect(call[0]).toBe(QueueName.Worker);
    expect(call[2]).toBe(DATA_SECURITY_EVALUATE_PROJECT_JOB);
    expect(call[3]).toEqual({ projectId: PROJECT_ID.toString() });
    expect(queueSpy.mock.invocationCallOrder[0]!).toBeGreaterThan(
      storeUpdateSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("a scan that found nothing looks nothing up, but still records the scan and queues the evaluation", async () => {
    const output: RecordContentScanOutput = await record({
      result: resultOf({
        locations: [location("public.users.notes", [])],
        readLog: ["public.users"],
      }),
    });

    expect(output.findingsWritten).toBe(0);
    expect(keyLookups()).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
    expect(writtenScan().findingsFound).toBe(0);
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });
});

describe("recordFailedScan", () => {
  test("records why a scan could not run, Failed by default, and tells the store", async () => {
    await DataSecurityFindingWriter.recordFailedScan({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      probeId: PROBE_ID,
      kind: DataSecurityScanKind.Content,
      startedAt: STARTED_AT,
      errorMessage: `AccessDenied: ${"e".repeat(700)}`,
    });

    const scan: DataSecurityScan = writtenScan();

    expect(scan.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(scan.dataStoreId?.toString()).toBe(STORE_ID.toString());
    expect(scan.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(scan.cloudConnectionId).toBeUndefined();
    expect(scan.kind).toBe(DataSecurityScanKind.Content);
    expect(scan.status).toBe(DataSecurityScanStatus.Failed);
    expect(scan.startedAt).toEqual(STARTED_AT);
    expect(scan.finishedAt).toEqual(NOW);
    expect(scan.durationInMs).toBe(90 * 1000);
    expect(scan.errorMessage).toHaveLength(500);
    expect(scan.errorMessage!.startsWith("AccessDenied: ")).toBe(true);
    expect(storeUpdateSpy.mock.calls[0]![0]).toEqual({
      id: STORE_ID,
      data: { contentScanStatus: DataSecurityScanStatus.Failed },
    });
  });

  test("a scan that was skipped says so", async () => {
    await DataSecurityFindingWriter.recordFailedScan({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      kind: DataSecurityScanKind.Content,
      startedAt: STARTED_AT,
      errorMessage:
        "Content scanning needs the connection's content permission.",
      status: DataSecurityScanStatus.Skipped,
    });

    expect(writtenScan().status).toBe(DataSecurityScanStatus.Skipped);
    expect(storeWrite()).toEqual({
      contentScanStatus: DataSecurityScanStatus.Skipped,
    });
  });

  test("a connection's failed read is recorded on the connection, with no store to tell", async () => {
    const connectionId: ObjectID = ObjectID.generate();

    await DataSecurityFindingWriter.recordFailedScan({
      projectId: PROJECT_ID,
      cloudConnectionId: connectionId,
      kind: DataSecurityScanKind.Configuration,
      startedAt: STARTED_AT,
      errorMessage: "The role cannot be assumed.",
    });

    expect(writtenScan().cloudConnectionId?.toString()).toBe(
      connectionId.toString(),
    );
    expect(writtenScan().dataStoreId).toBeUndefined();
    expect(storeUpdateSpy).not.toHaveBeenCalled();
  });

  test("a failure to record it is logged, never thrown", async () => {
    scanSpy.mockRejectedValue(new Error("Postgres went away"));

    await expect(
      DataSecurityFindingWriter.recordFailedScan({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        kind: DataSecurityScanKind.Content,
        startedAt: STARTED_AT,
        errorMessage: "The scan failed.",
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not record a failed scan:",
    );
    expect(storeUpdateSpy).not.toHaveBeenCalled();
  });
});
