// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import { DatabaseConnection } from "Common/Server/Utils/DataSecurity/Content/DatabaseSampler";
import { DataSecurityProbeStoreWork } from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
} from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  classifyCollectedFields,
  FieldsClassification,
} from "Common/Server/Utils/DataSecurity/Content/ContentClassifier";
import { FingerprintAccumulator } from "Common/Server/Utils/DataSecurity/Fingerprint";
import { ModelBudget } from "Common/Server/Utils/DataSecurity/Model/ModelBudget";
import {
  CONTENT_STORE_KEY,
  ModelScanContext,
  recognizeFields,
} from "Common/Server/Utils/DataSecurity/Model/ModelScan";
import { FieldClassification } from "Common/Utils/DataSecurity/FieldClassifier";
import { CollectedField } from "Common/Utils/DataSecurity/FieldCollector";
import FakeEntityRecognizer, {
  ISSUE_SENTENCE,
} from "Common/Tests/Server/Utils/DataSecurity/Model/FakeEntityRecognizer";
import InitScanDatabases, {
  isDataSecurityScanAllowedOnThisProbe,
  resetDataSecurityScanState,
  runDataSecurityScanTick,
  scanStore,
  ScanDatabasesDependencies,
} from "../../../Jobs/DataSecurity/ScanDatabases";

/*
 * THE PROBE'S HALF OF SCANNING DATABASES FOR DATA SECURITY.
 *
 * Every five minutes the probe asks for the stores it scans, reads each
 * one's connection string from the environment variable the store names -
 * refusing a name that is not a shell variable's, or one of its own
 * settings - samples the database, and reports what it found. What these
 * hold: the connection string comes only from the probe's environment and
 * never travels, a missing variable is reported as such, an error is
 * reported without the password, and a global probe of the hosted product
 * scans nothing. No database is reached: the sampler is injected.
 */

const BASE_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/data-security";
const WORK_URL: string = `${BASE_URL}/work`;
const RESULT_URL: string = `${BASE_URL}/result`;
const CONNECTION_STRING: string =
  "postgresql://reader:Probe0nly-Secret@db.internal:5432/app";

function work(
  overrides: Partial<DataSecurityProbeStoreWork> = {},
): DataSecurityProbeStoreWork {
  return {
    dataStoreId: "66666666-6666-4666-8666-666666666666",
    kind: "PostgreSQL",
    engine: "postgresql",
    probeConnectionVariable: "CUSTOMERS_DB_URL",
    limits: {
      maxRowsPerTable: 500,
      maxTables: 50,
      maxBytesTotal: 1_000_000,
      timeLimitInSeconds: 600,
    },
    exclusions: ["audit"],
    customDataTypes: [
      {
        dataTypeId: "custom:employee-id",
        pattern: "EMP-[0-9]{6}",
        keywords: ["employee"],
        nameHints: ["employee id"],
      },
    ],
    disabledDataTypeIds: ["phone-number"],
    allowedValues: ["4111 1111 1111 1111"],
    fingerprintKey: "project-fingerprint-key",
    findNamesAndAddresses: false,
    ...overrides,
  };
}

let sampled: Array<{
  connection: DatabaseConnection;
  options: ContentScanOptions;
}>;
let sampleError: Error | null;
let environment: Record<string, string | undefined>;
let workAnswers: Array<JSONObject | HTTPErrorResponse>;

const DEPENDENCIES: () => ScanDatabasesDependencies =
  (): ScanDatabasesDependencies => {
    return {
      sample: async (
        connection: DatabaseConnection,
        options: ContentScanOptions,
      ): Promise<ContentScanResult> => {
        sampled.push({ connection, options });

        if (sampleError) {
          throw sampleError;
        }

        return {
          ...emptyContentScanResult(),
          objectsRead: 3,
          readLog: ["public.users"],
        };
      },
      environment,
    };
  };

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

function bodiesSentTo(url: string): Array<JSONObject> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as JSONObject;
    })
    .filter((request: JSONObject) => {
      return String(request["url"]) === url;
    })
    .map((request: JSONObject) => {
      return request["data"] as JSONObject;
    });
}

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  resetDataSecurityScanState();
  sampled = [];
  sampleError = null;
  environment = {
    CUSTOMERS_DB_URL: CONNECTION_STRING,
    PROBE_KEY: "test-probe-key",
  };
  workAnswers = [];

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: JSONObject,
  ) => {
    if (String(request["url"]) === WORK_URL) {
      const answer: JSONObject | HTTPErrorResponse = workAnswers.shift() || {
        stores: [],
      };

      return answer instanceof HTTPErrorResponse
        ? answer
        : new HTTPResponse(200, answer, {});
    }

    return new HTTPResponse(200, { accepted: true, findingsWritten: 0 }, {});
  }) as never);

  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("scanStore", () => {
  test("samples with the connection string of the variable the store names", async () => {
    const report: JSONObject = (await scanStore(
      work(),
      DEPENDENCIES(),
    )) as unknown as JSONObject;

    expect(sampled).toHaveLength(1);
    expect(sampled[0]!.connection).toEqual({
      engine: "postgresql",
      connectionString: CONNECTION_STRING,
    });

    const options: ContentScanOptions = sampled[0]!.options;

    expect(options.limits).toMatchObject({
      maxRowsPerTable: 500,
      maxTables: 50,
      maxBytesTotal: 1_000_000,
    });
    expect(
      Math.abs(options.limits.deadline.getTime() - (Date.now() + 600_000)),
    ).toBeLessThan(5_000);
    expect(options.exclusions).toEqual(["audit"]);
    expect(options.customDetectors).toHaveLength(1);
    expect(options.extraHints).toEqual([
      { dataTypeId: "custom:employee-id", hints: ["employee id"] },
    ]);
    expect([...options.disabledDataTypeIds]).toEqual(["phone-number"]);
    // As written, and as the digits its detector normalizes a card to.
    expect([...options.allowedValues].sort()).toEqual([
      "4111 1111 1111 1111",
      "4111111111111111",
    ]);
    expect(options.fingerprintKey).toBe("project-fingerprint-key");
    expect(report["result"]).toMatchObject({ objectsRead: 3 });
    expect(report["error"]).toBeUndefined();
  });

  test("a variable the probe does not have is reported as such", async () => {
    const report: JSONObject = (await scanStore(
      work({ probeConnectionVariable: "MISSING_DB_URL" }),
      DEPENDENCIES(),
    )) as unknown as JSONObject;

    expect(sampled).toEqual([]);
    expect(report["error"]).toBe(
      "The probe has no environment variable MISSING_DB_URL.",
    );
  });

  test.each([
    "customers_db_url",
    "PROBE_KEY",
    "REGISTER_PROBE_KEY",
    "1DB",
    "DB-URL",
    "A".repeat(65),
  ])("refuses to read the variable %s", async (name: string) => {
    environment[name] = CONNECTION_STRING;

    const report: JSONObject = (await scanStore(
      work({ probeConnectionVariable: name }),
      DEPENDENCIES(),
    )) as unknown as JSONObject;

    expect(sampled).toEqual([]);
    expect(String(report["error"])).toContain(
      "The probe does not read the environment variable",
    );
  });

  test("an error is reported without the connection string's password", async () => {
    sampleError = new Error(
      `Could not connect to the database: connect ECONNREFUSED using ${CONNECTION_STRING}`,
    );

    const report: JSONObject = (await scanStore(
      work(),
      DEPENDENCIES(),
    )) as unknown as JSONObject;

    expect(String(report["error"])).toContain("ECONNREFUSED");
    expect(String(report["error"])).not.toContain("Probe0nly-Secret");
  });
});

/*
 * The names-and-addresses model on a probe (#10373): the project's setting
 * comes in the work as findNamesAndAddresses, the probe makes the model's
 * context with it, a table's free text is read by the model where the probe
 * runs, and what is reported holds the findings masked - the sentence never
 * leaves the probe. The model is a recogniser behind its interface; the
 * table is classified by the sampler's own classifier.
 */
describe("the names-and-addresses model on a probe", () => {
  const NOTES: Array<string> = [
    "The customer asked about the delivery window for their order and was told it would arrive tomorrow morning.",
    ISSUE_SENTENCE,
    "Called back about the damaged parcel; a replacement was sent by express and the original need not be returned.",
  ];

  // A database of one table, read as the sampler reads one.
  function modelDependencies(
    made: Array<boolean>,
    budget: ModelBudget = ModelBudget.forScope("content"),
  ): ScanDatabasesDependencies {
    return {
      ...DEPENDENCIES(),
      createModelContext: async (
        isEnabled: boolean,
      ): Promise<ModelScanContext | undefined> => {
        made.push(isEnabled);

        return isEnabled
          ? { recognizer: new FakeEntityRecognizer(), budget }
          : undefined;
      },
      sample: async (
        connection: DatabaseConnection,
        options: ContentScanOptions,
      ): Promise<ContentScanResult> => {
        sampled.push({ connection, options });

        const fields: Array<CollectedField> = [
          { path: "public.tickets.notes", values: NOTES },
        ];
        const classified: FieldsClassification = classifyCollectedFields({
          fields,
          options,
          fingerprints: new FingerprintAccumulator(options.fingerprintKey),
          locationKind: DataStoreLocationKind.Column,
          recognitions: await recognizeFields(
            options.model,
            CONTENT_STORE_KEY,
            fields,
          ),
        });

        return {
          ...emptyContentScanResult(),
          objectsRead: 1,
          rowsRead: NOTES.length,
          locations: classified.locations,
          readLog: ["public.tickets"],
        };
      },
    };
  }

  function typesReported(report: JSONObject): Array<string> {
    const result: ContentScanResult = report[
      "result"
    ] as unknown as ContentScanResult;

    return result.locations.flatMap((location: LocationFindings) => {
      return location.classifications.map(
        (classification: FieldClassification): string => {
          return classification.dataTypeId;
        },
      );
    });
  }

  test("the issue's sentence in a column is reported as a person's name and a street address, masked, and the sentence never leaves the probe", async () => {
    workAnswers.push({
      stores: [work({ findNamesAndAddresses: true })],
    } as unknown as JSONObject);
    const made: Array<boolean> = [];

    await runDataSecurityScanTick(modelDependencies(made));

    expect(made).toEqual([true]);

    const reports: Array<JSONObject> = bodiesSentTo(RESULT_URL);

    expect(reports).toHaveLength(1);
    expect(typesReported(reports[0]!)).toEqual(
      expect.arrayContaining(["person-name", "postal-address"]),
    );

    const result: ContentScanResult = reports[0]![
      "result"
    ] as unknown as ContentScanResult;
    const name: FieldClassification | undefined = result.locations
      .flatMap((location: LocationFindings) => {
        return location.classifications;
      })
      .find((classification: FieldClassification) => {
        return classification.dataTypeId === "person-name";
      });

    expect(name).toEqual(
      expect.objectContaining({
        maskedSamples: ["M****"],
        foundByModel: true,
      }),
    );

    // Nothing the probe sent holds the sentence, the name or the street.
    const sent: string = JSON.stringify(fetchSpy.mock.calls);

    expect(sent).not.toContain("Maria Gonzalez");
    expect(sent).not.toContain("Calle Mayor");
  });

  test("a project that turned it off reads no column with the model", async () => {
    workAnswers.push({
      stores: [work({ findNamesAndAddresses: false })],
    } as unknown as JSONObject);
    const made: Array<boolean> = [];

    await runDataSecurityScanTick(modelDependencies(made));

    expect(made).toEqual([false]);
    expect(sampled[0]!.options.model).toBeUndefined();
    expect(typesReported(bodiesSentTo(RESULT_URL)[0]!)).not.toContain(
      "person-name",
    );
  });

  test("work from a server that does not send the setting reads no column with the model", async () => {
    const withoutSetting: JSONObject = {
      ...(work() as unknown as JSONObject),
    };

    delete withoutSetting["findNamesAndAddresses"];
    workAnswers.push({ stores: [withoutSetting] } as unknown as JSONObject);
    const made: Array<boolean> = [];

    await runDataSecurityScanTick(modelDependencies(made));

    expect(made).toEqual([false]);
    expect(bodiesSentTo(RESULT_URL)).toHaveLength(1);
  });

  test("the model's time running out is reported in the warnings, once, and the store is still reported", async () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 10,
      storeLimitInMs: 10,
    });
    const report: JSONObject = (await scanStore(
      work({ findNamesAndAddresses: true }),
      modelDependencies([], budget),
    )) as unknown as JSONObject;
    const result: ContentScanResult = report[
      "result"
    ] as unknown as ContentScanResult;

    expect(report["error"]).toBeUndefined();
    expect(result.objectsRead).toBe(1);
    expect(result.warnings).toEqual([
      "Names and street addresses were looked for in 1 of 3 free-text values: the scan's 1 second of model time ran out.",
    ]);
  });
});

describe("runDataSecurityScanTick", () => {
  test("asks for work as this probe, scans what it is handed and reports each store", async () => {
    workAnswers.push({
      stores: [
        work(),
        work({
          dataStoreId: "77777777-7777-4777-8777-777777777777",
          probeConnectionVariable: "MISSING",
        }),
        { nonsense: true },
      ],
    } as unknown as JSONObject);

    await runDataSecurityScanTick(DEPENDENCIES());

    const asked: Array<JSONObject> = bodiesSentTo(WORK_URL);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      probeCapabilities: expect.arrayContaining(["dataSecurityScan"]),
    });

    const reports: Array<JSONObject> = bodiesSentTo(RESULT_URL);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      probeKey: "test-probe-key",
      dataStoreId: "66666666-6666-4666-8666-666666666666",
      result: { objectsRead: 3 },
    });
    expect(reports[1]).toMatchObject({
      dataStoreId: "77777777-7777-4777-8777-777777777777",
      error: "The probe has no environment variable MISSING.",
    });

    // The connection string never leaves the probe.
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(
      "Probe0nly-Secret",
    );
  });

  test("a work request that fails scans nothing", async () => {
    workAnswers.push(new HTTPErrorResponse(404, { message: "Not found" }, {}));

    await runDataSecurityScanTick(DEPENDENCIES());

    expect(sampled).toEqual([]);
    expect(bodiesSentTo(RESULT_URL)).toEqual([]);
  });

  test("one tick runs at a time", async () => {
    workAnswers.push({ stores: [work()] } as unknown as JSONObject);

    await Promise.all([
      runDataSecurityScanTick(DEPENDENCIES()),
      runDataSecurityScanTick(DEPENDENCIES()),
    ]);

    expect(bodiesSentTo(WORK_URL)).toHaveLength(1);
  });
});

describe("the job", () => {
  test("runs every five minutes", () => {
    InitScanDatabases();

    expect(mockCapturedCronJobs).toHaveLength(1);
    expect(mockCapturedCronJobs[0]).toMatchObject({
      jobName: "Probe:DataSecurityScanDatabases",
      options: { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
    });
  });

  test("a global probe of the hosted product scans no database; every other probe does", () => {
    expect(
      isDataSecurityScanAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: true,
      }),
    ).toBe(false);
    expect(
      isDataSecurityScanAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      }),
    ).toBe(true);
    expect(
      isDataSecurityScanAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: true,
      }),
    ).toBe(true);
  });
});
