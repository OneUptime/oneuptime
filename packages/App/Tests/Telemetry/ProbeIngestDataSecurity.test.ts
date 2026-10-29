import { mockRouter } from "Common/Tests/Server/API/Helpers";
import DataSecurityCustomDataTypeService from "Common/Server/Services/DataSecurityCustomDataTypeService";
import DataSecuritySettingService from "Common/Server/Services/DataSecuritySettingService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import DataSecurityFindingWriter from "Common/Server/Utils/DataSecurity/DataSecurityFindingWriter";
import {
  CLAIM_DUE_DATA_STORES_STATEMENT,
  HOLD_CLAIMED_DATA_STORES_STATEMENT,
} from "Common/Server/Utils/DataSecurity/DataSecurityProbeClaim";
import { DATA_SECURITY_PROBE_CLAIM_IN_MINUTES } from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import { getFingerprintKey } from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import Response from "Common/Server/Utils/Response";
import Probe from "Common/Models/DatabaseModels/Probe";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DataStoreService", () => {
  return {
    __esModule: true,
    default: {
      executeTransaction: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DataSecuritySettingService", () => {
  return {
    __esModule: true,
    default: { getOrCreateForProject: jest.fn() },
  };
});

jest.mock("Common/Server/Services/DataSecurityCustomDataTypeService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/DataSecurity/DataSecurityFindingWriter", () => {
  return {
    __esModule: true,
    DataSecurityScanKind: {
      Configuration: "Configuration",
      Content: "Content",
      Telemetry: "Telemetry",
    },
    default: { recordContentScan: jest.fn(), recordFailedScan: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

/*
 * THE PROBE'S SIDE OF DATA SECURITY, OVER HTTP.
 *
 * What these protect:
 *
 *   - both routes are behind probe authentication and take the probe from
 *     the AUTHENTICATED request - a probe id in the body is never read - so
 *     a probe claims, hears about and reports on its own stores only;
 *   - a store is claimed in one transaction (SELECT ... FOR UPDATE SKIP
 *     LOCKED, then nextContentScanAt moved forward), only through its own
 *     project's probe, so two polls never get the same store;
 *   - the answer names the probe's environment variable, never a
 *     connection string, and only a probe that declares dataSecurityScan
 *     gets any;
 *   - a result is checked before it is written: only data types the
 *     project knows, every count and string bounded.
 */
import DataSecurityRouter, {
  FAILED_SCAN_RETRY_IN_HOURS,
  readStartedAt,
} from "../../FeatureSet/Telemetry/API/ProbeIngest/DataSecurity";

const storeService: {
  executeTransaction: Mock;
  findBy: Mock;
  findOneBy: Mock;
  updateColumnsByIdWithoutHooks: Mock;
} = DataStoreService as unknown as {
  executeTransaction: Mock;
  findBy: Mock;
  findOneBy: Mock;
  updateColumnsByIdWithoutHooks: Mock;
};
const settingService: { getOrCreateForProject: Mock } =
  DataSecuritySettingService as unknown as { getOrCreateForProject: Mock };
const customTypeService: { findBy: Mock } =
  DataSecurityCustomDataTypeService as unknown as { findBy: Mock };
const writer: { recordContentScan: Mock; recordFailedScan: Mock } =
  DataSecurityFindingWriter as unknown as {
    recordContentScan: Mock;
    recordFailedScan: Mock;
  };
const responseUtil: { sendErrorResponse: Mock; sendJsonObjectResponse: Mock } =
  Response as unknown as {
    sendErrorResponse: Mock;
    sendJsonObjectResponse: Mock;
  };

const WORK_URI: string = "/probe/data-security/work";
const RESULT_URI: string = "/probe/data-security/result";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CUSTOM_TYPE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SAVED_CONNECTION_STRING: string =
  "postgresql://reader:never-handed-out@db.internal:5432/app";

interface FakeStore {
  id: string;
  scanProbeId: string;
  kind: string;
  probeConnectionVariable: string;
  nextContentScanAt: Date | null;
}

let stores: Array<FakeStore> = [];
let lastClaim: Array<string> = [];
const statements: Array<{ sql: string; parameters: Array<unknown> }> = [];

function storeId(index: number): string {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
}

/*
 * A transaction over the stores above that does what the claim's two
 * statements say: the due stores of the probe, at most the limit, then
 * their next scan moved to the claim's end.
 */
function fakeManager(): { query: Mock } {
  return {
    query: jest.fn(
      async (sql: unknown, parameters: unknown): Promise<unknown> => {
        const values: Array<unknown> = parameters as Array<unknown>;

        statements.push({ sql: sql as string, parameters: values });

        if (sql === CLAIM_DUE_DATA_STORES_STATEMENT) {
          const now: Date = values[3] as Date;
          const due: Array<FakeStore> = stores
            .filter((store: FakeStore) => {
              return (
                store.scanProbeId === values[0] &&
                (store.nextContentScanAt === null ||
                  store.nextContentScanAt.getTime() <= now.getTime())
              );
            })
            .slice(0, values[5] as number);

          return due.map((store: FakeStore) => {
            return { _id: store.id, projectId: PROJECT_ID.toString() };
          });
        }

        if (sql === HOLD_CLAIMED_DATA_STORES_STATEMENT) {
          lastClaim = values[1] as Array<string>;

          for (const store of stores) {
            if (lastClaim.includes(store.id)) {
              store.nextContentScanAt = values[0] as Date;
            }
          }
        }

        return [];
      },
    ),
  };
}

function settings(): JSONObject {
  return {
    maxRowsPerTable: 500,
    maxTablesPerScan: 50,
    maxBytesPerScan: 1_000_000,
    disabledDataTypeIds: ["phone-number"],
    allowedValues: ["support@acme-corp.com"],
    keepMaskedSamples: true,
    contentScanIntervalInHours: 12,
  };
}

function customType(): JSONObject {
  return {
    id: CUSTOM_TYPE_ID,
    name: "Employee ID",
    category: DataCategory.BusinessConfidential,
    sensitivity: DataSensitivity.Confidential,
    pattern: "EMP-[0-9]{6}",
    ignoreCase: false,
    keywords: ["employee"],
    requiresKeyword: false,
    nameHints: ["employee id"],
    validator: "None",
  };
}

function makeRequest(data: {
  probeId?: ObjectID | null;
  body?: JSONObject;
}): ExpressRequest {
  const req: JSONObject = { body: data.body || {} };

  if (data.probeId !== null) {
    req["probe"] = new Probe(data.probeId || PROBE_ID);
  }

  return req as unknown as ExpressRequest;
}

async function call(uri: string, req: ExpressRequest): Promise<Mock> {
  const next: Mock = jest.fn();

  await mockRouter
    .match("post", uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next;
}

function sentBody(): JSONObject {
  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function refusal(): string {
  expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);

  const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];

  expect(error).toBeInstanceOf(BadDataException);

  return (error as Error).message;
}

const CAPABLE: JSONObject = {
  probeId: OTHER_PROBE_ID.toString(),
  probeCapabilities: ["networkDevicePing", ProbeCapability.DataSecurityScan],
};

beforeEach(() => {
  jest.clearAllMocks();
  statements.length = 0;
  lastClaim = [];
  stores = [1, 2, 3].map((index: number) => {
    return {
      id: storeId(index),
      scanProbeId: PROBE_ID.toString(),
      kind: "PostgreSQL",
      probeConnectionVariable: `CUSTOMERS_DB_${index}`,
      nextContentScanAt: null,
    };
  });

  storeService.executeTransaction.mockImplementation((async (
    work: (manager: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    return await work(fakeManager());
  }) as never);
  storeService.findBy.mockImplementation((async (): Promise<unknown> => {
    return stores
      .filter((store: FakeStore) => {
        return lastClaim.includes(store.id);
      })
      .map((store: FakeStore) => {
        return {
          id: new ObjectID(store.id),
          projectId: PROJECT_ID,
          kind: store.kind,
          probeConnectionVariable: store.probeConnectionVariable,
          scanExclusions: ["audit", 42],
          // As if a person also saved one for OneUptime's workers.
          connectionString: SAVED_CONNECTION_STRING,
        };
      });
  }) as never);
  storeService.findOneBy.mockResolvedValue(null as never);
  storeService.updateColumnsByIdWithoutHooks.mockResolvedValue(
    undefined as never,
  );
  settingService.getOrCreateForProject.mockResolvedValue(settings() as never);
  customTypeService.findBy.mockResolvedValue([customType()] as never);
  writer.recordContentScan.mockResolvedValue({
    scanId: null,
    findingsWritten: 3,
  } as never);
  writer.recordFailedScan.mockResolvedValue(undefined as never);
});

describe("wiring", () => {
  test("the router is what the module exports", () => {
    expect(DataSecurityRouter).toBe(mockRouter);
  });

  test.each([WORK_URI, RESULT_URI])(
    "%s is a POST behind probe authentication",
    (uri: string) => {
      expect(mockRouter.match("post", uri).middlewares).toContain(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      );
    },
  );

  test.each([WORK_URI, RESULT_URI])(
    "%s refuses a request no probe was authenticated for",
    async (uri: string) => {
      await call(uri, makeRequest({ probeId: null, body: CAPABLE }));

      expect(refusal()).toBe("Probe not found");
    },
  );

  test("the Telemetry feature set mounts the routes under the probe ingest prefixes", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Telemetry/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ProbeIngestDataSecurityAPI from "./API/ProbeIngest/DataSecurity";',
    );
    expect(index).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestDataSecurityAPI);",
    );
  });

  test("the route never imports typeorm: claiming lives in Common", () => {
    const route: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Telemetry/API/ProbeIngest/DataSecurity.ts",
      ),
      "utf8",
    );

    expect(route).not.toContain('from "typeorm"');
  });

  test("the capability's wire string never changes", () => {
    expect(ProbeCapability.DataSecurityScan).toBe("dataSecurityScan");
  });
});

describe("POST /probe/data-security/work", () => {
  test("a probe that does not declare dataSecurityScan is handed nothing, and nothing is claimed", async () => {
    await call(
      WORK_URI,
      makeRequest({
        body: { probeCapabilities: ["networkDevicePing", "snmpWalk"] },
      }),
    );

    expect(sentBody()).toEqual({ stores: [] });
    expect(storeService.executeTransaction).not.toHaveBeenCalled();
  });

  test("claims the authenticated probe's due stores in one locking transaction", async () => {
    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    expect(
      statements.map((statement: { sql: string }) => {
        return statement.sql;
      }),
    ).toEqual([
      CLAIM_DUE_DATA_STORES_STATEMENT,
      HOLD_CLAIMED_DATA_STORES_STATEMENT,
    ]);

    const select: { sql: string; parameters: Array<unknown> } = statements[0]!;

    // The probe from the authenticated request - not the body's.
    expect(select.parameters[0]).toBe(PROBE_ID.toString());
    expect(select.parameters[1]).toBe("self-managed");
    expect(select.parameters[2]).toEqual(["PostgreSQL", "MySQL", "SQL Server"]);
    expect(select.parameters[5]).toBe(2);
    expect(select.sql).toContain("FOR UPDATE OF ds SKIP LOCKED");
    expect(select.sql).toContain('ds."isContentScanEnabled" = true');
    expect(select.sql).toContain('ds."isArchived" = false');
    expect(select.sql).toContain('ds."deletedAt" IS NULL');
    expect(select.sql).toContain('pr."isGlobalProbe" = false');
    expect(select.sql).toContain('pr."projectId" = ds."projectId"');
    expect(select.sql).toContain(
      'COALESCE(s."isContentScanEnabled", true) = true',
    );

    const hold: { sql: string; parameters: Array<unknown> } = statements[1]!;
    const heldUntil: number = (hold.parameters[0] as Date).getTime();

    expect(hold.parameters[1]).toEqual([storeId(1), storeId(2)]);
    expect(
      Math.abs(
        heldUntil -
          (Date.now() + DATA_SECURITY_PROBE_CLAIM_IN_MINUTES * 60_000),
      ),
    ).toBeLessThan(10_000);
  });

  test("hands each store what its scan needs, and never a connection string", async () => {
    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    const body: JSONObject = sentBody();
    const handedOut: Array<JSONObject> = body["stores"] as Array<JSONObject>;

    expect(handedOut).toHaveLength(2);
    expect(handedOut[0]).toEqual({
      dataStoreId: storeId(1),
      kind: "PostgreSQL",
      engine: "postgresql",
      probeConnectionVariable: "CUSTOMERS_DB_1",
      limits: {
        maxRowsPerTable: 500,
        maxTables: 50,
        maxBytesTotal: 1_000_000,
        timeLimitInSeconds: 600,
      },
      exclusions: ["audit"],
      customDataTypes: [
        {
          dataTypeId: `custom:${CUSTOM_TYPE_ID.toString()}`,
          pattern: "EMP-[0-9]{6}",
          ignoreCase: false,
          keywords: ["employee"],
          requiresKeyword: false,
          nameHints: ["employee id"],
          validator: "None",
        },
      ],
      disabledDataTypeIds: ["phone-number"],
      allowedValues: ["support@acme-corp.com"],
      fingerprintKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    expect(JSON.stringify(body)).not.toContain("never-handed-out");
    expect(JSON.stringify(body)).not.toContain("connectionString");

    /*
     * The key a worker's scan of the project uses: a database a probe
     * scanned and a bucket a worker scanned compare, so a copy between them
     * is found. Two derivations of it once kept them apart.
     */
    for (const store of handedOut) {
      expect(store["fingerprintKey"]).toBe(getFingerprintKey(PROJECT_ID));
    }

    const select: JSONObject = (
      storeService.findBy.mock.calls[0]![0] as JSONObject
    )["select"] as JSONObject;

    expect(select["connectionString"]).toBeUndefined();
  });

  test("two polls never get the same store", async () => {
    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    const first: Array<string> = (
      sentBody()["stores"] as Array<JSONObject>
    ).map((store: JSONObject) => {
      return store["dataStoreId"] as string;
    });

    jest.clearAllMocks();
    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    const second: Array<string> = (
      sentBody()["stores"] as Array<JSONObject>
    ).map((store: JSONObject) => {
      return store["dataStoreId"] as string;
    });

    jest.clearAllMocks();
    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    expect(first).toEqual([storeId(1), storeId(2)]);
    expect(second).toEqual([storeId(3)]);
    expect(sentBody()).toEqual({ stores: [] });
  });

  test("a store of another probe is not this probe's to claim", async () => {
    for (const store of stores) {
      store.scanProbeId = OTHER_PROBE_ID.toString();
    }

    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    expect(sentBody()).toEqual({ stores: [] });
  });

  test("a variable name no probe reads is said on the store, and not handed out", async () => {
    stores[0]!.probeConnectionVariable = "lower_case_name";
    stores[1]!.probeConnectionVariable = "PROBE_KEY";

    await call(WORK_URI, makeRequest({ body: CAPABLE }));

    expect(sentBody()).toEqual({ stores: [] });
    expect(writer.recordFailedScan).toHaveBeenCalledTimes(2);
    expect(writer.recordFailedScan.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      kind: "Content",
      errorMessage: expect.stringContaining('"lower_case_name"'),
    });
  });
});

describe("POST /probe/data-security/result", () => {
  const STARTED_AT: string = new Date(Date.now() - 60_000).toISOString();

  function storeOfThisProbe(): void {
    storeService.findOneBy.mockResolvedValue({
      id: new ObjectID(storeId(1)),
      projectId: PROJECT_ID,
    } as never);
  }

  function result(overrides: JSONObject = {}): JSONObject {
    return {
      locations: [
        {
          location: "public.users.email",
          locationKind: "Column",
          classifications: [
            {
              dataTypeId: "email-address",
              matchCount: 25,
              testValueCount: 0,
              confidence: "High",
              maskedSamples: [
                "a***@a*****.com",
                "b***@a*****.com",
                "c***@a*****.com",
                "d***@a*****.com",
              ],
              distinctValues: 25,
              distinctValuesCapped: false,
              matchRatio: 7,
              valueCount: 25,
              valuesWithMatch: 25,
              isFreeText: false,
              nameHinted: true,
              foundByName: false,
            },
            {
              dataTypeId: "made-up-type",
              matchCount: 1,
              confidence: "High",
              valueCount: 1,
            },
            {
              dataTypeId: "us-ssn",
              matchCount: 1,
              confidence: "Certain",
              valueCount: 1,
            },
          ],
        },
        {
          location: "public.staff.employee_id",
          locationKind: "Column",
          classifications: [
            {
              dataTypeId: `custom:${CUSTOM_TYPE_ID.toString()}`,
              matchCount: 4,
              confidence: "Medium",
              valueCount: 4,
              valuesWithMatch: 4,
              maskedSamples: [],
            },
          ],
        },
        { location: "nowhere", locationKind: "Planet", classifications: [] },
      ],
      readLog: ["public.users", "public.staff"],
      objectsRead: 2,
      rowsRead: 29,
      bytesRead: 4000,
      warnings: [],
      fingerprints: {
        "email-address": new Array(128).fill(7),
        "made-up-type": new Array(128).fill(1),
      },
      plaintextPasswordFields: ["public.users.password"],
      estimatedRecords: 1200.4,
      isComplete: true,
      ...overrides,
    };
  }

  test("finds the store only as the authenticated probe's, never the body's", async () => {
    await call(
      RESULT_URI,
      makeRequest({
        body: {
          probeId: OTHER_PROBE_ID.toString(),
          dataStoreId: storeId(1),
          result: result(),
        },
      }),
    );

    const query: JSONObject = (
      storeService.findOneBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;

    expect((query["scanProbeId"] as ObjectID).toString()).toBe(
      PROBE_ID.toString(),
    );
    expect(refusal()).toBe("Data store not found.");
    expect(writer.recordContentScan).not.toHaveBeenCalled();
  });

  test("writes a result through the finding writer, checked and bounded", async () => {
    storeOfThisProbe();

    await call(
      RESULT_URI,
      makeRequest({
        body: {
          dataStoreId: storeId(1),
          startedAt: STARTED_AT,
          result: result(),
        },
      }),
    );

    expect(sentBody()).toEqual({ accepted: true, findingsWritten: 3 });

    const input: JSONObject = writer.recordContentScan.mock
      .calls[0]![0] as JSONObject;

    expect(input).toMatchObject({
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      kind: "Content",
      keepMaskedSamples: true,
      contentScanIntervalInHours: 12,
    });
    expect((input["startedAt"] as Date).toISOString()).toBe(STARTED_AT);
    expect(
      (input["customDataTypes"] as unknown as Map<string, unknown>).get(
        `custom:${CUSTOM_TYPE_ID.toString()}`,
      ),
    ).toEqual({
      name: "Employee ID",
      category: DataCategory.BusinessConfidential,
      sensitivity: DataSensitivity.Confidential,
    });

    const written: JSONObject = input["result"] as JSONObject;
    const locations: Array<JSONObject> = written[
      "locations"
    ] as Array<JSONObject>;

    expect(
      locations.map((location: JSONObject) => {
        return location["location"];
      }),
    ).toEqual(["public.users.email", "public.staff.employee_id"]);

    const email: JSONObject = (
      locations[0]!["classifications"] as Array<JSONObject>
    )[0]!;

    // Unknown types and confidences dropped, samples cut to three, the ratio recomputed.
    expect((locations[0]!["classifications"] as Array<JSONObject>).length).toBe(
      1,
    );
    expect(email["maskedSamples"]).toHaveLength(3);
    expect(email["matchRatio"]).toBe(1);
    expect(Object.keys(written["fingerprints"] as JSONObject)).toEqual([
      "email-address",
    ]);
    expect(written["estimatedRecords"]).toBe(1200);
    expect(written["plaintextPasswordFields"]).toEqual([
      "public.users.password",
    ]);
  });

  test("a scan that could not run is recorded with its reason, and tried again sooner", async () => {
    storeOfThisProbe();

    await call(
      RESULT_URI,
      makeRequest({
        body: {
          dataStoreId: storeId(1),
          startedAt: STARTED_AT,
          error: "The probe has no environment variable CUSTOMERS_DB_1.",
        },
      }),
    );

    expect(sentBody()).toEqual({ accepted: true, findingsWritten: 0 });
    expect(writer.recordFailedScan.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      kind: "Content",
      errorMessage: "The probe has no environment variable CUSTOMERS_DB_1.",
    });
    expect(writer.recordContentScan).not.toHaveBeenCalled();

    const update: JSONObject = storeService.updateColumnsByIdWithoutHooks.mock
      .calls[0]![0] as JSONObject;
    const next: Date = (update["data"] as JSONObject)[
      "nextContentScanAt"
    ] as Date;

    expect(
      Math.abs(
        next.getTime() - (Date.now() + FAILED_SCAN_RETRY_IN_HOURS * 3_600_000),
      ),
    ).toBeLessThan(10_000);
  });

  test("refuses what is not a scan result, and a store id that is not an id", async () => {
    storeOfThisProbe();

    await call(
      RESULT_URI,
      makeRequest({ body: { dataStoreId: storeId(1), result: "lots" } }),
    );

    expect(refusal()).toBe("The result is not a content scan result.");

    jest.clearAllMocks();

    await call(
      RESULT_URI,
      makeRequest({ body: { dataStoreId: "'; DROP TABLE x; --" } }),
    );

    expect(refusal()).toBe("dataStoreId is missing or is not an ID.");
    expect(storeService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("readStartedAt", () => {
  test("keeps a start from the last day, and reads anything else as now", () => {
    const recent: string = new Date(Date.now() - 5 * 60_000).toISOString();

    expect(readStartedAt(recent).toISOString()).toBe(recent);

    for (const value of [
      new Date(Date.now() + 3_600_000).toISOString(),
      new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
      "yesterday",
      42,
      undefined,
    ]) {
      expect(
        Math.abs(readStartedAt(value).getTime() - Date.now()),
      ).toBeLessThan(5_000);
    }
  });
});
