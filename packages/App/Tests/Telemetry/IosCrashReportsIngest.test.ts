/*
 * An iOS app's crash, end to end through the real OTLP walk (#9922, #9923):
 * OTLP JSON -> processLogsFromQueue -> the exception rows and the exception
 * group upserts.
 *
 * opentelemetry-swift reports a crash twice when an app registers both of
 * its reporters: KSCrash's report as `device.crash` on the next launch,
 * MetricKit's as `metrickit.diagnostic.crash` up to a day later. Each is
 * symbolicated by the build's uploaded dSYM before it is grouped, and the
 * second report of a crash is kept beside the first - filed under its
 * exception, naming it - and counted nowhere.
 *
 * The register the two are paired in (Valkey) and the lock around it stand
 * in memory; the dSYM table is the one ingest would read.
 */
const registered: Map<string, string> = new Map<string, string>();

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: async (namespace: string, key: string) => {
        return registered.get(`${namespace}-${key}`) ?? null;
      },
      setString: async (namespace: string, key: string, value: string) => {
        registered.set(`${namespace}-${key}`, value);
      },
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: async () => {
        return { name: "mutex" };
      },
      release: async () => {
        return undefined;
      },
    },
  };
});

import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryDsymService from "Common/Server/Services/TelemetryDsymService";
import AppleSymbolication from "Common/Server/Utils/Telemetry/AppleSymbolication";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  AppleSymbolTable,
  decodeAppleSymbols,
  encodeAppleSymbols,
} from "Common/Utils/Telemetry/AppleSymbols";
import {
  APP_UUID,
  CRASHED_AT,
  CRASH_KSCRASH_REPORT,
  CRASH_MAIN_THREAD,
  CRASH_TREE,
  FixtureFrame,
  IDLE_THREAD,
  METRICKIT_PERIOD_END,
  metricKitTree,
} from "Common/Tests/Utils/Telemetry/AppleCrashFixtures";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const IDFV: string = "8C1A0C4E-0E5B-4F3D-9F0A-2B6C7D8E9F10";

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

// The app's functions in the build that crashed: its uploaded dSYM.
const BUILD_TABLE: AppleSymbolTable = decodeAppleSymbols(
  encodeAppleSymbols({
    symbols: [
      { offset: 20000, name: "main" },
      { offset: 150032, name: "$s5MyApp4CartV3addyyAA4ItemVF" },
      { offset: 188368, name: "$s5MyApp18CartViewControllerC4loadyyKF" },
      { offset: 229064, name: "$s5MyApp18CartViewControllerC8checkoutyyF" },
    ],
    textEndOffset: 400000,
  }),
)!;

type OtlpAttribute = { key: string; value: JSONObject };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: String(value) } };
}

function nanos(date: Date): string {
  return `${date.getTime()}000000`;
}

// One crash log record, as opentelemetry-swift exports it from an iPhone.
function iosCrashRequest(data: {
  eventName: string;
  scope: string;
  time: Date;
  attributes: Array<OtlpAttribute>;
  install?: string | undefined;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    headers: {},
    body: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", "MyApp"),
              stringAttribute("service.version", "4.2 (812)"),
              stringAttribute("device.model.identifier", "iPhone15,2"),
              stringAttribute("device.id", data.install ?? IDFV),
              stringAttribute("os.name", "iOS"),
              stringAttribute("os.version", "18.1"),
              stringAttribute("telemetry.sdk.language", "swift"),
            ],
          },
          scopeLogs: [
            {
              scope: { name: data.scope },
              logRecords: [
                {
                  timeUnixNano: nanos(data.time),
                  observedTimeUnixNano: nanos(new Date()),
                  eventName: data.eventName,
                  attributes: data.attributes,
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as TelemetryRequest;
}

// KSCrash's report of the crash, on the app's next launch.
function kscrashRequest(
  data: { install?: string; report?: string } = {},
): TelemetryRequest {
  return iosCrashRequest({
    eventName: "device.crash",
    scope: "io.opentelemetry.crash",
    time: CRASHED_AT,
    install: data.install,
    attributes: [
      stringAttribute("exception.type", "EXC_BAD_ACCESS (SIGSEGV)"),
      stringAttribute(
        "exception.message",
        "KERN_INVALID_ADDRESS at 0x0000000000000010",
      ),
      stringAttribute(
        "exception.stacktrace",
        data.report ?? CRASH_KSCRASH_REPORT,
      ),
      stringAttribute("session.id", "1D3F5A7C-0000-4000-8000-000000000001"),
    ],
  });
}

// MetricKit's report of it, with the payload that ended the crash's day.
function metricKitRequest(
  data: { install?: string; tree?: string } = {},
): TelemetryRequest {
  return iosCrashRequest({
    eventName: "metrickit.diagnostic.crash",
    scope: "MetricKit",
    time: METRICKIT_PERIOD_END,
    install: data.install,
    attributes: [
      intAttribute("metrickit.diagnostic.crash.exception.signal", 11),
      stringAttribute(
        "metrickit.diagnostic.crash.exception.signal.name",
        "SIGSEGV",
      ),
      stringAttribute(
        "metrickit.diagnostic.crash.exception.mach_exception.name",
        "EXC_BAD_ACCESS",
      ),
      stringAttribute("exception.type", "EXC_BAD_ACCESS"),
      stringAttribute("exception.message", "Could not access memory"),
      stringAttribute("exception.stacktrace", data.tree ?? CRASH_TREE),
      stringAttribute("session.id", "1D3F5A7C-0000-4000-8000-000000000002"),
    ],
  });
}

type CallRecorder = { mock: { calls: Array<Array<unknown>> } };

function insertedRows(spy: CallRecorder): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

describe("An iOS app's crash, reported by KSCrash and MetricKit", () => {
  let exceptionInsertSpy: CallRecorder;
  let upsertedPayloads: Array<TelemetryExceptionPayload>;
  let tablesRead: jest.SpiedFunction<
    typeof TelemetryDsymService.getSymbolTables
  >;

  beforeAll(() => {
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    registered.clear();
    AppleSymbolication.clearCache();

    const service: Record<string, any> = OtelLogsIngestService as unknown as {
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
      jest.spyOn(service, method).mockResolvedValue(null);
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: "MyApp",
      primaryEntityId: RUM_APPLICATION_ID,
      primaryEntityType: ServiceType.RealUserMonitor,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });

    jest
      .spyOn(LogPipelineService, "loadPipelines")
      .mockResolvedValue([] as any);
    jest
      .spyOn(LogDropFilterService, "loadDropFilters")
      .mockResolvedValue([] as any);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      .mockResolvedValue([] as any);
    jest.spyOn(LogService, "insertJsonRows").mockResolvedValue(undefined);

    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined) as unknown as CallRecorder;

    upsertedPayloads = [];
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockImplementation(
        async (exceptions: Array<TelemetryExceptionPayload>): Promise<void> => {
          for (const exception of exceptions) {
            upsertedPayloads.push({ ...exception });
          }
        },
      );

    tablesRead = jest
      .spyOn(TelemetryDsymService, "getSymbolTables")
      .mockImplementation(async (data: { debugIds: Array<string> }) => {
        return new Map<string, AppleSymbolTable>(
          data.debugIds.includes(APP_UUID) ? [[APP_UUID, BUILD_TABLE]] : [],
        );
      });
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  async function ingest(request: TelemetryRequest): Promise<void> {
    await OtelLogsIngestService.processLogsFromQueue(request);
    await TelemetryFanInWriter.flushAll();
  }

  describe("symbolicated by the build's dSYM (#9922)", () => {
    test("KSCrash's report names the app's frames by their functions", async () => {
      await ingest(kscrashRequest());

      const row: JSONObject = insertedRows(exceptionInsertSpy)[0]!;

      expect(String(row["stackTrace"])).toContain(
        "0x100004000 + 229796 (CartViewController.checkout() + 732)",
      );
      expect(String(row["stackTrace"])).toContain(
        "(CartViewController.load() + 52)",
      );
      expect(tablesRead).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        debugIds: [APP_UUID],
      });
      // The parsed frames read by function, as the stack trace page shows them.
      expect(JSON.parse(String(row["parsedFrames"]))[0]).toMatchObject({
        functionName: "CartViewController.checkout()",
        fileName: "MyApp",
        inApp: true,
      });
    });

    test("MetricKit's drawn threads are named the same way", async () => {
      await ingest(metricKitRequest());

      const row: JSONObject = insertedRows(exceptionInsertSpy)[0]!;

      expect(String(row["stackTrace"]).split("\n")[0]).toBe(
        "Thread 1 Crashed:",
      );
      expect(String(row["stackTrace"])).toContain(
        "(CartViewController.checkout() + 732)",
      );
    });

    test("a build with no dSYM keeps its stack as sent, by binary and offset", async () => {
      tablesRead.mockResolvedValue(new Map());

      await ingest(kscrashRequest());

      const row: JSONObject = insertedRows(exceptionInsertSpy)[0]!;

      expect(row["stackTrace"]).toBe(CRASH_KSCRASH_REPORT);
    });
  });

  describe("counted once (#9923)", () => {
    test("MetricKit's report of the crash KSCrash reported is kept beside it, under its exception, and counted nowhere", async () => {
      await ingest(kscrashRequest());
      await ingest(metricKitRequest());

      const rows: Array<JSONObject> = insertedRows(exceptionInsertSpy);

      expect(rows).toHaveLength(2);

      const [first, second] = rows as [JSONObject, JSONObject];

      expect(first["duplicateOf"]).toBe("");
      expect(attributesOf(first)["oneuptime.crash.reporter"]).toBe("kscrash");

      expect(second["duplicateOf"]).toBe(first["_id"]);
      expect(second["fingerprint"]).toBe(first["fingerprint"]);
      expect(attributesOf(second)["oneuptime.crash.reporter"]).toBe(
        "metrickit",
      );
      expect(attributesOf(second)["oneuptime.crash.duplicate_of"]).toBe(
        first["_id"],
      );

      // Both reports are kept whole: the evidence of one crash.
      expect(String(second["stackTrace"])).toContain("Thread 1 Crashed:");

      // The exception is seen once: the repeat touches no counts of it.
      expect(upsertedPayloads).toHaveLength(1);
    });

    test("in either order", async () => {
      await ingest(metricKitRequest());
      await ingest(kscrashRequest());

      const [first, second] = insertedRows(exceptionInsertSpy) as [
        JSONObject,
        JSONObject,
      ];

      expect(attributesOf(first)["oneuptime.crash.reporter"]).toBe("metrickit");
      expect(second["duplicateOf"]).toBe(first["_id"]);
      expect(upsertedPayloads).toHaveLength(1);
    });

    test("with no dSYM uploaded, the two still pair by where the code was", async () => {
      tablesRead.mockResolvedValue(new Map());

      await ingest(kscrashRequest());
      await ingest(metricKitRequest());

      const [first, second] = insertedRows(exceptionInsertSpy) as [
        JSONObject,
        JSONObject,
      ];

      expect(second["duplicateOf"]).toBe(first["_id"]);
    });

    test("another crash on the same install - one app frame elsewhere - is counted on its own", async () => {
      await ingest(kscrashRequest());
      await ingest(
        metricKitRequest({
          tree: metricKitTree([
            { frames: IDLE_THREAD, attributed: false },
            {
              frames: CRASH_MAIN_THREAD.map(
                (frame: FixtureFrame, index: number): FixtureFrame => {
                  return index === 1
                    ? { ...frame, offset: frame.offset + 4000 }
                    : frame;
                },
              ),
              attributed: true,
            },
          ]),
        }),
      );

      const rows: Array<JSONObject> = insertedRows(exceptionInsertSpy);

      expect(
        rows.map((row: JSONObject) => {
          return row["duplicateOf"];
        }),
      ).toEqual(["", ""]);
      expect(upsertedPayloads).toHaveLength(2);
    });

    test("the same crash on another install is that install's own", async () => {
      await ingest(kscrashRequest());
      await ingest(
        metricKitRequest({ install: "0F1E2D3C-4B5A-4978-8695-A4B3C2D1E0F9" }),
      );

      expect(
        insertedRows(exceptionInsertSpy).map((row: JSONObject) => {
          return row["duplicateOf"];
        }),
      ).toEqual(["", ""]);
    });

    test("two crashes of one bug, each reported by both, are two occurrences with a repeat each", async () => {
      await ingest(kscrashRequest());
      await ingest(kscrashRequest());
      await ingest(metricKitRequest());
      await ingest(metricKitRequest());

      const rows: Array<JSONObject> = insertedRows(exceptionInsertSpy);
      const originals: Array<JSONObject> = rows.filter((row: JSONObject) => {
        return row["duplicateOf"] === "";
      });
      const repeats: Array<JSONObject> = rows.filter((row: JSONObject) => {
        return row["duplicateOf"] !== "";
      });

      expect(originals).toHaveLength(2);
      expect(
        repeats
          .map((row: JSONObject) => {
            return row["duplicateOf"];
          })
          .sort(),
      ).toEqual(
        originals
          .map((row: JSONObject) => {
            return row["_id"];
          })
          .sort(),
      );
      expect(upsertedPayloads).toHaveLength(2);
    });
  });
});
