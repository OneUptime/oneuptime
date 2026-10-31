/*
 * Grouping v2 at ingest: which fingerprint an occurrence is stored and
 * counted under.
 *
 * An exception that existed before grouping v2 keeps its first (v1)
 * fingerprint, and an occurrence whose v1 fingerprint is an existing
 * exception's lands on it, as before. Every other occurrence is grouped by
 * its v2 fingerprint - the type and the functions and modules of its own
 * code - so a new exception is made under it and later occurrences find it
 * whatever their line numbers. The occurrence row and the group upsert always
 * agree. Through the real OTLP walk, with Postgres mocked.
 */
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil, {
  ExceptionFingerprintInput,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import logger from "Common/Server/Utils/Logger";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000aa",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-0000000000aa",
);
const SERVICE_NAME: string = "grouping-v2-service";

function stack(line: number): string {
  return [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    `    at reserveStock (/app/src/inventory.ts:${line}:17)`,
    `    at Layer.handle (/app/node_modules/express/lib/router/layer.js:${line + 3}:5)`,
    `    at checkout (/app/src/cart.ts:${line * 2}:9)`,
  ].join("\n");
}

const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function attribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

// The v1 fingerprints the mocked Postgres holds exceptions under.
let existingV1: Set<string>;
let lookups: Array<Array<unknown>>;
let lookupFails: boolean;

function setupMocks(): void {
  for (const ingestService of [
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    const service: Record<string, any> = ingestService as unknown as {
      [key: string]: any;
    };
    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }
    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: SERVICE_NAME,
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
  }

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue([] as any);
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([] as any);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as any);

  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql.includes('SELECT "fingerprint" FROM "TelemetryException"')) {
          lookups.push(params);
          if (lookupFails) {
            throw new Error("connection reset");
          }
          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return existingV1.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return { fingerprint };
            });
        }
        return [];
      },
    },
  } as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
}

function tracesRequest(stackTrace: string): TelemetryRequest {
  const nowNano: string = `${Date.now()}000000`;
  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceSpans: [
        {
          resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: "0af7651916cd43dd8448eb211c80319c",
                  spanId: "b7ad6b7169203331",
                  parentSpanId: "",
                  name: "POST /checkout",
                  kind: 2,
                  startTimeUnixNano: nowNano,
                  endTimeUnixNano: nowNano,
                  status: { code: 2 },
                  attributes: [],
                  events: [
                    {
                      name: "exception",
                      timeUnixNano: nowNano,
                      attributes: [
                        attribute("exception.type", "TypeError"),
                        attribute(
                          "exception.message",
                          "Cannot read properties of undefined (reading 'id')",
                        ),
                        attribute("exception.stacktrace", stackTrace),
                      ],
                    },
                  ],
                  links: [],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

function logsRequest(stackTrace: string): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceLogs: [
        {
          resource: { attributes: [attribute("service.name", SERVICE_NAME)] },
          scopeLogs: [
            {
              scope: {},
              logRecords: [
                {
                  timeUnixNano: `${Date.now()}000000`,
                  severityNumber: 17,
                  body: { stringValue: "failed" },
                  attributes: [
                    attribute("exception.type", "TypeError"),
                    attribute("exception.message", "failed"),
                    attribute("exception.stacktrace", stackTrace),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

function fingerprints(): {
  v1: (stackTrace: string) => string;
  v2: (stackTrace: string) => string;
} {
  const input: (stackTrace: string) => ExceptionFingerprintInput = (
    stackTrace: string,
  ): ExceptionFingerprintInput => {
    return {
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      exceptionType: "TypeError",
      message: "Cannot read properties of undefined (reading 'id')",
      stackTrace,
    };
  };
  return {
    v1: (stackTrace: string): string => {
      return ExceptionUtil.getFingerprint(input(stackTrace));
    },
    v2: (stackTrace: string): string => {
      return ExceptionUtil.getFingerprintV2(input(stackTrace));
    },
  };
}

describe("the v2 fingerprint", () => {
  test("is not the v1 one, and does not move with line numbers or library frames", () => {
    const { v1, v2 } = fingerprints();

    expect(v2(stack(42))).not.toBe(v1(stack(42)));
    expect(v2(stack(42))).toBe(v2(stack(43)));
  });

  test("groups what v1 split: a Python line number, a library upgrade, a short value in the message", () => {
    const python: (
      line: number,
      library: string,
      message: string,
    ) => { v1: string; v2: string } = (
      line: number,
      library: string,
      message: string,
    ): { v1: string; v2: string } => {
      const stackTrace: string = [
        "Traceback (most recent call last):",
        `  File "/usr/lib/python3.11/site-packages/${library}/handlers.py", line ${line + 7}, in dispatch`,
        `  File "/app/orders/views.py", line ${line}, in create_order`,
        `ValueError: ${message}`,
      ].join("\n");
      const input: ExceptionFingerprintInput = {
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        exceptionType: "ValueError",
        message,
        stackTrace,
      };
      return {
        v1: ExceptionUtil.getFingerprint(input),
        v2: ExceptionUtil.getFingerprintV2(input),
      };
    };

    const a: { v1: string; v2: string } = python(
      40,
      "django",
      "Order 1001 failed",
    );
    const b: { v1: string; v2: string } = python(
      52,
      "django-5",
      "Order 2002 failed",
    );

    expect(a.v1).not.toBe(b.v1);
    expect(a.v2).toBe(b.v2);
  });

  test("is one per project and service, as the v1 one", () => {
    const base: ExceptionFingerprintInput = {
      exceptionType: "TypeError",
      message: "x",
      stackTrace: stack(1),
    };
    const a: string = ExceptionUtil.getFingerprintV2({
      ...base,
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
    });

    expect(
      ExceptionUtil.getFingerprintV2({
        ...base,
        projectId: PROJECT_ID,
        primaryEntityId: ObjectID.generate(),
      }),
    ).not.toBe(a);
    expect(
      ExceptionUtil.getFingerprintV2({
        ...base,
        projectId: ObjectID.generate(),
        primaryEntityId: SERVICE_ID,
      }),
    ).not.toBe(a);
  });
});

describe("which fingerprint an occurrence keeps", () => {
  beforeEach(() => {
    clearExistingV1FingerprintCache();
    existingV1 = new Set<string>();
    lookups = [];
    lookupFails = false;
    setupMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an exception that exists under its v1 fingerprint keeps it", async () => {
    existingV1.add("v1-old");

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([
        { projectId: "p", v1: "v1-old", v2: "v2-old" },
        { projectId: "p", v1: "v1-new", v2: "v2-new" },
      ]);

    expect(chosen.get("p|v1-old|v2-old")).toBe("v1-old");
    expect(chosen.get("p|v1-new|v2-new")).toBe("v2-new");
    // One read for the project, with each v1 fingerprint once.
    expect(lookups).toEqual([["p", ["v1-old", "v1-new"]]]);
  });

  test("what was looked up is not looked up again for a while", async () => {
    await ExceptionUtil.resolveGroupFingerprints([
      { projectId: "p", v1: "a", v2: "b" },
    ]);
    await ExceptionUtil.resolveGroupFingerprints([
      { projectId: "p", v1: "a", v2: "b" },
    ]);

    expect(lookups).toHaveLength(1);

    // Ten minutes on, it is read again.
    await ExceptionUtil.resolveGroupFingerprints(
      [{ projectId: "p", v1: "a", v2: "b" }],
      Date.now() + 11 * 60 * 1000,
    );
    expect(lookups).toHaveLength(2);
  });

  test("a failed read keeps the v1 fingerprint: grouped as before v2, never lost", async () => {
    lookupFails = true;

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([
        { projectId: "p", v1: "a", v2: "b" },
      ]);

    expect(chosen.get("p|a|b")).toBe("a");
    expect(logger.warn).toHaveBeenCalled();
  });

  test("an occurrence without a v2 fingerprint is not looked up", async () => {
    const payloads: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.assignPayloadGroupFingerprints([
        {
          fingerprint: "a",
          projectId: PROJECT_ID,
          primaryEntityId: SERVICE_ID,
        },
      ]);

    expect(payloads[0]!.fingerprint).toBe("a");
    expect(lookups).toHaveLength(0);
  });

  test("rows and payloads are given the chosen fingerprint, and keep no v2 one", async () => {
    existingV1.add("old");
    const rows: Array<JSONObject> = [
      {
        projectId: PROJECT_ID.toString(),
        fingerprint: "old",
        fingerprintV2: "x",
      },
      {
        projectId: PROJECT_ID.toString(),
        fingerprint: "new",
        fingerprintV2: "y",
      },
    ];

    await ExceptionUtil.assignRowGroupFingerprints(rows);

    expect(rows).toEqual([
      { projectId: PROJECT_ID.toString(), fingerprint: "old" },
      { projectId: PROJECT_ID.toString(), fingerprint: "y" },
    ]);

    const payloads: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.assignPayloadGroupFingerprints([
        {
          fingerprint: "new",
          fingerprintV2: "y",
          projectId: PROJECT_ID,
          primaryEntityId: SERVICE_ID,
        },
      ]);

    expect(payloads[0]!.fingerprint).toBe("y");
    expect(payloads[0]).not.toHaveProperty("fingerprintV2");
  });
});

describe("through the OTLP walk", () => {
  let insertSpy: jest.SpyInstance;
  let upserted: Array<TelemetryExceptionPayload>;

  beforeAll(() => {
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    clearExistingV1FingerprintCache();
    existingV1 = new Set<string>();
    lookups = [];
    lookupFails = false;
    setupMocks();
    jest.spyOn(SpanService, "insertJsonRows").mockResolvedValue(undefined);
    jest.spyOn(LogService, "insertJsonRows").mockResolvedValue(undefined);
    insertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
    upserted = [];

    /*
     * The real batch upsert up to its statement: it groups the payloads
     * (assignPayloadGroupFingerprints) before anything is written.
     */
    jest.spyOn(ExceptionUtil, "aggregateExceptions").mockImplementation(((
      exceptions: Array<TelemetryExceptionPayload>,
    ) => {
      upserted.push(...exceptions);
      return new Map();
    }) as never);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  function rows(): Array<JSONObject> {
    const out: Array<JSONObject> = [];
    for (const call of insertSpy.mock.calls) {
      out.push(...(call[0] as Array<JSONObject>));
    }
    return out;
  }

  const paths: Array<[string, (stackTrace: string) => Promise<void>]> = [
    [
      "trace path",
      async (stackTrace: string): Promise<void> => {
        await OtelTracesIngestService.processTracesFromQueue(
          tracesRequest(stackTrace),
        );
      },
    ],
    [
      "log path",
      async (stackTrace: string): Promise<void> => {
        await OtelLogsIngestService.processLogsFromQueue(
          logsRequest(stackTrace),
        );
      },
    ],
  ];

  describe.each(paths)(
    "%s",
    (name: string, ingest: (stackTrace: string) => Promise<void>) => {
      function v1Of(stackTrace: string): string {
        return name === "trace path"
          ? fingerprints().v1(stackTrace)
          : ExceptionUtil.getFingerprint({
              projectId: PROJECT_ID,
              primaryEntityId: SERVICE_ID,
              exceptionType: "TypeError",
              message: "failed",
              stackTrace,
            });
      }

      function v2Of(stackTrace: string): string {
        return name === "trace path"
          ? fingerprints().v2(stackTrace)
          : ExceptionUtil.getFingerprintV2({
              projectId: PROJECT_ID,
              primaryEntityId: SERVICE_ID,
              exceptionType: "TypeError",
              message: "failed",
              stackTrace,
            });
      }

      test("a new exception is made under its v2 fingerprint: the row and the upsert agree, and the row stores no v2 field", async () => {
        await ingest(stack(42));

        expect(rows()).toHaveLength(1);
        expect(rows()[0]!["fingerprint"]).toBe(v2Of(stack(42)));
        expect(rows()[0]).not.toHaveProperty("fingerprintV2");
        expect(upserted).toHaveLength(1);
        expect(upserted[0]!.fingerprint).toBe(v2Of(stack(42)));
      });

      test("an occurrence of an exception made before v2 lands on it, by its v1 fingerprint", async () => {
        existingV1.add(v1Of(stack(42)));

        await ingest(stack(42));

        expect(rows()[0]!["fingerprint"]).toBe(v1Of(stack(42)));
        expect(upserted[0]!.fingerprint).toBe(v1Of(stack(42)));
      });

      test("an edit above the throw no longer splits a new exception", async () => {
        await ingest(stack(42));
        await ingest(stack(97));

        expect(rows()).toHaveLength(2);
        expect(rows()[0]!["fingerprint"]).toBe(rows()[1]!["fingerprint"]);
      });

      test("when the read fails, the occurrence is grouped as before v2", async () => {
        lookupFails = true;

        await ingest(stack(42));

        expect(rows()[0]!["fingerprint"]).toBe(v1Of(stack(42)));
        expect(upserted[0]!.fingerprint).toBe(v1Of(stack(42)));
      });
    },
  );
});
